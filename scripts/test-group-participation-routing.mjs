import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// These fixtures verify typed routing boundaries and generated membership, not
// semantic model accuracy. The root separately tests actual model judgments.
const runtime=isolatedNpcRuntime();
try{
 const routing=await runtime.load('server/npc/group-routing');
 const {parseGroupDialogue,generateGroupDialogue,groupOperationalSpeakers,groupParticipationPlan}=await runtime.load('server/npc/group-dialogue');
 const ids=['molly','chen-nian','liu','zhou-chef','yuan-xiaoman','he-jiawei','xia-xia'];
 const names={molly:'Molly','chen-nian':'陈年',liu:'柳智敏','zhou-chef':'赵一帆','yuan-xiaoman':'许晓曼','he-jiawei':'何嘉伟','xia-xia':'唐佳怡'};
 const members=[{id:'user',name:'合成用户',role:'user'},...ids.map(id=>({id,name:names[id],role:id==='molly'?'admin':'npc'}))];
 const now=Date.parse('2026-10-17T04:00:00Z');
 const message=(senderId,text='合成自然回应',mentionIds=[])=>({senderId,text,mentionIds});
 const context=(text,mentionIds=[],history=[])=>({group:{id:'group-synthetic-participation',name:'合成群',goal:'普通相处',members,messages:history,reminders:[]},kind:'message',incoming:{id:'current-user-turn',senderId:'user',senderName:'合成用户',type:'text',text,mentionIds,at:new Date(now).toISOString()},facts:{facts:[]},now});
 const raw=(overrides={})=>({audience:'selected',intent:'conversation',closedConversation:false,semanticTargetIds:[],requiredReplyIds:[],allowedSpeakerIds:['chen-nian'],operationalSpeakerIds:[],...overrides});
 const planFor=(c,r)=>routing.parseGroupParticipation(r,c);
 const prior=[{id:'previous-user',senderId:'user',senderName:'合成用户',type:'text',text:'@何嘉伟 帮我看看',mentionIds:['he-jiawei'],at:new Date(now-1000).toISOString()},{id:'previous-he',senderId:'he-jiawei',senderName:'何嘉伟',type:'text',text:'我先说一点',at:new Date(now-500).toISOString()}];
 const open=context('你们能不能帮我出个主意？',[],prior);
 const broadcast=planFor(open,raw({audience:'all',intent:'open-help',allowedSpeakerIds:['he-jiawei'],operationalSpeakerIds:['molly','liu','zhou-chef']}));
 assert.deepEqual(new Set(broadcast.requiredReplyIds),new Set(ids),'fresh open-help covers the entire current group, not the previous @');
 assert.deepEqual(new Set(broadcast.allowedSpeakerIds),new Set(ids));assert.ok(broadcast.requiredReplyIds.length>3);assert.deepEqual(broadcast.operationalSpeakerIds,[]);
 assert.equal(broadcast.sourceMessageId,open.incoming.id);assert.equal(broadcast.version,1);
 const allOutput=parseGroupDialogue({messages:ids.map(id=>message(id))},open,broadcast);
 assert.deepEqual(new Set(allOutput.messages.map(m=>m.senderId)),new Set(ids));assert.equal(groupOperationalSpeakers(allOutput).size,0);assert.deepEqual(groupParticipationPlan(allOutput),broadcast);
 assert.throws(()=>parseGroupDialogue({messages:[message('he-jiawei')]},open,broadcast),/必须|缺少|回应/,'broadcast completeness is enforced beyond three');
 const mixed=context('@何嘉伟 大家也说说各自想法',['he-jiawei'],prior);
 const mixedPlan=planFor(mixed,raw({audience:'all',intent:'individual-opinions',allowedSpeakerIds:['he-jiawei']}));assert.deepEqual(new Set(mixedPlan.requiredReplyIds),new Set(ids));
 const direct=context('@何嘉伟 你来回答',['he-jiawei']);
 const directPlan=planFor(direct,raw({intent:'conversation',semanticTargetIds:['he-jiawei'],allowedSpeakerIds:['he-jiawei']}));assert.ok(directPlan.requiredReplyIds.includes('he-jiawei'));assert.ok(!directPlan.requiredReplyIds.includes('zhou-chef'));
 const named=context('赵一帆，西红柿鸡蛋怎么调味？');
 const chefPlan=planFor(named,raw({intent:'professional',semanticTargetIds:['zhou-chef'],requiredReplyIds:['zhou-chef'],allowedSpeakerIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']}));assert.deepEqual(chefPlan.requiredReplyIds,['zhou-chef']);assert.deepEqual(chefPlan.operationalSpeakerIds,['zhou-chef']);
 const quote=context('接着你刚才那点说',[],prior);quote.incoming.replyTo='previous-he';quote.incoming.quote={id:'previous-he',senderId:'he-jiawei',senderName:'何嘉伟',type:'text',text:'我先说一点'};
 const continued=planFor(quote,raw({intent:'continuation',semanticTargetIds:['he-jiawei'],requiredReplyIds:['he-jiawei'],allowedSpeakerIds:['he-jiawei']}));assert.deepEqual(continued.requiredReplyIds,['he-jiawei']);
 const closed=planFor(direct,raw({closedConversation:true,semanticTargetIds:['he-jiawei'],allowedSpeakerIds:['he-jiawei']}));assert.ok(!closed.allowedSpeakerIds.includes('molly'),'no forced host in a closed user request');
 assert.throws(()=>parseGroupDialogue({messages:[message('he-jiawei'),message('molly')]},direct,closed),/人物|许可|范围/);
 assert.throws(()=>planFor(direct,raw({closedConversation:true,semanticTargetIds:['he-jiawei'],allowedSpeakerIds:['chen-nian']})),/无效|范围|必须|目标|许可/);
 assert.throws(()=>planFor(named,raw({intent:'professional',semanticTargetIds:['not-a-member'],allowedSpeakerIds:['not-a-member']})),/无效|成员|人物/);
 const natural=context('我觉得这事挺有意思');
 const naturalPlan=planFor(natural,raw({allowedSpeakerIds:['chen-nian','he-jiawei','liu','zhou-chef'],operationalSpeakerIds:['liu','zhou-chef']}));
 assert.deepEqual(naturalPlan.operationalSpeakerIds,[]);
 const ordinary=parseGroupDialogue({messages:[message('chen-nian','这事你怎么看？'),message('he-jiawei','我倒有个别的想法。')]},natural,naturalPlan);
 assert.deepEqual(ordinary.messages.map(m=>m.senderId),['chen-nian','he-jiawei'],'ordinary A-to-B works without Molly or fake @');assert.ok(ordinary.messages.every(m=>!m.mentionIds.length));assert.equal(groupOperationalSpeakers(ordinary).size,0);
 const days=Array.from({length:7},(_,i)=>({date:`2026-10-${String(19+i).padStart(2,'0')}`,label:'合成一天',breakfast:'合成早餐',lunch:'合成午餐',dinner:'合成晚餐'}));
 const invalidEffects=[
   {messages:[message('liu')],planDraft:{days,shopping:[]}},
   {messages:[message('zhou-chef')],reminderProposals:[{meal:'breakfast',time:'08:00',startDate:'2026-10-19',endDate:'2026-10-25'}]},
   {messages:[message('zhou-chef')],reminderControls:[{reminderId:'synthetic',operation:'confirm',evidence:'合成'}]},
 ];
 for(const draft of invalidEffects)assert.throws(()=>parseGroupDialogue(draft,natural,naturalPlan),/受理|权限|提醒|操作/,'conversation permission cannot produce executable task effects');
 assert.throws(()=>parseGroupDialogue({messages:[message('chen-nian','请她接一句',['liu']),message('liu')],planDraft:{days,shopping:[]}},natural,naturalPlan),/受理|权限/,'ordinary fake @ cannot launder plan permission');
 assert.throws(()=>parseGroupDialogue({messages:ids.map(id=>message(id)),planDraft:{days,shopping:[]}},open,broadcast),/受理|权限/,'all-member speech is not all-member task authority');
 assert.throws(()=>parseGroupDialogue({messages:ids.map(id=>message(id)),confirmPlan:{planId:'synthetic-plan',evidence:'确认'}},open,broadcast),/受理|权限/,'broadcast Molly is not a plan confirmation operator');
 const stale=structuredClone(naturalPlan);stale.sourceMessageId='prior-user-turn';
 assert.throws(()=>parseGroupDialogue({messages:[message('chen-nian')]},natural,stale),/不属于本轮/,'previous typed plans are never reusable room permissions');

 // Only genuine operational handoffs extend execution authority. Normal
 // conversation, broadcasts and a social-only chain never do so.
 const task=context('先让厨师和营养师一起安排饮食');
 const taskPlan=planFor(task,raw({intent:'task-coordination',allowedSpeakerIds:['zhou-chef','molly'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']}));
 const delegated=parseGroupDialogue({messages:[message('zhou-chef','营养部分请接手',['liu']),message('liu','我来安排')],planDraft:{days,shopping:[]}},task,taskPlan);
 assert.deepEqual(new Set(groupOperationalSpeakers(delegated)),new Set(['zhou-chef','liu']));assert.ok(delegated.planDraft);
 const bridged=parseGroupDialogue({messages:[message('zhou-chef','请Molly协调',['molly']),message('molly','请柳智敏接',['liu']),message('liu')],planDraft:{days,shopping:[]}},task,taskPlan);
 assert.ok(bridged.planDraft,'genuine chef-@Molly-to-@Liu bridge remains usable');
 assert.throws(()=>parseGroupDialogue({messages:[message('zhou-chef'),message('molly','自然接话',['liu']),message('liu')],planDraft:{days,shopping:[]}},task,taskPlan),/受理|权限/,'allowed Molly cannot mint task permission from an operational predecessor without a real @');
 const mollyOperational=planFor(task,raw({intent:'task-coordination',allowedSpeakerIds:['zhou-chef','molly'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef','molly']}));
 assert.ok(parseGroupDialogue({messages:[message('zhou-chef'),message('molly','真实统筹交接',['liu']),message('liu')],planDraft:{days,shopping:[]}},task,mollyOperational).planDraft,'router-selected operational Molly can make a genuine task handoff');
 const closedTask=planFor(task,raw({intent:'task-coordination',closedConversation:true,allowedSpeakerIds:['zhou-chef'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']}));
 assert.throws(()=>parseGroupDialogue({messages:[message('zhou-chef','交给群外本轮对象',['liu']),message('liu')],planDraft:{days,shopping:[]}},task,closedTask),/封闭发言范围/,'even a real operator @ cannot widen a closed conversation');
 const silentPlan=planFor(task,raw({intent:'task-coordination',allowedSpeakerIds:['liu','chen-nian'],operationalSpeakerIds:['liu']}));
 assert.throws(()=>parseGroupDialogue({messages:[message('chen-nian')],planDraft:{days,shopping:[]}},task,silentPlan),/受理|权限/,'a selected but silent professional cannot submit a plan');

 const socialContext=structuredClone(task);
 const social=(characterId)=>({characterId,relationship:{stage:'friends',familiarity:70,affection:70,trust:60,comfort:70},feelings:{mood:0,dissatisfaction:0,unease:0},availability:{busy:false,doNotDisturb:false,proactiveEnabled:true},close:true,incident:{id:'synthetic-social-'+characterId,kind:'unanswered_in_shared_group',createdAt:new Date(now-1000).toISOString(),status:'pending'}});
 socialContext.socialContexts=[social('yuan-xiaoman'),social('liu')];
 const socialResponse=(id,expression='expressed')=>({characterId:id,eventId:'synthetic-social-'+id,expression});
 const socialPlan=planFor(socialContext,raw({intent:'professional',allowedSpeakerIds:['zhou-chef','molly'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']}));
 for(const proposals of [undefined,[],[socialResponse('yuan-xiaoman','defer')],[socialResponse('yuan-xiaoman','let-go')]]){
   assert.throws(()=>parseGroupDialogue({messages:[message('zhou-chef'),message('yuan-xiaoman','我那边还等着你呢')],...(proposals===undefined?{}:{socialExpressions:proposals})},socialContext,socialPlan),/必须同步登记本人事件expressed/,'social-only speech remains registered despite a typed participation plan');
 }
 assert.throws(()=>parseGroupDialogue({messages:[message('zhou-chef')],socialExpressions:[socialResponse('yuan-xiaoman')]},socialContext,socialPlan),/实际发言/,'another member cannot stand in for a social expression');
 const acceptedSocial=parseGroupDialogue({messages:[message('zhou-chef'),message('yuan-xiaoman','我那边还等着你呢')],socialExpressions:[socialResponse('yuan-xiaoman')]},socialContext,socialPlan);
 assert.equal(acceptedSocial.socialExpressions[0].expression,'expressed');assert.ok(!groupOperationalSpeakers(acceptedSocial).has('yuan-xiaoman'));
 const selfMention={messages:[message('zhou-chef'),message('liu','我这边还在等你',['liu'])],socialExpressions:[socialResponse('liu')],planDraft:{days,shopping:[]}};
 assert.throws(()=>parseGroupDialogue(selfMention,socialContext,socialPlan),/受理|权限/,'social-only self @ cannot mint task permission');
 const socialChain={messages:[message('zhou-chef'),message('yuan-xiaoman','我还等着呢',['he-jiawei']),message('he-jiawei','接一句',['liu']),message('liu')],socialExpressions:[socialResponse('yuan-xiaoman'),socialResponse('liu')],planDraft:{days,shopping:[]}};
 assert.throws(()=>parseGroupDialogue(socialChain,socialContext,socialPlan),/受理|权限/,'social @ chains never become executable handoffs');
 const afterSocial={messages:[message('zhou-chef'),message('liu','先前的情绪短句'),message('molly','现在请接手',['liu'])],socialExpressions:[socialResponse('liu')],planDraft:{days,shopping:[]}};
 assert.throws(()=>parseGroupDialogue(afterSocial,socialContext,planFor(socialContext,raw({intent:'professional',allowedSpeakerIds:['zhou-chef','molly'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef','molly']}))),/受理|权限/,'late real @ cannot retroactively authorize an earlier social utterance');
 const afterSocialUnrecorded={messages:[message('zhou-chef'),message('liu','先前情绪短句'),message('molly','现在交接',['liu']),message('liu','现在开始安排')],planDraft:{days,shopping:[]}};
 assert.throws(()=>parseGroupDialogue(afterSocialUnrecorded,socialContext,planFor(socialContext,raw({intent:'professional',allowedSpeakerIds:['zhou-chef','molly'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef','molly']}))),/必须同步登记本人事件expressed/,'a later real handoff cannot erase an earlier unrecorded social-only message');
 const closedSocial=planFor(socialContext,raw({intent:'professional',closedConversation:true,allowedSpeakerIds:['zhou-chef'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']}));
 assert.throws(()=>parseGroupDialogue({messages:[message('zhou-chef'),message('yuan-xiaoman')],socialExpressions:[socialResponse('yuan-xiaoman')]},socialContext,closedSocial),/人物|许可|范围/,'social context cannot widen a closed audience');

 // The real generator uses the current semantic plan and one bounded repair.
 let routingCalls=0,generationCalls=0,reviewCalls=0;
 const generated=await generateGroupDialogue(runtime.root,open,async(_root,prompt)=>{
   if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'synthetic group participation fixture'};
   if(prompt.startsWith('你是智域群聊发言路由器')){routingCalls++;assert.ok(prompt.includes(open.incoming.text));return raw({audience:'all',intent:'open-help',allowedSpeakerIds:['he-jiawei']});}
   if(prompt.startsWith('你是智域群聊成品复核器')){reviewCalls++;return {verdict:'keep',edits:[]};}
   generationCalls++;return {messages:(generationCalls===1?['he-jiawei']:ids).map(id=>message(id))};
 });
 assert.equal(routingCalls,1);assert.equal(generationCalls,2);assert.equal(reviewCalls,1);assert.equal(new Set(generated.messages.map(m=>m.senderId)).size,ids.length);
 let failedDrafts=0;
 await assert.rejects(()=>generateGroupDialogue(runtime.root,open,async(_root,prompt)=>{if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'synthetic group participation fixture'};if(prompt.startsWith('你是智域群聊发言路由器'))return raw({audience:'all',intent:'open-help',allowedSpeakerIds:['he-jiawei']});if(prompt.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};failedDrafts++;return {messages:[message('he-jiawei')]};}),/必须|缺少|回应/);
 assert.equal(failedDrafts,2,'no unbounded retry or hard-coded missing-person lines');
 let socialGenerations=0,socialReviews=0;
 const socialRepaired=await generateGroupDialogue(runtime.root,socialContext,async(_root,prompt)=>{
   if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'synthetic relationship expression'};
   if(prompt.startsWith('你是智域群聊发言路由器'))return raw({intent:'professional',allowedSpeakerIds:['zhou-chef'],requiredReplyIds:['zhou-chef'],operationalSpeakerIds:['zhou-chef']});
   if(prompt.startsWith('你是智域群聊成品复核器')){socialReviews++;assert.ok(prompt.includes('实际表达却未登记'));return {verdict:'keep',edits:[]};}
   socialGenerations++;return {messages:[message('zhou-chef'),message('yuan-xiaoman','我那边还等你呢')],...(socialGenerations===1?{}:{socialExpressions:[socialResponse('yuan-xiaoman')]})};
 });
 assert.equal(socialGenerations,2);assert.equal(socialReviews,1);assert.equal(socialRepaired.socialExpressions[0].expression,'expressed');
 // For an already-allowed person's actual *meaning*, the semantic reviewer is
 // the guarantee: structural permission alone cannot identify grievance text.
 const ordinarySocial=planFor(socialContext,raw({allowedSpeakerIds:['yuan-xiaoman']}));
 assert.ok(parseGroupDialogue({messages:[message('yuan-xiaoman','正常接眼下的话题')]},socialContext,ordinarySocial));
 await assert.rejects(()=>generateGroupDialogue(runtime.root,socialContext,async(_root,prompt)=>{
   if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'synthetic relationship expression'};
   if(prompt.startsWith('你是智域群聊发言路由器'))return raw({allowedSpeakerIds:['yuan-xiaoman']});
   if(prompt.startsWith('你是智域群聊成品复核器')){assert.ok(prompt.includes('正常路由或真实任务交接获得发言许可'));return {verdict:'redraft',edits:[]};}
   return {messages:[message('yuan-xiaoman','你私聊还没回我呢')]};
 }),/本轮草稿未发送/,'an already-allowed speaker cannot bypass semantic social registration review');
 console.log('PASS group participation routing: >3 broadcast after previous @, current targets/name/quote/continuation, @ plus all, professional focus, closed scope, natural A-to-B, disjoint task authority, genuine/false @ chains, social registration and bounded repairs; semantic outputs injected');
}finally{runtime.cleanup();}
