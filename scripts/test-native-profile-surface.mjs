import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const preload=fs.readFileSync('desktop/preload.js','utf8');
function preloadFixture(window){
 const exposures=[],calls=[],listeners=new Map();
 const electron={contextBridge:{exposeInMainWorld:(name,value)=>exposures.push({name,value})},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve(true);},on:(name,fn)=>listeners.set(name,fn),removeListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}}};
 vm.runInNewContext(preload,{require:()=>electron,process:{platform:'darwin',argv:['--zhiyu-native-material']},window});
 return {exposures,calls,listeners};
}
const child=preloadFixture({location:{href:'about:blank'},name:'zhiyu-profile-one-time-id'});
assert.equal(child.exposures.length,0,'inherited preload exposes no bridge in the blank native profile');
const parent=preloadFixture({location:{href:'http://localhost:3100/'},name:''});
assert.equal(parent.exposures.length,1);const bridge=parent.exposures[0].value;
assert.equal(bridge.profilePopoverControl,'native-v1');
await bridge.prepareProfilePopover({anchor:{x:10,y:10,width:40,height:40},width:277.5});await bridge.fitProfilePopover({id:'one',height:800,anchor:{x:10,y:10,width:40,height:40}});await bridge.closeProfilePopover('one');
assert.deepEqual(parent.calls.map(call=>call[0]),['zhiyu:profile-prepare','zhiyu:profile-fit','zhiyu:profile-close']);
const seen=[];const off=bridge.onProfilePopoverClosed(id=>seen.push(id));parent.listeners.get('zhiyu:profile-closed')({}, {id:'one'});assert.deepEqual(seen,['one']);off();assert.equal(parent.listeners.size,0);
const source=fs.readFileSync('app/zhiyu/profile-popover.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,jsxFactory:'fixtureElement'}}).outputText;
function componentFixture(bridge){
 const exports={};
 vm.runInNewContext(compiled,{exports,window:bridge?{zhiyuDesktop:bridge}:{},require:name=>name==='react'?{}:name==='./native-profile-popover'?{default:'NativeProfile'}:{},fixtureElement:(type,props)=>({type,props})});
 const props={title:'Synthetic profile',anchor:{},close(){},className:'',children:'Synthetic profile body'};
 return {exports,props};
}
const browser=componentFixture();assert.equal(browser.exports.default(browser.props).type,browser.exports.AnchoredProfilePopover);
const native=componentFixture(bridge),result=native.exports.default(native.props);assert.equal(result.type,'NativeProfile');assert.equal(result.props.children,'Synthetic profile body');assert.equal(result.props.anchor,native.props.anchor);
assert.equal(result.props.fallback.type,native.exports.AnchoredProfilePopover,'unavailable child retains the original usable web profile');
const photo=native.exports.default({...native.props,className:'zy-self-profile-popover'});assert.equal(photo.type,native.exports.AnchoredProfilePopover,'the photo card keeps its independent gesture surface');
console.log('PASS native profile surface: preload guard, bounded IPC, listener cleanup, native selection and browser/photo fallbacks.');
