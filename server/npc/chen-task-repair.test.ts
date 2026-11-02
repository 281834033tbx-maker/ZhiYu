import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { applyChen, createChen, parseChen, type ChenState } from '../../lib/npc/chen-nian';
import { chenLocal } from './chen-plugin';
import type { generate } from './codex';

const now = Date.parse('2026-10-13T04:00:00Z');
const input = '我现在要练胸，给我一个胸部训练任务。';
const shoulderInput = '给我一个关于肩部训练最好的任务，我能在健身房练。';
const recoveryAnswer = '酸痛基本退了，抬臂正常、无痛';
const reply = (text = '按任务里的动作来。') => ({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task:{decision:'none'}});
const proposal = (sourceMessageId: string, evidence = input, extra: Record<string, unknown> = {}) => ({
  decision:'create',basis:'explicit_request',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',
  sourceMessageId,evidence,title:'胸部训练',goalKey:'胸',
  steps:[
    {title:'上斜哑铃卧推',category:'main',training:{target:'上胸',sets:3,reps:'8～12次',restSeconds:120},instructions:['稳定躯干，在可控范围内完成动作。'],completionCondition:'完成本次3组'},
    {title:'坐姿夹胸',category:'accessory',training:{target:'中胸',sets:3,reps:'10～12次'},instructions:['稳定躯干，控制夹合和回程。'],completionCondition:'完成本次3组'},
  ],...extra,
});
const queued = (prompt: string): {id:string;part:{text:string}}[] => JSON.parse(/【本轮待回答的真实用户消息】([^\n]+)/.exec(prompt)![1]);
const sourceId = (prompt: string) => queued(prompt).at(-1)!.id;
const taskEvidence = (prompt: string) => JSON.parse(/【程序与模型共用的任务委托来源窗口[^】]*】([^\n]+)/.exec(prompt)![1]);
const tick = () => new Promise(resolve => setTimeout(resolve,10));
async function until(check: () => boolean) {
  for(let i=0;i<300;i++) {if(check())return;await tick();}
  assert.fail('隔离陈年任务管线没有完成');
}
function gate<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>(done => {resolve=done;});
  return {promise,resolve};
}
type Diagnostic = {job:string;at:string;stage:string;code:string;message:string;attempt:number};

/** Real middleware and SQLite in a disposable root; no sockets or provider calls. */
function fixture(runner: typeof generate) {
  const root=mkdtempSync(join(tmpdir(),'chen-task-repair-'));
  cpSync(join(process.cwd(),'npc-skills'),join(root,'npc-skills'),{recursive:true});
  let clock=now,handler: (req:IncomingMessage,res:ServerResponse)=>void=()=>{};
  const server=new EventEmitter(),plugin=chenLocal({available:()=>true,generate:runner,now:()=>clock});
  (plugin.configureServer as (server:ViteDevServer)=>void)({
    config:{root},httpServer:server,middlewares:{use:(_path:string,fn:typeof handler)=>{handler=fn;}},
  } as unknown as ViteDevServer);
  const owner=crypto.randomUUID();
  const request=(method:string,body?:unknown)=>new Promise<{status:number;data:Record<string,unknown>}>(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:'zhiyu_npc='+owner};
    const res={statusCode:200,writableEnded:false,setHeader:()=>{},end(text:string){this.writableEnded=true;resolve({status:this.statusCode,data:JSON.parse(text)});}};
    handler(req,res as unknown as ServerResponse);
  });
  const stored=():ChenState=>{
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'),{readOnly:true});
    try{return JSON.parse((db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(owner+':chen-nian') as {data:string}).data);}
    finally{db.close();}
  };
  const diagnostics=():Diagnostic[]=>{
    try{return readdirSync(join(root,'.npc-runtime/task-diagnostics')).flatMap(file=>readFileSync(join(root,'.npc-runtime/task-diagnostics',file),'utf8').trim().split('\n').map(line=>JSON.parse(line)));}
    catch{return [];}
  };
  return {
    root,owner,stored,diagnostics,post:(body:unknown)=>request('POST',body),
    send:(text=input)=>request('POST',{action:'send',text,turnId:crypto.randomUUID()}),
    time:()=>clock,advance:(milliseconds=60_000)=>{clock+=milliseconds;},
    seed:(state:ChenState)=>{
      const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
      try{db.prepare('INSERT OR REPLACE INTO chen_sessions VALUES (?,?)').run(owner+':chen-nian',JSON.stringify(state));}
      finally{db.close();}
    },
    close:()=>{server.emit('close');rmSync(root,{recursive:true,force:true});},
  };
}

void test('陈年首稿解析失败只重写一次，匿名stage诊断且卡/文字/关系/记忆原子提交',async()=>{
  let calls=0;const prompts:string[]=[],jobs:string[]=[];
  const runner:typeof generate=async(_root,prompt,options)=>{
    calls++;prompts.push(prompt);jobs.push(options!.requestId!);assert.equal(options?.characterId,'chen-nian');
    return {...reply(calls===1?'失败草稿不能出现':'按任务里的动作来。'),task:calls===1?{...proposal(sourceId(prompt)),steps:[]}:proposal(sourceId(prompt)),
      event:{kind:'ordinary',basis:'user_claim',evidence:input,reason:'当前训练委托',deltas:{familiarity:1}},
      memories:[{text:'本轮准备练胸',kind:'user_claim',evidence:input}]};
  };
  const api=fixture(runner);
  try{
    await api.send();await until(()=>calls===2&&!api.stored().pending);
    const state=api.stored();
    assert.equal(calls,2);assert.equal(jobs[0],jobs[1]);assert.ok(prompts[1].startsWith(prompts[0]));
    assert.match(prompts[1],/"stage":"parse"/);assert.match(prompts[1],/任务目标或步骤不完整/);
    assert.equal(state.professionalTasks.length,1);assert.equal(state.messages.filter(message=>message.part.type==='professional_task').length,1);
    assert.equal(state.messages.filter(message=>message.role==='assistant'&&message.part.type==='text').length,1);
    assert.ok(!JSON.stringify(state).includes('失败草稿不能出现'));assert.equal(state.values.familiarity,1);
    assert.equal(state.proposals.length,1);assert.equal(state.memories.length,1);assert.deepEqual(state.queue,[]);assert.equal(state.error,'');
    const logs=api.diagnostics();assert.equal(logs.length,1);assert.equal(logs[0].stage,'parse');assert.equal(logs[0].attempt,1);
    assert.deepEqual(Object.keys(logs[0]).sort(),['job','at','stage','code','message','attempt'].sort());
    assert.ok(!JSON.stringify(logs).includes(api.owner));assert.ok(!JSON.stringify(logs).includes(input));assert.ok(!JSON.stringify(logs).includes('失败草稿'));
  }finally{api.close();}
});

void test('真实肩任务→恢复choice→真实选择保留委托；无效首稿修复后只提交一份肩任务',async()=>{
  let calls=0;const evidence:Record<string,unknown>[]=[],prompts:string[]=[];
  const runner:typeof generate=async(_root,prompt)=>{
    calls++;prompts.push(prompt);
    if(calls===1)return {...reply(),messages:[
      {type:'text',text:'行，我来安排。'},
      {type:'choice',text:'你昨天说肌肉还有明显酸痛，今天胸肩恢复咋样？这会决定肩推能不能放进任务。',options:[recoveryAnswer,'仍有明显酸痛，抬臂不舒服']},
    ]};
    const snapshot=taskEvidence(prompt);evidence.push(snapshot);
    const request=snapshot.contextSources.find((source:{text:string})=>source.text===shoulderInput);
    assert.ok(request);const source=snapshot.sources.at(-1);
    assert.equal(source.text,recoveryAnswer);assert.equal(source.id,sourceId(prompt));
    assert.deepEqual(source.taskClarification,{questionMessageId:api.stored().messages.findLast(message=>message.part.type==='choice')!.id,requestMessageId:request.id});
    return {...reply(calls===2?'错误来源草稿不能出现':'肩部动作放在任务里了。'),task:proposal(calls===2?'invented-source':source.id,recoveryAnswer,{
      contextMessageId:request.id,title:'肩部训练',goalKey:'肩部训练',
      steps:[{title:'哑铃肩推',category:'main',training:{target:'三角肌',sets:3,reps:'8～12次',restSeconds:120},instructions:['在无痛、可控范围内完成动作。'],notes:['不适时停止。'],completionCondition:'完成本次3组'}],
    })};
  };
  const api=fixture(runner);
  try{
    await api.send(shoulderInput);await until(()=>calls===1&&!api.stored().pending);api.advance(1_000);
    const before=api.stored(),question=before.messages.findLast(message=>message.part.type==='choice')!;
    assert.equal(before.professionalTasks.length,0);assert.deepEqual(before.queue,[]);
    const turnId=crypto.randomUUID(),choice={messageId:question.id,index:0};
    assert.equal((await api.post({action:'send',turnId,choice,text:'伪造的恢复答案',replyTo:question.id})).status,400);
    assert.equal(calls,1);assert.equal(api.stored().messages.filter(message=>message.role==='user').length,1);
    assert.equal((await api.post({action:'send',turnId,choice,replyTo:question.id})).status,200);
    await until(()=>calls===3&&!api.stored().pending);
    const state=api.stored(),answer=state.messages.findLast(message=>message.role==='user')!;
    assert.equal(state.professionalTasks.length,1);assert.equal(state.professionalTasks[0].sourceMessageId,answer.id);
    assert.equal(state.professionalTasks[0].contextMessageId,before.messages.find(message=>message.role==='user')!.id);
    assert.equal(state.professionalTasks[0].goalKey,'肩部训练');assert.equal(state.messages.filter(message=>message.part.type==='professional_task').length,1);
    assert.equal(answer.replyTo,question.id);assert.equal('text' in answer.part&&answer.part.text,recoveryAnswer);
    assert.deepEqual(evidence[0],evidence[1]);assert.match(prompts[2],/"stage":"apply"/);
    assert.ok(!JSON.stringify(state).includes('错误来源草稿'));assert.equal(state.error,'');assert.deepEqual(state.queue,[]);
    assert.equal(api.diagnostics()[0].stage,'apply');assert.equal(api.diagnostics()[0].code,'TASK_INTENT_REJECTED');
  }finally{api.close();}
});

void test('两次失败保留真实输入并停止自动重试；原任务进度不变，显式retry只新建一份',async()=>{
  let calls=0;
  const runner:typeof generate=async(_root,prompt)=>({...reply('失败草稿不得落库'),task:proposal(++calls<=2?'missing-source':sourceId(prompt)),
    event:{kind:'ordinary',basis:'user_claim',evidence:input,reason:'测试',deltas:{familiarity:1}},
    memories:[{text:'失败草稿记忆',kind:'user_claim',evidence:input}]});
  const api=fixture(runner);
  try{
    const seed=createChen();seed.messages.push({id:'old-source',turnId:'old-turn',role:'user',at:new Date(now-60_000).toISOString(),part:{type:'text',text:input}});seed.queue=['old-turn'];
    applyChen(seed,parseChen({...reply(),task:proposal('old-source')},input),'old-reply',now-60_000);seed.queue=[];
    seed.professionalTasks[0].status='completed';for(const step of seed.professionalTasks[0].steps)step.completedAt=new Date(now-30_000).toISOString();
    api.seed(seed);const old=JSON.stringify(seed.professionalTasks),messages=seed.messages.length;
    await api.send();await until(()=>!!api.stored().error);
    const failed=api.stored();assert.equal(calls,2);assert.equal(failed.pending,null);assert.equal(failed.retryAt,Number.MAX_SAFE_INTEGER);
    assert.equal(failed.queue.length,1);assert.equal(failed.messages.length,messages+1);assert.equal(JSON.stringify(failed.professionalTasks),old);
    assert.deepEqual(failed.memories,[]);assert.deepEqual(failed.proposals,[]);assert.deepEqual(failed.values,seed.values);
    assert.match(failed.error,/任务委托核对未通过/);assert.deepEqual(api.diagnostics().map(row=>row.attempt),[1,2]);
    await new Promise(resolve=>setTimeout(resolve,1_100));assert.equal(calls,2);
    await api.post({action:'retry'});await until(()=>calls===3&&!api.stored().pending);
    const after=api.stored();assert.equal(after.professionalTasks.length,2);assert.equal(JSON.stringify(after.professionalTasks.slice(0,1)),old);
    assert.deepEqual(after.queue,[]);assert.equal(after.error,'');assert.equal(after.messages.filter(message=>message.part.type==='professional_task').length,2);
  }finally{api.close();}
});

void test('修复等待时新输入撤回旧委托，旧回复和旧失败都不能覆盖新状态',async()=>{
  let calls=0;const repair=gate<unknown>();
  const runner:typeof generate=async(_root,prompt)=>++calls===1?{...reply(),task:proposal('missing-source')}:repair.promise.then(()=>({...reply('旧回复不应提交'),task:proposal(sourceId(prompt))}));
  const api=fixture(runner);
  try{
    await api.send();await until(()=>calls===2);
    await api.send('先不要建任务，我再看看。');await api.post({action:'typing',clientId:crypto.randomUUID(),sequence:1,active:true});
    repair.resolve(null);await until(()=>!api.stored().pending);
    const state=api.stored();assert.equal(calls,2);assert.equal(state.queue.length,2);assert.equal(state.messages.length,2);
    assert.equal(state.error,'');assert.equal(state.retryAt,0);assert.deepEqual(state.professionalTasks,[]);assert.deepEqual(state.memories,[]);assert.deepEqual(state.proposals,[]);
    assert.ok(!JSON.stringify(state).includes('旧回复不应提交'));
  }finally{api.close();}
});

void test('生成等待中的组间计时和整次训练开始不会被候选保存覆盖',async()=>{
  let calls=0;const answer=gate<unknown>();
  const runner:typeof generate=async(_root,prompt)=>++calls===1?{...reply(),task:proposal(sourceId(prompt))}:answer.promise;
  const api=fixture(runner);
  try{
    await api.send();await until(()=>calls===1&&!api.stored().pending);api.advance();
    await api.send('这个动作怎么做？');await until(()=>calls===2);
    let task=api.stored().professionalTasks[0];
    assert.equal((await api.post({action:'task_timer',taskId:task.id,stepId:task.steps[0].id,operation:'start',expectedRevision:task.revision,eventId:crypto.randomUUID()})).status,200);
    task=api.stored().professionalTasks[0];
    assert.equal((await api.post({action:'task_session_start',taskId:task.id,expectedRevision:task.revision,eventId:crypto.randomUUID()})).status,200);
    const before=structuredClone(api.stored().professionalTasks[0]);answer.resolve(reply('保持手腕中立，动作失稳时停下。'));await until(()=>!api.stored().pending);
    const after=api.stored();assert.deepEqual(after.professionalTasks[0],before);assert.equal(after.professionalTasks[0].steps[0].timer?.status,'running');
    assert.equal(after.professionalTasks[0].executionSessions?.at(-1)?.status,'running');assert.equal(after.error,'');assert.deepEqual(after.queue,[]);
  }finally{api.close();}
});

void test('完成事件首稿误建卡只修提示，不新增用户/卡/关系/记忆',async()=>{
  let calls=0;
  const runner:typeof generate=async(_root,prompt)=>{
    calls++;
    if(calls===1)return {...reply(),task:proposal(sourceId(prompt))};
    if(calls===2)return {...reply('事件错误草稿'),task:proposal('fake-event-source')};
    return reply('下一项夹胸，先稳定躯干。');
  };
  const api=fixture(runner);
  try{
    await api.send();await until(()=>calls===1&&!api.stored().pending);api.advance();
    const before=api.stored(),task=before.professionalTasks[0];
    await api.post({action:'task_step',taskId:task.id,stepId:task.steps[0].id,completed:true,expectedRevision:task.revision,eventId:crypto.randomUUID()});
    await until(()=>calls===3&&!api.stored().pending);
    const after=api.stored();assert.equal(after.professionalTasks.length,1);assert.equal(after.taskEvents.length,0);assert.equal(after.professionalTasks[0].steps[1].hints.length,1);
    assert.equal(after.messages.filter(message=>message.part.type==='professional_task').length,1);assert.equal(after.messages.filter(message=>message.role==='user').length,1);
    assert.deepEqual(after.values,before.values);assert.deepEqual(after.memories,before.memories);assert.deepEqual(after.proposals,before.proposals);
    assert.ok(!JSON.stringify(after).includes('事件错误草稿'));assert.equal(api.diagnostics()[0].stage,'task-event');
  }finally{api.close();}
});

void test('匿名diagnostic目录不可写不能阻止合法修复保存',async()=>{
  let calls=0;
  const runner:typeof generate=async(_root,prompt)=>({...reply(),task:++calls===1?{...proposal(sourceId(prompt)),steps:[]}:proposal(sourceId(prompt))});
  const api=fixture(runner);
  try{
    writeFileSync(join(api.root,'.npc-runtime/task-diagnostics'),'synthetic-file-blocks-directory');
    await api.send();await until(()=>calls===2&&!api.stored().pending);
    assert.equal(api.stored().professionalTasks.length,1);assert.equal(api.stored().error,'');assert.deepEqual(api.diagnostics(),[]);
  }finally{api.close();}
});

void test('非任务生成错误不触发协议重写，真实输入保留且没有任务诊断',async()=>{
  let calls=0;const runner:typeof generate=async()=>{calls++;throw Error('synthetic-offline');};
  const api=fixture(runner);
  try{
    await api.send();await until(()=>!!api.stored().error);
    assert.equal(calls,1);assert.equal(api.stored().queue.length,1);assert.equal(api.stored().messages.length,1);assert.deepEqual(api.stored().professionalTasks,[]);
    assert.match(api.stored().error,/暂时没有连上/);assert.deepEqual(api.diagnostics(),[]);
  }finally{api.close();}
});
