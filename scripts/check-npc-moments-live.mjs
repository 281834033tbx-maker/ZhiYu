// Isolated synthetic conversation: never reads or modifies user conversation state.
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'npc-moments-live-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const dest=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,ts.transpileModule(readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 cpSync('npc-skills/references',join(dir,'npc-skills/references'),{recursive:true});
 const {MomentsQueue}=await import(pathToFileURL(join(dir,'server/npc/moments-plugin.mjs')));
 const {generateRaw}=await import(pathToFileURL(join(dir,'server/npc/codex.mjs')));
 mkdirSync(join(dir,'.npc-runtime'),{recursive:true});db=new DatabaseSync(join(dir,'.npc-runtime/state.sqlite'));db.exec('CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT)');
 let clock=Date.now();const start=clock,owner=crypto.randomUUID();let decision;
 const queue=new MomentsQueue(db,dir,async(root,prompt)=>{decision=await generateRaw(root,prompt);return decision;},()=>clock);
 const messages=[['assistant','那个转身镜头我练了好多次，还是总觉得自己肩膀有点僵。'],['user','我记得。你之前总是转到一半就去看镜头，这次没有了，自然好多。'],['assistant','你居然还记得我之前怎么转的。'],['user','记得啊，你练了这么久，我又不是只看你长得好不好看。'],['assistant','突然有点开心。刚才还觉得自己白练了。']].map(([role,text],i)=>({id:'synthetic-'+i,turnId:'synthetic',role,at:new Date(start+1000+i*1000).toISOString(),part:{type:'text',text}}));
 db.prepare('INSERT INTO yuan_sessions VALUES(?,?)').run(owner+':yuan-xiaoman',JSON.stringify({branch:'synthetic-only',messages,pending:null,queue:[],relationship:'strangers',values:{}}));
 clock+=40000;await queue.tick();const items=queue.list(owner);
 const out=resolve('output/moments-integration-qa');mkdirSync(out,{recursive:true});
 writeFileSync(join(out,'live-decision.json'),JSON.stringify({synthetic:true,decision,items},null,2));
 if(items[0]?.images.length){writeFileSync(join(out,'chat-screenshot.svg'),queue.image(owner,items[0].id));}
 console.log(JSON.stringify({synthetic:true,decision,candidates:items.length,errors:queue.errors(owner)},null,2));queue.stop();
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
