import {createServer, request as proxyRequest} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// This isolated UI fixture mutates synthetic in-memory tasks only. No NPC/auth
// plugins, databases, credentials, or models are loaded. The real App supplies
// GET UI assets only; every API stays here, including timer actions.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const timerRuntime=mkdtempSync(join(tmpdir(),'zhiyu-task-ui-timer-'));
for(const name of ['professional-task','professional-task-timer','professional-task-session','professional-task-expiry']){
  const source=readFileSync(join(project,`lib/npc/${name}.ts`),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
    .replaceAll("from './professional-task'","from './professional-task.mjs'").replaceAll("from './professional-task-timer'","from './professional-task-timer.mjs'").replaceAll("from './professional-task-session'","from './professional-task-session.mjs'").replaceAll("from './professional-task-expiry'","from './professional-task-expiry.mjs'");
  writeFileSync(join(timerRuntime,`${name}.mjs`),js);
}
const {freezeProfessionalTaskStepTimer,freezeProfessionalTaskTimers,mutateProfessionalTaskTimer}=await import(pathToFileURL(join(timerRuntime,'professional-task-timer.mjs')).href);
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
const syntheticTasks={a:[{
  id:'professional-fixture-task-a',characterId:'zhou-chef',title:'地三鲜',goalKey:'地三鲜',
  status:'active',createdAt:updatedAt,updatedAt,revision:1,
  sourceMessageId:'professional-fixture-source',cardMessageId:'professional-fixture-card',
  steps:[
    {id:'professional-fixture-step-1',title:'备料、切配和控水',details:['土豆切滚刀块，茄子切块，青椒切片。','下锅前把表面的水沥干。'],instructions:['土豆去皮切滚刀块，茄子切块，青椒去籽切片。','把蒜切末，食材放在手边。'],notes:['茄子洗净后擦干。热油里不要带入水。'],completionCondition:'食材切好，表面没有明显水分。',completedAt:updatedAt,hints:[]},
    {id:'professional-fixture-step-2',title:'调好料汁',details:['碗里加入生抽、老抽、白糖、淀粉与清水，搅匀。','先不额外加盐。'],instructions:['碗里放生抽15毫升、老抽2毫升、白糖3克。','加入淀粉4克和清水60毫升，搅拌均匀。'],notes:['先不额外加盐，生抽已经带咸味。','入锅前再搅一下，防止淀粉沉底。'],completionCondition:'调料混合均匀，放在手边备用。',hints:[{id:'professional-fixture-hint',eventId:'professional-fixture-event',stepId:'professional-fixture-step-2',text:'先把料汁调好，等会儿合炒就不会手忙脚乱。',at:updatedAt,messageIds:['professional-fixture-reminder']}]},
    {id:'professional-fixture-step-3',title:'炸熟土豆',durationSeconds:300,details:['土豆下锅约5分钟，观察上色与熟化程度。','用筷子能轻松穿透时捞出沥油。'],instructions:['中火将油烧热，沥干的土豆分批下锅。','约炸5分钟，期间轻轻翻动，使上色均匀。'],notes:['时间是参考，以实际熟化状态为准。','不要一次倒进太多，避免油温降得过低。'],completionCondition:'表面微黄，筷子能轻松穿透土豆。',hints:[]},
    {id:'professional-fixture-step-4',title:'炸熟茄子',durationSeconds:600,details:['茄子分批下锅，约10分钟。','炸软后捞出沥油。'],instructions:['茄子擦干后分批下锅。','约炸10分钟，期间翻动并观察软化情况。'],notes:['分批操作时，以每批实际状态判断。','热油不可离人，变软后及时捞出。'],completionCondition:'茄子明显变软，切块内部熟透。',hints:[]},
    {id:'professional-fixture-step-5',title:'煸香蒜末与青椒',details:['蒜末炒约30秒，再炒青椒约1分钟。'],instructions:['锅里留少许底油，蒜末炒约30秒。','放入青椒，翻炒约1分钟。'],notes:['蒜末出香味即可，不要炒焦。'],completionCondition:'蒜末有香味，青椒略微变软。',hints:[]},
    {id:'professional-fixture-step-6',title:'合炒、调味和装盘',details:['土豆、茄子回锅，倒入料汁炒匀。','确认熟透后装盘。'],instructions:['把土豆和茄子倒回锅中。','料汁重新搅匀后倒入，翻炒到均匀挂汁。'],notes:['尝味后再决定是否补盐。'],completionCondition:'所有食材熟透，表面均匀挂汁。',hints:[]},
  ],
}],b:[]};
const fitnessTask={id:'professional-fixture-chest-a',characterId:'chen-nian',title:'胸部训练',goalKey:'胸部训练',status:'active',createdAt:new Date(`${addDays(today,-33)}T08:00:00+08:00`).toISOString(),updatedAt,revision:1,sourceMessageId:'professional-fixture-chest-source',cardMessageId:'professional-fixture-chest-card',steps:[
  {id:'fitness-warmup',title:'热身与上斜夹胸激活',category:'preparation',scheduledDate:today,instructions:['肩关节活动后，用轻重量上斜夹胸。肘微屈，收回时胸部发力。'],notes:['热身不追求力竭。'],completionCondition:'胸肩活动顺畅，无疼痛。',training:{target:'胸大肌（上胸侧重）',sets:2,reps:'12～16次',effort:'轻重量，保留余力。'},hints:[]},
  {id:'fitness-incline',title:'上斜哑铃卧推',category:'main',scheduledDate:today,instructions:['凳面调到约30°，沉肩，肩胛稳定贴凳。','手腕保持中立，哑铃落在上胸两侧；肘与躯干约45°，推起时不耸肩。'],notes:['动作变形、肩部疼痛就停；重量以动作稳定为准。'],completionCondition:'完成正式组并记录重量和次数。',training:{target:'上胸',sets:3,reps:'8～12次',restSeconds:180,effort:'每组保留1～2次余力；最后一组可接近技术力竭。',recommendation:'这次练上胸的主动作。哑铃轨迹可调整，方便稳定肩胛并练足动作幅度。'},hints:[]},
  {id:'fitness-flat',title:'平板器械推胸',category:'main',scheduledDate:today,instructions:['把座位调到握把与中胸齐平。沉肩，手腕中立，推出和收回都控制住。'],notes:['不要为了加重量缩短动作幅度。'],completionCondition:'完成3组并记录次数。',training:{target:'中胸',sets:3,reps:'8～12次',restSeconds:120,effort:'保留1～2次余力。'},hints:[]},
  {id:'fitness-cable',title:'高位绳索夹胸',category:'accessory',scheduledDate:addDays(today,2),instructions:['把滑轮调高，手肘微屈，双手向下前方合拢。胸部发力，回程控制住。'],notes:['不要甩手或大幅度晃身体。'],completionCondition:'完成3组并记录重量。',training:{target:'下胸侧重',sets:3,reps:'12～15次',restSeconds:75,effort:'最后一组可接近技术力竭；动作变形就停。'},hints:[]},
  {id:'fitness-finish',title:'整理与记录',category:'finishing',scheduledDate:today,instructions:['记录本次重量、次数和剩余余力。'],notes:['没有明显不适，再根据下次表现微调重量。'],completionCondition:'本次训练数据已记录。',hints:[]},
]};
syntheticTasks.a.push(fitnessTask);
for(const task of syntheticTasks.a)for(const [index,step] of task.steps.entries())if(!step.category)step.category=index<2?'preparation':index===task.steps.length-1?'finishing':'main';
// Keep the legacy fallback content equivalent to the structured sections so
// old and new renderers see the same recipe without repeated paragraphs.
for(const task of syntheticTasks.a)for(const step of task.steps)step.details=[
  ...step.instructions,...(step.notes||[]).map(line=>`注意：${line}`),`完成条件：${step.completionCondition}`,
];
const syntheticMessages={a:[
  {id:'professional-fixture-source',turnId:'professional-fixture-turn',role:'user',at:updatedAt,part:{type:'text',text:'我要做地三鲜。'}},
  {id:'professional-fixture-answer',turnId:'professional-fixture-turn',role:'assistant',at:updatedAt,part:{type:'text',text:'好的，步骤放在这里。土豆和茄子分开炸，各自看火候。'}},
  {id:'professional-fixture-card',turnId:'professional-fixture-turn',role:'assistant',at:updatedAt,part:{type:'professional_task',taskId:'professional-fixture-task-a'}},
  {id:'professional-fixture-reminder',turnId:'professional-fixture-turn',role:'assistant',at:updatedAt,part:{type:'text',text:'先把料汁调好，等会儿合炒就不会手忙脚乱。'}},
],b:[]};
syntheticMessages.a.push({id:'professional-fixture-chest-source',turnId:'professional-fixture-chest-turn',role:'user',at:updatedAt,part:{type:'text',text:'我现在要练胸，给我安排。'}},{id:'professional-fixture-chest-answer',turnId:'professional-fixture-chest-turn',role:'assistant',at:updatedAt,part:{type:'text',text:'收到，老大💪 动作放这儿了，哪个不会就点开问我。'}},{id:'professional-fixture-chest-card',turnId:'professional-fixture-chest-turn',role:'assistant',at:updatedAt,part:{type:'professional_task',taskId:fitnessTask.id}});
for(const message of syntheticMessages.a)message.readAt=updatedAt;
let fixtureWrites=0;
const mutationRevision={a:1,b:1};
const acknowledgedEvents={a:new Set(),b:new Set()};
const controls={delayMs:0,failNext:0,conflictNext:false};
const taskResult=(key,characterId='zhou-chef')=>({...session,revision:mutationRevision[key],conversationId:`task-fixture-${key}-${characterId}`,messages:syntheticMessages[key].filter(message=>characterId==='chen-nian'?message.id.startsWith('professional-fixture-chest'):!message.id.startsWith('professional-fixture-chest')),professionalTasks:syntheticTasks[key].filter(task=>task.characterId===characterId)});

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
      fixtureWrites,
      controls,
    });
    if(path==='/fixture/control'){
      const query=new URLSearchParams(route.search);
      if(query.has('delayMs'))controls.delayMs=Math.max(0,Math.min(5000,Number(query.get('delayMs'))||0));
      if(query.has('failNext'))controls.failNext=query.get('failNext')==='1'?503:Math.max(0,Math.min(599,Number(query.get('failNext'))||0));
      if(query.has('conflictNext'))controls.conflictNext=query.get('conflictNext')==='1';
      return json(res,200,{isolated:true,controls});
    }
    if(path==='/fixture/timer-running'||path==='/fixture/timer-elapsed'){
      const task=syntheticTasks[key][0],step=task?.steps.find(item=>item.id==='professional-fixture-step-3');
      if(!task||!step)return json(res,404,{error:'当前合成账号没有任务'});
      task.status='active';delete step.completedAt;delete step.timer;
      const now=Date.now();
      mutateProfessionalTaskTimer(task,step.id,'start',task.revision,path==='/fixture/timer-elapsed'?now-301_000:now);
      task.updatedAt=new Date(now).toISOString();mutationRevision[key]++;fixtureWrites++;
      return json(res,200,taskResult(key));
    }
    if(path==='/fixture/rest-elapsed'){
      const task=syntheticTasks[key].find(item=>item.characterId==='chen-nian'),step=task?.steps.find(item=>item.id==='fitness-incline');
      if(!task||!step)return json(res,404,{error:'当前合成账号没有训练任务'});
      task.status='active';delete step.completedAt;delete step.timer;
      const maxCycles=step.training.sets-1,query=new URLSearchParams(route.search),cycles=Math.max(1,Math.min(maxCycles,Number(query.get('cycles'))||1)),duration=step.training.restSeconds*1000,now=Date.now();
      for(let index=0;index<cycles;index++)mutateProfessionalTaskTimer(task,step.id,'start',task.revision,now-(cycles-index)*(duration+1000));
      task.updatedAt=new Date(now).toISOString();mutationRevision[key]++;fixtureWrites++;
      return json(res,200,taskResult(key,'chen-nian'));
    }
    if(path==='/fixture/parallel-rest-timers'){
      const task=syntheticTasks[key].find(item=>item.characterId==='chen-nian'),running=task?.steps.find(item=>item.id==='fitness-incline'),paused=task?.steps.find(item=>item.id==='fitness-flat');
      if(!task||!running||!paused)return json(res,404,{error:'当前合成账号没有训练任务'});
      task.status='active';for(const step of task.steps){delete step.completedAt;delete step.timer;}
      const now=Date.now();mutateProfessionalTaskTimer(task,running.id,'start',task.revision,now-10_000);mutateProfessionalTaskTimer(task,paused.id,'start',task.revision,now-20_000);mutateProfessionalTaskTimer(task,paused.id,'pause',task.revision,now);
      task.updatedAt=new Date(now).toISOString();mutationRevision[key]++;fixtureWrites++;
      return json(res,200,taskResult(key,'chen-nian'));
    }
    if(path==='/fixture/long-title-date'){
      const task=syntheticTasks[key].find(item=>item.characterId==='chen-nian'),step=task?.steps.find(item=>item.id==='fitness-incline');
      if(!task||!step)return json(res,404,{error:'当前合成账号没有训练任务'});
      step.title='上斜哑铃卧推热身';step.scheduledDate=addDays(today,2);task.revision++;task.updatedAt=new Date().toISOString();mutationRevision[key]++;fixtureWrites++;
      return json(res,200,taskResult(key,'chen-nian'));
    }
    if(path==='/fixture/task-paused'){
      const task=syntheticTasks[key][0];
      if(!task)return json(res,404,{error:'当前合成账号没有任务'});
      freezeProfessionalTaskTimers(task);task.status='paused';task.revision++;task.updatedAt=new Date().toISOString();
      mutationRevision[key]++;fixtureWrites++;
      return json(res,200,taskResult(key));
    }
    if(path==='/fixture/restore-empty-pet'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return res.end('<!doctype html><html><head><title>恢复合成预览宠物状态</title></head><body><p>正在恢复此隔离源的空宠物状态。</p><script>localStorage.setItem('+JSON.stringify(`zhiyu-pets-v1:${accounts[key].id}`)+','+JSON.stringify(JSON.stringify({pets:[],selectedId:'',visible:true}))+');location.replace("/?npc=zhou-chef#chat");</script></body></html>');
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
    if(['/api/npc/zhou-chef','/api/npc/chen-nian'].includes(path)&&req.method==='POST'){
      const characterId=path.endsWith('chen-nian')?'chen-nian':'zhou-chef';
      let body='';req.on('data',chunk=>{body+=chunk;if(body.length>20000)req.destroy();});
      req.on('end',()=>{
        let data;try{data=JSON.parse(body);}catch{return json(res,400,{error:'隔离预览操作无效'});}
        if(req.headers['x-zhiyu-account']!==accounts[key].id)return json(res,409,{error:'隔离预览账号不匹配'});
        if(!['task_step','task_status','task_timer','task_step_date'].includes(data.action))return json(res,403,{error:'隔离预览只允许合成任务操作'});
        const task=syntheticTasks[key].find(item=>item.id===data.taskId&&item.characterId===characterId);
        if(!task)return json(res,404,{error:'合成任务不存在'});
        if(typeof data.eventId!=='string'||!data.eventId)return json(res,400,{error:'合成操作缺少事件ID'});
        const delay=controls.delayMs;
        const failure=controls.failNext;controls.failNext=0;
        const conflict=controls.conflictNext;controls.conflictNext=false;
        const apply=()=>{
          if(failure>=400)return json(res,failure,{error:'隔离预览：合成保存失败'});
          if(acknowledgedEvents[key].has(data.eventId))return json(res,200,taskResult(key,characterId));
          if(conflict){task.revision++;mutationRevision[key]++;}
          if(data.expectedRevision!==task.revision)return json(res,409,{...taskResult(key,characterId),error:'合成任务已更新'});
          const now=Date.now();
          try{
            if(data.action==='task_timer'){
              if(!['start','pause','resume'].includes(data.operation))return json(res,400,{error:'合成计时操作无效'});
              mutateProfessionalTaskTimer(task,data.stepId,data.operation,data.expectedRevision,now);
            }else if(data.action==='task_step_date'){
              const step=task.steps.find(item=>item.id===data.stepId);
              if(!step?.scheduledDate||step.completedAt||['completed','cancelled'].includes(task.status)||!Array.from({length:8},(_,index)=>addDays(today,index)).includes(data.scheduledDate))return json(res,400,{error:'合成日期无效'});
              step.scheduledDate=data.scheduledDate;task.revision++;task.updatedAt=new Date(now).toISOString();
            }else if(data.action==='task_step'){
              const step=task.steps.find(item=>item.id===data.stepId);
              if(!step||typeof data.completed!=='boolean')return json(res,400,{error:'合成步骤无效'});
              if(task.status==='cancelled')return json(res,409,{...taskResult(key,characterId),error:'合成任务已结束'});
              if(data.completed&&task.status==='paused')return json(res,409,{...taskResult(key,characterId),error:'请先继续合成任务'});
              if(data.completed){step.completedAt=new Date(now).toISOString();freezeProfessionalTaskStepTimer(step,now);}else delete step.completedAt;
              if(task.steps.every(item=>item.completedAt)){task.status='completed';freezeProfessionalTaskTimers(task,now);}else if(task.status==='completed')task.status='active';
              task.revision++;task.updatedAt=new Date(now).toISOString();
            }else{
              if(!['active','paused','cancelled'].includes(data.status))return json(res,400,{error:'合成状态无效'});
              if(data.status!=='active')freezeProfessionalTaskTimers(task,now);
              task.status=data.status;task.revision++;task.updatedAt=new Date(now).toISOString();
            }
          }catch(error){return json(res,error.status||400,{...taskResult(key,characterId),error:error.message});}
          acknowledgedEvents[key].add(data.eventId);mutationRevision[key]++;fixtureWrites++;
          return json(res,200,taskResult(key,characterId));
        };
        if(delay)setTimeout(apply,delay);else apply();
      });return;
    }
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
    if (['molly', 'chen-nian', 'xia-xia', 'yuan-xiaoman', 'liu', 'he-jiawei', 'zhou-chef'].some(id => path === `/api/npc/${id}`)) {
      if(path==='/api/npc/zhou-chef'||path==='/api/npc/chen-nian')return json(res,200,taskResult(key,path.endsWith('chen-nian')?'chen-nian':'zhou-chef'));
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
process.on('exit',()=>rmSync(timerRuntime,{recursive:true,force:true}));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('error', error => {
  console.error(JSON.stringify({error: error.message, isolated: true}));
  process.exitCode = 1;
});
server.listen(Number(process.argv[2]||0), '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${server.address().port}`, isolated: true,
  accountAPath: '/fixture/account-a', accountBPath: '/fixture/account-b',
  reportPath: '/fixture/report', today, dates, modelCalls: 0, actualRealWrites: 0,
})));
