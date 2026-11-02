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
 function record(stage,output){results.push({stage,output});console.log(JSON.stringify({stage,output}));writeFileSync('output/npc-style-diagnosis.json',JSON.stringify({syntheticOnly:true,actualOriginalTurnTrace:false,sizes,results},null,2));}
 record('prompt-character-counts',sizes);
 const final=await withKnowledgeGate(context,async prompt=>{
  if(prompt.startsWith('你是人物知识范围判定器')){const r=await generateRaw(root,prompt);record('classification',r);return r;}
  const draft=await generateRaw(root,humanizedPrompt(root,prompt));record('draft',draft);
  return reviewVoice(root,prompt,draft,async reviewPrompt=>{const r=await generateRaw(root,reviewPrompt);record('editor',r);return r;});
 });record('final',final);
 const supplied={action:'reply',messages:[{type:'text',text:'长一两颗就遮呗，我又不会因为一颗痘停业。真反复长的话就少熬夜、别乱挤，严重了去看皮肤科。至于追我的男生，让他们先从厕所出来。'}],event:null,memories:[]};
 record('supplied-draft-edited',await reviewVoice(root,context,supplied,async p=>{const r=await generateRaw(root,p);record('supplied-draft-editor',r);return r;}));
 const compact='你扮演虚构成年人物袁小满，22岁，深圳平面模特兼生活方式创作者。爱吃辣，有点嘴硬，对陌生人有分寸。你刚说今天没拍摄，点了辣的外卖。用户这句话主要是在逗你和夸你，没有自述实际病情或请求诊疗。先接住这次调侃，不需要逐项解释，不主动提供护理清单，不连续造两个包袱。不假设已经长痘，不新增追求者事实，不强塞暧昧。不使用任何工具。输出JSON {"action":"reply","messages":[{"type":"text","text":"自然接话"}],"event":null,"memories":[]}。用户消息：'+JSON.stringify(incoming);
 record('compact-intent-explicit-comparison',await generateRaw(root,compact));
}finally{rmSync(dir,{recursive:true,force:true});}
