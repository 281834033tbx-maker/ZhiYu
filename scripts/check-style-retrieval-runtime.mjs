import assert from 'node:assert/strict';import {readFileSync,writeFileSync}from'node:fs';import {DatabaseSync}from'node:sqlite';
const origin='http://localhost:3100',user=crypto.randomUUID(),cookie=`zhiyu_npc=${user}`,started=Date.now();
const endpoint=origin+'/api/npc/yuan-xiaoman';let done=false;
try{
 const r=await fetch(endpoint,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',turnId:crypto.randomUUID(),text:'珍吧 我说珍你知道是啥么'})});assert.equal(r.status,200);
 for(let i=0;i<150;i++){
  await new Promise(r=>setTimeout(r,1000));const state=await(await fetch(endpoint,{headers:{Cookie:cookie}})).json();
  if(state.deliveryError)throw Error(state.deliveryError);
  if(!state.pending&&state.messages.some(m=>m.role==='assistant')){
   const trace=JSON.parse(readFileSync('.npc-runtime/humanizer-last-loaded.json','utf8'));assert.ok(Date.parse(trace.at)>=started);
   const reviewed=JSON.parse(readFileSync('.npc-runtime/humanizer-last-reviewed.json','utf8'));assert.ok(Date.parse(reviewed.at)>=started);assert.equal(reviewed.pid,trace.pid);assert.equal(trace.version,'humanizer-npc-density-c48');assert.equal(reviewed.version,trace.version);
   const retrieval=JSON.parse(readFileSync('.npc-runtime/style-retrieval-last.json','utf8'));assert.ok(Date.parse(retrieval.at)>=started);assert.equal(retrieval.pid,trace.pid);assert.ok(retrieval.selectedIds.includes('TRIAL-clarify'));
   const result={retrieval,checkedAt:new Date().toISOString(),syntheticOnly:true,trace,reviewed,reply:state.messages.filter(m=>m.role==='assistant').map(m=>m.part)};
   writeFileSync('output/style-retrieval-runtime-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));done=true;break;
  }
 }
 assert.ok(done,'No completed reply before timeout');
}finally{if(done){const db=new DatabaseSync('.npc-runtime/state.sqlite');db.prepare('DELETE FROM yuan_sessions WHERE id=?').run(user+':yuan-xiaoman');db.close();}}
