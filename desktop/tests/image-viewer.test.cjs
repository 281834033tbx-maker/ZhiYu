const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const handlers=new Map(),windows=[];
let area={x:0,y:0,width:2000,height:1200},saved=null,copied=false,canceled=false;
class FakeWindow extends EventEmitter{
  constructor(options){super();this.options=options;this.bounds={x:20,y:20,width:options.width,height:options.height};this.webContents={send:()=>{},setWindowOpenHandler(){},on(){}};windows.push(this);}
  isDestroyed(){return !!this.destroyed;} isMinimized(){return false;} isFullScreen(){return !!this.fullscreen;}
  isMaximized(){return false;} unmaximize(){} restore(){} show(){} focus(){} center(){}
  setWindowButtonVisibility(value){this.buttons=value;} setMenuBarVisibility(){} loadURL(url){this.url=url;return Promise.resolve();}
  getBounds(){return this.bounds;} setContentSize(width,height){this.bounds={...this.bounds,width,height};}
  setPosition(x,y){this.bounds={...this.bounds,x,y};} setAspectRatio(ratio,extra){this.aspect={ratio,extra};}
  setAlwaysOnTop(value){this.pinned=value;} isAlwaysOnTop(){return !!this.pinned;}
  minimize(){this.minimized=true;} setFullScreen(value){this.fullscreen=value;}
  close(){this.destroyed=true;this.emit('closed');}
}
const nativeImage={createFromBuffer:()=>({isEmpty:()=>false})};
const electron={BrowserWindow:FakeWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
  screen:{getDisplayMatching:()=>({workArea:area})},
  dialog:{showSaveDialog:async()=>({canceled,filePath:'/private/tmp/viewer-test-saved.png'})},
  clipboard:{writeImage:()=>{copied=true;}},nativeImage,
  net:{fetch:async source=>{assert.match(source,/^http:\/\/localhost:3100\/npc\//);return new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'Content-Type':'image/png'}});}}};
const context=vm.createContext({require:name=>name==='electron'?electron:name==='node:fs/promises'?{writeFile:async(name,data)=>{saved={name,data};}}:require(name),module:{exports:{}},Buffer,URL,process});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../image-viewer.js'),'utf8'),context);
const main={webContents:{},bounds:{width:1060,height:720}};
const moduleAPI=context.module.exports;
const api=moduleAPI.registerImageViewer({baseURL:'http://localhost:3100/',preload:'/preload.js',allowedSender:sender=>sender===main.webContents});
const call=(name,event,arg)=>handlers.get('zhiyu:image-'+name)(event,arg);
const event={sender:main.webContents};
const payload={conversationId:'chen-nian',index:0,images:[{id:'a',src:'/npc/a.png',alt:'A'},{id:'b',src:'/npc/b.png',alt:'B'}]};
(async()=>{
  assert.equal(await call('open',{sender:{}},payload),false);
  for(const src of ['file:///etc/passwd','https://evil.example/a.png','/api/auth/session'])assert.equal(await call('open',event,{...payload,images:[{id:'x',src}]}),false);
  assert.equal(await call('open',event,payload),true);
  const viewer=windows[0],owned={sender:viewer.webContents};
  assert.equal(viewer.options.frame,false);assert.equal(viewer.options.webPreferences.nodeIntegration,false);
  assert.equal(call('get',event),null);
  assert.equal(call('fit',event,{id:'a',width:1600,height:900}),false);
  assert.equal(call('fit',owned,{id:'wrong',width:1600,height:900}),false);
  assert.equal(call('fit',owned,{id:'a',width:1600,height:900}),true);
  assert.deepEqual([viewer.bounds.width,viewer.bounds.height],[1500,878]);
  assert.equal(call('history',owned,true),true);
  assert.deepEqual([viewer.bounds.width,viewer.bounds.height],[1500,756]);
  assert.equal(call('pin',owned),true);assert.equal(call('pin',owned),false);
  assert.equal(call('select',owned,-1),false);assert.equal(call('select',owned,2),false);
  assert.equal(call('select',owned,1),true);assert.equal(call('get',owned).images[1].id,'b');
  assert.equal(call('update',event,{...payload,images:[payload.images[1],payload.images[0]]}),true);
  assert.equal(call('get',owned).index,0);
  assert.equal(call('update',event,{...payload,conversationId:'other'}),false);
  assert.equal((await call('copy',owned,new Uint8Array([1]))).ok,undefined);
  assert.equal((await call('copy',owned,new Uint8Array([137,80,78,71,13,10,26,10]))).ok,true);assert.equal(copied,true);
  assert.match((await call('save',owned,'a')).error,/切换/);
  canceled=true;assert.equal((await call('save',owned,'b')).canceled,true);assert.equal(saved,null);
  canceled=false;assert.equal((await call('save',owned,'b')).ok,true);assert.equal(saved.data.length,8);
  assert.equal(call('control',event,'minimize'),false);assert.equal(call('control',owned,'minimize'),true);assert.equal(viewer.minimized,true);
  call('control',owned,'maximize');assert.equal(viewer.fullscreen,true);
  assert.deepEqual(main.bounds,{width:1060,height:720});
  area={x:0,y:0,width:1024,height:768};const size=moduleAPI.imageWindowSize(1600,900,area,true);
  assert.ok(size.width<=768&&size.height<=576);assert.ok(Math.abs((size.width-216)/(size.height-34)-16/9)<.01);
  for(const [width,height] of [[1600,900],[900,1600],[1000,1000],[8000,1000]]){
    for(const history of [false,true]){
      const fit=moduleAPI.imageWindowSize(width,height,area,history);
      assert.ok(fit.width<=area.width*.75&&fit.height<=area.height*.75);
      assert.ok(Math.abs((fit.width-(history?216:0))/(fit.height-34)-width/height)<.1);
    }
  }
  const small=moduleAPI.imageWindowSize(320,240,area);
  assert.deepEqual([small.width,small.height],[320,274]);
  api.close();assert.equal(viewer.isDestroyed(),true);assert.equal(call('get',owned),null);
  console.log('PASS: independent window, source/sender isolation, exact fit, history expansion, navigation, native image copy, save/cancel, pin, own controls, small-screen sizing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
