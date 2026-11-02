import { createServer, request as proxyRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// The UI assets come from the running App. Authentication and every API route
// remain here, with disposable SQLite data and no NPC/model plugins loaded.
const runtime = isolatedNpcRuntime();
const { authLocal } = await runtime.load('server/npc/auth-plugin');
const accountName = 'MotionFixture';
const accountId = randomUUID();
const ownerId = randomUUID();
const credentialsPath = resolve('output/settings-motion-20261008/temporary-credentials.json');
const authHandlers = [];
const report = { isolated: true, authenticationStatusCodes: {}, apiCounts: {} };
let failNextLogin = false;
let failNextLogout = false;
let ownsCredentials = false;
let closing = false;
const message = {
  id: 'synthetic-settings-font-message', role: 'assistant', at: new Date().toISOString(),
  part: { type: 'text', text: '这是隔离界面的字号示例。今天的训练和饮食可以按自己的节奏安排，先把时间留给最重要的一件事。' },
};
const session = {
  messages: [], pending: false, available: true, presence: 'online', debugAllowed: false,
  revision: 1, conversationId: 'synthetic-settings-session', deliveryError: '',
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function count(name) { report.apiCounts[name] = (report.apiCounts[name] || 0) + 1; }

function syntheticNpc(req, res, path) {
  if (req.method !== 'GET') {
    count('npcWritesBlocked'); req.resume();
    return json(res, 403, { error: '隔离预览不允许 NPC 写入' });
  }
  count('npcReads');
  if (path === '/api/npc/groups') return json(res, 200, { groups: [] });
  if (path === '/api/npc/moments') return json(res, 200, { items: [] });
  if (['molly', 'chen-nian', 'xia-xia', 'yuan-xiaoman', 'liu', 'he-jiawei', 'zhou-chef'].some(npc => path === `/api/npc/${npc}`)) {
    return json(res, 200, path === '/api/npc/chen-nian' ? { ...session, messages: [message] } : session);
  }
  return json(res, 404, { error: '隔离预览中没有这个接口' });
}

function routePath(url) {
  let path = new URL(url || '/', 'http://127.0.0.1').pathname;
  // API paths, including encoded/slash variants, may never reach the real App.
  for (let pass = 0; pass < 4; pass++) {
    const next = decodeURIComponent(path);
    if (next === path) break;
    path = next;
  }
  return path.replace(/\/+/g, '/');
}

const server = createServer((req, res) => {
  let path;
  try { path = routePath(req.url); }
  catch { req.resume(); return json(res, 400, { error: '请求路径无效' }); }
  if (path === '/fixture/report' && req.method === 'GET') return json(res, 200, report);
  if (path === '/fixture/fail-next-login' && req.method === 'GET') {
    failNextLogin = true; return json(res, 200, { ok: true });
  }
  if (path === '/fixture/fail-next-logout' && req.method === 'GET') {
    failNextLogout = true; return json(res, 200, { ok: true });
  }
  if (path.startsWith('/fixture/')) return json(res, 404, { error: '隔离预览中没有这个入口' });
  if (path.startsWith('/api')) {
    if (path.startsWith('/api/auth/')) {
      const known = ['session', 'login', 'register', 'logout'].find(name => path === `/api/auth/${name}`);
      count(known ? `auth:${known}` : 'auth:other');
      res.once('finish', () => {
        const status = String(res.statusCode);
        report.authenticationStatusCodes[status] = (report.authenticationStatusCodes[status] || 0) + 1;
      });
      if (req.method === 'POST' && path === '/api/auth/login' && failNextLogin) {
        failNextLogin = false; req.resume();
        return json(res, 503, { error: '隔离测试：登录服务暂时不可用' });
      }
      if (req.method === 'POST' && path === '/api/auth/logout' && failNextLogout) {
        failNextLogout = false; req.resume();
        return json(res, 503, { error: '隔离测试：退出失败，请重试' });
      }
    }
    // Auth checks real cookies, Origin, scrypt, and rate limits before read-only
    // synthetic NPC responses. Canonical routes are passed only to this fixture.
    req.url = path;
    return authHandlers[0](req, res, () => path.startsWith('/api/npc/')
      ? syntheticNpc(req, res, path)
      : json(res, 404, { error: '隔离预览中没有这个接口' }));
  }
  if (req.method !== 'GET') { req.resume(); return json(res, 405, { error: '只允许 GET 静态资源' }); }
  count('assetReads');
  const proxy = proxyRequest({
    hostname: '127.0.0.1', port: 3100, path: req.url, method: 'GET',
    headers: { host: '127.0.0.1:3100', accept: req.headers.accept || '*/*' },
  }, upstream => {
    res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res);
  });
  proxy.on('error', () => { if (!res.headersSent) json(res, 502, { error: '本机界面服务未就绪' }); else res.end(); });
  proxy.end();
});

function removeTemporaryState() {
  if (ownsCredentials) { try { unlinkSync(credentialsPath); } catch { /* already removed */ } }
  runtime.cleanup();
}

function stop() {
  if (closing) return;
  closing = true;
  server.close(() => { removeTemporaryState(); process.exit(0); });
  server.closeIdleConnections();
}

try {
  authLocal().configureServer({
    config: { root: runtime.root }, httpServer: server,
    middlewares: { use(handler) { authHandlers.push(handler); } },
  });
  const password = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
  const seed = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  seed.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(accountId, accountName, salt, digest, ownerId, Date.now());
  seed.close();
  mkdirSync(join(credentialsPath, '..'), { recursive: true });
  writeFileSync(credentialsPath, JSON.stringify({ username: accountName, password }), { mode: 0o600, flag: 'wx' });
  ownsCredentials = true;
  chmodSync(credentialsPath, 0o600);
} catch {
  server.emit('close');
  removeTemporaryState();
  throw new Error('隔离认证预览初始化失败；检查临时凭证文件是否已存在');
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.once('error', () => { server.emit('close'); removeTemporaryState(); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${server.address().port}`, isolated: true, accountName,
})));
