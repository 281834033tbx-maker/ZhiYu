import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Pure synthetic records and a Map-backed browser store only. No server,
// user storage, database, credentials, task mutations or model is accessed.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'zhiyu-task-board-live-import-'));
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const serial=value=>JSON.stringify(value);
const cutoff=Date.parse('2026-11-02T01:00:00.000Z');
const at=offset=>new Date(cutoff+offset).toISOString();
const professional=(id,createdAt=at(1000))=>({
  id,characterId:'chen-nian',title:'哑铃练胸',goalKey:'练胸',createdAt,updatedAt:createdAt,revision:1,status:'active',
  sourceMessageId:'synthetic-source',cardMessageId:'synthetic-card',steps:[{
    id:'synthetic-step',title:'哑铃卧推',details:['仰卧稳定肩胛'],instructions:['按给定重量完成'],notes:['肩痛停止'],
    completionCondition:'完成既定组次',durationSeconds:120,scheduledDate:'2026-11-08',
    training:{target:'胸肌',sets:3,reps:'8–12次',restSeconds:90,effort:'保留2次余力',recommendation:'逐步增加重量'},hints:[],
  }],
});
const group={
  id:'synthetic-group',name:'饮食安排',goal:'下周三餐',sourceCharacterId:'molly',createdAt:at(500),updatedAt:at(500),
  createdBy:'molly',chatEnabled:true,members:[{id:'liu',name:'柳智敏',role:'npc',joinedAt:at(500),order:1}],messages:[],namingSource:'molly-model',
  plan:{id:'synthetic-plan',status:'confirmed',days:[{date:'2026-11-09',label:'周一',breakfast:'鸡蛋牛奶',lunch:'鱼肉米饭',dinner:''}],
    shopping:[],createdAt:at(-5000),updatedAt:at(500),confirmedAt:at(500)},
  reminders:[{id:'synthetic-reminder',meal:'breakfast',time:'08:00',timezone:'Asia/Shanghai',startDate:'2026-11-09',endDate:'2026-11-09',status:'active'}],
};
try {
  for(const name of ['config','mock','reducer','data-source','live-task-import']) {
    const source=readFileSync(join(project,`app/zhiyu/task-board/${name}.ts`),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
      .replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
    writeFileSync(join(temporary,name+'.mjs'),code);
  }
  const {createInitialTaskBoard,taskBoardReducer,todayTasks}=await import(pathToFileURL(join(temporary,'reducer.mjs')));
  const {projectLiveBoardTasks}=await import(pathToFileURL(join(temporary,'live-task-import.mjs')));
  const {mockTaskBoardSource}=await import(pathToFileURL(join(temporary,'data-source.mjs')));
  const seed=createInitialTaskBoard(cutoff),seedJson=serial(seed.tasks);
  assert.equal(todayTasks(seed).length,12);
  let model=taskBoardReducer(seed,{type:'enable-live-import',now:cutoff});
  assert.equal(taskBoardReducer(model,{type:'enable-live-import',now:cutoff+5000}),model,'enable never moves the original cutoff');
  assert.equal(taskBoardReducer(seed,{type:'enable-live-import',now:Infinity}),seed);
  const projected=projectLiveBoardTasks([
    professional('later',at(3000)),professional('old',at(-1)),professional('new'),
  ],[group]);
  assert.equal(projected.length,5);
  assert.ok(projected.filter(task=>task.source.kind==='group')[0].title.startsWith('早餐：'),'one confirmation preserves original meal order');
  const threeMeals=projectLiveBoardTasks([],[{...group,plan:{...group.plan,days:[{...group.plan.days[0],dinner:'豆腐青菜'}]}}]);
  assert.deepEqual(threeMeals.map(task=>task.steps[0].name),['早餐','午餐','晚餐'],'equal confirmation timestamps preserve original three-meal projection order');
  assert.ok(projected.every(task=>task.id.length<=128&&/^[a-zA-Z0-9:_-]+$/.test(task.id)));
  const chest=projected.find(task=>task.source.id==='new');
  assert.equal(chest.status,'todo');assert.deepEqual(chest.steps[0].sets,{total:3,done:0});assert.equal(chest.steps[0].restSeconds,90);
  assert.ok(chest.steps[0].detail.includes('8–12次'));assert.ok(chest.steps[0].detail.includes('按给定重量完成'));
  assert.ok(chest.steps[0].tips.includes('肩痛停止'));assert.equal(chest.steps[0].timerSeconds,120);
  assert.equal(taskBoardReducer(seed,{type:'import-tasks',tasks:projected}),seed,'import needs its persisted opt-in');
  model=taskBoardReducer(model,{type:'import-tasks',tasks:projected});
  assert.equal(model.tasks.length,seed.tasks.length+4);assert.equal(todayTasks(model).length,16);
  assert.equal(serial(model.tasks.slice(0,seed.tasks.length)),seedJson,'all previous tasks remain byte-for-byte unchanged');
  assert.ok(model.tasks.slice(0,seed.tasks.length).every((task,index)=>task===seed.tasks[index]),'old task objects are preserved');
  const added=model.tasks.slice(seed.tasks.length);
  assert.ok(added.every(task=>task.date===model.today&&task.appendOrder!==undefined&&!task.pinned));
  assert.ok(added.every((task,index)=>index===0||task.appendOrder===added[index-1].appendOrder+1));
  assert.ok(added.every((task,index)=>index===0||task.order>added[index-1].order));
  assert.equal(added.find(task=>task.source.id==='new').source.originalDate,'2026-11-08');
  assert.equal(added[0].source.kind,'group','confirmedAt, rather than an old draft time, is the actionable creation event');
  assert.equal(taskBoardReducer(model,{type:'import-tasks',tasks:projected}),model,'repeated polls do not duplicate');
  model=taskBoardReducer(model,{type:'toggle-step',taskId:added[0].id,stepId:added[0].steps[0].id,now:cutoff+10000});
  const changed=structuredClone(projected);changed.forEach(task=>{task.title='源修订';task.source.revision=2;});
  assert.equal(taskBoardReducer(model,{type:'import-tasks',tasks:changed}),model,'source revisions never overwrite local snapshots or progress');
  const pinned=taskBoardReducer(model,{type:'pin',taskId:added[0].id});
  assert.equal(pinned.tasks.find(task=>task.id===added[0].id).appendOrder,added[0].appendOrder,'local actions retain append identity');
  const collision={...chest,id:added[0].id,source:{...chest.source,key:'professional:chen-nian:different',id:'different',createdAt:at(20000)}};
  const collided=taskBoardReducer(model,{type:'import-tasks',tasks:[collision,collision]});
  assert.equal(collided.tasks.length,model.tasks.length+1,'full keys distinguish short-ID collisions and deduplicate a payload');
  assert.equal(new Set(collided.tasks.map(task=>task.id)).size,collided.tasks.length);
  assert.equal(projectLiveBoardTasks([],[{...group,leftAt:at(500)}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...group,plan:{...group.plan,status:'draft'}}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...group,plan:undefined}]).length,0,'untimestamped standalone reminders are not imported');
  assert.equal(projectLiveBoardTasks([],[{...group,plan:{...group.plan,createdAt:'',confirmedAt:undefined}}]).length,0,'chat updatedAt is never a creation-time fallback');
  const userConfirmation={id:'user-confirmation',senderId:'self',senderName:'用户',type:'text',text:'合成确认原文，不解析其中语义',at:at(4000)};
  const systemConfirmation={id:'system-confirmation',senderId:'system',senderName:'系统',type:'event',event:{kind:'reminder-confirmed',reminderId:'synthetic-reminder'},at:at(5000)};
  const standalone={...group,plan:undefined,messages:[userConfirmation,systemConfirmation],reminders:[{...group.reminders[0],confirmationMessageId:userConfirmation.id}]};
  const userReminder=projectLiveBoardTasks([],[standalone]);
  assert.equal(userReminder.length,1);assert.equal(userReminder[0].type,'single');assert.equal(userReminder[0].source.createdAt,userConfirmation.at);
  assert.equal(userReminder[0].source.key,'group-reminder:synthetic-group:synthetic-reminder');
  assert.equal(userReminder[0].source.originalDate,'2026-11-09');assert.ok(userReminder[0].note.includes('2026-11-09 至 2026-11-09'));
  const eventReminder=projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],confirmationMessageId:systemConfirmation.id}]}]);
  assert.equal(eventReminder.length,1);assert.equal(eventReminder[0].source.createdAt,systemConfirmation.at,'system confirmation events are accepted too');
  assert.equal(eventReminder[0].source.key,userReminder[0].source.key,'confirmation pointers do not change reminder identity');
  assert.equal(projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],status:'paused'}]}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],status:'cancelled'}]}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],time:'25:00'}]}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],startDate:'2026-11-10'}]}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...standalone,reminders:[{...standalone.reminders[0],confirmationMessageId:'missing'}]}]).length,0);
  assert.equal(projectLiveBoardTasks([],[{...standalone,messages:[{...userConfirmation,at:'invalid'}]}]).length,0);
  const planWithReminder={...standalone,plan:{...group.plan,confirmationMessageId:userConfirmation.id}};
  const merged=projectLiveBoardTasks([],[planWithReminder],at(0));
  assert.equal(merged.length,2,'new matching plan meals include the reminder without a duplicate standalone row');
  assert.ok(merged[0].steps[0].detail.includes('08:00'));
  const fallbackPlan=projectLiveBoardTasks([],[{...group,messages:[userConfirmation],plan:{...group.plan,confirmedAt:undefined,confirmationMessageId:userConfirmation.id}}]);
  assert.ok(fallbackPlan.every(task=>task.source.createdAt===userConfirmation.at),'a plan can use its exact user confirmation pointer before falling back to draft creation');
  const oldPlanNewReminder=projectLiveBoardTasks([],[{...planWithReminder,plan:{...group.plan,createdAt:at(-3000),confirmedAt:at(-2000)}}],at(0));
  assert.equal(oldPlanNewReminder.filter(task=>task.source.key.startsWith('group-reminder:')).length,1,'an excluded old plan cannot suppress a new confirmed reminder');
  const importedReminder=taskBoardReducer(model,{type:'import-tasks',tasks:oldPlanNewReminder});
  assert.equal(importedReminder.tasks.length,model.tasks.length+1);assert.equal(importedReminder.tasks.at(-1).source.key,userReminder[0].source.key);
  assert.equal(taskBoardReducer(importedReminder,{type:'import-tasks',tasks:projectLiveBoardTasks([],[{...standalone,updatedAt:at(9000)}],at(0))}),importedReminder,'pause/resume or a refreshed group cannot append the same reminder again');
  const oldPlan=projectLiveBoardTasks([],[{...group,updatedAt:at(99999),plan:{...group.plan,createdAt:at(-3000),confirmedAt:at(-2000)}}]);
  assert.equal(taskBoardReducer(model,{type:'import-tasks',tasks:oldPlan}),model,'chat activity does not move an old confirmed plan past cutoff');
  assert.equal(taskBoardReducer(model,{type:'import-tasks',tasks:projectLiveBoardTasks([professional('boundary',at(0))],[])}).tasks.length,model.tasks.length+1,'cutoff is inclusive');
  const storage=new Map();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  await mockTaskBoardSource.save('synthetic-a',collided);
  const reloaded=await mockTaskBoardSource.load('synthetic-a',cutoff+99999);
  assert.deepEqual(reloaded.liveImport,collided.liveImport);assert.equal(serial(reloaded.tasks),serial(collided.tasks),'source/append metadata survives JSON persistence');
  assert.equal(taskBoardReducer(reloaded,{type:'import-tasks',tasks:projected}),reloaded,'refresh does not duplicate');
  const other=await mockTaskBoardSource.load('synthetic-b',cutoff);
  assert.equal(other.liveImport,undefined);assert.equal(todayTasks(other).length,12,'another account keeps its own demo snapshot');
  await mockTaskBoardSource.save('synthetic-old',seed);
  const legacy=await mockTaskBoardSource.load('synthetic-old',cutoff);
  assert.equal(serial(legacy.tasks),seedJson);assert.equal(legacy.liveImport,undefined,'old v1 demo snapshots remain compatible');
  const invalid=structuredClone(collided);invalid.tasks.at(-1).appendOrder=-1;
  await mockTaskBoardSource.save('synthetic-invalid',invalid);
  assert.equal((await mockTaskBoardSource.load('synthetic-invalid',cutoff)).liveImport,undefined,'invalid new metadata is not accepted');
  console.log('PASS: seed preservation, cutoff, append order, deduplication, local progress, source boundaries, short-ID collision, account-scoped persistence and old snapshots.');
} finally {
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else delete globalThis.window;
  if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;
  rmSync(temporary,{recursive:true,force:true});
}
