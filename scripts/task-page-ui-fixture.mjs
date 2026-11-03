import {createServer, request as proxyRequest} from 'node:http';
import {realtimeCallFixtureScript} from './realtime-call-browser-fixture.mjs';

// A read-only UI fixture. No NPC/auth plugins, databases, credentials, or models
// are loaded. The real App supplies GET UI assets only; every API stays here.
// This opt-in creates only in-memory ProfessionalTask-shaped source snapshots.
// It does not enable API writes, execute task commands, or send chat messages.
const experienceFixture=process.env.ZHIYU_EXPERIENCE_FIXTURE==='1';
const taskBoardImportFixture = process.env.ZHIYU_TASK_BOARD_IMPORT_FIXTURE === '1';
const realtimeCallFixture=process.env.ZHIYU_REALTIME_CALL_FIXTURE==='1';
const requestedAssetPort=Number(process.env.ZHIYU_FIXTURE_ASSET_PORT||3100);
if(!Number.isInteger(requestedAssetPort)||requestedAssetPort<1024||requestedAssetPort>65535)throw new Error('Invalid isolated asset port');
const fixtureStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
const oldImportTaskAt = new Date(Date.parse(fixtureStartedAt) - 60_000).toISOString();
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


function syntheticExperienceMessages(){
 const metric={completed:3,planned:4,missedDates:['2026-11-01']};
 const base={createdAt:updatedAt,startDate:'2026-10-27',endDate:'2026-11-03',city:{name:'深圳',source:'manual'},weather:{min:22,max:28,text:'晴',summary:'白天温暖',attribution:'界面隔离数据'},agenda:[{id:'qa-t1',date:today,time:'18:00',title:'腿部训练',source:'陈年',characterId:'chen-nian',completed:false}],decisions:[{id:'qa-choice',characterId:'chen-nian',messageId:'qa-choice-origin',text:'明天练腿还是练背？',options:['练腿','练背']}],weekNumber:4,completionPercent:75,training:metric,nutrition:metric,cooking:{completed:1,planned:2,missedDates:[]},packedMeals:null,weightKg:72.5,previousWeightKg:73,waistCm:null,weeklyWeights:[{startDate:'2026-10-06',weightKg:74},{startDate:'2026-10-13',weightKg:73.5},{startDate:'2026-10-20',weightKg:null},{startDate:'2026-10-27',weightKg:72.5}],feelings:{sleep:null,energy:null,soreness:null},adjustments:['下周沿用当前训练重量'],milestones:['连续完成三次训练'],nextFocus:['按原计划安排休息日'],team:[{characterId:'chen-nian',name:'陈年',avatar:'/npc/chen-nian/avatar-20260926.png',text:'这周三次训练都做到了，下周稳住动作。',quoteId:'qa-quote'}],partial:false};
 return [{id:'qa-morning-hello',role:'assistant',at:updatedAt,part:{type:'text',text:'早。今天的安排'}},...['morning','weekly','monthly'].map((kind,index)=>({id:'qa-report-'+kind,role:'assistant',at:updatedAt,part:{type:'secretary_report',text:kind==='morning'?'早报':kind==='weekly'?'本周回顾':'月度总结',report:{...base,id:'qa-report-'+kind,kind,title:kind==='morning'?'今天的安排':kind==='weekly'?'本周回顾':'月度总结',...(index===2?{startDate:'2026-10-01',endDate:'2026-10-31'}:{})}}}))];
}

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

const groupsByAccount = taskBoardImportFixture ? {a: [], b: []} : {a: syntheticGroups('a'), b: syntheticGroups('b')};
function makeImportTask(key, kind, at) {
  const id = `task-board-import-${key}-${kind}`;
  const cooking = kind === 'cooking';
  const title = cooking ? '番茄炒蛋（接入验证）' : kind === 'old' ? '旧有腿部训练（应排除）' : '腿部训练（接入验证）';
  const step = (suffix, content) => ({id: `${id}-${suffix}`, scheduledDate: today, hints: [], ...content});
  return {
    id, characterId: cooking ? 'zhou-chef' : 'chen-nian', title, goalKey: title,
    status: 'active', assignedDate: today, createdAt: at, updatedAt: at, revision: 1,
    sourceMessageId: `${id}-source`, cardMessageId: `${id}-card`,
    steps: cooking ? [
      step('prepare', {title: '备料并打散鸡蛋', category: 'preparation', durationSeconds: 120,
        details: ['番茄300克切块，鸡蛋2个打散，葱5克切碎。'],
        instructions: ['番茄洗净切块，鸡蛋打散，葱切碎并放在手边。'],
        completionCondition: '所有食材切配完成，蛋液均匀。'}),
      step('eggs', {title: '炒熟鸡蛋盛出', category: 'main', durationSeconds: 60,
        details: ['锅中加油10毫升，中火炒蛋约1分钟后盛出。'],
        instructions: ['中火热锅加油，倒入蛋液，轻轻推散至凝固后盛出。'],
        notes: ['以蛋液凝固为准，热锅不要离人。'], completionCondition: '鸡蛋已凝固并盛到盘中。'}),
      step('combine', {title: '炒番茄后合炒', category: 'main', durationSeconds: 180,
        details: ['中火炒番茄约3分钟至出汁，放回鸡蛋，加盐2克翻匀。'],
        instructions: ['番茄下锅炒至出汁，倒回鸡蛋，加盐后翻匀。'],
        completionCondition: '番茄出汁，鸡蛋热透且均匀裹汁。'}),
    ] : [
      step('squat', {title: '高脚杯深蹲', category: 'main',
        details: ['3组，每组8～12次，组间休息90秒。'],
        instructions: ['双脚站稳，抱铃在胸前，下蹲时膝盖跟随脚尖方向，保持躯干稳定。'],
        notes: ['保留2次余力；出现关节疼痛立即停止。'],
        completionCondition: '完成3组并记录每组次数。',
        training: {target: '股四头肌与臀大肌', sets: 3, reps: '8～12次', restSeconds: 90, effort: '保留2次余力。'}}),
      step('hinge', {title: '哑铃罗马尼亚硬拉', category: 'main',
        details: ['3组，每组8～10次，组间休息120秒。'],
        instructions: ['膝微屈，髋部向后移动，哑铃贴近腿部下降，保持背部稳定后站起。'],
        notes: ['不要弯腰代偿；动作幅度以能稳定控制为准。'],
        completionCondition: '完成3组并记录重量和次数。',
        training: {target: '腘绳肌与臀大肌', sets: 3, reps: '8～10次', restSeconds: 120, effort: '保留2次余力。'}}),
    ],
  };
}
const importTasksByAccount = taskBoardImportFixture ? {
  a: [makeImportTask('a', 'old', oldImportTaskAt)],
  b: [makeImportTask('b', 'old', oldImportTaskAt)],
} : {a: [], b: []};
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
      ...(taskBoardImportFixture ? {taskBoardImportFixture: {
        enabled: true, fixtureStartedAt,
        tasks: importTasksByAccount[key].map(task => ({id: task.id, characterId: task.characterId, title: task.title, createdAt: task.createdAt})),
      }} : {}),
    });
    if (taskBoardImportFixture && (path === '/fixture/add-leg' || path === '/fixture/add-cooking')) {
      const kind = path.endsWith('add-leg') ? 'leg' : 'cooking';
      const id = `task-board-import-${key}-${kind}`;
      if (!importTasksByAccount[key].some(task => task.id === id))
        importTasksByAccount[key].push(makeImportTask(key, kind, new Date().toISOString()));
      res.writeHead(302, {Location: '/#tasks', 'Cache-Control': 'no-store'});
      return res.end();
    }
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
    if(realtimeCallFixture&&path==='/api/npc/realtime-speech/settings')return json(res,200,{configured:true});
    if (path === '/api/npc/groups') {
      if (req.headers['x-zhiyu-account'] !== accounts[key].id) return json(res, 409, {error: '隔离预览账号不匹配'});
      return json(res, 200, {groups: groupsByAccount[key]});
    }
    if (path === '/api/npc/moments') return json(res, 200, {items: []});
    if (path === '/api/npc/secretary') return json(res, 200, {completions: {},...(experienceFixture?{settings:{enabled:true,time:'07:00',city:{name:'深圳',source:'manual'}}}:{})});
    if (['molly', 'chen-nian', 'xia-xia', 'yuan-xiaoman', 'liu', 'he-jiawei', 'zhou-chef'].some(id => path === `/api/npc/${id}`)) {
      const messages = experienceFixture&&path==='/api/npc/molly'?syntheticExperienceMessages():path === '/api/npc/chen-nian' ? [
        {id: `task-fixture-${key}-user`, role: 'user', at: createdAt, part: {type: 'text', text: '隔离预览：今天可以怎么安排？'}},
        {id: `task-fixture-${key}-assistant`, role: 'assistant', at: updatedAt, part: {type: 'text', text: '这是合成消息，供核对右键菜单文字大小。'}},
      ] : [];
      const characterId = path.slice('/api/npc/'.length);
      return json(res, 200, {...session, conversationId: `task-fixture-${key}`, messages,
        ...(taskBoardImportFixture && ['chen-nian', 'liu', 'zhou-chef'].includes(characterId)
          ? {professionalTasks: importTasksByAccount[key].filter(task => task.characterId === characterId)} : {}),
      });
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
    hostname: '127.0.0.1', port: requestedAssetPort, method: 'GET',
    // Security checks use the canonical route above. Preserve the original
    // encoded Vite module IDs when forwarding allowed UI asset GET requests.
    path: req.url,
    headers: {host: `127.0.0.1:${requestedAssetPort}`, accept: req.headers.accept || '*/*'},
  }, upstream => {
    // Production auth cookies must not enter the isolated browser origin.
    const {'set-cookie': _cookies, ...headers} = upstream.headers;
    const optics = path === '/' && new URL(req.url, 'http://127.0.0.1').searchParams.get('liquidOptics') === '1';
    const callFixture=realtimeCallFixture&&path==='/character-window';
    if ((optics||callFixture) && String(headers['content-type']).includes('text/html')) {
      delete headers['content-length'];
      delete headers.etag;
      res.writeHead(upstream.statusCode || 502, headers);
      let html='';
      upstream.setEncoding('utf8');
      upstream.on('data', chunk => {html+=chunk;});
      upstream.on('end', () => res.end(html.replace('</head>', (optics?liquidOpticsProof:'')+(callFixture?realtimeCallFixtureScript:'')+'</head>')));
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
  ...(taskBoardImportFixture ? {taskBoardImportFixture: true, addLegPath: '/fixture/add-leg', addCookingPath: '/fixture/add-cooking'} : {}),
})));
