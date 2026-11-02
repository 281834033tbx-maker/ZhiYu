import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real middleware/auth and persistence, in-memory requests, synthetic accounts,
// temporary SQLite, injected offline provider. No listening port or real API.
const runtime=isolatedNpcRuntime();
const originalFetch=globalThis.fetch;
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw Error('Network disabled in task-session regression');};
const outputArgument=process.argv.find(value=>value.startsWith('--output='));
const report={at:new Date().toISOString(),scope:'真实鉴权/陈年/厨师API＋临时SQLite＋合成任务/时间＋内存Readable传输＋stub生成；无正式API/任务/模型/存储操作',passed:[],failures:[],modelCalls:0,networkAttempts:0,sourceHashes:{}};
let api,db;
const initial=Date.parse('2026-10-12T02:00:00.000Z');
let clock=initial,enabled=true;
const tableFor=npc=>npc==='chen-nian'?'chen_sessions':'zhou_chef_sessions';
const check=async(name,run)=>{await run();report.passed.push(name);};
try {
  const {authLocal}=await runtime.load('server/npc/auth-plugin');
  const {chenLocal}=await runtime.load('server/npc/chen-plugin');
  const {chefLocal}=await runtime.load('server/npc/zhou-chef-plugin');
  const {dialogueHealth}=await runtime.load('server/npc/dialogue-health');
  const {npcSkillVersion}=await runtime.load('server/npc/codex');
  const {createChen,normalizeChen}=await runtime.load('lib/npc/chen-nian');
  const {createChef}=await runtime.load('lib/npc/zhou-chef');
  const {applyProfessionalTaskMutation,isProfessionalTaskMutation}=await runtime.load('server/npc/professional-task-mutation');
  const {PROFESSIONAL_TASK_SESSION_VERSION,PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION}=await runtime.load('lib/npc/professional-task-session');
  const fixture=()=>{
    const server=new EventEmitter(),handlers=[];
    const service={config:{root:runtime.root},httpServer:server,middlewares:{use(prefix,handler){handlers.push(typeof prefix==='function'?{prefix:'',handler:prefix}:{prefix,handler});}}};
    const deps={now:()=>clock,available:()=>enabled,generate:async()=>{report.modelCalls++;throw Error('Unexpected isolated generation');}};
    for(const plugin of [dialogueHealth(),authLocal(),chenLocal(deps),chefLocal(deps)])plugin.configureServer(service);
    const request=(npc,{account,method='GET',body,header=account?.id,legacyOwner=account?.owner,token=account?.token,path}={})=>new Promise((resolveResponse,reject)=>{
      const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
      req.method=method;req.url=path||`/api/npc/${npc}`;
      req.headers={host:'127.0.0.1:32001',origin:'http://127.0.0.1:32001',cookie:`${token?`zhiyu_auth=${token}; `:''}${legacyOwner?`zhiyu_npc=${legacyOwner}`:''}`,...(header?{'x-zhiyu-account':header}:{})};
      const headers={};
      const res={statusCode:200,writableEnded:false,setHeader(name,value){headers[name.toLowerCase()]=value;},end(text){this.writableEnded=true;try{resolveResponse({status:this.statusCode,headers,data:JSON.parse(text)});}catch(error){reject(error);}}};
      let index=0;
      const next=()=>{
        const entry=handlers[index++];
        if(!entry)return reject(Error('Unhandled isolated request'));
        if(entry.prefix&&!req.url.startsWith(entry.prefix))return next();
        const original=req.url;
        if(entry.prefix)req.url=req.url.slice(entry.prefix.length)||'/';
        try {entry.handler(req,res,()=>{req.url=original;next();});}catch(error){reject(error);}
      };
      next();
    });
    return {request,close:()=>server.emit('close')};
  };
  api=fixture();
  db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
  const createAccount=name=>{
    const value={id:randomUUID(),owner:randomUUID(),token:randomBytes(32).toString('hex')};
    db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(value.id,name,'0'.repeat(32),'0'.repeat(128),value.owner,initial);
    db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(value.token).digest('hex'),value.id,Date.now()+3_600_000);
    return value;
  };
  const a=createAccount('SyntheticTaskSessionA'),b=createAccount('SyntheticTaskSessionB');
  const snapshot=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()})));
  const saved=(npc,account=a)=>JSON.parse(db.prepare(`SELECT data FROM ${tableFor(npc)} WHERE id=?`).get(`${account.owner}:${npc}`).data);
  const makeTask=npc=>({id:randomUUID(),characterId:npc,title:npc==='chen-nian'?'合成胸部训练':'合成烹饪计划',goalKey:'隔离测试',status:'active',revision:1,createdAt:new Date(initial).toISOString(),updatedAt:new Date(initial).toISOString(),sourceMessageId:'synthetic-source',cardMessageId:'synthetic-card',steps:[{id:'first',title:'第一项',details:['合成说明'],hints:[]},{id:'last',title:'最后一项',details:['合成说明'],hints:[]}]});
  const seed=(npc,task=makeTask(npc),extras={})=>{
    const state={...(npc==='chen-nian'?createChen():createChef()),professionalTasks:[task],...extras};
    db.prepare(`INSERT OR REPLACE INTO ${tableFor(npc)} VALUES(?,?)`).run(`${a.owner}:${npc}`,JSON.stringify(state));
    return state;
  };
  const post=(npc,task,body={},options={})=>api.request(npc,{account:a,method:'POST',body:{action:'task_session_start',taskId:task.id,expectedRevision:task.revision,eventId:randomUUID(),...body},...options});
  await check('共享动作识别及只读healthy能力来自真实已加载模块',async()=>{
    assert.equal(isProfessionalTaskMutation('task_session_start'),true);
    const before=snapshot();
    const response=await api.request('',{path:'/api/npc/dialogue-health'});
    assert.equal(response.status,200);assert.equal(response.data.ok,true);
    assert.deepEqual(response.data.professionalTaskSession,{version:PROFESSIONAL_TASK_SESSION_VERSION,startAction:'task_session_start',startSupported:true,
      completeVersion:PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION,completeAction:'task_session_complete',completeSupported:true});
    assert.equal(response.data.version,npcSkillVersion);
    assert.ok(response.data.characters.length===6&&response.data.timeRulesHash);
    assert.equal(snapshot(),before);
  });
  await check('共享start仅任务revision更新，保留原队列/提示/错误/inputRevision且generate=false',async()=>{
    const state=seed('zhou-chef',makeTask('zhou-chef'),{inputRevision:9,error:'合成旧错误',retryAt:Number.MAX_SAFE_INTEGER,queue:['queued-synthetic'],taskEvents:[{id:'pending-event',taskId:'unrelated',revision:1,at:new Date(initial).toISOString(),kind:'step_completed',completedStepId:'first'}]});
    const before=structuredClone(state),task=state.professionalTasks[0];
    const result=applyProfessionalTaskMutation(state,{action:'task_session_start',taskId:task.id,eventId:randomUUID(),expectedRevision:task.revision},clock);
    assert.deepEqual(result,{changed:true,generate:false});assert.equal(task.revision,2);
    for(const key of ['inputRevision','error','retryAt','queue','taskEvents','messages','memories','values'])assert.deepEqual(state[key],before[key]);
  });
  for(const npc of ['chen-nian','zhou-chef']) {
    clock=initial;enabled=true;
    let task=makeTask(npc),state=seed(npc,task);
    await check(`${npc}鉴权与账号/人物隔离，旧owner cookie不能换账号`,async()=>{
      const command={action:'task_session_start',taskId:task.id,eventId:randomUUID(),expectedRevision:1};
      assert.equal((await api.request(npc,{method:'POST',body:command,legacyOwner:a.owner})).status,401);
      assert.equal((await api.request(npc,{account:b,header:a.id,method:'POST',body:command})).status,409);
      assert.equal((await api.request(npc,{account:b,method:'POST',body:command})).status,404);
      assert.deepEqual((await api.request(npc,{account:b})).data.professionalTasks,[]);
      const wrong=npc==='chen-nian'?'zhou-chef':'chen-nian';
      assert.equal((await api.request(wrong,{account:b,method:'POST',body:command})).status,404);
      const own=await api.request(npc,{account:a,legacyOwner:b.owner});
      assert.equal(own.data.professionalTasks[0].id,task.id);assert.equal(task.executionSessions,undefined);
    });
    let startCommand;
    await check(`${npc}服务器now开始，重复event/重复start/冲突均不重置`,async()=>{
      startCommand={action:'task_session_start',taskId:task.id,eventId:randomUUID(),expectedRevision:task.revision,startedAt:'2099-01-01T00:00:00Z',now:0};
      const response=await api.request(npc,{account:a,method:'POST',body:startCommand});
      assert.equal(response.status,200);task=response.data.professionalTasks[0];
      assert.equal(task.executionSessions.length,1);assert.equal(task.revision,2);
      const session=task.executionSessions[0];
      assert.equal(session.startedAt,new Date(clock).toISOString());assert.equal(session.date,'2026-10-12');
      assert.equal(session.kind,npc==='chen-nian'?'training':'cooking');assert.equal(session.status,'running');assert.equal(session.elapsedMs,0);
      assert.deepEqual(session.stepIds,['first','last']);assert.equal(saved(npc).inputRevision,state.inputRevision);assert.deepEqual(saved(npc).taskEvents,[]);
      await new Promise(resolve=>setTimeout(resolve,20));assert.equal(report.modelCalls,0);
      clock+=30_000;
      assert.equal((await api.request(npc,{account:a,method:'POST',body:startCommand})).status,200);
      assert.deepEqual(saved(npc).professionalTasks[0],task);
      const duplicate=await post(npc,task);assert.equal(duplicate.status,200);assert.deepEqual(duplicate.data.professionalTasks[0],task);
      const stale=await api.request(npc,{account:a,method:'POST',body:{...startCommand,eventId:randomUUID()}});
      assert.equal(stale.status,409);assert.equal(stale.data.code,'TASK_REVISION_CONFLICT');
      const eventConflict=await api.request(npc,{account:a,method:'POST',body:{...startCommand,action:'task_status',status:'paused'}});
      assert.equal(eventConflict.status,409);assert.equal(eventConflict.data.code,'TASK_EVENT_CONFLICT');
      const invalidBefore=snapshot();
      assert.equal((await post(npc,task,{stepId:'first'})).status,400);assert.equal(snapshot(),invalidBefore);
      assert.equal(report.modelCalls,0);
    });
    await check(`${npc}重启恢复真实起点/原字段与幂等事件`,async()=>{
      api.close();api=fixture();
      const restored=await api.request(npc,{account:a});
      assert.deepEqual(restored.data.professionalTasks[0],task);
      assert.equal((await api.request(npc,{account:a,method:'POST',body:startCommand})).status,200);
      assert.deepEqual(saved(npc).professionalTasks[0],task);
      const loaded=saved(npc);
      for(const key of ['messages','memories','values','queue','taskEvents','inputRevision'])assert.deepEqual(loaded[key],state[key]);
      if(npc==='chen-nian')assert.deepEqual(normalizeChen(structuredClone(loaded)).professionalTasks,loaded.professionalTasks);
    });
    await check(`${npc}开始→最后一项完成保存一小时，用时不会随重开继续增长`,async()=>{
      enabled=false;
      clock=initial+30*60_000;
      const first=await post(npc,task,{action:'task_step',stepId:'first',completed:true});
      assert.equal(first.status,200);task=first.data.professionalTasks[0];assert.equal(task.executionSessions[0].status,'running');
      clock=initial+60*60_000;
      const last=await post(npc,task,{action:'task_step',stepId:'last',completed:true});
      assert.equal(last.status,200);task=last.data.professionalTasks[0];assert.equal(task.status,'completed');
      assert.equal(task.executionSessions[0].status,'completed');assert.equal(task.executionSessions[0].elapsedMs,3_600_000);
      assert.equal(task.executionSessions[0].finishedAt,new Date(clock).toISOString());
      api.close();api=fixture();clock+=2*3_600_000;
      const after=await api.request(npc,{account:a});assert.deepEqual(after.data.professionalTasks[0],task);
      assert.equal((await post(npc,task)).status,400);assert.equal(report.modelCalls,0);
    });
    await check(`${npc}暂停/恢复状态不暗启，明确开始续计，取消冻结且不复活`,async()=>{
      clock=initial;enabled=false;state=seed(npc);task=state.professionalTasks[0];
      const start=await post(npc,task);assert.equal(start.status,200);task=start.data.professionalTasks[0];
      clock+=32_125;
      const pause=await post(npc,task,{action:'task_status',status:'paused'});assert.equal(pause.status,200);task=pause.data.professionalTasks[0];
      assert.equal(task.executionSessions[0].status,'paused');assert.equal(task.executionSessions[0].elapsedMs,32_125);
      const paused=saved(npc).professionalTasks[0];clock+=5*60_000;
      assert.equal((await post(npc,task)).status,400);assert.deepEqual(saved(npc).professionalTasks[0],paused);
      const active=await post(npc,task,{action:'task_status',status:'active'});assert.equal(active.status,200);task=active.data.professionalTasks[0];
      assert.equal(task.executionSessions[0].status,'paused');assert.equal(task.executionSessions[0].elapsedMs,32_125);
      clock+=2*60_000;
      const resume=await post(npc,task);assert.equal(resume.status,200);task=resume.data.professionalTasks[0];assert.equal(task.executionSessions[0].status,'running');
      clock+=20_000;
      const cancelled=await post(npc,task,{action:'task_status',status:'cancelled'});assert.equal(cancelled.status,200);task=cancelled.data.professionalTasks[0];
      assert.equal(task.executionSessions[0].status,'cancelled');assert.equal(task.executionSessions[0].elapsedMs,52_125);
      api.close();api=fixture();clock+=3_600_000;
      assert.deepEqual((await api.request(npc,{account:a})).data.professionalTasks[0],task);
      assert.equal((await post(npc,task)).status,400);
      assert.equal((await post(npc,task,{action:'task_status',status:'active'})).status,400);assert.equal(report.modelCalls,0);
    });
    await check(`${npc}错误版本与已取消失败不留下session或幂等记录`,async()=>{
      const before=snapshot();
      const stale=await post(npc,task,{expectedRevision:task.revision-1});assert.equal(stale.status,409);assert.equal(stale.data.code,'TASK_REVISION_CONFLICT');
      const unknown=await post(npc,{...task,id:'absent'});assert.equal(unknown.status,404);
      assert.equal(snapshot(),before);
    });
    await check(`${npc}未来执行日期及非训练/做饭任务不能开启整次计时`,async()=>{
      clock=initial;state=seed(npc);task=state.professionalTasks[0];
      task.steps.forEach(step=>step.scheduledDate='2026-10-13');seed(npc,task);
      let before=snapshot();
      const future=await post(npc,task);assert.equal(future.status,400);assert.equal(future.data.code,'TASK_SESSION_NOT_DUE');assert.equal(snapshot(),before);
      task=makeTask(npc);task.title=npc==='chen-nian'?'合成营养补充计划':'合成采购清单';task.goalKey='购物';
      task.steps.forEach((step,index)=>{step.title=`购买物品${index}`;step.details=['合成采购说明'];});seed(npc,task);before=snapshot();
      const unsupported=await post(npc,task);assert.equal(unsupported.status,400);assert.equal(unsupported.data.code,'TASK_SESSION_UNAVAILABLE');assert.equal(snapshot(),before);
    });
    await check(`${npc}并发相同revision只创建一个session，另一请求冲突`,async()=>{
      task=seed(npc).professionalTasks[0];
      const responses=await Promise.all([post(npc,task),post(npc,task)]);
      assert.deepEqual(responses.map(response=>response.status).sort((left,right)=>left-right),[200,409]);
      const persisted=saved(npc).professionalTasks[0];assert.equal(persisted.revision,2);assert.equal(persisted.executionSessions.length,1);
      assert.equal(saved(npc).taskMutations.length,1);assert.equal(report.modelCalls,0);
    });
  }
  assert.equal(report.modelCalls,0);assert.equal(networkAttempts,0);
  for(const file of ['server/npc/professional-task-mutation.ts','server/npc/dialogue-health.ts','lib/npc/professional-task-session.ts','lib/npc/professional-task.ts'])report.sourceHashes[file]=createHash('sha256').update(readFileSync(file)).digest('hex');
} catch(error) {
  report.failures.push({message:error.message,stack:error.stack});throw error;
} finally {
  report.networkAttempts=networkAttempts;
  if(outputArgument){const output=resolve(outputArgument.slice('--output='.length));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  db?.close();api?.close();runtime.cleanup();globalThis.fetch=originalFetch;
}
console.log(`PASS task-session API: ${report.passed.length} regression groups; real auth/middleware, temporary SQLite, zero real APIs/model/network.`);
