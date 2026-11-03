import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const loadPure=async path=>{
  const source=readFileSync(path,'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
};
const {ReplyRetryLedger}=await loadPure('lib/npc/reply-retry.ts');
const ledger=new ReplyRetryLedger(),key='account-a:xia-xia:turn-a';let updates=0;
const unsubscribe=ledger.subscribe(()=>updates++);
assert.deepEqual(ledger.snapshot(key),{attempted:false,pending:false});
assert.equal(ledger.claimAutomatic(key),true);
assert.equal(ledger.claimAutomatic(key),false,'StrictMode, a poll or remount cannot duplicate automatic retry');
assert.equal(ledger.claimManual(key),false,'double clicks cannot race an in-flight request');
ledger.settle(key);assert.deepEqual(ledger.snapshot(key),{attempted:true,pending:false});
assert.equal(ledger.claimAutomatic(key),false,'a second failure must wait for the user');
assert.equal(ledger.claimManual(key),true);ledger.settle(key);
assert.equal(ledger.claimAutomatic('account-b:xia-xia:turn-a'),true,'different accounts are independent');
assert.equal(ledger.claimAutomatic('account-a:group:group-a:turn-a'),true,'group and private turns are independent');
assert.ok(updates>=6);unsubscribe();

const errors=await loadPure('lib/user-facing-errors.ts');
for(const cause of [new Error('Failed to fetch'),new Error('ECONNREFUSED'),new Error('model timeout')])assert.equal(errors.userFacingError(cause),errors.userFacingErrors.network);
for(const cause of [new Error('API_KEY secret-value'),new Error('DeepSeek balance exhausted'),new Error('SQL query failed')])assert.equal(errors.userFacingError(cause),errors.userFacingErrors.unavailable);
assert.equal(errors.userFacingError(new Error('token details'),'save'),errors.userFacingErrors.save);
assert.equal(errors.userFacingValidationMessage({message:'请输入 1 到 16 个字的名字'}),'请输入 1 到 16 个字的名字');
assert.equal(errors.userFacingValidationMessage({message:'请检查 prompt.json token'}),'请检查填写的内容');

const runtime=isolatedNpcRuntime();let db;
try {
  mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});
  const {VoiceQueue}=await runtime.load('server/npc/voice-worker');
  db=new DatabaseSync(':memory:');
  for(const table of ['sessions','yuan_sessions','liu_sessions'])db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,revision INTEGER,data TEXT NOT NULL)`);
  const message={id:'voice-a',turnId:'turn-a',role:'assistant',at:'2026-11-03T01:02:03Z',part:{type:'voice',text:'保留原来的这句话',synthetic:true,status:'failed',error:'old technical exception'}};
  const seed=(table,id)=>db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(id,3,JSON.stringify({revision:3,messages:[{id:'user-a',turnId:'turn-a',role:'user',part:{type:'text',text:'你好'}},structuredClone(message)]}));
  const read=(table,id)=>JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id).data);
  seed('sessions','owner-a:xia-xia:normal');seed('yuan_sessions','owner-a:yuan-xiaoman');seed('liu_sessions','owner-a:liu');
  let calls=0;
  const queue=new VoiceQueue(db,runtime.root,async(_root,owner,text,character)=>{
    calls++;assert.equal(owner,'owner-a');assert.equal(text,message.part.text);assert.equal(character,'xia-xia');
    const concurrent=read('sessions','owner-a:xia-xia:normal');concurrent.messages.push({id:'concurrent',role:'user',part:{type:'text',text:'不能被重试覆盖'}});
    db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(concurrent),'owner-a:xia-xia:normal');
    return '/api/npc/audio/fixture.wav';
  });
  assert.equal(queue.retry('owner-b','xia-xia','voice-a'),false,'cross-account retry is rejected');
  for(const character of ['molly','zhou-chef','he-jiawei','chen-nian'])assert.equal(queue.retry('owner-a',character,'voice-a'),false,'text-only policy is unchanged');
  assert.equal(queue.retry('owner-a','xia-xia','user-a'),false,'user input cannot be re-synthesized');
  assert.equal(queue.retry('owner-a','xia-xia','voice-a'),true);
  assert.equal(queue.retry('owner-a','xia-xia','voice-a'),false,'double retry keeps one pending message');
  await queue.tick();
  const saved=read('sessions','owner-a:xia-xia:normal'),voice=saved.messages.find(item=>item.id==='voice-a');
  assert.equal(calls,1);assert.equal(saved.messages.length,3);assert.equal(voice.part.status,'ready');assert.equal(voice.part.text,message.part.text);assert.equal(voice.at,message.at);assert.equal(voice.turnId,message.turnId);assert.equal(voice.part.error,undefined);
  assert.equal(queue.retry('owner-a','xia-xia','voice-a'),false,'ready audio is not regenerated');
  queue.stop();
  const failing=new VoiceQueue(db,runtime.root,async()=>{throw Error('provider API_KEY=fixture-secret');});
  assert.equal(failing.retry('owner-a','yuan-xiaoman','voice-a'),true);await failing.tick();failing.stop();
  const failed=read('yuan_sessions','owner-a:yuan-xiaoman').messages.at(-1);
  assert.equal(failed.part.status,'failed');assert.equal(failed.part.error,'语音没发出去，点一下重发');assert.equal(failed.part.text,message.part.text);
  console.log('PASS: one automatic retry per turn, scoped/manual retry locks, safe UI errors, owner-only voice retry, unchanged message identity and concurrent history (no live provider or real database).');
}finally {db?.close();runtime.cleanup();}
