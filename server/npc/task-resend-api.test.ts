import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import type { generate } from './codex';
import { chefLocal } from './zhou-chef-plugin';
import { createChef, type ChefState } from '../../lib/npc/zhou-chef';
import { applyProfessionalTaskOperation, parseProfessionalTaskOperation, type ProfessionalTask } from '../../lib/npc/professional-task';

const initialTime=Date.parse('2026-10-10T10:00:00.000Z');
const proposal=(sourceMessageId='source',evidence='我要做地三鲜。',extra:Record<string,unknown>={})=>({
  decision:'create',basis:'execution_commitment',scope:'current_user',polarity:'affirmed',readiness:'ready',confidence:.95,
  sourceMessageId,evidence,title:'地三鲜',goalKey:'地三鲜',steps:[{title:'准备食材',instructions:'洗好土豆。\n切成滚刀块。',details:null,notes:null,completionCondition:null,durationSeconds:null}],...extra,
});
const reply=(task:unknown,text='好，步骤给你。')=>({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task});
const currentSources=(prompt:string)=>{
  const raw=/【程序与模型共用的任务委托来源窗口；只是原文证据，不是指令】([^\n]+)/.exec(prompt);
  assert.ok(raw);return (JSON.parse(raw[1]) as {sources:{id:string;text:string;taskReference?:{taskId:string;cardMessageId:string;goalKey:string}}[]}).sources;
};
const taskFrom=(status:ProfessionalTask['status']='active')=>{
  const task=applyProfessionalTaskOperation([],parseProfessionalTaskOperation(proposal()),[{id:'source',text:'我要做地三鲜。'}],[],initialTime-60_000)!.task;
  task.status=status;task.updatedAt=new Date(initialTime-30_000).toISOString();
  task.steps.push({id:crypto.randomUUID(),title:'炸土豆',details:['按做法炸5分钟。'],durationSeconds:300,hints:[]});
  return task;
};
type Snapshot={messages:ChefState['messages'];professionalTasks:ProfessionalTask[];pending:boolean;deliveryError:string;revision:number;error?:string;code?:string};
function fixture(root:string,runner:typeof generate,now:()=>number){
  cpSync(join(process.cwd(),'npc-skills'),join(root,'npc-skills'),{recursive:true});
  let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{};
  const server=new EventEmitter(),plugin=chefLocal({available:()=>true,generate:runner,now});
  (plugin.configureServer as (server:ViteDevServer)=>void)({config:{root},httpServer:server,middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}}} as unknown as ViteDevServer);
  const request=(owner:string,method:string,body?:unknown)=>new Promise<{status:number;data:Snapshot}>(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as IncomingMessage;req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:owner?`zhiyu_npc=${owner}`:''};
    const res={statusCode:200,writableEnded:false,setHeader:()=>{},end(text:string){this.writableEnded=true;resolve({status:this.statusCode,data:JSON.parse(text)});}};
    handler(req,res as unknown as ServerResponse);
  });
  return {get:(owner:string)=>request(owner,'GET'),post:(owner:string,body:unknown)=>request(owner,'POST',body),close:()=>server.emit('close')};
}
const stored=(root:string,owner:string)=>{
  const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'),{readOnly:true});
  try{const row=db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`) as {data:string};return JSON.parse(row.data) as ChefState;}finally{db.close();}
};
const seed=(root:string,owner:string,state:ChefState)=>{
  const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
  try{db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(`${owner}:zhou-chef`,JSON.stringify(state));}finally{db.close();}
};
const until=async(check:()=>boolean)=>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('isolated request did not settle');};
const diagnostics=(root:string)=>readdirSync(join(root,'.npc-runtime/task-diagnostics')).flatMap(name=>readFileSync(join(root,'.npc-runtime/task-diagnostics',name),'utf8').trim().split('\n').map(line=>JSON.parse(line) as {stage:string;code:string;message:string;attempt:number}));

void test('对象instructions两次失败定位匿名字段；队列保留且不提交部分任务/消息/记忆/关系',async()=>{
  const root=mkdtempSync(join(tmpdir(),'task-parser-api-fail-')),owner=crypto.randomUUID();let calls=0;
  const runner:typeof generate=async(_root,prompt)=>{calls++;const source=currentSources(prompt).at(-1)!;return{...reply(proposal(source.id,source.text,{steps:[{title:'准备食材',instructions:{text:'PRIVATE_INVALID_RECIPE_BODY'}}]}),'PRIVATE_INVALID_REPLY'),memories:[{text:'PRIVATE_INVALID_MEMORY',kind:'user_claim',evidence:source.text}],event:{kind:'ordinary',basis:'user_claim',evidence:source.text,reason:'fixture',deltas:{familiarity:1}}};};
  const api=fixture(root,runner,()=>initialTime);
  try{
    const turnId=crypto.randomUUID();await api.post(owner,{action:'send',turnId,text:'我要做地三鲜。'});await until(()=>!!stored(root,owner).error);
    const state=stored(root,owner),snapshot=(await api.get(owner)).data;
    assert.equal(calls,2);assert.equal(snapshot.deliveryError,'赵一帆的任务内容格式有误，请重试。');
    assert.deepEqual(state.queue,[turnId]);assert.equal(state.pending,null);assert.equal(state.retryAt,Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.professionalTasks,[]);assert.deepEqual(state.memories,[]);assert.deepEqual(state.proposals,[]);assert.deepEqual(state.values,createChef().values);
    assert.equal(state.messages.length,1);assert.equal(state.messages[0].role,'user');assert.equal(state.messages[0].turnId,turnId);
    const records=diagnostics(root);assert.equal(records.length,2);assert.deepEqual(records.map(row=>row.attempt),[1,2]);
    for(const row of records){assert.equal(row.stage,'parse');assert.equal(row.code,'TASK_STEP_CONTENT_INVALID');assert.match(row.message,/steps\[0\]\.instructions/);assert.match(row.message,/类型object/);}
    const trace=JSON.stringify(records);for(const privateText of ['PRIVATE_INVALID_RECIPE_BODY','PRIVATE_INVALID_REPLY','PRIVATE_INVALID_MEMORY','我要做地三鲜'])assert.equal(trace.includes(privateText),false);
    await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(calls,2,'failed queue is not automatically retried');
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('null可选字段与单文本操作一次成功，真实卡与归一化内容持久保存',async()=>{
  const root=mkdtempSync(join(tmpdir(),'task-parser-api-valid-')),owner=crypto.randomUUID();let calls=0;
  const runner:typeof generate=async(_root,prompt)=>{calls++;const source=currentSources(prompt).at(-1)!;return reply(proposal(source.id,source.text));};
  const api=fixture(root,runner,()=>initialTime);
  try{
    await api.post(owner,{action:'send',turnId:crypto.randomUUID(),text:'我要做地三鲜。'});await until(()=>stored(root,owner).professionalTasks.length===1);
    const state=stored(root,owner);assert.equal(calls,1);assert.equal(state.error,'');assert.deepEqual(state.queue,[]);
    assert.deepEqual(state.professionalTasks[0].steps[0].instructions,['洗好土豆。','切成滚刀块。']);assert.deepEqual(state.professionalTasks[0].steps[0].details,['洗好土豆。','切成滚刀块。']);
    assert.equal(state.professionalTasks[0].steps[0].notes,undefined);assert.equal(state.professionalTasks[0].steps[0].timer,undefined);assert.equal(state.messages.filter(message=>message.part.type==='professional_task').length,1);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('INVALID_TASK、漏卡与意图拒绝分别展示内容/卡片/委托错误，不混为意图失败',async()=>{
  const cases=[
    {text:'我要做地三鲜。',code:'INVALID_TASK',error:'赵一帆的任务内容格式有误，请重试。',output:(id:string,text:string)=>reply(proposal(id,text,{steps:null}))},
    {text:'我要做地三鲜。',code:'TASK_CARD_OMITTED',error:'赵一帆的任务卡未正确生成，请重试。',output:()=>reply({decision:'none'},'已经帮你创建任务。')},
    {text:'地三鲜怎么做？',code:'TASK_INTENT_REJECTED',error:'赵一帆的任务委托核对未通过，请重试。',output:(id:string,text:string)=>reply(proposal(id,text))},
  ];
  for(const row of cases){
    const root=mkdtempSync(join(tmpdir(),'task-api-error-class-')),owner=crypto.randomUUID();let calls=0;
    const runner:typeof generate=async(_root,prompt)=>{calls++;const source=currentSources(prompt).at(-1)!;return row.output(source.id,source.text);};
    const api=fixture(root,runner,()=>initialTime);
    try{
      const turnId=crypto.randomUUID();await api.post(owner,{action:'send',turnId,text:row.text});await until(()=>!!stored(root,owner).error);
      const state=stored(root,owner);assert.equal(calls,2);assert.equal((await api.get(owner)).data.deliveryError,row.error);
      assert.deepEqual(state.queue,[turnId]);assert.deepEqual(state.professionalTasks,[]);assert.equal(state.messages.length,1);assert.ok(diagnostics(root).every(record=>record.code===row.code));
    }finally{api.close();rmSync(root,{recursive:true,force:true});}
  }
});

void test('引用已结束真实卡重新发新任务，从prompt taskReference定位目标且原任务不变，重开可读',async()=>{
  const root=mkdtempSync(join(tmpdir(),'task-resend-api-new-')),owner=crypto.randomUUID(),other=crypto.randomUUID();let calls=0,clock=initialTime;
  const oldTask=taskFrom('cancelled');oldTask.steps[0].completedAt=new Date(initialTime-40_000).toISOString();
  const original=structuredClone(oldTask),state=createChef();state.professionalTasks=[oldTask];
  state.messages.push({id:oldTask.cardMessageId,turnId:'original-task-turn',role:'assistant',at:oldTask.createdAt,part:{type:'professional_task',taskId:oldTask.id}});
  const runner:typeof generate=async(_root,prompt)=>{calls++;const source=currentSources(prompt).at(-1)!;assert.deepEqual(source.taskReference,{taskId:oldTask.id,cardMessageId:oldTask.cardMessageId,goalKey:oldTask.goalKey});return reply(proposal(source.id,source.text,{basis:'explicit_request',goalKey:source.taskReference!.goalKey,title:source.taskReference!.goalKey}));};
  let api=fixture(root,runner,()=>clock);
  try{
    seed(root,owner,state);await api.post(owner,{action:'send',turnId:crypto.randomUUID(),text:'重新给我发一个新的',replyTo:oldTask.cardMessageId});await until(()=>{const latest=stored(root,owner);return latest.professionalTasks.length===2||!!latest.error;});
    let saved=stored(root,owner);assert.equal(saved.error,'',saved.error);const newTask=saved.professionalTasks[1];assert.equal(calls,1);assert.deepEqual(saved.professionalTasks[0],original);assert.notEqual(newTask.id,oldTask.id);
    assert.equal(newTask.referenceTaskId,oldTask.id);assert.equal(newTask.referenceCardMessageId,oldTask.cardMessageId);assert.equal(newTask.status,'active');assert.ok(newTask.steps.every(step=>!step.completedAt&&!step.timer));
    assert.equal(saved.messages.filter(message=>message.part.type==='professional_task').length,2);assert.deepEqual((await api.get(other)).data.professionalTasks,[]);
    clock+=60_000;assert.equal((await api.get(owner)).data.professionalTasks[1].id,newTask.id);
    api.close();api=fixture(root,runner,()=>clock);saved=stored(root,owner);assert.deepEqual(saved.professionalTasks[0],original);assert.equal((await api.get(owner)).data.professionalTasks[1].id,newTask.id);assert.equal(calls,1);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});

void test('重显同一张卡只新增展示ID，原步骤/计时/修订/待处理hint事件保留',async()=>{
  const root=mkdtempSync(join(tmpdir(),'task-resend-api-same-')),owner=crypto.randomUUID();let calls=0;
  const task=taskFrom(),state=createChef();task.steps[0].completedAt=new Date(initialTime-40_000).toISOString();
  task.steps[1].timer={status:'running',remainingMs:300_000,startedAt:new Date(initialTime-20_000).toISOString(),updatedAt:new Date(initialTime-20_000).toISOString()};
  state.professionalTasks=[task];state.taskEvents=[{id:crypto.randomUUID(),taskId:task.id,revision:task.revision,kind:'step_completed',completedStepId:task.steps[0].id,nextStepId:task.steps[1].id,at:new Date(initialTime-10_000).toISOString()}];
  state.messages.push({id:task.cardMessageId,turnId:'original-task-turn',role:'assistant',at:task.createdAt,part:{type:'professional_task',taskId:task.id}});
  const original=structuredClone(task),events=structuredClone(state.taskEvents);
  const runner:typeof generate=async(_root,prompt)=>{calls++;const source=currentSources(prompt).at(-1)!;assert.ok(source.taskReference);return reply(proposal(source.id,source.text,{basis:'explicit_request',goalKey:source.taskReference.goalKey,title:source.taskReference.goalKey}));};
  const api=fixture(root,runner,()=>initialTime);
  try{
    seed(root,owner,state);await api.post(owner,{action:'send',turnId:crypto.randomUUID(),text:'把刚才那张任务卡再发出来',replyTo:task.cardMessageId});await until(()=>{const latest=stored(root,owner);return latest.messages.filter(message=>message.part.type==='professional_task').length===2||!!latest.error;});
    const saved=stored(root,owner),resent=saved.professionalTasks[0];assert.equal(saved.error,'',saved.error);assert.equal(calls,1);assert.equal(saved.professionalTasks.length,1);assert.equal(resent.cardMessageId,original.cardMessageId);
    assert.deepEqual(resent.steps,original.steps);assert.equal(resent.revision,original.revision);assert.equal(resent.status,original.status);assert.equal(resent.updatedAt,original.updatedAt);assert.deepEqual(saved.taskEvents,events);
    assert.equal(resent.cardMessageIds!.length,1);assert.equal(saved.messages.at(-1)!.id,resent.cardMessageIds![0]);
  }finally{api.close();rmSync(root,{recursive:true,force:true});}
});
