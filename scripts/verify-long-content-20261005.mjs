import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Deliberately isolated: no .env loader, production DB/API, scheduler or media
// worker. --live uses only the user's existing Codex account and synthetic data.
const live=process.argv.includes('--live');
const all=process.argv.includes('--all');
const roleIndex=process.argv.indexOf('--role');
const selectedRole=roleIndex<0?null:process.argv[roleIndex+1];
const reportIndex=process.argv.indexOf('--report');
const reportPath=resolve(reportIndex<0?`output/long-content-20261005-${live?'live':'dry-run'}.json`:process.argv[reportIndex+1]);
const runtime=isolatedNpcRuntime();
const savedEnv=Object.fromEntries(['NPC_TEXT_PROVIDER','NPC_CODEX_BIN'].map(key=>[key,process.env[key]]));
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const texts=value=>Array.isArray(value?.messages)?value.messages.flatMap(part=>typeof part==='string'?[part]:part?.type==='text'&&typeof part.text==='string'?[part.text]:[]):[];
const han=messages=>(messages.join('\n').match(/\p{Script=Han}/gu)||[]).length;
const report={at:new Date().toISOString(),mode:live?'actual_codex_model':'dry_run_no_model',synthetic:true,userAcceptance:false,productionDatabaseAccess:false,realMessageDelivery:false,rows:[],failures:[],semanticReview:'pending'};
const save=()=>{mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};
try {
 process.env.NPC_TEXT_PROVIDER='codex';
 const binary='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
 if(!process.env.NPC_CODEX_BIN&&existsSync(binary))process.env.NPC_CODEX_BIN=binary;
 const [codex,xiaPrompt,yuanPrompt,liuPrompt,chenPrompt,engine,yuan,liu,chen,loader]=await Promise.all([
  runtime.load('server/npc/codex'),runtime.load('server/npc/prompt'),runtime.load('server/npc/yuan-prompt'),runtime.load('server/npc/liu-prompt'),runtime.load('server/npc/chen-prompt'),runtime.load('lib/npc/engine'),runtime.load('lib/npc/yuan-xiaoman'),runtime.load('lib/npc/liu'),runtime.load('lib/npc/chen-nian'),runtime.load('server/npc/dialogue-skill'),
 ]);
 const suite=JSON.parse(readFileSync(join(runtime.root,'npc-skills/skills/zhiyu-character-dialogue/tests/long-reply-cases-20261005.json'),'utf8'));
 const roles=[
  {id:'xia-xia',name:'夏夏',create:()=>engine.createState('normal'),build:xiaPrompt.buildPrompt,parse:engine.parseOutput,caseId:'nutrition-training-plan'},
  {id:'yuan-xiaoman',name:'小满',create:()=>yuan.createYuan(),build:yuanPrompt.yuanPrompt,parse:yuan.parseYuan,caseId:'sustained-setback-companionship'},
  {id:'liu',name:'柳智敏',create:()=>liu.createLiu(),build:liuPrompt.liuPrompt,parse:liu.parseLiu,caseId:'credit-dispute-next-day-report'},
  {id:'chen-nian',name:'陈年',create:()=>chen.createChen(),build:chenPrompt.chenPrompt,parse:chen.parseChen,caseId:'credit-dispute-next-day-report'},
 ];
 report.version=codex.npcSkillVersion;
 report.suite= {path:'npc-skills/skills/zhiyu-character-dialogue/tests/long-reply-cases-20261005.json',hash:hash(suite)};
 report.loaderOnly=['he-jiawei','zhou-chef'];
 for(const [id,name]of [['he-jiawei','何嘉伟'],['zhou-chef','周师傅']])assert.ok(loader.loadDialogueSkill(runtime.root,'你是'+name,id).rules.length);
 if(live)assert.ok(codex.codexAvailable(),'Existing Codex account must be available');
 if(selectedRole)assert.ok(roles.some(role=>role.id===selectedRole),'Unknown connected role');
 const jobs=roles.filter(role=>!selectedRole||role.id===selectedRole).flatMap(role=>(all?suite.cases:suite.cases.filter(c=>c.id===role.caseId)).map(test=>({role,test})));
 for(const {role,test}of jobs){
  const state=role.create();
  for(const key of ['familiarity','affection','trust','comfort'])state.values[key]=0;
  if(state.shareState)state.shareState.enabled=false;
  const protectedState=()=>({values:state.values,messages:state.messages,memories:state.memories});
  const stateBefore=hash(protectedState());
  const incoming=test.userMessage+'\n这轮只发文字。请把问题中的具体事情讲充分，按语义分段，不用空泛问句凑互动。';
  const prompt=role.build(runtime.root,state,incoming);
  const loaded=loader.loadDialogueSkill(runtime.root,prompt,role.id);
  const row={characterId:role.id,name:role.name,caseId:test.id,title:test.title,input:incoming,evaluation:test.evaluation,zeroCoreRelations:true,promptHash:hash(prompt),rulesHash:loaded.metadata.rulesHash,stages:[],parsedTexts:[],semanticReview:'pending'};
  report.rows.push(row);save();
  if(!live){row.planned=true;continue;}
  const requestId='long-content-20261005-'+role.id+'-'+test.id;
  const started=Date.now();
  try {
   const raw=await codex.generate(runtime.root,prompt,{characterId:role.id,requestId,runRaw:async(root,input,images)=>{
    const stage=input.startsWith('你是NPC聊天案例检索器')?'retrieval':input.startsWith('你是NPC私聊成品编辑')?'review':'generation';
    row.stages.push({stage,startedAt:new Date().toISOString(),inputHash:hash(input),containsLoadedRules:input.includes(loaded.rules)});save();
    const out=await codex.generateRaw(root,input,images);
    if(stage==='generation')row.draft=out;
    if(stage==='review')row.review=out;
    save();return out;
   }});
   row.final=raw;
   const parsed=role.parse(raw,incoming);
   assert.ok(parsed.parts.every(part=>part.type==='text'||part.type==='emoji'),'This synthetic scenario requests text only');
   row.parsedTexts=parsed.parts.filter(part=>part.type==='text').map(part=>part.text);
   assert.ok(row.parsedTexts.length,'A substantive text reply must reach the actual parser');
   const filler=/^(?:你在干嘛|在干嘛|你呢|要不要聊聊|你现在心情怎么样)[？?。！!\s]*$/u;
   row.emptyQuestionBubbles=row.parsedTexts.filter(t=>filler.test(t.trim()));
   assert.equal(row.emptyQuestionBubbles.length,0,'No isolated empty question may replace a meaningful answer');
   assert.equal(hash(protectedState()),stateBefore,'Build/generate/parse must not modify relation, memory or messages');
   row.trace=readdirSync(join(runtime.root,'.npc-runtime/skill-traces')).map(file=>JSON.parse(readFileSync(join(runtime.root,'.npc-runtime/skill-traces',file),'utf8'))).find(trace=>trace.requestId===requestId);
   assert.equal(row.trace.status,'complete');
   const stages=row.trace.stages;
   assert.deepEqual(stages.map(s=>s.stage),['load','retrieval','generation','review','finalize']);
   assert.equal(stages.find(s=>s.stage==='generation').rulesHash,stages.find(s=>s.stage==='review').rulesHash);
   assert.ok(row.stages.filter(s=>s.stage==='generation'||s.stage==='review').every(s=>s.containsLoadedRules));
   row.lengthObservation={draftHanCharacters:han(texts(row.draft)),finalHanCharacters:han(row.parsedTexts),bubbles:row.parsedTexts.length,scenarioTarget:test.evaluation.length,hardProductionMinimum:false};
   row.pipelinePassed=true;
  } catch(error){row.pipelinePassed=false;row.error=error.message;report.failures.push({characterId:role.id,caseId:test.id,error:error.message});}
  row.durationMs=Date.now()-started;save();
  console.log(JSON.stringify({name:role.name,caseId:test.id,pipelinePassed:row.pipelinePassed,observed:row.lengthObservation,error:row.error}));
 }
 report.pipelinePassed=live?report.failures.length===0:null;
 if(live){
  const md=['# 完整链路长内容校准结果','',`日期：2026-10-05；版本：${report.version}。四位已有后端使用真实 builder → Skill加载 → 检索 → Codex生成 → 成品复核 → 实际parser。所有输入为合成场景；没有写入真实聊天、记忆或关系。语感仍待用户校准，长度只作为观察。`,''];
  for(const row of report.rows){md.push(`## ${row.name}｜${row.title}`,'','**测试输入**',row.input,'','**最终回复**','');if(row.error)md.push('链路失败：'+row.error,'');for(const text of row.parsedTexts)md.push(text,'');md.push(`观察：${row.lengthObservation?.finalHanCharacters??0}个汉字；${row.parsedTexts.length}条文字消息。`,'');}
  const mdPath=reportPath.replace(/\.json$/,'.md');writeFileSync(mdPath,md.join('\n'));report.readableOutput=mdPath;
 }
} catch(error){report.failures.push({error:error.message});report.pipelinePassed=false;}
finally{for(const[key,value]of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}save();runtime.cleanup();}
console.log(JSON.stringify({mode:report.mode,pipelinePassed:report.pipelinePassed,planned:report.rows.length,failures:report.failures,reportPath}));
if(report.failures.length)process.exitCode=1;
