import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { renameSync } from 'node:fs';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime();
const now=Date.parse('2026-10-15T06:00:00Z'), owner=randomUUID();
const db=new DatabaseSync(join(runtime.root,'delegation-fixture.sqlite'));
db.exec('CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
const sources=[];
const input=(targetId,text,goal,extra={})=>{
  const source={id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now-1000).toISOString(),part:{type:'text',text}};
  sources.push(source);
  db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES(?,?)').run(`${owner}:molly-system-secretary`,JSON.stringify({messages:sources}));
  return {owner,id:randomUUID(),targetId,goal,createdAt:new Date(now).toISOString(),mode:'request',
    source:{conversationId:'molly-system-secretary',messageId:source.id,text,at:source.at},...extra};
};
const tables={'chen-nian':['chen_sessions','chen-nian'],'zhou-chef':['zhou_chef_sessions','zhou-chef'],'liu':['liu_sessions','liu'],
  'he-jiawei':['he_sessions','he-jiawei'],'yuan-xiaoman':['yuan_sessions','yuan-xiaoman'],'xia-xia':['sessions','xia-xia:normal']};
const read=id=>{const [table,suffix]=tables[id];return JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${suffix}`).data);};
const save=(id,state)=>{const [table,suffix]=tables[id];db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state),`${owner}:${suffix}`);};
const output=(text,task={decision:'none'})=>({action:'reply',messages:[{type:'text',text}],event:null,memories:[],task});
try {
  const {receivePrivateDelegation,privateDelegationTargetIds,supportsPrivateDelegationTarget}=await runtime.load('server/npc/private-delegation-receiver');
  const {characterDirectory}=await runtime.load('lib/npc/character-directory');
  assert.deepEqual([...privateDelegationTargetIds()].sort(),characterDirectory.filter(character=>character.enabled).map(character=>character.id).sort());
  for (const character of characterDirectory.filter(character=>character.enabled)) assert.ok(supportsPrivateDelegationTarget(character.id));
  assert.equal(supportsPrivateDelegationTarget('unwired-npc'),false);
  const {nextNutritionWeek,liuNutritionWeek,parseLiu,applyLiu,liuTaskDelegationEvidence,liuRenewalConfirmationRequired,nutritionRenewalAnswer}=await runtime.load('lib/npc/liu');
  const {professionalTaskDelegationEvidence}=await runtime.load('lib/npc/professional-task-chat');
  const {professionalTaskSessionKind}=await runtime.load('lib/npc/professional-task-session');
  const {taskSourceRequestsDatedExecution}=await runtime.load('lib/npc/professional-task');
  const {createChen,parseChen,applyChen}=await runtime.load('lib/npc/chen-nian');
  assert.equal(taskSourceRequestsDatedExecution('明天练肩'),true);
  for (const text of ['明天练肩吗','我想明天练肩','如果明天练肩','朋友说明天练肩','明天不练肩','明天练肩，先别安排任务']) assert.equal(taskSourceRequestsDatedExecution(text),false,text);
  const direct=createChen(), directMessage={id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'明天练肩'}};
  direct.messages.push(directMessage);direct.queue=[directMessage.turnId];
  applyChen(direct,parseChen(output('明天练肩。',{decision:'create',basis:'execution_commitment',confidence:.98,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:directMessage.id,evidence:'明天练肩',title:'肩部训练',goalKey:'练肩',steps:[{title:'侧平举',scheduledDate:'2026-10-16',instructions:['完成当前动作计划。']}]}),'明天练肩'),'direct-fixture',now);
  assert.equal(direct.professionalTasks[0].steps[0].scheduledDate,'2026-10-16','an explicit future execution does not require the user to repeat 提醒');
  const {readTaskCalendar}=await runtime.load('server/npc/task-calendar-reader');
  const {liuClinicalInputFromPrompt}=await runtime.load('server/npc/liu-clinical-knowledge');
  let calls=0;
  const deps={now:()=>now,available:()=>true,generate:async(_root,prompt)=>{
    calls++;assert.match(prompt,/不是用户在本会话发言/);assert.match(prompt,/没有新用户私聊/);
    return output('Molly把需求转来了，我们直接接着办。');
  }};
  for (const target of Object.keys(tables)) {
    const delegation=input(target,`请让${target}联系我，帮我处理这件事`,'处理已交接的具体事项');
    const first=await receivePrivateDelegation(runtime.root,db,delegation,deps);
    assert.equal(first.status,'delivered',target);
    let state=read(target);
    assert.equal(state.messages.filter(message=>message.role==='user').length,0,'delegation must never invent a user bubble');
    assert.ok(state.messages.every(message=>message.secretaryEvent?.id===delegation.id && message.origin==='proactive'));
    assert.equal(state.secretaryDelegations[0].source.messageId,delegation.source.messageId);
    assert.equal(state.pending,null);
    assert.equal(state.professionalTasks?.length || 0,0);
    const before=calls;
    assert.deepEqual(await receivePrivateDelegation(runtime.root,db,delegation,deps),first);
    assert.equal(calls,before,'same delegation must not invoke model or send again');
    state=read(target);assert.equal(state.secretaryDelegations.length,1);
    await assert.rejects(receivePrivateDelegation(runtime.root,db,{...delegation,source:{...delegation.source,text:'伪造原话'}},deps),/真实用户原文/);
    await assert.rejects(receivePrivateDelegation(runtime.root,db,{...delegation,owner:randomUUID()},deps),/真实用户原文/);
    state=read(target);for (const message of state.messages) delete message.deliverAt;save(target,state);
  }
  assert.equal(calls,6);

  // A direct, source-verified future training request creates one dated card.
  let training=input('chen-nian','让陈年帮我安排明天肩部训练任务','肩部训练');
  const trainingReceipt=await receivePrivateDelegation(runtime.root,db,training,{...deps,generate:async()=>output('明天练肩，安排在这张卡里。',{
    decision:'create',basis:'explicit_request',confidence:.98,scope:'current_user',polarity:'affirmed',readiness:'ready',
    sourceMessageId:training.source.messageId,evidence:training.source.text,title:'肩部训练',goalKey:'肩部训练',
    steps:[{title:'哑铃侧平举',scheduledDate:'2026-10-16',instructions:['按任务中的动作要点完成。'],training:{target:'肩部',sets:3,reps:'10次'}}]})});
  assert.equal(trainingReceipt.taskIds.length,1);
  assert.equal(read('chen-nian').professionalTasks[0].sourceMessageId,training.source.messageId);
  assert.equal(read('chen-nian').messages.filter(message=>message.role==='user').length,0);

  const dates=nextNutritionWeek(now);assert.deepEqual([dates[0],dates[6]],['2026-10-19','2026-10-25']);
  assert.equal(liuNutritionWeek({sources:[{id:'sunday',text:'帮我安排下周饮食任务',at:'2026-10-18T15:00:00Z'}],contextSources:[],plans:[],currentInterpretations:[]},Date.parse('2026-10-19T01:00:00Z'))[0],'2026-10-19');
  const nutrition=input('liu','让柳智敏帮我安排下周减脂饮食','减脂饮食',{mode:'weekly-renewal',planMode:'new'});
  const task=(source,extra={})=>({decision:'create',basis:'explicit_request',confidence:.98,scope:'current_user',polarity:'affirmed',readiness:'ready',
    sourceMessageId:source.messageId,evidence:source.text,title:'下周减脂饮食',goalKey:'减脂饮食',
    steps:dates.map((date,index)=>({title:`周${index+1}饮食`,scheduledDate:date,instructions:['早餐 燕麦、鸡蛋和牛奶','午餐 米饭、鸡肉和蔬菜','晚餐 杂粮饭、豆腐和蔬菜']})),...extra});
  let nutritionReceipt=await receivePrivateDelegation(runtime.root,db,nutrition,{...deps,generate:async(_root,prompt)=>{
    assert.match(liuClinicalInputFromPrompt(prompt).current,/下周减脂饮食/,'delegated request must reach clinical retrieval without a forged local message');
    return output('下周的饮食安排在这里。',task(nutrition.source));
  }});
  assert.equal(nutritionReceipt.taskIds.length,1);
  let liu=read('liu'), old=structuredClone(liu.professionalTasks[0]);
  assert.equal(old.characterId,'liu');assert.equal(old.steps.length,7);assert.equal(professionalTaskSessionKind(old),undefined);
  const calendar=readTaskCalendar(db,{owner_id:owner},'liu',now);
  assert.equal(calendar.days.flatMap(day=>day.entries).length,0,'historical calendar does not pretend future meals happened');
  old.steps=old.steps.map(step=>({...step,scheduledDate:new Date(Date.parse(step.scheduledDate+'T00:00:00Z')-7*86400000).toISOString().slice(0,10)}));
  old.steps[0].completedAt=new Date(now-500).toISOString();
  liu.professionalTasks[0]=old;save('liu',liu);
  for (const message of liu.messages) delete message.deliverAt;save('liu',liu);

  const renewal=input('liu','再让柳智敏安排下周减脂饮食','减脂饮食',{mode:'weekly-renewal',planMode:'confirm-plan'});
  await assert.rejects(receivePrivateDelegation(runtime.root,db,renewal,{...deps,generate:async()=>output('直接排好了。',task(renewal.source))}),/先确认上周方案/);
  assert.deepEqual(read('liu').professionalTasks[0],old,'failed renewal cannot change old progress');
  const renewalReceipt=await receivePrivateDelegation(runtime.root,db,renewal,{...deps,generate:async()=>output('上周的方案继续吗？有不喜欢的菜可以换。')});
  assert.equal(renewalReceipt.taskIds.length,0);
  liu=read('liu');
  for (const message of liu.messages) delete message.deliverAt;
  assert.equal(liu.nutritionRenewalQuestions.length,1,'the actual delivered renewal question keeps its source');
  const waiting=structuredClone(liu);
  for (const [text,decision] of [['照旧','continue'],['继续上周方案','continue'],['上周鸡胸肉不好吃，换鱼','adjust'],['不要照旧','decline'],['不用安排了','decline'],['今天好热',undefined],['照旧吗',undefined],['不要照旧，鸡胸肉换鱼','adjust']]) assert.equal(nutritionRenewalAnswer(text),decision,text);
  const answerFixture=text=>{
    const state=structuredClone(waiting), message={id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text}};
    state.messages.push(message);state.queue=[message.turnId];return {state,message,evidence:liuTaskDelegationEvidence(state,now+1000)};
  };
  for (const text of ['不要照旧','不用安排了','今天好热']) {
    const fixture=answerFixture(text);assert.equal(liuRenewalConfirmationRequired(fixture.state,fixture.evidence,now+1000),true,text);
    const bad=parseLiu(output('继续原菜单。',task({messageId:fixture.message.id,text},{contextMessageId:renewal.source.messageId})),text);
    assert.throws(()=>applyLiu(fixture.state,bad,'bad-renewal',now+1000,fixture.state.queue,fixture.evidence),/先确认上周方案/);
    assert.deepEqual(fixture.state.professionalTasks,[old]);
  }
  const forged=structuredClone(waiting);
  forged.activeSecretaryDelegationId=renewal.id;
  forged.secretaryDelegations.find(event=>event.id===renewal.id).goal='照旧安排下周减脂饮食';
  const forgedEvidence=liuTaskDelegationEvidence(forged,now+1000,[]);
  forgedEvidence.contextSources.push({id:'old-confirmation',text:'照旧',at:new Date(now-86400000).toISOString()});
  assert.equal(liuRenewalConfirmationRequired(forged,forgedEvidence,now+1000),true,'goal text and another old approval cannot authorize this renewal');
  const adjusted=answerFixture('上周鸡胸肉不好吃，换鱼');
  assert.equal(liuRenewalConfirmationRequired(adjusted.state,adjusted.evidence,now+1000),false);
  const adjustedTask=task({messageId:adjusted.message.id,text:adjusted.message.part.text},{contextMessageId:renewal.source.messageId,newInstance:true});
  for(const step of adjustedTask.steps)step.instructions[1]='午餐 米饭、鱼肉和蔬菜';
  applyLiu(adjusted.state,parseLiu(output('鸡胸肉换鱼，新一周按这个排。',adjustedTask),adjusted.message.part.text),'adjusted-fixture',now+1000,adjusted.state.queue,adjusted.evidence);
  assert.equal(adjusted.state.professionalTasks.length,2);assert.deepEqual(adjusted.state.professionalTasks[0],old);
  assert.ok(adjusted.state.professionalTasks[1].steps.every(step=>step.instructions.some(line=>line.includes('鱼肉'))));
  const followup=answerFixture('上周鸡胸肉不好吃，换鱼');
  applyLiu(followup.state,parseLiu(output('可以换鱼。还有其他忌口吗？'),followup.message.part.text),'adjust-clarification',now+1000,followup.state.queue,followup.evidence);
  const condition={id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now+2000).toISOString(),part:{type:'text',text:'没有其他忌口'}};
  followup.state.messages.push(condition);followup.state.queue=[condition.turnId];
  const continuedEvidence=liuTaskDelegationEvidence(followup.state,now+2000);
  assert.equal(liuRenewalConfirmationRequired(followup.state,continuedEvidence,now+2000),false,'one real adjustment approval survives necessary follow-up conditions for the same request');
  const continuedTask=task({messageId:condition.id,text:condition.part.text},{contextMessageId:renewal.source.messageId,newInstance:true});
  for(const step of continuedTask.steps)step.instructions[1]='午餐 米饭、鱼肉和蔬菜';
  applyLiu(followup.state,parseLiu(output('按这个排。',continuedTask),condition.part.text),'confirmed-conditions',now+2000,followup.state.queue,continuedEvidence);
  assert.equal(followup.state.professionalTasks.length,2);assert.deepEqual(followup.state.professionalTasks[0],old);
  const answer={id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text:'照旧，继续上周方案'}};
  liu.messages.push(answer);liu.queue=[answer.turnId];
  const evidence=liuTaskDelegationEvidence(liu,now+1000);
  assert.equal(evidence.sources[0].taskClarification.requestMessageId,renewal.source.messageId);
  const out=parseLiu(output('新一周照旧。',task({messageId:answer.id,text:answer.part.text},{contextMessageId:renewal.source.messageId,newInstance:true})),answer.part.text);
  applyLiu(liu,out,'renewal-fixture',now+1000,liu.queue,evidence);
  assert.equal(liu.professionalTasks.length,2);
  assert.deepEqual(liu.professionalTasks[0],old);
  assert.ok(liu.professionalTasks[1].steps.every(step=>!step.completedAt && dates.includes(step.scheduledDate)));
  assert.equal(liu.professionalTasks[1].contextMessageId,renewal.source.messageId);

  // A new private user input during model work invalidates the draft without losing the event.
  const race=input('he-jiawei','让何嘉伟来聊一下创业','创业');
  const beforeMessages=read('he-jiawei').messages.length;
  const raced=await receivePrivateDelegation(runtime.root,db,race,{...deps,generate:async()=>{
    const state=read('he-jiawei');state.queue.push('new-user-turn');state.inputRevision++;save('he-jiawei',state);return output('过期草稿');
  }});
  assert.equal(raced.status,'busy');assert.equal(read('he-jiawei').messages.length,beforeMessages);
  assert.equal(read('he-jiawei').secretaryDelegations.find(event=>event.id===race.id).status,'pending');
  assert.equal(read('he-jiawei').pending,null);
  const broken=input('yuan-xiaoman','请小满来聊工作','工作');
  const profile=join(runtime.root,'npc-skills/references/characters/yuan-xiaoman.md');
  renameSync(profile,profile+'.fixture-backup');
  try {await assert.rejects(receivePrivateDelegation(runtime.root,db,broken,deps),/ENOENT/);}
  finally {renameSync(profile+'.fixture-backup',profile);}
  assert.equal(read('yuan-xiaoman').pending,null,'prompt construction failure cannot strand the receiver pending');
  const clearPending=input('xia-xia','请让夏夏来和我聊一下工作','聊工作');
  const xia=read('xia-xia');xia.life.queue.push('busy-fixture');save('xia-xia',xia);
  assert.equal((await receivePrivateDelegation(runtime.root,db,clearPending,deps)).status,'busy');
  const molly=JSON.parse(db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`).data);
  molly.privateHistoryHiddenIds=[clearPending.source.messageId];
  db.prepare('UPDATE molly_sessions SET data=? WHERE id=?').run(JSON.stringify(molly),`${owner}:molly-system-secretary`);
  const free=read('xia-xia');free.life.queue=[];save('xia-xia',free);
  assert.equal((await receivePrivateDelegation(runtime.root,db,clearPending,deps)).status,'delivered','clearing Molly display does not cancel an already pending handoff');
  assert.ok(professionalTaskDelegationEvidence(liu,now+1000).sources.length);
  console.log('PASS six NPC source-verified proactive handoffs, idempotency, no fabricated user messages, source tamper rejection, dated training, Liu weekly task/calendar boundary, confirm-before-renewal, preserved old progress, follow-up evidence and concurrent-input discard; isolated only, no production/model calls.');
} finally {db.close();runtime.cleanup();}
