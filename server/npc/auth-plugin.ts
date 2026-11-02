import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Plugin } from 'vite';
import {readTaskCalendar, TASK_CALENDAR_CHARACTERS} from './task-calendar-reader';

const COOKIE = 'zhiyu_auth';
const SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;
const USERNAME = /^[A-Za-z][A-Za-z0-9._-]{5,31}$/;
const LEGACY_OWNER = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

type Account = { id: string; username: string; owner_id: string; created_at?: number };
type SessionRow = Account & { expires_at: number };
type Credentials = { username?: unknown; password?: unknown; confirmPassword?: unknown };

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cookieValue(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setSessionCookie(res: ServerResponse, token: string) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE_SECONDS}`);
}

function clearSessionCookie(res: ServerResponse) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Credentials> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('请发送 JSON 数据');
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString();
    if (text.length > 4096) throw new Error('请求内容过长');
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Credentials;
}

function validOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname) && url.host === req.headers.host;
  } catch {
    return false;
  }
}

function passwordDigest(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
}

function equalDigest(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authLocal(): Plugin {
  return {
    name: 'zhiyu-local-auth',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      mkdirSync(join(root, '.npc-runtime'), { recursive: true });
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS zhiyu_accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_salt TEXT NOT NULL,
          password_digest TEXT NOT NULL,
          owner_id TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS zhiyu_auth_sessions (
          token_digest TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES zhiyu_accounts(id),
          expires_at INTEGER NOT NULL
        );`);
      const attempts = new Map<string, { count: number; until: number }>();
      const accountFor = (req: IncomingMessage): Account | null => {
        const token = cookieValue(req, COOKIE);
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        const row = db.prepare(`SELECT a.id, a.username, a.owner_id, a.created_at, s.expires_at
          FROM zhiyu_auth_sessions s JOIN zhiyu_accounts a ON a.id=s.account_id
          WHERE s.token_digest=?`).get(hash(token)) as SessionRow | undefined;
        return row && row.expires_at > Date.now() ? row : null;
      };
      const issueSession = (req: IncomingMessage, res: ServerResponse, account: Account, claimedLegacy = false) => {
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(hash(token), account.id, Date.now() + SESSION_AGE_SECONDS * 1000);
        setSessionCookie(res, token);
        send(res, 200, { authenticated: true, account: { id: account.id, username: account.username }, claimedLegacy });
      };

      // This middleware must be registered before every NPC plugin. The browser's
      // old zhiyu_npc cookie is ignored; the authenticated account owns the ID.
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        if (!path.startsWith('/api/auth/') && !path.startsWith('/api/npc/')) return next();
        const host = (req.headers.host || '').split(':')[0];
        if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: '仅允许本机访问' });

        if (path.startsWith('/api/npc/')) {
          const account = accountFor(req);
          if (!account) return send(res, 401, { error: '请先登录智域' });
          if (path === '/api/npc/task-calendar') {
            if (req.headers['x-zhiyu-account'] !== account.id) return send(res, 409, {error: '账号已变化，请重新打开任务日历'});
            if (req.method !== 'GET') return send(res, 405, {error: '任务日历仅支持查看'});
            const characterId = new URL(req.url!, 'http://localhost').searchParams.get('npc') || '';
            if (!TASK_CALENDAR_CHARACTERS.has(characterId)) return send(res, 400, {error: '请选择已有的人物'});
            try {return send(res, 200, {accountId: account.id, characterId, ...readTaskCalendar(db, account, characterId)});}
            catch {return send(res, 500, {error: '任务记录暂时无法读取，请稍后刷新'});}
          }
          const isGroupRequest = path === '/api/npc/groups' || path.startsWith('/api/npc/groups/');
          const isChefRequest = path === '/api/npc/zhou-chef' || path.startsWith('/api/npc/zhou-chef/');
          const isChenRequest = path === '/api/npc/chen-nian' || path.startsWith('/api/npc/chen-nian/');
          const isSecretaryRequest = path === '/api/npc/secretary' || path.startsWith('/api/npc/secretary/');
          const isLiuRequest = path === '/api/npc/liu' || path.startsWith('/api/npc/liu/');
          if ((path === '/api/npc/he-jiawei' || isChefRequest || isChenRequest || isGroupRequest || isSecretaryRequest || isLiuRequest) && req.headers['x-zhiyu-account'] !== account.id)
            return send(res, 409, { error: isGroupRequest ? '账号已变化，请重新打开群聊' : isChefRequest ? '账号已变化，请重新打开赵一帆的聊天' : isChenRequest ? '账号已变化，请重新打开陈年的聊天' : isLiuRequest ? '账号已变化，请重新打开柳智敏的聊天' : isSecretaryRequest ? '账号已变化，请重新打开任务提醒设置' : '账号已变化，请重新打开何嘉伟的聊天' });
          const otherCookies = (req.headers.cookie || '').split(';').map(v => v.trim())
            .filter(v => v && !v.startsWith('zhiyu_npc=')).join('; ');
          req.headers.cookie = `${otherCookies}${otherCookies ? '; ' : ''}zhiyu_npc=${account.owner_id}`;
          return next();
        }

        if (path === '/api/auth/session' && req.method === 'GET') {
          const account = accountFor(req);
          return send(res, 200, account
            ? { authenticated: true, account: { id: account.id, username: account.username }, claimedLegacy: account.owner_id === process.env.ZHIYU_NPC_ID }
            : { authenticated: false });
        }
        if (req.method !== 'POST' || !validOrigin(req)) return send(res, 403, { error: '请求来源无效' });
        if (path === '/api/auth/logout') {
          const token = cookieValue(req, COOKIE);
          if (token) db.prepare('DELETE FROM zhiyu_auth_sessions WHERE token_digest=?').run(hash(token));
          clearSessionCookie(res);
          return send(res, 200, { authenticated: false });
        }
        if (path !== '/api/auth/register' && path !== '/api/auth/login') return send(res, 404, { error: '接口不存在' });

        void (async () => {
          let body: Credentials;
          try { body = await readBody(req); }
          catch { return send(res, 400, { error: '请求内容无效' }); }
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          const password = typeof body.password === 'string' ? body.password : '';
          if (!USERNAME.test(username)) return send(res, 400, { error: '账号须以字母开头，包含 6-32 位字母、数字、点、下划线或短横线' });
          if (path === '/api/auth/register') {
            if (password.length < 12 || Buffer.byteLength(password) > 512) return send(res, 400, { error: '密码至少 12 位，且不能过长' });
            if (password !== body.confirmPassword) return send(res, 400, { error: '两次输入的密码不一致' });
            const salt = randomBytes(16).toString('hex');
            const digest = passwordDigest(password, salt);
            try {
              db.exec('BEGIN IMMEDIATE');
              if (db.prepare('SELECT id FROM zhiyu_accounts WHERE username=?').get(username)) {
                db.exec('ROLLBACK');
                return send(res, 409, { error: '这个账号名已被使用' });
              }
              const isFirst = !(db.prepare('SELECT id FROM zhiyu_accounts LIMIT 1').get());
              const legacy = process.env.ZHIYU_NPC_ID;
              const claimedLegacy = !!(isFirst && legacy && LEGACY_OWNER.test(legacy));
              const account: Account = { id: randomUUID(), username, owner_id: claimedLegacy ? legacy! : randomUUID() };
              db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(account.id, username, salt, digest, account.owner_id, Date.now());
              db.exec('COMMIT');
              return issueSession(req, res, account, claimedLegacy);
            } catch {
              try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
              return send(res, 500, { error: '注册未完成，请稍后重试' });
            }
          }

          const key = `${req.socket.remoteAddress || 'local'}:${username.toLowerCase()}`;
          const limit = attempts.get(key);
          if (limit && limit.until > Date.now() && limit.count >= 5) return send(res, 429, { error: '尝试次数过多，请稍后再试' });
          const row = db.prepare('SELECT id,username,owner_id,password_salt,password_digest FROM zhiyu_accounts WHERE username=?').get(username) as (Account & { password_salt: string; password_digest: string }) | undefined;
          const candidate = passwordDigest(password, row?.password_salt || '00000000000000000000000000000000');
          if (!row || !equalDigest(candidate, row.password_digest)) {
            const prior = limit?.until && limit.until > Date.now() ? limit.count : 0;
            attempts.set(key, { count: prior + 1, until: Date.now() + 15 * 60 * 1000 });
            return send(res, 401, { error: '账号或密码不正确' });
          }
          attempts.delete(key);
          return issueSession(req, res, row);
        })().catch(() => send(res, 500, { error: '登录服务暂时不可用' }));
      });
      server.httpServer?.once('close', () => db.close());
    },
  };
}
