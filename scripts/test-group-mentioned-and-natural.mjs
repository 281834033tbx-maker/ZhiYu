import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

// All data and model outputs are synthetic; no account or production requests.
const runtime = isolatedNpcRuntime();
try {
  const {parseGroupDialogue, generateGroupDialogue, requiredGroupMentionReplies, MissingGroupMentionReplyError} = await runtime.load('server/npc/group-dialogue');
  const members=[{id:'user',name:'合成用户',role:'user'}, {id:'molly',name:'Molly',role:'admin'}, {id:'zhou-chef',name:'赵一帆',role:'npc'}, {id:'chen-nian',name:'陈年',role:'npc'}, {id:'liu',name:'柳智敏',role:'npc'}];
  const context=mentions=>({group:{id:'synthetic-only',name:'合成测试群',goal:'日常交流',members,messages:[],reminders:[]},kind:'message',incoming:{id:'synthetic-input',senderId:'user',senderName:'合成用户',type:'text',text:'这顿我给自己满分',mentionIds:mentions,at:'2026-10-15T03:00:00Z'},facts:{facts:[]},now:Date.parse('2026-10-15T03:00:00Z')});
  const m=(senderId,text='合成回应',mentionIds=[])=>({senderId,text,mentionIds});
  const targeted=context(['chen-nian','zhou-chef']);
  assert.deepEqual(requiredGroupMentionReplies(targeted),['chen-nian','zhou-chef']);
  assert.deepEqual(requiredGroupMentionReplies({...targeted,kind:'confirmation'}),['chen-nian','zhou-chef']);
  assert.throws(()=>parseGroupDialogue({messages:[m('chen-nian')]},targeted,['chen-nian','zhou-chef','molly']),error=>error instanceof MissingGroupMentionReplyError && error.memberIds.join()==='zhou-chef');
  assert.throws(()=>parseGroupDialogue({messages:[m('molly')]},targeted,['chen-nian','zhou-chef','molly']),/必须回应/);
  assert.equal(parseGroupDialogue({messages:[m('chen-nian'),m('zhou-chef')]},targeted,['chen-nian','zhou-chef','molly']).messages.length,2);
  const natural=context([]);
  const chain={messages:[m('zhou-chef','自己吃着满意就行'),m('molly','评委和选手都是你'),m('chen-nian','这评分挺稳')]};
  assert.equal(parseGroupDialogue(chain,natural,['zhou-chef']).messages.length,3,'real members can naturally answer Molly without fake @');
  assert.throws(()=>parseGroupDialogue({messages:[m('chen-nian')]},natural,['zhou-chef']),/人物/,'first speaker still needs routing');
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('missing-npc')]},natural,['zhou-chef']),/人物/);
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('molly'),m('missing-npc')]},natural,['zhou-chef']),/人物/);
  assert.deepEqual(requiredGroupMentionReplies({...natural,incoming:{...natural.incoming,mentionIds:['missing-npc','user','zhou-chef','zhou-chef']}}),['zhou-chef']);
  assert.deepEqual(requiredGroupMentionReplies({...natural,incoming:{...natural.incoming,senderId:'chen-nian',mentionIds:['zhou-chef']}}),[]);
  const days=Array.from({length:7},(_,i)=>({date:`2026-10-${String(19+i).padStart(2,'0')}`,label:'合成一天',breakfast:'合成早餐',lunch:'合成午餐',dinner:'合成晚餐'}));
  assert.throws(()=>parseGroupDialogue({messages:[m('zhou-chef'),m('molly'),m('liu')],planDraft:{days,shopping:[]}},natural,['zhou-chef']),/受理本轮需求/,'casual response does not authorize a plan');
  assert.ok(parseGroupDialogue({messages:[m('zhou-chef'),m('molly','请接一下',['liu']),m('liu')],planDraft:{days,shopping:[]}},natural,['zhou-chef']).planDraft);

  const calls=[];
  const result=await generateGroupDialogue(runtime.root,targeted,async(_root,prompt)=>{
    if(prompt.startsWith('你是智域群聊发言路由器')) {calls.push('routing');return groupParticipationFixture(['chen-nian','zhou-chef']);}
    if(prompt.startsWith('你是智域群聊成品复核器')) {calls.push('review');return {verdict:'keep',edits:[]};}
    assert.match(prompt,/每位至少一条/);
    if(prompt.includes('【本轮结构完整性纠偏】')) {calls.push('mention-repair');return {messages:[m('chen-nian'),m('zhou-chef')]};}
    calls.push('generation');return {messages:[m('chen-nian')]};
  });
  assert.deepEqual(calls,['routing','generation','mention-repair','review']);
  assert.deepEqual(result.messages.map(message=>message.senderId),['chen-nian','zhou-chef']);
  let failedAttempts=0;
  await assert.rejects(()=>generateGroupDialogue(runtime.root,targeted,async(_root,prompt)=>{if(prompt.startsWith('你是智域群聊发言路由器'))return groupParticipationFixture(['chen-nian','zhou-chef']);failedAttempts++;return {messages:[m('chen-nian')]};}),/必须回应/);
  assert.equal(failedAttempts,2,'repair is bounded and never sends canned missing-member text');
  const naturalCalls=[];
  const final=await generateGroupDialogue(runtime.root,natural,async(_root,prompt)=>{
    if(prompt.startsWith('你是智域群聊发言路由器')) {naturalCalls.push('routing');return groupParticipationFixture(['zhou-chef','molly','chen-nian']);}
    if(prompt.startsWith('你是智域群聊成品复核器')) {naturalCalls.push('review');return {verdict:'keep',edits:[]};}
    naturalCalls.push('generation');return chain;
  });
  assert.deepEqual(naturalCalls,['routing','generation','review']);
  assert.deepEqual(final.messages,chain.messages);
  const skill=readFileSync(join(runtime.root,'npc-skills/skills/zhiyu-group-dialogue/SKILL.md'),'utf8');
  assert.match(skill,/2026-10-17-v5/);
  assert.match(skill,/不每轮Molly出场|不固定Molly每轮出场/);
  console.log(JSON.stringify({passed:true,checks:['every real user @ reply','one bounded repair','no failed draft sent','natural Molly exchange without fake mentions','initial routing and actual member guard','casual replies cannot submit a plan','frozen generation/review'],modelCalls:0}));
} finally { runtime.cleanup(); }
