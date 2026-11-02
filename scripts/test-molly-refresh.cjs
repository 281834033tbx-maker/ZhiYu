const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const opening={id:'hello',turnId:'hello',role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'老大，有什么指示'}};
 const base={messages:[opening],revision:1,conversationId:'molly-system-secretary',available:true,pending:false,debugAllowed:false,presence:'online'};
 let snapshot=structuredClone(base),gets=0,lateRoute,release,held=new Promise(r=>release=r);
 await page.route('**/api/npc/xia-xia?mode=normal',r=>r.fulfill({json:{messages:[],available:true,pending:false,debugAllowed:false}}));
 await page.route('**/api/npc/molly?mode=normal',async route=>{
  const body=route.request().postDataJSON();
  if(!body){gets++;if(gets===2){lateRoute=route;release();return;}return route.fulfill({json:snapshot});}
  if(body.action==='send'){snapshot={...base,revision:3,messages:[opening,{id:'mine',turnId:body.turnId,role:'user',at:new Date().toISOString(),part:{type:'text',text:body.text}}]};return route.fulfill({json:snapshot});}
  return route.fulfill({json:body.action==='typing'?{ok:true}:snapshot});
 });
 await page.goto('http://localhost:3100/?npc=molly');await held;
 await page.getByRole('textbox',{name:'给Molly的消息'}).fill('这条消息不能消失');await page.getByRole('button',{name:'发送给Molly',exact:true}).click();
 await page.locator('.xx-group.user').getByText('这条消息不能消失').waitFor();
 await lateRoute.fulfill({json:base});await page.waitForTimeout(300);
 assert.equal(await page.locator('.xx-group.user').getByText('这条消息不能消失').count(),1);
 await page.reload();await page.locator('.xx-group.user').getByText('这条消息不能消失').waitFor();assert.deepEqual(errors,[]);
 console.log('PASS older polling response cannot erase sent bubble; refresh retains server history; no runtime errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
