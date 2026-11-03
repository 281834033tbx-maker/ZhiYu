// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const {chromium}=require('/Users/jayden/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const {readFileSync,mkdirSync}=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const items=JSON.parse(readFileSync('npc-skills/data/moments-approved-20260919.json','utf8')).items.map(i=>({...i,personId:'yuan-xiaoman',createdAt:Date.parse(i.timelineAt),status:'published',source:'npc-moment',reason:i.title,liked:false,likeCount:0,likes:[],comments:[]})).sort((a,b)=>b.createdAt-a.createdAt);
  await page.route('**/api/npc/moments**',async route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON(),id=route.request().url().split('/').at(-2),post=items.find(i=>i.id===id);
      assert.ok(post);
      if(body.action==='like'){post.liked=body.liked;post.likes=body.liked?[{actorId:'self',name:'我'}]:[];post.likeCount=post.likes.length;}
      else if(body.action==='comment'){
        post.comments.push({id:'c1',actorId:'self',name:'我',text:body.text,time:'刚刚'});
        post.comments.push({id:'c2',actorId:'yuan-xiaoman',name:'袁小满',text:'🥰 那我下次还买这个颜色。',time:'刚刚',replyTo:'c1',replyToName:'我'});
      }
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items,errors:[]})});
  });
  await page.goto('http://localhost:3100/#moments');await page.locator('article.zy-post').first().waitFor({timeout:45000});
  assert.equal(await page.locator('article.zy-post').count(),6);assert.equal(await page.getByText('人物想分享的片段',{exact:true}).count(),0);assert.equal(await page.locator('.zy-moment-review,.zy-moment-schedule').count(),0);
  const cover=await page.locator('.zy-moments-cover').boundingBox(),img=await page.locator('.zy-moments-cover > img').boundingBox(),avatar=await page.locator('.zy-self-cover-avatar').boundingBox();
  assert.ok(Math.abs(cover.height-img.height)<1 && Math.abs(cover.width-img.width)<1);assert.ok(avatar.y>=cover.y&&avatar.y+avatar.height<=cover.y+cover.height);assert.notEqual(await page.locator('.zy-self-cover-avatar').evaluate(e=>getComputedStyle(e).boxShadow),'none');
  await page.locator('.zy-post-person').first().click();await page.locator('.zy-profile-moments').click();await page.locator('article.zy-post').first().waitFor();assert.equal(await page.locator('article.zy-post').count(),6);
  mkdirSync('output/moments-integration-qa',{recursive:true});await page.screenshot({path:'output/moments-integration-qa/npc-cover-overlay.png'});
  const post=page.locator('article.zy-post').first();const like=post.locator('.zy-post-actions button').nth(0),comment=post.locator('.zy-post-actions button').nth(1);
  await like.click();await page.waitForFunction(()=>document.querySelector('.zy-post-actions .liked .zy-interaction-count')?.textContent==='1');
  items[0].likes.push({actorId:'xia-xia',name:'我不是龙虾'});items[0].likeCount=2;await page.evaluate(()=>window.dispatchEvent(new Event('npc-moments-changed')));
  await page.waitForFunction(()=>document.querySelector('.zy-post-actions .liked .zy-interaction-count')?.textContent==='2');
  assert.match(await post.locator('.zy-post-likers').innerText(),/我不是龙虾/);
  await comment.click();await page.getByLabel('评论内容',{exact:true}).fill('这个颜色好看');await page.locator('.zy-comment-form button[type=submit]').click();
  await page.getByText('🥰 那我下次还买这个颜色。',{exact:false}).first().waitFor();await page.keyboard.press('Escape');
  await post.locator('.zy-post-comments').waitFor();assert.equal(await post.locator('.zy-inline-comment').count(),2);assert.equal(await comment.locator('.zy-interaction-count').innerText(),'2');assert.ok(await comment.evaluate(e=>e.classList.contains('commented')));await page.waitForFunction(()=>getComputedStyle(document.querySelector('.zy-post-actions .commented')).color==='rgb(229, 115, 98)');assert.equal(await comment.locator('.lucide-message-square-more').count(),1);
  await post.locator('.zy-post-comments').scrollIntoViewIfNeeded();await page.screenshot({path:'output/moments-integration-qa/comments-and-likes.png'});
  await page.reload();await page.locator('article.zy-post').first().waitFor();assert.equal(await page.locator('.zy-post').first().locator('.zy-interaction-count').first().innerText(),'2');assert.deepEqual(errors,[]);
  console.log('PASS no approval/schedule panels; six historical posts; NPC feed filter; full cover and overlaid shadowed avatar; like 1→2; NPC names; inline comments; colored three-dot icon; emoji+text reply; refresh persistence (isolated mocked API)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
