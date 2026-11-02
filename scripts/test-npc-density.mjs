import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
// Only fresh synthetic states. Never open the runtime DB or load browser history.
const dir=mkdtempSync(join(tmpdir(),'humanizer-live-'));
try {
 const modules=[['server/npc','reply-context'],['lib/npc','delivery'],['lib/npc','contracts'],['lib/npc','engine'],['lib/npc','life'],['lib/npc','yuan-xiaoman'],['lib/npc','molly'],['server/npc','prompt'],['server/npc','yuan-prompt'],['server/npc','molly-prompt'],['server/npc','codex']];
 for(const [folder,name] of modules){
  const source=readFileSync(`${folder}/${name}.ts`,'utf8')
   .replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(reply-context|delivery|contracts|engine|life|yuan-xiaoman|molly|prompt|yuan-prompt|molly-prompt)'/g,"'./$1.mjs'")
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
 const first=createState('normal'),familiar=createYuan();
 first.values.familiarity=45;first.values.affection=45;first.values.comfort=55;
 first.messages.push({id:crypto.randomUUID(),turnId:crypto.randomUUID(),role:'user',at:new Date().toISOString(),part:{type:'text',text:'又熬夜追剧啦？'}},{id:crypto.randomUUID(),turnId:crypto.randomUUID(),role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'本来想看完这集就睡，结果没忍住点下一集了'}});
 // Synthetic comparison values only, never production thresholds or user state.
 familiar.values.familiarity=30;familiar.values.affection=25;familiar.values.comfort=35;
 const history=(role,text)=>familiar.messages.push({id:crypto.randomUUID(),turnId:crypto.randomUUID(),role,at:new Date().toISOString(),part:{type:'text',text}});
 history('user','又点辣的了？');history('assistant','今天没拍摄，可以放肆一顿');
 history('user','上回你说想去的咖啡店去了没');history('assistant','去了，咖啡一般，椅子倒是挺舒服');
 const series=[{id:'xia-familiar-density',state:first,build:buildPrompt,parse:parseOutput,inputs:['最近除了追剧，还在忙什么呀']},{id:'yuan-slightly-familiar',state:familiar,build:yuanPrompt,parse:parseYuan,inputs:['今天拍摄有什么好玩的事吗']}];
 for(const item of series){
  for(const input of item.inputs){
   const start=Date.now();
   try {
    const output=await generate(root,item.build(root,item.state,input));item.parse(output,input);
    const at=new Date().toISOString(),turnId=crypto.randomUUID();
    item.state.messages.push({id:crypto.randomUUID(),turnId,role:'user',at,part:{type:'text',text:input}},...output.messages.map(part=>({id:crypto.randomUUID(),turnId,role:'assistant',at,part})));
    const row={character:item.id,input,output,elapsedMs:Date.now()-start};results.push(row);console.log(JSON.stringify(row));
   }catch(error){const row={character:item.id,input,error:String(error)};results.push(row);console.log(JSON.stringify(row));}
   writeFileSync('output/npc-density-review.json',JSON.stringify({syntheticOnly:true,results},null,2));
  }
 }
 assert.ok(results.every(r=>!r.error),'Conversation test failed');
}finally{rmSync(dir,{recursive:true,force:true});}
