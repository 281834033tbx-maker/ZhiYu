import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync as _mkdirSync} from 'node:fs';
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
 writeFileSync(join(dir,'codex.mjs'),readFileSync(join(dir,'codex.mjs'),'utf8')+'\nexport {generateRaw};');
 const load=name=>import(pathToFileURL(join(dir,name+'.mjs')));

 const {generateRaw,humanizedPrompt,withKnowledgeGate,reviewVoice}=await load('codex');
 const {createYuan}=await load('yuan-xiaoman');const {yuanPrompt}=await load('yuan-prompt');
 const {createState}=await load('engine');const {buildPrompt}=await load('prompt');
 const root=process.cwd(),state=createYuan(),results=[];
 const incoming='吃辣椒脸上长痘怎么办 这么好看的脸 长痘了岂不是追你的男生都哭晕在厕所了么！';
 state.messages.push({id:'synthetic-previous',turnId:'synthetic',role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'今天没拍摄，点了个辣的外卖'}});
 const context=yuanPrompt(root,state,incoming);
 const enriched=humanizedPrompt(root,context);
 const sizes={yuanBase:context.length,yuanFull:enriched.length,xiaBase:buildPrompt(root,createState('normal'),incoming).length,upstream:readFileSync('npc-skills/references/vendor/humanizer-zh/SKILL.md','utf8').length,upstreamReference:readFileSync('npc-skills/references/vendor/humanizer-zh/references/chinese-ai-patterns.md','utf8').length};
 function record(stage,output){results.push({stage,output});console.log(JSON.stringify({stage,output}));writeFileSync('output/npc-approved-style-retest.json',JSON.stringify({syntheticOnly:true,actualOriginalTurnTrace:false,sizes,results},null,2));}
 record('prompt-character-counts',sizes);
 const final=await withKnowledgeGate(context,async prompt=>{
  if(prompt.startsWith('你是人物知识范围判定器')){const r=await generateRaw(root,prompt);record('classification',r);return r;}
  const draft=await generateRaw(root,humanizedPrompt(root,prompt));record('draft',draft);
  return reviewVoice(root,prompt,draft,async reviewPrompt=>{const r=await generateRaw(root,reviewPrompt);record('editor',r);return r;});
 });record('final',final);
 const helpContext=yuanPrompt(root,state,'不是开玩笑，我脸上真的反复红肿疼痛，该怎么办');
 let classified=false;
 await withKnowledgeGate(helpContext,async p=>{if(!classified){classified=true;const result=await generateRaw(root,p);record('actual-health-help-classification',result);assert.equal(result.decision,'safety_support');return result;}return {action:'reply',messages:[],event:null,memories:[]};});
 assert.equal(results.find(r=>r.stage==='classification').output.decision,'not_knowledge');
 assert.ok(!final.messages.some(m=>/皮肤科|温和洗脸|别挤|多喝水/.test(m.text||'')),'Teasing still produced unsolicited care advice');
}finally{rmSync(dir,{recursive:true,force:true});}
