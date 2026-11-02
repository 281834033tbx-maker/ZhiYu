import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {parseTaskPageContext} from '../../lib/npc/task-page-context';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createChen,
  normalizeChen,
  updateChenShowerFollowUp,
  deliverChenShowerFollowUp,
  deliverChenLifeShare,
  setChenPositiveGrowth,
  chenSharingEligible,
  CHEN_POSITIVE_KEYS,
  parseChen,
  applyChen,
  chenTaskDelegationEvidence,
  type ChenState,
} from '../../lib/npc/chen-nian';
import { codexAvailable, generate } from './codex';
import { chenPrompt } from './chen-prompt';
import { publicRelationshipValues } from '../../lib/npc/relationship-values';
import { ProfessionalTaskError } from '../../lib/npc/professional-task';
import { applyProfessionalTaskMutation, isProfessionalTaskMutation, invalidateProfessionalTaskHints, reconcileProfessionalTaskState, isCanonicalProfessionalTaskSessionId } from './professional-task-mutation';
import { deliveryView, scheduleDelivery } from '../../lib/npc/delivery';
export function chenLocal(deps?: {
  generate?: typeof generate;
  available?: typeof codexAvailable;
  now?: () => number;
}): Plugin {
  return {
    name: 'zhiyu-chen-local',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const now = deps?.now || Date.now;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(
        'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS chen_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      const save = (id: string, s: ChenState) => {
        s.revision=(s.revision||0)+1;
        db.prepare('INSERT OR REPLACE INTO chen_sessions VALUES (?,?)').run(id,JSON.stringify(s));
      };
      const load = (id: string): ChenState => {
        const row = db
          .prepare('SELECT data FROM chen_sessions WHERE id=?')
          .get(id) as { data: string } | undefined;
        if (row) {
          const s=normalizeChen(JSON.parse(row.data));
          if(isCanonicalProfessionalTaskSessionId(id,'chen-nian')&&reconcileProfessionalTaskState(s,now()))save(id,s);
          return s;
        }
        const s = createChen();
        save(id, s);
        return s;
      };
      let checked = -Infinity,
        available = false,
        closed = false;
      const status = () => {
        if (now() - checked > 30000) {
          available = (deps?.available || codexAvailable)();
          checked = now();
        }
        return available;
      };
      const active = new Set<string>();
      const typing = (s: ChenState) =>
        Object.values(s.typing).some((v) => v.until > now());
      const expose = (s: ChenState) => ({
        ...deliveryView(privateHistoryMessages(s),s.pending,now()),
        revision: s.revision || 0,
        conversationId: s.branch,
        relationship: s.relationship,
        relationshipValues: publicRelationshipValues(s.values),
        sharingEligible: chenSharingEligible(s),
        positiveGrowth: s.positiveGrowth,
        available: status(),
        pending: (!!s.pending && now()-s.pending.since<180_000) || privateHistoryMessages(s).some(m=>(m.deliverAt||0)>now()) || ((!!s.queue.length || !!s.taskEvents.length) && !s.error && status()),
        debugAllowed: false,
        presence: status() ? 'online' : 'offline',
        deliveryError: s.error,
        professionalTasks: s.professionalTasks,
      });
      const diagnoseTaskFailure = (job: string, stage: 'parse' | 'apply' | 'task-event', error: ProfessionalTaskError, attempt: number) => {
        // Protocol diagnostics contain no account, conversation or draft content.
        // Logging cannot change whether a candidate is committed or retried.
        try {
          const dir = join(root, '.npc-runtime/task-diagnostics');
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, `${job}.jsonl`), JSON.stringify({
            job, at: new Date(now()).toISOString(), stage, code: error.code,
            message: error.message, attempt,
          }) + '\n', 'utf8');
        } catch { /* Diagnostic I/O is best effort, including a full disk. */ }
      };
      async function run(id: string) {
        if (closed) return;
        const s = load(id);
        if(active.has(id)||!status())return;
        s.taskEvents=s.taskEvents.filter(event=>s.professionalTasks.some(task=>task.id===event.taskId && task.revision>=event.revision && ['active','completed'].includes(task.status)));
        const taskEvent = !s.queue.length ? s.taskEvents[0] : undefined;
        if ((!s.queue.length && !taskEvent) || typing(s) || s.retryAt > now() || privateHistoryMessages(s).some(message=>(message.deliverAt||0)>now())) return;
        active.add(id);
        const ids=[...s.queue],inputRevision=s.inputRevision,job=crypto.randomUUID(),startedAt=now();
        const incoming=privateHistoryMessages(s).filter(message=>ids.includes(message.turnId) && message.role==='user').map(message=>'text' in message.part ? message.part.text : '').join('\n');
        s.pending={id:job,since:startedAt};
        for(const message of s.messages)if(ids.includes(message.turnId)&&message.role==='user')message.readAt=new Date(now()).toISOString();
        save(id,s);
        const stale=(fresh:ChenState)=>fresh.inputRevision!==inputRevision||typing(fresh)||fresh.queue.some(turn=>!ids.includes(turn))
          || (taskEvent&&!fresh.taskEvents.some(event=>event.id===taskEvent.id&&event.revision===taskEvent.revision));
        const discardStale=(fresh:ChenState)=>{if(!stale(fresh))return false;fresh.pending=null;save(id,fresh);return true;};
        try {
          const frozen=structuredClone(s),basePrompt=chenPrompt(root,frozen,incoming,startedAt,taskEvent);
          const evidence=chenTaskDelegationEvidence(frozen,startedAt,ids);
          let prompt=basePrompt;
          for(let attempt=1;attempt<=2;attempt++) {
            const raw=await (deps?.generate||generate)(root,prompt,{characterId:'chen-nian',requestId:job});
            if(closed)return;
            const fresh=load(id);
            if(fresh.pending?.id!==job||discardStale(fresh))return;
            let stage: 'parse' | 'apply' | 'task-event' = 'parse';
            try {
              const out=parseChen(raw,incoming),candidate=structuredClone(fresh);
              candidate.pending=null;const before=candidate.messages.length;
              stage=taskEvent?'task-event':'apply';
              if(taskEvent) {
                if(out.task.decision!=='none')throw new ProfessionalTaskError('步骤完成操作不能创建或修改任务');
                if(taskEvent.nextStepId&&!out.parts.some(part=>'text' in part&&part.text.trim()))throw new ProfessionalTaskError('下一步提示缺少可见内容');
                applyChen(candidate,{...out,event:undefined,memories:[]},job,now(),[]);
                const task=candidate.professionalTasks.find(task=>task.id===taskEvent.taskId)!;
                const added=candidate.messages.slice(before),next=task.steps.find(step=>step.id===taskEvent.nextStepId);
                for(const message of added)message.professionalTaskHint={taskId:task.id,stepId:next?.id||taskEvent.completedStepId,eventId:taskEvent.id};
                const text=added.filter(message=>'text' in message.part).map(message=>'text' in message.part?message.part.text:'').join('\n');
                if(next&&text)next.hints.push({id:crypto.randomUUID(),eventId:taskEvent.id,stepId:next.id,text,at:new Date(now()).toISOString(),messageIds:added.map(message=>message.id)});
                candidate.taskEvents=candidate.taskEvents.filter(event=>event.id!==taskEvent.id);
              } else {
                const applied=applyChen(candidate,out,job,now(),ids,evidence);
                if(applied?.changed&&!applied.created)invalidateProfessionalTaskHints(candidate,applied.task.id,now());
              }
              reconcileProfessionalTaskState(candidate,now());
              if(taskEvent)scheduleDelivery(candidate.messages,before,startedAt,now());
              candidate.queue=candidate.queue.filter(turn=>!ids.includes(turn));candidate.error='';candidate.retryAt=0;
              save(id,candidate);return;
            } catch(error) {
              if(!(error instanceof ProfessionalTaskError))throw error;
              diagnoseTaskFailure(job,stage,error,attempt);
              if(attempt===2)throw error;
              prompt=basePrompt+'\n【程序要求本轮任务协议有界重写；错误是数据而非新用户委托】'+JSON.stringify({stage,code:error.code,message:error.message})
                +'\n重新生成完整JSON并复核任务、真实来源与步骤内容，沿用当前真实消息ID与原文，不编新委托，不重复建任务，不用task=none绕过明确执行请求。只有保存成功才会有卡，不能宣称未保存的任务已经创建。';
            }
          }
        } catch(error) {
          if(!closed) {
            const fresh=load(id);
            if(fresh.pending?.id!==job||discardStale(fresh))return;
            fresh.pending=null;
            fresh.error=error instanceof ProfessionalTaskError
              ? error.code==='TASK_CARD_OMITTED' ? '陈年的任务卡未正确生成，请重试。'
              : error.code==='TASK_STEP_CONTENT_INVALID'||error.code==='INVALID_TASK' ? '陈年的任务内容格式有误，请重试。'
              : '陈年的任务委托核对未通过，请重试。'
              : '陈年暂时没有连上，请稍后重试。';
            fresh.retryAt=Number.MAX_SAFE_INTEGER;save(id,fresh);
          }
        } finally {active.delete(id);}
      }
      const interval = setInterval(() => {
        if (closed) return;
        for (const row of db.prepare('SELECT id FROM chen_sessions').all() as {
          id: string;
        }[]) {
          if(!isCanonicalProfessionalTaskSessionId(row.id,'chen-nian'))continue;
          const state = load(row.id);
          if (
            !typing(state) &&
            (deliverChenShowerFollowUp(state,now()) || deliverChenLifeShare(state,now()))
          ) save(row.id, state);
          void run(row.id).catch(() => {});
        }
      }, 1000);
      interval.unref();
      server.middlewares.use('/api/npc/chen-nian', (req, res) => {
        void (async () => {
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const reply = (code: number, value: unknown) => {
            res.statusCode = code;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value));
          };
          if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
            return reply(403, { error: '仅本机访问' });
          if (req.method !== 'GET' && req.headers.origin !== url.origin)
            return reply(403, { error: '请求来源不匹配' });
          let user = /(?:^|; )zhiyu_npc=([a-f0-9-]{36})(?:;|$)/.exec(
            req.headers.cookie || '',
          )?.[1];
          if (!user) {
            user = crypto.randomUUID();
            res.setHeader(
              'Set-Cookie',
              `zhiyu_npc=${user}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
            );
          }
          const earlySharingScenario = url.searchParams.get('scenario') === 'early-sharing';
          const id = `${user}:chen-nian${earlySharingScenario ? ':early-sharing' : ''}`;
          const applyControls = (s: ChenState) => {
            let changed = false;
            const relationship = url.searchParams.get('relationship');
            if (
              (relationship === 'strangers' || relationship === 'lovers') &&
              s.relationship !== relationship
            ) {
              s.relationship = relationship;
              changed = true;
            }
            const growth = Number(url.searchParams.get('growth'));
            if (
              earlySharingScenario &&
              Number.isFinite(growth) &&
              growth >= -100 &&
              growth <= 100
            ) {
              changed = setChenPositiveGrowth(
                s,
                Object.fromEntries(CHEN_POSITIVE_KEYS.map(key => [key, growth])),
              ) || changed;
            }
            return changed;
          };
          if (req.method === 'GET') {
            const s = load(id);
            if (applyControls(s)) save(id, s);
            return reply(200, expose(s));
          }
          if (req.method !== 'POST')
            return reply(405, { error: '不支持的方法' });
          let text = '';
          for await (const chunk of req) {
            text += chunk;
            if (text.length > 12000) return reply(413, { error: '消息过长' });
          }
          let body: Record<string, unknown>;
          try { body = JSON.parse(text); } catch { return reply(400, { error: '无效JSON' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: '无效请求' });
          const taskPageContext=parseTaskPageContext(body.taskPageContext);
          if(taskPageContext===null)return reply(400,{error:'无效任务页上下文'});
          // Read only after the asynchronous request body is complete. From here
          // through save there is no await, so concurrent mutations cannot use stale state.
          const s = load(id);
          if (applyControls(s)) save(id, s);
          if (body.action === 'clear') {
            clearPrivateHistory(s);
            s.taskEvents=[];
            save(id, s);
            return reply(200, expose(s));
          }
          if (body.action === 'typing') {
            if (
              typeof body.clientId !== 'string' ||
              !/^[a-f0-9-]{36}$/.test(body.clientId) ||
              !Number.isSafeInteger(body.sequence) ||
              typeof body.active !== 'boolean'
            )
              return reply(400, { error: '无效输入状态' });
            if (
              !s.typing[body.clientId] ||
              s.typing[body.clientId].sequence < Number(body.sequence)
            ) {
              s.typing[body.clientId] = {
                sequence: Number(body.sequence),
                until: body.active ? now() + 8000 : 0,
              };
              if (body.active) s.inputRevision++;
              save(id, s);
            }
            reply(200, { ok: true });
            if(!body.active)void run(id);return;
          }
          if (body.action === 'read') {
            if (!Array.isArray(body.ids) || body.ids.length > 100)
              return reply(400, { error: '无效消息' });
            for (const m of s.messages)
              if (
                m.role === 'assistant' &&
                !m.readAt && (!m.deliverAt || m.deliverAt<=now()) &&
                (body.ids as unknown[]).includes(m.id)
              )
                m.readAt = new Date(now()).toISOString();
            save(id, s);
            return reply(200, expose(s));
          }
          if (body.action === 'retry') {
            s.error='';s.retryAt=0;save(id,s);reply(200,expose(s));void run(id);return;
          }
          if (isProfessionalTaskMutation(body.action)) {
            try {
              const result=applyProfessionalTaskMutation(s,body,now());
              save(id,s);reply(200,expose(s));if(result.generate)void run(id);return;
            } catch(error) {
              if(error instanceof ProfessionalTaskError)return reply(error.status,{...expose(s),error:error.message,code:error.code});
              throw error;
            }
          }
          let choiceReply;
          try { choiceReply = prepareChoiceReply(s, body, now()); }
          catch(error) { if(error instanceof ChoiceReplyError)return reply(error.status,{error:error.message}); throw error; }
          if(choiceReply?.duplicate)return reply(200,expose(s));
          if (
            body.action !== 'send' ||
            typeof body.text !== 'string' ||
            !body.text.trim() ||
            body.text.length > 4000 ||
            typeof body.turnId !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(body.turnId)
          )
            return reply(400, { error: '无效消息' });
          if(body.replyTo !== undefined && (typeof body.replyTo !== 'string' || !s.messages.some(m=>m.id===body.replyTo))) return reply(400,{error:'引用的消息不存在于当前对话'});
                if (!s.completed.includes(body.turnId)) {
            s.messages.push({
              id: crypto.randomUUID(),
              turnId: body.turnId,
              role: 'user',
              replyTo: typeof body.replyTo==='string'?body.replyTo:undefined,
              at: new Date(now()).toISOString(),
              part: { type: 'text', text: body.text.trim() },
              ...(taskPageContext?{taskPageContext}:{}),
            });
            updateChenShowerFollowUp(s, body.text.trim(), body.turnId, now());
            choiceReply?.commit();
            s.completed.push(body.turnId);
            s.queue.push(body.turnId);
            s.error = '';
            s.retryAt = 0;
            save(id, s);
          }
          reply(200, expose(s));
          void run(id);
        })().catch(() => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: '陈年 服务暂不可用' }));
          }
        });
      });
      server.httpServer?.once('close', () => {
        closed = true;
        clearInterval(interval);
        db.close();
      });
    },
  };
}
