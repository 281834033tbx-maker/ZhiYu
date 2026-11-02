import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Rechecks already-recorded actual model replies without any model/network
// call. The first harness over-checked transient life fields modified by role
// prompt builders. Only relation, memory and real messages are protected here.
const originalPath='output/long-content-20261005-live.json';
const repairedPaths=['output/long-content-20261005-yuan-v4.json','output/long-content-20261005-chen-v5.json'];
const outputPath='output/long-content-20261005-validated.json';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const original=read(originalPath);
const repaired=repairedPaths.filter(existsSync).map(path=>({path,report:read(path)}));
const runtime=isolatedNpcRuntime();
const report={at:new Date().toISOString(),mode:'actual_codex_outputs_rechecked_offline',synthetic:true,userAcceptance:false,modelCallsInRecheck:0,productionDatabaseAccess:false,realMessageDelivery:false,sourceReports:[originalPath,...repaired.map(item=>item.path)],rows:[],failures:[],semanticReview:'pending'};
try {
 const [codex,xp,yp,lp,cp,engine,yuan,liu,chen]=await Promise.all([runtime.load('server/npc/codex'),runtime.load('server/npc/prompt'),runtime.load('server/npc/yuan-prompt'),runtime.load('server/npc/liu-prompt'),runtime.load('server/npc/chen-prompt'),runtime.load('lib/npc/engine'),runtime.load('lib/npc/yuan-xiaoman'),runtime.load('lib/npc/liu'),runtime.load('lib/npc/chen-nian')]);
 report.validationCodeVersion=codex.npcSkillVersion;
 const roles={
  'xia-xia':{create:()=>engine.createState('normal'),build:xp.buildPrompt,parse:engine.parseOutput},
  'yuan-xiaoman':{create:()=>yuan.createYuan(),build:yp.yuanPrompt,parse:yuan.parseYuan},
  liu:{create:()=>liu.createLiu(),build:lp.liuPrompt,parse:liu.parseLiu},
  'chen-nian':{create:()=>chen.createChen(),build:cp.chenPrompt,parse:chen.parseChen},
 };
 for(const prior of original.rows){
  const repair=repaired.flatMap(item=>item.report.rows.filter(r=>r.characterId===prior.characterId&&r.caseId===prior.caseId&&r.pipelinePassed).map(row=>({...item,row}))).at(-1);
  const source=repair?.row||prior;
  const row={characterId:source.characterId,name:source.name,caseId:source.caseId,title:source.title,input:source.input,evaluation:source.evaluation,sourceReport:repair?repair.path:originalPath,generationVersion:repair?repair.report.version:original.version,draft:source.draft,review:source.review,final:source.final,trace:source.trace,modelStages:source.stages,parsedTexts:[],firstHarnessError:prior.error||null,semanticReview:'pending'};
  report.rows.push(row);
  try {
   assert.ok(source.final,'The actual model pipeline must have returned a final result');
   if(source.error)assert.ok(source.error.startsWith('Build/generate/parse must not modify relation, memory or messages'),'An actual pipeline failure cannot be relabelled as a harness correction');
   const role=roles[source.characterId];
   const state=role.create();
   for(const key of ['familiarity','affection','trust','comfort'])state.values[key]=0;
   if(state.shareState)state.shareState.enabled=false;
   const protectedState=()=>({values:state.values,messages:state.messages,memories:state.memories});
   const before=hash(protectedState());
   role.build(runtime.root,state,source.input);
   const parsed=role.parse(source.final,source.input);
   assert.equal(hash(protectedState()),before,'Actual builders/parsers must preserve relationship, memory and delivered messages');
   assert.ok(parsed.parts.every(part=>part.type==='text'||part.type==='emoji'));
   row.parsedTexts=parsed.parts.filter(part=>part.type==='text').map(part=>part.text);
   assert.ok(row.parsedTexts.length);
   if(source.parsedTexts?.length)assert.deepEqual(row.parsedTexts,source.parsedTexts);
   assert.ok(source.stages.some(s=>s.stage==='retrieval'));
   assert.ok(source.stages.filter(s=>s.stage==='generation'||s.stage==='review').every(s=>s.containsLoadedRules));
   row.lengthObservation={draftHanCharacters:((source.draft?.messages||[]).map(p=>p.text||'').join('\n').match(/\p{Script=Han}/gu)||[]).length,finalHanCharacters:(row.parsedTexts.join('\n').match(/\p{Script=Han}/gu)||[]).length,bubbles:row.parsedTexts.length,hardProductionMinimum:false};
   row.emptyQuestionBubbles=row.parsedTexts.filter(t=>/^(你在干嘛|在干嘛|你呢|要不要聊聊|你现在心情怎么样)[？?。！!\s]*$/u.test(t.trim()));
   assert.equal(row.emptyQuestionBubbles.length,0);
   row.pipelineOutputRecheckPassed=true;
   row.harnessCorrection=source.error?'Transient life data is legitimate prompt-builder state; protected relation, memory and messages are unchanged':null;
  } catch(error){row.pipelineOutputRecheckPassed=false;row.error=error.message;report.failures.push({name:row.name,error:error.message});}
 }
 report.passed=report.failures.length===0;
} finally {runtime.cleanup();mkdirSync(dirname(resolve(outputPath)),{recursive:true});writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');}
const md=['# 实际模型长回复校准','',`日期：2026-10-05。全部输入为合成场景；按真实后端生成和复核，现用${report.validationCodeVersion}的实际parser离线复核结果。未写真实聊天、关系或记忆。初轮测试脚本误检查暂态生活字段的记录保留；小满复核错下标在v4修复后实际重跑，陈年在v5增加去重复规则后实际复测。内容与语感仍待用户校准。`,''];
for(const row of report.rows){md.push(`## ${row.name}｜${row.title}`,'','**测试问题**',row.input,'','**实际最终回复**','');if(row.error)md.push('尚未通过：'+row.error,'');for(const text of row.parsedTexts)md.push(text,'');md.push(`观察：${row.lengthObservation?.finalHanCharacters??0}个汉字，${row.parsedTexts.length}条消息。字数不是质量判据或生产配额。`,'');}
writeFileSync(outputPath.replace(/\.json$/,'.md'),md.join('\n'));
console.log(JSON.stringify({passed:report.passed,rows:report.rows.map(r=>({name:r.name,passed:r.pipelineOutputRecheckPassed,length:r.lengthObservation,error:r.error})),outputPath}));
if(!report.passed)process.exitCode=1;
