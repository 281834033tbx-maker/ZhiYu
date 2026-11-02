import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { chefLocal } from './zhou-chef-plugin';
import type { generate } from './codex';
import { createChef } from '../../lib/npc/zhou-chef';
import { applyProfessionalTaskOperation, mutateProfessionalTaskStep, parseProfessionalTaskOperation, professionalTaskProgress, type ProfessionalTask } from '../../lib/npc/professional-task';
import { freezeProfessionalTaskTimers, mutateProfessionalTaskTimer, professionalTaskStepContent, professionalTaskTimerView } from '../../lib/npc/professional-task-timer';

const initialTime=Date.parse('2026-10-10T08:00:00.000Z');
const proposal = (steps:unknown[]=[{title:'炸土豆',instructions:['沥干土豆表面的水。','按菜谱下锅炸5分钟。'],notes:['下锅前擦干，避免热油飞溅。'],completionCondition:'表面金黄，用筷子可以轻松扎透。',durationSeconds:300},{title:'炸茄子',details:['按菜谱处理茄子。'],durationSeconds:600}]) => ({
  decision:'create',basis:'execution_commitment',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'source',evidence:'我要做地三鲜。',title:'地三鲜',goalKey:'地三鲜',steps,
});
function createTask(steps?:unknown[]) {
  const tasks:ProfessionalTask[]=[];
  return applyProfessionalTaskOperation(tasks,parseProfessionalTaskOperation(proposal(steps)),[{id:'source',text:'我要做地三鲜。'}],[],initialTime)!.task;
}
const timerOp=(task:ProfessionalTask,index:number,op:'start'|'pause'|'resume',now=initialTime) => mutateProfessionalTaskTimer(task,task.steps[index].id,op,task.revision,now);

void test('新结构操作/注意/完成标准分开，旧details兼容且原内容不丢',()=>{
  const task=createTask([{title:'调好料汁',details:['碗里放生抽。','原有额外说明。'],instructions:['碗里放生抽。','搅匀料汁。'],notes:['先不用加盐。'],completionCondition:'料汁混合均匀。'}]);
  assert.deepEqual(professionalTaskStepContent(task.steps[0]),{instructions:['碗里放生抽。','搅匀料汁。'],notes:['先不用加盐。'],completionCondition:'料汁混合均匀。'});
  assert.ok(task.steps[0].details.includes('原有额外说明。'));assert.ok(task.steps[0].details.includes('注意：先不用加盐。'));
  const legacy=createTask([{title:'备料',details:['• 清洗土豆。\n切成滚刀块。','注意事项：下锅前擦干。','完成状态：表面没有水。']}]);
  assert.deepEqual(professionalTaskStepContent(legacy.steps[0]),{instructions:['清洗土豆。','切成滚刀块。'],notes:['下锅前擦干。'],completionCondition:'表面没有水。'});
  const multiline=createTask([{title:'备料',instructions:['操作：先洗。\n再切。'],notes:['注意：擦干。'],completionCondition:'完成状态：材料准备好。'}]);
  assert.deepEqual(professionalTaskStepContent(multiline.steps[0]),{instructions:['先洗。','再切。'],notes:['擦干。'],completionCondition:'材料准备好。'});
});

void test('截图中的旧料汁步骤按明确提示/完成语法分组，后续操作回正文且不改原数据',()=>{
  const task=createTask([{title:'调好料汁',details:[
    '碗里放生抽15毫升、老抽2毫升（可省略）、白糖3克、淀粉4克和清水60毫升，搅匀。',
    '先不额外加盐，生抽和腌过的茄子已经带咸味。',
    '完成状态：调料混合均匀。放旁边备用，入锅前重新搅匀，防止淀粉沉底。',
  ]}]),before=JSON.stringify(task);
  assert.deepEqual(professionalTaskStepContent(task.steps[0]),{
    instructions:['碗里放生抽15毫升、老抽2毫升（可省略）、白糖3克、淀粉4克和清水60毫升，搅匀。','放旁边备用，入锅前重新搅匀，防止淀粉沉底。'],
    notes:['先不额外加盐，生抽和腌过的茄子已经带咸味。'],completionCondition:'调料混合均匀。',
  });
  assert.equal(JSON.stringify(task),before);assert.equal(professionalTaskTimerView(task.steps[0]).showTimer,false);
  const legacy=createTask([{title:'下锅',details:['沥干土豆表面的水。','切勿带水下锅。','避免让热油溅到手。','注意油温。','完成标准：表面金黄。筷子能轻松扎透。']}]);
  assert.deepEqual(professionalTaskStepContent(legacy.steps[0]),{instructions:['沥干土豆表面的水。'],notes:['切勿带水下锅。','避免让热油溅到手。','注意油温。'],completionCondition:'表面金黄。筷子能轻松扎透。'});
  const structured=createTask([{title:'调味',instructions:['避免一次放太多盐，尝过后再加。'],completionCondition:'料汁均匀。放置后没有结块。'}]);
  assert.deepEqual(professionalTaskStepContent(structured.steps[0]),{instructions:['避免一次放太多盐，尝过后再加。'],notes:[],completionCondition:'料汁均匀。放置后没有结块。'});
});

void test('短动作无计时，长动作时长受界限校验；模型不能自己启动',()=>{
  for (const durationSeconds of [undefined,30,60,119]) {
    const task=createTask([{title:'炒青椒',details:['按步骤炒。'],...(durationSeconds?{durationSeconds}:{})}]);
    assert.equal(task.steps[0].durationSeconds,undefined);assert.equal(professionalTaskTimerView(task.steps[0]).showTimer,false);
    assert.throws(()=>timerOp(task,0,'start'),/不需要计时/);
  }
  for (const durationSeconds of [120,300,86_400]) assert.equal(createTask([{title:'慢煮',instructions:['按步骤煮。'],durationSeconds}]).steps[0].durationSeconds,durationSeconds);
  for (const durationSeconds of [0,-1,1.2,86_401,Infinity,'300']) assert.throws(()=>parseProfessionalTaskOperation(proposal([{title:'慢煮',details:['按步骤煮。'],durationSeconds}])),/时长无效/);
  const task=createTask([{title:'慢煮',instructions:['按步骤煮。'],durationSeconds:300,timer:{status:'running'}}]);
  assert.equal(task.steps[0].timer,undefined);assert.equal(professionalTaskTimerView(task.steps[0],initialTime).status,'idle');
  assert.throws(()=>parseProfessionalTaskOperation(proposal([{title:'缺操作',notes:['不要烫到。']}])),/可操作内容/);
});

void test('点击开始按真实起点倒计时，重开可恢复且到点不完成步骤',()=>{
  const task=createTask(),step=task.steps[0];
  assert.equal(timerOp(task,0,'start'),true);assert.equal(task.revision,2);
  const running=professionalTaskTimerView(step,initialTime+60_001);
  assert.equal(running.status,'running');assert.equal(running.remainingSeconds,240);assert.equal(running.showTimer,true);assert.ok(Math.abs(running.progress-60_001/300_000)<1e-12);
  const restored=JSON.parse(JSON.stringify(task)) as ProfessionalTask;
  assert.equal(professionalTaskTimerView(restored.steps[0],initialTime+90_000).remainingSeconds,210);
  assert.deepEqual(professionalTaskTimerView(restored.steps[0],initialTime+300_000),{status:'elapsed',remainingSeconds:0,progress:1,showTimer:true});
  assert.equal(restored.steps[0].completedAt,undefined);assert.equal(restored.status,'active');assert.equal(professionalTaskProgress(restored).completed,0);
  assert.equal(timerOp(restored,0,'start',initialTime+500_000),false,'start replay must not reset elapsed timer');
});

void test('暂停精确保留毫秒，恢复重新锚定，暂停期间不会流逝',()=>{
  const task=createTask();timerOp(task,0,'start');timerOp(task,0,'pause',initialTime+41_125);
  assert.equal(task.steps[0].timer!.remainingMs,258_875);assert.equal(task.steps[0].timer!.startedAt,undefined);
  assert.equal(professionalTaskTimerView(task.steps[0],initialTime+5_000_000).remainingSeconds,259);
  assert.equal(timerOp(task,0,'pause',initialTime+5_000_000),false);
  assert.equal(timerOp(task,0,'start',initialTime+5_000_000),false);
  timerOp(task,0,'resume',initialTime+5_000_000);
  assert.equal(professionalTaskTimerView(task.steps[0],initialTime+5_010_000).remainingSeconds,249);
  assert.equal(timerOp(task,0,'resume',initialTime+5_010_000),false);
});

void test('两个锅可独立同时运行，完成/撤销不自动恢复计时',()=>{
  const task=createTask();timerOp(task,0,'start');timerOp(task,1,'start',initialTime+10_000);
  assert.equal(professionalTaskTimerView(task.steps[0],initialTime+20_000).status,'running');assert.equal(professionalTaskTimerView(task.steps[1],initialTime+20_000).status,'running');
  mutateProfessionalTaskStep(task,task.steps[0].id,true,task.revision,initialTime+20_000);
  assert.equal(task.steps[0].timer!.status,'paused');assert.equal(task.steps[0].timer!.remainingMs,280_000);
  assert.equal(task.steps[1].timer!.status,'running');assert.throws(()=>timerOp(task,0,'resume'),/已结束/);
  mutateProfessionalTaskStep(task,task.steps[0].id,false,task.revision,initialTime+30_000);
  assert.equal(task.steps[0].timer!.status,'paused');assert.equal(task.steps[0].completedAt,undefined);
  timerOp(task,0,'resume',initialTime+40_000);assert.equal(professionalTaskTimerView(task.steps[0],initialTime+50_000).remainingSeconds,270);
});

void test('任务暂停冻结所有锅，恢复任务不自动计时，取消后禁止恢复',()=>{
  const task=createTask();timerOp(task,0,'start');timerOp(task,1,'start');
  const control=(decision:'pause'|'resume'|'cancel',text:string,now:number)=>applyProfessionalTaskOperation([task],parseProfessionalTaskOperation({decision,basis:'existing_task_change',scope:'current_user',polarity:'affirmed',confidence:.95,taskId:task.id,sourceMessageId:'control',evidence:text}),[{id:'control',text}],[],now);
  control('pause','暂停当前任务。',initialTime+30_000);assert.equal(task.status,'paused');assert.ok(task.steps.every(step=>step.timer!.status==='paused'));
  assert.throws(()=>timerOp(task,0,'resume'),/先继续任务/);
  control('resume','继续当前任务。',initialTime+300_000);assert.equal(task.status,'active');assert.ok(task.steps.every(step=>step.timer!.status==='paused'));
  timerOp(task,1,'resume',initialTime+300_000);control('cancel','结束当前任务。',initialTime+330_000);
  assert.equal(task.status,'cancelled');assert.equal(task.steps[1].timer!.remainingMs,540_000);assert.throws(()=>timerOp(task,1,'resume'),/已结束/);
});

void test('到点后冻结成为elapsed；版本冲突和未知步骤不修改任务',()=>{
  const task=createTask();timerOp(task,0,'start');assert.equal(freezeProfessionalTaskTimers(task,initialTime+400_000),true);
  assert.equal(task.steps[0].timer!.status,'elapsed');assert.equal(task.steps[0].timer!.remainingMs,0);assert.equal(task.steps[0].completedAt,undefined);
  const before=JSON.stringify(task);
  assert.throws(()=>mutateProfessionalTaskTimer(task,task.steps[0].id,'pause',1,initialTime+400_000),/任务已更新/);
  assert.throws(()=>mutateProfessionalTaskTimer(task,'unknown','start',task.revision,initialTime+400_000),/步骤不存在/);
  assert.equal(JSON.stringify(task),before);
});

void test('修改时长/动作清除旧计时，原方案和原计时留在历史；未改的锅继续',()=>{
  const task=createTask();timerOp(task,0,'start');timerOp(task,1,'start');
  const raw={...proposal(task.steps.map((step,index)=>({id:step.id,title:step.title,details:step.details,...(step.instructions?{instructions:step.instructions}:{}),...(step.notes?{notes:step.notes}:{}),...(step.completionCondition?{completionCondition:step.completionCondition}:{}),durationSeconds:index===0?420:step.durationSeconds}))),decision:'update',basis:'existing_task_change',taskId:task.id,sourceMessageId:'edit',evidence:'炸土豆改成7分钟。'};
  applyProfessionalTaskOperation([task],parseProfessionalTaskOperation(raw),[{id:'edit',text:'炸土豆改成7分钟。'}],[],initialTime+20_000);
  assert.equal(task.steps[0].timer,undefined);assert.equal(task.steps[0].durationSeconds,420);
  assert.equal(task.steps[1].timer!.status,'running');assert.equal(task.previousPlans![0].steps[0].timer!.remainingMs,300_000);
  assert.equal(task.previousPlans![0].steps[0].durationSeconds,300);
});

type Snapshot=ReturnType<typeof createChef> & {professionalTasks:ProfessionalTask[];error?:string;code?:string};
function fixture(root:string,now:()=>number,onGenerate:()=>void,runner?:typeof generate) {
  if (runner) cpSync(join(process.cwd(),'npc-skills'),join(root,'npc-skills'),{recursive:true});
  let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{};
  const server=new EventEmitter(),plugin=chefLocal({available:()=>!!runner,generate:async(...args)=>{onGenerate();if(runner)return runner(...args);throw Error('isolated fixture must remain offline');},now});
  (plugin.configureServer as (server:ViteDevServer)=>void)({config:{root},httpServer:server,middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}}} as unknown as ViteDevServer);
  const request=(owner:string,method:string,body?:unknown)=>new Promise<{status:number;data:Snapshot}>(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as IncomingMessage;req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:owner?`zhiyu_npc=${owner}`:''};
    const res={statusCode:200,writableEnded:false,setHeader:()=>{},end(text:string){this.writableEnded=true;resolve({status:this.statusCode,data:JSON.parse(text)});}};
    handler(req,res as unknown as ServerResponse);
  });
  return {get:(owner:string)=>request(owner,'GET'),post:(owner:string,body:unknown)=>request(owner,'POST',body),close:()=>server.emit('close')};
}

void test('真实中间件计时幂等/冲突/账号隔离，跨窗和重开读取同一起点；不发模型/用户消息/关系/记忆',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-timer-api-'));let clock=initialTime,calls=0;
  const owner=crypto.randomUUID(),other=crypto.randomUUID();let api=fixture(root,()=>clock,()=>calls++);
  try {
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
    const seed=createChef(),task=createTask();seed.professionalTasks=[task];
    try{db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(`${owner}:zhou-chef`,JSON.stringify(seed));}finally{db.close();}
    assert.equal((await api.get('')).status,401);
    const command={action:'task_timer',taskId:task.id,stepId:task.steps[0].id,operation:'start',eventId:crypto.randomUUID(),expectedRevision:task.revision};
    assert.equal((await api.post(other,command)).status,404);
    const started=await api.post(owner,command);assert.equal(started.status,200);assert.equal(started.data.professionalTasks[0].revision,2);
    assert.equal((await api.post(owner,command)).status,200);assert.equal((await api.post(owner,{...command,operation:'pause'})).status,409);
    const conflict=await api.post(owner,{...command,eventId:crypto.randomUUID()});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'TASK_REVISION_CONFLICT');
    clock+=40_000;const windowTwo=(await api.get(owner)).data;
    assert.equal(professionalTaskTimerView(windowTwo.professionalTasks[0].steps[0],clock).remainingSeconds,260);
    assert.deepEqual((await api.get(other)).data.professionalTasks,[]);
    api.close();api=fixture(root,()=>clock,()=>calls++);
    const restored=(await api.get(owner)).data;assert.equal(restored.professionalTasks[0].steps[0].timer!.startedAt,new Date(initialTime).toISOString());
    let updated=restored.professionalTasks[0];
    const pause=await api.post(owner,{...command,operation:'pause',eventId:crypto.randomUUID(),expectedRevision:updated.revision});assert.equal(pause.status,200);updated=pause.data.professionalTasks[0];
    clock+=300_000;assert.equal(professionalTaskTimerView((await api.get(owner)).data.professionalTasks[0].steps[0],clock).remainingSeconds,260);
    const resume=await api.post(owner,{...command,operation:'resume',eventId:crypto.randomUUID(),expectedRevision:updated.revision});assert.equal(resume.status,200);updated=resume.data.professionalTasks[0];
    clock+=260_000;assert.equal(professionalTaskTimerView((await api.get(owner)).data.professionalTasks[0].steps[0],clock).status,'elapsed');
    const cancelled=await api.post(owner,{action:'task_status',taskId:task.id,status:'cancelled',eventId:crypto.randomUUID(),expectedRevision:updated.revision});assert.equal(cancelled.status,200);updated=cancelled.data.professionalTasks[0];
    assert.equal(updated.steps[0].timer!.status,'elapsed');assert.equal((await api.post(owner,{...command,eventId:crypto.randomUUID(),expectedRevision:updated.revision})).status,400);
    const storedDb=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'),{readOnly:true});
    try{const row=storedDb.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`) as {data:string};const stored=JSON.parse(row.data);assert.deepEqual(stored.messages,seed.messages);assert.deepEqual(stored.memories,seed.memories);assert.deepEqual(stored.values,seed.values);assert.equal(stored.inputRevision,seed.inputRevision+1,'only task cancellation changes inputRevision');assert.deepEqual(stored.taskEvents,[]);}finally{storedDb.close();}
    assert.equal(calls,0);
  } finally {api.close();rmSync(root,{recursive:true,force:true});}
});

void test('API任务暂停冻结计时且恢复任务不自动播放；勾选与结束同样冻结',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-timer-status-'));let clock=initialTime;
  const owner=crypto.randomUUID(),api=fixture(root,()=>clock,()=>assert.fail('unexpected model call'));
  try {
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite')),seed=createChef();seed.professionalTasks=[createTask()];
    try{db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(`${owner}:zhou-chef`,JSON.stringify(seed));}finally{db.close();}
    let task=seed.professionalTasks[0];
    const post=async(body:Record<string,unknown>)=>{const result=await api.post(owner,{taskId:task.id,eventId:crypto.randomUUID(),expectedRevision:task.revision,...body});assert.equal(result.status,200);task=result.data.professionalTasks[0];return result;};
    await post({action:'task_timer',stepId:task.steps[0].id,operation:'start'});await post({action:'task_timer',stepId:task.steps[1].id,operation:'start'});
    clock+=10_000;await post({action:'task_status',status:'paused'});assert.ok(task.steps.every(step=>step.timer!.status==='paused'));
    clock+=60_000;await post({action:'task_status',status:'active'});assert.ok(task.steps.every(step=>step.timer!.status==='paused'));
    await post({action:'task_timer',stepId:task.steps[0].id,operation:'resume'});clock+=20_000;await post({action:'task_step',stepId:task.steps[0].id,completed:true});assert.equal(task.steps[0].timer!.remainingMs,270_000);
    await post({action:'task_step',stepId:task.steps[0].id,completed:false});assert.equal(task.steps[0].timer!.status,'paused');
    await post({action:'task_timer',stepId:task.steps[0].id,operation:'resume'});await post({action:'task_step',stepId:task.steps[0].id,completed:true});await post({action:'task_step',stepId:task.steps[1].id,completed:true});assert.equal(task.status,'completed');assert.ok(task.steps.every(step=>step.timer!.status==='paused'));
  } finally {api.close();rmSync(root,{recursive:true,force:true});}
});

void test('计时保留在途下一步提示；结束任务会取消在途回复且不能恢复任务/计时',async()=>{
  const root=mkdtempSync(join(tmpdir(),'professional-timer-pending-'));let clock=initialTime,calls=0;
  const releases:((value:unknown)=>void)[]=[],owner=crypto.randomUUID();
  const runner:typeof generate=async()=>new Promise(resolve=>releases.push(resolve));
  const api=fixture(root,()=>clock,()=>calls++,runner);
  const until=async(check:()=>boolean)=>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('isolated event not completed');};
  const reply=(text:string)=>({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task:{decision:'none'}});
  try {
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite')),seed=createChef();seed.professionalTasks=[createTask()];
    try{db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(`${owner}:zhou-chef`,JSON.stringify(seed));}finally{db.close();}
    let task=seed.professionalTasks[0];
    const post=async(body:Record<string,unknown>)=>{const result=await api.post(owner,{taskId:task.id,eventId:crypto.randomUUID(),expectedRevision:task.revision,...body});assert.equal(result.status,200);task=result.data.professionalTasks[0];return result;};
    await post({action:'task_step',stepId:task.steps[0].id,completed:true});await until(()=>calls===1);
    await post({action:'task_timer',stepId:task.steps[1].id,operation:'start'});
    releases[0](reply('先把茄子表面的水擦干再下锅。'));await new Promise(resolve=>setTimeout(resolve,30));clock+=60_000;
    const afterTimer=(await api.get(owner)).data;task=afterTimer.professionalTasks[0];
    assert.ok(afterTimer.messages.some(message=>'text'in message.part&&message.part.text==='先把茄子表面的水擦干再下锅。'));
    assert.equal(task.steps[1].timer!.status,'running');assert.equal(task.steps[1].hints.length,1);
    await post({action:'task_step',stepId:task.steps[0].id,completed:false});await post({action:'task_step',stepId:task.steps[0].id,completed:true});await until(()=>calls===2);
    clock+=10_000;await post({action:'task_status',status:'cancelled'});const cancelledRevision=task.revision,remaining=task.steps[1].timer!.remainingMs;
    releases[1](reply('结束后不应送达的旧提示。'));await new Promise(resolve=>setTimeout(resolve,30));clock+=60_000;
    const cancelled=(await api.get(owner)).data;
    assert.equal(cancelled.professionalTasks[0].status,'cancelled');assert.equal(cancelled.professionalTasks[0].revision,cancelledRevision);
    assert.equal(cancelled.professionalTasks[0].steps[1].timer!.status,'paused');assert.equal(cancelled.professionalTasks[0].steps[1].timer!.remainingMs,remaining);
    assert.equal(cancelled.messages.some(message=>'text'in message.part&&message.part.text==='结束后不应送达的旧提示。'),false);
    assert.equal(calls,2);
  } finally {api.close();rmSync(root,{recursive:true,force:true});}
});

void test('三组训练仅有两次独立休息，刷新到期/暂停/继续不丢次数且不重置动作时长',()=>{
  const task=createTask([{title:'平板推胸',instructions:['按计划完成每组。'],training:{target:'中胸',sets:3,reps:'8～10次',restSeconds:180}}]),step=task.steps[0];
  assert.equal(step.durationSeconds,undefined);
  assert.deepEqual(professionalTaskTimerView(step,initialTime),{status:'idle',remainingSeconds:180,progress:0,showTimer:true,kind:'rest',completedCycles:0,maxCycles:2,canRestart:false});
  timerOp(task,0,'start');assert.equal(step.timer!.kind,'rest');
  assert.equal(timerOp(task,0,'start',initialTime+30_000),false,'a duplicate start cannot restart an active rest');
  timerOp(task,0,'pause',initialTime+40_125);assert.equal(step.timer!.remainingMs,139_875);assert.equal(step.timer!.completedCycles,0);
  assert.equal(professionalTaskTimerView(step,initialTime+400_000).remainingSeconds,140);
  timerOp(task,0,'resume',initialTime+400_000);
  const restored=JSON.parse(JSON.stringify(task)) as ProfessionalTask;
  const expired=professionalTaskTimerView(restored.steps[0],initialTime+540_000);
  assert.equal(expired.status,'elapsed');assert.equal(expired.completedCycles,1);assert.equal(expired.canRestart,true);
  assert.equal(restored.steps[0].completedAt,undefined,'rest expiry must not complete the exercise');
  assert.equal(timerOp(restored,0,'start',initialTime+540_000),true);
  assert.equal(restored.steps[0].timer!.completedCycles,1);assert.equal(restored.steps[0].timer!.remainingMs,180_000);
  const final=professionalTaskTimerView(restored.steps[0],initialTime+720_000);
  assert.equal(final.completedCycles,2);assert.equal(final.canRestart,false);
  assert.throws(()=>timerOp(restored,0,'start',initialTime+720_000),/休息已全部完成/);
  freezeProfessionalTaskTimers(restored,initialTime+720_000);
  assert.equal(restored.steps[0].timer!.status,'elapsed');assert.equal(restored.steps[0].timer!.completedCycles,2);
  assert.equal(professionalTaskTimerView(restored.steps[0],initialTime+900_000).completedCycles,2,'persisted elapsed cycle cannot be counted twice');
});

void test('提示/单组/零休息无计时，短休息可用；历史单次timer不被训练休息字段改义',()=>{
  for(const training of [undefined,{target:'胸',sets:1,reps:'12',restSeconds:180},{target:'胸',sets:3,reps:'12',restSeconds:0}]) {
    const task=createTask([{title:'提示',instructions:['确认位置后自行操作。'],...(training?{training}:{})}]);
    assert.equal(professionalTaskTimerView(task.steps[0]).showTimer,false);assert.throws(()=>timerOp(task,0,'start'),/不需要计时/);
  }
  const short=createTask([{title:'短休息训练',instructions:['完成两组。'],training:{target:'胸',sets:2,reps:'12',restSeconds:60}}]);
  assert.equal(professionalTaskTimerView(short.steps[0]).remainingSeconds,60);
  timerOp(short,0,'start');assert.equal(professionalTaskTimerView(short.steps[0],initialTime+60_000).canRestart,false);
  const historical=createTask([{title:'旧动作',instructions:['原有计时。'],durationSeconds:600,training:{target:'胸',sets:3,reps:'12',restSeconds:180}}]);
  historical.steps[0].timer={status:'running',remainingMs:600_000,startedAt:new Date(initialTime).toISOString(),updatedAt:new Date(initialTime).toISOString()};
  const oldView=professionalTaskTimerView(historical.steps[0],initialTime+60_000);
  assert.equal(oldView.remainingSeconds,540);assert.equal(oldView.kind,undefined);
  assert.equal(timerOp(historical,0,'start',initialTime+900_000),false,'historical one-shot must not become repeatable');
  timerOp(short,0,'pause',initialTime+30_000);mutateProfessionalTaskStep(short,short.steps[0].id,true,short.revision,initialTime+30_000);
  assert.throws(()=>timerOp(short,0,'resume',initialTime+40_000),/已结束/);
});
