import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'zhiyu-media-'));let server;
try {
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const output=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(output),{recursive:true});
  const src=readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
  writeFileSync(output,ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(dir,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
 const load=path=>import(pathToFileURL(join(dir,'server/npc',path+'.mjs')));
 const {npcMedia,userPart,imageInputs,partInput}=await load('media');
 const {npcAudio,audioExtension}=await load('audio');
 const {VoiceQueue}=await load('voice-worker');
 const {DatabaseSync}=await import('node:sqlite');
 const {npcLocal}=await load('plugin'),{mollyLocal}=await load('molly-plugin'),{yuanLocal}=await load('yuan-plugin');
 const handlers=[];
 server=createServer((req,res)=>{const entry=handlers.find(([p])=>req.url.split('?')[0].startsWith(p));if(!entry){res.statusCode=404;res.end();return;}req.url=req.url.slice(entry[0].length)||'/';entry[1](req,res);});
 const fake={config:{root:dir},middlewares:{use:(...entry)=>handlers.push(entry)},httpServer:server};
 const deps={available:()=>false,generate:async()=>{throw Error('should not generate');}};
 for(const plugin of [npcMedia(),npcAudio({transcribe:async()=> '你好，今天怎么样',translate:async(_r,text,target)=>target+':'+text}),npcLocal(deps),mollyLocal(deps),yuanLocal(deps)])plugin.configureServer(fake);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const init=await fetch(origin+'/api/npc/xia-xia');const cookie=init.headers.get('set-cookie').split(';')[0],user=cookie.split('=')[1];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhZkAAAAASUVORK5CYII=','base64');
 const req=(path,body,extra={})=>fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,...extra},...(body?{body}: {})});
 const up=await req('/api/npc/media',png);assert.equal(up.status,200);const media=await up.json();
 assert.deepEqual(Buffer.from(await(await req(media.url)).arrayBuffer()),png);
 const alien=await fetch(origin+media.url,{headers:{Cookie:'zhiyu_npc='+crypto.randomUUID()}});assert.equal(alien.status,404);
 assert.equal((await req('/api/npc/media',Buffer.from('<svg onload="bad"/>'))).status,400);
 assert.equal((await req('/api/npc/media',png,{Origin:'http://evil.example'})).status,403);
 assert.equal(userPart(dir,user,{imageId:'../../etc/passwd'}),null);
 assert.equal(userPart(dir,user,{assetId:'cake'}),null);
 assert.equal((await req('/api/npc/media',Buffer.alloc(12*1024*1024+1))).status,413);
 console.log('PASS upload, retrieval, ownership isolation, file type, size, origin and traversal validation');
 for(const npc of ['xia-xia','molly','yuan-xiaoman']){
  const path='/api/npc/'+npc+'?mode=normal';const turnId=crypto.randomUUID();
  const send=async body=>{const r=await req(path,JSON.stringify({action:'send',...body}),{'Content-Type':'application/json'});assert.equal(r.status,200);return r.json();};
  const a=await send({imageId:media.imageId,text:'看看这张图',turnId});const saved=a.messages.at(-1);assert.equal(saved.part.type,'upload');assert.equal(saved.part.url,media.url);
  const duplicate=await send({imageId:media.imageId,text:'看看这张图',turnId});assert.equal(duplicate.messages.length,a.messages.length);
  const sticker=await send({assetId:'catHelp',text:'救救我',turnId:crypto.randomUUID(),replyTo:saved.id});assert.equal(sticker.messages.at(-1).part.type,'sticker');assert.match(partInput(sticker.messages.at(-1).part),/救救我.*\n.*help咪/);assert.equal(sticker.messages.at(-1).replyTo,saved.id);
  const fresh=await(await req(path)).json();assert.equal(fresh.messages.length,sticker.messages.length);
  assert.equal(imageInputs(dir,user,fresh.messages).length,1);
  assert.equal(imageInputs(dir,crypto.randomUUID(),fresh.messages).length,0);
  console.log('PASS '+npc+' picture/sticker persistence, caption, quote, idempotency and vision attachment ownership');
 }

 const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
 assert.equal(audioExtension(wav),'wav');assert.equal(audioExtension(Buffer.from('<svg>bad</svg>')),null);
 const upload=await req('/api/npc/audio/upload',wav);assert.equal(upload.status,200);const audio=await upload.json();
 assert.equal(audio.text,'你好，今天怎么样');assert.equal((await req(audio.url)).status,200);
 assert.equal((await fetch(origin+audio.url,{headers:{Cookie:'zhiyu_npc='+crypto.randomUUID()}})).status,404);
 assert.equal((await req('/api/npc/audio/upload',wav,{Origin:'http://bad.example'})).status,403);
 assert.equal(userPart(dir,user,{audioId:'../../secret.wav'}),null);
 assert.equal(userPart(dir,crypto.randomUUID(),{audioId:audio.audioId}),null);
 const voicePart=userPart(dir,user,{audioId:audio.audioId,text:'伪造识别结果'});assert.equal(voicePart.text,audio.text);
 for(const npc of ['xia-xia','molly','yuan-xiaoman']){
  const turnId=crypto.randomUUID();const body=JSON.stringify({action:'send',audioId:audio.audioId,turnId});
  const a=await(await req('/api/npc/'+npc+'?mode=normal',body,{'Content-Type':'application/json'})).json();
  assert.equal(a.messages.at(-1).part.type,'voice');assert.equal(a.messages.at(-1).part.text,audio.text);
  const b=await(await req('/api/npc/'+npc+'?mode=normal',body,{'Content-Type':'application/json'})).json();assert.equal(a.messages.length,b.messages.length);
 }
 const translated=await(await req('/api/npc/audio/translate',JSON.stringify({text:'hello',target:'zh'}))).json();assert.equal(translated.text,'zh:hello');
 console.log('PASS voice upload/transcript, cross-user isolation, forged transcript rejection, all NPC persistence and idempotency, translation');
 const db=new DatabaseSync(join(dir,'.npc-runtime/state.sqlite'));
 const row=db.prepare('SELECT id,data FROM sessions LIMIT 1').get();const state=JSON.parse(row.data);const message={id:'voice-fixture',turnId:'fixture',role:'assistant',at:new Date().toISOString(),part:{type:'voice',text:'你好呀',synthetic:true,status:'pending'}};state.messages.push(message);db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(state),row.id);
 const worker=new VoiceQueue(db,dir,async()=>{const latest=JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(row.id).data);latest.messages.push({id:'concurrent',role:'user',part:{type:'text',text:'并发消息'}});db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(latest),row.id);return audio.url;});await worker.tick();worker.stop();
 const saved=JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(row.id).data);assert(saved.messages.some(m=>m.id==='concurrent'));assert.equal(saved.messages.find(m=>m.id==='voice-fixture').part.status,'ready');
 saved.messages.push({...message,id:'failure',part:{...message.part}});db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(saved),row.id);
 const failing=new VoiceQueue(db,dir,async()=>{throw Error('provider failure');});await failing.tick();failing.stop();assert.equal(JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(row.id).data).messages.find(m=>m.id==='failure').part.status,'failed');db.close();
 console.log('PASS NPC speech queue success/failure and preserving concurrent messages (mock provider, no live ASR/TTS)');
}finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
