import assert from 'node:assert/strict';import ts from 'typescript';import {mkdtempSync,readFileSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';
const dir=mkdtempSync(join(tmpdir(),'npc-delivery-'));
try{
 const p=join(dir,'delivery.mjs');writeFileSync(p,ts.transpileModule(readFileSync('lib/npc/delivery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const{scheduleDelivery,deliveryView}=await import(pathToFileURL(p));
 const start=100000;const pending={since:start};
 assert.equal(deliveryView([],pending,start).typingAfter,start+3000);
 assert.equal(deliveryView([],pending,start+2999).typingAfter>start+2999,true);
 assert.equal(deliveryView([],pending,start+3000).typingAfter<=start+3000,true);
 const messages=[{id:'user',role:'user',part:{type:'text',text:'你好'}},{id:'a',role:'assistant',part:{type:'text',text:'第一句'}},{id:'b',role:'assistant',part:{type:'text',text:'第二句'}}];
 scheduleDelivery(messages,1,start,start+4000);
 assert.equal(deliveryView(messages,null,start+4999).messages.length,1);
 assert.equal(deliveryView(messages,null,start+5000).messages.length,2);
 assert.equal(deliveryView(messages,null,start+5000).pending,true);
 assert.ok(messages[2].deliverAt-messages[1].deliverAt>=2200);
 const restored=JSON.parse(JSON.stringify(messages));
 assert.equal(deliveryView(restored,null,start+5100).messages.length,2);
 assert.equal(deliveryView(restored,null,messages[2].deliverAt).messages.length,3);
 assert.equal(deliveryView(restored,null,messages[2].deliverAt).pending,false);
 const interleaved=[{role:'assistant',at:new Date(start+8000).toISOString(),deliverAt:start+8000,part:{type:'text',text:'第二句'}},{role:'user',at:new Date(start+6000).toISOString(),part:{type:'text',text:'插话'}}];
 assert.equal(deliveryView(interleaved,null,start+9000).messages[0].role,'user');
 const slow=[{role:'assistant',part:{type:'text',text:'慢模型第一句'}},{role:'assistant',part:{type:'text',text:'慢模型第二句'}}];
 scheduleDelivery(slow,0,start,start+60000);assert.equal(slow[0].deliverAt,start+60000);assert.ok(slow[1].deliverAt>slow[0].deliverAt);
 assert.equal(deliveryView([{id:'old',role:'assistant',part:{type:'text',text:'历史消息'}}],null,start).messages.length,1);
 console.log('PASS 3-second quiet phase; first message at earliest 5s; sequential delivery; persisted refresh timing; slow model adds no first-message delay; legacy history unchanged');
}finally{rmSync(dir,{recursive:true,force:true});}
