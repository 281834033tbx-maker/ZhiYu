'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('main process opens only the mobile entry in a separate profile, without launching Electron',async()=>{
  let ready,userData,stops=0;
  const windows=[];
  class FakeWindow extends EventEmitter {
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=handler=>{this.openHandler=handler;};windows.push(this);}
    setWindowButtonVisibility(){}setAspectRatio(value){this.ratio=value;}setMenuBarVisibility(){}center(){}
    loadURL(value){this.url=value;return Promise.resolve();}isDestroyed(){return false;}
  }
  const electron={
    app:{setName(){},setPath(name,value){assert.equal(name,'userData');userData=value;},getPath:name=>name==='appData'?'/fixture/app-data':userData,
      requestSingleInstanceLock:()=>true,on(){},whenReady:()=>({then:callback=>{ready=callback;}}),quit(){}},
    BrowserWindow:FakeWindow,ipcMain:{handle(){}},dialog:{showErrorBox(){throw Error('unexpected startup error');}},
    screen:{getPrimaryDisplay:()=>({workArea:{width:1440,height:1080}})},
    get session(){throw Error('the mobile shell must not read or copy an existing cookie profile');},
  };
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='./image-viewer'?{registerImageViewer:()=>({close(){}})}:name==='./service-runtime'?{
    resolveProject:()=>'/fixture/project',createServiceRuntime:()=>({ensure:async()=>true,stop:()=>{stops++;}}),
  }:require(name),__dirname:'/fixture/project/desktop-mobile',process:{platform:'linux',resourcesPath:'/fixture',on(){}},URL,console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),context);
  await ready();
  assert.equal(userData,'/fixture/app-data/智域手机版');assert.equal(windows.length,1);
  const main=windows[0];assert.equal(main.url,'http://localhost:3100/mobile');
  assert.equal(main.options.width,426);assert.equal(main.options.height,900);assert.equal(main.options.useContentSize,true);
  assert.equal(main.options.frame,false);assert.equal(main.options.webPreferences.nodeIntegration,false);assert.equal(main.options.webPreferences.contextIsolation,true);
  assert.equal(stops,0);
  assert.equal(main.openHandler({url:'https://example.com/'}).action,'deny');
  assert.equal(main.openHandler({url:'http://localhost:3100/task-calendar?npc=chen-nian'}).action,'allow');
  let blocked=false;main.webContents.emit('will-navigate',{preventDefault(){blocked=true;}},'https://example.com/');assert.equal(blocked,true);
  blocked=false;main.webContents.emit('will-navigate',{preventDefault(){blocked=true;}},'http://localhost:3100/mobile#contacts');assert.equal(blocked,false);
});
