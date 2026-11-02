import ts from 'typescript';import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'comment-live-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const file of readdirSync(folder).filter(n=>n.endsWith('.ts'))){const out=join(dir,folder,file.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,ts.transpileModule(readFileSync(join(folder,file),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);}
 cpSync('npc-skills/references',join(dir,'npc-skills/references'),{recursive:true});const {MomentInteractions}=await import(pathToFileURL(join(dir,'server/npc/moment-interactions.mjs')));
 db=new DatabaseSync(':memory:');const post={id:'synthetic-only',personId:'yuan-xiaoman',status:'published',text:'只打算下楼买瓶水的。',reason:'买水带回花',images:[]};const social=new MomentInteractions(db,dir,()=>post);
 social.interact('synthetic-owner',post,{action:'comment',name:'测试朋友',text:'这花还挺好看，买水顺便抱一束回来是吧😂',requestId:crypto.randomUUID()});await social.tick();
 const result={synthetic:true,comments:social.view('synthetic-owner',post).comments,jobs:db.prepare('SELECT status,attempts FROM npc_moment_social_jobs').all()};mkdirSync('output/moments-integration-qa',{recursive:true});writeFileSync('output/moments-integration-qa/live-comment-reply.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));social.stop();
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
