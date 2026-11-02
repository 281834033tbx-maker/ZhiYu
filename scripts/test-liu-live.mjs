import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const origin='http://localhost:3100',user=crypto.randomUUID(),id=user+':liu',headers={Cookie:'zhiyu_npc='+user,Origin:origin,'Content-Type':'application/json'};
const endpoint=origin+'/api/npc/liu';
try{
 const initial=await(await fetch(endpoint,{headers})).json();assert.equal(initial.available,true);assert.equal(initial.messages.length,0);
 const input='你好，第一次和你聊天。你平时主要拍戏还是唱歌？';
 const sent=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({action:'send',text:input,turnId:crypto.randomUUID()})});assert.equal(sent.status,200);
 let state;
 for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,1500));state=await(await fetch(endpoint,{headers})).json();if(state.deliveryError)throw Error(state.deliveryError);if(state.messages.some(m=>m.role==='assistant')&&!state.pending)break;}
 assert.ok(state.messages.some(m=>m.role==='assistant'),'No model reply');assert.equal(state.values,undefined);
 const refreshed=await(await fetch(endpoint,{headers})).json();assert.deepEqual(refreshed.messages,state.messages);
 const db=new DatabaseSync('.npc-runtime/state.sqlite');const record=JSON.parse(db.prepare('SELECT data FROM liu_sessions WHERE id=?').get(id).data);assert.ok(Object.values(record.values).every(v=>v===0));db.close();
 const result={syntheticOnly:true,input,replies:state.messages.filter(m=>m.role==='assistant').map(m=>m.part),allHiddenValuesZero:true,refreshPersisted:true};writeFileSync('output/liu-live-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{const db=new DatabaseSync('.npc-runtime/state.sqlite');db.prepare('DELETE FROM liu_sessions WHERE id=?').run(id);db.close();}
