import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const rt=isolatedNpcRuntime();const servers=[];let db;
try {
 const {createYuan}=await rt.load('lib/npc/yuan-xiaoman');
 const {createLiu}=await rt.load('lib/npc/liu');
 const {createState}=await rt.load('lib/npc/engine');
 const C=await rt.load('lib/npc/contact-life');
 const {ensureYuanProactive,yuanProactiveDue}=await rt.load('lib/npc/yuan-proactive');
 const {ensureLife,dueKind}=await rt.load('lib/npc/life');
 const {runScheduledTurn}=await rt.load('server/npc/scheduler');
 const H=3600000,at=(h,day=20)=>Date.UTC(2030,8,day,h-8);
 const message=(role,text,at)=>({id:crypto.randomUUID(),turnId:crypto.randomUUID(),role,at:new Date(at).toISOString(),part:{type:'text',text}});
 const seed=(create=createYuan,time=at(18))=>{const s=create();s.values.affection=s.values.familiarity=100;s.messages=[message('user','下午好',time-H)];C.ensureContact(s,time);s.contactLife.nextAt=time;return s;};
 const reply=(s,time,kind='share',text='刚在小店试了一件外套')=>{const m=message('assistant',text,time);s.messages.push(m);C.completeContactTurn(s,time,kind,[m]);};
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
 check('three role sleep windows, late night and explicit awake state',()=>{
   const y=seed(),x=seed(()=>createState('normal')),l=seed(createLiu);
   assert.equal(C.contactSchedule(y,at(23)).sleeping,false);assert.equal(C.contactSchedule(y,at(4)).sleeping,true);
   assert.equal(C.contactSchedule(x,at(2)).sleeping,false);assert.equal(C.contactSchedule(x,at(4)).sleeping,true);
   assert.equal(C.contactSchedule(l,at(1)).sleeping,true);
   reply(y,at(0),null,'我还没睡，剪片剪得忘了时间');assert.equal(C.contactSchedule(y,at(1)).sleeping,false);
 });
 check('90 minute followup, only once, no repeated feeling deductions',()=>{
   const s=seed();reply(s,at(21));assert.equal(C.contactDecision(s,at(22)).kind,null);
   assert.equal(C.contactDecision(s,at(22)+H/2).kind,'followup');
   reply(s,at(22)+H/2,'followup','人呢，照片还没看呀');
   assert.notEqual(C.contactDecision(s,at(23)+H/2).kind,'followup');assert.equal(s.contactLife.audits.length,0);
   reply(s,at(23),'share','路上碰到一家小店');
   assert.equal(s.contactLife.waiting.followedUp,true);
   assert.notEqual(C.contactDecision(s,at(0,21)+H/2).kind,'followup');
 });
 check('busy for 24 hours permits sharing, suppresses followups and penalties',()=>{
   const s=seed();C.contactUserActivity(s,'我今天要去开会，连着开24小时',at(18));
   assert.equal(s.contactLife.busyUntil,at(18)+24*H);s.contactLife.nextAt=at(21);
   assert.equal(C.contactDecision(s,at(21)).kind,'evening');reply(s,at(21),'evening');
   s.contactLife.nextAt=at(23);assert.notEqual(C.contactDecision(s,at(23)).kind,'followup');
   assert.equal(s.contactLife.audits.length,0);
 });
 check('explicit DND and stop contact survive ordinary incoming messages',()=>{
   const s=seed();C.contactUserActivity(s,'先别打扰我，2小时',at(20));s.contactLife.nextAt=at(20);
   assert.equal(C.contactDecision(s,at(21)).reason,'do_not_disturb');
   C.contactUserActivity(s,'不要主动联系我',at(22));C.contactUserActivity(s,'你好',at(23));assert.equal(s.contactLife.enabled,false);
   C.contactUserActivity(s,'可以主动联系我',at(23));assert.equal(s.contactLife.enabled,true);
 });
 check('nightly contact, already talking counts, midnight no duplicate nightly task',()=>{
   const s=seed();assert.equal(C.contactDecision(s,at(20)).kind,'evening');reply(s,at(20),'evening');
   s.contactLife.nextAt=at(23);s.contactLife.waiting.followedUp=true;
   assert.notEqual(C.contactDecision(s,at(23)).kind,'evening');assert.notEqual(C.contactDecision(s,at(0,21)).kind,'evening');
   const b=seed();b.messages.push(message('assistant','聊得正开心',at(20)));b.contactLife.nextAt=at(21);
   assert.notEqual(C.contactDecision(b,at(21)).kind,'evening');
 });
 check('conflict absence affects short-term fields once; explanations recover; main values immutable',()=>{
   const s=seed(),values=structuredClone(s.values);const m=message('assistant','刚才那句话让我难受',at(21));s.messages.push(m);
   C.completeContactTurn(s,at(21),null,[m],{kind:'harm',basis:'user_claim',evidence:'你真烦'},'你真烦');
   assert.equal(C.contactDecision(s,at(22)+H/2).kind,'conflict_followup');
   reply(s,at(22)+H/2,'conflict_followup','刚才我还挺难受的');
   assert.deepEqual(s.contactLife.feelings,{mood:-2,dissatisfaction:2,unease:1});
   C.contactDecision(s,at(23));assert.equal(s.contactLife.audits.length,1);
   C.contactUserActivity(s,'刚才家里有事，没来得及说',at(23));assert.equal(s.contactLife.returning.explained,true);
   assert.deepEqual(s.contactLife.feelings,{mood:0,dissatisfaction:0,unease:0});assert.deepEqual(s.values,values);
 });
 check('return without explanation kept until successful reply; ordinary history preserved',()=>{
   const s=seed();reply(s,at(20));reply(s,at(21)+H/2,'followup');const old=JSON.stringify(s.messages);
   C.contactUserActivity(s,'好看',at(22));assert.equal(s.contactLife.returning.explained,false);
   C.contactUserActivity(s,'刚才在洗澡',at(22)+1000);assert.equal(s.contactLife.returning.explained,true);
   assert.equal(JSON.stringify(s.messages),old);reply(s,at(22),null);assert.equal(s.contactLife.returning,undefined);
 });
 check('topic rotation, no new flower loop; three-stage major event commits only on send',()=>{
   const s=seed();s.messages.push(message('assistant','花插进玻璃壶了，咖啡也喝完了',at(17)));
   C.prepareContactTurn(s,at(18),'share',()=>0.9);assert.ok(!['home','food'].includes(s.contactLife.scene.topic));
   const id=s.contactLife.scene.id;C.completeContactTurn(s,at(18),'share',[]);assert.equal(s.contactLife.journal.length,0);assert.equal(s.contactLife.scene.id,id);
   reply(s,at(19));const topic=s.contactLife.journal[0].topic;
   C.prepareContactTurn(s,at(23),'share',()=>0.9);assert.notEqual(s.contactLife.scene.topic,topic);
   s.contactLife.scene=undefined;s.contactLife.lastMajorAt=at(18)-8*24*H;s.contactLife.eventCheckedDay='';
   C.prepareContactTurn(s,at(18),'share',()=>0);assert.equal(s.contactLife.scene.major,true);const big=s.contactLife.scene.id;
   reply(s,at(18));C.prepareContactTurn(s,at(10,21),'share');assert.equal(s.contactLife.scene.id,big);assert.equal(s.contactLife.scene.step,2);
   reply(s,at(10,21));C.prepareContactTurn(s,at(23,21),'share');assert.equal(s.contactLife.scene.step,3);reply(s,at(23,21));assert.equal(s.contactLife.episode,undefined);
   assert.equal(s.contactLife.journal.filter(j=>j.sceneId===big).length,3);
 });
 check('legacy two-day deadline migrates; disabled state retained; no historical values changed',()=>{
   const s=seed();delete s.contactLife;s.proactive={enabled:true,nextAt:at(20)+48*H,sentAt:[at(18)],waitForUser:true,lastAttemptAt:0,lastError:''};
   const values=JSON.stringify(s.values),messages=JSON.stringify(s.messages);ensureYuanProactive(s,at(20));
   assert.equal(s.proactive.nextAt,at(21));assert.equal(yuanProactiveDue(s,at(21)),true);assert.equal(JSON.stringify(s.values),values);assert.equal(JSON.stringify(s.messages),messages);
   s.proactive.enabled=false;assert.equal(yuanProactiveDue(s,at(21)),false);
 });
 check('Xia permits daytime proactive messages, conflict followup and protects sleep/typing',()=>{
   const s=seed(()=>createState('normal'),at(14));ensureLife(s,at(14));s.life.lastUserAt=at(13);s.contactLife.nextAt=at(14);
   assert.equal(dueKind(s,at(14)),'proactive');s.life.typingClients={tab:{until:at(15),sequence:1}};assert.equal(dueKind(s,at(14)),null);
   s.life.typingClients={};assert.equal(dueKind(s,at(4,21)),null);
 });
 // Real plugin timers against isolated SQLite, with a controlled generator and virtual clock.
 const now=at(21);let calls=0,behavior='reply',release;
 const generate=async()=>{calls++;if(behavior==='race')await new Promise(r=>release=r);if(behavior==='fail')throw Error('test failure');return {action:behavior==='silent'?'silent':'reply',messages:behavior==='silent'?[]:[{type:'text',text:'刚试了一件新外套，袖子有点长'}],event:null,memories:[]};};
 for(const [module,fn] of [['yuan-plugin','yuanLocal'],['liu-plugin','liuLocal']]){
   const emitter=new EventEmitter();servers.push(emitter);const plugin=(await rt.load('server/npc/'+module))[fn];
   plugin({now:()=>now,available:()=>true,generate}).configureServer({config:{root:rt.root},middlewares:{use(){}},httpServer:emitter});
 }
 db=new DatabaseSync(join(rt.root,'.npc-runtime/state.sqlite'));
 const owner=crypto.randomUUID();
 const put=(table,s)=>db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?,?)`).run(owner+':'+s.characterId,JSON.stringify(s));
 const get=table=>JSON.parse(db.prepare(`SELECT data FROM ${table}`).get().data);
 const wait=()=>new Promise(r=>setTimeout(r,1200));
 const y=seed(createYuan,now),l=seed(createLiu,now);ensureYuanProactive(y,now);put('yuan_sessions',y);put('liu_sessions',l);
 await wait();assert.equal(calls,2);for(const table of ['yuan_sessions','liu_sessions']){const s=get(table);assert.equal(s.messages.at(-1).origin,'proactive');assert.equal(s.contactLife.journal.length,1);}
 await wait();assert.equal(calls,2);
 for(const table of ['yuan_sessions','liu_sessions'])db.prepare(`DELETE FROM ${table}`).run();
 behavior='silent';put('yuan_sessions',seed());await wait();assert.equal(get('yuan_sessions').contactLife.journal.length,0);assert.ok(get('yuan_sessions').contactLife.nextAt>now);
 behavior='fail';put('yuan_sessions',seed());await wait();assert.ok(get('yuan_sessions').contactLife.lastError);assert.equal(get('yuan_sessions').pending,null);
 behavior='race';put('yuan_sessions',seed());await wait();assert.ok(release);const racing=get('yuan_sessions');racing.queue.push('new');put('yuan_sessions',racing);release();await new Promise(r=>setTimeout(r,30));assert.equal(get('yuan_sessions').messages.length,1);
 servers.forEach(s=>s.emit('close'));
 let x=seed(()=>createState('normal'),now);ensureLife(x,now);x.life.lastUserAt=now-H;
 await runScheduledTurn({root:rt.root,load:()=>structuredClone(x),save:(_id,s)=>{x=structuredClone(s);},now:()=>now,generate:async()=>({action:'reply',messages:[{type:'text',text:'刚下楼散步去了'}],event:null,memories:[]})},'isolated');
 assert.equal(x.messages.at(-1).origin,'proactive');assert.equal(x.contactLife.journal.length,1);
 console.log(`PASS ${checks} state-machine scenarios + actual Yuan/Liu timers and Xia scheduler; isolated DB, no production chats or model calls`);
} finally {servers.forEach(s=>s.emit('close'));db?.close();rt.cleanup();}
