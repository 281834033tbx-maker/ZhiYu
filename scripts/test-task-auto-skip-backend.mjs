import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real private middleware and SQLite, with a fake clock/provider and synthetic
// account cookies. No port, production account, model or network access.
const runtime=isolatedNpcRuntime(),server=new EventEmitter(),handlers=new Map();
const originalFetch=globalThis.fetch;let networkAttempts=0,modelCalls=0,db;
globalThis.fetch=async()=>{networkAttempts++;throw Error('Network disabled in expiry regression');};
let clock=Date.parse('2026-10-18T23:59:30+08:00');
const owner=randomUUID(),enabled=new Set(),holds=new Map();
const tables={'chen-nian':'chen_sessions','zhou-chef':'zhou_chef_sessions',liu:'liu_sessions'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(check){for(let n=0;n<300;n++){if(check())return;await tick();}assert.fail('Synthetic asynchronous expiry check timed out');}
try{
 const {chenLocal}=await runtime.load('server/npc/chen-plugin');
 const {chefLocal}=await runtime.load('server/npc/zhou-chef-plugin');
 const {liuLocal}=await runtime.load('server/npc/liu-plugin');
 const {createChen}=await runtime.load('lib/npc/chen-nian');
 const {createChef}=await runtime.load('lib/npc/zhou-chef');
 const {createLiu}=await runtime.load('lib/npc/liu');
 const {ensureContact}=await runtime.load('lib/npc/contact-life');
 const {SecretaryStore}=await runtime.load('server/npc/secretary-service');
 const {readSecretaryTasks}=await runtime.load('server/npc/secretary-tasks');
 const makeState={'chen-nian':createChen,'zhou-chef':createChef,liu:createLiu};
 const baseState=npc=>{
   const state=npc==='liu'?createLiu(clock):makeState[npc]();
   if(npc==='liu'){const contact=ensureContact(state,clock);contact.enabled=false;}
   return state;
 };
 const service={config:{root:runtime.root},httpServer:server,middlewares:{use(path,handler){handlers.set(path,handler);}}};
 for(const [npc,factory] of [['chen-nian',chenLocal],['zhou-chef',chefLocal],['liu',liuLocal]])factory({now:()=>clock,available:()=>enabled.has(npc),generate:async()=>{
   modelCalls++;return await new Promise(resolve=>holds.set(npc,resolve));
 }}).configureServer(service);
 db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
 const saved=npc=>JSON.parse(db.prepare(`SELECT data FROM ${tables[npc]} WHERE id=?`).get(`${owner}:${npc}`).data);
 const seed=(npc,tasks,extra={})=>{
   const s={...baseState(npc),professionalTasks:tasks,queue:[],taskEvents:[],...extra};
   db.prepare(`INSERT OR REPLACE INTO ${tables[npc]} VALUES(?,?)`).run(`${owner}:${npc}`,JSON.stringify(s));return s;
 };
 const task=(npc,date='2026-10-18',extra={})=>({id:randomUUID(),characterId:npc,title:npc==='liu'?'合成饮食':'合成执行任务',goalKey:'synthetic',status:'active',revision:1,sourceMessageId:'synthetic-source',cardMessageId:'original-card',createdAt:'2026-10-18T01:00:00.000Z',updatedAt:'2026-10-18T01:00:00.000Z',steps:[{id:'done',title:'已完成',details:['合成已完成步骤'],scheduledDate:date,completedAt:'2026-10-18T02:00:00.000Z',hints:[]},{id:'todo',title:'未完成',details:['合成待做步骤'],scheduledDate:date,hints:[]}],...extra});
 const request=(npc,body)=>new Promise((resolve,reject)=>{
   const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=body===undefined?'GET':'POST';req.url='/';req.headers={host:'127.0.0.1:32011',origin:'http://127.0.0.1:32011',cookie:`zhiyu_npc=${owner}`,'content-type':'application/json'};
   const res={statusCode:200,writableEnded:false,setHeader(){},end(value){this.writableEnded=true;try{resolve({status:this.statusCode,data:JSON.parse(value)});}catch(error){reject(error);}}};handlers.get(`/api/npc/${npc}`)(req,res);
 });
 const originalHistory={id:'ORIGINAL_HISTORY',turnId:'retained-turn',role:'user',at:'2026-10-18T01:00:00.000Z',part:{type:'text',text:'只保留这条合成历史'}};
 const archived=new Map();
 for(const npc of Object.keys(tables)){
   const current=task(npc),hint={id:'unsent-'+npc,turnId:'old-event',role:'assistant',at:'2026-10-18T15:59:30.000Z',deliverAt:Date.parse('2026-10-19T00:01:00+08:00'),part:{type:'text',text:'尚未送达的旧任务提示'},professionalTaskHint:{taskId:current.id,stepId:'todo',eventId:'old-event'}};
   seed(npc,[current],{queue:['retained-turn'],messages:[originalHistory,hint],inputRevision:4,taskEvents:[{id:'old-event',taskId:current.id,revision:1,at:'2026-10-18T02:00:00.000Z',kind:'step_completed',completedStepId:'done',nextStepId:'todo'}]});
   for(const suffix of [':test',':backup',':early-sharing']){
     const id=`${owner}:${npc}${suffix}`,value=JSON.stringify({...makeState[npc](),professionalTasks:[task(npc)],messages:[{...originalHistory,id:'ARCHIVED_PRIVATE_SENTINEL'}]});
     db.prepare(`INSERT OR REPLACE INTO ${tables[npc]} VALUES(?,?)`).run(id,value);archived.set(`${tables[npc]}|${id}`,value);
   }
 }
 clock=Date.parse('2026-10-19T00:00:01+08:00');
 await new Promise(resolve=>setTimeout(resolve,1150));
 for(const npc of Object.keys(tables)){
   const s=saved(npc),current=s.professionalTasks[0];assert.equal(current.status,'skipped',`${npc} settles on the service timer without a page or model`);assert.equal(current.steps[1].skippedAt,'2026-10-18T16:00:00.000Z');assert.equal(current.steps[0].completedAt,'2026-10-18T02:00:00.000Z');assert.equal(current.steps[0].skippedAt,undefined);
   assert.deepEqual(s.queue,['retained-turn']);assert.deepEqual(s.messages[0],originalHistory);assert.deepEqual(s.taskEvents,[]);assert.ok(s.privateHistoryHiddenIds.includes('unsent-'+npc));assert.equal(s.inputRevision,5);
   const canonical=JSON.stringify(s);assert.equal((await request(npc)).status,200);assert.equal(JSON.stringify(saved(npc)),canonical,'read reconciliation is idempotent');
   const forbidden=[{action:'task_step',stepId:'todo',completed:true},{action:'task_step',stepId:'done',completed:false},{action:'task_step_date',stepId:'todo',scheduledDate:'2026-10-19'},{action:'task_status',status:'active'},{action:'task_session_start'},{action:'task_timer',stepId:'todo',operation:'resume'}];
   for(const operation of forbidden){const response=await request(npc,{...operation,taskId:current.id,eventId:randomUUID(),expectedRevision:current.revision});assert.equal(response.status,409,`${npc} rejects ${operation.action}`);assert.equal(response.data.code,'TASK_SKIPPED');}
   assert.equal(JSON.stringify(saved(npc)),canonical,'offline commands never revive a skipped instance');
   // A service that was stopped for several days settles on the next read.
   const offline=task(npc,'2026-10-15',{createdAt:'2026-10-15T01:00:00.000Z'});seed(npc,[offline]);
   const response=await request(npc);assert.equal(response.data.professionalTasks[0].status,'skipped');assert.equal(saved(npc).professionalTasks[0].steps[1].skippedAt,'2026-10-15T16:00:00.000Z');
   const mixed=task(npc);mixed.steps[1].scheduledDate='2026-10-20';seed(npc,[mixed]);await request(npc);
   const mixedBefore=JSON.stringify(saved(npc));
   for(const operation of [{action:'task_step',stepId:'done',completed:false},{action:'task_step_date',stepId:'done',scheduledDate:'2026-10-20'}]){
     const refused=await request(npc,{...operation,taskId:mixed.id,eventId:randomUUID(),expectedRevision:mixed.revision});assert.equal(refused.status,409);assert.equal(refused.data.code,'TASK_DAY_CLOSED','a historical genuine completion is immutable without being mislabeled skipped');
   }
   assert.equal(JSON.stringify(saved(npc)),mixedBefore);assert.equal(saved(npc).professionalTasks[0].status,'active','future live steps remain usable');
 }
 assert.equal(modelCalls,0,'expiry scan and offline commands never require a model');
 for(const [key,value] of archived){const [table,id]=key.split('|');assert.equal(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id).data,value,'automatic private timers leave archived/debug session rows byte-identical');}

 // Across an await, load must see the expiry revision and discard the old
 // draft while preserving the real source message and pending source queue.
 const reply={action:'reply',messages:[{type:'text',text:'OLD_DRAFT_MUST_NOT_COMMIT'}],event:null,memories:[],task:{decision:'none'}};
 for(const npc of Object.keys(tables)){
   clock=Date.parse('2026-10-20T23:59:55+08:00');seed(npc,[task(npc,'2026-10-20')]);enabled.add(npc);
   const turnId=randomUUID();await request(npc,{action:'send',text:'当前动作先聊两句',turnId});await until(()=>holds.has(npc));
   clock=Date.parse('2026-10-21T00:00:01+08:00');await request(npc);enabled.delete(npc);holds.get(npc)(reply);holds.delete(npc);await until(()=>saved(npc).pending===null);
   const s=saved(npc);assert.equal(s.professionalTasks[0].status,'skipped');assert.ok(!s.messages.some(message=>message.part.text==='OLD_DRAFT_MUST_NOT_COMMIT'));assert.ok(s.queue.includes(turnId));assert.ok(s.messages.some(message=>message.turnId===turnId&&message.role==='user'));
 }

 // An undated task created after midnight still belongs to yesterday's
 // actual source request, even if no task existed when generation started.
 clock=Date.parse('2026-10-22T23:59:58+08:00');seed('zhou-chef',[]);enabled.add('zhou-chef');
 const newText='给我一个番茄炒蛋的做饭任务',newTurn=randomUUID();await request('zhou-chef',{action:'send',text:newText,turnId:newTurn});await until(()=>holds.has('zhou-chef'));
 const realSource=saved('zhou-chef').messages.find(message=>message.turnId===newTurn&&message.role==='user');
 clock=Date.parse('2026-10-23T00:00:01+08:00');enabled.delete('zhou-chef');holds.get('zhou-chef')({...reply,messages:[{type:'text',text:'任务在这。'}],task:{decision:'create',basis:'explicit_request',confidence:.99,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:realSource.id,evidence:newText,title:'番茄炒蛋',goalKey:'番茄炒蛋',steps:[{title:'处理番茄',details:['洗净切块']},{title:'炒鸡蛋',details:['蛋液下锅炒熟后盛出']}]}});holds.delete('zhou-chef');
 await until(()=>saved('zhou-chef').pending===null);const late=saved('zhou-chef');assert.equal(late.professionalTasks.length,1,'synthetic fresh creation completes normally');assert.equal(late.professionalTasks[0].status,'skipped','yesterday request cannot silently become today task');assert.ok(late.professionalTasks[0].steps.every(step=>step.skippedAt==='2026-10-22T16:00:00.000Z'));

 // The secretary reads fresh state even when reminders are disabled and
 // returns canonical completion state for obsolete offline group mutations.
 const secretary=new SecretaryStore(db,runtime.root,{now:()=>clock});secretary.updateSettings(owner,{enabled:false,time:'08:00'});
 seed('liu',[task('liu','2026-10-20')]);secretary.scanTaskExpiry();assert.equal(saved('liu').professionalTasks[0].status,'skipped');assert.equal(secretary.morning(owner),false);
 for(const [key,value] of archived){const [table,id]=key.split('|');assert.equal(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id).data,value,'secretary-wide clock only settles canonical UUID:character sessions');}
 const otherOwner=randomUUID(),otherState={...baseState('liu'),professionalTasks:[task('liu','2026-10-20',{title:'OTHER_OWNER_PRIVATE_SENTINEL'})]};
 db.prepare('INSERT INTO liu_sessions VALUES(?,?)').run(`${otherOwner}:liu`,JSON.stringify(otherState));
 const ownContext=secretary.context(owner);assert.ok(!JSON.stringify(ownContext).includes('OTHER_OWNER_PRIVATE_SENTINEL'));assert.ok(!JSON.stringify(ownContext).includes('ARCHIVED_PRIVATE_SENTINEL'));assert.equal(db.prepare('SELECT data FROM liu_sessions WHERE id=?').get(`${otherOwner}:liu`).data,JSON.stringify(otherState),'an owner-specific read does not settle or read another owner session');
 db.exec('CREATE TABLE IF NOT EXISTS npc_group_chats(owner TEXT,id TEXT,data TEXT)');
 const group={id:'synthetic-daily',name:'合成群',goal:'饮食',members:[],messages:[],createdAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z',plan:{id:'synthetic-plan',status:'confirmed',days:['2026-10-22','2026-10-23'].map(date=>({date,label:'合成饮食',breakfast:'早餐',lunch:'午餐',dinner:'晚餐'})),shopping:[]}};
 db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?)').run(owner,group.id,JSON.stringify(group));
 const before=readSecretaryTasks(db,owner,Date.parse('2026-10-22T10:00:00+08:00')),past=before.allEntries.find(entry=>entry.groupId===group.id&&entry.dates[0]==='2026-10-22'),today=before.allEntries.find(entry=>entry.groupId===group.id&&entry.dates[0]==='2026-10-23');assert.ok(past);assert.ok(today);
 const canonical=secretary.updateCompletions(owner,{[past.id]:true,[today.id]:true});assert.equal(canonical[past.id],undefined,'expired offline check is consumed without changing server state');assert.equal(canonical[today.id],true,'unrelated valid completion still saves');
 const entries=readSecretaryTasks(db,owner,clock).allEntries;assert.equal(entries.find(entry=>entry.id===past.id).status,'skipped');assert.equal(entries.find(entry=>entry.id===today.id).status,'completed');
 clock=Date.parse('2026-10-24T00:00:01+08:00');assert.equal(secretary.updateCompletions(owner,{[today.id]:false})[today.id],true,'historical genuine completion cannot be undone by an offline request');
 secretary.stop();assert.equal(networkAttempts,0);
 console.log('PASS task auto-skip backend: three real private middleware/timers, offline read settlement, no revival mutations, async stale draft rejection, original-source undated day, settings-independent secretary scan, canonical group offline reconciliation; synthetic SQLite/provider only');
}finally{server.emit('close');db?.close();runtime.cleanup();globalThis.fetch=originalFetch;}
