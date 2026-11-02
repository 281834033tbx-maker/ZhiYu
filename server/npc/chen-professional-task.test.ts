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
import type { generate } from './codex';
import { chenLocal } from './chen-plugin';
import { chenPrompt } from './chen-prompt';
import { createChen, normalizeChen, parseChen, applyChen, chenTaskDelegationEvidence } from '../../lib/npc/chen-nian';
import { parseProfessionalTaskOperation, mutateProfessionalTaskStepDate, professionalTaskDateOptions, type ProfessionalTask } from '../../lib/npc/professional-task';
import { professionalTaskTimerView } from '../../lib/npc/professional-task-timer';

const now=Date.parse('2026-10-31T16:10:00Z'); // Shanghai Nov 1, crosses month and host-day.
const input='我现在要练胸，给我一个胸部训练任务。';
const reply=(text='老大，动作都在任务里了👌')=>({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task:{decision:'none'}});
const proposal=(id='source',extra:Record<string,unknown>={})=>({decision:'create',basis:'explicit_request',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:id,evidence:input,title:'胸部训练',goalKey:'胸',steps:[
  {title:'上斜哑铃卧推',category:'main',training:{target:'上胸',sets:4,reps:'12~15次',restSeconds:120,effort:'保留1~2次规范动作余力',recommendation:'用可控幅度训练上胸'},instructions:['沉肩、手腕保持中立，哑铃缓慢下降。'],notes:['动作失稳时停止。'],completionCondition:'完成本次4组'},
  {title:'坐姿夹胸',category:'accessory',scheduledDate:'2026-11-02',training:{target:'中胸',sets:3,reps:'12~15次'},instructions:['握把在胸部高度，稳定躯干再夹合。'],completionCondition:'完成3组'},
],...extra});
const stateWithInput=()=>{const s=createChen();s.messages.push({id:'source',turnId:'turn',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:input}});s.queue=['turn'];return s;};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await tick();}assert.fail('async test timed out');}

void test('陈年真实任务提案保存分类/训练数据/日期，普通问答不建卡，厨师任务不能混入',()=>{
  const s=stateWithInput();const applied=applyChen(s,parseChen({...reply(),task:proposal()},input),'reply',now)!;
  assert.equal(applied.created,true);assert.equal(s.professionalTasks[0].characterId,'chen-nian');
  assert.equal(s.messages.at(-1)!.part.type,'professional_task');assert.equal(s.professionalTasks[0].steps[0].scheduledDate,undefined);
  assert.equal(s.professionalTasks[0].steps[1].scheduledDate,'2026-11-02');assert.equal(s.professionalTasks[0].steps[0].training?.sets,4);
  applyChen(s,parseChen({...reply(),task:proposal()},input),'again',now);assert.equal(s.professionalTasks.length,1);
  const other=stateWithInput();other.professionalTasks.push({...s.professionalTasks[0],characterId:'zhou-chef'});
  assert.throws(()=>applyChen(other,parseChen({...reply(),task:proposal()},input),'wrong',now),/当前人物/);
  const ordinary=createChen();ordinary.messages.push({id:'query',turnId:'q',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'上胸在哪里？'}});ordinary.queue=['q'];
  applyChen(ordinary,parseChen(reply('胸部上方。'),'上胸在哪里？'),'answer',now);assert.equal(ordinary.professionalTasks.length,0);
  assert.throws(()=>parseChen({...reply(),messages:[{type:'professional_task',taskId:'forged'}]},input),/不支持/);
});

void test('日期契约校验真实日历、上海跨月范围与历史保留，无日期单次任务不能凭空变多日',()=>{
  const options=professionalTaskDateOptions(now);assert.equal(options.length,31);
  assert.deepEqual(options.slice(0,3),['2026-11-01','2026-11-02','2026-11-03']);assert.equal(options.at(-1),'2026-12-01');assert.ok(options.includes('2026-11-30'));
  for(const changes of [{scheduledDate:'2026-02-30'},{category:'random'},{training:{target:'上胸',sets:0,reps:'12'}},{training:{target:'上胸',sets:'4',reps:'12'}}])
    assert.throws(()=>parseProfessionalTaskOperation(proposal('source',{steps:[{...proposal().steps[0],...changes}]})));
  const s=stateWithInput();applyChen(s,parseChen({...reply(),task:proposal()},input),'reply',now);
  const task=s.professionalTasks[0],step=task.steps[1];step.scheduledDate='2026-09-08';const revision=task.revision;
  assert.equal(normalizeChen(s).professionalTasks[0].steps[1].scheduledDate,'2026-09-08');
  assert.throws(()=>mutateProfessionalTaskStepDate(task,step.id,'2026-11-09',revision,now),{code:'TASK_SKIPPED'});
  assert.equal(step.scheduledDate,'2026-09-08');assert.equal(step.skipReason,'day-ended');assert.ok(step.skippedAt);
  const fresh=stateWithInput();applyChen(fresh,parseChen({...reply(),task:proposal()},input),'fresh',now);
  const future=fresh.professionalTasks[0],futureStep=future.steps[1],futureRevision=future.revision;
  assert.throws(()=>mutateProfessionalTaskStepDate(future,futureStep.id,'2026-12-02',futureRevision,now),{code:'TASK_DATE_OUT_OF_RANGE'});
  assert.equal(mutateProfessionalTaskStepDate(future,futureStep.id,'2026-11-08',futureRevision,now),true);
  assert.throws(()=>mutateProfessionalTaskStepDate(future,futureStep.id,'2026-11-02',futureRevision,now),/同步/);
  assert.throws(()=>mutateProfessionalTaskStepDate(future,future.steps[0].id,'2026-11-02',future.revision,now),/当下单次/);
});

void test('陈年引用任务重显保留进度，新一份隔离旧进度并严格检查当前来源',()=>{
  const s=stateWithInput();applyChen(s,parseChen({...reply(),task:proposal()},input),'reply',now);const task=s.professionalTasks[0];
  task.steps[0].completedAt=new Date(now).toISOString();
  s.messages.push({id:'resend',turnId:'r',role:'user',replyTo:task.cardMessageId,at:new Date(now+1000).toISOString(),part:{type:'text',text:'再发一下'}});s.queue=['r'];
  const evidence=chenTaskDelegationEvidence(s,now+1000);assert.equal(evidence.sources[0].taskReference?.taskId,task.id);
  applyChen(s,parseChen({...reply(),task:proposal('resend',{evidence:'再发一下'})},'再发一下'),'resend-reply',now+1000);
  assert.equal(s.professionalTasks.length,1);assert.ok(task.steps[0].completedAt);assert.equal(task.cardMessageIds?.length,1);
  s.messages.push({id:'new',turnId:'n',role:'user',replyTo:task.cardMessageId,at:new Date(now+2000).toISOString(),part:{type:'text',text:'重新发一份新的给我'}});s.queue=['n'];
  applyChen(s,parseChen({...reply(),task:proposal('new',{evidence:'重新发一份新的给我',newInstance:true})},'重新发一份新的给我'),'new-reply',now+2000);
  assert.equal(s.professionalTasks.length,2);assert.equal(s.professionalTasks[1].steps[0].completedAt,undefined);
  assert.equal(s.professionalTasks[1].referenceTaskId,task.id);
});

type Snapshot={messages:ReturnType<typeof createChen>['messages'];professionalTasks:ProfessionalTask[];pending:boolean;revision:number;error?:string;code?:string;relationshipValues:unknown};
function fixture(root:string,runner:typeof generate,clock:()=>number){
  cpSync(join(process.cwd(),'npc-skills'),join(root,'npc-skills'),{recursive:true});
  let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{};const server=new EventEmitter();
  const plugin=chenLocal({available:()=>true,generate:runner,now:clock});
  (plugin.configureServer as (server:ViteDevServer)=>void)({config:{root},httpServer:server,middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}}} as unknown as ViteDevServer);
  const request=(owner:string,method:string,body?:unknown)=>new Promise<{status:number;data:Snapshot}>(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as IncomingMessage;req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:`zhiyu_npc=${owner}`};
    const res={statusCode:200,writableEnded:false,setHeader:()=>{},end(text:string){this.writableEnded=true;resolve({status:this.statusCode,data:JSON.parse(text)});}};handler(req,res as unknown as ServerResponse);
  });return{get:(owner:string)=>request(owner,'GET'),post:(owner:string,body:unknown)=>request(owner,'POST',body),close:()=>server.emit('close')};
}
void test('陈年任务API账号隔离、改期幂等/冲突/范围、完成提示与重开持久保存',async()=>{
  const root=mkdtempSync(join(tmpdir(),'chen-task-api-'));let clock=now,calls=0;const prompts:string[]=[];
  const runner:typeof generate=async(_root,prompt,options)=>{calls++;prompts.push(prompt);assert.equal(options?.characterId,'chen-nian');
    if(calls===1){const id=JSON.parse(/【本轮待回答的真实用户消息】([^\n]+)/.exec(prompt)![1]).at(-1).id;return{...reply(),task:proposal(id)};}
    assert.match(prompt,/未来|之后/);return reply('今天这一项做完了，下次按计划来。');};
  const owner=crypto.randomUUID(),other=crypto.randomUUID();let api=fixture(root,runner,()=>clock);
  try{
    await api.post(owner,{action:'send',text:input,turnId:crypto.randomUUID()});await until(()=>calls===1);await tick();clock+=60_000;
    let snap=(await api.get(owner)).data,task=snap.professionalTasks[0];assert.equal(snap.messages.filter(m=>m.part.type==='professional_task').length,1);
    const command={action:'task_step_date',taskId:task.id,stepId:task.steps[1].id,scheduledDate:'2026-11-08',expectedRevision:task.revision,eventId:crypto.randomUUID()};
    assert.equal((await api.post(other,command)).status,404);assert.equal((await api.post(owner,command)).status,200);assert.equal((await api.post(owner,command)).status,200);
    assert.equal((await api.post(owner,{...command,scheduledDate:'2026-11-07'})).status,409);
    assert.equal((await api.post(owner,{...command,eventId:crypto.randomUUID()})).data.code,'TASK_REVISION_CONFLICT');
    task=(await api.get(owner)).data.professionalTasks[0];assert.equal(task.steps[1].scheduledDate,'2026-11-08');
    assert.equal((await api.post(owner,{...command,scheduledDate:'2026-12-02',expectedRevision:task.revision,eventId:crypto.randomUUID()})).data.code,'TASK_DATE_OUT_OF_RANGE');
    const values=snap.relationshipValues,beforeUsers=snap.messages.filter(m=>m.role==='user').length;
    await api.post(owner,{action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,expectedRevision:task.revision,eventId:crypto.randomUUID()});await until(()=>calls===2);await tick();clock+=60_000;
    snap=(await api.get(owner)).data;assert.deepEqual(snap.relationshipValues,values);assert.equal(snap.messages.filter(m=>m.role==='user').length,beforeUsers);assert.equal(snap.professionalTasks[0].steps[1].hints.length,1);
    assert.match(prompts[1],/不能引导用户现在做明天/);assert.ok(snap.messages.some(m=>m.professionalTaskHint));
    api.close();api=fixture(root,runner,()=>clock);snap=(await api.get(owner)).data;
    assert.equal(snap.professionalTasks[0].steps[1].scheduledDate,'2026-11-08');assert.ok(snap.professionalTasks[0].steps[0].completedAt);assert.equal(calls,2);
    assert.deepEqual((await api.get(other)).data.professionalTasks,[]);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});
void test('生成提示覆盖真实能力与完整任务字段，历史消息不冒充新委托',()=>{
  const s=stateWithInput(),prompt=chenPrompt(process.cwd(),s,input,now);
  assert.match(prompt,/交互任务卡/);assert.match(prompt,/scheduledDate/);assert.match(prompt,/training/);assert.match(prompt,/不能.*精确/);assert.match(prompt,/本轮待回答的真实用户消息/);
  assert.doesNotMatch(prompt,/普通生成只收发文字与emoji/);
});

void test('明确未来三天胸背肩的完整文字不能被现有胸任务豁免；短缺口问题仍允许',()=>{
  const s=stateWithInput();applyChen(s,parseChen({...reply(),task:proposal()},input),'old-card',now);
  s.professionalTasks[0].steps[0].completedAt=new Date(now).toISOString();
  const text='给我规划未来三天的 胸背肩';
  s.messages.push({id:'future',turnId:'future-turn',role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text}});s.queue=['future-turn'];
  const original=JSON.stringify(s.professionalTasks);
  const full='11月2日练背\n1. 高位下拉3组\n2. 坐姿划船3组\n11月3日练肩\n1. 侧平举3组\n2. 推举3组\n11月4日练胸\n1. 上斜推胸3组\n2. 平板推胸3组';
  assert.throws(()=>applyChen(s,parseChen(reply(full),text),'missing-card',now+1000),/完整流程应放进任务卡/);
  assert.equal(JSON.stringify(s.professionalTasks),original);
  applyChen(s,parseChen(reply('这三天都在健身房练吗？'),text),'clarification',now+1000);
  assert.equal(s.professionalTasks.length,1,'a necessary short clarification need not create an empty card');
  assert.match(chenPrompt(process.cwd(),s,text,now+1000),/未来三天/);
  assert.match(chenPrompt(process.cwd(),s,text,now+1000),/独立有日期/);
});

void test('未来三天明确委托创建独立日期计划，同目标也不偷复用当前课；重放幂等且旧进度保留',()=>{
  const s=stateWithInput();applyChen(s,parseChen({...reply(),task:proposal()},input),'old-card',now);
  const old=s.professionalTasks[0];old.steps[0].completedAt=new Date(now).toISOString();
  const oldBefore=JSON.stringify(old),text='给我规划未来三天的 胸';
  s.messages.push({id:'future',turnId:'future-turn',role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text}});s.queue=['future-turn'];
  const planned=proposal('future',{evidence:text,title:'三天训练计划',goalKey:'胸',steps:[
    {...proposal().steps[0],scheduledDate:'2026-11-02'},
    {...proposal().steps[0],title:'坐姿夹胸',scheduledDate:'2026-11-04'},
  ]});
  assert.throws(()=>applyChen(s,parseChen({...reply(),task:{...planned,steps:[proposal().steps[0]]}},text),'undated',now+1000),/具体日期/);
  assert.throws(()=>applyChen(s,parseChen({...reply(),task:{...planned,decision:'update',basis:'existing_task_change',taskId:old.id}},text),'wrong-update',now+1000),/不能修改/);
  applyChen(s,parseChen({...reply(),task:planned},text),'new-plan',now+1000);
  assert.equal(s.professionalTasks.length,2);assert.equal(JSON.stringify(old),oldBefore);
  assert.notEqual(s.professionalTasks[1].id,old.id);assert.ok(s.professionalTasks[1].steps.every(step=>step.scheduledDate));
  applyChen(s,parseChen({...reply(),task:planned},text),'replay',now+1000);
  assert.equal(s.professionalTasks.length,2,'the same queued source reuses its own plan');
});

void test('未来多日规划漏卡触发现有有界协议重写，第二次保存日期卡而不发第一次长文字',async()=>{
  const root=mkdtempSync(join(tmpdir(),'chen-future-plan-repair-'));let clock=now,calls=0;const text='给我规划未来三天的 胸背肩';
  const runner:typeof generate=async(_root,prompt)=>{
    calls++;const id=JSON.parse(/【本轮待回答的真实用户消息】([^\n]+)/.exec(prompt)![1]).at(-1).id;
    if(calls===1)return reply('11月2日练背\n1. 高位下拉3组\n2. 划船3组\n11月3日练肩\n1. 推举3组\n2. 侧平举3组\n11月4日练胸\n1. 上斜推胸3组\n2. 夹胸3组');
    assert.match(prompt,/TASK_CARD_OMITTED/);assert.match(prompt,/有界重写/);
    return {...reply('三天规划放卡里了，按日期展开看。'),task:proposal(id,{evidence:text,title:'三天训练计划',goalKey:'胸背肩',steps:[
      {...proposal().steps[0],title:'高位下拉',training:{target:'背阔肌',sets:3,reps:'10～12',restSeconds:120},scheduledDate:'2026-11-02'},
      {...proposal().steps[0],title:'哑铃侧平举',training:{target:'三角肌中束',sets:3,reps:'12～15',restSeconds:90},scheduledDate:'2026-11-03'},
      {...proposal().steps[0],scheduledDate:'2026-11-04'},
    ]})};
  };
  const owner=crypto.randomUUID(),api=fixture(root,runner,()=>clock);
  try {
    await api.post(owner,{action:'send',text,turnId:crypto.randomUUID()});await until(()=>calls===2);await tick();clock+=60_000;
    const snap=(await api.get(owner)).data;
    assert.equal(snap.professionalTasks.length,1);assert.equal(snap.professionalTasks[0].goalKey,'胸背肩');
    assert.equal(snap.messages.filter(message=>message.part.type==='professional_task').length,1);
    assert.equal(snap.messages.some(message=>'text' in message.part&&message.part.text.includes('11月2日练背')),false);
    assert.equal(snap.error,undefined);assert.equal(calls,2);
  } finally {api.close();rmSync(root,{recursive:true,force:true});}
});

void test('陈年重复休息API持久化、事件幂等、revision/账号隔离和结束守卫，始终不调模型',async()=>{
  const root=mkdtempSync(join(tmpdir(),'chen-rest-api-'));let clock=now,calls=0;
  const runner:typeof generate=async()=>{calls++;assert.fail('rest clicks must remain model-free');};
  const owner=crypto.randomUUID(),other=crypto.randomUUID();let api=fixture(root,runner,()=>clock);
  try {
    const seed=stateWithInput();applyChen(seed,parseChen({...reply(),task:proposal('source',{steps:[{...proposal().steps[0],training:{target:'中胸',sets:3,reps:'8～10',restSeconds:180}}]})},input),'seed',now);seed.queue=[];
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
    try{db.prepare('INSERT OR REPLACE INTO chen_sessions VALUES (?,?)').run(`${owner}:chen-nian`,JSON.stringify(seed));}finally{db.close();}
    let task=seed.professionalTasks[0];
    const command={action:'task_timer',taskId:task.id,stepId:task.steps[0].id,operation:'start',eventId:crypto.randomUUID(),expectedRevision:task.revision};
    assert.equal((await api.post(other,command)).status,404);
    task=(await api.post(owner,command)).data.professionalTasks[0];
    assert.equal(task.steps[0].timer?.kind,'rest');assert.equal((await api.post(owner,command)).status,200);
    assert.equal((await api.post(owner,{...command,operation:'pause'})).data.code,'TASK_EVENT_CONFLICT');
    assert.equal((await api.post(owner,{...command,eventId:crypto.randomUUID()})).data.code,'TASK_REVISION_CONFLICT');
    clock+=30_000;
    const paused=await api.post(owner,{...command,operation:'pause',eventId:crypto.randomUUID(),expectedRevision:task.revision});task=paused.data.professionalTasks[0];
    api.close();api=fixture(root,runner,()=>clock);clock+=300_000;
    const restored=(await api.get(owner)).data;task=restored.professionalTasks[0];
    assert.equal(professionalTaskTimerView(task.steps[0],clock).remainingSeconds,150);
    assert.equal(task.steps[0].timer?.completedCycles,0);
    task=(await api.post(owner,{...command,operation:'resume',eventId:crypto.randomUUID(),expectedRevision:task.revision})).data.professionalTasks[0];
    clock+=150_000;assert.equal(professionalTaskTimerView(task.steps[0],clock).completedCycles,1);
    task=(await api.post(owner,{...command,eventId:crypto.randomUUID(),expectedRevision:task.revision})).data.professionalTasks[0];
    assert.equal(task.steps[0].timer?.completedCycles,1);clock+=180_000;
    assert.equal((await api.post(owner,{...command,eventId:crypto.randomUUID(),expectedRevision:task.revision})).data.code,'TASK_TIMER_EXHAUSTED');
    const cancelled=await api.post(owner,{action:'task_status',taskId:task.id,status:'cancelled',eventId:crypto.randomUUID(),expectedRevision:task.revision});task=cancelled.data.professionalTasks[0];
    assert.equal(task.steps[0].timer?.completedCycles,2);
    assert.equal((await api.post(owner,{...command,eventId:crypto.randomUUID(),expectedRevision:task.revision})).data.code,'TASK_TIMER_ENDED');
    const after=(await api.get(owner)).data;
    assert.deepEqual(after.messages,seed.messages);assert.deepEqual(after.relationshipValues,seed.values);assert.equal(calls,0);
    assert.deepEqual((await api.get(other)).data.professionalTasks,[]);
  } finally {api.close();rmSync(root,{recursive:true,force:true});}
});
