import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime(),db=new DatabaseSync(':memory:');
try{
 const {createYuan,parseYuan,applyYuan}=await runtime.load('lib/npc/yuan-xiaoman');
 const {ensureContact,prepareContactTurn}=await runtime.load('lib/npc/contact-life');
 const core=await runtime.load('lib/npc/social-continuity');const api=await runtime.load('server/npc/social-continuity');
 const now=Date.now(),owner=randomUUID(),key=owner+':yuan-xiaoman';db.exec('CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT)');
 const write=s=>db.prepare('INSERT OR REPLACE INTO yuan_sessions VALUES(?,?)').run(key,JSON.stringify(s));
 const read=()=>JSON.parse(db.prepare('SELECT data FROM yuan_sessions WHERE id=?').get(key).data);
 const member=id=>({id,name:id,role:id==='user'?'user':'npc',joinedAt:new Date(now-86400000).toISOString(),order:1});
 const message=(id,at=now)=>({id,senderId:'user',senderName:'合成用户',type:'text',text:'公开测试',at:new Date(at).toISOString()});
 const groupFor=m=>({id:'group-'+randomUUID(),name:'合成群',goal:'合成',members:[member('user'),member('yuan-xiaoman')],messages:[m]});
 function base(){const s=createYuan(now-86400000);s.values.familiarity=75;s.values.affection=75;s.messages=[{id:'old-u',turnId:'old-u',role:'user',at:new Date(now-7200000).toISOString(),part:{type:'text',text:'合成旧输入'}},{id:'old-a',turnId:'old-a',role:'assistant',at:new Date(now-7100000).toISOString(),part:{type:'text',text:'那本书后来找到了吗？'}}];ensureContact(s,now);return s;}
 function observed(s,status='expressed'){write(s);const m=message(randomUUID()),g=groupFor(m);const c=api.observeGroupActivity(db,owner,g,m,now)[0];api.recordGroupSocialExpressions(db,owner,g.id,m.id,{messages:status==='expressed'?[{senderId:'yuan-xiaoman'}]:[],socialExpressions:[{characterId:'yuan-xiaoman',eventId:c.incident.id,expression:status,feeling:'hurt'}]},now);return {id:c.incident.id,g,m};}
 function returned(s,text,at=now+1000){const turn=randomUUID();s.messages.push({id:randomUUID(),turnId:turn,role:'user',at:new Date(at).toISOString(),part:{type:'text',text}});s.queue=[turn];return s;}
 const exp=observed(base());let s=returned(read(),'刚才我在开会，没看到你的消息');core.completePrivateSocialTurn(s,undefined,[{}],now+1000);write(s);
 assert.equal(s.socialContinuity.incidents[0].status,'resolved');assert.equal(s.socialContinuity.incidents[0].resolution,'explanation');assert.equal(s.socialContinuity.incidents[0].feeling,'hurt');
 assert.match(core.socialPrivatePrompt(s,now+1000),/"status":"resolved"/);
 const publicReturn=message('after-explanation',now+2000),publicGroup=groupFor(publicReturn);const summary=api.observeGroupActivity(db,owner,publicGroup,publicReturn,now+2000)[0];
 assert.equal(summary.recentEmotions[0].status,'resolved');assert.equal(summary.recentEmotions[0].feeling,'hurt');assert.equal(summary.incident,undefined);
 const repair=observed(base());s=returned(read(),'刚才我不该那样跟你说话，我错了');core.completePrivateSocialTurn(s,undefined,[{}],now+1000,{kind:'repair',basis:'user_claim',evidence:'我错了'});write(s);
 assert.equal(s.socialContinuity.incidents[0].resolution,'repair');assert.match(core.socialPrivatePrompt(s,now+1000),/"status":"resolved"/);
 assert.equal(api.observeGroupActivity(db,owner,publicGroup,publicReturn,now+2000)[0].recentEmotions[0].status,'resolved');
 for(const [text,event] of [['对不起',undefined],['我朋友对我说我错了',{kind:'repair',basis:'user_claim',evidence:'我错了'}],['我错了',{kind:'repair',basis:'hypothesis',evidence:'我错了'}],['我错了',{kind:'repair',basis:'user_claim',evidence:'并不存在的原文'}]]){
   observed(base());s=returned(read(),text);core.completePrivateSocialTurn(s,undefined,[{}],now+1000,event);assert.equal(s.socialContinuity.incidents[0].status,'expressed','unrelated/unsupported apology cannot erase a real expressed emotion');
 }
 const late=observed(base(),'defer');s=returned(read(),'我回来了');write(s);
 assert.throws(()=>api.recordGroupSocialExpressions(db,owner,late.g.id,late.m.id,{messages:[{senderId:'yuan-xiaoman'}],socialExpressions:[{characterId:'yuan-xiaoman',eventId:late.id,expression:'expressed'}]},now+1000),/等待已变化/);
 core.completePrivateSocialTurn(s,undefined,[{}],now+1000);assert.equal(s.socialContinuity.incidents[0].status,'resolved');assert.equal(s.socialContinuity.incidents[0].resolution,'private_reply');
 // A split round is not a series of separate neglected messages.
 s=base();s.messages.push({id:'bubble-2',turnId:'old-a',role:'assistant',at:new Date(now-7100000).toISOString(),deliverAt:now+1000,part:{type:'text',text:'还有个事想跟你说'}});s.contactLife.waiting.at=now+1000;write(s);
 let m=message('mid-bubbles'),g=groupFor(m);assert.equal(api.observeGroupActivity(db,owner,g,m,now)[0].incident,undefined);
 m=message('all-delivered',now+2000);g=groupFor(m);let c=api.observeGroupActivity(db,owner,g,m,now+2000)[0];assert.equal(Date.parse(c.pendingPrivateReply.since),now+1000);
 const stable=c.incident.id;const again=message('all-delivered-again',now+3000),g2=groupFor(again);assert.equal(api.observeGroupActivity(db,owner,g2,again,now+3000)[0].incident.id,stable);assert.equal(read().socialContinuity.incidents.length,1);
 api.recordGroupSocialExpressions(db,owner,g.id,m.id,{messages:[{senderId:'yuan-xiaoman'}],socialExpressions:[{characterId:'yuan-xiaoman',eventId:stable,expression:'expressed',feeling:'missed'}]},now+2000);assert.equal(read().contactLife.waiting.followedUp,true);
 s=base();s.messages[1].professionalTaskHint={taskId:'synthetic'};write(s);m=message('task-hint');g=groupFor(m);assert.equal(api.observeGroupActivity(db,owner,g,m,now)[0].incident,undefined);
 // Close, genuinely waiting and previously deferred: the next already-allowed
 // follow-up must actually use this social observation and record it.
 const required=observed(base(),'defer');s=read();prepareContactTurn(s,now,'followup');assert.equal(s.contactLife.requiredSocialReactionId,required.id);
 assert.match(core.socialPrivatePrompt(s,now),/"mustReact":true/);
 assert.throws(()=>core.completePrivateSocialTurn(s,undefined,[{}],now),/必须接续/);
 assert.throws(()=>core.completePrivateSocialTurn(s,{eventId:required.id,expression:'defer'},[{}],now),/必须接续/);
 core.completePrivateSocialTurn(s,{eventId:required.id,expression:'expressed',feeling:'hurt'},[{}],now);assert.equal(s.socialContinuity.incidents[0].status,'expressed');
 const oldPending=observed(base(),'defer');s=read();s.messages[0].at=new Date(now-5*86400000).toISOString();s=returned(s,'我回来了');
 assert.equal(core.currentPrivateSocialIncident(s,now+1000).kind,'return_after_long_gap','stale group pending does not swallow a real long return');
 core.completePrivateSocialTurn(s,{eventId:'return:'+s.messages.at(-1).id,expression:'expressed',feeling:'missed'},[{}],now+1000);
 assert.equal(s.socialContinuity.incidents.find(e=>e.id===oldPending.id).status,'resolved');assert.equal(s.socialContinuity.incidents.at(-1).kind,'return_after_long_gap');
 console.log('PASS social repair/resolution in both channel summaries, current-evidence guards, ordinary private-return stale blocking, split delivery one window, professional hints excluded, bounded required close follow-up; synthetic only');
}finally{db.close();runtime.cleanup();}
