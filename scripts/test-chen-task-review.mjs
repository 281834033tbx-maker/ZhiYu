import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
const runtime=isolatedNpcRuntime();
const keys=['NPC_TEXT_PROVIDER','NPC_AUDIO_PROVIDER','NPC_CODEX_BIN'];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try{
  process.env.NPC_TEXT_PROVIDER='codex';process.env.NPC_AUDIO_PROVIDER='local';
  const blocker=join(runtime.root,'offline-codex-blocker');writeFileSync(blocker,'#!/bin/sh\nexit 93\n',{mode:0o700});process.env.NPC_CODEX_BIN=blocker;
  const codex=await runtime.load('server/npc/codex'),chen=await runtime.load('lib/npc/chen-nian'),prompts=await runtime.load('server/npc/chen-prompt');
  const s=chen.createChen(),input='我现在要练胸，给我一个胸部训练任务。';
  s.messages.push({id:'source',turnId:'turn',role:'user',at:new Date().toISOString(),part:{type:'text',text:input}});s.queue=['turn'];
  const context=prompts.chenPrompt(runtime.root,s,input);
  const task={decision:'create',basis:'explicit_request',confidence:.95,scope:'current_user',polarity:'affirmed',readiness:'ready',sourceMessageId:'source',evidence:input,title:'胸部训练',goalKey:'胸',steps:[{title:'上斜哑铃卧推',category:'main',training:{target:'上胸',sets:4,reps:'12~15次',restSeconds:120,effort:'保留1~2次规范动作余力'},instructions:['沉肩，稳定手腕，控制下降。'],completionCondition:'完成4组'}]};
  const reply={action:'reply',messages:[{type:'text',text:'老大，我给你把动作放任务里了👌'}],event:null,memories:[],task};
  const pass={verdict:'keep',edits:[],chenSourceCheck:{verdict:'pass',issues:[]}};
  const reject={verdict:'keep',edits:[],chenSourceCheck:{verdict:'redraft',issues:['训练任务缺少用户适用条件']}};
  async function run(reviews){
    const calls={generation:0,reviews:[],final:[]};
    const result=await codex.generate(runtime.root,context,{characterId:'chen-nian',requestId:crypto.randomUUID(),runRaw:async(_root,input)=>{
      if(input.startsWith('你是NPC聊天案例检索器'))return {ids:[],fitnessEntryIds:[]};
      if(input.startsWith('你是NPC私聊成品编辑')){calls.reviews.push(input);return reviews[Math.min(calls.reviews.length-1,reviews.length-1)];}
      if(input.startsWith('你是陈年最终成品技术复核器')){calls.final.push(input);return {chenSourceCheck:{verdict:'pass',issues:[]}};}
      calls.generation++;return structuredClone(reply);
    }});
    assert.deepEqual(result.task,task);assert.ok(calls.reviews.every(prompt=>prompt.includes(JSON.stringify(task))&&prompt.includes('steps.training')&&prompt.includes('真实委托')));
    return calls;
  }
  assert.equal((await run([pass])).generation,1,'Task requires check even without source selection');
  assert.equal((await run([reject,pass])).generation,2,'One bounded technical rewrite');
  const edited={verdict:'revise',edits:[{index:0,text:'老大，动作放任务里了，先做第一项👌'}],chenSourceCheck:{verdict:'pass',issues:[]}};
  const editedCalls=await run([edited]);assert.equal(editedCalls.final.length,1);assert.ok(editedCalls.final[0].includes(JSON.stringify(task)));
  await assert.rejects(()=>run([reject]),error=>error.code==='CHEN_SOURCE_REVIEW_FAILED');
  console.log('PASS Chen task review: typed task always reviewed, exact fields and provenance checked, one technical rewrite, final technical check after wording edits; injected model, no live API/database.');
}finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}runtime.cleanup();}
