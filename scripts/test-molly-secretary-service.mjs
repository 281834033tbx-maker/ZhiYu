import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime();
try{
  const {SecretaryStore,explicitlyContinuePlan}=await runtime.load('server/npc/secretary-service');
  const {readSecretaryTasks}=await runtime.load('server/npc/secretary-tasks');
  const {createMolly}=await runtime.load('lib/npc/molly');
  const {secretaryLocal}=await runtime.load('server/npc/secretary-plugin');
  const owner=crypto.randomUUID(),other=crypto.randomUUID();
  let now=Date.parse('2026-10-15T20:00:00+08:00');
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE liu_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE npc_group_chats(owner TEXT,id TEXT,data TEXT)');
  const makeTask=(extra={})=>({id:'shoulder',characterId:'chen-nian',title:'练肩',goalKey:'肩部训练',status:'active',revision:1,sourceMessageId:'real-source',
    createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),steps:[
      {id:'warmup',title:'热身',details:['已知计划热身'],scheduledDate:'2026-10-16',completedAt:new Date(now).toISOString(),hints:[]},
      {id:'work',title:'训练',details:['原有训练内容'],scheduledDate:'2026-10-16',hints:[]},
    ],...extra});
  const state={revision:7,characterId:'chen-nian',messages:[{id:'original-card',turnId:'original',role:'assistant',at:new Date(now).toISOString(),part:{type:'professional_task',taskId:'shoulder'}}],professionalTasks:[makeTask()]};
  const seed=(who,value)=>db.prepare('INSERT OR REPLACE INTO chen_sessions VALUES(?,?)').run(`${who}:chen-nian`,JSON.stringify(value));
  const saved=who=>JSON.parse(db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(`${who}:chen-nian`).data);
  seed(owner,state);seed(other,{...state,professionalTasks:[makeTask({id:'private-other',title:'别人的任务'})]});
  const otherBefore=saved(other);
  const requests=[];let busy=false;
  const store=new SecretaryStore(db,runtime.root,{now:()=>now,receiver:async(_root,_db,input)=>{requests.push(input);return {status:busy?'busy':'delivered',messageIds:[],taskIds:[]};}});
  assert.deepEqual(store.settings(owner),{enabled:true,time:'08:00'});
  assert.throws(()=>store.updateSettings(owner,{enabled:true,time:'25:10'}));
  assert.throws(()=>store.settings('forged-owner'));
  const context=store.context(owner);
  assert.equal(context.taskSummary.allTasks.count,1);
  assert.ok(!JSON.stringify(context).includes('别人的任务'));
  assert.equal(store.morning(owner),false,'installation after 08:00 must not replay today');
  now=Date.parse('2026-10-16T07:59:00+08:00');assert.equal(store.morning(owner),false);
  now=Date.parse('2026-10-16T08:00:01+08:00');assert.equal(store.morning(owner),true);
  assert.equal(store.morning(owner),false);
  const after=saved(owner);
  assert.equal(after.professionalTasks[0].steps[0].completedAt,state.professionalTasks[0].steps[0].completedAt);
  assert.equal(after.professionalTasks[0].steps[1].completedAt,undefined);
  assert.equal(after.messages.filter(message=>message.secretaryEvent?.kind==='task-reminder').length,1);
  assert.equal(after.messages.at(-1).part.taskId,'shoulder');
  assert.ok(after.professionalTasks[0].cardMessageIds.includes(after.messages.at(-1).id),'daily card is a legitimate reference to the original task');
  assert.deepEqual(saved(other),otherBefore,'other owner is untouched');
  const molly=()=>JSON.parse(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`).data);
  assert.equal(molly().messages.length,1);assert.equal(molly().messages[0].taskLinks[0].scope,'today');
  const restarted=new SecretaryStore(db,runtime.root,{now:()=>now});assert.equal(restarted.morning(owner),false,'restart does not repeat today');
  console.log('PASS 08:00 clock, installation guard, restart dedupe, original card/progress and owner isolation');

  store.updateSettings(owner,{enabled:false,time:'09:15'});
  now=Date.parse('2026-10-17T09:16:00+08:00');
  seed(owner,{...after,professionalTasks:[makeTask({steps:[{id:'work',title:'训练',details:['原任务'],scheduledDate:'2026-10-17',hints:[]}]})]});
  assert.equal(store.morning(owner),false);
  store.updateSettings(owner,{enabled:true,time:'10:00'});
  now=Date.parse('2026-10-17T09:59:59+08:00');assert.equal(store.morning(owner),false);
  const cancelled=saved(owner);cancelled.professionalTasks[0].status='cancelled';seed(owner,cancelled);
  now=Date.parse('2026-10-17T10:00:01+08:00');assert.equal(store.morning(owner),false);
  cancelled.professionalTasks[0].status='active';cancelled.professionalTasks[0].steps[0].scheduledDate='2026-10-18';seed(owner,cancelled);
  assert.equal(store.morning(owner),false,'rescheduled task must not be reminded on old date');
  console.log('PASS settings change/disable preserves tasks; cancelled and rescheduled tasks are not reminded');

  const inputState=createMolly(),turn=crypto.randomUUID(),messageId=crypto.randomUUID();
  inputState.queue=[turn];inputState.messages=[{id:messageId,turnId:turn,role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'帮我安排下周的饮食'}}];
  const source={scope:'current_user',polarity:'affirmed',confidence:.99,sourceMessageId:messageId,evidence:'安排下周的饮食'};
  const action={...source,type:'handoff',targetId:'liu',service:'nutrition',request:'安排下周饮食',mode:'continue-plan'};
  await store.execute(owner,[action],inputState);await store.execute(owner,[action],inputState);
  assert.equal(db.prepare('SELECT count(*) AS n FROM npc_secretary_jobs').get().n,1);
  busy=true;await store.drain(owner);assert.equal(requests.length,1);assert.equal(requests[0].planMode,'confirm-plan');
  assert.equal(requests[0].source.text,'帮我安排下周的饮食');
  assert.equal(inputState.messages.filter(message=>message.role==='user').length,1,'outbox never fabricates a private user message');
  now+=1500;busy=false;await store.drain(owner);await store.drain(owner);assert.equal(requests.length,2);
  assert.equal(db.prepare('SELECT status FROM npc_secretary_jobs').get().status,'delivered');
  await assert.rejects(()=>store.execute(owner,[{...action,sourceMessageId:'forged'}],inputState));
  const receipt=await store.execute(owner,[{...source,type:'tasks',taskScope:'all'}],inputState);
  assert.deepEqual(receipt.taskLinks,[{scope:'all',label:'查看全部任务'}]);
  assert.ok(explicitlyContinuePlan('下周按上周的方案安排'));assert.equal(explicitlyContinuePlan('下周不要按上周的方案'),false);
  console.log('PASS durable handoff source, implicit renewal confirmation, busy retry and one-time delivery');

  const group={id:'group-test',name:'饮食',members:[],messages:[],createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),goal:'一周饮食',sourceCharacterId:'molly',createdBy:'molly',chatEnabled:true,namingSource:'molly-model',
    plan:{id:'plan',status:'confirmed',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),days:Array.from({length:7},(_,i)=>({date:`2026-10-${String(19+i).padStart(2,'0')}`,label:'饮食',breakfast:'鸡蛋',lunch:'午餐',dinner:'晚餐'})),shopping:[]}};
  db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?)').run(owner,group.id,JSON.stringify(group));
  const item=readSecretaryTasks(db,owner,now).allEntries.find(entry=>entry.groupId===group.id);assert.ok(item);
  store.updateCompletions(owner,{[item.id]:true,'foreign-task':true});
  assert.equal(store.completions(owner)[item.id],true);assert.equal(store.completions(owner)['foreign-task'],undefined);assert.deepEqual(store.completions(other),{});
  assert.equal(readSecretaryTasks(db,owner,now).allEntries.find(entry=>entry.id===item.id).status,'completed');
  store.updateCompletions(owner,{[item.id]:false});assert.equal(store.completions(owner)[item.id],undefined);
  const reminderGroup={...group,id:'group-reminders',plan:undefined,reminders:[{id:'breakfast-reminder',meal:'breakfast',time:'08:00',timezone:'Asia/Shanghai',startDate:'2026-10-19',endDate:'2026-10-25',status:'active'}]};
  db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?)').run(owner,reminderGroup.id,JSON.stringify(reminderGroup));
  const range=readSecretaryTasks(db,owner,now).allEntries.filter(entry=>entry.groupId===reminderGroup.id);
  assert.equal(range.length,7,'all tasks include the middle days of a standalone reminder range');
  const middle=range.find(entry=>entry.dates[0]==='2026-10-22');assert.ok(middle);store.updateCompletions(owner,{[middle.id]:true});assert.equal(store.completions(owner)[middle.id],true);
  console.log('PASS group task completion synchronization and foreign-ID rejection');
  store.stop();restarted.stop();db.close();

  // Exercise the actual HTTP handler in memory, without opening a port or using
  // any real cookie/account/database. authLocal owns the signed-in owner upstream.
  let handler;const server=new EventEmitter();
  secretaryLocal({automatic:false}).configureServer({config:{root:runtime.root},httpServer:server,middlewares:{use(_path,fn){handler=fn;}}});
  const api=(method,body,headers={})=>new Promise(resolve=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/';req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101','content-type':'application/json',cookie:`zhiyu_npc=${owner}`,...headers};
    const res={statusCode:200,writableEnded:false,setHeader(){},end(value){this.writableEnded=true;resolve({status:this.statusCode,body:JSON.parse(value)});}};handler(req,res);
  });
  assert.equal((await api('GET',undefined,{cookie:''})).status,401);
  assert.equal((await api('POST',{action:'settings',enabled:false,time:'09:00'},{origin:'http://evil.test'})).status,403);
  assert.equal((await api('POST',{action:'settings',enabled:false,time:'99:00'})).status,400);
  const updated=await api('POST',{action:'settings',enabled:false,time:'09:00'});assert.equal(updated.status,200);assert.deepEqual(updated.body.settings,{enabled:false,time:'09:00'});
  assert.deepEqual((await api('GET')).body.settings,updated.body.settings);
  assert.equal((await api('POST',{action:'settings',enabled:true,time:'08:00',owner:other})).status,400);
  server.emit('close');console.log('PASS real settings API handler, origin validation and persisted per-owner configuration');
}finally{runtime.cleanup();}
