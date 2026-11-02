import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real auth/chef middleware and temporary SQLite, without opening a port,
// touching a real account, calling a provider, or reading production state.
const runtime=isolatedNpcRuntime(),originalFetch=globalThis.fetch;
let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw Error('Network disabled in cooking-complete regression');};
const outputArgument=process.argv.find(value=>value.startsWith('--output='));
const report={at:new Date().toISOString(),scope:'真实鉴权/厨师API＋临时SQLite＋合成任务/时间＋内存传输；无正式API/数据/消息/模型',passed:[],failures:[],modelCalls:0,networkAttempts:0,sourceHashes:{}};
const initial=Date.parse('2026-10-12T04:00:00Z');
let clock=initial,enabled=false,api,db;
const check=async(name,run)=>{await run();report.passed.push(name);};
try {
  const {authLocal}=await runtime.load('server/npc/auth-plugin');
  const {chenLocal}=await runtime.load('server/npc/chen-plugin');
  const {chefLocal}=await runtime.load('server/npc/zhou-chef-plugin');
  const {dialogueHealth}=await runtime.load('server/npc/dialogue-health');
  const {createChef}=await runtime.load('lib/npc/zhou-chef');
  const {createChen}=await runtime.load('lib/npc/chen-nian');
  const {applyProfessionalTaskMutation}=await runtime.load('server/npc/professional-task-mutation');
  const {completeProfessionalTaskSession,mutateProfessionalTaskSession,PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION}=await runtime.load('lib/npc/professional-task-session');
  const fixture=()=>{
    const server=new EventEmitter(),handlers=[];
    const service={config:{root:runtime.root},httpServer:server,middlewares:{use(prefix,handler){handlers.push(typeof prefix==='function'?{prefix:'',handler:prefix}:{prefix,handler});}}};
    const deps={now:()=>clock,available:()=>enabled,generate:async()=>{report.modelCalls++;throw Error('Unexpected cooking-complete generation');}};
    for(const plugin of [dialogueHealth(),authLocal(),chenLocal(deps),chefLocal(deps)])plugin.configureServer(service);
    const request=(npc='zhou-chef',{account,method='GET',body,header=account?.id,legacyOwner=account?.owner,token=account?.token,path}={})=>new Promise((resolveResponse,reject)=>{
      const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
      req.method=method;req.url=path||`/api/npc/${npc}`;
      req.headers={host:'127.0.0.1:32002',origin:'http://127.0.0.1:32002',cookie:`${token?`zhiyu_auth=${token}; `:''}${legacyOwner?`zhiyu_npc=${legacyOwner}`:''}`,...(header?{'x-zhiyu-account':header}:{})};
      const headers={},res={statusCode:200,writableEnded:false,setHeader(name,value){headers[name.toLowerCase()]=value;},end(text){this.writableEnded=true;try{resolveResponse({status:this.statusCode,headers,data:JSON.parse(text)});}catch(error){reject(error);}}};
      let index=0;
      const next=()=>{const entry=handlers[index++];if(!entry)return reject(Error('Unhandled isolated request'));if(entry.prefix&&!req.url.startsWith(entry.prefix))return next();const original=req.url;if(entry.prefix)req.url=req.url.slice(entry.prefix.length)||'/';try{entry.handler(req,res,()=>{req.url=original;next();});}catch(error){reject(error);}};
      next();
    });
    return {request,close:()=>server.emit('close')};
  };
  api=fixture();db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
  const createAccount=name=>{const account={id:randomUUID(),owner:randomUUID(),token:randomBytes(32).toString('hex')};db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(account.id,name,'0'.repeat(32),'0'.repeat(128),account.owner,initial);db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(account.token).digest('hex'),account.id,Date.now()+3_600_000);return account;};
  const a=createAccount('SyntheticCookingFinishA'),b=createAccount('SyntheticCookingFinishB');
  const table=npc=>npc==='chen-nian'?'chen_sessions':'zhou_chef_sessions';
  const saved=(npc='zhou-chef',account=a)=>JSON.parse(db.prepare(`SELECT data FROM ${table(npc)} WHERE id=?`).get(`${account.owner}:${npc}`).data);
  const snapshot=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,rows:db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()})));
  const makeTask=(npc='zhou-chef')=>({id:randomUUID(),characterId:npc,title:npc==='zhou-chef'?'合成做饭计划':'合成训练计划',goalKey:'隔离测试',status:'active',revision:1,createdAt:new Date(initial).toISOString(),updatedAt:new Date(initial).toISOString(),sourceMessageId:'synthetic-source',cardMessageId:'synthetic-card',steps:[{id:'prep',title:'切好配菜',details:['合成指导'],hints:[]},{id:'cook',title:'下锅翻炒',details:['合成指导'],hints:[],durationSeconds:7200},{id:'plate',title:'摆盘',details:['合成指导'],hints:[]}]});
  const seed=(task=makeTask(),extras={},account=a)=>{const state={...(task.characterId==='zhou-chef'?createChef():createChen()),professionalTasks:[task],...extras};db.prepare(`INSERT OR REPLACE INTO ${table(task.characterId)} VALUES(?,?)`).run(`${account.owner}:${task.characterId}`,JSON.stringify(state));return state;};
  const command=(task,changes={})=>({action:'task_session_complete',taskId:task.id,eventId:randomUUID(),expectedRevision:task.revision,expectedSessionId:task.executionSessions?.at(-1)?.id,...changes});
  const post=(task,changes={},options={})=>api.request(task.characterId,{account:a,method:'POST',body:command(task,changes),...options});
  const start=async task=>{const response=await post(task,{action:'task_session_start'});assert.equal(response.status,200);return response.data.professionalTasks[0];};

  await check('只读health报告一次完成做饭能力，不访问或修改SQLite',async()=>{
    const before=snapshot(),response=await api.request('',{path:'/api/npc/dialogue-health'});
    assert.equal(response.status,200);assert.equal(response.data.ok,true);
    assert.equal(response.data.professionalTaskSession.completeVersion,PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION);
    assert.equal(response.data.professionalTaskSession.completeAction,'task_session_complete');assert.equal(response.data.professionalTaskSession.completeSupported,true);assert.equal(snapshot(),before);
  });
  let task=makeTask(),state,completion;
  await check('同一次做饭确认保存一小时/同now全完成，原已完时间与步骤计时保留',async()=>{
    clock=initial;task.steps[0].completedAt=new Date(initial-600_000).toISOString();state=seed(task);task=await start(task);
    const timer=await post(task,{action:'task_timer',stepId:'cook',operation:'start'});assert.equal(timer.status,200);task=timer.data.professionalTasks[0];
    const priorCompleted=task.steps[0].completedAt,revision=task.revision,inputRevision=saved().inputRevision;
    clock=initial+3_600_000;completion=command(task);enabled=true;
    const response=await api.request('zhou-chef',{account:a,method:'POST',body:completion});assert.equal(response.status,200);task=response.data.professionalTasks[0];
    assert.equal(task.status,'completed');assert.equal(task.revision,revision+1);assert.equal(saved().inputRevision,inputRevision+1);
    assert.equal(task.steps[0].completedAt,priorCompleted);assert.ok(task.steps.slice(1).every(step=>step.completedAt===new Date(clock).toISOString()));
    assert.equal(task.steps[1].timer.status,'paused');assert.equal(task.steps[1].timer.remainingMs,3_600_000);
    const session=task.executionSessions[0];assert.equal(session.status,'completed');assert.equal(session.elapsedMs,3_600_000);assert.equal(session.finishedAt,new Date(clock).toISOString());assert.ok(session.steps.every(step=>step.completedAt));
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(report.modelCalls,0);enabled=false;
  });
  await check('重复同event幂等且sessionId属于payload，新event完成已结束任务失败',async()=>{
    const before=structuredClone(task),inputRevision=saved().inputRevision,mutations=saved().taskMutations.length;
    clock+=3_600_000;
    const retry=await api.request('zhou-chef',{account:a,method:'POST',body:completion});assert.equal(retry.status,200);assert.deepEqual(saved().professionalTasks[0],before);assert.equal(saved().inputRevision,inputRevision);assert.equal(saved().taskMutations.length,mutations);
    const conflict=await api.request('zhou-chef',{account:a,method:'POST',body:{...completion,expectedSessionId:'different-session'}});assert.equal(conflict.status,409);assert.equal(conflict.data.code,'TASK_EVENT_CONFLICT');
    const beforeFailure=snapshot(),ended=await post(task);assert.equal(ended.status,400);assert.equal(ended.data.code,'TASK_SESSION_ENDED');assert.equal(snapshot(),beforeFailure);
  });
  await check('临时SQLite关闭重载恢复完成步骤/冻结一小时与重试幂等',async()=>{
    const before=structuredClone(task);api.close();api=fixture();clock+=3_600_000;
    assert.deepEqual((await api.request('zhou-chef',{account:a})).data.professionalTasks[0],before);
    assert.equal((await api.request('zhou-chef',{account:a,method:'POST',body:completion})).status,200);assert.deepEqual(saved().professionalTasks[0],before);
  });
  await check('一次完成只覆盖当前绑定日期组，未来周计划完整保留且task仍active',async()=>{
    clock=initial;task=makeTask();task.steps.forEach(step=>step.scheduledDate='2026-10-12');task.steps.push({id:'future',title:'明天下锅煮汤',details:['未来指导'],hints:[],scheduledDate:'2026-10-13'});seed(task);task=await start(task);
    const future=structuredClone(task.steps.at(-1)),revision=task.revision;clock+=3_600_000;
    const response=await post(task);assert.equal(response.status,200);task=response.data.professionalTasks[0];assert.equal(task.status,'active');assert.equal(task.revision,revision+1);assert.deepEqual(task.steps.at(-1),future);assert.ok(task.steps.slice(0,-1).every(step=>step.completedAt));assert.equal(task.executionSessions[0].status,'completed');assert.equal(task.executionSessions[0].elapsedMs,3_600_000);
  });
  await check('迟到确认不能完成新的日期session，即使拿到当前revision也冲突',async()=>{
    const oldSessionId=task.executionSessions[0].id;clock=initial+86_400_000;task=await start(task);
    assert.notEqual(task.executionSessions.at(-1).id,oldSessionId);const before=snapshot();
    const stale=await post(task,{expectedSessionId:oldSessionId});assert.equal(stale.status,409);assert.equal(stale.data.code,'TASK_SESSION_CONFLICT');assert.equal(snapshot(),before);
    const response=await post(task);assert.equal(response.status,200);task=response.data.professionalTasks[0];assert.equal(task.status,'completed');assert.equal(task.executionSessions.length,2);
  });
  await check('暂停task/暂停session/取消均不能绕过状态批量完成',async()=>{
    clock=initial;task=seed().professionalTasks[0];task=await start(task);
    const pause=await post(task,{action:'task_status',status:'paused'});assert.equal(pause.status,200);task=pause.data.professionalTasks[0];let before=snapshot();
    assert.equal((await post(task)).data.code,'TASK_SESSION_PAUSED');assert.equal(snapshot(),before);
    const active=await post(task,{action:'task_status',status:'active'});assert.equal(active.status,200);task=active.data.professionalTasks[0];before=snapshot();
    assert.equal((await post(task)).data.code,'TASK_SESSION_PAUSED');assert.equal(snapshot(),before);
    const cancel=await post(task,{action:'task_status',status:'cancelled'});assert.equal(cancel.status,200);task=cancel.data.professionalTasks[0];before=snapshot();
    assert.equal((await post(task)).data.code,'TASK_SESSION_ENDED');assert.equal(snapshot(),before);
  });
  await check('缺失/错误session、错误revision、步骤参数失败不部分落库或新增事件',async()=>{
    clock=initial;task=seed().professionalTasks[0];task=await start(task);
    for(const [changes,status,code] of [[{expectedSessionId:undefined},400,undefined],[{expectedSessionId:'different'},409,'TASK_SESSION_CONFLICT'],[{expectedRevision:task.revision-1},409,'TASK_REVISION_CONFLICT'],[{stepId:'cook'},400,undefined]]) {
      const before=snapshot(),response=await post(task,changes);assert.equal(response.status,status);if(code)assert.equal(response.data.code,code);assert.equal(snapshot(),before);
    }
    const broken=structuredClone(task);broken.executionSessions[0].stepIds.push('missing');seed(broken);let before=snapshot();let response=await post(broken);assert.equal(response.status,409);assert.equal(response.data.code,'TASK_SESSION_CONFLICT');assert.equal(snapshot(),before);
    broken.executionSessions[0].stepIds=['prep','prep'];seed(broken);before=snapshot();response=await post(broken);assert.equal(response.status,409);assert.equal(snapshot(),before);
    const deepBefore=structuredClone(broken);assert.throws(()=>completeProfessionalTaskSession(broken,broken.executionSessions[0].id,broken.revision,clock),error=>error.code==='TASK_SESSION_CONFLICT');assert.deepEqual(broken,deepBefore);
  });
  await check('鉴权/跨账号/错人物隔离，训练任务不获得本次做饭批量权限',async()=>{
    task=seed().professionalTasks[0];task=await start(task);const body=command(task);
    let before=snapshot();assert.equal((await api.request('zhou-chef',{method:'POST',body,legacyOwner:a.owner})).status,401);assert.equal(snapshot(),before);
    assert.equal((await api.request('zhou-chef',{account:b,header:a.id,method:'POST',body})).status,409);assert.equal(snapshot(),before);
    seed(makeTask(),{},b);before=snapshot();assert.equal((await api.request('zhou-chef',{account:b,method:'POST',body})).status,404);assert.equal(snapshot(),before);
    seed(makeTask('chen-nian'));before=snapshot();assert.equal((await api.request('chen-nian',{account:a,method:'POST',body})).status,404);assert.equal(snapshot(),before);
    let training=makeTask('chen-nian');training.steps.forEach(step=>{step.title='卧推';});seed(training);training=await start(training);before=snapshot();const unavailable=await post(training);assert.equal(unavailable.status,400);assert.equal(unavailable.data.code,'TASK_SESSION_COMPLETE_UNAVAILABLE');assert.equal(snapshot(),before);
  });
  await check('共享批量仅一次失效当前task旧hint，不造逐步事件或生成模型',async()=>{
    clock=initial;task=makeTask();mutateProfessionalTaskSession(task,'start',task.revision,clock);
    const staleMessage={id:'stale-synthetic-hint',role:'assistant',at:new Date(initial).toISOString(),deliverAt:initial+86_400_000,part:{type:'text',text:'合成过期提示'},professionalTaskHint:{taskId:task.id,stepId:'prep',eventId:'synthetic-event'}};
    task.steps[0].hints=[{id:'old',eventId:'synthetic-event',stepId:'prep',text:'合成提示',at:staleMessage.at,messageIds:[staleMessage.id]}];
    state=seed(task,{inputRevision:12,error:'合成旧错误',retryAt:Number.MAX_SAFE_INTEGER,messages:[staleMessage],taskEvents:[{id:'synthetic-event',taskId:task.id,revision:task.revision,at:staleMessage.at,kind:'step_completed',completedStepId:'prep'}]});
    const before=structuredClone(state);clock+=3_600_000;
    assert.deepEqual(applyProfessionalTaskMutation(state,command(task),clock),{changed:true,generate:false});assert.equal(state.inputRevision,13);assert.deepEqual(state.taskEvents,[]);assert.deepEqual(state.privateHistoryHiddenIds,[staleMessage.id]);assert.deepEqual(state.professionalTasks[0].steps[0].hints,[]);assert.equal(state.error,'');assert.equal(state.retryAt,0);
    for(const key of ['messages','queue','memories','values'])assert.deepEqual(state[key],before[key]);assert.equal(report.modelCalls,0);
  });
  await check('并发确认相同revision最多一次完成，第二次冲突无额外hint失效',async()=>{
    clock=initial;task=seed().professionalTasks[0];task=await start(task);const inputRevision=saved().inputRevision;clock+=3_600_000;
    const responses=await Promise.all([post(task),post(task)]);assert.deepEqual(responses.map(response=>response.status).sort((l,r)=>l-r),[200,409]);assert.equal(saved().professionalTasks[0].revision,task.revision+1);assert.equal(saved().inputRevision,inputRevision+1);assert.equal(saved().professionalTasks[0].executionSessions[0].elapsedMs,3_600_000);
  });
  assert.equal(report.modelCalls,0);assert.equal(networkAttempts,0);
  for(const file of ['lib/npc/professional-task-session.ts','server/npc/professional-task-mutation.ts','server/npc/dialogue-health.ts'])report.sourceHashes[file]=createHash('sha256').update(readFileSync(file)).digest('hex');
} catch(error) {report.failures.push({message:error.message,stack:error.stack});throw error;}
finally {report.networkAttempts=networkAttempts;if(outputArgument){const output=resolve(outputArgument.slice('--output='.length));mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');}db?.close();api?.close();runtime.cleanup();globalThis.fetch=originalFetch;}
console.log(`PASS cooking-complete API: ${report.passed.length} groups; auth/middleware/temp SQLite, zero real APIs/model/network.`);
