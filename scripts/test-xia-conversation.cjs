const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1100}}), errors=[], actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  let presence='offline', count=20;
  const messages=()=>[
   {id:'u1',turnId:'u1',role:'user',at:new Date().toISOString(),part:{type:'text',text:'今天出去走走了吗？'}},
   ...Array.from({length:count},(_,i)=>({id:'a'+i,turnId:'reply1',role:'assistant',at:new Date().toISOString(),part:{type:'text',text:['刚绕着楼下走了一圈','风把头发吹得乱七八糟的','本来只想买瓶水，结果拎了一袋零食回来','你吃饭了没？'][i%4]}}))
  ];
  await page.route('**/api/npc/xia-xia?mode=normal',async route=>{
   const body=route.request().postDataJSON();if(body)actions.push(body);
   await route.fulfill({json:{messages:messages(),available:true,pending:false,debugAllowed:true,presence}});
  });
  await page.goto('http://localhost:3100/?npc=xia-xia');
  await page.locator('.xx-group.assistant').waitFor();
  assert.equal(await page.locator('.xx-group.assistant .xx-message').count(),20);
  assert.equal(await page.locator('.xx-group.assistant time').count(),1);
  assert.equal(await page.locator('.xx-group.assistant .xx-group-avatar').count(),1);
  assert.equal(await page.locator('.xx-group.user img').count(),0);
  assert.equal(await page.locator('.xx-head .zy-status-badge').innerText(),'离线');
  for(const [value,label]of [['busy','忙碌'],['online','在线']]){
   presence=value;
   await page.waitForFunction(label=>document.querySelector('.xx-head .zy-status-badge')?.textContent===label,label);
   await page.waitForFunction(value=>[...document.querySelectorAll('.zy-conversation')].some(el=>el.textContent.includes('我不是龙虾')&&el.querySelector('.zy-presence.is-'+value)),value);
  }
  await page.getByRole('textbox',{name:'给夏夏的消息'}).fill('我还有一句没说完');
  await page.waitForTimeout(2100);
  assert.ok(actions.some(a=>a.action==='typing'&&a.active));
  assert.ok(actions.some(a=>a.action==='typing'&&!a.active));
  assert.ok(actions.filter(a=>a.action==='typing').every(a=>!('text'in a)));
  await page.locator('.zy-self-status').click();
  assert.equal(await page.locator('.zy-self-status').innerText(),'忙碌');
  assert.equal(await page.locator('.zy-self .zy-presence.is-busy').count(),1);
  count=4;
  await page.waitForFunction(()=>document.querySelectorAll('.xx-group.assistant .xx-message').length===4);
  await page.getByRole('textbox',{name:'给夏夏的消息'}).fill('');
  await page.screenshot({path:'output/xia-xia-conversation.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS 20 bubbles / one avatar and receipt; user has no avatar; live presence dot and badge; user busy toggle; typing metadata only; no runtime errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
