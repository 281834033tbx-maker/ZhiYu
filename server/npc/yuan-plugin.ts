import {statusFromState} from '../../lib/npc/character-status';
import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import { ensureYuanProactive, yuanProactiveDue, yuanUserActivity, finishYuanProactive, yuanProactivePolicy } from '../../lib/npc/yuan-proactive';
import { deliveryView, scheduleDelivery, presentationPending } from '../../lib/npc/delivery';
import { userPart, partInput, imageInputs } from './media';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createYuan,
  yuanEmotion,
  parseYuan,
  applyYuan,
  type YuanState,
} from '../../lib/npc/yuan-xiaoman';
import { publicRelationshipValues } from '../../lib/npc/relationship-values';
import { codexAvailable, generate } from './codex';
import { yuanPrompt } from './yuan-prompt';
import { contactDecision, contactSchedule, prepareContactTurn, completeContactTurn, assertContactPhoto } from '../../lib/npc/contact-life';
export function yuanLocal(deps?: {
  now?: () => number;
  generate: typeof generate;
  available: typeof codexAvailable;
}): Plugin {
  return {
    name: 'zhiyu-yuan-local',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const now = deps?.now || Date.now;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(
        'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS yuan_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      const save = (id: string, s: YuanState) => {
        s.revision=(s.revision||0)+1;
        db.prepare('INSERT OR REPLACE INTO yuan_sessions VALUES (?,?)').run(id,JSON.stringify(s));
      };
      const load = (id: string): YuanState => {
        const row = db
          .prepare('SELECT data FROM yuan_sessions WHERE id=?')
          .get(id) as { data: string } | undefined;
        if (row) {
          const s = JSON.parse(row.data) as YuanState;
          if (!s.contactLife || s.proactive?.version !== 2) { ensureYuanProactive(s, now()); save(id, s); }
          return s;
        }
        const s = createYuan();
        ensureYuanProactive(s, now());
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
      const typing = (s: YuanState) =>
        Object.values(s.typing).some((v) => v.until > now());
      const expose = (s: YuanState) => ({
        ...deliveryView(privateHistoryMessages(s),presentationPending(s)),
        characterStatus:statusFromState('yuan-xiaoman',s,now()),
        revision: s.revision || 0,
        conversationId: s.branch,
        available: status(),
        debugAllowed: false,
        presence: status() && !contactSchedule(s, now()).sleeping ? 'online' : 'offline',
        moodLabel: yuanEmotion(s, now()) < -1 ? '有点紧张' : '平静',
        relationshipValues: publicRelationshipValues(s.values),
        deliveryError: s.error,
      });
      async function run(id: string) {
        if (closed || active.has(id) || !status()) return;
        const s = load(id);
        const proactive = !s.queue.length;
        if ((s.pending && now() - s.pending.since < 180000) || s.retryAt > now() || typing(s) || (proactive && !yuanProactiveDue(s, now()))) return;
        const contactKind = proactive ? contactDecision(s, now()).kind : null;
        if (contactKind) prepareContactTurn(s, now(), contactKind);
        active.add(id);
        const ids = [...s.queue],
          inputRevision = s.inputRevision,
          job = crypto.randomUUID();
        const incoming = s.messages
          .filter((m) => ids.includes(m.turnId) && m.role === 'user')
          .map((m) => partInput(m.part))
          .join('\n');
        s.pending = { id: job, since: now() };
        if (proactive) ensureYuanProactive(s, now()).lastAttemptAt = now();
        for (const m of s.messages)
          if (ids.includes(m.turnId) && m.role === 'user')
            m.readAt = new Date().toISOString();
        save(id, s);
        try {
          const out = parseYuan(
            await (deps?.generate || generate)(
              root,
              yuanPrompt(root, s, incoming, proactive ? 'proactive' : 'chat', contactKind),
              { requestId: job, images: imageInputs(root,id.split(':')[0],s.messages.slice(-80)) },
            ),
            incoming,
          );
          assertContactPhoto(s, contactKind, out.action, out.parts);
          if (closed) return;
          const fresh = load(id);
          if (fresh.pending?.id !== job) return;
          fresh.pending = null;
          if (
            fresh.inputRevision !== inputRevision ||
            typing(fresh) ||
            fresh.queue.some((q) => !ids.includes(q)) ||
            (proactive && (!yuanProactiveDue(fresh, now()) || contactDecision(fresh, now()).kind !== contactKind))
          ) {
            save(id, fresh);
            return;
          }
          const before=fresh.messages.length;
          if (proactive) { out.memories = []; out.event = undefined; }
          applyYuan(fresh, out, job);
          for (const m of fresh.messages.slice(before)) m.origin = proactive ? 'proactive' : 'chat';
          scheduleDelivery(fresh.messages,before,s.pending!.since,now(),{characterId:'yuan-xiaoman'});
          completeContactTurn(fresh, now(), contactKind, fresh.messages.slice(before), out.event, incoming);
          if (proactive) finishYuanProactive(fresh, now(), fresh.messages.length > before);
          else {
            if (out.action === 'end_conversation') fresh.contactLife!.quietUntil = now() + 2 * 3600000;
            fresh.proactive!.nextAt = fresh.contactLife!.nextAt;
          }
          fresh.queue = fresh.queue.filter((q) => !ids.includes(q));
          fresh.error = '';
          save(id, fresh);
        } catch {
          if (!closed) {
            const fresh = load(id);
            if (fresh.pending?.id !== job) return;
            fresh.pending = null;
            if (proactive) {
              const p = ensureYuanProactive(fresh, now());
              p.lastError = '主动分享生成失败，稍后重试';
              p.nextAt = now() + yuanProactivePolicy.firstDelayMs;
              fresh.contactLife!.nextAt = p.nextAt;
              fresh.contactLife!.lastError = p.lastError;
              save(id, fresh);
              return;
            }
            fresh.error = '袁小满 暂时没有连上，请稍后重试。';
            fresh.retryAt = now() + 15000;
            save(id, fresh);
          }
        } finally {
          active.delete(id);
        }
      }
      const interval = setInterval(() => {
        if (closed) return;
        for (const row of db.prepare('SELECT id FROM yuan_sessions').all() as {
          id: string;
        }[])
          void run(row.id).catch(() => {});
      }, 1000);
      interval.unref();
      server.middlewares.use('/api/npc/yuan-xiaoman', (req, res) => {
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
          const id = `${user}:yuan-xiaoman`;
          if (req.method === 'GET') return reply(200, expose(load(id)));
          if (req.method !== 'POST')
            return reply(405, { error: '不支持的方法' });
          let text = '';
          for await (const chunk of req) {
            text += chunk;
            if (text.length > 12000) return reply(413, { error: '消息过长' });
          }
          const body = JSON.parse(text);
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
                m.readAt = new Date().toISOString();
            save(id, s);
            return reply(200, expose(s));
          }
          let choiceReply;
          try { choiceReply = prepareChoiceReply(s, body, now(), 'yuan-xiaoman'); }
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
              at: new Date().toISOString(),
              part: mediaPart!,
            });
            choiceReply?.commit();
            s.completed.push(body.turnId);
            s.queue.push(body.turnId);
            yuanUserActivity(s, partInput(mediaPart!), now());
            s.error = '';
            s.retryAt = 0;
            save(id, s);
          }
          reply(200, expose(s));
          void run(id);
        })().catch(() => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: '袁小满 服务暂不可用' }));
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
