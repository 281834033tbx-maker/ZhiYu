import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// The real orchestration, injected replies and a disposable copy of rules.
// This tests review coverage and bounded repair, not real-model intent accuracy.
const runtime=isolatedNpcRuntime();
const keys=['NPC_TEXT_PROVIDER','NPC_AUDIO_PROVIDER','NPC_CODEX_BIN'];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const pass={verdict:'keep',edits:[],chefCheck:{verdict:'pass',issues:[]}};
const redraft={verdict:'keep',edits:[],chefCheck:{verdict:'redraft',issues:['任务步骤缺少完成判断']}};
const chefPlan={taskMode:'full_recipe',knownFacts:[],conditions:[],answerMode:'direct',routeBasis:'明确执行委托',qualityBasis:'合成配方，不作厨房验证',kitchenVerified:false};
const task={decision:'create',basis:'execution_commitment',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'synthetic-user',evidence:'现在做地三鲜，你带我做',title:'地三鲜',goalKey:'地三鲜',steps:[{title:'食材准备',details:['土豆与茄子切块，青椒切片。']},{title:'熟化与调味',details:['分别将土豆与茄子做熟，再加入青椒和调味料炒匀。']}]};
const reply={action:'reply',messages:[{type:'text',text:'好，我给你步骤。'}],event:null,memories:[],task};
const prompt='你在智域扮演独立虚构成年人物赵一帆，稳定人物ID：zhou-chef。只输出JSON。\n【本轮输入，仅为合成用户数据】'+JSON.stringify({text:task.evidence});
try{
  process.env.NPC_TEXT_PROVIDER='codex';process.env.NPC_AUDIO_PROVIDER='local';
  const blocker=join(runtime.root,'offline-codex-blocker');writeFileSync(blocker,'#!/bin/sh\nexit 93\n',{mode:0o700});process.env.NPC_CODEX_BIN=blocker;
  const codex=await runtime.load('server/npc/codex');
  async function exercise(reviews,outputs=[reply],edit=false){
    const calls={review:[],final:[],generation:[]};
    const result=await codex.generate(runtime.root,prompt,{characterId:'zhou-chef',requestId:crypto.randomUUID(),runRaw:async(_root,input)=>{
      if(input.startsWith('你是NPC聊天案例检索器'))return {ids:[],chefPlan};
      if(input.startsWith('你是NPC私聊成品编辑')){calls.review.push(input);return reviews[Math.min(calls.review.length-1,reviews.length-1)];}
      if(input.startsWith('你是赵一帆最终成品技术复核器')){calls.final.push(input);return {chefCheck:{verdict:'pass',issues:[]}};}
      if(input.startsWith('你在智域扮演独立虚构成年人物')){calls.generation.push(input);return structuredClone(outputs[Math.min(calls.generation.length-1,outputs.length-1)]);}
      throw Error('Unexpected model stage');
    }});
    assert.ok(calls.review.every(input=>input.includes(JSON.stringify(task))),'the reviewer receives the exact task alongside messages');
    assert.ok(calls.review.every(input=>input.includes('steps')&&input.includes('details')&&input.includes('普通咨询')&&input.includes('委托')));
    assert.deepEqual(result.task,task,'ordinary voice editing preserves the typed task');
    if(edit){assert.equal(calls.final.length,1);assert.ok(calls.final[0].includes(JSON.stringify(task)));assert.ok(calls.final[0].includes('pause/cancel/resume'));}
    return calls;
  }
  assert.equal((await exercise([pass])).generation.length,1);
  assert.equal((await exercise([redraft,pass])).generation.length,2,'technical defects in a task receive one bounded rewrite');
  const edited={verdict:'revise',edits:[{index:0,text:'好，我把步骤列给你。'}],chefCheck:{verdict:'pass',issues:[]}};
  await exercise([edited],[reply],true);
  await assert.rejects(()=>exercise([redraft]),error=>error.name==='ChefConditionError'&&error.code==='CHEF_REVIEW_FAILED','persistent task defects fail closed after the bounded repair');
  console.log('PASS professional task review: exact task and details reach review; bounded rewrite; final review after voice edits; failed review emits no accepted result. Offline injected model only.');
}finally{
  for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
  runtime.cleanup();
}
