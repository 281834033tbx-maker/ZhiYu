import assert from 'node:assert/strict';import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'npc-knowledge-live-'));
try{
 for(const [folder,name] of [['lib/npc','contracts'],['lib/npc','engine'],['lib/npc','life'],['server/npc','prompt'],['server/npc','codex']]){
  const source=readFileSync(`${folder}/${name}.ts`,'utf8').replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(contracts|engine|life|prompt)'/g,"'./$1.mjs'").replace("import config from './life-config.json';",'const config='+readFileSync('lib/npc/life-config.json','utf8')+';');
  writeFileSync(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const {createState}=await import(pathToFileURL(join(dir,'engine.mjs'))),{buildPrompt}=await import(pathToFileURL(join(dir,'prompt.mjs'))),{generate,unknownReplies}=await import(pathToFileURL(join(dir,'codex.mjs')));
 const state=createState('normal');state.messages.push({id:crypto.randomUUID(),turnId:crypto.randomUUID(),role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'知道呀，可以是吃的豆包，也可以是那个AI助手。你说的是哪个？'}});
 const out=await generate(process.cwd(),buildPrompt(process.cwd(),state,'你知道他是llm还是agent吗！'));
 assert.equal(out.messages.length,1);assert.ok(Object.values(unknownReplies).includes(out.messages[0].text));assert.equal(out.event,null);
 writeFileSync('output/npc-knowledge-live.json',JSON.stringify({passed:true,input:'你知道他是llm还是agent吗！',output:out},null,2));
 console.log('PASS real model classification: screenshot follow-up takes unknown branch with no expert answer');
}finally{rmSync(dir,{recursive:true,force:true});}
