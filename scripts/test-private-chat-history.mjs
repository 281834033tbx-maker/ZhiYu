import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Disposable runtime, synthetic cookies, injected outputs; no production database or model.
const runtime=isolatedNpcRuntime();
const cases=[
 {character:'xia-xia',module:'plugin',factory:'npcLocal',table:'sessions',suffix:'xia-xia:normal'},
 {character:'yuan-xiaoman',module:'yuan-plugin',factory:'yuanLocal',table:'yuan_sessions',suffix:'yuan-xiaoman'},
 {character:'liu',module:'liu-plugin',factory:'liuLocal',table:'liu_sessions',suffix:'liu'},
 {character:'chen-nian',module:'chen-plugin',factory:'chenLocal',table:'chen_sessions',suffix:'chen-nian'},
 {character:'molly',module:'molly-plugin',factory:'mollyLocal',table:'molly_sessions',suffix:'molly-system-secretary'},
 {character:'he-jiawei',module:'he-plugin',factory:'heLocal',table:'he_sessions',suffix:'he-jiawei'},
];
const report={passed:false,storage:[],races:[]};
let db;
const closers=new Set();
function fixture(plugin,deps,character) {
 const close=new EventEmitter();let handler;
 plugin(deps).configureServer({config:{root:runtime.root},httpServer:close,middlewares:{use:(_path,value)=>{handler=value;}}});
 const stop=()=>{close.emit('close');closers.delete(stop);};closers.add(stop);
 const request=(method,owner,body,mode='normal',options={})=>new Promise((resolve,reject)=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/?mode='+mode;
  req.headers={host:'127.0.0.1:3101',origin:'http://127.0.0.1:3101',cookie:'zhiyu_npc='+owner,...options.headers};
  const res={statusCode:200,writableEnded:false,setHeader(){},end(raw){this.writableEnded=true;try{resolve({status:this.statusCode,data:JSON.parse(raw)});}catch(e){reject(e);}}};
  handler(req,res);
 });
 return {stop,request,character};
}
const stateRow=(table,id)=>JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id).data);
const put=(table,id,state)=>{
 if(table==='sessions')db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(state.revision,JSON.stringify(state),id);
 else db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state),id);
};
const messages=()=>[
 {id:randomUUID(),turnId:randomUUID(),role:'user',at:new Date(0).toISOString(),part:{type:'text',text:'合成旧消息'},origin:'chat'},
 {id:randomUUID(),turnId:randomUUID(),role:'assistant',at:new Date(Date.now()+60000).toISOString(),deliverAt:Date.now()+60000,part:{type:'text',text:'合成尚未送达消息'},origin:'chat'},
];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});
 db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));
 for(const item of cases){
  const plugin=(await runtime.load('server/npc/'+item.module))[item.factory];
  const deps={available:()=>false,generate:async()=>{throw Error('Must not call a model');}};
  let api=fixture(plugin,deps,item.character);
  const owner=randomUUID(),other=randomUUID(),id=owner+':'+item.suffix;
  assert.equal((await api.request('GET',owner)).status,200);
  await api.request('GET',other);
  const otherId=other+':'+item.suffix,otherState=stateRow(item.table,otherId);
  otherState.messages=[messages()[0]];put(item.table,otherId,otherState);
  const initial=stateRow(item.table,id);initial.messages=messages();initial.pending={id:randomUUID(),since:Date.now()};
  if(initial.queue)initial.queue=[initial.messages[0].turnId];
  if(initial.life){initial.life.queue=[initial.messages[0].turnId];initial.life.lastError='旧错误';}
  if(initial.error!==undefined)initial.error='旧错误';
  if(initial.showerFollowUp!==undefined)initial.showerFollowUp={dueAt:Date.now()+60000,sourceTurnId:'old-turn',activity:'洗澡'};
  const preserved={messages:structuredClone(initial.messages),values:structuredClone(initial.values),memories:structuredClone(initial.memories)};
  put(item.table,id,initial);
  const denied=await api.request('POST',owner,{action:'clear'},'normal',{headers:{origin:'http://example.invalid'}});
  assert.equal(denied.status,403,'untrusted origin cannot clear');
  assert.equal(stateRow(item.table,id).privateHistoryHiddenIds,undefined,'rejected clear cannot mutate');
  const cleared=await api.request('POST',owner,{action:'clear'});
  assert.equal(cleared.status,200,item.character);assert.deepEqual(cleared.data.messages,[]);assert.equal(cleared.data.pending,false);
  const saved=stateRow(item.table,id);
  assert.deepEqual(saved.messages,preserved.messages);assert.deepEqual(saved.values,preserved.values);assert.deepEqual(saved.memories,preserved.memories);
  assert.equal(saved.pending,null);assert.deepEqual(saved.queue||saved.life.queue,[]);
  assert.deepEqual(new Set(saved.privateHistoryHiddenIds),new Set(preserved.messages.map(message=>message.id)));
  if('showerFollowUp'in saved)assert.equal(saved.showerFollowUp,null);
  assert.deepEqual((await api.request('GET',owner)).data.messages,[]);
  assert.equal(stateRow(item.table,otherId).privateHistoryHiddenIds,undefined,'other account remains unchanged');
  assert.deepEqual(stateRow(item.table,otherId).messages,otherState.messages);
  api.stop();api=fixture(plugin,deps,item.character);
  assert.deepEqual((await api.request('GET',owner)).data.messages,[],'clear survives runtime restart');
  const sent=await api.request('POST',owner,{action:'send',text:'清空后新的合成消息',turnId:randomUUID()});
  assert.equal(sent.status,200);assert.deepEqual(sent.data.messages.map(message=>message.part.text),['清空后新的合成消息']);
  assert.deepEqual((await api.request('GET',owner)).data.messages.map(message=>message.part.text),['清空后新的合成消息']);
  const again=await api.request('POST',owner,{action:'clear'});assert.deepEqual(again.data.messages,[]);
  assert.equal(stateRow(item.table,id).messages.length,3,'all original and new source records retained');
  api.stop();report.storage.push({character:item.character,passed:true});
 }
 for(const item of cases){
  const plugin=(await runtime.load('server/npc/'+item.module))[item.factory];
  for(const failure of [false,true]){
   let resolveModel,rejectModel,startedResolve;
   const started=new Promise(resolve=>{startedResolve=resolve;});
   const generation=new Promise((resolve,reject)=>{resolveModel=resolve;rejectModel=reject;});
   const api=fixture(plugin,{available:()=>true,generate:async()=>{startedResolve();return generation;}},item.character);
   const owner=randomUUID(),mode=item.character==='xia-xia'?'test':'normal';
   const sending=api.request('POST',owner,{action:'send',text:'合成正在生成的消息',turnId:randomUUID()},mode);
   const began=await Promise.race([started.then(()=>true),pause(2500).then(()=>false)]);
   assert.ok(began,`${item.character} generation must have started`);
   const cleared=await api.request('POST',owner,{action:'clear'},mode);assert.equal(cleared.status,200);
   if(failure)rejectModel(Error('Synthetic model error after clearing'));
   else resolveModel(item.character==='molly'?{intent:'chat',messages:['合成迟到回复'],address:null,query:null}:{action:'reply',messages:[{type:'text',text:'合成迟到回复'}],event:null,memories:[]});
   await sending;await pause(60);
   const after=await api.request('GET',owner,undefined,mode);
   assert.deepEqual(after.data.messages,[]);assert.equal(after.data.pending,false);assert.equal(after.data.deliveryError,'');
   api.stop();report.races.push({character:item.character,failure,passed:true});
  }
 }
 report.passed=true;
 mkdirSync('output/private-chat-settings-20261008',{recursive:true});
 writeFileSync('output/private-chat-settings-20261008/backend-verification.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
} finally {for(const stop of Array.from(closers))stop();db?.close();runtime.cleanup();}
