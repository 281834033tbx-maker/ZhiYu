import { createServer, request as proxyRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Disposable UI fixture: production is only a GET source of App assets.
// All API calls stay on this random loopback origin and its temporary SQLite.
// Authentication is synthetic here; chef authentication has separate real tests.
const runtime = isolatedNpcRuntime();
const { chefLocal } = await runtime.load('server/npc/zhou-chef-plugin');
const account = { id: '9ca7b58d-26d7-4aaf-9bf5-900d62805a61', username: 'ChefUiFixture' };
const owner = '75175a16-34fa-4f45-a3cf-4c117154f13c';
const handlers = [];
const counters = { generationCalls: 0, blockedApiWrites: 0, blockedAssetWrites: 0, apiCounts: {} };
const session = {
  messages: [], pending: false, available: true, presence: 'online', debugAllowed: false,
  revision: 0, deliveryError: '',
};
const archiveRecord = { id: 'chef-fixture-archive-only-A', mine: true, text: '隔离旧留言A：饺子怎么煮？', time: '10:01' };
const localRecord = { id: 'chef-fixture-local-only-B', mine: true, text: '隔离旧留言B：今晚想吃番茄炒蛋。', time: '10:02' };
let closing = false;

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

function routePath(url) {
  let path = new URL(url || '/', 'http://127.0.0.1').pathname;
  for (let pass = 0; pass < 4; pass++) {
    const next = decodeURIComponent(path);
    if (next === path) break;
    path = next;
  }
  return path.replace(/\/+/g, '/');
}

function report() {
  const db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, data FROM zhou_chef_sessions').all();
    const states = rows.map(row => ({ id: row.id, state: JSON.parse(row.data) }));
    return {
      isolated: true, realModel: false, authentication: 'synthetic-fixed-account',
      ...counters, chefRowCount: rows.length,
      chefSessions: states.map(({ id, state }) => ({
        id, messageIds: state.messages.map(message => message.id),
        legacyCount: state.messages.filter(message => message.turnId.startsWith('legacy:')).length,
        userCount: state.messages.filter(message => message.role === 'user').length,
        assistantCount: state.messages.filter(message => message.role === 'assistant').length,
        queueLength: state.queue.length, pending: !!state.pending,
      })),
    };
  } finally { db.close(); }
}

function setup(res, port) {
  const archiveKey = `zhiyu-stitch-desktop-v2:${account.id}`;
  const localKey = `zhiyu-local-character-chat:v1:${account.id}:zhou-chef`;
  const archive = { version: 2, messages: { 'zhou-chef': [archiveRecord] }, posts: [], chatIds: ['liu', 'zhou-chef'], unread: {}, muted: [], hidden: [], accepted: [] };
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>厨师隔离验证准备</title><body><p>正在准备隔离旧留言…</p><script>
    if (location.hostname !== '127.0.0.1' || location.port !== ${JSON.stringify(String(port))}) throw Error('Unexpected fixture origin');
    localStorage.setItem(${JSON.stringify(archiveKey)}, ${JSON.stringify(JSON.stringify(archive))});
    localStorage.setItem(${JSON.stringify(localKey)}, ${JSON.stringify(JSON.stringify([localRecord]))});
    location.replace('/?npc=liu');
  </script></body></html>`);
}

const server = createServer((req, res) => {
  let path;
  try { path = routePath(req.url); }
  catch { req.resume(); return json(res, 400, { error: '无效路径' }); }
  if (path === '/fixture/report' && req.method === 'GET') return json(res, 200, report());
  if (path === '/fixture/setup' && req.method === 'GET') return setup(res, server.address().port);
  if (path.startsWith('/fixture/')) { req.resume(); return json(res, 404, { error: '隔离验证入口不存在' }); }
  // Decoded API paths, slash/case variants, and all API writes are never proxied.
  if (/^\/api(?:\/|$)/i.test(path)) {
    const counter = `${req.method}:${path}`;
    counters.apiCounts[counter] = (counters.apiCounts[counter] || 0) + 1;
    if (path === '/api/auth/session' && req.method === 'GET') return json(res, 200, { authenticated: true, account });
    if (path === '/api/npc/zhou-chef') {
      if (req.headers['x-zhiyu-account'] !== account.id) {
        if (req.method !== 'GET') counters.blockedApiWrites++;
        req.resume(); return json(res, 409, { error: '隔离账号不匹配' });
      }
      req.headers.cookie = `zhiyu_npc=${owner}`;
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      req.url = `/${parsed.search}`;
      return handlers[0](req, res);
    }
    if (req.method !== 'GET') {
      counters.blockedApiWrites++; req.resume();
      return json(res, 403, { error: '该 API 写入在隔离验证中被阻断' });
    }
    if (path === '/api/npc/groups') return json(res, 200, { groups: [] });
    if (path === '/api/npc/moments') return json(res, 200, { items: [] });
    if (['molly', 'chen-nian', 'xia-xia', 'yuan-xiaoman', 'liu', 'he-jiawei'].some(id => path === `/api/npc/${id}`)) return json(res, 200, session);
    return json(res, 404, { error: '隔离验证未提供这个 API' });
  }
  if (req.method !== 'GET') {
    counters.blockedAssetWrites++; req.resume();
    return json(res, 405, { error: '生产资源仅允许 GET' });
  }
  const proxy = proxyRequest({
    hostname: '127.0.0.1', port: 3100, path: req.url, method: 'GET',
    headers: { host: '127.0.0.1:3100', accept: req.headers.accept || '*/*' },
  }, upstream => {
    const { 'set-cookie': _cookies, ...headers } = upstream.headers;
    res.writeHead(upstream.statusCode || 502, headers); upstream.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) json(res, 502, { error: '本机界面服务尚未就绪' });
    else res.end();
  });
  proxy.end();
});

chefLocal({
  available: () => true,
  generate: async () => {
    counters.generationCalls++;
    return { action: 'reply', messages: [{ type: 'text', text: '隔离测试：好的，收到。' }], event: null, memories: [] };
  },
}).configureServer({ config: { root: runtime.root }, httpServer: server, middlewares: { use(path, handler) {
  if (path !== '/api/npc/zhou-chef') throw Error('Unexpected fixture middleware');
  handlers.push(handler);
} } });

function stop() {
  if (closing) return;
  closing = true;
  server.close(() => { runtime.cleanup(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.once('error', () => { server.emit('close'); runtime.cleanup(); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${server.address().port}`, setup: '/fixture/setup', report: '/fixture/report',
  isolated: true, realModel: false,
})));
