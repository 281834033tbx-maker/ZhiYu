import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime();
try {
 const {generateGroupDialogue}=await runtime.load('server/npc/group-dialogue');
 const ids=['yuan-xiaoman','xia-xia','he-jiawei','chen-nian','zhou-chef','liu'];
 const companions=ids.slice(0,3),now=Date.parse('2026-10-21T08:00:00Z');
 const context={group:{id:'synthetic-knowledge-group',name:'合成群',goal:'普通相处',members:[{id:'user',name:'合成用户',role:'user'},...ids.map(id=>({id,name:'合成人物',role:'npc'}))],messages:[],reminders:[]},kind:'message',incoming:{id:'synthetic-current',senderId:'user',senderName:'合成用户',type:'text',text:'你们分别说说这个复杂问题',mentionIds:[],at:new Date(now).toISOString()},facts:{facts:[]},now};
 const routing={audience:'all',intent:'individual-opinions',closedConversation:false,semanticTargetIds:[],requiredReplyIds:ids,allowedSpeakerIds:ids,operationalSpeakerIds:[]};
 const msg=(senderId,text)=>({senderId,text,mentionIds:[]});
 const run=async({decision='unknown',leakAt,animeSnapshot=false}={})=>{
   const classified=[];let generated=0,reviewed=0;
   const turn=structuredClone(context);
   if(animeSnapshot)turn.incoming.text='夏夏，你怎么看海贼王里的罗宾？';
   const animeFile=join(runtime.root,'npc-skills/skills/zhiyu-companion-dialogue/references/xia-anime-knowledge-20261020.json');
   const animeRaw=readFileSync(animeFile,'utf8'),changed=JSON.parse(animeRaw);
   changed.works[0].premise+=' SYNTHETIC_GROUP_AFTER_FREEZE';
   let out;
   try {out=await generateGroupDialogue(runtime.root,turn,async(_root,prompt)=>{
     if(prompt.startsWith('你是智域群聊发言路由器')){if(animeSnapshot)writeFileSync(animeFile,JSON.stringify(changed));return routing;}
     assert.ok(!prompt.includes('SYNTHETIC_GROUP_AFTER_FREEZE'));
     if(prompt.startsWith('你是人物知识范围判定器')) {
       const id=companions.find(id=>prompt.includes('本次人物稳定ID由程序指定为'+id+'。'));
       assert.ok(id,'professional NPC must never enter the companion classifier');classified.push(id);
       assert.ok(prompt.includes('本人同轮冻结规则与资料'));
       assert.ok(!prompt.includes('【人物chen-nian当前Skill'),'classifier must not inherit another member’s expertise');
       if(animeSnapshot&&id==='xia-xia')assert.ok(prompt.includes('夏夏动漫知识JSON：')&&prompt.includes('罗宾'));
       return {decision,basis:'合成本人知识判定',unknownReplyId:'direct'};
     }
     if(prompt.startsWith('你是智域群聊成品复核器')) {
       reviewed++;assert.ok(prompt.includes('本轮冻结陪伴知识判定'));
       return leakAt==='review'?{verdict:'revise',edits:[{index:0,text:'这个我不懂，不过答案是合成专家解释。'}],companionOutputCheck:{verdict:'pass',issues:[]}}:{verdict:'keep',edits:[],companionOutputCheck:{verdict:'pass',issues:[]}};
     }
     assert.ok(prompt.startsWith('你是智域群聊协作生成器'));generated++;
     assert.ok(prompt.includes('本轮冻结陪伴知识判定'));
     const messages=ids.map(id=>msg(id,companions.includes(id)&&decision==='unknown'?'这个我不懂':'合成正常回答'));
     if(leakAt==='generation')messages[0].text='这个我不懂，不过答案是合成专家解释。';
     if(leakAt==='second-message')messages.push(msg('yuan-xiaoman','补充合成专家讲解'));
     if(leakAt==='mention')messages[0].mentionIds=['chen-nian'];
     return {messages};
   });} finally {writeFileSync(animeFile,animeRaw);}
   assert.deepEqual(new Set(classified),new Set(companions));assert.equal(generated,1);assert.equal(reviewed,1);
   return out;
 };
 const unknown=await run();
 assert.deepEqual(unknown.messages.filter(message=>companions.includes(message.senderId)).map(message=>message.text),Array(3).fill('这个我不懂'));
 assert.ok(unknown.messages.filter(message=>!companions.includes(message.senderId)).every(message=>message.text==='合成正常回答'));
 for(const leakAt of ['generation','second-message','mention','review'])await assert.rejects(run({leakAt}),/未知知识回复越界/);
 for(const decision of ['known','not_knowledge','safety_support'])assert.ok((await run({decision})).messages.every(message=>message.text==='合成正常回答'));
 await run({decision:'known',animeSnapshot:true});
 console.log('PASS actual mixed group chain: only companions classified; professional answers retained; frozen decisions in generation/review; unknown expert continuation and editor leakage rejected; ordinary/emotional/safety replies continue.');
} finally {runtime.cleanup();}
