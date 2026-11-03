import {statusFromState} from '../../lib/npc/character-status';
import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {parseTaskPageContext} from '../../lib/npc/task-page-context';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import { deliveryView, scheduleDelivery, presentationPending } from '../../lib/npc/delivery';
import { userPart, partInput, imageInputs } from './media';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createMolly,
  parseMolly,
  applyMolly,
  type MollyState,
} from '../../lib/npc/molly';
import { codexAvailable, generate, mollySkillVersion } from './codex';
import { mollyPrompt } from './molly-prompt';
import {secretaryFor} from './secretary-plugin';
import type {SecretaryStore} from './secretary-service';
export function mollyLocal(deps?: {
  generate: typeof generate;
  available: typeof codexAvailable;
  secretary?: SecretaryStore;
  now?: () => number;
}): Plugin {
  return {
    name: 'zhiyu-molly-local',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const now = deps?.now || Date.now;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(
        'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS molly_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      const save = (id: string, s: MollyState) => {
        s.revision=(s.revision||0)+1;
        db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES (?,?)').run(id,JSON.stringify(s));
      };
      const load = (id: string): MollyState => {
        const row = db
          .prepare('SELECT data FROM molly_sessions WHERE id=?')
          .get(id) as { data: string } | undefined;
        if (row) return JSON.parse(row.data);
        const s = createMolly();
        save(id, s);
        return s;
      };
      let checked = 0,
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
      const typing = (s: MollyState) =>
        Object.values(s.typing).some((v) => v.until > now());
      const expose = (s: MollyState) => ({
        ...deliveryView(privateHistoryMessages(s),presentationPending(s),now()),
        characterStatus:statusFromState('molly',s,now()),
        revision: s.revision || 0,
        conversationId: s.characterId,
        available: status(),
        debugAllowed: false,
        presence: status() ? 'online' : 'offline',
        deliveryError: s.error,
      });
      async function run(id: string) {
        if (closed || active.has(id) || !status()) return;
        const s = load(id);
        if (!s.queue.length || s.retryAt > now()) return;
        active.add(id);
        const ids = [...s.queue],
          inputRevision = s.inputRevision,
          job = crypto.randomUUID();
        const incoming = s.messages
          .filter((m) => ids.includes(m.turnId) && m.role === 'user')
          .map((m) => partInput(m.part))
          .join('\n');
        s.pending = { id: job, since: now() };
        for (const m of s.messages)
          if (ids.includes(m.turnId) && m.role === 'user')
            m.readAt = new Date(now()).toISOString();
        save(id, s);
        try {
          const secretary=deps?.secretary||secretaryFor(root),owner=id.split(':')[0];
          const out = parseMolly(
            await (deps?.generate || generate)(
              root,
              mollyPrompt(root, s, incoming,secretary?.context(owner)),
              { requestId: job, protocol: 'molly', images: imageInputs(root,id.split(':')[0],s.messages.slice(-80)) },
            ),
            incoming,
            s,
          );
          if (closed) return;
          let fresh = load(id);
          if (fresh.pending?.id !== job) return;
          if (
            fresh.inputRevision !== inputRevision ||
            typing(fresh) ||
            fresh.queue.some((q) => !ids.includes(q))
          ) {
            fresh.pending = null;
            save(id, fresh);
            return;
          }
          let receipt:Awaited<ReturnType<SecretaryStore['execute']>>|undefined;
          if(out.actions?.length){
            if(!secretary)throw Error('秘书服务尚未连接');
            receipt=await secretary.execute(owner,out.actions,fresh);
            // Group creation awaits a real result. Preserve any newer user
            // input instead of saving the pre-await snapshot over it.
            fresh=load(id);
            if(fresh.pending?.id!==job)return;
          }
          fresh.pending = null;
          const before=fresh.messages.length;
          applyMolly(fresh, out, job);
          const last=fresh.messages.at(-1);
          if(last&&receipt){if(receipt.taskLinks.length)last.taskLinks=receipt.taskLinks;if(receipt.groupEvent)last.secretaryEvent=receipt.groupEvent;}
          scheduleDelivery(fresh.messages,before,s.pending!.since,now(),{characterId:'molly'});
          fresh.queue = fresh.queue.filter((q) => !ids.includes(q));
          fresh.error = '';
          save(id, fresh);
        } catch {
          if (!closed) {
            const fresh = load(id);
            if (fresh.pending?.id !== job) return;
            fresh.pending = null;
            fresh.error = 'Molly 暂时没有连上，请稍后重试。';
            fresh.retryAt = now() + 15000;
            save(id, fresh);
          }
        } finally {
          active.delete(id);
        }
      }
      const interval = setInterval(() => {
        if (closed) return;
        for (const row of db.prepare('SELECT id FROM molly_sessions').all() as {
          id: string;
        }[])
          void run(row.id).catch(() => {});
      }, 1000);
      interval.unref();
      server.middlewares.use('/api/npc/molly', (req, res) => {
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
          // Local operator check: prove which backend bundle is running without
          // creating an identity/session or sending any production chat.
          if (req.method === 'GET' && url.searchParams.get('runtime') === '1')
            return reply(200, {
              characterId: 'molly-system-secretary',
              dialogueVersion: mollySkillVersion,
              noMatchDelivery: 'preserve-reviewed-text',
              knowledgeInput: 'scoped-data',
            });
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
          const id = `${user}:molly-system-secretary`;
          if (req.method === 'GET') return reply(200, expose(load(id)));
          if (req.method !== 'POST')
            return reply(405, { error: '不支持的方法' });
          let text = '';
          for await (const chunk of req) {
            text += chunk;
            if (text.length > 12000) return reply(413, { error: '消息过长' });
          }
          const body = JSON.parse(text);
          if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'无效请求'});
          const taskPageContext=parseTaskPageContext(body.taskPageContext);
          if(taskPageContext===null)return reply(400,{error:'无效任务页上下文'});
          // Read only after the asynchronous request body is complete. From here
          // through save there is no await, so concurrent mutations cannot use stale state.
          const s = load(id);
          if (body.action === 'clear') {
            clearPrivateHistory(s);
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
              s.typing[body.clientId].sequence < body.sequence
            ) {
              s.typing[body.clientId] = {
                sequence: body.sequence,
                until: body.active ? now() + 8000 : 0,
              };
              if (body.active) s.inputRevision++;
              save(id, s);
            }
            return reply(200, { ok: true });
          }
          if (body.action === 'read') {
            if (!Array.isArray(body.ids) || body.ids.length > 100)
              return reply(400, { error: '无效消息' });
            for (const m of s.messages)
              if (
                m.role === 'assistant' &&
                !m.readAt && (!m.deliverAt || m.deliverAt<=now()) &&
                body.ids.includes(m.id)
              )
                m.readAt = new Date(now()).toISOString();
            save(id, s);
            return reply(200, expose(s));
          }
          let choiceReply;
          try { choiceReply = prepareChoiceReply(s, body, now()); }
          catch(error) { if(error instanceof ChoiceReplyError)return reply(error.status,{error:error.message}); throw error; }
          if(choiceReply?.duplicate)return reply(200,expose(s));
          const mediaPart = userPart(root, user, body);
          if (
            body.action !== 'send' ||
            !mediaPart ||
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
              part: mediaPart!,
              ...(taskPageContext?{taskPageContext}:{}),
            });
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
            res.end(JSON.stringify({ error: 'Molly 服务暂不可用' }));
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
