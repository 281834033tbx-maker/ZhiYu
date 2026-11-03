'use strict';

// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const { BrowserWindow, ipcMain, screen, dialog, clipboard, nativeImage, net } = require('electron');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const fs = require('node:fs/promises');
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron / .cjs harness requires CommonJS at this boundary.
const _path = require('node:path');

const TOOLBAR_HEIGHT = 34;
// Default window bounds, including toolbar/sidebar; resizing/fullscreen remains unrestricted.
const DEFAULT_VIEWPORT_FRACTION = 0.75;
const HISTORY_WIDTH = 216;
const MAX_BYTES = 40 * 1024 * 1024;

function imageWindowSize(imageWidth, imageHeight, workArea, history = false) {
  const sidebar = history ? HISTORY_WIDTH : 0;
  const maxWidth = Math.min(workArea.width - 40, Math.floor(workArea.width * DEFAULT_VIEWPORT_FRACTION));
  const maxHeight = Math.min(workArea.height - 40, Math.floor(workArea.height * DEFAULT_VIEWPORT_FRACTION));
  const scale = Math.min(1, (maxWidth - sidebar) / imageWidth,
    (maxHeight - TOOLBAR_HEIGHT) / imageHeight);
  return { width: Math.max(1, Math.round(imageWidth * scale)) + sidebar,
    height: Math.max(1, Math.round(imageHeight * scale)) + TOOLBAR_HEIGHT };
}

function registerImageViewer({ baseURL, preload, allowedSender }) {
  let win = null;
  let state = null;
  let dimensions = null;
  let opening = null;
  const owned = event => win && !win.isDestroyed() && event.sender === win.webContents;
  const emit = () => {
    if (win && !win.isDestroyed()) win.webContents.send('zhiyu:image-state', state);
  };
  const validSource = source => {
    if (typeof source !== 'string' || source.length > MAX_BYTES * 1.4) return false;
    if (/^data:image\/(png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(source)) return true;
    try {
      const url = new URL(source, baseURL);
      return url.origin === new URL(baseURL).origin && !url.username && !url.password &&
        (/^\/(npc|stitch|desktop-npc|pets)\//.test(url.pathname) ||
          /^\/api\/npc\/(media|images)\//.test(url.pathname));
    } catch { return false; }
  };
  const normalize = payload => {
    if (!payload || typeof payload.conversationId !== 'string' || !Array.isArray(payload.images) ||
      !payload.images.length || payload.images.length > 10000) return null;
    if (!payload.images.every(item => item && typeof item.id === 'string' && validSource(item.src))) return null;
    const images = payload.images.map(item => ({ id: item.id, src: item.src,
      alt: typeof item.alt === 'string' ? item.alt.slice(0, 1000) : '聊天图片',
      at: typeof item.at === 'string' ? item.at : undefined,
      sender: typeof item.sender === 'string' ? item.sender : undefined }));
    const index = Number.isInteger(payload.index) ? payload.index : 0;
    if (index < 0 || index >= images.length) return null;
    return { conversationId: payload.conversationId, images, index,
      history: false, pinned: false };
  };
  function fit() {
    if (!win || win.isDestroyed() || !dimensions || win.isFullScreen()) return;
    if (win.isMaximized()) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const size = imageWindowSize(dimensions.width, dimensions.height, area, state.history);
    win.setAspectRatio(dimensions.width / dimensions.height,
      { width: state.history ? HISTORY_WIDTH : 0, height: TOOLBAR_HEIGHT });
    win.setContentSize(size.width, size.height);
    const bounds = win.getBounds();
    win.setPosition(Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
      Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)));
  }
  ipcMain.handle('zhiyu:image-open', async (event, payload) => {
    if (!allowedSender(event.sender)) return false;
    const next = normalize(payload);
    if (!next) return false;
    state = next;
    dimensions = null;
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      if (win.isMinimized()) win.restore();
      emit();
      win.show(); win.focus();
      return true;
    }
    const viewer = new BrowserWindow({ width: 640, height: 400, show: false,
      useContentSize: true, resizable: true, minimizable: true, maximizable: true,
      fullscreenable: true, frame: false, titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 11 }, title: '智域 · 图片',
      backgroundColor: '#f3f3f3', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false,
        sandbox: true, preload } });
    win = viewer;
    if (process.platform === 'darwin') viewer.setWindowButtonVisibility(true);
    viewer.setMenuBarVisibility(false);
    viewer.center();
    viewer.on('page-title-updated', event => event.preventDefault());
    viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    viewer.webContents.on('will-navigate', (event, target) => {
      if (target !== new URL('image-viewer', baseURL).href) event.preventDefault();
    });
    viewer.on('closed', () => { if (win === viewer) { win = null; state = null; dimensions = null; } });
    opening = viewer.loadURL(new URL('image-viewer', baseURL).href);
    try { await opening; if (!viewer.isDestroyed()) { viewer.show(); viewer.focus(); } return true; }
    catch { if (!viewer.isDestroyed()) viewer.close(); return false; }
    finally { opening = null; }
  });
  ipcMain.handle('zhiyu:image-get', event => owned(event) ? state : null);
  ipcMain.handle('zhiyu:image-update', (event, payload) => {
    if (!allowedSender(event.sender) || !state || payload?.conversationId !== state.conversationId) return false;
    const next = normalize(payload);
    if (!next) return false;
    const id = state.images[state.index]?.id;
    const index = next.images.findIndex(item => item.id === id);
    state = { ...state, images: next.images, index: index < 0 ? 0 : index };
    emit(); return true;
  });
  ipcMain.handle('zhiyu:image-fit', (event, payload) => {
    if (!owned(event) || payload?.id !== state.images[state.index]?.id ||
      !Number.isFinite(payload.width) || !Number.isFinite(payload.height) ||
      payload.width < 1 || payload.height < 1 || payload.width > 50000 || payload.height > 50000) return false;
    dimensions = { width: payload.width, height: payload.height };
    fit(); return true;
  });
  ipcMain.handle('zhiyu:image-select', (event, index) => {
    if (!owned(event) || !Number.isInteger(index) || index < 0 || index >= state.images.length) return false;
    state = { ...state, index }; dimensions = null; emit(); return true;
  });
  ipcMain.handle('zhiyu:image-history', (event, visible) => {
    if (!owned(event) || typeof visible !== 'boolean') return false;
    state = { ...state, history: visible }; fit(); emit(); return true;
  });
  ipcMain.handle('zhiyu:image-pin', event => {
    if (!owned(event)) return false;
    win.setAlwaysOnTop(!win.isAlwaysOnTop());
    state = { ...state, pinned: win.isAlwaysOnTop() }; emit(); return state.pinned;
  });
  ipcMain.handle('zhiyu:image-control', (event, action) => {
    if (!owned(event)) return false;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.setFullScreen(!win.isFullScreen());
    else return false;
    return true;
  });
  ipcMain.handle('zhiyu:image-copy', async (event, bytes) => {
    if (!owned(event)) return { error: '无权操作图片窗口' };
    try {
      const buffer = Buffer.from(bytes || []);
      if (!buffer.length || buffer.length > MAX_BYTES ||
        !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('无法复制这张图片');
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) throw Error('无法解码这张图片');
      clipboard.writeImage(image);
      return { ok: true };
    } catch (error) { return { error: error.message || '复制失败，请重试' }; }
  });
  ipcMain.handle('zhiyu:image-save', async (event, id) => {
    if (!owned(event)) return { error: '无权操作图片窗口' };
    const selected = state.images[state.index];
    if (id !== selected.id) return { error: '图片已经切换，请重试' };
    const owner = win;
    try {
      const source = selected.src.startsWith('data:image/') ? selected.src : new URL(selected.src, baseURL).href;
      const response = await net.fetch(source, { redirect: 'error' });
      if (!response.ok) throw Error('图片读取失败，请重试');
      const mime = response.headers.get('content-type')?.split(';')[0];
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
        'image/gif': 'gif', 'image/avif': 'avif' }[mime];
      if (!extension) throw Error('文件不是支持的图片');
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw Error('图片过大');
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw Error('图片过大'); }
          chunks.push(Buffer.from(value)); }
      } finally { reader.releaseLock(); }
      if (owner.isDestroyed()) return { canceled: true };
      const result = await dialog.showSaveDialog(owner, { title: '保存图片',
        defaultPath: `智域图片-${Date.now()}.${extension}`,
        filters: [{ name: '图片', extensions: [extension] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.writeFile(result.filePath, Buffer.concat(chunks));
      return { ok: true };
    } catch (error) { return { error: error.message || '保存失败，请重试' }; }
  });
  return { close: () => { if (win && !win.isDestroyed()) win.close(); } };
}

module.exports = { registerImageViewer, imageWindowSize, TOOLBAR_HEIGHT, HISTORY_WIDTH, DEFAULT_VIEWPORT_FRACTION };
