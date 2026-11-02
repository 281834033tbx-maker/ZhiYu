import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.ZHIYU_URL||'http://localhost:3100';
const init=await fetch(origin+'/api/npc/xia-xia?mode=normal');
assert.equal(init.status,200);
const cookie=init.headers.get('set-cookie').split(';')[0],user=cookie.split('=')[1];
const id=user+':xia-xia:normal',db=new DatabaseSync('.npc-runtime/state.sqlite');
try {
  // This freshly created isolated test session has an available work break now.
  // Never edit any existing browser user's row or advance the server clock.
  const row=db.prepare('SELECT data FROM sessions WHERE id=?').get(id);
  const state=JSON.parse(row.data);assert.equal(state.messages.length,0);
  state.life={queue:[],recentIncoming:[],wakeUntil:Date.now()+300000,nextWorkReplyAt:Date.now()-1,lastUserAt:0,nextProactiveAt:Date.now()+7200000,proactiveDay:'',proactiveAttempts:0,proactiveEnabled:false,quietUntil:0,retryAt:0,lastError:'',wakeReason:'隔离验证中的清醒状态'};
  db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(state),id);
  const res=await fetch(origin+'/api/npc/xia-xia?mode=normal',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',turnId:crypto.randomUUID(),text:'夏夏，给我发一张那个托下巴思考的奶牛表情看看'})});
  assert.equal(res.status,200);const accepted=await res.json();assert.equal(accepted.debug,undefined);assert.equal(accepted.messages[0].role,'user');
  let result;const deadline=Date.now()+165000;
  while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));const response=await fetch(origin+'/api/npc/xia-xia?mode=normal',{headers:{Cookie:cookie}});result=await response.json();if(result.deliveryError)throw new Error(result.deliveryError);if(result.messages.some(m=>m.role==='assistant'))break;}
  assert.ok(result.messages.some(m=>m.role==='assistant'),'No scheduled model reply arrived');
  assert.ok(result.messages.some(m=>m.role==='assistant'&&m.part.type==='sticker'&&m.part.assetId==='cowThinking'),'Expected selected local cow sticker');
  mkdirSync('output',{recursive:true});writeFileSync('output/xia-xia-queue-live.json',JSON.stringify({at:new Date().toISOString(),mode:'isolated real Codex via background queue',messages:result.messages},null,2));
  console.log('PASS LIVE: normal-page message queued, background Codex reply persisted, selected cowThinking asset, hidden state absent');
} finally {db.prepare('DELETE FROM sessions WHERE id=?').run(id);db.close();}
