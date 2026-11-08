import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Real shared call component, a deterministic clock and synthetic audio/WS
// objects only. Never starts a service, device, browser, model or account API.
const jsx=(type,props)=>({type,props:props||{}});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props'in value?[value,...nodes(value.props.children)]:[];
const runtime={'react/jsx-runtime':{jsx,jsxs:jsx}};
function load(file,dependencies={},globals={}) {
 const exports={};
 const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(output,{exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},...globals},{filename:file});return exports;
}
const presentation=load('lib/npc/realtime-call-presentation.ts');
const Controls=load('app/zhiyu/realtime-voice-controls.tsx',{...runtime,'./realtime-voice-call.css':{}}).default;
const Timer=load('app/zhiyu/realtime-call-captions.tsx',{...runtime,react:{},'react-dom':{},'../../lib/npc/realtime-call-presentation':presentation,'./realtime-voice-call.css':{}}).RealtimeCallTimer;
const Captions=()=>null,End=()=>null,Preview=()=>null;
function harness({character='chen-nian',available=false}={}) {
 let clock=10000,cursor=0,tree,nextTimer=0,dirty=false,disposed=false;
 const slots=[],effects=[],scheduled=new Map(),sockets=[];
 const calls={authorization:0,configuration:0,microphonePermission:0,cameraPermission:0,audioContexts:0,media:0,sockets:0,stops:0};
 const hooks={
  useState(initial){const slot=cursor++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return [slots[slot],next=>{const value=typeof next==='function'?next(slots[slot]):next;if(value!==slots[slot]){slots[slot]=value;dirty=true;}}];},
  useRef(initial){const slot=cursor++;return slots[slot]??(slots[slot]={current:initial});},
  useCallback(callback,deps){const slot=cursor++,old=slots[slot];if(!old||deps.some((value,index)=>value!==old.deps[index]))slots[slot]={callback,deps};return slots[slot].callback;},
  useReducer(reducer,arg,initialize){const slot=cursor++;if(!(slot in slots))slots[slot]=initialize?initialize(arg):arg;return [slots[slot],action=>{const value=reducer(slots[slot],action);if(value!==slots[slot]){slots[slot]=value;dirty=true;}}];},
  useEffect(callback,deps){const slot=cursor++,old=slots[slot];if(!old||!deps||deps.some((value,index)=>value!==old.deps?.[index]))effects.push(()=>{old?.cleanup?.();slots[slot]={deps,cleanup:callback()};});},
 };
 const schedule=(callback,delay,interval=false)=>{const id=++nextTimer;scheduled.set(id,{callback,due:clock+delay,delay,interval});return id;};
 const clear=id=>scheduled.delete(id);
 class FakeDate extends Date {static now(){return clock;}}
 class AudioContext {
  constructor(){calls.audioContexts++;this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}
  async resume(){this.state='running';}
  async close(){this.state='closed';}
  createMediaStreamSource(){return {connect(){},disconnect(){}};}
  createGain(){return {gain:{value:0},connect(){},disconnect(){}};}
 }
 class AudioWorkletNode {port={onmessage:null,postMessage(){},close(){}};connect(){}disconnect(){}}
 class WebSocket {
  static OPEN=1;static CONNECTING=0;
  constructor(){calls.sockets++;this.readyState=1;this.bufferedAmount=0;sockets.push(this);}
  send(){}close(){this.readyState=3;}
 }
 const window={location:{href:'http://fixture.invalid/character-window?npc='+character,protocol:'http:'},zhiyuDesktop:{requestMicrophoneAccess:async()=>{calls.microphonePermission++;return 'granted';},requestCameraAccess:async()=>{calls.cameraPermission++;return 'granted';}}};
 const mediaDevices={getUserMedia:async()=>{calls.media++;const track={enabled:true,onended:null,stop(){calls.stops++;}};return {getTracks:()=>[track],getAudioTracks:()=>[track]};}};
 const voice=load('app/zhiyu/realtime-voice-call.tsx',{...runtime,react:hooks,'../../lib/user-facing-errors':{userFacingError:value=>value},
  './realtime-voice-audio':{RealtimePcmPlayer:class{empty=true;dispose(){}interrupt(){}push(){}}},'./realtime-voice-controls':{default:Controls},
  '../../lib/npc/realtime-call-presentation':presentation,'./realtime-call-captions':{LocalCameraPreview:Preview,RealtimeCallCaptions:Captions,RealtimeCallEnd:End,RealtimeCallTimer:Timer},'./desktop-bridge':{},'./realtime-voice-call.css':{},
 },{Date:FakeDate,window,navigator:{mediaDevices},AudioContext,AudioWorkletNode,WebSocket,URL,DOMException,AbortController,
  fetch:async()=>{calls.configuration++;return {ok:true,json:async()=>({configured:true})};},
  setTimeout:(callback,delay)=>schedule(callback,delay),clearTimeout:clear,setInterval:(callback,delay)=>schedule(callback,delay,true),clearInterval:clear,
 });
 const props={name:'合成人物',character,available,authorize:async()=>{calls.authorization++;return true;}};
 const render=()=>{let loops=0;do{assert.ok(++loops<12,'effects settle');dirty=false;cursor=0;tree=voice.default(props);for(const effect of effects.splice(0))effect();}while(dirty);return tree;};
 const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));render();};
 const advance=async milliseconds=>{
  const end=clock+milliseconds;let iterations=0;
  for(;;){const due=[...scheduled].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!due)break;assert.ok(++iterations<5000,'finite fake timer queue');
   const [id,timer]=due;clock=timer.due;if(timer.interval)timer.due+=timer.delay;else scheduled.delete(id);timer.callback();await settle();}
  clock=end;render();
 };
 const find=type=>nodes(tree).find(node=>node.type===type);
 const timer=()=>find(Timer);
 const displayed=()=>nodes(Timer(timer().props)).filter(node=>node.type==='span').at(-1).props.children;
 const message=value=>{assert.ok(sockets.at(-1)?.onmessage);sockets.at(-1).onmessage({data:JSON.stringify(value)});render();};
 const dispose=()=>{if(disposed)return;disposed=true;for(const slot of slots)slot?.cleanup?.();};
 render();return {render,settle,advance,find,timer,displayed,message,dispose,calls,tree:()=>tree,sockets,scheduled};
}

for(const character of ['molly','chen-nian','xia-xia','liu','he-jiawei','zhou-chef']) {
 const h=harness({character});
 assert.equal(h.displayed(),'00:00');assert.equal(h.timer().props.connecting,false);assert.equal(h.timer().props.connected,false);
 assert.equal(Timer(h.timer().props).props['aria-label'],'人物互动时长 00:00');
 await h.advance(2000);assert.equal(h.displayed(),'00:02',character+' counts from opening without voice readiness');assert.equal(h.tree().props['data-voice-elapsed-ms'],0);
 const control=h.find(Controls);assert.equal(control.props.microphoneReady,false);assert.equal(control.props.cameraAvailable,false);
 await control.props.onToggleCamera();control.props.onToggleMute();assert.ok(Object.values(h.calls).every(value=>value===0),'unsupported scenes request no auth/config/device/audio/WS');
 control.props.onHangup();h.render();assert.equal(h.find(End).props.elapsedMs,2000);assert.match(h.find(End).props.title,/人物互动.*00:02/u);
 await h.advance(5000);assert.equal(h.find(End).props.elapsedMs,2000,'hangup freezes interaction duration');assert.equal(h.timer(),undefined);
 h.find(End).props.onReconnect();h.render();assert.equal(h.displayed(),'00:00','return to scene starts a fresh interaction');await h.advance(1000);assert.equal(h.displayed(),'00:01');
 assert.ok(Object.values(h.calls).every(value=>value===0));h.dispose();assert.equal(h.scheduled.size,0);
}

const live=harness({character:'yuan-xiaoman',available:true});
assert.equal(live.displayed(),'00:00');assert.equal(live.timer().props.connecting,true);assert.equal(live.calls.authorization,0,'the original deferred auto-start remains deferred');
await live.advance(0);assert.equal(live.tree().props['data-call-state'],'connecting');assert.equal(live.calls.authorization,1,'one authorization');assert.equal(live.calls.configuration,1,'one configuration read');assert.equal(live.calls.media,1,'one fake media stream');assert.equal(live.calls.sockets,1,'one fake socket');
await live.advance(3500);assert.equal(live.displayed(),'00:03','connecting time already appears in the interaction clock');assert.equal(live.tree().props['data-voice-elapsed-ms'],0);
live.message({type:'ready',inputSampleRate:16000,outputSampleRate:24000,channels:1,format:'pcm_s16le'});
assert.equal(live.timer().props.connected,true);assert.equal(live.tree().props['data-voice-elapsed-ms'],0,'ready starts only the independent voice duration');
await live.advance(2000);assert.equal(live.displayed(),'00:05');assert.equal(live.tree().props['data-voice-elapsed-ms'],2000);
live.find(Controls).props.onHangup();live.render();assert.equal(live.find(End).props.elapsedMs,5500);assert.equal(live.tree().props['data-voice-elapsed-ms'],2000);
await live.advance(10000);assert.equal(live.find(End).props.elapsedMs,5500);assert.equal(live.tree().props['data-voice-elapsed-ms'],2000);
live.find(End).props.onReconnect();await live.settle();assert.equal(live.displayed(),'00:00');assert.equal(live.tree().props['data-voice-elapsed-ms'],0);assert.equal(live.calls.authorization,2,'explicit redial creates one fresh authorized fake session');
await live.advance(1000);assert.equal(live.displayed(),'00:01');assert.equal(live.timer().props.connected,false);
live.message({type:'ready'});await live.advance(1000);live.message({type:'error',message:'Synthetic voice error'});
const voiceAtFailure=live.tree().props['data-voice-elapsed-ms'];assert.equal(voiceAtFailure,1000);assert.equal(live.timer().props.connected,false);
await live.advance(2000);assert.equal(live.displayed(),'00:04','an open error scene remains an interaction until hangup');assert.equal(live.tree().props['data-voice-elapsed-ms'],voiceAtFailure,'actual voice duration stays frozen after its failure');
live.find(Controls).props.onHangup();live.render();await live.advance(1000);assert.equal(live.find(End).props.elapsedMs,4000);assert.equal(live.tree().props['data-voice-elapsed-ms'],voiceAtFailure,'hanging up after an error does not extend already-ended voice time');live.dispose();
const remoteEnd=harness({character:'yuan-xiaoman',available:true});await remoteEnd.advance(0);await remoteEnd.advance(1000);remoteEnd.message({type:'ready'});await remoteEnd.advance(2000);remoteEnd.message({type:'ended'});await remoteEnd.advance(3000);
assert.equal(remoteEnd.find(End).props.elapsedMs,3000);assert.equal(remoteEnd.tree().props['data-voice-elapsed-ms'],2000);remoteEnd.dispose();

const css=readFileSync('app/zhiyu/realtime-voice-call.css','utf8');
const disc=/\.zy-call-control-disc\s*\{([^}]*)\}/u.exec(css)[1];
assert.match(disc,/width:64px/);assert.match(disc,/height:64px/);assert.match(disc,/border-radius:50%/);
assert.match(css,/\.zy-call-controls\s*\{[^}]*column-gap:56px/u);assert.match(css,/\.zy-call-control\.is-hangup \.zy-call-control-disc\s*\{[^}]*background:#f04b4b/u);
console.log('PASS: seven shared scenes count interaction seconds from opening; ready-only voice timing stays separate; hangup/server end freeze, return/redial reset, unsupported devices remain untouched; three 64px discs are circular with original layout/colors. Synthetic clock/media only.');
