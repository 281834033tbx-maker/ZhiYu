// Idempotent local-app publisher. No model calls, external messages or generated content.
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temp=mkdtempSync(join(tmpdir(),'npc-publish-'));let db;
try{
 const output=join(temp,'scheduled.mjs');writeFileSync(output,ts.transpileModule(readFileSync(join(root,'server/npc/scheduled-moments.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const {installApprovedMoments,publishDueMoments,scheduledMomentItems}=await import(pathToFileURL(output));
 mkdirSync(join(root,'.npc-runtime'),{recursive:true});db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
 installApprovedMoments(db,root);const publishedNow=publishDueMoments(db);const items=scheduledMomentItems(db);
 const result={checkedAt:new Date().toISOString(),publishedNow,published:items.filter(i=>i.status==='published').length,remaining:items.filter(i=>i.status==='scheduled').length,schedule:items.map(i=>({id:i.id,title:i.title,status:i.status,scheduledFor:new Date(i.scheduledFor).toISOString()}))};
 writeFileSync(join(root,'.npc-runtime/moments-schedule-status.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{db?.close();rmSync(temp,{recursive:true,force:true});}
