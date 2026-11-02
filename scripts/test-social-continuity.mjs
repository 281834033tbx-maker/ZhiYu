import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime(),db=new DatabaseSync(':memory:');
try{
 const api=await runtime.load('server/npc/social-continuity');
 const core=await runtime.load('lib/npc/social-continuity');
 const {createYuan,parseYuan,applyYuan}=await runtime.load('lib/npc/yuan-xiaoman');
 const {ensureContact}=await runtime.load('lib/npc/contact-life');
 const {loadDialogueSkill}=await runtime.load('server/npc/dialogue-skill');
 const now=Date.now(),owner=randomUUID(),other=randomUUID();
 db.exec('CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE sessions(id TEXT PRIMARY KEY,data TEXT,revision INTEGER)');
 const key=owner+':yuan-xiaoman';
 const read=()=>JSON.parse(db.prepare('SELECT data FROM yuan_sessions WHERE id=?').get(key).data);
 const write=s=>db.prepare('INSERT OR REPLACE INTO yuan_sessions VALUES(?,?)').run(key,JSON.stringify(s));
 const person=(id)=>({id,name:id,role:id==='user'?'user':'npc',joinedAt:new Date(now-86400000).toISOString(),order:1});
 const input=(id,type='text')=>({id,senderId:'user',senderName:'合成用户',type,text:'公开合成内容',mentionIds:[],at:new Date(now).toISOString()});
 const groupFor=m=>({id:'group-'+randomUUID(),name:'合成群',goal:'合成',members:[person('user'),person('yuan-xiaoman'),person('molly')],messages:[m]});
 const m=input('source-1'),group=groupFor(m);
 let s=createYuan(now-7200000);s.messages=[{id:'private-user',turnId:'u',role:'user',at:new Date(now-7200000).toISOString(),part:{type:'text',text:'PRIVATE_SECRET_SENTINEL'}},{id:'private-assistant',turnId:'a',role:'assistant',origin:'chat',at:new Date(now-7100000).toISOString(),part:{type:'text',text:'你今天怎么样？PRIVATE_REPLY_SENTINEL'}}];
 ensureContact(s,now);write(s);
 const snapshots=api.observeGroupActivity(db,owner,group,m,now);
 assert.equal(snapshots.length,1);assert.equal(snapshots[0].close,false,'observation is not locked behind a high score');
 assert.doesNotMatch(JSON.stringify(snapshots),/PRIVATE_SECRET_SENTINEL|PRIVATE_REPLY_SENTINEL/);
 const id=snapshots[0].incident.id;
 api.recordGroupSocialExpressions(db,owner,group.id,m.id,{messages:[],socialExpressions:[{characterId:'yuan-xiaoman',eventId:id,expression:'defer'}]},now);
 assert.equal(read().socialContinuity.incidents[0].status,'deferred');
 for(const type of ['image','sticker','voice']){const msg=input('activity-'+type,type);const g=groupFor(msg);assert.equal(api.observeGroupActivity(db,owner,g,msg,now)[0].incident.id,id);}
 assert.equal(read().socialContinuity.incidents.length,1,'several groups share one private waiting event');
 assert.equal(api.observeGroupActivity(db,other,group,m,now).length,0,'other account has no access');
 assert.equal(api.observeGroupActivity(db,owner,{...group,messages:[]},m,now).length,0,'invisible message has no authority');
 assert.equal(api.observeGroupActivity(db,owner,{...group,members:[person('user')]},m,now).length,0,'absent NPC cannot observe');
 s=read();s.contactLife.busyUntil=now+3600000;write(s);assert.equal(api.observeGroupActivity(db,owner,group,m,now)[0].availability.busy,true,'known busy remains a reason, not erased activity');
 s=read();s.contactLife.busyUntil=0;write(s);
 const beforeValues=structuredClone(s.values),beforeMood=structuredClone(s.contactLife.feelings);
 // Simulate the production private path: fresh load after asynchronous group
 // observation, then synchronous parse/apply/save. The social event survives.
 const frozenBeforeGroup=createYuan();
 const fresh=read();applyYuan(fresh,parseYuan({action:'reply',messages:[{type:'text',text:'正常回复'}],event:null,memories:[]},''),'fresh-turn');write(fresh);
 assert.equal(read().socialContinuity.incidents[0].id,id);assert.equal(frozenBeforeGroup.socialContinuity,undefined);
 const active=read();applyYuan(active,parseYuan({action:'reply',messages:[{type:'text',text:'刚才还有点想你'}],event:null,memories:[],socialResponse:{eventId:id,expression:'expressed',feeling:'missed'}},''),'social-turn');write(active);
 assert.equal(read().socialContinuity.incidents[0].feeling,'missed');assert.deepEqual(read().values,beforeValues);assert.deepEqual(read().contactLife.feelings,beforeMood,'reunion does not mechanically worsen mood');
 assert.throws(()=>api.recordGroupSocialExpressions(db,owner,group.id,m.id,{messages:[{senderId:'yuan-xiaoman'}],socialExpressions:[{characterId:'yuan-xiaoman',eventId:id,expression:'expressed'}]},now),/其他渠道处理/,'late group draft cannot repeat an event expressed privately');
 assert.equal(core.currentPrivateSocialIncident(read(),now),undefined,'expressed event cannot trigger another private complaint');
 // New event and DND preserve observation, while forbidding cross-group pursuit.
 s=read();s.messages=s.messages.slice(0,2);s.socialContinuity=undefined;s.contactLife.quietUntil=now+10000;write(s);const quiet=api.observeGroupActivity(db,owner,group,m,now)[0];
 assert.equal(quiet.availability.doNotDisturb,true);
 assert.throws(()=>api.recordGroupSocialExpressions(db,owner,group.id,m.id,{messages:[{senderId:'yuan-xiaoman'}],socialExpressions:[{characterId:'yuan-xiaoman',eventId:quiet.incident.id,expression:'expressed'}]},now),/免打扰/);
 s=read();s.messages=s.messages.slice(0,2);s.contactLife.quietUntil=0;s.messages.at(-1).part={type:'text',text:'晚安'};write(s);assert.equal(api.observeGroupActivity(db,owner,group,m,now)[0].pendingPrivateReply,undefined,'natural closing is not a missed obligation');
 s=read();s.messages.at(-1).part={type:'professional_task',taskId:'synthetic-task'};write(s);assert.equal(api.observeGroupActivity(db,owner,group,m,now)[0].pendingPrivateReply,undefined,'task cards are not emotional waiting');
 // Long return is derived from true current private turns, no mandatory anger.
 const long=createYuan(now-5*86400000);long.messages=[{id:'old',turnId:'old-turn',role:'user',at:new Date(now-5*86400000).toISOString(),part:{type:'text',text:'以前的真实聊天'}},{id:'new',turnId:'new-turn',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'我回来了'}}];long.queue=['new-turn'];
 assert.equal(core.currentPrivateSocialIncident(long,now).kind,'return_after_long_gap');
 assert.match(core.socialPrivatePrompt(long,now),/不统一每人撒娇/);
 core.completePrivateSocialTurn(long,{eventId:'return:new',expression:'let-go'},[],now);assert.equal(long.socialContinuity.incidents[0].status,'resolved');
 // Xia's SQL CAS revision follows the same social-only state write.
 const xia={...createYuan(now),characterId:'xia-xia',messages:structuredClone(s.messages.slice(0,2))};xia.messages[1].part={type:'text',text:'今天还顺利吗？'};
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner+':xia-xia:normal',JSON.stringify(xia),0);
 const xmsg=input('xia-observe'),xgroup={...groupFor(xmsg),members:[person('user'),person('xia-xia')]};api.observeGroupActivity(db,owner,xgroup,xmsg,now);
 const row=db.prepare('SELECT data,revision FROM sessions').get();assert.equal(JSON.parse(row.data).revision,row.revision);
 const loaded=loadDialogueSkill(runtime.root,'你是许晓曼','yuan-xiaoman');assert.match(loaded.metadata.skillVersion,/runtime-v30/);assert.ok(loaded.rules.includes('本人关系情绪与跨渠道连续'));
 console.log('PASS social continuity: own visible group activity, low-score observation, no private-text leak, repeated-group dedupe, defer/private consumption, cross-channel stale blocking, persistent semantic feeling without numeric penalty, DND, closings/tasks, long return, Xia SQL revision, runtime-v30 source loading; synthetic only');
}finally{db.close();runtime.cleanup();}
