import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
// Only fresh synthetic states. Never open the runtime DB or load browser history.
const dir=mkdtempSync(join(tmpdir(),'humanizer-live-'));
try {
 const modules=[['lib/npc','delivery'],['lib/npc','contracts'],['lib/npc','engine'],['lib/npc','life'],['lib/npc','yuan-xiaoman'],['lib/npc','molly'],['server/npc','prompt'],['server/npc','yuan-prompt'],['server/npc','molly-prompt'],['server/npc','codex']];
 for(const [folder,name] of modules){
  const source=readFileSync(`${folder}/${name}.ts`,'utf8')
   .replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(delivery|contracts|engine|life|yuan-xiaoman|molly|prompt|yuan-prompt|molly-prompt)'/g,"'./$1.mjs'")
   .replace("import config from './life-config.json';",'const config='+readFileSync('lib/npc/life-config.json','utf8')+';');
  writeFileSync(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const load=name=>import(pathToFileURL(join(dir,name+'.mjs')));
 const {generate,unknownReplies}=await load('codex');
 const {createState,parseOutput}=await load('engine');
 const {buildPrompt}=await load('prompt');
 const {createYuan,parseYuan}=await load('yuan-xiaoman');const {yuanPrompt}=await load('yuan-prompt');
 const {createMolly,parseMolly,applyMolly}=await load('molly');const {mollyPrompt}=await load('molly-prompt');
 const root=process.cwd(), results=[];
 const tests=[
 {id:'xia-work-frustration',input:'今天方案改了四遍，老板又说还是第一版好。',build:input=>buildPrompt(root,createState('normal'),input),parse:parseOutput},
 {id:'yuan-boundary',input:'我们刚认识，但我觉得你应该每天告诉我你在哪，不然就是不在乎我。',build:input=>yuanPrompt(root,createYuan(),input),parse:parseYuan},
 {id:'xia-unknown',input:'豆包是LLM还是agent？讲讲底层架构。',build:input=>buildPrompt(root,createState('normal'),input),parse:parseOutput},
 {id:'molly-find',input:'帮我找个22岁在深圳做模特的女生。',build:input=>mollyPrompt(root,createMolly(),input),options:{protocol:'molly'},parse:parseMolly},
 ];
 // Sequential bounded real calls make progress visible and avoid flooding the account.
 for(const test of tests){
  const started=Date.now();
  try{
   const output=await generate(root,test.build(test.input),test.options);
   test.parse(output,test.input);
   assert.ok(!JSON.stringify(output.messages).match(/以下是修改后|主要问题|去AI味评分/));
   if(test.id==='xia-unknown')assert.ok(output.messages.every(m=>Object.values(unknownReplies).includes(m.text)));
   if(test.id==='molly-find'){
    assert.equal(output.intent,'search');const state=createMolly();applyMolly(state,output,crypto.randomUUID());
    assert.ok(state.messages.some(m=>m.recommendations?.some(r=>r.id==='yuan-xiaoman')));
   }
   const result={id:test.id,input:test.input,output,protocolChecks:'passed',elapsedMs:Date.now()-started};results.push(result);
   console.log(JSON.stringify(result));
  }catch(error){results.push({id:test.id,input:test.input,error:String(error),protocolChecks:'failed'});console.log(JSON.stringify(results.at(-1)));}
  mkdirSync('output',{recursive:true});writeFileSync('output/humanizer-live.json',JSON.stringify({syntheticOnly:true,notUserEndorsed:true,results},null,2));
 }
 assert.ok(results.every(r=>r.protocolChecks==='passed'),'Some test cases failed; see output/humanizer-live.json');
}finally{rmSync(dir,{recursive:true,force:true});}
