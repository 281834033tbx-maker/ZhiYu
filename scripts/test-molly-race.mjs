import assert from 'node:assert/strict';import ts from 'typescript';
import {mkdtempSync,readFileSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';import{createServer,request}from'node:http';
const dir=mkdtempSync(join(tmpdir(),'molly-race-'));let server;
try{
for(const [folder,name]of[['lib/npc','molly'],['server/npc','molly-prompt'],['server/npc','molly-plugin'],['server/npc','codex']]){
const src=readFileSync(`${folder}/${name}.ts`,'utf8').replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(molly|molly-prompt|codex)'/g,"'./$1.mjs'");writeFileSync(join(dir,name+'.mjs'),ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {mollyLocal}=await import(pathToFileURL(join(dir,'molly-plugin.mjs')));let handler;
server=createServer((req,res)=>handler(req,res));mollyLocal({available:()=>false,generate:async()=>{throw Error('not used')}}).configureServer({config:{root:dir},middlewares:{use:(_,h)=>handler=h},httpServer:server});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;const first=await fetch(origin);const cookie=first.headers.get('set-cookie').split(';')[0];
const post=async body=>{const r=await fetch(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
for(const action of ['typing','read']){
const body=JSON.stringify(action==='typing'?{action,clientId:crypto.randomUUID(),sequence:1,active:false}:{action,ids:[]});
let slow;const done=new Promise(resolve=>{slow=request(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',resolve)});slow.write(body.slice(0,5));});
await new Promise(r=>setTimeout(r,60));
const sent=await post({action:'send',text:'must survive '+action,turnId:crypto.randomUUID()});
slow.end(body.slice(5));await done;
const fresh=await(await fetch(origin,{headers:{Cookie:cookie}})).json();
assert.equal(fresh.messages.length,sent.messages.length);assert.ok(fresh.revision>sent.revision);assert.equal(fresh.messages.at(-1).part.text,'must survive '+action);
console.log('PASS delayed '+action+' request cannot overwrite new message or queue');
}
const final=await(await fetch(origin,{headers:{Cookie:cookie}})).json();assert.equal(final.messages.filter(m=>m.role==='user').length,2);
const quoted=await post({action:'send',text:'引用这句',turnId:crypto.randomUUID(),replyTo:final.messages[0].id});assert.equal(quoted.messages.at(-1).replyTo,final.messages[0].id);
const bad=await fetch(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',text:'无效引用',turnId:crypto.randomUUID(),replyTo:'other-session-id'})});assert.equal(bad.status,400);console.log('PASS quote persisted and cross-session quote rejected');
}finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
