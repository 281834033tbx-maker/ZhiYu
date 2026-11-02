import assert from 'node:assert/strict';import ts from 'typescript';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';import{join,dirname}from'node:path';import{tmpdir}from'node:os';import{pathToFileURL}from'node:url';import{DatabaseSync}from'node:sqlite';
const dir=mkdtempSync(join(tmpdir(),'zhiyu-image-tests-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const output=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(output),{recursive:true});
  const src=readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');writeFileSync(output,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(dir,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
 cpSync('npc-skills/skills/npc-candid-photo',join(dir,'npc-skills/skills/npc-candid-photo'),{recursive:true});
 const {loadPhotoStyle}=await import(pathToFileURL(join(dir,'server/npc/image-generator.mjs')));
 const style=loadPhotoStyle(dir);
 assert.ok(style.includes(readFileSync('npc-skills/skills/npc-candid-photo/SKILL.md','utf8')));
 assert.ok(style.includes(readFileSync('npc-skills/skills/npc-candid-photo/references/photography-workflow.md','utf8')));
 const workflow=join(dir,'npc-skills/skills/npc-candid-photo/references/photography-workflow.md');
 const original=readFileSync(workflow,'utf8');writeFileSync(workflow,original+'\n更新探针');assert.ok(loadPhotoStyle(dir).endsWith('更新探针'));writeFileSync(workflow,original);
 console.log('PASS full merged Skill and reference content loaded; file updates apply on next generation');
 const {parseOutput,createState,finishTurn}=await import(pathToFileURL(join(dir,'lib/npc/engine.mjs')));
 const {ImageQueue}=await import(pathToFileURL(join(dir,'server/npc/image-worker.mjs')));
 const {parseYuan}=await import(pathToFileURL(join(dir,'lib/npc/yuan-xiaoman.mjs')));
 const request={action:'reply',messages:[{type:'text',text:'我刚泡的茶，给你看看'},{type:'generate_photo',prompt:'一杯新泡的茶，窗边自然光',caption:'还烫着呢',withCharacter:false}],event:null,memories:[]};
 const out=parseOutput(request,'看看你喝的茶');assert.equal(out.parts[1].status,'pending');assert.equal(out.parts[1].url,undefined);assert.equal(parseYuan(request,'看看').parts[1].type,'generated_photo');
 assert.throws(()=>parseOutput({...request,messages:[request.messages[1],request.messages[1]]},''));
 assert.throws(()=>parseOutput({...request,messages:[{type:'generated_photo',status:'ready',url:'http://bad'}]},''));
 console.log('PASS structured scene generation requests; model cannot supply completed image URLs; one image per turn');
 db=new DatabaseSync(join(dir,'state.sqlite'));db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY,revision INTEGER,data TEXT);CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT)');
 const user=crypto.randomUUID(),id=user+':xia-xia:normal';const state=createState('normal');finishTurn(state,crypto.randomUUID(),'看看你喝的茶',out);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(id,state.revision,JSON.stringify(state));
 const get=()=>JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(id).data);
 let finish,calls=0;const queue=new ImageQueue(db,dir,async(root,owner,character,p)=>{calls++;assert.equal(owner,user);assert.equal(character,'xia-xia');return new Promise(r=>finish=r);});
 const task=queue.tick();await queue.tick();assert.equal(calls,1);assert.equal(get().messages.at(-1).part.status,'generating');
 // Concurrent chat writes must survive the completion of a slow image job.
 const fresh=get();fresh.messages.push({id:'during-image',role:'user',part:{type:'text',text:'刚刚又发了一句'}});fresh.revision++;db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(fresh.revision,JSON.stringify(fresh),id);
 finish('/api/npc/media/'+out.parts[1].jobId+'.png');await task;assert.equal(get().messages.at(-1).id,'during-image');assert.equal(get().messages.find(m=>m.part.type==='generated_photo').part.status,'ready');await queue.tick();assert.equal(calls,1);queue.stop();
 console.log('PASS single worker, in-flight chat preservation, ready state persistence and no duplicate generation');
 const failed=get(),m=failed.messages.find(m=>m.part.type==='generated_photo');m.part.status='pending';delete m.part.url;db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(failed),id);
 const failures=new ImageQueue(db,dir,async()=>{throw Error('测试生成失败');});await failures.tick();assert.equal(get().messages.find(item=>item.id===m.id&&item.part.type==='generated_photo').part.status,'failed');assert.equal(failures.retry(crypto.randomUUID(),'xia-xia',m.id),false);assert.equal(failures.retry(user,'xia-xia',m.id),true);failures.stop();
 const restarted=new ImageQueue(db,dir,async()=>'/api/npc/media/recovered.png');await restarted.tick();assert.equal(get().messages.find(m=>m.part.type==='generated_photo').part.status,'ready');restarted.stop();
 console.log('PASS visible failures, owner-only retry and restart recovery');
 if(process.env.LIVE_PLANNER_TEST==='1'){
  const {buildPrompt}=await import(pathToFileURL(join(dir,'server/npc/prompt.mjs')));
  const {generate}=await import(pathToFileURL(join(dir,'server/npc/codex.mjs')));
  const input='给我拍一张你现在桌上的东西看看，直接发照片吧';
  const raw=await generate(process.cwd(),buildPrompt(process.cwd(),createState('test'),input));
  const planned=parseOutput(raw,input);assert.ok(planned.parts.some(p=>p.type==='generated_photo'));
  console.log('PASS LIVE NPC planner requested a newly generated scene:',JSON.stringify(planned.parts.filter(p=>p.type==='generated_photo').map(p=>({prompt:p.prompt,withCharacter:p.withCharacter}))));
 }
 if(process.env.LIVE_IMAGE_TEST==='1'){
  const {generateScene}=await import(pathToFileURL(join(dir,'server/npc/image-generator.mjs')));
  const scene={...out.parts[1],jobId:crypto.randomUUID(),prompt:'A realistic casual phone photo of a desk after sketching, one open sketchbook with a small pencil drawing of a potted plant, pencils, a glass of water, soft afternoon light. No people, no text.',caption:'随手画了两笔'};
  const url=await generateScene(dir,user,'xia-xia',scene);const bytes=readFileSync(join(dir,'.npc-runtime/uploads',user,url.split('/').pop()));assert.ok(bytes.length>10000);
  const again=await generateScene(dir,user,'xia-xia',scene);assert.equal(url,again);
  mkdirSync('output/imagegen',{recursive:true});writeFileSync('output/imagegen/npc-live-generation-verified.png',bytes);
  console.log('PASS LIVE native generation, file validation, application storage and cached same-job replay; saved output/imagegen/npc-live-generation-verified.png');
 }
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
