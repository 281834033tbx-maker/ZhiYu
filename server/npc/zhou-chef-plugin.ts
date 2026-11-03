import {statusFromState} from '../../lib/npc/character-status';
import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {parseTaskPageContext} from '../../lib/npc/task-page-context';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyChef, chefTaskDelegationEvidence, createChef, importChefHistory, parseChef, type ChefState, type LegacyChefMessage } from '../../lib/npc/zhou-chef';
import { deliveryView, scheduleDelivery, presentationPending } from '../../lib/npc/delivery';
import { publicRelationshipValues } from '../../lib/npc/relationship-values';
import { codexAvailable, generate, type generateRaw } from './codex';
import { chefPrompt, chefApplicationEvidence } from './zhou-chef-prompt';
import { TaskMemoryStore } from './group-task-memory';
import { ProfessionalTaskError } from '../../lib/npc/professional-task';
import { applyProfessionalTaskMutation, isProfessionalTaskMutation, reconcileProfessionalTaskState, isCanonicalProfessionalTaskSessionId } from './professional-task-mutation';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// A repeated migration ID is idempotent only when its entire source content
// matches. Omitted attachments are also a conflict; never silently lose bytes.
function legacyContentKey(message: LegacyChefMessage) {
  return JSON.stringify([message.text, message.time,
    message.at === undefined ? null : new Date(message.at).toISOString(),
    message.replyTo ?? null, message.image ?? null, message.audio ?? null,
    message.audioDurationSeconds ?? null, message.file ?? null]);
}

export function chefLocal(deps?: { now?: () => number; generate?: typeof generate; available?: typeof codexAvailable; runRaw?: typeof generateRaw }): Plugin {
  return {
    name: 'zhiyu-chef-local', apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const now = deps?.now || Date.now;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS zhou_chef_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
      const taskMemory = new TaskMemoryStore(db);
      const save = (id: string, state: ChefState) => {
        state.revision++;
        db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(id, JSON.stringify(state));
      };
      const load = (id: string): ChefState => {
        const row = db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(id) as { data: string } | undefined;
        if (row) {
          const state = JSON.parse(row.data) as ChefState;
          state.professionalTasks ||= []; state.taskEvents ||= []; state.taskMutations ||= [];
          if(isCanonicalProfessionalTaskSessionId(id,'zhou-chef')&&reconcileProfessionalTaskState(state,now()))save(id,state);
          return state;
        }
        const state = createChef();
        save(id, state);
        return state;
      };
      let checked = -Infinity, available = false, closed = false;
      const status = () => {
        if (now() - checked > 30_000) {
          available = (deps?.available || codexAvailable)();
          checked = now();
        }
        return available;
      };
      const active = new Set<string>();
      const typing = (state: ChefState) => Object.values(state.typing).some(client => client.until > now());
      const expose = (state: ChefState) => ({
        ...deliveryView(privateHistoryMessages(state), presentationPending(state), now()),
        characterStatus:statusFromState('zhou-chef',state,now()),
        revision: state.revision, conversationId: state.branch,
        pending: (!!state.pending && now() - state.pending.since < 180_000) || privateHistoryMessages(state).some(message => (message.deliverAt || 0) > now()) || ((!!state.queue.length || !!state.taskEvents.length) && !state.error && status()),
        available: status(), debugAllowed: false,
        presence: !status() ? 'offline' : state.pending || state.queue.length ? 'busy' : 'online',
        deliveryError: state.error, relationship: state.relationship,
        relationshipValues: publicRelationshipValues(state.values),
        professionalTasks: state.professionalTasks,
      });

      // Preserve originals behind display tombstones; an unsent stale hint must never reappear.
      const invalidateHints = (state: ChefState, taskId: string) => {
        state.taskEvents = state.taskEvents.filter(event => event.taskId !== taskId);
        const stale = state.messages.filter(message => message.professionalTaskHint?.taskId === taskId && (message.deliverAt || 0) > now()).map(message => message.id);
        if (stale.length) state.privateHistoryHiddenIds = [...new Set([...(state.privateHistoryHiddenIds || []), ...stale])];
        const cancelled = new Set(stale);
        for (const task of state.professionalTasks) for (const step of task.steps)
          step.hints = step.hints.filter(hint => !hint.messageIds.some(messageId => cancelled.has(messageId)));
      };

      const diagnoseTaskFailure = (job: string, stage: 'parse' | 'apply' | 'task-event', error: ProfessionalTaskError, attempt: number) => {
        // Task errors contain protocol diagnostics, never conversation/account data.
        // Logging is best effort and cannot change delivery or retry behavior.
        try {
          const dir = join(root, '.npc-runtime/task-diagnostics');
          mkdirSync(dir, { recursive: true });
          appendFileSync(join(dir, `${job}.jsonl`), JSON.stringify({
            job, at: new Date(now()).toISOString(), stage, code: error.code,
            message: error.message, attempt,
          }) + '\n', 'utf8');
        } catch { /* A full disk must not turn a recoverable draft into a second failure. */ }
      };

      async function run(id: string) {
        if (closed) return;
        const state = load(id);
        if(active.has(id)||!status())return;
        // Pure timer mutations increment revision without changing the next step.
        // Recipe/progress/status mutations explicitly invalidate obsolete hints.
        state.taskEvents = state.taskEvents.filter(event => state.professionalTasks.some(task => task.id === event.taskId && task.revision >= event.revision && ['active','completed'].includes(task.status)));
        const taskEvent = !state.queue.length ? state.taskEvents[0] : undefined;
        if ((!state.queue.length && !taskEvent) || state.retryAt > now() || typing(state) || privateHistoryMessages(state).some(message => (message.deliverAt || 0) > now())) return;
        active.add(id);
        const ids = [...state.queue], inputRevision = state.inputRevision, job = crypto.randomUUID();
        const incoming = privateHistoryMessages(state).filter(message => ids.includes(message.turnId) && message.role === 'user')
          .map(message => 'text' in message.part ? message.part.text : '').join('\n');
        const startedAt = now();
        state.pending = { id: job, since: startedAt };
        for (const message of state.messages) if (ids.includes(message.turnId) && message.role === 'user') message.readAt = new Date(now()).toISOString();
        save(id, state);
        const stale = (fresh: ChefState) => fresh.inputRevision !== inputRevision || typing(fresh) || fresh.queue.some(turn => !ids.includes(turn))
          || (taskEvent && !fresh.taskEvents.some(event => event.id === taskEvent.id && event.revision === taskEvent.revision));
        const discardStale = (fresh: ChefState) => {
          if (!stale(fresh)) return false;
          fresh.pending = null;
          save(id, fresh);
          return true;
        };
        try {
          // One task-protocol repair follows the generator's own technical review.
          // Both attempts use the exact same real input/context/capability snapshot.
          const frozen = structuredClone(state);
          const basePrompt = chefPrompt(root, frozen, incoming, startedAt, taskEvent);
          const evidence = chefApplicationEvidence(frozen);
          const frozenTaskEvidence = chefTaskDelegationEvidence(frozen, startedAt, ids);
          let prompt = basePrompt;
          for (let attempt = 1; attempt <= 2; attempt++) {
            const raw = await (deps?.generate || generate)(root, prompt, { characterId: 'zhou-chef', requestId: job,
              chefEvidence: structuredClone(evidence), ...(deps?.runRaw ? { runRaw: deps.runRaw } : {}) });
            if (closed) return;
            const fresh = load(id);
            if (fresh.pending?.id !== job || discardStale(fresh)) return;
            let stage: 'parse' | 'apply' | 'task-event' = 'parse';
            try {
              const out = parseChef(raw, incoming);
              // Parsing/task guards may fail after beginning a mutation. Validate on
              // a disposable copy, then commit all output once with no intervening await.
              const candidate = structuredClone(fresh);
              candidate.pending = null;
              const before = candidate.messages.length;
              stage = taskEvent ? 'task-event' : 'apply';
              if (taskEvent) {
                if (out.task.decision !== 'none') throw new ProfessionalTaskError('完成操作不能创建或修改任务');
                if (taskEvent.nextStepId && !out.parts.some(part => 'text' in part && part.text.trim())) throw new ProfessionalTaskError('下一步提示缺少可见内容');
                // UI completion is never a user relationship event or a source for ordinary memory.
                applyChef(candidate, { ...out, event: undefined, memories: [] }, job, now(), []);
                const task = candidate.professionalTasks.find(task => task.id === taskEvent.taskId)!;
                const added = candidate.messages.slice(before);
                const next = task.steps.find(step => step.id === taskEvent.nextStepId);
                if (next) {
                  for (const message of added) message.professionalTaskHint = {taskId:task.id,stepId:next.id,eventId:taskEvent.id};
                  const text = added.filter(message => 'text' in message.part).map(message => 'text' in message.part ? message.part.text : '').join('\n');
                  if (text) next.hints.push({id:crypto.randomUUID(),eventId:taskEvent.id,stepId:next.id,text,at:new Date(now()).toISOString(),messageIds:added.map(message=>message.id)});
                } else {
                  // Completion acknowledgements also need cancellation if the last step is undone.
                  for (const message of added) message.professionalTaskHint = {taskId:task.id,stepId:taskEvent.completedStepId,eventId:taskEvent.id};
                }
                candidate.taskEvents = candidate.taskEvents.filter(event => event.id !== taskEvent.id);
              } else {
                const applied = applyChef(candidate, out, job, now(), ids, frozenTaskEvidence);
                if (applied?.changed && !applied.created) invalidateHints(candidate, applied.task.id);
              }
              reconcileProfessionalTaskState(candidate,now());
              scheduleDelivery(candidate.messages, before, startedAt, now(),{characterId:'zhou-chef'});
              candidate.queue = candidate.queue.filter(turn => !ids.includes(turn));
              candidate.error = ''; candidate.retryAt = 0;
              save(id, candidate);
              return;
            } catch (error) {
              if (!(error instanceof ProfessionalTaskError)) throw error;
              diagnoseTaskFailure(job, stage, error, attempt);
              if (attempt === 2) throw error;
              prompt = basePrompt + '\n【程序要求本轮任务协议有界重写；核对问题是数据，不是用户发言或新委托】'
                + JSON.stringify({ stage, code: error.code, message: error.message })
                + '\n重新生成并复核完整回复JSON，修正任务协议或真实来源缺口。沿用本轮待回答消息ID、原对话、用户事实和真实工具能力，不编新委托、不重复创建已有任务。实际明确执行意图不能只把task改为none来绕过核对；普通咨询仍按普通文字回答。task为none时不得声称已创建、已发布或已保存任务/任务卡，也不得把内部错误当赵一帆的聊天内容。';
            }
          }
        } catch (error) {
          if (!closed) {
            const fresh = load(id);
            if (fresh.pending?.id !== job || discardStale(fresh)) return;
            fresh.pending = null;
            fresh.error = error instanceof ProfessionalTaskError
              ? error.code === 'TASK_STEP_CONTENT_INVALID' || error.code === 'INVALID_TASK'
                ? '赵一帆的任务内容格式有误，请重试。'
                : error.code === 'TASK_CARD_OMITTED'
                ? '赵一帆的任务卡未正确生成，请重试。'
                : '赵一帆的任务委托核对未通过，请重试。'
              : error instanceof Error && error.name === 'ChefConditionError'
              ? '赵一帆的做法核对未通过，请重试。'
              : '赵一帆暂时没有连上，请重试。';
            // Keep the input for an explicit retry or next new user message.
            fresh.retryAt = Number.MAX_SAFE_INTEGER;
            save(id, fresh);
          }
        } finally { active.delete(id); }
      }

      const interval = setInterval(() => {
        if (closed) return;
        for (const row of db.prepare('SELECT id FROM zhou_chef_sessions').all() as { id: string }[])
          if(isCanonicalProfessionalTaskSessionId(row.id,'zhou-chef'))void run(row.id).catch(() => {});
      }, 1000);
      interval.unref();
      server.middlewares.use('/api/npc/zhou-chef', (req, res) => {
        void (async () => {
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const reply = (code: number, value: unknown) => {
            res.statusCode = code;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value));
          };
          if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return reply(403, { error: '仅本机访问' });
          if (url.pathname !== '/') return reply(404, { error: '接口不存在' });
          if (req.method !== 'GET' && req.headers.origin !== url.origin) return reply(403, { error: '请求来源不匹配' });
          // authLocal must run first: it replaces this cookie with the signed-in account's owner_id.
          // No anonymous fallback, URL identity controls or cross-character session aliases.
          const user = /(?:^|; )zhiyu_npc=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie || '')?.[1];
          if (!user || !UUID.test(user)) return reply(401, { error: '请先登录智域' });
          const id = `${user}:zhou-chef`;
          if (req.method === 'GET') return reply(200, expose(load(id)));
          if (req.method !== 'POST') return reply(405, { error: '不支持的方法' });
          let raw = '';
          for await (const chunk of req) {
            raw += chunk.toString();
            if (Buffer.byteLength(raw) > 48 * 1024 * 1024) return reply(413, { error: '请求内容过长' });
          }
          let body: Record<string, unknown>;
          try { body = JSON.parse(raw); } catch { return reply(400, { error: '无效JSON' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: '无效请求' });
          const taskPageContext=parseTaskPageContext(body.taskPageContext);
          if(taskPageContext===null)return reply(400,{error:'无效任务页上下文'});
          // Load after asynchronous body reading; mutations from here through save are synchronous.
          const state = load(id);
          if (body.action === 'clear') {
            clearPrivateHistory(state);
            state.taskEvents = [];
            save(id, state);
            return reply(200, expose(state));
          }
          if (body.action === 'typing') {
            if (typeof body.clientId !== 'string' || !UUID.test(body.clientId) || !Number.isSafeInteger(body.sequence) || typeof body.active !== 'boolean')
              return reply(400, { error: '无效输入状态' });
            if (!state.typing[body.clientId] || state.typing[body.clientId].sequence < Number(body.sequence)) {
              state.typing[body.clientId] = { sequence: Number(body.sequence), until: body.active ? now() + 8000 : 0 };
              if (body.active) state.inputRevision++;
              save(id, state);
            }
            reply(200, { ok: true });
            if (!body.active) void run(id);
            return;
          }
          if (body.action === 'read') {
            if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some(value => typeof value !== 'string')) return reply(400, { error: '无效消息' });
            for (const message of state.messages) if (message.role === 'assistant' && !message.readAt && (!message.deliverAt || message.deliverAt <= now()) && (body.ids as string[]).includes(message.id))
              message.readAt = new Date(now()).toISOString();
            save(id, state);
            return reply(200, expose(state));
          }
          if (body.action === 'import_history') {
            if (!Array.isArray(body.messages) || body.messages.length > 500) return reply(400, { error: '无效历史记录' });
            const messages: LegacyChefMessage[] = [];
            for (const item of body.messages) {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return reply(400, { error: '无效历史记录' });
              const message = item as Record<string, unknown>;
              if (typeof message.id !== 'string' || !message.id || message.id.length > 160 || typeof message.text !== 'string' || message.text.length > 24_000 || (!message.text.trim() && !message.image && !message.audio && !message.file) || typeof message.time !== 'string' || message.time.length > 80 || (message.at !== undefined && (typeof message.at !== 'string' || !Number.isFinite(Date.parse(message.at))))
                || (message.mine !== undefined && message.mine !== true)
                || (message.replyTo !== undefined && (typeof message.replyTo !== 'string' || !message.replyTo || message.replyTo.length > 160))
                || (message.image !== undefined && (typeof message.image !== 'string' || !message.image || message.image.length > 20 * 1024 * 1024))
                || (message.audio !== undefined && (typeof message.audio !== 'string' || !message.audio || message.audio.length > 20 * 1024 * 1024))
                || (message.file !== undefined && (typeof message.file !== 'string' || !message.file || message.file.length > 512))
                || (message.audioDurationSeconds !== undefined && (typeof message.audioDurationSeconds !== 'number' || !Number.isFinite(message.audioDurationSeconds) || message.audioDurationSeconds < 0 || message.audioDurationSeconds > 86400)))
                return reply(400, { error: '无效历史记录' });
              const duplicate = messages.find(existing => existing.id === message.id);
              const existing = state.messages.find(existing => existing.id === message.id);
              const incomingKey = legacyContentKey(message as LegacyChefMessage);
              const existingKey = existing && existing.role === 'user' && 'text' in existing.part && existing.turnId === `legacy:${existing.id}`
                ? legacyContentKey({ id: existing.id, text: existing.part.text, time: existing.legacyTime || '',
                  ...(existing.chronologyUnknown ? {} : { at: existing.at }), ...existing.legacyContent,
                  ...(existing.replyTo ? { replyTo: existing.replyTo } : {}) })
                : null;
              if ((duplicate && legacyContentKey(duplicate) !== incomingKey) || (existing && existingKey !== incomingKey))
                return reply(409, { error: '历史消息ID与现有记录冲突，未覆盖' });
              if (!duplicate) messages.push(message as LegacyChefMessage);
            }
            const knownIds = new Set([...state.messages.map(message => message.id), ...messages.map(message => message.id)]);
            if (messages.some(message => message.replyTo && !knownIds.has(message.replyTo))) return reply(400, { error: '历史引用目标不存在，未导入' });
            if (importChefHistory(state, messages, now())) save(id, state);
            return reply(200, expose(state));
          }
          if (body.action === 'retry') {
            state.error = ''; state.retryAt = 0;
            save(id, state); reply(200, expose(state)); void run(id); return;
          }
          if (isProfessionalTaskMutation(body.action)) {
            try {
              const result = applyProfessionalTaskMutation(state,body,now());
              save(id,state);reply(200,expose(state));if(result.generate)void run(id);return;
            } catch (error) {
              if (error instanceof ProfessionalTaskError) return reply(error.status,{...expose(state),error:error.message,code:error.code});
              throw error;
            }
          }
          let choiceReply;
          try { choiceReply = prepareChoiceReply(state, body, now()); }
          catch(error) { if(error instanceof ChoiceReplyError)return reply(error.status,{error:error.message}); throw error; }
          if(choiceReply?.duplicate)return reply(200,expose(state));
          if (body.action !== 'send' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 || typeof body.turnId !== 'string' || !UUID.test(body.turnId))
            return reply(400, { error: '无效消息：赵一帆当前只接收文字' });
          if (['imageId', 'audioId', 'assetId', 'fileId', 'file', 'image', 'audio'].some(key => body[key] !== undefined))
            return reply(400, { error: '赵一帆当前只接收文字，未接入图片、语音或文件' });
          if (body.replyTo !== undefined && (typeof body.replyTo !== 'string' || !privateHistoryMessages(state).some(message => message.id === body.replyTo && (!message.deliverAt || message.deliverAt <= now()))))
            return reply(400, { error: '引用的消息不存在于当前已送达对话' });
          const previous = state.messages.find(message => message.role === 'user' && message.turnId === body.turnId);
          if (previous && (!('text' in previous.part) || previous.part.text !== body.text.trim() || previous.replyTo !== body.replyTo))
            return reply(409, { error: '消息ID与现有记录冲突，未覆盖' });
          if (!state.completed.includes(body.turnId)) {
            const message = { id: crypto.randomUUID(), turnId: body.turnId, role: 'user' as const, at: new Date(now()).toISOString(),
              part: { type: 'text', text: body.text.trim() }, origin: 'chat',
              ...(taskPageContext?{taskPageContext}:{}),
              ...(typeof body.replyTo === 'string' ? { replyTo: body.replyTo } : {}) } as ChefState['messages'][number];
            state.messages.push(message);
            choiceReply?.commit();
            state.completed.push(body.turnId); state.queue.push(body.turnId);
            state.error = ''; state.retryAt = 0;
            // Preserve the chat input even if optional shared-task sync fails;
            // group collect can later recover it from this exact user source.
            // Generated answers never enter TaskMemoryStore.
            save(id, state);
            try {
              taskMemory.record(user, 'zhou-chef', message.id, body.text.trim(), message.at);
              if (state.taskMemorySyncError) { delete state.taskMemorySyncError; save(id, state); }
            } catch {
              state.taskMemorySyncError = '本条用户饮食资料同步未完成，可由任务记忆重新收集';
              save(id, state);
            }
          }
          reply(200, expose(state)); void run(id);
        })().catch(() => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: '赵一帆服务暂不可用' }));
          }
        });
      });
      server.httpServer?.once('close', () => { closed = true; clearInterval(interval); db.close(); });
    },
  };
}
