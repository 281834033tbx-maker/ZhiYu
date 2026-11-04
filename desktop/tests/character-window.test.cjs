// No Electron GUI required: exercise the actual main-process window handlers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const project = path.resolve(__dirname, '../..');
const handlers = new Map();
let area = { x: 0, y: 0, width: 1440, height: 1080 };
class FakeWindow extends EventEmitter {
  constructor(options) { super(); this.options = options; this.size = [options.width, options.height]; this.webContents = { send() {} }; }
  getBounds() { return { x: 0, y: 0, width: this.size[0], height: this.size[1] }; }
  getSize() { return this.size; }
  getContentSize() { return this.size; }
  setContentSize(width, height) { this.size = [width, height]; this.emit('resize'); }
  setBounds(bounds) { this.size = [bounds.width, bounds.height]; this.emit('resize'); }
  setMinimumSize(width, height) { this.minimum = [width, height]; }
  setAspectRatio(ratio, extra) { this.aspect = { ratio, extra }; }
  setWindowButtonVisibility(value) { this.buttonsVisible = value; }
  setFullScreen(value) { this.fullscreen = value; this.emit(value ? 'enter-full-screen' : 'leave-full-screen'); }
  isDestroyed() { return !!this.destroyed; }
  isMinimized() { return false; }
  isFullScreen() { return !!this.fullscreen; }
  loadURL(url) { this.url = url; return Promise.resolve(); }
  setMenuBarVisibility() {}
  center() {}
  show() {}
  focus() {}
  close() { this.destroyed = true; this.emit('closed'); }
}
const main = new FakeWindow({ width: 1060, height: 720 });
const electron = {
  app: { on() {}, requestSingleInstanceLock:()=>true, whenReady: () => ({ then() {} }) },
  BrowserWindow: FakeWindow, dialog: {}, session: {},
  screen: { getDisplayMatching: () => ({ workArea: area }) },
  ipcMain: { handle: (key, handler) => handlers.set(key, handler) },
};
const context = vm.createContext({
  require: name => name === 'electron' ? electron : name === './image-viewer' ? {registerImageViewer:()=>({close(){}})}
    : name === './window-recovery.cjs' ? {attachWindowRecovery:win=>({load:url=>win.loadURL(url),dispose(){},recover(){}})}
    : name === './service-supervisor.cjs' ? require('../service-supervisor.cjs') : name === './local-identity.cjs' ? require('../local-identity.cjs') : require(name),
  process: { ...process, on() {}, resourcesPath: project, env: { ...process.env, ZHIYU_PROJECT: project, ZHIYU_NPC_ID: 'test-character-window' } },
  __dirname: path.join(project, 'desktop'), console, setTimeout, clearTimeout, __testMain: main,
});
vm.runInContext(fs.readFileSync(path.join(project, 'desktop/main.js'), 'utf8') +
  '\nmainWindow = __testMain; globalThis.getCharacter = () => characterWindow; globalThis.contentSize = characterContentSize;', context);
const event = { sender: main.webContents };
const ratioOK = win => assert.ok(Math.abs((win.size[1] - win.aspect.extra.height) - win.size[0] * 9 / 16) <= 1);
(async () => {
  assert.equal(await handlers.get('zhiyu:character-open')({sender:{}}, 'chen-nian'), false);
  assert.equal(await handlers.get('zhiyu:character-open')(event, 'unknown'), false);
  assert.equal(await handlers.get('zhiyu:character-open')(event, 'chen-nian'), true);
  const win = context.getCharacter();
  assert.equal(await handlers.get('zhiyu:character-open')(event, 'he-jiawei'), true);
  assert.ok(win.url.includes('npc=he-jiawei'));
  assert.equal(await handlers.get('zhiyu:character-open')(event, 'zhao-yifan'), true);
  assert.ok(win.url.includes('npc=zhao-yifan'));
  assert.equal(await handlers.get('zhiyu:character-open')(event, 'zhou-chef'), true);
  assert.ok(win.url.includes('npc=zhou-chef'));
  assert.deepEqual(win.size, [1024, 658]);
  assert.equal(win.aspect.ratio, 16 / 9);
  assert.equal(win.options.fullscreenable, true);
  assert.equal(win.options.frame, false);
  assert.equal(win.options.webPreferences.autoplayPolicy,'no-user-gesture-required');
  assert.equal(handlers.get('zhiyu:character-fullscreen-get')({sender:win.webContents}),false);
  assert.equal(handlers.get('zhiyu:character-fullscreen-set')({sender:{}},true),false);
  assert.equal(handlers.get('zhiyu:character-fullscreen-set')({sender:win.webContents},true),true);
  assert.equal(handlers.get('zhiyu:character-fullscreen-get')({sender:win.webContents}),true);
  if (process.platform === 'darwin') assert.equal(win.buttonsVisible, false);
  assert.equal(handlers.get('zhiyu:character-fullscreen-set')({sender:win.webContents},false),true);
  assert.equal(handlers.get('zhiyu:character-fullscreen-get')({sender:win.webContents}),false);
  if (process.platform === 'darwin') assert.equal(win.buttonsVisible, true);
  ratioOK(win);
  for (const [edge, width, height, expectedWidth] of [
    ['right',1200,658,1200], ['bottom',1200,500,743], ['left',800,500,800], ['top',800,550,832],
  ]) {
    let prevented = false;
    win.emit('will-resize', {preventDefault(){prevented=true;}}, {x:0,y:0,width,height}, {edge});
    assert.equal(prevented,true); assert.equal(win.size[0],expectedWidth); ratioOK(win);
  }
  for (const size of [[1000,1000],[768,400],[500,600],[1200,700]]) {
    win.size = size; win.emit('resize'); ratioOK(win);
  }
  const chrome = handlers.get('zhiyu:character-chrome-height');
  assert.equal(chrome({sender:{}},180),false);
  assert.equal(chrome({sender:win.webContents},NaN),false);
  assert.equal(chrome({sender:win.webContents},174),true); ratioOK(win);
  assert.equal(chrome({sender:win.webContents},82),true); ratioOK(win);
  await handlers.get('zhiyu:character-open')(event,'yuan-xiaoman');
  const callSize=[...win.size],callAspect=win.aspect;
  assert.equal(chrome({sender:win.webContents},0),true);
  assert.equal(chrome({sender:win.webContents},240),true);
  assert.deepEqual(win.size,callSize,'call overlays never resize the native window');
  assert.equal(win.aspect,callAspect,'composer visibility cannot alter the call geometry');
  assert.equal(win.options.frame,false);
  assert.equal(win.options.titleBarStyle,'hidden');
  assert.equal(win.options.trafficLightPosition.x,12);
  assert.equal(win.options.trafficLightPosition.y,7);
  await handlers.get('zhiyu:character-open')(event,'chen-nian');
  win.fullscreen = true; win.size = [1440,1080]; win.emit('resize');
  assert.deepEqual(win.size,[1440,1080]);
  win.fullscreen = false; win.emit('leave-full-screen'); ratioOK(win);
  area = {x:0,y:0,width:600,height:480};
  const fit = context.contentSize(1024,area);
  assert.ok(fit.width <= 560 && fit.height <= 440);
  assert.ok(Math.abs(fit.height - 82 - fit.width * 9/16) <= 1);
  assert.deepEqual(main.size,[1060,720]);
  assert.equal(handlers.get('zhiyu:character-close')(event),true);
  assert.equal(context.getCharacter(),null);
  console.log('PASS: 16:9 coupled resize, native traffic lights, fullscreen restore, legacy dynamic footer, call overlay geometry preserved, small screen, IPC isolation, main window unchanged.');
})().catch(error => { console.error(error); process.exitCode = 1; });
