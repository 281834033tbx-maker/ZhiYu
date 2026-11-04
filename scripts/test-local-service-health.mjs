import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual middleware without importing auth, user DBs or model plugins.
const source=readFileSync('server/npc/local-service-health.ts','utf8');
const exports={};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:createRequire(import.meta.url),process:{pid:73123}});
function mount(){let handler;exports.localServiceHealth().configureServer({middlewares:{use:(path,value)=>{assert.equal(path,'/api/desktop/health');handler=value;}}});return handler;}
function request(handler,method='GET',url='/'){
  let body;const headers={};const res={statusCode:200,setHeader:(k,v)=>{headers[k]=v;},end:value=>{body=JSON.parse(value);}};
  handler({method,url},res);return {status:res.statusCode,headers,body};
}
const handler=mount(),first=request(handler),next=request(handler);
assert.equal(first.status,200);assert.equal(first.headers['Cache-Control'],'no-store');
assert.equal(first.body.service,'zhiyu-local');assert.equal(first.body.ok,true);assert.equal(first.body.pid,73123);
assert.match(first.body.instanceId,/^[\da-f-]{36}$/);assert.equal(first.body.instanceId,next.body.instanceId);
assert.notEqual(first.body.instanceId,request(mount()).body.instanceId);
assert.deepEqual(Object.keys(first.body).sort(),['instanceId','ok','pid','service']);
assert.equal(request(handler,'POST').status,405);assert.equal(request(handler,'GET','/other').status,404);
console.log('PASS: service identity is cheap, boot-scoped, GET-only, exact-path and contains no user data.');
