'use strict';
/* eslint-disable typescript/no-require-imports, unicorn/no-thenable -- Native CommonJS VM fixtures intentionally stub Electron's deferred app.whenReady(). */
// VM doubles only: no Electron GUI, media device, user profile, IPC or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'../..');

async function fixture(platform='darwin') {
  const handlers=new Map(),permissionHandlers={},asks=[],external=[];
  let status='not-determined',answer=true,askFailure=false;
  const mediaSession={
    setPermissionRequestHandler(value){permissionHandlers.request=value;},
    setPermissionCheckHandler(value){permissionHandlers.check=value;},
  };
  class FakeWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.size=[options.width,options.height];this.webContents={
      session:mediaSession,send(){},getURL:()=>this.url||'',mainFrame:{url:''},
    };}
    getBounds(){return {x:0,y:0,width:this.size[0],height:this.size[1]};}
    getSize(){return this.size;}getContentSize(){return this.size;}
    setContentSize(width,height){this.size=[width,height];this.emit('resize');}
    setBounds(bounds){this.size=[bounds.width,bounds.height];this.emit('resize');}
    setMinimumSize(){}setAspectRatio(ratio,extra){this.aspect={ratio,extra};}
    setWindowButtonVisibility(value){this.buttons=value;}setMenuBarVisibility(){}center(){}show(){}focus(){}
    isDestroyed(){return !!this.destroyed;}isMinimized(){return false;}isFullScreen(){return false;}
    loadURL(value){this.url=value;this.webContents.mainFrame.url=value;return Promise.resolve();}
    close(){this.destroyed=true;this.emit('closed');}
  }
  const main=new FakeWindow({width:1194,height:870});
  await main.loadURL('http://localhost:3100/');
  const electron={app:{on(){},requestSingleInstanceLock:()=>true,whenReady:()=>({then(){}})},BrowserWindow:FakeWindow,session:{},dialog:{},
    ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},screen:{getDisplayMatching:()=>({workArea:{width:1440,height:1080}})},
    shell:{openExternal:async value=>{external.push(value);}},
    systemPreferences:{getMediaAccessStatus:type=>{assert.equal(type,'camera');return status;},askForMediaAccess:async type=>{
      assert.equal(type,'camera');asks.push(type);if(askFailure)throw Error('synthetic unavailable permission');return answer;
    }},
  };
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='./image-viewer'?{registerImageViewer:()=>({close(){}})}:name==='./local-identity.cjs'?{resolveLocalIdentity:()=>'synthetic-desktop-owner'}
    :name==='./window-recovery.cjs'?{attachWindowRecovery:win=>({load:url=>win.loadURL(url),dispose(){},recover(){}})}
    :name==='./service-supervisor.cjs'?require('../service-supervisor.cjs'):require(name),
    __dirname:path.join(root,'desktop'),process:{...process,platform,on(){},resourcesPath:root,env:{...process.env,ZHIYU_PROJECT:root}},
    console,URL,setTimeout,clearTimeout,__testMain:main,
  });
  vm.runInContext(fs.readFileSync(path.join(root,'desktop/main.js'),'utf8')+
    '\nmainWindow=__testMain;globalThis.getCharacter=()=>characterWindow;',context);
  await handlers.get('zhiyu:character-open')({sender:main.webContents},'yuan-xiaoman');
  const character=context.getCharacter(),contents=character.webContents;
  const event={sender:contents,senderFrame:contents.mainFrame};
  const details={isMainFrame:true,requestingUrl:character.url,securityOrigin:'http://localhost:3100'};
  const request=(webContents=contents,permission='media',override={})=>{
    let result;permissionHandlers.request(webContents,permission,value=>{result=value;},{...details,mediaTypes:['video'],...override});return result;
  };
  const check=(webContents=contents,permission='media',override={},origin='http://localhost:3100')=>
    permissionHandlers.check(webContents,permission,origin,{...details,mediaType:'video',...override});
  return {handlers,main,character,event,details,request,check,asks,external,
    status:value=>{status=value;},answer:value=>{answer=value;},failAsk:()=>{askFailure=true;}};
}

void test('native camera IPC is limited to the current trusted Xiaoman main frame',async()=>{
  const f=await fixture(),request=f.handlers.get('zhiyu:camera-request');
  assert.equal(await request({sender:{}}),'denied');
  assert.equal(await request({sender:f.main.webContents,senderFrame:f.main.webContents.mainFrame}),'denied');
  assert.equal(await request({sender:f.event.sender}),'denied');
  assert.equal(await request({...f.event,senderFrame:{url:f.character.url}}),'denied','same-origin subframes are not the main frame');
  assert.equal(f.asks.length,0);
  assert.equal(await request(f.event),'granted');assert.deepEqual(f.asks,['camera']);
  f.status('granted');assert.equal(await request(f.event),'granted');assert.equal(f.asks.length,1);
  f.status('denied');assert.equal(await request(f.event),'denied');assert.equal(f.asks.length,1);
  f.status('restricted');assert.equal(await request(f.event),'restricted');assert.equal(f.asks.length,1);
  f.status('not-determined');f.answer(false);assert.equal(await request(f.event),'denied');
  f.failAsk();assert.equal(await request(f.event),'unknown');
  await f.character.loadURL('https://example.com/character-window?npc=yuan-xiaoman');
  assert.equal(await request(f.event),'denied','a navigated character window cannot prompt');
  await f.character.loadURL('http://localhost:3100/character-window?npc=liu');
  assert.equal(await request(f.event),'denied','a different NPC does not acquire camera access');
});

void test('session permissions preserve normal audio and allow only local main-frame camera preview',async()=>{
  const f=await fixture(),mainURL=f.main.url;
  assert.equal(f.request(),true);assert.equal(f.check(),true);
  assert.equal(f.request(undefined,'media',{mediaTypes:['audio','video']}),true);
  assert.equal(f.request(undefined,'media',{mediaTypes:['audio']}),true);
  assert.equal(f.request(f.main.webContents,'media',{requestingUrl:mainURL,mediaTypes:['audio']}),true);
  assert.equal(f.check(f.main.webContents,'media',{requestingUrl:mainURL,mediaType:'audio'}),true);
  assert.equal(f.request(f.main.webContents,'media',{requestingUrl:mainURL}),false,'main chat cannot capture video');
  assert.equal(f.check(f.main.webContents,'media',{requestingUrl:mainURL}),false);
  for(const mediaTypes of [[],undefined,['unknown'],['screen'],['audio','screen']])
    assert.equal(f.request(undefined,'media',{mediaTypes}),false);
  for(const permission of ['display-capture','hid','usb','serial','geolocation','clipboard-read']) {
    assert.equal(f.request(undefined,permission),false);assert.equal(f.check(undefined,permission),false);
  }
  assert.equal(f.request(undefined,'clipboard-sanitized-write'),true,'existing explicit Copy remains available');
  assert.equal(f.check(undefined,'clipboard-sanitized-write'),true);
  assert.equal(f.request(undefined,'media',{isMainFrame:false}),false);
  assert.equal(f.check(undefined,'media',{isMainFrame:false}),false);
  assert.equal(f.request(undefined,'media',{requestingUrl:'https://example.com/'}),false);
  assert.equal(f.request(undefined,'media',{securityOrigin:'https://example.com'}),false);
  assert.equal(f.check(undefined,'media',{},'https://example.com'),false);
  assert.equal(f.check(undefined,'media',{mediaType:'unknown'}),false);
  assert.equal(f.request(null),false);assert.equal(f.check(null),false);
  await f.character.loadURL('https://example.com/');
  assert.equal(f.request(),false);assert.equal(f.check(),false);
});

void test('camera settings open only fixed platform targets and never arbitrary URLs',async()=>{
  for(const [platform,target] of [['darwin','x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'],['win32','ms-settings:privacy-webcam'],['linux',null]]) {
    const f=await fixture(platform),settings=f.handlers.get('zhiyu:camera-settings');
    assert.equal(await settings({sender:f.main.webContents,senderFrame:f.main.webContents.mainFrame}),false);
    assert.equal(await settings(f.event,'https://example.com/'),!!target);
    assert.deepEqual(f.external,target?[target]:[]);
    if(platform!=='darwin'){assert.equal(await f.handlers.get('zhiyu:camera-request')(f.event),'unknown');assert.equal(f.asks.length,0);}
  }
});

void test('preload exposes bounded camera IPC and package declares the native camera purpose',async()=>{
  let bridge;const invoked=[];
  vm.runInNewContext(fs.readFileSync(path.join(root,'desktop/preload.js'),'utf8'),{
    process:{platform:'darwin',argv:[]},require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'zhiyuDesktop');bridge=value;}},
      ipcRenderer:{invoke:async(...values)=>{invoked.push(values);return true;}}}),
  });
  await bridge.requestCameraAccess();await bridge.openCameraSettings('https://example.com/');
  assert.deepEqual(invoked,[['zhiyu:camera-request'],['zhiyu:camera-settings']]);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'desktop/package.json'),'utf8'));
  assert.equal(pkg.build.mac.extendInfo.NSCameraUsageDescription,'智域需要使用摄像头，在视频通话时显示你自己的画面');
});
