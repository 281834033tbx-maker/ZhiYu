import test from 'node:test';
import assert from 'node:assert/strict';
import {createChen, parseChen, applyChen, chenTaskDelegationEvidence, type ChenState} from '../../lib/npc/chen-nian';
import {applyProfessionalTaskOperation, parseProfessionalTaskOperation, taskSourceAllowsCreation} from '../../lib/npc/professional-task';
import {assertProfessionalTaskCardOutput} from '../../lib/npc/professional-task-chat';
import type {ChatMessage} from '../../lib/npc/contracts';

// Reduced synthetic replay of the request → recovery choice → selected answer path.
// No formal account, live API, production model or health record is loaded.
const NOW=Date.parse('2026-10-13T02:00:00Z');
const REQUEST='给我一个关于肩部训练最好的任务，我能在健身房练。';
const ANSWER='酸痛基本退了，抬臂正常、无痛';
const OPTIONS=[ANSWER,'还有肌肉酸痛，但抬臂正常','抬臂受限或有明显不适','有刺痛或关节疼痛'];
const user=(id:string,text:string,at=NOW-10_000,replyTo?:string):ChatMessage=>({id,turnId:`turn-${id}`,role:'user',at:new Date(at).toISOString(),part:{type:'text',text},...(replyTo?{replyTo}:{})});
const proposal=(extra:Record<string,unknown>={})=>({decision:'create',basis:'explicit_request',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'answer',evidence:ANSWER,contextMessageId:'request',title:'肩部训练',goalKey:'肩部训练',steps:[{title:'哑铃侧平举',category:'main',training:{target:'三角肌中束',sets:3,reps:'10~12次'},instructions:['按当前能力控制动作。']}],...extra});
const parsed=(extra:Record<string,unknown>={})=>parseProfessionalTaskOperation(proposal(extra));
function fixture(request=REQUEST,answer=ANSWER) {
  const state=createChen(),question:ChatMessage={id:'question',turnId:'npc-question',role:'assistant',at:new Date(NOW-100_000).toISOString(),part:{type:'choice',text:'今天肩部恢复怎么样？',options:[...OPTIONS],selection:{index:0,turnId:'turn-answer',at:new Date(NOW-10_000).toISOString()}}};
  state.messages.push(user('request',request,NOW-120_000),question,user('answer',answer,NOW-10_000,'question'));
  state.completed.push('turn-request');state.queue=['turn-answer'];
  return {state,question};
}
const apply=(state:ChenState,extra:Record<string,unknown>={})=>{
  const evidence=chenTaskDelegationEvidence(state,NOW);
  return applyProfessionalTaskOperation(state.professionalTasks,parsed(extra),evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian');
};
function reject(state:ChenState,label:string,extra:Record<string,unknown>={}){
  const before=structuredClone(state);
  assert.throws(()=>apply(state,extra),label);assert.deepEqual(state,before,`${label}: rejected operation must not mutate state`);
}

void test('明确肩部任务→真实恢复选择：当前选项承接原委托和目标，两个有效basis均可保存只一次',()=>{
  assert.equal(taskSourceAllowsCreation(REQUEST,'explicit_request'),true);
  for(const basis of ['explicit_request','execution_commitment']) {
    const {state}=fixture(),evidence=chenTaskDelegationEvidence(state,NOW);
    assert.deepEqual(evidence.sources.map(s=>({id:s.id,text:s.text,taskClarification:s.taskClarification})),[{id:'answer',text:ANSWER,taskClarification:{questionMessageId:'question',requestMessageId:'request'}}]);
    assert.deepEqual(evidence.contextSources.map(s=>s.id),['request']);
    const originalUsers=structuredClone(state.messages.filter(m=>m.role==='user'));
    const result=apply(state,{basis});assert.equal(result?.created,true);assert.equal(result?.task.characterId,'chen-nian');
    assert.equal(result?.task.sourceMessageId,'answer');assert.equal(result?.task.contextMessageId,'request');
    assert.deepEqual(result?.task.delegationSourceMessageIds,['answer','request']);
    assert.equal(applyProfessionalTaskOperation(state.professionalTasks,parsed({basis}),evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian')?.created,false);
    assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined);
    reject(state,'saved task consumes the original clarification request',{basis});assert.equal(state.professionalTasks.length,1);
    assert.deepEqual(state.messages.filter(m=>m.role==='user'),originalUsers);
  }
});

void test('所有状态的旧卡均消费原委托，三个来源字段分别阻止后续choice借目标扩写新建第二卡',()=>{
  for(const status of ['active','paused','completed','cancelled'] as const) {
    for(const provenance of ['source','context','delegation'] as const) {
      const {state}=fixture();
      const old=applyProfessionalTaskOperation(state.professionalTasks,parsed({sourceMessageId:'request',evidence:REQUEST,contextMessageId:undefined,goalKey:'肩'}),[{id:'request',text:REQUEST}],[],NOW-110_000,[],'chen-nian')!.task;
      old.status=status;old.sourceMessageId=provenance==='source'?'request':'older-answer';
      delete old.contextMessageId;delete old.delegationSourceMessageIds;
      if(provenance==='context')old.contextMessageId='request';
      if(provenance==='delegation')old.delegationSourceMessageIds=['older-answer','request'];
      const before=structuredClone(old),label=`${status}/${provenance}`;
      assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined,label);
      reject(state,label);assert.equal(state.professionalTasks.length,1,label);assert.deepEqual(old,before,label);
    }
  }
});

void test('旧委托已消费后，新明确请求的新ID及真实choice仍可独立授权',()=>{
  for(const status of ['active','paused','completed','cancelled'] as const) {
    const {state}=fixture();
    const old=applyProfessionalTaskOperation(state.professionalTasks,parsed({sourceMessageId:'request',evidence:REQUEST,contextMessageId:undefined,goalKey:'肩'}),[{id:'request',text:REQUEST}],[],NOW-110_000,[],'chen-nian')!.task;
    old.status=status;const before=structuredClone(old);
    state.completed.push('turn-answer');state.queue=['turn-new-answer'];
    state.messages.push(user('new-request',REQUEST,NOW-6000),{id:'new-question',turnId:'npc-new-question',role:'assistant',at:new Date(NOW-4000).toISOString(),part:{type:'choice',text:'这次肩部恢复怎么样？',options:[...OPTIONS],selection:{index:0,turnId:'turn-new-answer',at:new Date(NOW-1000).toISOString()}}},user('new-answer',ANSWER,NOW-1000,'new-question'));
    const evidence=chenTaskDelegationEvidence(state,NOW);
    assert.deepEqual(evidence.sources[0].taskClarification,{questionMessageId:'new-question',requestMessageId:'new-request'},status);
    const result=apply(state,{sourceMessageId:'new-answer',contextMessageId:'new-request'});
    assert.equal(result?.created,true,status);assert.equal(state.professionalTasks.length,2,status);assert.deepEqual(old,before,status);
  }
});

void test('陈年实际apply与漏卡守卫共用验证链，缺关键条件短问可none，完整训练流程须有效卡',()=>{
  const {state}=fixture();
  const output={action:'reply',messages:[{type:'text',text:'这次按肩部训练来。'}],event:null,memories:[],task:proposal()};
  applyChen(state,parseChen(output,ANSWER),'reply',NOW);
  assert.equal(state.professionalTasks.length,1);assert.equal(state.messages.filter(m=>m.part.type==='professional_task').length,1);
  const omitted=fixture().state,evidence=chenTaskDelegationEvidence(omitted,NOW);
  assert.throws(()=>assertProfessionalTaskCardOutput(omitted,{task:{decision:'none'},parts:[{type:'text',text:'1. 侧平举做3组\n2. 肩推做3组'}]},evidence),/完整流程应放进任务卡/);
  assert.doesNotThrow(()=>assertProfessionalTaskCardOutput(omitted,{task:{decision:'none'},parts:[{type:'text',text:'今天是第一次练肩吗？'}]},evidence));
});

void test('无真实点击锚点或selection/引用/选项/时序不一致，普通恢复文本不能创建任务',()=>{
  const variants:[string,(state:ChenState,question:ChatMessage)=>void][]=[
    ['no replyTo',state=>{delete state.messages.at(-1)!.replyTo;}],
    ['missing choice',state=>{state.messages.splice(state.messages.findIndex(m=>m.id==='question'),1);} ],
    ['plain text question',(_state,q)=>{q.part={type:'text',text:'今天肩部恢复怎么样？'};}],
    ['no selection',(_state,q)=>{if(q.part.type==='choice')delete q.part.selection;}],
    ['wrong turn',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.turnId='other-turn';}],
    ['wrong index',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.index=1;}],
    ['invalid index',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.index=99;}],
    ['selection after user',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.at=new Date(NOW).toISOString();}],
    ['selection before question',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.at=new Date(NOW-200_000).toISOString();}],
    ['invalid selection clock',(_state,q)=>{if(q.part.type==='choice')q.part.selection!.at='bad';}],
    ['question after answer',(_state,q)=>{q.at=new Date(NOW).toISOString();}],
    ['hidden choice',state=>{state.privateHistoryHiddenIds=['question'];}],
    ['not delivered choice',(_state,q)=>{q.deliverAt=NOW+1000;}],
    ['legacy choice',(_state,q)=>{q.turnId='legacy:question';}],
    ['unknown chronology choice',(_state,q)=>{q.chronologyUnknown=true;}],
    ['legacy content choice',(_state,q)=>{q.legacyContent={image:'synthetic'};}],
    ['hidden request',state=>{state.privateHistoryHiddenIds=['request'];}],
  ];
  for(const [name,mutate] of variants){const {state,question}=fixture();mutate(state,question);assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0]?.taskClarification,undefined,name);reject(state,name);}
  const forged=fixture(REQUEST,'当前用户手打的其他恢复情况');assert.equal(chenTaskDelegationEvidence(forged.state,NOW).sources[0].taskClarification,undefined);reject(forged.state,'answer differs from selected option',{evidence:'当前用户手打的其他恢复情况'});
});

void test('普通咨询、愿望、假设、转述和否定起点不能借后续choice变成执行委托',()=>{
  for(const request of ['肩部训练怎么做？','给我介绍一下肩部训练任务','帮我解释肩部训练任务是什么','给我讲讲肩部训练任务怎么做','我有点想练肩','如果我想要肩部训练任务呢','朋友说给我一个肩部训练任务','不要给我肩部训练任务','只是看看肩部训练任务']) {
    const {state}=fixture(request);assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined,request);reject(state,request);
  }
});

void test('目标、当前来源、context原授权仍严格一致，不能借choice授权其他肌群或旧用户id',()=>{
  const {state}=fixture();
  for(const extra of [{contextMessageId:undefined},{contextMessageId:'question'},{contextMessageId:'missing'},{goalKey:'胸部训练',title:'胸部训练'},{sourceMessageId:'request',evidence:REQUEST},{evidence:'我现在要练肩'},{basis:'accepted_plan',planMessageId:'question'},{newInstance:true}])reject(state,JSON.stringify(extra),extra);
});

void test('中断、撤回、换目标和超过证据窗口，选择旧问题不能恢复授权',()=>{
  for(const interruption of ['不练了','取消肩部任务','我改成胸部训练','你今天忙吗']){
    const {state}=fixture();state.messages.splice(2,0,user('interrupt',interruption,NOW-50_000));state.completed.push('turn-interrupt');
    assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined);reject(state,interruption);
  }
  for(const priorAt of [NOW-40*60_000,Date.parse('2026-10-12T15:50:00Z')]){
    const {state}=fixture();state.messages.find(m=>m.id==='request')!.at=new Date(priorAt).toISOString();assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined);reject(state,'outside bounded recent/current-day request');
  }
  const {state}=fixture();state.privateHistoryHiddenIds=['synthetic-hidden'];state.messages.splice(1,0,{id:'synthetic-hidden',turnId:'hidden',role:'assistant',at:new Date(NOW-110_000).toISOString(),part:{type:'text',text:'synthetic'}});reject(state,'hidden history boundary');
});

void test('连续两个真实必要条件choice共用原请求，保留各个原文来源且不允许普通文本混入',()=>{
  const {state,question}=fixture();state.queue=[];state.completed.push('turn-answer');
  state.messages.push({id:'question-two',turnId:'npc-two',role:'assistant',at:new Date(NOW-5000).toISOString(),part:{type:'choice',text:'今天能练多长时间？',options:['可以练45分钟','只想看一下'],selection:{index:0,turnId:'turn-two',at:new Date(NOW-1000).toISOString()}}},user('two','可以练45分钟',NOW-1000,'question-two'));
  state.queue=['turn-two'];
  const evidence=chenTaskDelegationEvidence(state,NOW);assert.deepEqual(evidence.contextSources.map(s=>({id:s.id,clarification:s.taskClarification})),[{id:'request',clarification:undefined},{id:'answer',clarification:{questionMessageId:'question',requestMessageId:'request'}}]);
  assert.deepEqual(evidence.sources[0].taskClarification,{questionMessageId:'question-two',requestMessageId:'request'});
  const op=parseProfessionalTaskOperation(proposal({sourceMessageId:'two',evidence:'可以练45分钟'}));
  assert.equal(applyProfessionalTaskOperation(state.professionalTasks,op,evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian')?.created,true);
  if(question.part.type==='choice')delete question.part.selection;
  assert.equal(chenTaskDelegationEvidence(state,NOW).sources[0].taskClarification,undefined);
});

void test('已验证选项中的撤回和换目标仍拒绝，身体风险文本不由程序暗改为ready或不疼',()=>{
  for(const answer of ['先不练了','取消任务','我改成胸部训练']){
    const {state,question}=fixture(REQUEST,answer);if(question.part.type==='choice')question.part.options[0]=answer;
    reject(state,answer,{evidence:answer});
  }
  const risky=fixture(REQUEST,'有刺痛或关节疼痛');if(risky.question.part.type==='choice')risky.question.part.selection!.index=3;
  const evidence=chenTaskDelegationEvidence(risky.state,NOW);assert.equal(evidence.sources[0].text,'有刺痛或关节疼痛');
  assert.doesNotThrow(()=>assertProfessionalTaskCardOutput(risky.state,{task:{decision:'none'},parts:[{type:'text',text:'先停下，别继续练肩。'}]},evidence));
  assert.throws(()=>parseProfessionalTaskOperation(proposal({evidence:'有刺痛或关节疼痛',readiness:'not_ready'})));
  assert.equal(risky.state.professionalTasks.length,0);
});

void test('多日原委托的必要choice不丢日期守卫，独立有日期卡不复用今日同目标任务',()=>{
  const {state}=fixture('给我规划未来三天的肩部训练');const evidence=chenTaskDelegationEvidence(state,NOW);
  assert.throws(()=>assertProfessionalTaskCardOutput(state,{task:parsed(),parts:[]},evidence),/每个执行步骤都需要具体日期/);
  const initial=parseProfessionalTaskOperation(proposal({sourceMessageId:'today',evidence:'给我一个肩部训练任务',contextMessageId:undefined}));
  const old=applyProfessionalTaskOperation(state.professionalTasks,initial,[{id:'today',text:'给我一个肩部训练任务'}],[],NOW-180_000,[],'chen-nian')!.task;const before=structuredClone(old);
  const dated=parsed({steps:[{...proposal().steps[0],scheduledDate:'2026-10-14'}]});
  assert.doesNotThrow(()=>assertProfessionalTaskCardOutput(state,{task:dated,parts:[]},evidence));
  const result=applyProfessionalTaskOperation(state.professionalTasks,dated,evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian');
  assert.equal(result?.created,true);assert.equal(state.professionalTasks.length,2);assert.deepEqual(old,before);
  assert.equal(applyProfessionalTaskOperation(state.professionalTasks,dated,evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian')?.created,false);assert.equal(state.professionalTasks.length,2);
  const update=parseProfessionalTaskOperation(proposal({decision:'update',taskId:old.id,steps:[{...proposal().steps[0],scheduledDate:'2026-10-14'}]}));
  assert.throws(()=>applyProfessionalTaskOperation(state.professionalTasks,update,evidence.sources,evidence.plans,NOW,evidence.contextSources,'chen-nian'),/不能修改未被指定/);
});

void test('current choice answer followed by explicit撤回 keeps both任务和原消息 untouched',()=>{
  const {state}=fixture();state.messages.push(user('withdraw','不要任务了',NOW-1000));state.queue.push('turn-withdraw');
  reject(state,'later current withdrawal');
  const before=structuredClone(state);assertProfessionalTaskCardOutput(state,{task:{decision:'none'},parts:[{type:'text',text:'好，先不安排。'}]},chenTaskDelegationEvidence(state,NOW));assert.deepEqual(state,before);
});
