const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'/Users/boxuantong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const asar=require('../node_modules/@electron/asar');
const stage=path.resolve(__dirname,'../..');
const origin=process.env.ZHIYU_QA_ORIGIN||'http://localhost:3217';
const sourceBundle=path.join(stage,'desktop/dist/mac-arm64/智域.app');
const output=path.join(stage,'output/image-viewer-native-qa');fs.mkdirSync(output,{recursive:true});
async function main(){
 const runtimeDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'zhiyu-image-viewer-native-qa-'));
 const bundle=path.join(runtimeDirectory,'智域 QA.app');
 // Never replace the installed app when someone runs this regression test.
 execFileSync('/usr/bin/ditto',[sourceBundle,bundle]);
 const pack=path.join(output,'shell');fs.mkdirSync(pack,{recursive:true});
 fs.copyFileSync(path.join(__dirname,'image-viewer-native-fixture.cjs'),path.join(pack,'main.js'));
 for(const name of ['preload.js','image-viewer.js'])fs.copyFileSync(path.join(stage,'desktop',name),path.join(pack,name));
 fs.writeFileSync(path.join(pack,'package.json'),JSON.stringify({name:'zhiyu-image-viewer-qa',version:'0.0.0',main:'main.js'}));
 const archive=path.join(bundle,'Contents/Resources/app.asar');await asar.createPackage(pack,archive);
 const hash=crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
 execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,path.join(bundle,'Contents/Info.plist')]);
 execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle]);
 const electron=await _electron.launch({executablePath:path.join(bundle,'Contents/MacOS/智域'),env:{...process.env,ZHIYU_QA_STAGE:stage,ZHIYU_QA_ORIGIN:origin},timeout:30000});
 try{
  const context=electron.context();
  await context.route('**/api/**',route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,account:{id:'isolated-native-viewer-qa',username:'qa_only'}}});
   if(route.request().method()==='POST')return route.fulfill({json:{error:'Native QA never sends messages'}});
   return route.fulfill({json:{messages:[],available:true,pending:false,revision:1,conversationId:'native-fixture',posts:[]}});
  });
  const mainPage=await electron.firstWindow();await mainPage.goto(origin+'/?npc=chen-nian');
  await mainPage.locator('.xx-chat').waitFor();
  const before=await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(await mainPage.locator('.zy-molly-pinned svg[aria-label="永久置顶"]').count(),0);
  const newPage=context.waitForEvent('page');
  assert.equal(await mainPage.evaluate(()=>window.zhiyuDesktop.openImageViewer({conversationId:'chen-nian',index:0,images:[{id:'native-a',src:'/desktop-npc/scenes/chen-nian-red-suit-20260926.png',alt:'隔离验证图'}]})),true);
  const viewer=await newPage;await viewer.locator('.viewer-stage img.is-loaded').waitFor();await viewer.waitForTimeout(300);
  const geometry=await viewer.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,toolbar:document.querySelector('.viewer-toolbar').getBoundingClientRect().height,customDots:document.querySelectorAll('.viewer-controls').length,stageTop:document.querySelector('.viewer-stage').getBoundingClientRect().top}));
  assert.equal(geometry.toolbar,34);assert.equal(geometry.stageTop,34);assert.equal(geometry.customDots,0);
  const native=await electron.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/image-viewer'));return {size:win.getSize(),content:win.getContentSize(),dots:win.getWindowButtonPosition(),pinned:win.isAlwaysOnTop()};});
  assert.deepEqual(native.size,native.content);assert.deepEqual(native.dots,{x:16,y:11});assert.equal(native.pinned,false);
  const area=await electron.evaluate(({screen,BrowserWindow})=>screen.getDisplayMatching(BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/image-viewer')).getBounds()).workArea);
  assert.ok(native.size[0]<=area.width*.75&&native.size[1]<=area.height*.75);
  await viewer.getByRole('button',{name:'固定图片窗口'}).click();
  await viewer.waitForFunction(()=>document.querySelector('[aria-label="固定图片窗口"]').getAttribute('aria-pressed')==='true');
  assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/image-viewer')).isAlwaysOnTop()),true);
  await viewer.screenshot({path:path.join(output,'native-single-toolbar.png')});
  await viewer.getByRole('button',{name:'固定图片窗口'}).click();
  await viewer.waitForFunction(()=>document.querySelector('[aria-label="固定图片窗口"]').getAttribute('aria-pressed')==='false');
  assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('/image-viewer')).isAlwaysOnTop()),false);
  assert.deepEqual(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>!win.webContents.getURL().includes('/image-viewer')).getBounds()),before);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({geometry,native,pinOnOffVerified:true,mainUnchanged:true,isolatedProfile:true},null,2));
  console.log('PASS: real Electron window fits within 75% available screen, one 34px toolbar, no extra frame, no duplicate dots; native always-on-top toggles; main unchanged.');
 }finally{await electron.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
