import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyHe, createHe, importHeHistory, parseHe, type HeState, type LegacyHeMessage } from '../../lib/npc/he-jiawei';
import { deliveryView, scheduleDelivery } from '../../lib/npc/delivery';
import { publicRelationshipValues } from '../../lib/npc/relationship-values';
import { codexAvailable, generate } from './codex';
import { hePrompt } from './he-prompt';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function heLocal(deps?: { now?: () => number; generate: typeof generate; available: typeof codexAvailable }): Plugin {
  return {
    name: 'zhiyu-he-local', apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const now = deps?.now || Date.now;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS he_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
      const save = (id: string, state: HeState) => {
        state.revision++;
        db.prepare('INSERT OR REPLACE INTO he_sessions VALUES (?,?)').run(id, JSON.stringify(state));
      };
      const load = (id: string): HeState => {
        const row = db.prepare('SELECT data FROM he_sessions WHERE id=?').get(id) as { data: string } | undefined;
        if (row) return JSON.parse(row.data) as HeState;
        const state = createHe();
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
      const typing = (state: HeState) => Object.values(state.typing).some(client => client.until > now());
      const expose = (state: HeState) => ({
        ...deliveryView(privateHistoryMessages(state), state.pending, now()),
        revision: state.revision, conversationId: state.branch,
        pending: (!!state.pending && now() - state.pending.since < 180_000) || privateHistoryMessages(state).some(message => (message.deliverAt || 0) > now()) || (!!state.queue.length && !state.error && status()),
        available: status(), debugAllowed: false,
        presence: !status() ? 'offline' : state.pending || state.queue.length ? 'busy' : 'online',
        deliveryError: state.error, relationship: state.relationship,
        relationshipValues: publicRelationshipValues(state.values),
      });

      async function run(id: string) {
        if (closed || active.has(id) || !status()) return;
        const state = load(id);
        if (!state.queue.length || state.retryAt > now() || typing(state) || privateHistoryMessages(state).some(message => (message.deliverAt || 0) > now())) return;
        active.add(id);
        const ids = [...state.queue], inputRevision = state.inputRevision, job = crypto.randomUUID();
        const incoming = state.messages.filter(message => ids.includes(message.turnId) && message.role === 'user')
          .map(message => 'text' in message.part ? message.part.text : '').join('\n');
        const startedAt = now();
        state.pending = { id: job, since: startedAt };
        for (const message of state.messages) if (ids.includes(message.turnId) && message.role === 'user') message.readAt = new Date(now()).toISOString();
        save(id, state);
        try {
          const out = parseHe(await (deps?.generate || generate)(root, hePrompt(root, state, incoming, now()), { characterId: 'he-jiawei', requestId: job }), incoming);
          if (closed) return;
          const fresh = load(id);
          if (fresh.pending?.id !== job) return;
          fresh.pending = null;
          // A stale draft never contributes messages, memories or scores.
          if (fresh.inputRevision !== inputRevision || typing(fresh) || fresh.queue.some(turn => !ids.includes(turn))) {
            save(id, fresh);
            return;
          }
          const before = fresh.messages.length;
          applyHe(fresh, out, job, now());
          scheduleDelivery(fresh.messages, before, startedAt, now());
          fresh.queue = fresh.queue.filter(turn => !ids.includes(turn));
          fresh.error = ''; fresh.retryAt = 0;
          save(id, fresh);
        } catch {
          if (!closed) {
            const fresh = load(id);
            if (fresh.pending?.id !== job) return;
            fresh.pending = null;
            fresh.error = '何嘉伟暂时没有连上，请重试。';
            // Keep the input for an explicit retry or next new user message.
            fresh.retryAt = Number.MAX_SAFE_INTEGER;
            save(id, fresh);
          }
        } finally { active.delete(id); }
      }

      const interval = setInterval(() => {
        if (closed) return;
        for (const row of db.prepare('SELECT id FROM he_sessions').all() as { id: string }[]) void run(row.id).catch(() => {});
      }, 1000);
      interval.unref();
      server.middlewares.use('/api/npc/he-jiawei', (req, res) => {
        void (async () => {
          const url = new URL(req.url || '/', `http://${req.headers.host}`);
          const reply = (code: number, value: unknown) => {
            res.statusCode = code;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value));
          };
          if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return reply(403, { error: '仅本机访问' });
          if (req.method !== 'GET' && req.headers.origin !== url.origin) return reply(403, { error: '请求来源不匹配' });
          // authLocal must run first: it replaces this cookie with the signed-in account's owner_id.
          // No anonymous fallback, URL identity controls or cross-character session aliases.
          const user = /(?:^|; )zhiyu_npc=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie || '')?.[1];
          if (!user || !UUID.test(user)) return reply(401, { error: '请先登录智域' });
          const id = `${user}:he-jiawei`;
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
          // Load after asynchronous body reading; mutations from here through save are synchronous.
          const state = load(id);
          if (body.action === 'clear') {
            clearPrivateHistory(state);
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
            const messages: LegacyHeMessage[] = [];
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
              if ((duplicate && duplicate.text !== message.text) || (existing && (existing.role !== 'user' || !('text' in existing.part) || existing.part.text !== message.text)))
                return reply(409, { error: '历史消息ID与现有记录冲突，未覆盖' });
              if (!duplicate) messages.push(message as LegacyHeMessage);
            }
            const knownIds = new Set([...state.messages.map(message => message.id), ...messages.map(message => message.id)]);
            if (messages.some(message => message.replyTo && !knownIds.has(message.replyTo))) return reply(400, { error: '历史引用目标不存在，未导入' });
            if (importHeHistory(state, messages, now())) save(id, state);
            return reply(200, expose(state));
          }
          if (body.action === 'retry') {
            state.error = ''; state.retryAt = 0;
            save(id, state); reply(200, expose(state)); void run(id); return;
          }
          let choiceReply;
          try { choiceReply = prepareChoiceReply(state, body, now(), 'he-jiawei'); }
          catch(error) { if(error instanceof ChoiceReplyError)return reply(error.status,{error:error.message}); throw error; }
          if(choiceReply?.duplicate)return reply(200,expose(state));
          if (body.action !== 'send' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000 || typeof body.turnId !== 'string' || !UUID.test(body.turnId))
            return reply(400, { error: '无效消息：何嘉伟当前只接收文字' });
          if (body.imageId !== undefined || body.audioId !== undefined || body.assetId !== undefined) return reply(400, { error: '何嘉伟当前只接收文字，未接入图片或语音' });
          if (body.replyTo !== undefined && (typeof body.replyTo !== 'string' || !state.messages.some(message => message.id === body.replyTo && (!message.deliverAt || message.deliverAt <= now()))))
            return reply(400, { error: '引用的消息不存在于当前已送达对话' });
          if (!state.completed.includes(body.turnId)) {
            state.messages.push({ id: crypto.randomUUID(), turnId: body.turnId, role: 'user', at: new Date(now()).toISOString(),
              part: { type: 'text', text: body.text.trim() }, origin: 'chat',
              ...(typeof body.replyTo === 'string' ? { replyTo: body.replyTo } : {}) });
            choiceReply?.commit();
            state.completed.push(body.turnId); state.queue.push(body.turnId);
            state.error = ''; state.retryAt = 0;
            save(id, state);
          }
          reply(200, expose(state)); void run(id);
        })().catch(() => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: '何嘉伟服务暂不可用' }));
          }
        });
      });
      server.httpServer?.once('close', () => { closed = true; clearInterval(interval); db.close(); });
    },
  };
}
