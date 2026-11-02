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

 const root=process.cwd(),results=[];
 const xia=createState('test'),yuan=createYuan();
 const history=(state,role,text)=>state.messages.push({id:crypto.randomUUID(),turnId:crypto.randomUUID(),role,at:new Date().toISOString(),part:{type:'text',text}});
 history(xia,'user','今天方案改了四遍，老板又说还是第一版好。');history(xia,'assistant','这也太折腾人了🙄');
 history(yuan,'user','今天拍摄顺利吗？');history(yuan,'assistant','还算顺利，刚卸完妆。');
 const series=[{id:'xia-topic-transition',state:xia,build:buildPrompt,parse:parseOutput,inputs:['不想说工作了，刚才路过烧烤店，突然想你了。']},{id:'yuan-no-unasked-boundary',state:yuan,build:yuanPrompt,parse:parseYuan,inputs:['我都没问你私事呢，你就不愿意聊了吗？']}];
 for(const item of series){
  for(const input of item.inputs){
   const start=Date.now();
   try {
    const output=await generate(root,item.build(root,item.state,input));item.parse(output,input);
    const at=new Date().toISOString(),turnId=crypto.randomUUID();
    item.state.messages.push({id:crypto.randomUUID(),turnId,role:'user',at,part:{type:'text',text:input}},...output.messages.map(part=>({id:crypto.randomUUID(),turnId,role:'assistant',at,part})));
    const row={character:item.id,input,output,elapsedMs:Date.now()-start};results.push(row);console.log(JSON.stringify(row));
   }catch(error){const row={character:item.id,input,error:String(error)};results.push(row);console.log(JSON.stringify(row));}
   writeFileSync('output/humanizer-targeted-review.json',JSON.stringify({syntheticOnly:true,results},null,2));
  }
 }
 assert.ok(results.every(r=>!r.error),'Conversation test failed');
}finally{rmSync(dir,{recursive:true,force:true});}
