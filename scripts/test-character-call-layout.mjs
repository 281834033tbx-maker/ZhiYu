import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real presentation components, synthetic identities/hooks only. No browser,
// account API, device permission, real media, socket or model is contacted.
const jsx=(type,props)=>({type,props:props||{}});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'&&'props'in value?[value,...nodes(value.props.children)]:[];
const fragment=Symbol('fragment');
const ids=['molly','chen-nian','yuan-xiaoman','xia-xia','liu','he-jiawei','zhou-chef'];
const people=ids.map(id=>({id,name:id,nickname:id,gender:id==='chen-nian'?'male':'female',desktopImage:`/npc/${id}/scene.png`,avatar:`/npc/${id}/avatar.png`}));
function load(file,dependencies,globals={}) {
 const sandboxModule={exports:{}};
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{module:sandboxModule,exports:sandboxModule.exports,require:name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},...globals},{filename:file});return sandboxModule.exports;
}
const runtime={'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:fragment}};
const Empty=()=>null,Voice=()=>null,Composer=()=>null,Disclosure=()=>null;
const staticReact={useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:initial=>({current:initial}),useCallback:value=>value,useEffect(){},useSyncExternalStore:(_subscribe,snapshot)=>snapshot()};
const window={location:{search:''}};
const client=load('app/character-window/character-window-client.tsx',{...runtime,react:staticReact,
 '../zhiyu/chat-composer':{default:Composer},'../zhiyu/data':{molly:people[0],allPeople:people.slice(1)},
 '../zhiyu/message-bubbles':{},'../zhiyu/local-character-chat':{localCharacterIds:[]},'../zhiyu/auth-gate':{useAccount:()=>({account:{id:'synthetic-call-owner'}})},
 '../zhiyu/npc-fetch':{},'../zhiyu/he-chat-history':{},'../zhiyu/chef-chat-history':{},'../zhiyu/chat-mute':{useChatMuted:()=>false},
 '../zhiyu/realtime-voice-call':{default:Voice},'./xiaoman-video-scene':{default:Empty},'../../lib/user-facing-errors':{},'./character-window.css':{},
 '../zhiyu/use-continuous-use':{useContinuousUse(){}},'../zhiyu/user-facing-ui':{AiDisclosure:Disclosure},
},{window,URLSearchParams});
for(const id of ids) {
 window.location.search='?npc='+id;
 const session=client.default(),tree=session.type(session.props),all=nodes(tree);
 assert.ok(tree.props.className.includes('has-realtime-layout')&&tree.props.className.includes('is-call-active'),id+' starts in the same full-scene presentation');
 assert.equal(all.filter(node=>node.type===Composer).length,0,id+' does not expose the old bottom white composer');
 const call=all.find(node=>node.type===Voice);assert.ok(call);assert.equal(call.props.character,id);assert.equal(call.props.name,id);assert.equal(call.props.available,id==='yuan-xiaoman');
 assert.ok(all.some(node=>node.type===Disclosure));
 assert.ok(all.find(node=>node.props.className==='zy-character-window-stage').props.children.some(node=>node?.props?.className==='zy-character-call-disclosure'),'AI notice belongs inside the video stage');
 if(id!=='yuan-xiaoman')assert.ok(all.some(node=>node.type==='img'&&node.props.src===`/npc/${id}/scene.png`),'each NPC keeps its own scene asset');
}

const Controls=load('app/zhiyu/realtime-voice-controls.tsx',{...runtime,'./realtime-voice-call.css':{}}).default;
const slots=[],effects=[],timers=[];let cursor=0,devices=0,sockets=0,authorized=0;
const hooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
 useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback:value=>value,useEffect:effect=>effects.push(effect),useReducer:(_reducer,_value,initialize)=>[initialize(),()=>{}],
};
const Timer=()=>null,Preview=()=>null,Captions=()=>null,End=()=>null;
const live=load('app/zhiyu/realtime-voice-call.tsx',{...runtime,react:hooks,
 '../../lib/user-facing-errors':{userFacingError:value=>value},'./realtime-voice-audio':{RealtimePcmPlayer:class{constructor(){assert.fail('No audio player should start during layout tests');}}},
 './realtime-voice-controls':{default:Controls},'../../lib/npc/realtime-call-presentation':{createCallCaptionWindow:()=>({}),callCaptionWindowReducer(){},getCallCaptionFrame:()=>({hidden:true}),callElapsedMs:()=>0},
 './realtime-call-captions':{LocalCameraPreview:Preview,RealtimeCallCaptions:Captions,RealtimeCallEnd:End,RealtimeCallTimer:Timer},'./desktop-bridge':{},'./realtime-voice-call.css':{},
},{window:{},navigator:{mediaDevices:{getUserMedia(){devices++;assert.fail('No actual microphone/camera request');}}},WebSocket:class{constructor(){sockets++;assert.fail('No realtime connection');}},setTimeout:callback=>(timers.push(callback),timers.length),clearTimeout(){},setInterval(){assert.fail('No active call timer without a real ready receipt');},clearInterval(){},DOMException});
const props={name:'合成人物',character:'chen-nian',available:false,authorize:async()=>{authorized++;assert.fail('An unsupported NPC must not initiate call authorization');}};
const render=()=>{cursor=0;effects.length=0;return live.default(props);};
let tree=render();const cleanups=effects.map(effect=>effect()).filter(Boolean);
assert.equal(timers.length,0);assert.equal(devices,0);assert.equal(sockets,0);assert.equal(authorized,0);assert.equal(tree.props['data-call-state'],'unavailable');
assert.equal(nodes(tree).filter(node=>node.type===Timer).length,0,'unsupported calls never display a fabricated connecting/duration timer');
assert.equal(nodes(tree).find(node=>node.type===Captions).props.message.text,'暂不支持语音通话，可在聊天页交流');
const controls=nodes(tree).find(node=>node.type===Controls),buttons=nodes(Controls(controls.props)).filter(node=>node.type==='button');
assert.equal(buttons.find(node=>node.props['data-call-control']==='microphone').props.disabled,true);
assert.equal(buttons.find(node=>node.props['data-call-control']==='microphone').props['aria-pressed'],false);
assert.equal(buttons.find(node=>node.props['data-call-control']==='microphone').props['aria-label'],'麦克风未启用');
assert.equal(buttons.find(node=>node.props['data-call-control']==='camera').props.disabled,true);
assert.ok(!buttons.find(node=>node.props['data-call-control']==='hangup').props.disabled);
await controls.props.onToggleCamera();assert.equal(devices,0);
controls.props.onHangup();tree=render();const end=nodes(tree).find(node=>node.type===End);
assert.equal(end.props.visible,true);assert.equal(end.props.title,'已结束人物互动');assert.equal(end.props.reconnectLabel,'返回人物画面');
await end.props.onReconnect();tree=render();assert.equal(tree.props['data-call-state'],'unavailable');assert.equal(devices,0);assert.equal(sockets,0);
cleanups.forEach(cleanup=>cleanup());
slots.length=0;cursor=0;effects.length=0;timers.length=0;
live.default({...props,character:'yuan-xiaoman',available:true});effects.forEach(effect=>effect());
assert.equal(timers.length,1,'the existing supported Xiaoman entry still defers exactly one automatic start; the fake timer is never run');
assert.equal(devices,0);assert.equal(sockets,0);
const css=readFileSync('app/character-window/character-window.css','utf8');
assert.match(css,/\.zy-character-call-disclosure\s*\{[^}]*background:transparent/);
assert.match(css,/\.zy-character-call-disclosure \.zy-ai-disclosure\s*\{[^}]*color:#fff;[^}]*background:transparent/);
console.log('PASS: seven NPCs share the full-scene shell and in-video white disclosure; own assets and capabilities stay separate; unsupported controls never open devices/socket, hangup is honest, and Xiaoman keeps its deferred start.');
