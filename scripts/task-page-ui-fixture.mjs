import {createServer, request as proxyRequest} from 'node:http';

// A read-only UI fixture. No NPC/auth plugins, databases, credentials, or models
// are loaded. The real App supplies GET UI assets only; every API stays here.
const accounts = {
  a: {id: 'task-ui-fixture-account-a', username: '任务预览 A'},
  b: {id: 'task-ui-fixture-account-b', username: '任务预览 B'},
};
const dayParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(Date.now());
const part = type => dayParts.find(item => item.type === type)?.value;
const today = `${part('year')}-${part('month')}-${part('day')}`;
const addDays = (date, offset) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const dates = Array.from({length: 9}, (_, index) => addDays(today, index - 7));
const createdAt = new Date(`${dates[0]}T08:00:00+08:00`).toISOString();
const updatedAt = new Date(`${today}T08:30:00+08:00`).toISOString();
const session = {
  messages: [], pending: null, available: true, presence: 'online',
  debugAllowed: false, revision: 1, deliveryError: '',
};
const counters = {
  apiCounts: {}, assetReads: 0, blockedRealWrites: 0, blockedAssetWrites: 0,
  actualRealWrites: 0, modelCalls: 0, realApiReads: 0,
};
const activeProxies = new Set();
let closing = false;

// Opt-in optics proof only on this synthetic origin; production CSS is not
// patched. The toggle keeps blur identical so A/B reveals SVG displacement.
const liquidOpticsProof = `<style>
html .zy-desktop-stage{background:repeating-conic-gradient(#b3bdc7 0% 25%,#e7edf2 0% 50%) -12px -12px/48px 48px!important}
html[data-liquid-optics='off'] .zy-liquid-base-plate__warp{filter:none!important;backdrop-filter:blur(6px) saturate(100%)!important;-webkit-backdrop-filter:blur(6px) saturate(100%)!important}
html[data-liquid-optics='invert'] .zy-liquid-base-plate__warp{filter:none!important;backdrop-filter:invert(1)!important;-webkit-backdrop-filter:invert(1)!important}
#liquid-optics-toggle{position:fixed;z-index:10000;top:82px;right:18px;padding:8px 12px;border:1px solid #999;border-radius:8px;background:white;color:#222;font:12px system-ui}
</style><script>document.addEventListener('DOMContentLoaded',()=>{const button=document.createElement('button');button.id='liquid-optics-toggle';button.textContent='关闭折射（A/B）';button.addEventListener('click',()=>{const off=document.documentElement.dataset.liquidOptics!=='off';document.documentElement.dataset.liquidOptics=off?'off':'on';button.textContent=off?'开启折射（A/B）':'关闭折射（A/B）';});document.body.append(button);});</script>`;

function syntheticGroups(key) {
  const prefix = `group-task-fixture-${key}`;
  const members = [
    {id: 'user', name: accounts[key].username, role: 'user', order: 0},
    {id: 'molly', name: 'Molly', avatar: '/stitch/molly-avatar-v2.png', role: 'admin', order: 1},
    {id: 'chen-nian', name: '陈年', avatar: '/npc/chen-nian/avatar-20260926.png', role: 'npc', order: 2},
    {id: 'zhou-chef', name: '赵一帆', avatar: '/desktop-npc/scenes/zhou-chef-night-sofa-20261005-v1.png', role: 'npc', order: 3},
  ].map(member => ({...member, joinedAt: createdAt}));
  const base = {
    goal: '隔离测试：每日饮食任务', sourceCharacterId: 'molly',
    createdAt, updatedAt, createdBy: 'molly', chatEnabled: true,
    members, namingSource: 'molly-model', pending: false, muted: true,
  };
  const reminders = (status, meal, time) => ({
    id: `${prefix}-${status}-${meal}`, meal, time, timezone: 'Asia/Shanghai',
    startDate: dates[0], endDate: dates.at(-1), status,
  });
  const planDays = draft => dates.map((date, index) => ({
    date, label: draft ? '候选安排，尚待确认' : index === 7 ? '今日安排' : '日常安排',
    breakfast: draft ? '候选早餐：牛奶与全麦面包' : key === 'a' ? '水煮蛋、燕麦和牛奶' : '全麦三明治与牛奶',
    lunch: draft ? '候选午餐：鸡胸肉与杂粮饭' : key === 'a' ? '香煎鸡胸肉、米饭和西兰花' : '豆腐、米饭和炒青菜',
    dinner: draft ? '候选晚餐：豆腐与蔬菜' : key === 'a' ? '番茄豆腐、杂粮饭和青菜' : '番茄鸡蛋、杂粮饭和黄瓜',
  }));
  const plan = (status, id) => ({
    id, status, days: planDays(status === 'draft'), shopping: [], createdAt, updatedAt,
    ...(status === 'confirmed' ? {confirmedAt: updatedAt, confirmationMessageId: `${prefix}-confirmation`} : {}),
  });
  return [
    {
      ...base, id: `${prefix}-confirmed`, name: `任务预览 ${key.toUpperCase()} · 已确认`,
      plan: plan('confirmed', `${prefix}-plan-confirmed`),
      reminders: [reminders('active', 'breakfast', '08:00')],
      messages: [{id: `${prefix}-confirmed-message`, senderId: 'molly', senderName: 'Molly',
        type: 'text', text: '隔离预览：三餐计划已确认，早餐提醒已启用。', at: updatedAt}],
    },
    {
      ...base, id: `${prefix}-draft`, name: `任务预览 ${key.toUpperCase()} · 待确认`,
      plan: plan('draft', `${prefix}-plan-draft`),
      reminders: [reminders('proposed', 'lunch', '12:30'), reminders('paused', 'dinner', '18:30'), reminders('cancelled', 'breakfast', '07:30')],
      messages: [{id: `${prefix}-draft-message`, senderId: 'molly', senderName: 'Molly',
        type: 'text', text: '隔离预览：候选菜单未确认，午餐提醒待确认，晚餐提醒已暂停。', at: updatedAt}],
    },
  ];
}

const groupsByAccount = {a: syntheticGroups('a'), b: syntheticGroups('b')};
function currentAccount(req) {
  const cookie = (req.headers.cookie || '').split(';').map(item => item.trim())
    .find(item => item.startsWith('task_ui_fixture_account='));
  return cookie === 'task_ui_fixture_account=b' ? 'b' : 'a';
}
function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}
function count(path, method) {
  const key = `${method}:${path}`;
  counters.apiCounts[key] = (counters.apiCounts[key] || 0) + 1;
}

function canonicalRoute(raw) {
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) throw new Error('Invalid origin-form path');
  const url = new URL(raw, 'http://127.0.0.1');
  let path = url.pathname;
  for (let pass = 0; pass < 16; pass++) {
    const next = decodeURIComponent(path);
    if (next === path) break;
    path = next;
    if (pass === 15 && /%[\da-f]{2}/i.test(path)) throw new Error('Over-encoded path');
  }
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 32 || code === 127) throw new Error('Invalid path characters');
  }
  // Decode before normalizing dot segments, slashes, and backslashes. Therefore
  // encoded /api and encoded traversal can never hide behind an asset request.
  const segments = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  path = `/${segments.join('/')}`;
  return {path, search: url.search};
}

const server = createServer((req, res) => {
  let route;
  try { route = canonicalRoute(req.url); }
  catch { req.resume(); return json(res, 400, {error: '隔离预览请求路径无效'}); }
  const {path} = route;
  const key = currentAccount(req);
  if (/^\/fixture(?:\/|$)/i.test(path)) {
    if (req.method !== 'GET') {
      counters.blockedRealWrites++; req.resume();
      return json(res, 405, {error: '隔离预览入口只允许 GET'});
    }
    if (path === '/fixture/report') return json(res, 200, {
      isolated: true, authentication: 'synthetic-account-cookie', realModel: false,
      activeAccount: accounts[key], today, dates, ...counters,
    });
    if (path === '/fixture/account-a' || path === '/fixture/account-b') {
      const next = path.endsWith('-b') ? 'b' : 'a';
      res.writeHead(302, {
        Location: '/?npc=chen-nian', 'Cache-Control': 'no-store',
        'Set-Cookie': `task_ui_fixture_account=${next}; Path=/; HttpOnly; SameSite=Strict`,
      });
      return res.end();
    }
    return json(res, 404, {error: '隔离预览入口不存在'});
  }
  // A broad case-insensitive prefix also blocks malformed API variants. The
  // request is never handed to a production plugin, including unknown routes.
  if (/^\/api/i.test(path)) {
    count(path, req.method);
    if (req.method !== 'GET') {
      counters.blockedRealWrites++; req.resume();
      return json(res, 403, {error: '隔离预览阻止所有 API 写入'});
    }
    if (path === '/api/auth/session') return json(res, 200, {authenticated: true, account: accounts[key]});
    if (path === '/api/npc/groups') {
      if (req.headers['x-zhiyu-account'] !== accounts[key].id) return json(res, 409, {error: '隔离预览账号不匹配'});
      return json(res, 200, {groups: groupsByAccount[key]});
    }
    if (path === '/api/npc/moments') return json(res, 200, {items: []});
    if (path === '/api/npc/secretary') return json(res, 200, {completions: {}});
    if (['molly', 'chen-nian', 'xia-xia', 'yuan-xiaoman', 'liu', 'he-jiawei', 'zhou-chef'].some(id => path === `/api/npc/${id}`)) {
      const messages = path === '/api/npc/chen-nian' ? [
        {id: `task-fixture-${key}-user`, role: 'user', at: createdAt, part: {type: 'text', text: '隔离预览：今天可以怎么安排？'}},
        {id: `task-fixture-${key}-assistant`, role: 'assistant', at: updatedAt, part: {type: 'text', text: '这是合成消息，供核对右键菜单文字大小。'}},
      ] : [];
      return json(res, 200, {...session, conversationId: `task-fixture-${key}`, messages});
    }
    return json(res, 404, {error: '隔离预览未提供这个 API'});
  }
  if (req.method !== 'GET') {
    counters.blockedAssetWrites++; req.resume();
    return json(res, 405, {error: 'App 界面资源只允许 GET'});
  }
  if (path === '/__open-in-editor') return json(res, 404, {error: '隔离预览不打开外部编辑器'});
  counters.assetReads++;
  const proxy = proxyRequest({
    hostname: '127.0.0.1', port: 3100, method: 'GET',
    // Security checks use the canonical route above. Preserve the original
    // encoded Vite module IDs when forwarding allowed UI asset GET requests.
    path: req.url,
    headers: {host: '127.0.0.1:3100', accept: req.headers.accept || '*/*'},
  }, upstream => {
    // Production auth cookies must not enter the isolated browser origin.
    const {'set-cookie': _cookies, ...headers} = upstream.headers;
    const optics = path === '/' && new URL(req.url, 'http://127.0.0.1').searchParams.get('liquidOptics') === '1';
    if (optics && String(headers['content-type']).includes('text/html')) {
      delete headers['content-length'];
      delete headers.etag;
      res.writeHead(upstream.statusCode || 502, headers);
      let html='';
      upstream.setEncoding('utf8');
      upstream.on('data', chunk => {html+=chunk;});
      upstream.on('end', () => res.end(html.replace('</head>', liquidOpticsProof+'</head>')));
      upstream.on('error', () => res.end());
      return;
    }
    res.writeHead(upstream.statusCode || 502, headers);
    upstream.pipe(res);
  });
  activeProxies.add(proxy);
  proxy.once('close', () => activeProxies.delete(proxy));
  proxy.on('error', () => {
    if (!res.headersSent) json(res, 502, {error: '本机 App 界面服务尚未就绪'});
    else res.end();
  });
  res.once('close', () => {if (!res.writableEnded) proxy.destroy();});
  proxy.end();
});

function stop() {
  if (closing) return;
  closing = true;
  for (const proxy of activeProxies) proxy.destroy();
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('error', error => {
  console.error(JSON.stringify({error: error.message, isolated: true}));
  process.exitCode = 1;
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${server.address().port}`, isolated: true,
  accountAPath: '/fixture/account-a', accountBPath: '/fixture/account-b',
  reportPath: '/fixture/report', today, dates, modelCalls: 0, actualRealWrites: 0,
})));
