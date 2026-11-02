import assert from 'node:assert/strict';import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'humanizer-test-'));
try{
 const file=join(dir,'codex.mjs');writeFileSync(file,ts.transpileModule(readFileSync('server/npc/codex.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const {humanizedPrompt,withKnowledgeGate}=await import(pathToFileURL(file));
 const enriched=humanizedPrompt(process.cwd(),'当前人物专属协议');
 for(const path of ['vendor/humanizer-zh/SKILL.md','vendor/humanizer-zh/references/chinese-ai-patterns.md','humanizer-npc.md'])assert.ok(enriched.includes(readFileSync('npc-skills/references/'+path,'utf8')));
 assert.ok(enriched.startsWith('当前人物专属协议'));assert.match(enriched,/不知道.*略懂/);
 let calls=0;const unknown=await withKnowledgeGate('任意NPC',async()=>{calls++;return {decision:'unknown',basis:'无领域知识'};});assert.equal(calls,1);assert.equal(unknown.event,null);
 const expected={action:'reply',messages:[{type:'text',text:'你最后交回第一版了？'}],event:null,memories:[]};
 calls=0;const output=await withKnowledgeGate('人物上下文',async prompt=>{calls++;if(calls===1)return {decision:'not_knowledge',basis:'日常吐槽'};assert.ok(humanizedPrompt(process.cwd(),prompt).includes('NPC适配与最终协议约束'));return expected;});assert.deepEqual(output,expected);assert.equal(calls,2);
 console.log('PASS full local Skill and reference loaded; NPC protocol retained; unknown bypasses rewrite; normal generation uses embedded style pass');
}finally{rmSync(dir,{recursive:true,force:true});}
