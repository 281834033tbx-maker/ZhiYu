import {ChoiceReplyError, prepareChoiceReply} from './choice-reply';
import {clearPrivateHistory, privateHistoryMessages} from './private-history';
import { deliveryView } from '../../lib/npc/delivery';
import { userPart, partInput } from './media';
import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createState,
  control,
  finishTurn,
  parseOutput,
} from '../../lib/npc/engine';
import type { NpcState } from '../../lib/npc/contracts';
import { publicRelationshipValues } from '../../lib/npc/relationship-values';
import { buildPrompt } from './prompt';
import { codexAvailable, generate } from './codex';
import {textProvider} from './deepseek';
import { ensureLife, enqueue, presence, shortenLegacyWorkWait } from '../../lib/npc/life';
import { runScheduledTurn } from './scheduler';

const loopback = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export function npcLocal(testDependencies?: {
  generate: typeof generate;
  available: typeof codexAvailable;
}): Plugin {
  return {
    name: 'zhiyu-npc-local',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(
        'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)',
      );
      const load = (id: string, mode: 'normal' | 'test') => {
        const initial = createState(mode);
        if (mode === 'normal') ensureLife(initial, Date.now());
        db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?,?)').run(
          id,
          0,
          JSON.stringify(initial),
        );
        return JSON.parse(
          (
            db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as {
              data: string;
            }
          ).data,
        ) as NpcState;
      };
      const save = (id: string, state: NpcState, expected: number) => {
        state.revision = expected + 1;
        const result = db
          .prepare(
            'UPDATE sessions SET revision=?, data=? WHERE id=? AND revision=?',
          )
          .run(state.revision, JSON.stringify(state), id, expected);
        if (!result.changes) throw new Error('状态已发生变化，请刷新后重试');
      };
      const migrationNow = Date.now();
      for (const row of db.prepare("SELECT id,data FROM sessions WHERE id LIKE '%:xia-xia:normal'").all() as {id:string;data:string}[]) {
        const state = JSON.parse(row.data) as NpcState;
        const needsContact = !state.contactLife;
        if (needsContact) ensureLife(state, migrationNow);
        const shortened = shortenLegacyWorkWait(state, migrationNow);
        if (shortened || needsContact) save(row.id, state, state.revision);
      }
      let available = false,
        checkedAt = 0;
      const status = () => {
        if (Date.now() - checkedAt > 30000) {
          available = (testDependencies?.available || codexAvailable)();
          checkedAt = Date.now();
        }
        return available;
      };
      let ticking = false,
        closed = false;
      const tick = async () => {
        if (ticking || closed || !status()) return;
        ticking = true;
        try {
          const rows = db
            .prepare("SELECT id FROM sessions WHERE id LIKE '%:xia-xia:normal'")
            .all() as { id: string }[];
          for (const { id } of rows) {
            if (closed) break;
            await runScheduledTurn(
              {
                root,
                load: (key) => load(key, 'normal'),
                save,
                generate: testDependencies?.generate || generate,
              },
              id,
            );
          }
        } finally {
          ticking = false;
        }
      };
      const interval = testDependencies
        ? null
        : setInterval(() => {
            void tick().catch(() => {});
          }, 1000);
      interval?.unref();
      server.middlewares.use(
        '/api/npc/xia-xia',
        (req: IncomingMessage, res: ServerResponse) => {
          void (async () => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            const reply = (code: number, data: unknown) => {
              res.statusCode = code;
              res.end(JSON.stringify(data));
            };
            // Local developer runtime only. No CORS; verify Origin on mutations to prevent drive-by requests.
            if (!loopback(url.hostname))
              return reply(403, { error: 'Codex NPC 测试服务只允许本机访问' });
            if (req.method !== 'GET' && req.headers.origin !== url.origin)
              return reply(403, { error: '请求来源不匹配' });
            const mode =
              url.searchParams.get('mode') === 'test' ? 'test' : 'normal';
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
            const id = `${user}:xia-xia:${mode}`;
            const expose = (s: NpcState) => ({
              ...deliveryView(privateHistoryMessages(s),s.pending),
              revision: s.revision,
              conversationId: s.branch,
              available: status(),
              presence: presence(s, Date.now(), status()),
              relationshipValues: publicRelationshipValues(s.values),
              debugAllowed: true,
              deliveryError: s.life?.lastError || '',
              ...(mode === 'test' ? { debug: s } : {}),
            });
            let state = load(id, mode);
            try {
              if (req.method === 'GET') return reply(200, expose(state));
              if (req.method !== 'POST')
                return reply(405, { error: '不支持的方法' });
              let text = '';
              for await (const chunk of req) {
                text += chunk;
                if (text.length > 12000)
                  return reply(413, { error: '消息过长' });
              }
              const body = JSON.parse(text) as Record<string, unknown>;
              state = load(id, mode);
              if (!body || typeof body !== 'object' || Array.isArray(body))
                return reply(400, { error: '无效请求' });
              if (body.action === 'clear') {
                clearPrivateHistory(state);
                save(id, state, state.revision);
                return reply(200, expose(state));
              }
              if (mode === 'normal' && body.action === 'typing') {
                if (
                  typeof body.clientId !== 'string' ||
                  !/^[a-f0-9-]{36}$/.test(body.clientId) ||
                  typeof body.active !== 'boolean' ||
                  !Number.isSafeInteger(body.sequence)
                )
                  return reply(400, { error: '无效输入状态' });
                const life = ensureLife(state, Date.now());
                const clients = (life.typingClients ??= {});
                const previous = clients[body.clientId];
                if (!previous || Number(body.sequence) > previous.sequence) {
                  clients[body.clientId] = {
                    until: body.active ? Date.now() + 8000 : 0,
                    sequence: Number(body.sequence),
                  };
                  if (body.active)
                    life.inputRevision = (life.inputRevision || 0) + 1;
                  // Bound abandoned tabs while retaining recent sequence tombstones.
                  for (const [key, value] of Object.entries(clients))
                    if (
                      key !== body.clientId &&
                      value.until &&
                      value.until < Date.now() - 60000
                    )
                      delete clients[key];
                  save(id, state, state.revision);
                }
                return reply(200, { ok: true });
              }
              if (mode === 'normal' && body.action === 'read') {
                if (
                  !Array.isArray(body.ids) ||
                  body.ids.length > 100 ||
                  body.ids.some((v) => typeof v !== 'string')
                )
                  return reply(400, { error: '无效已读消息' });
                let changed = false;
                for (const message of state.messages)
                  if (
                    message.role === 'assistant' &&
                    !message.readAt && (!message.deliverAt || message.deliverAt<=Date.now()) &&
                    body.ids.includes(message.id)
                  ) {
                    message.readAt = new Date().toISOString();
                    changed = true;
                  }
                if (changed) save(id, state, state.revision);
                return reply(200, expose(state));
              }
              if (
                mode === 'normal' &&
                (body.action === 'send' || body.action === 'call')
              ) {
                const isCall = body.action === 'call';
                if (
                  typeof body.turnId !== 'string' ||
                  !/^[a-f0-9-]{36}$/.test(body.turnId)
                )
                  return reply(400, { error: '无效消息编号' });
                if (isCall && !['voice', 'video'].includes(String(body.kind)))
                  return reply(400, { error: '无效通话类型' });
                let choiceReply;
                try { choiceReply = prepareChoiceReply(state, body, Date.now(), 'xia-xia'); }
                catch(error) { if(error instanceof ChoiceReplyError)return reply(error.status,{error:error.message}); throw error; }
                if(choiceReply?.duplicate)return reply(200,expose(state));
                const mediaPart = isCall ? null : userPart(root, user, body);
                const incoming = isCall
                  ? body.kind === 'video'
                    ? '📹 发起视频通话请求'
                    : '📞 发起语音通话请求'
                  : mediaPart ? partInput(mediaPart) : null;
                if (
                  typeof incoming !== 'string' ||
                  !incoming.trim() ||
                  incoming.length > 4000
                )
                  return reply(400, { error: '无效消息' });
                if(body.replyTo !== undefined && (typeof body.replyTo !== 'string' || !state.messages.some(m=>m.id===body.replyTo))) return reply(400,{error:'引用的消息不存在于当前对话'});
                if (state.completed.includes(body.turnId))
                  return reply(200, expose(state));
                const rev = state.revision,
                  pending = state.pending;
                finishTurn(state, body.turnId, incoming, {
                  parts: [],
                  memories: [],
                  event: undefined,
                  action: 'silent',
                });
                state.pending = pending;
                if(mediaPart)state.messages[state.messages.length-1].part=mediaPart;
                if(typeof body.replyTo==='string')state.messages[state.messages.length-1].replyTo=body.replyTo;
                if (isCall)
                  state.messages[state.messages.length - 1].origin = 'call';
                ensureLife(state, Date.now());
                enqueue(
                  state,
                  body.turnId,
                  Date.now(),
                  incoming,
                  isCall ? (body.kind as 'voice' | 'video') : undefined,
                );
                choiceReply?.commit();
                save(id, state, rev);
                reply(200, expose(state));
                if (!testDependencies)
                  setTimeout(() => {
                    void tick().catch(() => {});
                  }, 50).unref();
                return;
              }
              if (body.action !== 'send') {
                if (mode !== 'test')
                  return reply(403, { error: '普通会话没有调试权限' });
                const rev = state.revision;
                state = control(state, body);
                save(id, state, rev);
                return reply(200, expose(state));
              }
              if (
                typeof body.text !== 'string' ||
                !body.text.trim() ||
                body.text.length > 4000 ||
                typeof body.turnId !== 'string' ||
                !/^[a-f0-9-]{36}$/.test(body.turnId)
              )
                return reply(400, { error: '无效消息' });
              if (state.completed.includes(body.turnId))
                return reply(200, expose(state));
              if (state.paused)
                return reply(409, { error: '测试已暂停，请用调试面板恢复' });
              if (state.pending && Date.now() - state.pending.since < 180000)
                return reply(409, { error: '上一轮仍在回复，请稍候' });
              if (!status())
                return reply(503, {
                  error: textProvider()==='deepseek'?'DeepSeek 密钥尚未配置，请填写 DEEPSEEK_API_KEY 并重启程序':'Codex 尚未登录，请在终端执行 codex login',
                });
              const rev = state.revision;
              if (state.cooldownUntil > Date.now()) {
                finishTurn(state, body.turnId, body.text, {
                  parts: [],
                  memories: [],
                  event: undefined,
                  action: 'silent',
                });
                save(id, state, rev);
                return reply(200, expose(state));
              }
              if (state.interaction === 'cooldown') {
                state.interaction = 'ready';
                state.cooldownUntil = 0;
              }
              state.pending = { id: body.turnId, since: Date.now() };
              save(id, state, rev);
              const locked = state.revision,
                branch = state.branch;
              try {
                const output = parseOutput(
                  await (testDependencies?.generate || generate)(
                    root,
                    buildPrompt(root, state, body.text),
                    { requestId: body.turnId },
                  ),
                  body.text,
                );
                const fresh = load(id, mode);
                if (
                  fresh.revision !== locked ||
                  fresh.branch !== branch ||
                  fresh.paused
                )
                  return reply(409, {
                    error: '本轮已被调试操作取消，未写入回复',
                  });
                finishTurn(fresh, body.turnId, body.text, output);
                save(id, fresh, locked);
                return reply(200, expose(fresh));
              } catch (error) {
                const fresh = load(id, mode);
                if (fresh.revision === locked) {
                  fresh.pending = null;
                  save(id, fresh, locked);
                }
                throw error;
              }
            } catch (error) {
              reply(400, {
                error: error instanceof Error ? error.message : '请求失败',
              });
            }
          })().catch(() => {
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: '本地 NPC 服务异常' }));
            }
          });
        },
      );
      server.httpServer?.once('close', () => {
        closed = true;
        if (interval) clearInterval(interval);
        db.close();
      });
    },
  };
}
