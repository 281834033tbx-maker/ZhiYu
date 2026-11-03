import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

const runtime=isolatedNpcRuntime(),now=Date.parse('2026-10-16T02:00:00Z'),owner=randomUUID();
const db=new DatabaseSync(join(runtime.root,'social-group-fixture.sqlite'));
db.exec('CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE liu_sessions(id TEXT PRIMARY KEY,data TEXT)');
try {
  const {createYuan}=await runtime.load('lib/npc/yuan-xiaoman');
  const {createLiu}=await runtime.load('lib/npc/liu');
  const {ensureContact}=await runtime.load('lib/npc/contact-life');
  const {GroupChatStore}=await runtime.load('server/npc/groups-plugin');
  const {generateGroupDialogue,parseGroupDialogue,groupSocialSpeakerIds}=await runtime.load('server/npc/group-dialogue');
  const tables={'yuan-xiaoman':'yuan_sessions',liu:'liu_sessions'};
  const read=id=>JSON.parse(db.prepare(`SELECT data FROM ${tables[id]} WHERE id=?`).get(`${owner}:${id}`).data);
  const save=(id,state)=>db.prepare(`INSERT OR REPLACE INTO ${tables[id]} VALUES(?,?)`).run(`${owner}:${id}`,JSON.stringify(state));
  const seed=(id,state)=>{
    state.values.familiarity=70;state.values.affection=75;state.values.trust=60;state.values.comfort=70;
    state.messages=[{id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now-7200000).toISOString(),part:{type:'text',text:'PRIVATE_USER_WORDS_ONLY'}},
      {id:randomUUID(),turnId:randomUUID(),role:'assistant',at:new Date(now-3600000).toISOString(),origin:'chat',part:{type:'text',text:'PRIVATE_PERSONAL_QUESTION_ONLY？'}}];
    const contact=ensureContact(state,now);contact.enabled=true;contact.quietUntil=0;contact.busyUntil=0;save(id,state);
  };
  seed('yuan-xiaoman',createYuan(now));seed('liu',createLiu(now));
  const originalValues=structuredClone(read('yuan-xiaoman').values);
  let mode='missing-social',missingDraftCalls=0;const captured=[];
  const store=new GroupChatStore(db,runtime.root,async()=> '合成关系连续性群',()=>now,randomUUID,async(root,context)=>{
    captured.push(structuredClone(context));
    assert.ok(!JSON.stringify(context.socialContexts).includes('PRIVATE_'),'private raw text never reaches the group generator');
    return generateGroupDialogue(root,context,async(_root,prompt)=>{
      if(prompt.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};
      if(prompt.startsWith('你是智域群聊发言路由器'))return groupParticipationFixture(['zhou-chef']);
      if(context.kind==='opening')return {messages:[{senderId:'molly',text:'老大，群准备好了',mentionIds:[]}]};
      const own=context.socialContexts.find(item=>item.characterId===(mode==='defer'?'liu':'yuan-xiaoman'));
      if(mode==='missing-social'){
        missingDraftCalls++;
        return {messages:[{senderId:'zhou-chef',text:'先把锅预热。',mentionIds:[]},{senderId:'yuan-xiaoman',text:'你在这边聊天，私聊怎么不回呢。',mentionIds:[]}]};
      }
      if(mode==='defer')return {messages:[{senderId:'zhou-chef',text:'蛋液沿锅边倒下去。',mentionIds:[]}],socialExpressions:[{characterId:'liu',eventId:own.incident.id,expression:'defer',feeling:'neutral'}]};
      if(mode==='clean')return {messages:[{senderId:'zhou-chef',text:'先按刚才的步骤处理。',mentionIds:[]}]};
      if(mode==='concurrent'){
        const state=read('yuan-xiaoman'),incident=state.socialContinuity.incidents.find(item=>item.id===own.incident.id);
        incident.status='expressed';incident.expressedChannel='private';incident.expressedAt=new Date(now).toISOString();save('yuan-xiaoman',state);
      }
      return {messages:[{senderId:'zhou-chef',text:'先把锅预热，再倒蛋液。',mentionIds:[]},{senderId:'yuan-xiaoman',text:'你在这边聊天，我那边还等着呢。',mentionIds:[]}],
        socialExpressions:[{characterId:'yuan-xiaoman',eventId:own.incident.id,expression:'expressed',feeling:'hurt'}]};
    });
  });
  const group=await store.create(owner,{requestId:randomUUID(),sourceCharacterId:'molly',goal:'普通做饭交流',memberIds:['zhou-chef','yuan-xiaoman','liu','he-jiawei'],self:{name:'合成用户'}});
  await store.run(owner,group.id);
  let current=store.send(owner,{groupId:group.id,text:'鸡蛋什么时候下锅？',mentionIds:['zhou-chef'],requestId:randomUUID()});
  const unacceptedCount=current.messages.length;
  await store.run(owner,group.id);current=store.get(owner,group.id);
  assert.equal(missingDraftCalls,2,'missing social metadata receives at most one bounded repair');
  assert.ok(current.error);assert.equal(current.messages.length,unacceptedCount,'neither unrecorded social draft is delivered');
  assert.equal(read('yuan-xiaoman').socialContinuity.incidents[0].status,'pending','failed draft does not consume or silently express the event');
  mode='express';store.retry(owner,group.id);
  await store.run(owner,group.id);current=store.get(owner,group.id);
  assert.ok(!current.error);assert.ok(current.messages.some(message=>message.senderId==='zhou-chef'));assert.ok(current.messages.some(message=>message.senderId==='yuan-xiaoman'));
  const yuan=read('yuan-xiaoman');assert.equal(yuan.socialContinuity.incidents[0].status,'expressed');assert.equal(yuan.socialContinuity.incidents[0].expressedChannel,'group');assert.equal(yuan.socialContinuity.incidents[0].feeling,'hurt');assert.deepEqual(yuan.values,originalValues,'semantic feeling never becomes an automatic numeric penalty');
  const context=captured.at(-1),yuanSocial=context.socialContexts.find(item=>item.characterId==='yuan-xiaoman'),liuSocial=context.socialContexts.find(item=>item.characterId==='liu');
  assert.ok(groupSocialSpeakerIds(context).includes('yuan-xiaoman'),'a real social candidate can speak even when another NPC was @');
  const m=(senderId,text='合成回应',mentionIds=[])=>({senderId,text,mentionIds});
  const response=(characterId,eventId,expression='expressed')=>({characterId,eventId,expression});
  assert.throws(()=>parseGroupDialogue({messages:[m('yuan-xiaoman')],socialExpressions:[response('yuan-xiaoman',yuanSocial.incident.id)]},context,['zhou-chef','molly']),/必须回应/,'social aside cannot erase the required professional reply');
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef')],socialExpressions:[response('yuan-xiaoman',yuanSocial.incident.id)]},context,['zhou-chef','molly']),/实际发言/);
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('yuan-xiaoman')],socialExpressions:[response('yuan-xiaoman',liuSocial.incident.id)]},context,['zhou-chef','molly']),/本人当前真实来源/);
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('yuan-xiaoman')],socialExpressions:[{...response('yuan-xiaoman',yuanSocial.incident.id),feeling:'rage'}]},context,['zhou-chef','molly']),/格式无效/);
  for(const socialExpressions of [undefined,[],[response('yuan-xiaoman',yuanSocial.incident.id,'defer')],[response('yuan-xiaoman',yuanSocial.incident.id,'let-go')]]){
    assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('yuan-xiaoman','私聊怎么不回呢。')],...(socialExpressions===undefined?{}:{socialExpressions})},context,['zhou-chef','molly']),/必须同步登记本人事件expressed/,'a social-only spoken aside cannot remain unregistered or deferred');
  }
  const repairStages=[];
  const repaired=await generateGroupDialogue(runtime.root,context,async(_root,prompt)=>{
    if(prompt.startsWith('你是智域群聊发言路由器')){repairStages.push('routing');return groupParticipationFixture(['zhou-chef']);}
    if(prompt.startsWith('你是智域群聊成品复核器')){repairStages.push('review');assert.ok(prompt.includes('正常路由或真实任务交接获得发言许可'));return {verdict:'keep',edits:[]};}
    const fixing=prompt.includes('【本轮结构完整性纠偏】');repairStages.push(fixing?'social-repair':'generation');
    return {messages:[m('zhou-chef'),m('yuan-xiaoman','我那边还等着你呢。')],...(fixing?{socialExpressions:[response('yuan-xiaoman',yuanSocial.incident.id)]}:{})};
  });
  assert.deepEqual(repairStages,['routing','generation','social-repair','review']);assert.equal(repaired.socialExpressions[0].expression,'expressed');
  const primaryContext={...context,incoming:{...context.incoming,mentionIds:['yuan-xiaoman']}};
  assert.ok(parseGroupDialogue({messages:[m('yuan-xiaoman','正常回应眼下的话题。')]},primaryContext,['yuan-xiaoman','molly']),'ordinary primary speech does not force an unrelated social event decision');
  await assert.rejects(()=>generateGroupDialogue(runtime.root,primaryContext,async(_root,prompt)=>{
    if(prompt.startsWith('你是智域群聊发言路由器'))return groupParticipationFixture(['yuan-xiaoman']);
    if(prompt.startsWith('你是智域群聊成品复核器')){
      assert.ok(prompt.includes('实际表达却未登记'));assert.ok(prompt.includes('均必须redraft'));
      return {verdict:'redraft',edits:[]};
    }
    return {messages:[m('yuan-xiaoman','私聊那边你还没回我。')]};
  }),/本轮草稿未发送/,'semantic review must reject an unregistered event expressed by an otherwise ordinary primary speaker');
  const quiet=parseGroupDialogue({messages:[m('zhou-chef')],socialExpressions:[response('liu',liuSocial.incident.id,'defer')]},context,['zhou-chef','molly']);assert.equal(quiet.socialExpressions[0].expression,'defer');
  const dnd=structuredClone(context);dnd.socialContexts.find(item=>item.characterId==='yuan-xiaoman').availability.doNotDisturb=true;
  assert.ok(!groupSocialSpeakerIds(dnd).includes('yuan-xiaoman'));
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('yuan-xiaoman')],socialExpressions:[response('yuan-xiaoman',yuanSocial.incident.id)]},dnd,['zhou-chef','molly']),/人物|实际发言/);
  const days=Array.from({length:7},(_,index)=>({date:new Date(now+index*86400000).toISOString().slice(0,10),label:'合成饮食',breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}));
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('liu','合成短情绪',['liu'])],planDraft:{days,shopping:[]}},context,['zhou-chef','molly']),/受理本轮需求/,'social-only self-@ cannot promote plan permission');
  const unmentioned={...context,incoming:{...context.incoming,mentionIds:[]}};
  assert.throws(()=>parseGroupDialogue({messages:[m('yuan-xiaoman','情绪短句',['he-jiawei']),m('he-jiawei','顺势一句',['liu']),m('liu')],planDraft:{days,shopping:[]}},unmentioned,[]),/受理本轮需求/,'social-only mention chains do not acquire executable permission');
  assert.throws(()=>parseGroupDialogue({messages:[m('yuan-xiaoman'),m('molly','自然短接',['liu']),m('liu')],planDraft:{days,shopping:[]}},unmentioned,[]),/受理本轮需求/,'Molly natural bridge from social-only speech cannot mint plan permission');
  assert.ok(parseGroupDialogue({messages:[m('zhou-chef'),m('molly','真实事务交接',['liu']),m('liu')],planDraft:{days,shopping:[]}},unmentioned,['zhou-chef']).planDraft,'existing primary-conversation Molly @ handoff remains functional');
  const proposals={
    confirmPlan:{planId:'synthetic-plan',evidence:'确认计划'},
    reminderProposals:[{meal:'breakfast',time:'08:00',startDate:days[0].date,endDate:days[6].date}],
    reminderControls:[{reminderId:'synthetic-reminder',operation:'pause',evidence:'暂停提醒'}],
  };
  const aside={messages:[m('yuan-xiaoman','我那边还等着你。')],socialExpressions:[response('yuan-xiaoman',yuanSocial.incident.id)]};
  for(const [key,proposal] of Object.entries(proposals)){
    assert.throws(()=>parseGroupDialogue({...aside,[key]:proposal},unmentioned,[]),/实际受理本轮需求并发言/,`social-only aside cannot submit ${key}`);
    assert.throws(()=>parseGroupDialogue({...aside,[key]:proposal},unmentioned,['molly','liu','zhou-chef']),/实际受理本轮需求并发言/,`selected but silent professionals cannot submit ${key}`);
    assert.throws(()=>parseGroupDialogue({...aside,messages:[...aside.messages,m('molly','顺势接话',['liu','zhou-chef']),m('liu'),m('zhou-chef')],[key]:proposal},unmentioned,[]),/实际受理本轮需求并发言/,`social-only natural/@ chain cannot submit ${key}`);
    const accepted=parseGroupDialogue({messages:[m('yuan-xiaoman','请处理用户事务',['molly']),m('molly','按用户确认来处理',['liu','zhou-chef']),m('liu'),m('zhou-chef')],[key]:proposal},unmentioned,['yuan-xiaoman']);
    assert.deepEqual(accepted[key],proposal,`actual primary @ handoff still permits ${key}`);
  }
  assert.throws(()=>parseGroupDialogue({messages:[m('liu','先前的情绪旁白'),m('molly','现在才交接',['liu'])],socialExpressions:[response('liu',liuSocial.incident.id)],planDraft:{days,shopping:[]}},unmentioned,['molly']),/受理本轮需求/,'a later actual @ cannot retroactively authorize an earlier social-only utterance');
  assert.ok(parseGroupDialogue({messages:[m('molly','现在请柳接手',['liu']),m('liu')],confirmPlan:proposals.confirmPlan},unmentioned,['molly']).confirmPlan,'Molly retains plan-confirmation authority');
  assert.ok(parseGroupDialogue({messages:[m('liu')],confirmPlan:proposals.confirmPlan},unmentioned,['liu']).confirmPlan,'Liu retains plan-confirmation authority');
  for(const id of ['molly','zhou-chef'])for(const key of ['reminderProposals','reminderControls']){
    assert.ok(parseGroupDialogue({messages:[m(id)],[key]:proposals[key]},unmentioned,[id])[key],`${id} retains ${key} authority`);
  }

  mode='defer';store.send(owner,{groupId:group.id,text:'接着呢？',mentionIds:['zhou-chef'],requestId:randomUUID()});await store.run(owner,group.id);
  assert.equal(read('liu').socialContinuity.incidents[0].status,'deferred');assert.ok(!store.get(owner,group.id).error);
  // A new actual private question creates a new candidate; another channel consumes it mid-generation.
  const next=read('yuan-xiaoman');next.messages.push({id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now-600000).toISOString(),part:{type:'text',text:'NEW_PRIVATE_USER_ONLY'}},{id:randomUUID(),turnId:randomUUID(),role:'assistant',at:new Date(now-300000).toISOString(),origin:'chat',part:{type:'text',text:'NEW_PRIVATE_QUESTION_ONLY？'}});save('yuan-xiaoman',next);
  mode='concurrent';const before=store.send(owner,{groupId:group.id,text:'锅烧热了',mentionIds:['zhou-chef'],requestId:randomUUID()}).messages.length;
  await store.run(owner,group.id);const failed=store.get(owner,group.id);
  assert.equal(failed.messages.length,before,'fresh private expression causes group transaction rollback, not duplicate grievance');assert.ok(failed.error);
  assert.equal(read('yuan-xiaoman').socialContinuity.incidents.at(-1).expressedChannel,'private');
  mode='clean';store.retry(owner,group.id);await store.run(owner,group.id);assert.ok(!store.get(owner,group.id).error);
  const imageId=randomUUID()+'.png',file=join(runtime.root,'.npc-runtime/uploads',owner,imageId);mkdirSync(join(runtime.root,'.npc-runtime/uploads',owner),{recursive:true});writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhZkAAAAASUVORK5CYII=','base64'));
  store.send(owner,{groupId:group.id,text:'',imageId,mentionIds:['zhou-chef'],requestId:randomUUID()});await store.run(owner,group.id);
  assert.ok(captured.at(-1).socialContexts.some(item=>item.characterId==='liu'),'visible user media also counts as actual shared-group activity');
  store.stop();
  console.log('PASS group social continuity: bounded no-private-text summaries, mandatory social-only expressed metadata, one repair/no failed delivery, primary-speaker semantic review gate, optional real-owner aside beside required @ reply, silent defer, task/mention-chain permission separation, DND, transactional cross-channel dedup, media activity and preserved numeric relationship values. Synthetic DB/model only.');
} finally {db.close();runtime.cleanup();}
