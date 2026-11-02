import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Disposable SQLite, synthetic members and injected dialogue only. No live API.
const runtime=isolatedNpcRuntime(),db=new DatabaseSync(join(runtime.root,'participation-store.sqlite'));
let store;
try{
 const {GroupChatStore}=await runtime.load('server/npc/groups-plugin');
 const {parseGroupDialogue,groupOperationalSpeakers}=await runtime.load('server/npc/group-dialogue');
 const {parseGroupParticipation}=await runtime.load('server/npc/group-routing');
 const {createYuan}=await runtime.load('lib/npc/yuan-xiaoman');
 const {ensureContact}=await runtime.load('lib/npc/contact-life');
 let clock=Date.parse('2026-10-17T04:00:00Z'),held,hold=false,captured;
 const owner=randomUUID();
 const msg=(senderId,text,mentionIds=[])=>({senderId,text,mentionIds});
 const runner=async(_root,context)=>{
   captured=context;
   if(hold)return await new Promise(resolve=>held=resolve);
   return {messages:[msg('molly',context.kind==='opening'?'老大，合成群准备好了':'合成应答')]};
 };
 store=new GroupChatStore(db,runtime.root,async()=> '合成参与范围群',()=>clock,randomUUID,runner);
 db.exec('CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT)');
 const yuan=createYuan(clock-7200000);yuan.messages=[
   {id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(clock-7200000).toISOString(),part:{type:'text',text:'PRIVATE_PARTICIPATION_SENTINEL'}},
   {id:randomUUID(),turnId:randomUUID(),role:'assistant',at:new Date(clock-7100000).toISOString(),part:{type:'text',text:'事情后来怎样了？'}},
 ];ensureContact(yuan,clock);db.prepare('INSERT INTO yuan_sessions VALUES(?,?)').run(owner+':yuan-xiaoman',JSON.stringify(yuan));
 const create=()=>store.create(owner,{requestId:randomUUID(),sourceCharacterId:'molly',goal:'合成群聊协作',memberIds:['chen-nian','zhou-chef','liu','yuan-xiaoman','xia-xia','he-jiawei'],self:{name:'合成用户'}});
 const group=await create();await store.run(owner,group.id);
 const send=(text,mentionIds=[])=>store.send(owner,{groupId:group.id,text,mentionIds,requestId:randomUUID()});
 const mutate=(addIds=[],removeIds=[])=>store.members(owner,{groupId:group.id,addIds,removeIds,requestId:randomUUID()});
 const readYuan=()=>JSON.parse(db.prepare('SELECT data FROM yuan_sessions WHERE id=?').get(owner+':yuan-xiaoman').data);
 const parsed=(draft,overrides)=>parseGroupDialogue(draft,captured,parseGroupParticipation({audience:'selected',intent:'conversation',closedConversation:false,semanticTargetIds:[],requiredReplyIds:[],allowedSpeakerIds:[],operationalSpeakerIds:[],...overrides},captured));

 // A real broadcast snapshot can cover more than three NPCs, but a removed
 // member cannot deliver from that prior join instance.
 hold=true;send('大家都说说你们怎么看');let running=store.run(owner,group.id);
 assert.equal(typeof held,'function');const oldMembers=captured.group.members.filter(member=>member.id!=='user');
 mutate([],['he-jiawei']);const broad=parsed({messages:oldMembers.map(member=>msg(member.id,member.id==='he-jiawei'?'STALE_REMOVED_BROADCAST':'广播成员回应'))},{audience:'all',intent:'open-help'});
 assert.equal(groupOperationalSpeakers(broad).size,0);held(broad);await running;
 let fresh=store.get(owner,group.id);assert.ok(!fresh.messages.some(message=>message.text==='STALE_REMOVED_BROADCAST'));
 assert.ok(new Set(fresh.messages.filter(message=>message.text==='广播成员回应').map(message=>message.senderId)).size>3);
 const persisted=JSON.parse(db.prepare('SELECT data FROM npc_group_jobs WHERE status=? ORDER BY seq DESC LIMIT 1').get('done').data).participationPlan;
 assert.equal(persisted.sourceMessageId,captured.incoming.id);assert.equal(persisted.audience,'all');assert.equal(persisted.requiredReplyIds.length,7);assert.deepEqual(persisted.operationalSpeakerIds,[]);

 // Removing and re-adding the same stable ID must not revive its old draft.
 clock+=1000;mutate(['he-jiawei']);send('何嘉伟，你接着说',['he-jiawei']);running=store.run(owner,group.id);
 mutate([],['he-jiawei']);clock+=1000;mutate(['he-jiawei']);held(parsed({messages:[msg('he-jiawei','STALE_JOIN_INSTANCE'),msg('molly','当前主持回应')]},{allowedSpeakerIds:['he-jiawei','molly']}));await running;
 fresh=store.get(owner,group.id);assert.ok(!fresh.messages.some(message=>message.text==='STALE_JOIN_INSTANCE'));

 // A departing professional cannot leave a plan/reminder side effect after
 // their speech was filtered; another member surviving is not authorization.
 send('安排下周饮食',['liu']);running=store.run(owner,group.id);mutate([],['liu']);
 const days=Array.from({length:7},(_,i)=>({date:new Date(clock+i*86400000).toISOString().slice(0,10),label:'合成',breakfast:'合成早餐',lunch:'合成午餐',dinner:'合成晚餐'}));
 const outgoingPlan=parsed({messages:[msg('liu','STALE_PLAN_OPERATOR'),msg('chen-nian','保留训练回应')],planDraft:{days,shopping:[]}},{intent:'task-coordination',allowedSpeakerIds:['liu','chen-nian'],operationalSpeakerIds:['liu']});
 assert.ok(groupOperationalSpeakers(outgoingPlan).has('liu'));held(outgoingPlan);await running;
 fresh=store.get(owner,group.id);assert.equal(fresh.plan,undefined);assert.ok(!fresh.messages.some(message=>message.text==='STALE_PLAN_OPERATOR'));
 send('说说做饭提醒',['zhou-chef']);running=store.run(owner,group.id);mutate([],['zhou-chef']);
 const outgoingReminder=parsed({messages:[msg('zhou-chef','STALE_REMINDER_OPERATOR'),msg('chen-nian','仍在群的回应')],reminderProposals:[{meal:'breakfast',time:'08:00',startDate:'2026-10-18',endDate:'2026-10-24'}]},{intent:'task-coordination',allowedSpeakerIds:['zhou-chef','chen-nian'],operationalSpeakerIds:['zhou-chef']});
 assert.ok(groupOperationalSpeakers(outgoingReminder).has('zhou-chef'));held(outgoingReminder);await running;
 fresh=store.get(owner,group.id);assert.ok(!fresh.reminders?.length);assert.ok(!fresh.messages.some(message=>message.text==='STALE_REMINDER_OPERATOR'));

 // Social provenance is committed only for speech that survives fresh member
 // validation. A removed social speaker is not registered as having spoken.
 send('其他人有什么想法？');running=store.run(owner,group.id);
 const own=captured.socialContexts.find(item=>item.characterId==='yuan-xiaoman');assert.ok(own.incident);assert.ok(!JSON.stringify(captured.socialContexts).includes('PRIVATE_PARTICIPATION_SENTINEL'));
 mutate([],['yuan-xiaoman']);held(parsed({messages:[msg('yuan-xiaoman','STALE_SOCIAL_ASIDE'),msg('chen-nian','现在的话题回应')],socialExpressions:[{characterId:'yuan-xiaoman',eventId:own.incident.id,expression:'expressed',feeling:'hurt'}]},{allowedSpeakerIds:['chen-nian']}));await running;
 fresh=store.get(owner,group.id);assert.ok(!fresh.messages.some(message=>message.text==='STALE_SOCIAL_ASIDE'));assert.equal(readYuan().socialContinuity.incidents.find(event=>event.id===own.incident.id).status,'pending');

 // A mandatory member who remains in the group must still have a surviving
 // own reply. If their only line @-depends on a removed member, roll back the
 // complete response instead of silently saving an incomplete broadcast.
 send('陈年你来讲',['chen-nian']);running=store.run(owner,group.id);const preRequired=store.get(owner,group.id).messages.length;
 mutate([],['he-jiawei']);held(parsed({messages:[msg('chen-nian','REQUIRED_BUT_STALE_MENTION',['he-jiawei']),msg('he-jiawei','REMOVED_REQUIRED_CONTEXT'),msg('molly','MUST_ROLL_BACK_WITH_MISSING_REQUIRED')]},{allowedSpeakerIds:['chen-nian','he-jiawei','molly']}));await running;
 fresh=store.get(owner,group.id);assert.ok(fresh.error);assert.ok(!fresh.messages.some(message=>message.text==='MUST_ROLL_BACK_WITH_MISSING_REQUIRED'));assert.ok(!fresh.messages.some(message=>message.text==='REQUIRED_BUT_STALE_MENTION'));assert.ok(fresh.messages.length>=preRequired,'member event and user input remain intact');

 // Being required to speak does not revive an operational @ lineage whose
 // originating member left during generation.
 hold=false;const authorityGroup=await create();await store.run(owner,authorityGroup.id);hold=true;
 store.send(owner,{groupId:authorityGroup.id,text:'大家一起把下周饮食安排上',mentionIds:[],requestId:randomUUID()});running=store.run(owner,authorityGroup.id);
 const authorityIds=captured.group.members.filter(member=>member.id!=='user').map(member=>member.id);
 const delegatedBroad=parsed({messages:[msg('zhou-chef','请柳智敏接手',['liu']),...authorityIds.filter(id=>id!=='zhou-chef').map(id=>msg(id,id==='liu'?'REQUIRED_LIU_WITH_LOST_HANDOFF':'各自普通回应'))],planDraft:{days,shopping:[]}},{audience:'all',intent:'task-coordination',operationalSpeakerIds:['zhou-chef']});
 assert.ok(groupOperationalSpeakers(delegatedBroad).has('liu'),'the pre-departure draft really carried delegated plan authority');
 store.members(owner,{groupId:authorityGroup.id,addIds:[],removeIds:['zhou-chef'],requestId:randomUUID()});held(delegatedBroad);await running;
 let authorityFresh=store.get(owner,authorityGroup.id);assert.ok(!authorityFresh.error);assert.ok(authorityFresh.messages.some(message=>message.text==='REQUIRED_LIU_WITH_LOST_HANDOFF'),'required speech survives as speech');assert.equal(authorityFresh.plan,undefined,'required speech does not preserve a broken task handoff');

 // Per-speaker WeakMap authority is insufficient when an earlier ordinary
 // line survives but that same person's later authorized line was filtered.
 clock+=1000;store.members(owner,{groupId:authorityGroup.id,addIds:['zhou-chef'],removeIds:[],requestId:randomUUID()});
 store.send(owner,{groupId:authorityGroup.id,text:'大家继续安排下周饮食',mentionIds:[],requestId:randomUUID()});running=store.run(owner,authorityGroup.id);
 const secondIds=captured.group.members.filter(member=>member.id!=='user').map(member=>member.id);
 const onlyLateAuthorized=parsed({messages:[msg('liu','EARLY_ORDINARY_LIU'),...secondIds.filter(id=>!['liu','zhou-chef'].includes(id)).map(id=>msg(id,'其他成员回应')),msg('zhou-chef','现在交接给柳',['liu']),msg('liu','LATE_AUTHORIZED_LIU_FILTERED',['he-jiawei'])],planDraft:{days,shopping:[]}},{audience:'all',intent:'task-coordination',operationalSpeakerIds:['zhou-chef']});
 assert.ok(groupOperationalSpeakers(onlyLateAuthorized).has('liu'));
 store.members(owner,{groupId:authorityGroup.id,addIds:[],removeIds:['he-jiawei'],requestId:randomUUID()});held(onlyLateAuthorized);await running;
 authorityFresh=store.get(owner,authorityGroup.id);assert.ok(!authorityFresh.error);assert.ok(authorityFresh.messages.some(message=>message.text==='EARLY_ORDINARY_LIU'));assert.ok(!authorityFresh.messages.some(message=>message.text==='LATE_AUTHORIZED_LIU_FILTERED'));assert.equal(authorityFresh.plan,undefined,'later @ cannot authorize an earlier surviving ordinary line');

 // One surviving ordinary line by the same person is not evidence that their
 // filtered emotional line was ever delivered. Keep that event unconsumed.
 clock+=1000;store.members(owner,{groupId:authorityGroup.id,addIds:['he-jiawei'],removeIds:[],requestId:randomUUID()});
 store.send(owner,{groupId:authorityGroup.id,text:'大家再说说想法',mentionIds:[],requestId:randomUUID()});running=store.run(owner,authorityGroup.id);
 const emotionalOwn=captured.socialContexts.find(item=>item.characterId==='yuan-xiaoman');assert.ok(emotionalOwn.incident);assert.equal(emotionalOwn.incident.status,'pending');
 const emotionalIds=captured.group.members.filter(member=>member.id!=='user').map(member=>member.id);
 const partiallyLostExpression=parsed({messages:[...emotionalIds.map(id=>msg(id,id==='yuan-xiaoman'?'ORDINARY_YUAN_UNRELATED_TO_FEELING':'普通话题回应')),msg('yuan-xiaoman','FILTERED_SOCIAL_SENTIMENT',['he-jiawei'])],socialExpressions:[{characterId:'yuan-xiaoman',eventId:emotionalOwn.incident.id,expression:'expressed',feeling:'hurt'}]},{audience:'all',intent:'individual-opinions'});
 store.members(owner,{groupId:authorityGroup.id,addIds:[],removeIds:['he-jiawei'],requestId:randomUUID()});held(partiallyLostExpression);await running;
 authorityFresh=store.get(owner,authorityGroup.id);assert.ok(authorityFresh.error,'partial social speaker filtering fails the whole draft conservatively');assert.ok(!authorityFresh.messages.some(message=>message.text==='FILTERED_SOCIAL_SENTIMENT'));assert.equal(readYuan().socialContinuity.incidents.find(event=>event.id===emotionalOwn.incident.id).status,'pending','a surviving ordinary line cannot consume a filtered emotional expression');

 console.log('PASS group participation storage: typed >3 broadcast/provenance, departed/rejoined filtering, no orphan plan/reminder/social effects, fresh required rollback, lost @ authority, no retroactive early-line authority, and partial emotional-line loss never consumes an event; isolated synthetic SQLite');
}finally{store?.stop();db.close();runtime.cleanup();}
