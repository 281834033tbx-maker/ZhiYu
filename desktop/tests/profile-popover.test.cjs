'use strict';
/* oxlint-disable typescript/no-require-imports -- Electron's native test boundary is CommonJS. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {registerProfilePopover,profileBounds,validAnchor}=require('../profile-popover.cjs');
function fixture(){
 const handlers=new Map(),events=[],children=[];
 class FakeWindow extends EventEmitter{
  constructor(bounds={x:200,y:150,width:700,height:450}){super();this.bounds=bounds;this.visible=false;this.webContents=new EventEmitter();this.webContents.mainFrame={url:'http://localhost:3100/'};this.webContents.getZoomFactor=()=>this.zoom||1;this.webContents.setZoomFactor=value=>{this.zoom=value;};this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;};this.webContents.send=(channel,value)=>events.push({channel,value});}
  getBounds(){return this.bounds;}getContentBounds(){return this.bounds;}setBounds(bounds){this.bounds={...bounds};}isDestroyed(){return !!this.destroyed;}isVisible(){return this.visible;}show(){this.visible=true;}focus(){this.focused=true;}close(){if(!this.destroyed){this.destroyed=true;this.emit('closed');}}
 }
 const parent=new FakeWindow(),area={x:0,y:24,width:1440,height:1000};
 const controller=registerProfilePopover({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},screen:{getDisplayMatching:()=>({workArea:area})},baseURL:'http://localhost:3100/',getParent:()=>parent,allowExistingWindow:details=>details.url==='http://localhost:3100/task-calendar?npc=chen-nian'&&details.frameName==='zhiyu-task-calendar-frosted'});controller.attach(parent);
 const event={sender:parent.webContents,senderFrame:parent.webContents.mainFrame};
 const call=(name,value,source=event)=>handlers.get('zhiyu:profile-'+name)(source,value);
 const prepare=()=>call('prepare',{anchor:{x:350,y:60,width:48,height:48},width:277.5});
 const create=token=>{const child=new FakeWindow();children.push(child);parent.webContents.emit('did-create-window',child,{url:'about:blank',frameName:token.name});return child;};
 return {parent,area,events,controller,call,prepare,create,event,children};
}
test('IPC preparation, fit and close accept only the original same-origin main frame',()=>{
 const f=fixture(),payload={anchor:{x:20,y:20,width:30,height:30}};
 assert.equal(f.call('prepare',payload,{sender:{},senderFrame:f.event.senderFrame}),null);
 assert.equal(f.call('prepare',payload,{sender:f.event.sender,senderFrame:{url:'http://localhost:3100/'}}),null);
 f.event.senderFrame.url='https://other.example/';assert.equal(f.call('prepare',payload),null);
 f.event.senderFrame.url='http://localhost:3100/character-window';assert.equal(f.call('prepare',payload),null);
 f.event.senderFrame.url='http://localhost:3100/';
 for(const anchor of [null,{x:0,y:0,width:0,height:10},{x:NaN,y:0,width:20,height:20}])assert.equal(f.call('prepare',{anchor}),null);
 assert.equal(validAnchor(payload.anchor),true);f.controller.close();
});
test('a one-shot nonce admits only the prepared about:blank child, preserving only explicit existing App windows',()=>{
 const f=fixture(),token=f.prepare();
 assert.equal(f.parent.openHandler({url:'about:blank',frameName:'zhiyu-profile-other'}).action,'deny');
 assert.equal(f.parent.openHandler({url:'https://other.example',frameName:token.name}).action,'deny');
 const request={url:'about:blank',frameName:token.name},allowed=f.parent.openHandler(request);
 assert.equal(allowed.action,'allow');assert.equal(f.parent.openHandler(request).action,'deny','nonce cannot be reused even before did-create-window');
 const o=allowed.overrideBrowserWindowOptions;
 assert.equal(o.parent,f.parent);assert.equal(o.transparent,true);assert.equal(o.frame,false);assert.equal(o.show,false);assert.equal(o.resizable,false);assert.equal(o.webPreferences.nodeIntegration,false);assert.equal(o.webPreferences.contextIsolation,true);assert.equal(o.webPreferences.webSecurity,true);assert.equal(o.webPreferences.sandbox,true);assert.equal(o.webPreferences.preload,'');
 assert.equal(f.parent.openHandler({url:'http://localhost:3100/task-calendar?npc=chen-nian',frameName:'zhiyu-task-calendar-frosted'}).action,'allow');
 assert.equal(f.parent.openHandler({url:'http://localhost:3100/unrelated',frameName:'other'}).action,'deny');
 const child=f.create(token);assert.equal(child.openHandler({url:'https://other.example'}).action,'deny');
 let prevented=0;child.webContents.emit('will-navigate',{preventDefault(){prevented++;}});child.webContents.emit('will-redirect',{preventDefault(){prevented++;}});assert.equal(prevented,2);
 const orphan=f.create({name:'zhiyu-profile-orphan'});assert.equal(orphan.destroyed,true);f.controller.close();
});
test('natural content can exceed the parent height, with scrolling required only at the screen boundary',()=>{
 const f=fixture(),token=f.prepare();f.parent.openHandler({url:'about:blank',frameName:token.name});const child=f.create(token);
 const fit=f.call('fit',{id:token.id,anchor:{x:350,y:60,width:48,height:48},height:800});
 assert.ok(fit.height>f.parent.bounds.height);assert.ok(child.bounds.y+child.bounds.height>f.parent.bounds.y+f.parent.bounds.height);
 assert.ok(child.bounds.y>=f.area.y);assert.ok(child.bounds.y+child.bounds.height<=f.area.y+f.area.height);assert.equal(child.visible,true);assert.equal(child.focused,true);
 const capped=f.call('fit',{id:token.id,anchor:{x:350,y:60,width:48,height:48},height:12000});assert.equal(capped.height,f.area.height-16);
 assert.equal(f.call('fit',{id:'wrong',anchor:{x:350,y:60,width:48,height:48},height:200}),null);
 assert.equal(f.call('fit',{id:token.id,anchor:{x:350,y:60,width:48,height:48},height:Infinity}),null);
 f.controller.close();
});
test('main-window motion/zoom reanchors the child; minimize, navigation, crash and close clean it up',()=>{
 for(const reason of ['minimize','navigation','crash','closed']){
  const f=fixture(),token=f.prepare();f.parent.openHandler({url:'about:blank',frameName:token.name});const child=f.create(token);
  f.call('fit',{id:token.id,anchor:{x:350,y:60,width:48,height:48},height:300});const oldX=child.bounds.x;
  f.parent.bounds={...f.parent.bounds,x:250};f.parent.emit('move');assert.equal(child.bounds.x,oldX+50);
  f.parent.zoom=1.25;f.parent.emit('resize');assert.equal(child.zoom,1.25);assert.equal(child.bounds.width,Math.ceil(301.5*1.25));
  if(reason==='navigation')f.parent.webContents.emit('did-start-navigation',{},'http://localhost:3100/',false,true);
  else if(reason==='crash')child.webContents.emit('render-process-gone');else f.parent.emit(reason);
  assert.equal(child.destroyed,true,reason);assert.ok(f.events.some(e=>e.channel==='zhiyu:profile-closed'&&e.value.id===token.id));f.controller.close();
 }
});
test('blur requests the existing close animation; nonce-scoped explicit close cannot close another card',()=>{
 const f=fixture(),token=f.prepare();f.parent.openHandler({url:'about:blank',frameName:token.name});const child=f.create(token);child.emit('blur');
 assert.ok(f.events.some(e=>e.channel==='zhiyu:profile-dismiss'&&e.value.id===token.id));assert.equal(child.destroyed,undefined);
 assert.equal(f.call('close','other'),false);assert.equal(child.destroyed,undefined);
 assert.equal(f.call('close',token.id),true);assert.equal(child.destroyed,true);assert.equal(f.call('close',token.id),false);f.controller.close();
});
test('placement handles negative monitor origins and zoom without changing parent geometry',()=>{
 const parent={x:-1400,y:100,width:800,height:420},area={x:-1600,y:24,width:1600,height:1000};
 const before=JSON.stringify(parent),result=profileBounds(parent,{x:60,y:70,width:40,height:40},277.5,850,area,1.25);
 assert.ok(result.bounds.x>=area.x);assert.ok(result.bounds.x+result.bounds.width<=area.x+area.width);assert.ok(result.bounds.y>=area.y);assert.ok(result.bounds.y+result.bounds.height<=area.y+area.height);assert.equal(JSON.stringify(parent),before);assert.ok(Number.isFinite(result.layout.anchorX));
});
