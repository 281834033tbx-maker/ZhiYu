// Real model samples in disposable synthetic branches. No production DB access.
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp=mkdtempSync(join(tmpdir(),'npc-density-live-'));
try {
 cpSync('npc-skills',join(temp,'npc-skills'),{recursive:true});
 for(const [folder,name] of [['server/npc','codex'],['server/npc','prompt'],['server/npc','yuan-prompt'],['server/npc','reply-context'],['lib/npc','engine'],['lib/npc','contracts'],['lib/npc','delivery'],['lib/npc','life'],['lib/npc','yuan-xiaoman']]){
 const src=readFileSync(`${folder}/${name}.ts`,'utf8').replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)([\w-]+)'/g,"'./$1.mjs'").replace("import config from './life-config.json';",'const config='+readFileSync('lib/npc/life-config.json','utf8')+';');
 writeFileSync(join(temp,name+'.mjs'),ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const load=n=>import(pathToFileURL(join(temp,n+'.mjs')));
 const {generate,npcSkillVersion}=await load('codex');
 const {createState}=await load('engine'); const {createYuan}=await load('yuan-xiaoman');
 const {buildPrompt}=await load('prompt');const {yuanPrompt}=await load('yuan-prompt');
 const rows=[];
 for(const character of ['yuan-xiaoman','xia-xia']){
  const s=character==='xia-xia'?createState('normal'):createYuan();
  // Hypothetical conversational context, explicitly not real user history or accepted examples.
  const pairs=[['user','下午好，忙完没'],['assistant',character==='xia-xia'?'刚把视频交了，桌上的饭已经凉透了':'刚拍完，今天跟同事搭档，来来回回折腾了一下午'],['user','今天工作怎么样，有没有什么想吐槽的？']];
  s.messages=pairs.map(([role,text],i)=>({id:`synthetic-${i}`,turnId:`synthetic-${i}`,role,at:new Date(Date.now()-60000+i*15000).toISOString(),part:{type:'text',text}}));
  const input=pairs.at(-1)[1];
  const prompt=character==='xia-xia'?buildPrompt(temp,s,input):yuanPrompt(temp,s,input);
  const started=Date.now();
  const output=await generate(temp,prompt,{requestId:crypto.randomUUID()});
  rows.push({character,syntheticContext:pairs,output,elapsedMs:Date.now()-started,status:'unreviewed_model_candidate'});
  writeFileSync('output/npc-density-live-check.json',JSON.stringify({version:npcSkillVersion,at:new Date().toISOString(),realModel:true,productionDatabaseAccess:false,userAcceptance:false,rows},null,2));
  console.log(JSON.stringify(rows.at(-1)));
 }
}finally{rmSync(temp,{recursive:true,force:true});}
