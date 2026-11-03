import assert from 'node:assert/strict';
import ts from 'typescript';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync as _DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(join(tmpdir(),'all-npc-'));let _db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const dest=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,ts.transpileModule(readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(dir,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
 cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
 const load=p=>import(pathToFileURL(join(dir,p+'.mjs')));
 const {createLiu,parseLiu}=await load('lib/npc/liu');
 const {createMolly,parseMolly}=await load('lib/npc/molly');
 const {liuPrompt}=await load('server/npc/liu-prompt');
 const {mollyPrompt}=await load('server/npc/molly-prompt');
 const {generate,npcSkillVersion}=await load('server/npc/codex');
 const {generateScene}=await load('server/npc/image-generator');
 const results={version:npcSkillVersion,synthetic:true,userAccepted:false,rows:[]};
 for(const character of ['liu','molly']){
  const input=character==='liu'?'拍一张你桌上的水杯给我看看，不用拍到人，顺便聊两句今天的事':'今天忙不忙，陪我随便聊两句吧';
  const prompt=character==='liu'?liuPrompt(dir,createLiu(),input):mollyPrompt(dir,createMolly(),input);
  const raw=await generate(dir,prompt,{protocol:character==='molly'?'molly':undefined});
  const parsed=character==='liu'?parseLiu(raw,input):parseMolly(raw,input);
  results.rows.push({character,input,raw});
  writeFileSync('output/all-npc-live-check.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({character,raw}));
  if(character==='liu'){
   const part=parsed.parts.find(p=>p.type==='generated_photo');
   assert.ok(part,'Real Liu model did not request a photo');
   const user=crypto.randomUUID();const url=await generateScene(dir,user,'liu',part);
   const filename=url.split('/').pop();const dest='output/liu-photo-smoke-'+filename;
   copyFileSync(join(dir,'.npc-runtime/uploads',user,filename),dest);
   results.photo={path:dest,status:'generated_not_user_accepted'};
   writeFileSync('output/all-npc-live-check.json',JSON.stringify(results,null,2));
   console.log('Real Liu image saved: '+dest);
  }
 }
}finally{rmSync(dir,{recursive:true,force:true});}
