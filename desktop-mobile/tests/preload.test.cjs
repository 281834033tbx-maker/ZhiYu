'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('mobile preload advertises the native preview without modifying the desktop profile',()=>{
  let name,bridge;
  const context=vm.createContext({process:{platform:'darwin',argv:[]},require:moduleName=>{
    assert.equal(moduleName,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>{name=key;bridge=value;}},ipcRenderer:{}};
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../preload.js'),'utf8'),context);
  assert.equal(name,'zhiyuDesktop');assert.equal(bridge.mobilePreview,true);assert.equal(bridge.platform,'darwin');
  assert.equal(typeof bridge.openImageViewer,'function');assert.equal(typeof bridge.openCharacterWindow,'function');
});
