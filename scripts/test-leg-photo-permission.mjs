import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'leg-photo-'));
try {
 const src=readFileSync('server/npc/reply-context.ts','utf8').slice(readFileSync('server/npc/reply-context.ts','utf8').indexOf('// User-confirmed permission threshold'));
 const file=join(dir,'permission.mjs');writeFileSync(file,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText);
 const {legPhotoAllowed,asksLegPhoto,legPhotoGuidance}=await import(pathToFileURL(file));
 for(const v of [0,5,49,49.99,null,undefined,'80',NaN])assert.equal(legPhotoAllowed(v),true);
 for(const v of [50,51,100])assert.equal(legPhotoAllowed(v),true);
 for(const s of ['看看腿','看看你的腿呗','我想看你的腿照'])assert.equal(asksLegPhoto(s),true);
 for(const s of ['看看腿伤怎么处理','帮我看看这条裤子','给我拍花'])assert.equal(asksLegPhoto(s),false);
 assert.match(legPhotoGuidance(50),/当前后台判定：允许/);assert.match(legPhotoGuidance(49),/当前后台判定：允许/);
 for(const f of ['prompt.ts','yuan-prompt.ts','liu-prompt.ts'])assert.match(readFileSync('server/npc/'+f,'utf8'),/legPhotoGuidance\((?:state|s)\.values\.affection\)/);
 console.log('PASS temporary bypass at 0/5/49/50 and unknown values, ordinary requests and three adult character prompt wiring; no model or production data used');
} finally {rmSync(dir,{recursive:true,force:true});}
