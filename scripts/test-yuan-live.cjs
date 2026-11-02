const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {DatabaseSync}=require('node:sqlite');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const origin='http://localhost:3100',users=[];
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?npc=yuan-xiaoman');
  const box=page.getByRole('textbox',{name:'给小满的消息'});await box.waitFor();
  const endpoint=origin+'/api/npc/yuan-xiaoman';
  let state=await(await ctx.request.get(endpoint)).json();assert.equal(state.messages.length,0);
  users.push((await ctx.cookies()).find(c=>c.name==='zhiyu_npc').value);
  const image=page.locator('.xx-head img');assert.ok(await image.evaluate(e=>e.complete&&e.naturalWidth>0));
  await box.fill('你好，我叫阿远。你平时是做什么工作的呀？');await page.getByRole('button',{name:'发送给小满',exact:true}).click();
  const start=Date.now();
  while(Date.now()-start<170000){await page.waitForTimeout(1000);state=await(await ctx.request.get(endpoint)).json();if(state.deliveryError)throw Error(state.deliveryError);if(!state.pending&&state.messages.some(m=>m.role==='assistant'))break;}
  assert.ok(state.messages.some(m=>m.role==='assistant'),'real model reply');
  assert.equal(state.debug,undefined);assert.equal(state.values,undefined);
  await page.reload();await box.waitFor();await page.getByText('你好，我叫阿远。你平时是做什么工作的呀？',{exact:true}).last().waitFor();
  await page.screenshot({path:'output/yuan-live.png'});
  const persisted=await(await ctx.request.get(endpoint)).json();assert.equal(persisted.messages.length,state.messages.length);
  const other=await browser.newContext();const fresh=await(await other.request.get(endpoint)).json();users.push((await other.cookies()).find(c=>c.name==='zhiyu_npc').value);assert.equal(fresh.messages.length,0);
  assert.deepEqual(errors,[]);
  fs.writeFileSync('output/yuan-live-check.json',JSON.stringify({passed:true,reply:state.messages.filter(m=>m.role==='assistant'),checks:['entry','avatar loaded','real Codex reply','reload persistence','user isolation','no client errors','hidden state not exposed']},null,2));
  console.log('PASS Yuan browser and real Codex',JSON.stringify(state.messages.filter(m=>m.role==='assistant').map(m=>m.part)));
 }finally{await browser.close();const db=new DatabaseSync('.npc-runtime/state.sqlite');for(const u of users){db.prepare('DELETE FROM yuan_sessions WHERE id=?').run(u+':yuan-xiaoman');db.prepare('DELETE FROM sessions WHERE id LIKE ?').run(u+':%');}db.close();}
})().catch(e=>{console.error(e);process.exit(1)});
