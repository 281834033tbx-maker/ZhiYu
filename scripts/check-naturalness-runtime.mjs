// Dedicated synthetic identity; never load another user's session.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const origin='http://localhost:3100',user=randomUUID(),cookie=`zhiyu_npc=${user}`,endpoint=origin+'/api/npc/yuan-xiaoman';
const start=Date.now();let done=false;
try {
 const res=await fetch(endpoint,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',turnId:randomUUID(),text:'今天下楼拿快递，到了楼下才发现手机忘带了，又爬回来拿哈哈'})});assert.equal(res.status,200);
 for(let i=0;i<240;i++){
  await new Promise(r=>setTimeout(r,1000));
  const state=await(await fetch(endpoint,{headers:{Cookie:cookie}})).json();
  if(state.deliveryError)throw Error(state.deliveryError);
  if(!state.pending&&state.messages.some(m=>m.role==='assistant')){
   const expected=createHash('sha256').update(readFileSync('npc-skills/references/conversation-realism.md')).digest('hex');
   // Get only this synthetic session's job identifier; no other session data.
   const db=new DatabaseSync('.npc-runtime/state.sqlite',{readOnly:true});
   const row=db.prepare('SELECT data FROM yuan_sessions WHERE id=?').get(user+':yuan-xiaoman');db.close();
   const all=JSON.parse(row.data);const jobs=new Set(all.messages.map(m=>m.turnId));
   const trace=readdirSync('.npc-runtime/skill-traces').map(f=>JSON.parse(readFileSync('.npc-runtime/skill-traces/'+f,'utf8'))).find(t=>Date.parse(t.startedAt)>=start&&jobs.has(t.requestId)&&t.status==='complete');
   assert.ok(trace);assert.equal(trace.version,'npc-conversation-realism-20260919');assert.equal(trace.rules['conversation-realism.md'],expected);assert.ok(trace.stages.some(s=>s.stage==='review'));
   const result={checkedAt:new Date().toISOString(),syntheticOnly:true,userAcceptance:false,trace,reply:state.messages.filter(m=>m.role==='assistant').map(m=>m.part)};
   writeFileSync('output/naturalness-20260919/runtime.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));done=true;break;
  }
 }
 assert.ok(done,'Synthetic request did not complete');
}finally{if(done){const db=new DatabaseSync('.npc-runtime/state.sqlite');db.prepare('DELETE FROM yuan_sessions WHERE id=?').run(user+':yuan-xiaoman');db.close();}}
