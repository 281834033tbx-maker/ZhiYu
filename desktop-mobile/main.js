// 独立手机版预览壳。复用同一个本机 API，不接触现用桌面 App 的资料目录。
'use strict';

const { app, BrowserWindow, dialog, ipcMain, screen, shell, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolveProject, createServiceRuntime } = require('./service-runtime');

app.setName('智域手机版');
app.setPath('userData', path.join(app.getPath('appData'), '智域手机版'));
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
const PROJECT_ROOT = resolveProject({ resourcesPath: process.resourcesPath, dirname: __dirname });
const URL = 'http://localhost:3100/';
const MOBILE_URL = new globalThis.URL('mobile', URL).href;
const WINDOW_WIDTH = 426;
const WINDOW_HEIGHT = 900;
const runtime = PROJECT_ROOT ? createServiceRuntime({ project: PROJECT_ROOT, baseURL: URL,
  logDirectory: app.getPath('userData') }) : null;
let mainWindow = null;
let characterWindow = null;
let characterPersonId = null;
const taskCalendarWindows = new Map();
const CHARACTER_SCENE_RATIO = 16 / 9;
const CHARACTER_DEFAULT_CHROME_HEIGHT = 28 + 54;
let characterChromeHeight = CHARACTER_DEFAULT_CHROME_HEIGHT;
let adjustingCharacterSize = false;
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
// Archived Zhao links stay valid; Zhou has an independent identity and no AI backend yet.
const characterIds = new Set(['chen-nian', 'he-jiawei', 'zhou-chef', 'zhao-yifan', 'yuan-xiaoman', 'xia-xia', 'liu', 'molly']);
const imageViewer = require('./image-viewer').registerImageViewer({
  baseURL: URL,
  preload: path.join(__dirname, 'preload.js'),
  allowedSender: sender => [mainWindow, characterWindow].some(win =>
    win && !win.isDestroyed() && win.webContents === sender &&
    sender.getURL().startsWith(URL)),
});

function isTrustedWindow(event) {
  return [mainWindow, characterWindow].some(win =>
    win && !win.isDestroyed() && win.webContents === event.sender &&
    event.senderFrame?.url.startsWith(URL));
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
  win.webContents.once('did-finish-load', () => { record.initialLoading = false; });
  win.on('closed', () => taskCalendarWindows.delete(win));
}

ipcMain.handle('zhiyu:task-calendar-reveal', (event, expectedURL) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    const senderURL = new globalThis.URL(event.senderFrame.url);
    if (senderURL.origin !== new globalThis.URL(URL).origin || senderURL.pathname !== '/mobile') return false;
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
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'microphone-permission.log'),
      `${new Date().toISOString()} ${stage} ${status}\n`);
  } catch (_) { /* 诊断日志不能影响录音 */ }
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
        await characterWindow.loadURL(`${URL}character-window?npc=${encodeURIComponent(personId)}`);
        characterPersonId = personId;
      } catch (_) { return false; }
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
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  characterWindow = win;
  characterPersonId = personId;
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', (event, target) => {
    try {
      const next = new globalThis.URL(target);
      if (next.origin !== new globalThis.URL(URL).origin || next.pathname !== '/character-window') event.preventDefault();
    } catch { event.preventDefault(); }
  });
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
    await win.loadURL(`${URL}character-window?npc=${encodeURIComponent(personId)}`);
    notifyCharacterWindowState();
    return true;
  } catch (_) {
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

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  if (!runtime) {
    dialog.showErrorBox('智域手机版', '找不到智域项目依赖。请把手机版 App 保留在原项目 desktop-mobile/dist/mac-arm64 目录中，或设置 ZHIYU_PROJECT。');
    app.quit();
    return;
  }
  if (process.platform === 'darwin')
    recordMicrophonePermission('startup', systemPreferences.getMediaAccessStatus('microphone'));
  const ready = await runtime.ensure();
  if (!ready) {
    dialog.showErrorBox(
      '智域手机版',
      `本机智域服务暂时无法连接。已有服务不会被替换或停止。\n\n${runtime.error || '请确认本机 3100 端口提供智域服务。'}\n日志：${runtime.logPath}`
    );
    runtime.stop();
    app.quit();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const scale = Math.min(1, (workArea.width - 32) / WINDOW_WIDTH, (workArea.height - 32) / WINDOW_HEIGHT);
  const baseWindowWidth = Math.floor(WINDOW_WIDTH * scale);
  const windowHeight = Math.floor(WINDOW_HEIGHT * scale);
  const win = new BrowserWindow({
    width: baseWindowWidth,
    height: windowHeight,
    useContentSize: true,
    minWidth: Math.min(360, baseWindowWidth),
    minHeight: Math.min(760, windowHeight),
    resizable: true,
    fullscreenable: false,
    maximizable: false,
    title: '智域手机版',
    frame: false,
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
  if (process.platform === 'darwin') win.setWindowButtonVisibility(false);
  win.setAspectRatio(WINDOW_WIDTH / WINDOW_HEIGHT);
  win.on('page-title-updated', event => event.preventDefault());
  win.webContents.on('will-navigate', (event, target) => {
    try {
      const next = new globalThis.URL(target);
      if (next.origin !== new globalThis.URL(URL).origin || next.pathname !== '/mobile') event.preventDefault();
    } catch { event.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(({url}) => {
    if (!taskCalendarURL(url)) return {action:'deny'};
    return {action:'allow', overrideBrowserWindowOptions:{webPreferences:{
      contextIsolation:true, nodeIntegration:false, sandbox:true, preload:path.join(__dirname,'preload.js'),
    }}};
  });
  win.webContents.on('did-create-window', (child, details) => trackTaskCalendarWindow(child, details.url));
  win.setMenuBarVisibility(false);
  win.loadURL(MOBILE_URL);
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
});

app.on('window-all-closed', () => {
  runtime?.stop();
  app.quit();
});

app.on('before-quit', () => runtime?.stop());
process.on('exit', () => runtime?.stop());
