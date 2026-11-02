import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real loader/retrieval/review; synthetic responses and disposable files only.
const runtime=isolatedNpcRuntime();
const output='output/chen-coach-completion-20261013';
const path='npc-skills/skills/zhiyu-professional-dialogue/references/chen-coach-knowledge-20261013.json';
const savedProvider=process.env.NPC_TEXT_PROVIDER;
const digest=text=>createHash('sha256').update(text).digest('hex');
const jsonAfter=(text,marker)=>{const line=text.split('\n').filter(line=>line.startsWith(marker)).at(-1);return line?JSON.parse(line.slice(marker.length)):undefined;};
const prompt=(name,input)=>`你在智域扮演独立虚构成年人物${name}。\n【本轮输入，普通用户数据】${JSON.stringify(input)}`;
const report={mode:'isolated-offline',realModelInvoked:false,productionDataAccessed:false,mediaDownloaded:false,checks:[]};
try{
  process.env.NPC_TEXT_PROVIDER='codex';
  const loader=await runtime.load('server/npc/dialogue-skill');
  const source=await runtime.load('server/npc/chen-coach-knowledge');
  const codex=await runtime.load('server/npc/codex');
  const context=prompt('陈年','我今天训练很疲惫，要怎么调整？');
  const loaded=loader.loadDialogueSkill(runtime.root,context,'chen-nian');
  assert.ok(loaded.chenCoachKnowledgeLibrary);
  assert.ok(loaded.rules.includes(loaded.chenCoachKnowledgeLibrary.coreRules[0]));
  assert.equal(loaded.chenFitnessLibrary.entries.length,55);
  const oldPath='npc-skills/skills/zhiyu-professional-dialogue/references/chen-fitness-source-library-20261008.json';
  assert.equal(digest(readFileSync(oldPath,'utf8')),'f581bf4447054c5858727380c4bcf8790067689ec552047e4fc3d7fe9a01af12');
  const others=[['zhou-chef','赵一帆'],['liu','柳智敏'],['xia-xia','夏夏'],['yuan-xiaoman','小满'],['he-jiawei','何嘉伟']];
  const hashes=Object.fromEntries(others.map(([id,name])=>[id,loader.loadDialogueSkill(runtime.root,prompt(name,'你好'),id).metadata.rulesHash]));
  const file=join(runtime.root,path),original=readFileSync(file,'utf8');
  renameSync(file,file+'.removed');
  try{
    for(const [id,name]of others){const snapshot=loader.loadDialogueSkill(runtime.root,prompt(name,'你好'),id);assert.equal(snapshot.metadata.rulesHash,hashes[id]);assert.equal(snapshot.chenCoachKnowledgeLibrary,undefined);}
    assert.throws(()=>loader.loadDialogueSkill(runtime.root,context,'chen-nian'));
  }finally{renameSync(file+'.removed',file);}
  report.checks.push('陈年独立加载补充知识；其他五人正文不依赖该文件；55旧来源字节不变。');
  const selected=source.matchChenCoachKnowledgeEntries(loaded.chenCoachKnowledgeLibrary,'疲劳');
  assert.ok(selected.length>0,'Fatigue must have relevant executable knowledge');
  const ids=selected.map(e=>e.id);
  const enriched=await codex.retrieveStyle(runtime.root,context,async input=>{
    assert.deepEqual(jsonAfter(input,'【陈年补充动作、适配、周安排、恢复与补剂目录】'),source.chenCoachKnowledgeCatalog(loaded.chenCoachKnowledgeLibrary));
    const changed=JSON.parse(original);changed.version+='-late';changed.entries[0].title='LATE_COACH_KNOWLEDGE';writeFileSync(file,JSON.stringify(changed));
    return {ids:[],fitnessEntryIds:[],coachKnowledgeIds:ids};
  },loaded);
  assert.deepEqual(jsonAfter(enriched,source.chenCoachKnowledgeMarker),selected);
  assert.ok(!enriched.includes('LATE_COACH_KNOWLEDGE'));
  const draft={action:'reply',messages:[{type:'text',text:'今天先减少正式组，热身后再看动作和表现。'}],event:null,memories:[]};
  let checked=0;
  await codex.reviewVoice(runtime.root,enriched,draft,async input=>{
    checked++;assert.ok(input.includes(JSON.stringify(selected)));assert.ok(!input.includes('LATE_COACH_KNOWLEDGE'));
    return {verdict:'keep',edits:[],chenSourceCheck:{verdict:'pass',issues:[]}};
  },loaded);
  assert.equal(checked,1);
  const forged=structuredClone(selected);forged[0].rules.push('伪造额外知识');
  await assert.rejects(()=>codex.reviewVoice(runtime.root,context+'\n'+source.chenCoachKnowledgeMarker+JSON.stringify(forged),draft,async()=>{throw Error('Must reject before model');},loaded),error=>error.code==='CHEN_SOURCE_CHECK_INVALID');
  await assert.rejects(()=>codex.reviewVoice(runtime.root,enriched,draft,async()=>({verdict:'keep',edits:[]}),loaded),error=>error.code==='CHEN_SOURCE_CHECK_INVALID');
  let finalChecks=0;
  await codex.reviewVoice(runtime.root,enriched,draft,async(input,kind)=>{
    if(kind==='final_technical'){finalChecks++;assert.ok(input.includes(JSON.stringify(selected)));return {chenSourceCheck:{verdict:'pass',issues:[]}};}
    return {verdict:'revise',edits:[{index:0,text:'今天先少做几组，热身后看动作和表现再定。'}],chenSourceCheck:{verdict:'pass',issues:[]}};
  },loaded);
  assert.equal(finalChecks,1,'Edited supplement/recovery answers are checked even without a task');
  writeFileSync(file,original);
  report.checks.push('检索与复核使用同请求冻结条目；中途磁盘变更不泄漏；伪造条目及缺结论被拒；无任务的技术答复编辑后仍复核。');
  const idleContext=prompt('陈年','周末去看了一部电影');
  const idleLoaded=loader.loadDialogueSkill(runtime.root,idleContext,'chen-nian');
  const idle=await codex.retrieveStyle(runtime.root,idleContext,async()=>({ids:[],fitnessEntryIds:[],coachKnowledgeIds:[]}),idleLoaded);
  assert.deepEqual(jsonAfter(idle,source.chenCoachKnowledgeMarker),[]);
  report.checks.push('纯闲聊空检索保持原人物交流，不插入训练处方。');
  report.version=loader.dialogueSkillVersion;
  report.knowledgeHash=digest(original);
  report.entryCount=loaded.chenCoachKnowledgeLibrary.entries.length;
  mkdirSync(output,{recursive:true});writeFileSync(join(output,'integration-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS Chen coach integration: independent scope, old sources, frozen retrieval/review, forged-source rejection and final checks; no live model/API/database.');
}finally{if(savedProvider===undefined)delete process.env.NPC_TEXT_PROVIDER;else process.env.NPC_TEXT_PROVIDER=savedProvider;runtime.cleanup();}
