// 智域桌面客户端 —— Electron 壳
// 职责：启动本机服务，打开主窗口，并按需打开独立人物窗口。
// 本机服务由 App 自己监督；窗口崩溃和服务退出均可自动恢复。
'use strict';

// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { app, BrowserWindow, ipcMain, screen, session, shell, systemPreferences, powerMonitor } = require('electron');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { spawn } = require('child_process');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const fs = require('fs');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const os = require('os');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const path = require('path');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { createServiceSupervisor, probeLocalService } = require('./service-supervisor.cjs');
// oxlint-disable-next-line typescript/no-require-imports -- Shared native recovery controller.
const { attachWindowRecovery } = require('./window-recovery.cjs');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { resolveLocalIdentity } = require('./local-identity.cjs');

// 优先使用显式路径；打包后从 .app 所在的项目目录自动定位，避免依赖旧电脑用户名。
const projectCandidates = [
  process.env.ZHIYU_PROJECT,
  path.resolve(process.resourcesPath, '../../../../../../'),
  path.resolve(__dirname, '..'),
].filter(Boolean);
const PROJECT_ROOT = projectCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'node_modules', 'vinext', 'dist', 'cli.js'))
) || projectCandidates[0];
const PORT = Number(process.env.ZHIYU_PORT || 3100);
const URL = `http://localhost:${PORT}/`;
// 新克隆使用本项目独立的持久身份；恢复旧数据时可显式提供原身份。
const NPC_ID = resolveLocalIdentity({
  projectRoot: PROJECT_ROOT,
  override: process.env.ZHIYU_NPC_ID,
});
// The user's 2388×1740 Retina reference corresponds to 1194×870 logical points.
const WINDOW_WIDTH = Number(process.env.ZHIYU_WIDTH || 1194);
const WINDOW_HEIGHT = Number(process.env.ZHIYU_HEIGHT || 870);

function resolveNode() {
  const candidates = [
    process.env.NODE_BIN,
    ...(process.env.PATH || '').split(path.delimiter).map((directory) => path.join(directory, 'node')),
    path.resolve(PROJECT_ROOT, '../../../.hermes/node/bin/node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'node';
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
let stopping = false;
let shutdownPromise = null;
let quitReady = false;
const recoveryControllers = new Map();
let mainWindow = null;
let characterWindow = null;
let characterPersonId = null;
const taskCalendarWindows = new Map();
function logRecovery(event, detail = {}) {
  try {
    const folder = path.join(os.homedir(), '.zhiyu');
    fs.mkdirSync(folder, {recursive:true});
    const file = path.join(folder, 'recovery.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024)
      fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, `${JSON.stringify({at:new Date().toISOString(),event,...detail})}\n`);
  } catch { /* Recovery must not depend on the logging volume. */ }
}
function protectWindow(win, targetURL) {
  let controller = recoveryControllers.get(win);
  if (!controller) {
    controller = attachWindowRecovery(win, {targetURL,ensureService:ensureServer,
      statusFile:path.join(__dirname,'service-status.html'),
      ...(win===mainWindow?{startupFile:path.join(__dirname,'startup.html')}:{}),
      isStopping:()=>stopping,log:logRecovery});
    recoveryControllers.set(win,controller);
    win.once('closed',()=>{controller.dispose();recoveryControllers.delete(win);});
  }
  return controller;
}
const CHARACTER_SCENE_RATIO = 16 / 9;
const CHARACTER_DEFAULT_CHROME_HEIGHT = 28 + 54;
let characterChromeHeight = CHARACTER_DEFAULT_CHROME_HEIGHT;
let adjustingCharacterSize = false;
// Archived Zhao links stay valid; Zhou has an independent identity and no AI backend yet.
const characterIds = new Set(['chen-nian', 'he-jiawei', 'zhou-chef', 'zhao-yifan', 'yuan-xiaoman', 'xia-xia', 'liu', 'molly']);
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const imageViewer = require('./image-viewer').registerImageViewer({
  baseURL: URL,
  preload: path.join(__dirname, 'preload.js'),
  allowedSender: sender => [mainWindow, characterWindow].some(win =>
    win && !win.isDestroyed() && win.webContents === sender &&
    sender.getURL().startsWith(URL)),
});

// The profile's React tree stays in the main renderer, while a strictly named
// transparent child supplies screen space outside the main window's bounds.
// oxlint-disable-next-line typescript/no-require-imports -- Native-only module.
const profilePopover = require('./profile-popover.cjs').registerProfilePopover({
  ipcMain,screen,baseURL:URL,getParent:()=>mainWindow,
  allowExistingWindow:details=>{
    try {
      const target=new globalThis.URL(details.url),base=new globalThis.URL(URL);
      if(target.origin!==base.origin||target.username||target.password)return false;
      if(target.pathname==='/task-calendar')return ['zhiyu-task-calendar-compact','zhiyu-task-calendar-frosted'].includes(details.frameName)&&!!taskCalendarURL(target.href);
      if(target.pathname==='/character-window')return details.frameName==='zhiyu-character'&&characterIds.has(target.searchParams.get('npc'));
      return target.pathname==='/image-viewer'&&/^zhiyu-image-[\w-]+$/.test(details.frameName);
    }catch{return false;}
  },
});

function isTrustedWindow(event) {
  return [mainWindow, characterWindow].some(win =>
    win && !win.isDestroyed() && win.webContents === event.sender &&
    event.senderFrame?.url.startsWith(URL));
}

// Camera capture is local preview only. A shared Electron session must not
// turn a grant for the character page into access for other sites or frames.
function trustedMediaPage(contents, requestingURL) {
  try {
    const win = [mainWindow, characterWindow].find(value => value && !value.isDestroyed() && value.webContents === contents);
    if (!win) return null;
    const base = new globalThis.URL(URL);
    const top = new globalThis.URL(contents.getURL());
    const requested = new globalThis.URL(requestingURL || top.href);
    if ([top, requested].some(value => value.origin !== base.origin || value.username || value.password)
      || requested.pathname !== top.pathname || requested.search !== top.search) return null;
    if (win === mainWindow && top.pathname === '/') return 'main';
    if (win === characterWindow && top.pathname === '/character-window'
      && characterIds.has(characterPersonId) && top.searchParams.get('npc') === characterPersonId)
      return characterPersonId;
  } catch { /* Invalid, detached or navigating frames receive no grant. */ }
  return null;
}

function trustedCameraSender(event) {
  return !!characterWindow && event.sender === characterWindow.webContents
    && !!event.senderFrame && event.senderFrame === event.sender.mainFrame
    && trustedMediaPage(event.sender, event.senderFrame?.url) === 'yuan-xiaoman';
}

const protectedMediaSessions = new WeakSet();
function configureMediaPermissions(mediaSession) {
  if (!mediaSession || typeof mediaSession.setPermissionRequestHandler !== 'function'
    || typeof mediaSession.setPermissionCheckHandler !== 'function' || protectedMediaSessions.has(mediaSession)) return;
  const allowedOrigin = value => {
    try { return new globalThis.URL(value).origin === new globalThis.URL(URL).origin; }
    catch { return false; }
  };
  const mediaAllowed = (page, types) => !!page && Array.isArray(types) && types.length > 0
    && types.every(type => type === 'audio' || (type === 'video' && page === 'yuan-xiaoman'));
  mediaSession.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
    const page = details.isMainFrame === true ? trustedMediaPage(contents, details.requestingUrl) : null;
    const originOK = !details.securityOrigin || allowedOrigin(details.securityOrigin);
    // Preserve the App's existing explicit Copy action without allowing reads.
    if (permission === 'clipboard-sanitized-write') return callback(!!page && originOK);
    callback(permission === 'media' && originOK && mediaAllowed(page, details.mediaTypes));
  });
  mediaSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details = {}) => {
    const page = details.isMainFrame === true ? trustedMediaPage(contents, details.requestingUrl) : null;
    if (!page || !allowedOrigin(requestingOrigin) || (details.securityOrigin && !allowedOrigin(details.securityOrigin))) return false;
    if (permission === 'clipboard-sanitized-write') return true;
    return permission === 'media' && mediaAllowed(page, [details.mediaType]);
  });
  protectedMediaSessions.add(mediaSession);
}

function taskCalendarURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const target = new globalThis.URL(value);
    if (target.origin !== new globalThis.URL(URL).origin || target.pathname !== '/task-calendar'
      || target.username || target.password) return null;
    return target.href;
  } catch { return null; }
}

function trackTaskCalendarWindow(win, initialURL) {
  const target = taskCalendarURL(initialURL);
  if (!target || win.isDestroyed()) return;
  const record = { initialURL: target, initialLoading: true };
  taskCalendarWindows.set(win, record);
  protectWindow(win,target);
  win.webContents.once('did-finish-load', () => { record.initialLoading = false; });
  win.on('closed', () => taskCalendarWindows.delete(win));
}

ipcMain.handle('zhiyu:task-calendar-reveal', (event, expectedURL) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    const senderURL = new globalThis.URL(event.senderFrame.url);
    if (senderURL.origin !== new globalThis.URL(URL).origin || senderURL.pathname !== '/') return false;
    const expected = taskCalendarURL(expectedURL);
    if (!expected) return false;
    for (const [win, record] of taskCalendarWindows) {
      if (win.isDestroyed()) { taskCalendarWindows.delete(win); continue; }
      const actualURL = win.webContents.getURL();
      const actual = taskCalendarURL(actualURL)
        || (record.initialLoading && (!actualURL || actualURL === 'about:blank') ? record.initialURL : null);
      if (actual !== expected) continue;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win.isVisible() && !win.isMinimized();
    }
  } catch { /* A closed or failed native window reports an explicit failure. */ }
  return false;
});

function recordMicrophonePermission(stage, status) {
  if (process.platform !== 'darwin') return;
  try {
    const logDir = path.join(os.homedir(), '.zhiyu');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'microphone-permission.log'),
      `${new Date().toISOString()} ${stage} ${status}\n`);
  } catch  { /* 诊断日志不能影响录音 */ }
}

ipcMain.handle('zhiyu:microphone-request', async event => {
  if (!isTrustedWindow(event)) return 'denied';
  if (process.platform !== 'darwin') return 'unknown';
  const status = systemPreferences.getMediaAccessStatus('microphone');
  recordMicrophonePermission('request', status);
  if (status === 'granted') return 'granted';
  if (status === 'denied' || status === 'restricted') return status;
  const result = await systemPreferences.askForMediaAccess('microphone') ? 'granted' : 'denied';
  recordMicrophonePermission('answer', result);
  return result;
});

ipcMain.handle('zhiyu:microphone-settings', async event => {
  if (!isTrustedWindow(event) || process.platform !== 'darwin') return false;
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  return true;
});

ipcMain.handle('zhiyu:camera-request', async event => {
  if (!trustedCameraSender(event)) return 'denied';
  if (process.platform !== 'darwin') return 'unknown';
  const status = systemPreferences.getMediaAccessStatus('camera');
  if (status === 'granted' || status === 'denied' || status === 'restricted') return status;
  try { return await systemPreferences.askForMediaAccess('camera') ? 'granted' : 'denied'; }
  catch { return 'unknown'; }
});

ipcMain.handle('zhiyu:camera-settings', async event => {
  if (!trustedCameraSender(event)) return false;
  const target = process.platform === 'darwin'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
    : process.platform === 'win32' ? 'ms-settings:privacy-webcam' : null;
  if (!target) return false;
  try { await shell.openExternal(target); return true; }
  catch { return false; }
});

function characterContentSize(requestedWidth, workArea) {
  const maxWidth = Math.max(1, Math.min(workArea.width - 40,
    (workArea.height - 40 - characterChromeHeight) * CHARACTER_SCENE_RATIO));
  const minWidth = Math.min(420, Math.floor(maxWidth));
  const width = Math.max(minWidth, Math.min(Math.round(requestedWidth), Math.floor(maxWidth)));
  return { width, height: Math.round(width / CHARACTER_SCENE_RATIO + characterChromeHeight), minWidth };
}

function resizeCharacterContent(win, requestedWidth) {
  if (win.isFullScreen()) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const size = characterContentSize(requestedWidth, workArea);
  const [contentWidth, contentHeight] = win.getContentSize();
  const [windowWidth, windowHeight] = win.getSize();
  adjustingCharacterSize = true;
  try {
    win.setMinimumSize(size.minWidth + windowWidth - contentWidth,
      Math.round(size.minWidth / CHARACTER_SCENE_RATIO + characterChromeHeight) + windowHeight - contentHeight);
    win.setContentSize(size.width, size.height);
  } finally { adjustingCharacterSize = false; }
}

function characterResizeBounds(win, proposed, edge) {
  const current = win.getBounds();
  const [contentWidth, contentHeight] = win.getContentSize();
  const frameWidth = current.width - contentWidth;
  const frameHeight = current.height - contentHeight;
  const vertical = edge === 'top' || edge === 'bottom';
  const requestedWidth = vertical
    ? (proposed.height - frameHeight - characterChromeHeight) * CHARACTER_SCENE_RATIO
    : proposed.width - frameWidth;
  const { workArea } = screen.getDisplayMatching(proposed);
  const size = characterContentSize(requestedWidth, workArea);
  const width = size.width + frameWidth;
  const height = size.height + frameHeight;
  // Preserve the opposite edge when dragging from the left/top.
  const x = edge.includes('left') ? current.x + current.width - width : proposed.x;
  const y = edge.includes('top') ? current.y + current.height - height : proposed.y;
  return { x, y, width, height };
}

function notifyCharacterWindowState() {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('zhiyu:character-window-state', characterPersonId);
}

ipcMain.handle('zhiyu:character-open', async (event, personId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !characterIds.has(personId)) return false;
  if (characterWindow && !characterWindow.isDestroyed()) {
    if (characterPersonId !== personId) {
      try {
        characterPersonId = personId;
        const target = `${URL}character-window?npc=${encodeURIComponent(personId)}`;
        await protectWindow(characterWindow,target).load(target);
      } catch  { return false; }
    }
    if (characterWindow.isMinimized()) characterWindow.restore();
    characterWindow.show();
    characterWindow.focus();
    notifyCharacterWindowState();
    return true;
  }

  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  characterChromeHeight = CHARACTER_DEFAULT_CHROME_HEIGHT;
  // Keep the original 576px scene height; widen the scene rather than shrinking the NPC.
  const { width, height, minWidth } = characterContentSize(1024, workArea);
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    minWidth,
    minHeight: Math.round(minWidth / CHARACTER_SCENE_RATIO + characterChromeHeight),
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    title: '智域 · 桌面人物',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 7 },
    backgroundColor: '#0b1928',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Opening the trusted character window is the user's call action.
      // This relaxes playback activation only; media capture stays gated above.
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  characterWindow = win;
  characterPersonId = personId;
  configureMediaPermissions(win.webContents.session);
  if (process.platform === 'darwin') win.setWindowButtonVisibility(true);
  const notifyFullScreen = () => {
    if (win.isDestroyed()) return;
    if (process.platform === 'darwin') win.setWindowButtonVisibility(!win.isFullScreen());
    win.webContents.send('zhiyu:character-fullscreen-state', win.isFullScreen());
  };
  win.on('enter-full-screen', notifyFullScreen);
  // Prevent a page title from introducing native title text above our one white bar.
  win.on('page-title-updated', (event) => event.preventDefault());
  // 只锁人物画面的比例，额外高度留给上下栏。
  win.setAspectRatio(CHARACTER_SCENE_RATIO, { width: 0, height: characterChromeHeight });
  win.on('will-resize', (event, proposed, details) => {
    if (adjustingCharacterSize || win.isDestroyed() || win.isFullScreen()) return;
    const bounds = characterResizeBounds(win, proposed, details.edge);
    if (Math.abs(bounds.width - proposed.width) <= 1 && Math.abs(bounds.height - proposed.height) <= 1) return;
    // Apply both dimensions together, before the browser can expose an empty strip.
    event.preventDefault();
    adjustingCharacterSize = true;
    try { win.setBounds(bounds); } finally { adjustingCharacterSize = false; }
  });
  win.on('resize', () => {
    if (adjustingCharacterSize || win.isDestroyed() || win.isFullScreen()) return;
    const [contentWidth, contentHeight] = win.getContentSize();
    if (Math.abs(contentHeight - characterChromeHeight - contentWidth / CHARACTER_SCENE_RATIO) <= 2) return;
    // setSize/系统放大不受原生 aspectRatio 约束，按可用区域兜底修正。
    resizeCharacterContent(win, Math.min(contentWidth,
      Math.max(1, contentHeight - characterChromeHeight) * CHARACTER_SCENE_RATIO));
  });
  win.on('leave-full-screen', () => {
    if (win.isDestroyed()) return;
    notifyFullScreen();
    win.setAspectRatio(CHARACTER_SCENE_RATIO, { width: 0, height: characterChromeHeight });
    resizeCharacterContent(win, win.getContentSize()[0]);
  });
  win.setMenuBarVisibility(false);
  win.center();
  win.on('closed', () => {
    if (characterWindow !== win) return;
    characterWindow = null;
    characterPersonId = null;
    notifyCharacterWindowState();
  });
  try {
    const target = `${URL}character-window?npc=${encodeURIComponent(personId)}`;
    await protectWindow(win,target).load(target);
    notifyCharacterWindowState();
    return true;
  } catch  {
    if (!win.isDestroyed()) win.close();
    return false;
  }
});

ipcMain.handle('zhiyu:character-close', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  if (characterWindow && !characterWindow.isDestroyed()) characterWindow.close();
  return true;
});

ipcMain.handle('zhiyu:character-chrome-height', (event, height) => {
  const win = characterWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !Number.isFinite(height)) return false;
  // Call controls overlay the scene. Hiding/showing its composer must never
  // resize the existing native window or change its aspect-ratio allowance.
  if (characterPersonId === 'yuan-xiaoman') return true;
  const next = Math.max(CHARACTER_DEFAULT_CHROME_HEIGHT, Math.min(320, Math.ceil(height)));
  if (next === characterChromeHeight) return true;
  characterChromeHeight = next;
  win.setAspectRatio(CHARACTER_SCENE_RATIO, { width: 0, height: next });
  resizeCharacterContent(win, win.getContentSize()[0]);
  return true;
});

ipcMain.handle('zhiyu:character-fullscreen-get', event => {
  const win = characterWindow;
  return !!win && !win.isDestroyed() && event.sender === win.webContents && win.isFullScreen();
});

ipcMain.handle('zhiyu:character-fullscreen-set', (event, fullscreen) => {
  const win = characterWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || typeof fullscreen !== 'boolean') return false;
  win.setFullScreen(fullscreen);
  return true;
});

function startServer() {
  const node = resolveNode();
  const cli = path.join(
    PROJECT_ROOT,
    'node_modules',
    'vinext',
    'dist',
    'cli.js'
  );
  if (!fs.existsSync(cli)) {
    throw new Error('missing-local-dependencies');
  }

  const logDir = path.join(os.homedir(), '.zhiyu');
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, 'server.log'), 'a');

  try {
    const child = spawn(node,
      [cli, 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
      {cwd:PROJECT_ROOT,detached:true,env:{...process.env,
        HOME:process.env.HOME || os.homedir(), ZHIYU_DESKTOP_RUNTIME:'1',
        PATH:[path.dirname(node),process.env.PATH,'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'].filter(Boolean).join(path.delimiter),
      },stdio:['ignore',logFd,logFd]});
    logRecovery('service-spawn',{pid:child.pid});
    return child;
  } finally { fs.closeSync(logFd); }
}

function stopOwnedServer(child) {
  // Never terminate a listener that was reused from a different process.
  if (!child || child.exitCode !== null || child.signalCode || !Number.isSafeInteger(child.pid) || child.pid<=0)
    return Promise.resolve();
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(forceTimer);clearTimeout(deadline);child.removeListener('exit',finish);resolve();};
    const signal=value=>{
      if(child.exitCode!==null||child.signalCode){finish();return;}
      try {process.kill(-child.pid,value);}
      catch {try {child.kill(value);} catch {finish();}}
    };
    child.once('exit',finish);
    const forceTimer=setTimeout(()=>{logRecovery('owned-service-force-stop',{pid:child.pid});signal('SIGKILL');},5000);
    const deadline=setTimeout(finish,10000);
    signal('SIGTERM');
  });
}

const serviceSupervisor = createServiceSupervisor({
  probe:()=>probeLocalService(`${URL}api/desktop/health`),start:startServer,stopOwned:stopOwnedServer,
  onState:state=>logRecovery('service-state',state),
});
function ensureServer() {
  return stopping ? Promise.resolve(false) : serviceSupervisor.ensure();
}
function stopServer() {
  if(shutdownPromise)return shutdownPromise;
  stopping=true;
  for(const controller of recoveryControllers.values())controller.dispose();
  recoveryControllers.clear();
  shutdownPromise=serviceSupervisor.stop();
  return shutdownPromise;
}
function requestQuit() {
  if(quitReady)return;
  void stopServer().finally(()=>{if(!quitReady){quitReady=true;app.quit();}});
}

void app.whenReady().then(async () => {
  if(!hasInstanceLock)return;
  if (process.platform === 'darwin')
    recordMicrophonePermission('startup', systemPreferences.getMediaAccessStatus('microphone'));

  // 恢复历史身份：种回 zhiyu_npc cookie，指向之前那个有 983 条消息的身份
  try {
    await session.defaultSession.cookies.set({
      url: URL,
      name: 'zhiyu_npc',
      value: NPC_ID,
      httpOnly: true,
      sameSite: 'strict',
      expirationDate: Math.floor(Date.now() / 1000) + 31536000,
    });
  } catch  { /* 非致命 */ }

  const { workArea } = screen.getPrimaryDisplay();
  const baseWindowWidth = Math.min(WINDOW_WIDTH, workArea.width);
  const windowHeight = Math.min(WINDOW_HEIGHT, workArea.height);
  const win = new BrowserWindow({
    width: baseWindowWidth,
    height: windowHeight,
    resizable: true,
    fullscreenable: true,
    maximizable: true,
    title: '智域',
    titleBarStyle: 'hidden',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#e8e8e8',
    // Native vibrancy keeps the main window resizable without transparent:true.
    ...(process.platform === 'darwin' ? {
      vibrancy: 'under-window',
      visualEffectState: 'active',
    } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      ...(process.platform === 'darwin' ? {
        additionalArguments: ['--zhiyu-native-material'],
      } : {}),
    },
  });
  mainWindow = win;
  profilePopover.attach(win);
  configureMediaPermissions(win.webContents.session);
  win.webContents.on('did-create-window', (child, details) => trackTaskCalendarWindow(child, details.url));
  win.setMenuBarVisibility(false);
  void protectWindow(win,URL).load();
  serviceSupervisor.startMonitoring();
  win.center();
  win.on('closed', () => {
    mainWindow = null;
    for (const child of taskCalendarWindows.keys()) {
      if (!child.isDestroyed()) child.destroy();
    }
    taskCalendarWindows.clear();
    imageViewer.close();
    if (characterWindow && !characterWindow.isDestroyed()) characterWindow.close();
  });
  powerMonitor.on('resume',()=>{if(!stopping)void ensureServer();});
});

function activateMainWindow() {
  if(stopping||!hasInstanceLock)return;
  if(mainWindow&&!mainWindow.isDestroyed()) {
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();mainWindow.focus();
    if(mainWindow.webContents.isCrashed())void protectWindow(mainWindow,URL).recover('activate');
  }
  void ensureServer();
}
app.on('activate',activateMainWindow);
app.on('second-instance',activateMainWindow);

app.on('window-all-closed', () => {
  requestQuit();
});

app.on('before-quit', event=>{
  if(quitReady||!hasInstanceLock)return;
  event.preventDefault();requestQuit();
});
process.on('exit', stopServer);
