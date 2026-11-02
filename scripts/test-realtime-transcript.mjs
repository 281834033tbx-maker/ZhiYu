import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Only synthetic text and in-memory WebSocket doubles are used. No device,
// running service, user recording, account DB, credentials or model is opened.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'zhiyu-realtime-transcript-'));
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let call;
try {
  writeFileSync(join(temporary,'transcript.mjs'),compile(readFileSync(join(root,'lib/npc/realtime-transcript.ts'),'utf8')));
  const {RealtimeInputTranscriptAssembler,upsertRealtimeCaption}=await import(pathToFileURL(join(temporary,'transcript.mjs')));
  const input=new RealtimeInputTranscriptAssembler(undefined,'auto');
  assert.equal(input.start('cumulative','start-1').fresh,true);
  assert.equal(input.start('cumulative','start-1').fresh,false,'repeated start does not interrupt twice');
  for(const [index,text] of ['我','我想','我想和你','我想和你聊聊天'].entries()) {
    assert.equal(input.update({kind:'delta',itemId:'cumulative',eventId:`partial-${index}`,text}).text,index===1?'我我想':text,'three hypotheses establish cumulative mode; a single overlap still appends');
  }
  assert.equal(input.update({kind:'complete',itemId:'cumulative'}).text,'我想和你聊聊天','an ending without transcript retains the corrected partial');
  assert.equal(input.update({kind:'complete',itemId:'cumulative'}),undefined,'a final is emitted only once');
  assert.equal(input.update({kind:'delta',itemId:'cumulative',text:'旧识别结果'}),undefined,'a late partial cannot reopen a final');

  input.start('revision');
  input.update({kind:'delta',itemId:'revision',text:'我'});
  input.update({kind:'delta',itemId:'revision',text:'我想'});
  input.update({kind:'delta',itemId:'revision',text:'我想喝水'});
  assert.equal(input.update({kind:'delta',itemId:'revision',text:'我想和你聊聊'}).text,'我想和你聊聊','Chinese hypothesis corrections replace established snapshot deltas');
  const mixed=new RealtimeInputTranscriptAssembler();
  mixed.start('mixed-fragments');
  for(const text of ['我','我想','我想喝'])mixed.update({kind:'delta',itemId:'mixed-fragments',text});
  assert.equal(mixed.update({kind:'delta',itemId:'mixed-fragments',text:'水'}).text,'我想喝水','an unrelated short delta appends without erasing the corrected cumulative sentence');
  for(const text of ['再','再喝'])mixed.update({kind:'delta',itemId:'mixed-fragments',text});
  assert.equal(mixed.update({kind:'delta',itemId:'mixed-fragments',text:'再喝一口'}).text,'我想喝水再喝一口','after falling back, a new three-hypothesis chain can be recognized while preserving the prior sentence');
  input.start('explicit-snapshot');
  input.update({kind:'snapshot',itemId:'explicit-snapshot',text:'今天想去公圆'});
  assert.equal(input.update({kind:'snapshot',itemId:'explicit-snapshot',text:'今天想去公园'}).text,'今天想去公园','explicit snapshot text is authoritative even without a shared growing prefix');
  assert.equal(input.update({kind:'complete',itemId:'explicit-snapshot',text:'今天想去公园。'}).text,'今天想去公园。');

  input.start('pure-delta');
  for(const [index,text] of ['我想','和你','聊聊天'].entries())input.update({kind:'delta',itemId:'pure-delta',eventId:`delta-${index}`,text});
  assert.equal(input.update({kind:'complete',itemId:'pure-delta'}).text,'我想和你聊聊天','true delta packets still concatenate');
  input.start('replayed-event');
  const packet={kind:'delta',itemId:'replayed-event',eventId:'same-event',text:'不要'};
  input.update(packet);assert.equal(input.update(packet),undefined,'an identical event replay is ignored');
  assert.equal(input.update({...packet,eventId:'different-event'}).text,'不要不要','equal words in distinct events are genuine repetition');
  assert.equal(input.update({...packet,text:'停'}).text,'不要不要停','a reused trace ID with different payload is not dropped');
  input.start('laughter');input.update({kind:'delta',itemId:'laughter',text:'哈'});
  assert.equal(input.update({kind:'delta',itemId:'laughter',text:'哈'}).text,'哈哈','short equal fragments are not deduplicated by text');
  assert.equal(input.update({kind:'complete',itemId:'laughter',text:'哈哈，不要不要。'}).text,'哈哈，不要不要。','final text preserves intentional repetitions verbatim');
  const strictInput=new RealtimeInputTranscriptAssembler(undefined,'incremental');
  strictInput.start('intentional-overlap');strictInput.update({kind:'delta',itemId:'intentional-overlap',text:'不要'});
  assert.equal(strictInput.update({kind:'delta',itemId:'intentional-overlap',text:'不要这样'}).text,'不要不要这样','documented deltas preserve genuine prefix-overlapping repetition');
  const conservative=new RealtimeInputTranscriptAssembler();
  conservative.start('overlap');conservative.update({kind:'delta',itemId:'overlap',text:'不要'});
  assert.equal(conservative.update({kind:'delta',itemId:'overlap',text:'不要这样'}).text,'不要不要这样','one prefix extension cannot switch conservative auto into snapshots');
  conservative.start('single-token-loop');
  for(const text of ['哈','哈哈','哈哈哈'])conservative.update({kind:'delta',itemId:'single-token-loop',text});
  assert.equal(conservative.update({kind:'complete',itemId:'single-token-loop'}).text,'哈哈哈哈哈哈','single-character loops cannot establish cumulative mode');
  conservative.start('word-loop');
  for(const text of ['ha','haha','hahaha'])conservative.update({kind:'delta',itemId:'word-loop',text});
  assert.equal(conservative.update({kind:'complete',itemId:'word-loop'}).text,['ha','haha','hahaha'].join(''),'same-token loops also remain real repeated fragments');
  strictInput.start('three-real-prefixes');
  for(const text of ['我','我想','我想和'])strictInput.update({kind:'delta',itemId:'three-real-prefixes',text});
  assert.equal(strictInput.update({kind:'complete',itemId:'three-real-prefixes'}).text,'我我想我想和','explicit incremental mode preserves even an inherently ambiguous three-prefix utterance');
  const first=input.update({kind:'complete',itemId:'same-words-first',text:'你好'});
  const second=input.update({kind:'complete',itemId:'same-words-second',text:'你好'});
  assert.notEqual(first.turnId,second.turnId);assert.equal(first.text,second.text,'different turns may contain the same words');
  input.start('older-turn');input.update({kind:'delta',itemId:'older-turn',text:'前一句'});
  input.start('current-turn');input.update({kind:'delta',itemId:'current-turn',text:'后一句'});
  assert.equal(input.update({kind:'complete',itemId:'older-turn'}).text,'前一句','late completion uses its own item rather than the next sentence');
  assert.equal(input.currentTurnId,'current-turn','late completion does not replace the active input turn');
  input.fail('current-turn');assert.equal(input.update({kind:'delta',itemId:'current-turn',text:'迟到的失败片段'}),undefined);

  let captions=[];
  const partial={id:'user-one',role:'user',text:'我',final:false};
  captions=upsertRealtimeCaption(captions,partial);
  captions=upsertRealtimeCaption(captions,{...partial,text:'我想和你聊聊'});
  assert.equal(captions.length,1);assert.equal(captions[0].text,'我想和你聊聊','client updates a row with complete snapshots');
  captions=upsertRealtimeCaption(captions,{...partial,text:'我想和你聊聊',final:true});
  assert.equal(upsertRealtimeCaption(captions,{...partial,text:'我想和你聊聊',final:true}),captions);
  assert.equal(upsertRealtimeCaption(captions,{...partial,text:'旧partial'}),captions);
  captions=upsertRealtimeCaption(captions,{...partial,id:'user-two',text:'我想和你聊聊',final:true});
  assert.equal(captions.length,2,'identical speech in another turn stays visible');
  captions=upsertRealtimeCaption(captions,{id:'assistant-one',role:'assistant',text:'已听到',final:true,interrupted:true});
  assert.equal(upsertRealtimeCaption(captions,{id:'assistant-one',role:'assistant',text:'迟到回复',final:true}),captions);
  console.log('PASS pure transcript: cumulative partials, Chinese revisions, real deltas/repetitions, event replay, per-turn finals and caption ordering.');

  writeFileSync(join(temporary,'fake-ws.mjs'),`import {EventEmitter} from 'node:events';
export default class FakeSocket extends EventEmitter {
  static OPEN=1; static CLOSED=3; static instances=[];
  constructor(url){super();this.readyState=url==='client'?1:0;this.bufferedAmount=0;this.sent=[];if(url!=='client')FakeSocket.instances.push(this);}
  send(data,options){this.sent.push(typeof data==='string'?JSON.parse(data):data);if(typeof options==='function')options();}
  close(){this.readyState=3;this.emit('close');} terminate(){this.readyState=3;} ping(){}
}
export class WebSocketServer {}`);
  writeFileSync(join(temporary,'settings.mjs'),'export const readRealtimeSpeechConfig=()=>null;');
  writeFileSync(join(temporary,'voice.mjs'),'export class RealtimeVoiceConfigError extends Error {} export const readXiaomanRealtimeVoiceSettings=(_root,voice)=>({voice,speed:0});');
  writeFileSync(join(temporary,'budget.mjs'),'export const REALTIME_INITIAL_PAYLOAD_BYTES=131072,REALTIME_PROVIDER_CONTEXT_TOKENS=65536; export const realtimeHistoryBudget=()=>10000;export const realtimeInstructions=(role,style)=>role+style;');
  const gateway=compile(readFileSync(join(root,'server/npc/realtime-speech-gateway.ts'),'utf8'))
    .replace("from 'ws'","from './fake-ws.mjs'")
    .replace("from './realtime-speech-settings'","from './settings.mjs'")
    .replace("from './realtime-speech-voice'","from './voice.mjs'")
    .replace("from './realtime-speech-budget'","from './budget.mjs'")
    .replace("from '../../lib/npc/realtime-transcript'","from './transcript.mjs'");
  writeFileSync(join(temporary,'gateway.mjs'),gateway+'\nexport {attachCall};');
  const {default:FakeSocket}=await import(pathToFileURL(join(temporary,'fake-ws.mjs')));
  const {attachCall}=await import(pathToFileURL(join(temporary,'gateway.mjs')));
  const client=new FakeSocket('client'),journal=[];
  call=attachCall(client,temporary,'synthetic-owner',{apiKey:'synthetic-not-a-credential',voice:'synthetic-voice'},
    {loadContext:()=>({botName:'合成人物',systemRole:'synthetic context',speakingStyle:'synthetic style'}),recordEvent:(_root,_owner,_call,event)=>{journal.push(event);}},()=>{});
  client.emit('message',Buffer.from(JSON.stringify({type:'start',character:'yuan-xiaoman'})),false);
  await flush();
  const upstream=FakeSocket.instances[0];assert.ok(upstream,'only an in-memory socket was created');
  upstream.readyState=FakeSocket.OPEN;upstream.emit('open');
  const provider=event=>upstream.emit('message',Buffer.from(JSON.stringify(event)),false);
  provider({type:'session.created'});
  provider({type:'conversation.item.input_audio_transcription.started',item_id:'gateway-turn'});
  const phrases=['我','我想','我想和','我想和你聊骚'];
  for(const [index,delta] of phrases.entries())provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-turn',event_id:`gateway-${index}`,delta});
  provider({type:'conversation.item.input_audio_transcription.completed',item_id:'gateway-turn'});
  provider({type:'conversation.item.input_audio_transcription.completed',item_id:'gateway-turn'});
  provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-turn',delta:'迟到旧文本'});
  await flush();
  const received=client.sent.filter(event=>event.type==='transcript'&&event.role==='user'&&event.turnId==='gateway-turn');
  assert.deepEqual(received.map(event=>event.text),[phrases[0],phrases[0]+phrases[1],phrases[2],phrases[3],phrases[3]]);
  assert.equal(journal.filter(event=>event.type==='transcript'&&event.turnId==='gateway-turn').length,1,'only one final reaches transcript persistence');
  assert.equal(journal.find(event=>event.type==='transcript').text,phrases.at(-1));
  provider({type:'conversation.item.input_audio_transcription.started',item_id:'gateway-repeat'});
  for(const event_id of ['repeat-a','repeat-b'])provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-repeat',event_id,delta:'不要'});
  provider({type:'conversation.item.input_audio_transcription.completed',item_id:'gateway-repeat'});
  provider({type:'conversation.item.input_audio_transcription.started',item_id:'gateway-snapshot'});
  provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-snapshot',text:'去公圆'});
  provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-snapshot',text:'去公园'});
  provider({type:'conversation.item.input_audio_transcription.completed',item_id:'gateway-snapshot'});
  await flush();
  assert.equal(journal.find(event=>event.turnId==='gateway-repeat'&&event.type==='transcript').text,'不要不要');
  assert.equal(journal.find(event=>event.turnId==='gateway-snapshot'&&event.type==='transcript').text,'去公园');
  provider({type:'conversation.item.input_audio_transcription.started',item_id:'gateway-overlap'});
  for(const delta of ['不要','不要这样'])provider({type:'conversation.item.input_audio_transcription.delta',item_id:'gateway-overlap',delta});
  provider({type:'conversation.item.input_audio_transcription.completed',item_id:'gateway-overlap'});
  await flush();
  assert.equal(journal.find(event=>event.turnId==='gateway-overlap'&&event.type==='transcript').text,'不要不要这样','the provider requires more than one prefix overlap');
  const audioPackets=upstream.sent.filter(event=>event.type==='input_audio_buffer.append').length;
  client.emit('message',Buffer.alloc(640),true);
  assert.equal(upstream.sent.filter(event=>event.type==='input_audio_buffer.append').length,audioPackets+1,'one PCM input still uploads exactly once');
  console.log('PASS gateway fixture: no prefix duplication, one final journal event, late-partial rejection, real repetition, explicit snapshots and unchanged single PCM upload.');
} finally {
  call?.dispose();
  rmSync(temporary,{recursive:true,force:true});
}
