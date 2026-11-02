const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const {mkdirSync}=require('node:fs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3100/#moments');
 await page.locator('article.zy-post').first().waitFor({timeout:45000});
 assert.equal(await page.locator('.zy-moment-review,.zy-moment-schedule').count(),0);
 const data=await page.evaluate(async()=>{const r=await fetch('/api/npc/moments');return r.json();});
 const planned=data.items.filter(i=>i.id.startsWith('approved-'));assert.equal(planned.length,6);assert.ok(planned.every(i=>i.personId==='yuan-xiaoman'&&i.status==='published'&&i.createdAt<=Date.now()&&i.createdAt>=Date.parse('2026-09-17T12:15:50+08:00')));
 for(const item of planned)for(const image of item.images){const r=await page.request.get(new URL(image,page.url()).href);assert.equal(r.status(),200);assert.match(r.headers()['content-type'],/image\/png/);}
 mkdirSync('output/moments-integration-qa',{recursive:true});await page.screenshot({path:'output/moments-integration-qa/six-post-history.png'});assert.deepEqual(errors,[]);
 console.log('PASS live app: all six historical records, five original PNGs available, no approval/timetable panels, no page errors');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
