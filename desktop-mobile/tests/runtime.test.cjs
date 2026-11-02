'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const path = require('node:path');
const {resolveProject, resolveNode, probeService, createServiceRuntime} = require('../service-runtime');

test('packaged project resolves alongside the new preview App', () => {
  const project='/fixture/智域';
  const resourcesPath=path.join(project,'desktop-mobile/dist/mac-arm64/智域手机版.app/Contents/Resources');
  assert.equal(resolveProject({resourcesPath,dirname:'/unavailable',env:{},exists:p=>p===path.join(project,'node_modules/vinext/dist/cli.js')}),project);
  assert.equal(resolveProject({resourcesPath:'/missing',dirname:'/missing',env:{},exists:()=>false}),null);
  assert.equal(resolveNode({project,homedir:'/fixture/user',env:{},exists:p=>p==='/fixture/user/.local/bin/node'}),'/fixture/user/.local/bin/node');
});

function fakeGet({status=200,body='{"authenticated":false}',error}={}) {
  return (url,callback) => {
    assert.equal(url.href,'http://localhost:3100/api/auth/session');
    const request=new EventEmitter(); request.setTimeout=()=>{}; request.destroy=()=>{};
    queueMicrotask(()=>{
      if(error){request.emit('error',Object.assign(new Error('fixture'),{code:error}));return;}
      const response=new EventEmitter(); response.statusCode=status;response.resume=()=>{};response.setEncoding=()=>{};
      callback(response);response.emit('data',body);response.emit('end');
    });
    return request;
  };
}
test('anonymous health probe rejects arbitrary listeners without using any profile', async()=>{
  assert.equal(await probeService('http://localhost:3100/',fakeGet()),'ready');
  assert.equal(await probeService('http://localhost:3100/',fakeGet({status:500})),'occupied');
  assert.equal(await probeService('http://localhost:3100/',fakeGet({body:'<html>another application</html>'})),'occupied');
  assert.equal(await probeService('http://localhost:3100/',fakeGet({error:'ECONNREFUSED'})),'offline');
});

function fixture(statuses) {
  const spawned=[],killed=[];
  let clock=0,index=0;
  const runtime=createServiceRuntime({project:'/fixture/project',baseURL:'http://localhost:3100/',logDirectory:'/fixture/profile',env:{PATH:'/fixture/bin'},
    probe:async()=>statuses[Math.min(index++,statuses.length-1)],now:()=>clock,pause:async ms=>{clock+=ms;},timeout:1600,
    makeDirectory(){},openLog:()=>11,closeLog(){},killGroup:(pid,signal)=>killed.push({pid,signal}),
    spawnProcess:(command,args,options)=>{const child=new EventEmitter();Object.assign(child,{pid:4411,exitCode:null,killed:false,kill:signal=>killed.push({pid:4411,signal})});spawned.push({command,args,options,child});return child;},
  });
  return {runtime,spawned,killed};
}
test('existing healthy or occupied service is never spawned over or stopped',async()=>{
  const ready=fixture(['ready']);assert.equal(await ready.runtime.ensure(),true);ready.runtime.stop();
  assert.equal(ready.spawned.length,0);assert.equal(ready.killed.length,0);
  const occupied=fixture(['occupied']);assert.equal(await occupied.runtime.ensure(),false);occupied.runtime.stop();
  assert.equal(occupied.spawned.length,0);assert.equal(occupied.killed.length,0);
});
test('only the directly owned child can be stopped, once',async()=>{
  const owned=fixture(['offline','ready']);assert.equal(await owned.runtime.ensure(),true);
  assert.equal(owned.spawned.length,1);const child=owned.spawned[0];
  assert.equal(child.options.cwd,'/fixture/project');assert.equal(child.options.detached,true);
  assert.deepEqual(child.args,['/fixture/project/node_modules/vinext/dist/cli.js','dev','--host','127.0.0.1','--port','3100','--strictPort']);
  owned.runtime.stop();owned.runtime.stop();assert.deepEqual(owned.killed,[{pid:-4411,signal:'SIGTERM'}]);
});
test('exited child does not leave a stale process-group kill target',async()=>{
  const owned=fixture(['offline','ready']);await owned.runtime.ensure();
  owned.spawned[0].child.emit('exit',1);owned.runtime.stop();assert.equal(owned.killed.length,0);
});
