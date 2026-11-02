import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const temp=mkdtempSync(join(tmpdir(),'schedule-test-'));let db;
try{
 const source=readFileSync('server/npc/scheduled-moments.ts','utf8');writeFileSync(join(temp,'schedule.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const {installApprovedMoments,publishDueMoments,scheduledMomentItems}=await import(pathToFileURL(join(temp,'schedule.mjs')));
 const manifest=JSON.parse(readFileSync('npc-skills/data/moments-approved-20260919.json','utf8'));
 assert.equal(manifest.items.length,6);assert.equal(new Set(manifest.items.map(i=>i.id)).size,6);
 const originals=['output/moments/2026-09-19-xiaoman/candidates.json','output/moments/2026-09-19-xiaoman-v2/candidates.json'].flatMap(p=>JSON.parse(readFileSync(p,'utf8')).posts);
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 for(const item of manifest.items){
  const original=originals.find(p=>p.request_id===item.sourceRequestId);assert.equal(item.text,original.post.text);assert.equal(item.images.length,original.post.media.length);
  item.images.forEach((url,i)=>{assert.equal(hash('public'+url),hash(original.post.media[i].slice(original.post.media[i].indexOf('output/moments/'))));const path=join(temp,'public',url);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'test asset');});
 }
 mkdirSync(join(temp,'npc-skills/data'),{recursive:true});writeFileSync(join(temp,'npc-skills/data/moments-approved-20260919.json'),JSON.stringify(manifest));
 db=new DatabaseSync(':memory:');installApprovedMoments(db,temp);installApprovedMoments(db,temp);assert.equal(scheduledMomentItems(db).length,6);
 const dates=manifest.items.map(i=>Date.parse(i.timelineAt));
 const birth=Date.parse(manifest.characterCreatedAt);
 assert.ok(dates.every(d=>d>=birth&&d<=Date.now()));
 assert.equal(scheduledMomentItems(db).filter(i=>i.status==='published').length,6);
 assert.deepEqual(publishDueMoments(db),[]);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM npc_moment_publication_receipts').get().n,6);
 const receipts=db.prepare('SELECT data FROM npc_moment_publication_receipts').all().map(r=>JSON.parse(r.data));
 assert.ok(receipts.every(r=>r.mode==='historical_import'&&Date.parse(r.timelineAt)<Date.parse(r.appliedAt)));
 installApprovedMoments(db,temp);assert.equal(scheduledMomentItems(db).length,6);
 console.log('PASS six exact approved originals: historical dates within character lifetime, immediate visibility, actual import receipts and reinstall deduplication');
}finally{db?.close();rmSync(temp,{recursive:true,force:true});}
