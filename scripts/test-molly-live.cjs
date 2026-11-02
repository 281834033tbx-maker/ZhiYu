const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {DatabaseSync}=require('node:sqlite');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const users=[],origin='http://localhost:3100',endpoint=origin+'/api/npc/molly?mode=normal';
 try{
  const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?npc=molly');await page.getByRole('textbox',{name:'给Molly的消息'}).waitFor();
  await page.getByText('老大，有什么指示',{exact:true}).first().waitFor();
  users.push((await context.cookies()).find(c=>c.name==='zhiyu_npc').value);
  assert.match(await page.locator('.xx-head').innerText(),/找人机器人，闲聊200/);
  const send=async text=>{
   const prev=(await (await context.request.get(endpoint)).json()).messages.length;
   await page.getByRole('textbox',{name:'给Molly的消息'}).fill(text);await page.getByRole('button',{name:'发送给Molly',exact:true}).click();
   const start=Date.now();let s;
   while(Date.now()-start<165000){await page.waitForTimeout(1000);s=await(await context.request.get(endpoint)).json();if(s.deliveryError)throw Error(s.deliveryError);if(!s.pending&&s.messages.length>prev+1)return s.messages.slice(prev).filter(m=>m.role==='assistant');}
   throw Error('Molly reply timeout');
  };
  let reply=await send('以后叫我老板');assert.match(reply.at(-1).part.text,/老板/);console.log('PASS real Codex: rename address');
  await page.reload();await page.getByRole('textbox',{name:'给Molly的消息'}).waitFor();
  reply=await send('今天天气怎么样');assert.equal(reply.length,2);assert.ok(['？','额','啥？','你在讲咩啊？'].includes(reply[0].part.text));assert.match(reply[1].part.text,/老板/);console.log('PASS real Codex: two separate off-topic replies with persisted address');
  reply=await send('帮我找个24岁，开朗，喜欢美食的女生');assert.equal(reply.at(-1).recommendations[0].id,'xia-xia');
  await page.getByRole('button',{name:'和我不是龙虾聊天'}).waitFor({timeout:10000});
  await page.screenshot({path:'output/molly-live.png'});
  await page.getByRole('button',{name:'和我不是龙虾聊天'}).click();await page.getByRole('textbox',{name:'给夏夏的消息'}).waitFor();
  console.log('PASS real Codex: catalog match and working in-app Xiaxia chat entry');
  const other=await browser.newContext();const otherResponse=await(await other.request.get(endpoint)).json();users.push((await other.cookies()).find(c=>c.name==='zhiyu_npc').value);
  assert.equal(otherResponse.messages.length,1);assert.match(otherResponse.messages[0].part.text,/老大/);assert.deepEqual(errors,[]);
  fs.writeFileSync('output/molly-live-check.json',JSON.stringify({passed:true,reply,checks:['rename','persisted address','two bubbles','catalog match','click opens existing Xiaxia','user isolation']},null,2));
  console.log('PASS fresh user isolated; no page runtime errors');
 }finally{
  await browser.close();const db=new DatabaseSync('.npc-runtime/state.sqlite');
  for(const user of users){db.prepare('DELETE FROM molly_sessions WHERE id=?').run(user+':molly-system-secretary');db.prepare('DELETE FROM sessions WHERE id LIKE ?').run(user+':%');}db.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
