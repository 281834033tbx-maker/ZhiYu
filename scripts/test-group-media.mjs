import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomUUID,createHash } from 'node:crypto';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

// Actual upload/audio/group middleware and stores; disposable owner/files/DB and fake ASR/model only.
const runtime=isolatedNpcRuntime(),close=new EventEmitter(),handlers=[],owner=randomUUID(),other=randomUUID();
const now=Date.parse('2026-10-16T02:00:00Z'),origin='http://127.0.0.1:38101';
const fake={config:{root:runtime.root},httpServer:close,middlewares:{use(path,handler){handlers.push({path,handler});}}};
const request=(path,body,options={})=>new Promise((resolve,reject)=>{
  const bytes=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const req=Readable.from(bytes?[bytes]:[]);req.url=path;req.method=body===undefined?'GET':'POST';
  req.headers={host:'127.0.0.1:38101',origin,'content-type':'application/json',cookie:`zhiyu_npc=${options.owner || owner}`,...options.headers};
  const headers={};const res={statusCode:200,writableEnded:false,setHeader(key,value){headers[key.toLowerCase()]=value;},end(value){this.writableEnded=true;try{resolve({status:this.statusCode,headers,data:headers['content-type']?.startsWith('application/json')?JSON.parse(value):Buffer.from(value || '')});}catch(error){reject(error);}}};
  const entry=handlers.find(entry=>path.startsWith(entry.path));if(!entry)return reject(new Error('No matching middleware'));
  req.url=path.slice(entry.path.length)||'/';entry.handler(req,res);
});
let db;
try {
  const {npcMedia}=await runtime.load('server/npc/media');
  const {npcAudio}=await runtime.load('server/npc/audio');
  const {groupChatsLocal,groupStoreFor}=await runtime.load('server/npc/groups-plugin');
  const {generateGroupDialogue}=await runtime.load('server/npc/group-dialogue');
  const {assets}=await runtime.load('lib/npc/contracts');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhZkAAAAASUVORK5CYII=','base64');
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const contexts=[];let transcriptions=0;
  npcMedia().configureServer(fake);
  npcAudio({transcribe:async()=>{transcriptions++;return '我海鲜过敏，今天准备做饭';},translate:async()=>{throw new Error('Unexpected translation');}}).configureServer(fake);
  groupChatsLocal({automatic:false,now:()=>now,namer:async()=> '合成媒体测试群',dialogue:async(_root,context)=>{
    contexts.push(structuredClone(context));return {messages:context.kind==='opening'?[{senderId:'molly',text:'老大，测试群已就位',mentionIds:[]}]:[{senderId:'zhou-chef',text:'先看看你发来的内容。',mentionIds:[]}]};
  }}).configureServer(fake);
  const store=groupStoreFor(runtime.root);
  const created=await request('/api/npc/groups',{action:'create',requestId:randomUUID(),sourceCharacterId:'molly',goal:'合成媒体问答',memberIds:['zhou-chef','liu'],self:{name:'合成用户'}});
  assert.equal(created.status,200);const groupId=created.data.group.id;await store.run(owner,groupId);
  const image=await request('/api/npc/media',png,{headers:{'content-type':'image/png'}});assert.equal(image.status,200);
  const animated=await request('/api/npc/media',gif,{headers:{'content-type':'image/gif'}});assert.equal(animated.status,200);
  const secondImage=await request('/api/npc/media',png,{headers:{'content-type':'image/png'}});assert.equal(secondImage.status,200);
  assert.equal((await request(image.data.url)).status,200);
  assert.equal((await request(image.data.url,undefined,{owner:other})).status,404);
  const send=(payload,options)=>request('/api/npc/groups',{action:'send',groupId,text:'',mentionIds:['zhou-chef'],requestId:randomUUID(),...payload},options);
  const imageRequestId=randomUUID();
  const sent=await send({imageId:image.data.imageId,requestId:imageRequestId});assert.equal(sent.status,200);
  const imageMessage=sent.data.group.messages.at(-1);assert.equal(imageMessage.type,'image');assert.equal(imageMessage.part.type,'upload');assert.deepEqual(imageMessage.mentionIds,['zhou-chef']);assert.equal(imageMessage.text,'');
  const repeated=await send({imageId:image.data.imageId,requestId:imageRequestId});assert.equal(repeated.status,200);assert.equal(repeated.data.group.messages.length,sent.data.group.messages.length);
  assert.equal((await send({imageId:secondImage.data.imageId,requestId:imageRequestId})).status,409);
  assert.equal((await send({imageId:image.data.imageId,imageUrl:'https://forged.invalid/image.png'})).status,400);
  assert.equal((await send({imageId:'../../etc/passwd'})).status,400);
  assert.equal((await send({imageId:image.data.imageId},{owner:other})).status,400);
  assert.equal((await send({imageId:image.data.imageId,assetId:'catHelp'})).status,400);
  await store.run(owner,groupId);const imageContext=contexts.at(-1);
  assert.equal(imageContext.images.length,1);assert.ok(imageContext.images[0].startsWith(join(runtime.root,'.npc-runtime/uploads',owner)));
  assert.deepEqual(imageContext.imageMessageIds,[imageMessage.id]);
  const stages=[];
  const actual=await generateGroupDialogue(runtime.root,imageContext,async(_root,prompt,images)=>{
    stages.push({prompt,images});assert.deepEqual(images,imageContext.images,'actual vision files must reach generation, repair and review');
    if(prompt.startsWith('你是智域群聊发言路由器'))return groupParticipationFixture(['zhou-chef']);
    if(prompt.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};
    return {messages:[{senderId:'zhou-chef',text:'这张图我看到了，需要我帮你看哪一处？',mentionIds:[]}]};
  });
  assert.equal(actual.messages[0].senderId,'zhou-chef');assert.equal(stages.length,3);
  assert.ok(stages.every(stage=>stage.prompt.includes(imageMessage.id)));
  const noMention={...imageContext,incoming:{...imageContext.incoming,mentionIds:[]}};let routed=false;
  await generateGroupDialogue(runtime.root,noMention,async(_root,prompt,images)=>{
    assert.deepEqual(images,imageContext.images);
    if(prompt.startsWith('你是智域群聊发言路由器')){routed=true;return groupParticipationFixture(['zhou-chef']);}
    if(prompt.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};
    return {messages:[{senderId:'zhou-chef',text:'你是想让我看图里的哪一处？',mentionIds:[]}]};
  });assert.ok(routed,'routing can actually inspect a media-only unmentioned turn');
  const quoted=await send({text:'看刚才这张',replyTo:imageMessage.id});assert.equal(quoted.status,200);await store.run(owner,groupId);assert.deepEqual(contexts.at(-1).images,imageContext.images);
  const sentGif=await send({imageId:animated.data.imageId});assert.equal(sentGif.status,200);await store.run(owner,groupId);assert.ok(contexts.at(-1).images[0].endsWith('.gif'));
  const stickerFile=join(runtime.root,'public',assets.catHelp.url);mkdirSync(dirname(stickerFile),{recursive:true});writeFileSync(stickerFile,png);
  const sticker=await send({assetId:'catHelp'});assert.equal(sticker.status,200);assert.equal(sticker.data.group.messages.at(-1).part.type,'sticker');await store.run(owner,groupId);assert.deepEqual(contexts.at(-1).images,[stickerFile]);
  assert.equal((await send({assetId:'cake'})).status,400,'an unrelated built-in photo cannot masquerade as a user sticker');
  const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.write('WAVE',8);
  const audio=await request('/api/npc/audio/upload',wav,{headers:{'content-type':'audio/wav','x-zhiyu-audio-duration':'3'}});
  assert.equal(audio.status,200);assert.equal(transcriptions,1);
  assert.equal((await request(audio.data.url)).status,200);assert.equal((await request(audio.data.url,undefined,{owner:other})).status,404);
  assert.equal((await send({audioId:audio.data.audioId,audioText:'伪造的识别结果'})).status,400);
  assert.equal((await send({audioId:audio.data.audioId,text:'混合文字'})).status,400);
  const voice=await send({audioId:audio.data.audioId});assert.equal(voice.status,200);
  const voiceMessage=voice.data.group.messages.at(-1);assert.equal(voiceMessage.type,'voice');assert.equal(voiceMessage.text,'我海鲜过敏，今天准备做饭');assert.equal(voiceMessage.part.url,audio.data.url);assert.equal(voiceMessage.part.durationSeconds,3);assert.deepEqual(voiceMessage.mentionIds,['zhou-chef']);
  await store.run(owner,groupId);const voiceContext=contexts.at(-1);assert.deepEqual(voiceContext.images,[]);
  assert.ok(voiceContext.facts.facts.some(fact=>fact.key==='food_allergy'&&fact.value==='海鲜'));
  await generateGroupDialogue(runtime.root,voiceContext,async(_root,prompt,images)=>{
    assert.deepEqual(images,[]);assert.ok(prompt.includes('语音转写，可能有识别误差'),'voice input remains explicitly a potentially imperfect transcript');
    if(prompt.startsWith('你是智域群聊发言路由器'))return groupParticipationFixture(['zhou-chef']);
    assert.ok(/不(?:感知|表示已听出)声线/.test(prompt),'generation and review cannot infer vocal qualities from a transcript');
    if(prompt.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};
    return {messages:[{senderId:'zhou-chef',text:'海鲜先避开，准备做哪道菜？',mentionIds:[]}]};
  });
  const textRequestId=randomUUID(), textSent=await send({text:'普通旧协议文本',requestId:textRequestId});assert.equal(textSent.status,200);
  db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'),{readOnly:true});
  const savedJob=JSON.parse(db.prepare('SELECT data FROM npc_group_jobs WHERE owner=? AND group_id=? AND request_id=?').get(owner,groupId,textRequestId).data);
  assert.equal(savedJob.inputHash,createHash('sha256').update(JSON.stringify({text:'普通旧协议文本',mentions:['zhou-chef']})).digest('hex'),'old text-only idempotency hash stays byte-for-byte compatible');
  const persisted=await request('/api/npc/groups');assert.equal(persisted.status,200);assert.ok(persisted.data.groups[0].messages.some(message=>message.id===voiceMessage.id&&message.part.url===audio.data.url));
  console.log('PASS real temporary media/audio/group middleware: image/GIF/sticker upload, owner isolation, server-only ASR text, media-only @, save/reload, conflict/tamper rejection, unchanged text hash, current/quoted vision files in routing/generation/review and voice-text boundaries. Fake ASR/model only; production operations 0.');
} finally {db?.close();close.emit('close');runtime.cleanup();}
