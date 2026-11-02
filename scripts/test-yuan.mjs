import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'yuan-test-'));let server;
try {
  for (const [folder,name] of [['lib/npc','contracts'],['lib/npc','engine'],['lib/npc','yuan-xiaoman'],['server/npc','yuan-prompt'],['server/npc','yuan-plugin'],['server/npc','codex']]) {
    const src=readFileSync(`${folder}/${name}.ts`,'utf8').replace(/'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(contracts|engine|yuan-xiaoman|yuan-prompt|codex)'/g,"'./$1.mjs'");
    writeFileSync(join(dir,name+'.mjs'),ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  const {createYuan,yuanEmotion,parseYuan,applyYuan}=await import(pathToFileURL(join(dir,'yuan-xiaoman.mjs')));
  const {yuanPrompt}=await import(pathToFileURL(join(dir,'yuan-prompt.mjs')));
  const a=createYuan(0),b=createYuan(0);
  assert.deepEqual(a.messages,[]);assert.deepEqual(a.memories,[]);assert.equal(a.relationship,'strangers');assert.equal(a.values.trust,0);assert.equal(a.values.safety,null);
  assert.equal(yuanEmotion(a,0),-2);assert.equal(yuanEmotion(a,43200000),-1);assert.equal(yuanEmotion(a,86400000),0);assert.equal(a.values.trust,0);
  assert.throws(()=>parseYuan({action:'reply',messages:[{type:'sticker',assetId:'cow'}]},'hi'));
  const raw={action:'reply',messages:[{type:'text',text:'你好呀'}],event:null,memories:[]};
  a.messages.push({id:'u1',turnId:'t1',role:'user',at:new Date().toISOString(),part:{type:'text',text:'我喜欢蓝色'}});
  applyYuan(a,parseYuan({...raw,memories:[{kind:'user_claim',text:'用户说喜欢蓝色',evidence:'喜欢蓝色'}]},'我喜欢蓝色'),'r1');
  assert.equal(a.memories[0].messageId,'u1');assert.equal(b.memories.length,0);
  const prompt=yuanPrompt(process.cwd(),b,'你好');assert.match(prompt,/22岁/);assert.match(prompt,/G16 主动创造并分享角色自己的日常/);assert.match(prompt,/G17 分享随好感度和熟悉度逐步加深/);assert.ok(!prompt.includes('## 首轮档案审查历史'));assert.ok(!prompt.includes('夏夏纠偏'));
  mkdirSync(join(dir,'npc-skills'));cpSync('npc-skills/references',join(dir,'npc-skills/references'),{recursive:true});
  const {yuanLocal}=await import(pathToFileURL(join(dir,'yuan-plugin.mjs')));let handler,calls=0;
  server=createServer((req,res)=>handler(req,res));
  yuanLocal({available:()=>true,generate:async()=>{calls++;return raw}}).configureServer({config:{root:dir},middlewares:{use:(_,h)=>handler=h},httpServer:server});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const first=await fetch(origin),cookie=first.headers.get('set-cookie').split(';')[0];assert.equal((await first.json()).messages.length,0);
  const turnId=crypto.randomUUID();const send=()=>fetch(origin,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'send',text:'你好',turnId})});
  await send();await send();let state;
  for(let i=0;i<20;i++){state=await(await fetch(origin,{headers:{Cookie:cookie}})).json();if(state.messages.length===2)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(calls,1);assert.equal(state.messages.length,2);assert.equal(state.debug,undefined);assert.equal(state.values,undefined);
  assert.equal((await(await fetch(origin)).json()).messages.length,0);
  assert.equal((await fetch(origin,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'})).status,403);
  console.log('PASS Yuan: independent initial state/memory, 24h initial-emotion decay, asset isolation, scoped prompt, real HTTP queue/idempotence/user isolation/hidden values/origin guard');
}finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
