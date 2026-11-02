const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/boxuantong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const origin=process.env.ZHIYU_QA_ORIGIN||'http://localhost:3217';
const output=process.env.ZHIYU_QA_OUTPUT||path.resolve(__dirname,'../../output/image-viewer-qa');
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.ZHIYU_QA_CHROMIUM?{executablePath:process.env.ZHIYU_QA_CHROMIUM}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1060,height:720}});
    const errors=[],calls=[],requests=[];let snapshot=null,viewer=null,dimensions=null;
    const imageA='/desktop-npc/scenes/chen-nian-red-suit-20260926.png',imageB='/desktop-npc/scenes/he-jiawei-20260926.png';
    const session={messages:[
      {id:'a',turnId:'one',role:'assistant',at:new Date().toISOString(),part:{type:'generated_photo',jobId:'job',status:'ready',url:imageA,caption:'图片 A',prompt:'fixture',withCharacter:true,attempts:1}},
      {id:'b',turnId:'two',role:'user',at:new Date().toISOString(),part:{type:'upload',url:imageB,text:''}},
      {id:'pending',turnId:'three',role:'assistant',at:new Date().toISOString(),part:{type:'generated_photo',jobId:'pending',status:'pending',caption:'尚未生成',prompt:'fixture',withCharacter:false,attempts:0}}
    ],available:true,pending:false,presence:'online',revision:1,conversationId:'fixture',debugAllowed:false};
    await context.route('**/api/auth/session',route=>route.fulfill({json:{authenticated:true,account:{id:'qa-image-viewer-only',username:'qa_only'}}}));
    await context.route('**/api/npc/**',route=>{
      const request=route.request();const url=new URL(request.url());
      let body=null;if(request.method()==='POST'&&request.headers()['content-type']?.includes('application/json'))body=request.postDataJSON();
      requests.push({url:url.pathname,method:request.method(),body});
      if(url.pathname==='/api/npc/media'&&request.method()==='POST')return route.fulfill({json:{imageId:'11111111-1111-4111-8111-111111111111.png',url:'/api/npc/media/11111111-1111-4111-8111-111111111111.png'}});
      return route.fulfill({json:url.pathname==='/api/npc/chen-nian'?session:url.pathname==='/api/npc/molly'?{...session,messages:[]}:url.pathname==='/api/npc/moments'?{posts:[]}:{...session,messages:[]}});
    });
    const emit=async page=>page.evaluate(next=>window.__viewerListener?.(next),snapshot);
    const fit=async page=>{
      if(!dimensions)return;
      const sidebar=snapshot.history?216:0;
      const scale=Math.min(1,(1440*.75-sidebar)/dimensions.width,(1000*.75-34)/dimensions.height);
      await page.setViewportSize({width:Math.round(dimensions.width*scale)+sidebar,height:Math.round(dimensions.height*scale)+34});
    };
    await context.exposeBinding('__viewerOpen',(_source,payload)=>{snapshot={...payload,history:false,pinned:false};calls.push(['open',payload]);return true;});
    await context.exposeBinding('__viewerGet',()=>snapshot);
    await context.exposeBinding('__viewerFit',async(source,payload)=>{dimensions=payload;await fit(source.page);return true;});
    await context.exposeBinding('__viewerSelect',async(source,index)=>{snapshot={...snapshot,index};await emit(source.page);return true;});
    await context.exposeBinding('__viewerHistory',async(source,history)=>{snapshot={...snapshot,history};await fit(source.page);await emit(source.page);return true;});
    await context.exposeBinding('__viewerPin',async source=>{snapshot={...snapshot,pinned:!snapshot.pinned};await emit(source.page);return snapshot.pinned;});
    await context.exposeBinding('__viewerCopy',(_source,bytes)=>{assert.ok(Object.keys(bytes).length>8);calls.push(['copy']);return {ok:true};});
    await context.exposeBinding('__viewerSave',(_source,id)=>{calls.push(['save',id]);return {ok:true};});
    await context.exposeBinding('__viewerControl',(_source,action)=>{calls.push(['control',action]);return true;});
    await context.addInitScript(()=>{window.zhiyuDesktop={platform:'test',
      openImageViewer:payload=>window.__viewerOpen(payload),updateImageViewer:async()=>true,
      getImageViewer:()=>window.__viewerGet(),fitImageViewer:payload=>window.__viewerFit(payload),
      selectViewerImage:index=>window.__viewerSelect(index),setImageHistory:value=>window.__viewerHistory(value),
      toggleImagePin:()=>window.__viewerPin(),copyViewerImage:bytes=>window.__viewerCopy(bytes),saveViewerImage:id=>window.__viewerSave(id),
      imageWindowControl:action=>window.__viewerControl(action),
      onImageViewerState:listener=>{window.__viewerListener=listener;return()=>{window.__viewerListener=null;};},
      closeCharacterWindow:async()=>true,onCharacterWindowState:()=>()=>{},openCharacterWindow:async()=>true};});
    const main=await context.newPage();main.on('pageerror',error=>errors.push(error.message));
    await main.goto(origin+'/?npc=chen-nian');
    await main.locator('#npc-message-a .chat-image-open').waitFor();
    const mainSize=main.viewportSize();
    assert.equal(await main.locator('.zy-molly-pinned svg[aria-label="永久置顶"]').count(),0);
    assert.equal(await main.locator('.zy-molly-pinned').count(),1);
    await main.locator('#npc-message-a .chat-image-open').click();
    assert.equal(calls[0][1].images.length,2);assert.equal(calls[0][1].images[0].sender,'陈年');assert.equal(calls[0][1].images[1].sender,'你');
    assert.equal(await main.locator('dialog.chat-image-window').count(),0);
    viewer=await context.newPage();viewer.on('pageerror',error=>errors.push(error.message));await viewer.goto(origin+'/image-viewer');
    await viewer.locator('.viewer-stage img.is-loaded').waitFor();
    await viewer.waitForTimeout(300);
    const measure=()=>viewer.evaluate(()=>{const img=document.querySelector('.viewer-stage>img'),box=document.querySelector('.viewer-stage');const a=img.getBoundingClientRect(),b=box.getBoundingClientRect();return {image:{x:a.x,y:a.y,width:a.width,height:a.height},stage:{x:b.x,y:b.y,width:b.width,height:b.height},toolbar:document.querySelector('.viewer-toolbar').getBoundingClientRect().height,scale:getComputedStyle(img).transform};});
    const initial=await measure(),windowSize=viewer.viewportSize();
    assert.equal(initial.toolbar,34);assert.ok(Math.abs(initial.image.width-initial.stage.width)<1);assert.ok(Math.abs(initial.image.height-initial.stage.height)<1);assert.equal(initial.stage.y,34);
    assert.ok(windowSize.width<=1080&&windowSize.height<=750);
    assert.equal(await viewer.locator('.viewer-toolbar').count(),1);
    await viewer.screenshot({path:path.join(output,'01-tight-viewer.png')});
    await viewer.mouse.move(initial.stage.width/2,initial.stage.height/2+34);await viewer.mouse.wheel(0,250);await viewer.waitForTimeout(120);
    const small=await measure();assert.ok(small.image.width<small.stage.width);assert.ok(small.image.x>0);assert.deepEqual(viewer.viewportSize(),windowSize);
    await viewer.screenshot({path:path.join(output,'02-zoom-out.png')});
    await viewer.evaluate(()=>document.querySelector('.viewer-stage').dispatchEvent(new WheelEvent('wheel',{deltaY:-80,ctrlKey:true,bubbles:true,cancelable:true,clientX:400,clientY:400})));
    assert.ok((await measure()).image.width>initial.image.width);assert.deepEqual(viewer.viewportSize(),windowSize);
    await viewer.mouse.move(450,350);await viewer.mouse.down();await viewer.mouse.move(520,380);await viewer.mouse.up();assert.notEqual((await measure()).image.x,initial.image.x);
    await viewer.keyboard.press('0');assert.ok(Math.abs((await measure()).image.width-initial.stage.width)<1);
    await viewer.getByRole('button',{name:'历史图片',exact:true}).click();await viewer.locator('.viewer-history').waitFor();assert.equal(await viewer.locator('.viewer-thumbnails button').count(),2);
    assert.equal(await viewer.getByRole('button',{name:'历史图片',exact:true}).getAttribute('aria-pressed'),'true');
    assert.match(await viewer.getByRole('button',{name:'历史图片',exact:true}).locator('svg').evaluate(el=>getComputedStyle(el).stroke),/viewer-logo-gradient/);
    await viewer.screenshot({path:path.join(output,'03-history-sidebar.png')});
    await viewer.getByRole('button',{name:'查看历史图片 2',exact:true}).click();await viewer.locator('.viewer-stage img.is-loaded').waitFor();await viewer.waitForTimeout(200);assert.equal(await viewer.getByRole('button',{name:'下一张图片'}).isDisabled(),true);
    await viewer.getByRole('button',{name:'固定图片窗口'}).click();await viewer.waitForFunction(()=>document.querySelector('[aria-label="固定图片窗口"]').getAttribute('aria-pressed')==='true');
    await viewer.getByRole('button',{name:'更多图片操作'}).click();await viewer.getByRole('menuitem',{name:'复制图片',exact:true}).click();await viewer.getByText('图片已复制',{exact:true}).waitFor();assert.ok(calls.some(call=>call[0]==='copy'));
    await viewer.getByRole('button',{name:'更多图片操作'}).click();await viewer.getByRole('menuitem',{name:'保存图片',exact:true}).click();await viewer.getByText('图片已保存',{exact:true}).waitFor();assert.ok(calls.some(call=>call[0]==='save'&&call[1]==='b'));
    await viewer.getByRole('button',{name:'更多图片操作'}).click();await viewer.getByRole('menuitem',{name:'转发',exact:true}).click();await viewer.locator('.viewer-forward').waitFor();
    await viewer.screenshot({path:path.join(output,'04-forward-confirmation.png')});
    assert.equal(requests.some(request=>request.body?.action==='send'),false);
    await viewer.locator('input[type=radio][value=molly]').check();await viewer.getByRole('button',{name:'确认转发'}).click();await viewer.getByText('已转发给Molly',{exact:true}).waitFor();
    assert.ok(requests.some(request=>request.url==='/api/npc/media'&&request.method==='POST'));
    assert.ok(requests.some(request=>request.url==='/api/npc/molly'&&request.body?.action==='send'&&request.body.imageId==='11111111-1111-4111-8111-111111111111.png'));
    assert.deepEqual(main.viewportSize(),mainSize);
    await viewer.getByRole('button',{name:'关闭图片窗口'}).click();assert.ok(calls.some(call=>call[0]==='control'&&call[1]==='close'));
    await main.evaluate(()=>{window.zhiyuDesktop={openCharacterWindow:async()=>true};});
    await main.locator('#npc-message-a .chat-image-open').click();
    await main.getByText('图片查看器已更新，请用 ⌘Q 完全退出智域后重新打开',{exact:true}).waitFor();
    assert.equal(context.pages().length,2);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({initial,zoomOut:small,mainUnchanged:true,errors,actions:calls.map(call=>call[0]),mockForward:true},null,2));
    console.log('PASS: chat opens separate viewer; both senders/history; exact edge fit; wheel/pinch zoom keeps viewport; drag; navigation bounds; gradient state; copy/save; confirmed real forward request path (mocked); main unchanged; no runtime errors.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
