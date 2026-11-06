'use strict';
// A same-origin, script-created profile surface. This has no Node/preload or
// independent account/session state: React keeps ownership in the main page.
// oxlint-disable-next-line typescript/no-require-imports -- Native Electron module.
const {randomUUID} = require('node:crypto');
const PREFIX = 'zhiyu-profile-';
const PADDING = 12;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

function validAnchor(value) {
  return value && ['x','y','width','height'].every(key => finite(value[key]))
    && Math.abs(value.x) <= 100000 && Math.abs(value.y) <= 100000
    && value.width > 0 && value.width <= 10000 && value.height > 0 && value.height <= 10000;
}
function profileBounds(parentBounds, anchor, width, naturalHeight, area, zoom = 1) {
  const z = finite(zoom) && zoom >= .25 && zoom <= 5 ? zoom : 1;
  const margin = 8, gap = 10 * z;
  const left = parentBounds.x + anchor.x * z;
  const top = parentBounds.y + anchor.y * z;
  const bottom = top + anchor.height * z;
  const w = Math.min(Math.ceil((width + PADDING * 2) * z), Math.max(1, area.width - margin * 2));
  const h = Math.min(Math.ceil((naturalHeight + PADDING * 2) * z), Math.max(1, area.height - margin * 2));
  const below = area.y + area.height - margin - bottom - gap;
  const above = top - gap - area.y - margin;
  const side = h <= below || below >= above ? 'bottom' : 'top';
  const x = Math.round(clamp(left - PADDING * z, area.x + margin, area.x + area.width - margin - w));
  const y = Math.round(clamp(side === 'bottom' ? bottom + gap - PADDING * z : top - gap - h + PADDING * z,
    area.y + margin, area.y + area.height - margin - h));
  return {bounds:{x,y,width:w,height:h},layout:{width:w / z,height:h / z,
    anchorX:(left + anchor.width * z / 2 - x) / z,anchorY:(top + anchor.height * z / 2 - y) / z,side}};
}

function registerProfilePopover({ipcMain,screen,baseURL,getParent,allowExistingWindow}) {
  let prepared = null, current = null;
  const attached = new WeakSet();
  function trusted(event) {
    const parent = getParent();
    if (!parent || parent.isDestroyed() || event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame) return false;
    try {
      const actual = new URL(event.senderFrame.url), base = new URL(baseURL);
      return actual.origin === base.origin && actual.pathname === '/' && !actual.username && !actual.password;
    } catch {return false;}
  }
  const emit = (channel, payload) => {
    const parent = getParent();
    if (parent && !parent.isDestroyed() && !parent.webContents.isDestroyed?.()) parent.webContents.send(channel,payload);
  };
  function discardPrepared() {if (prepared?.timer) clearTimeout(prepared.timer); prepared = null;}
  function close(id) {
    if (prepared && (!id || prepared.id === id)) discardPrepared();
    if (!current || (id && current.id !== id)) return;
    const record = current; current = null;
    clearTimeout(record.dismissTimer);
    if (!record.win.isDestroyed()) record.win.close();
  }
  function reposition(record = current) {
    if (!record || record !== current || record.win.isDestroyed()) return null;
    const parent = getParent();
    if (!parent || parent.isDestroyed()) {close(record.id); return null;}
    const parentBounds = parent.getContentBounds();
    const zoom = parent.webContents.getZoomFactor?.() || 1;
    if (record.win.webContents.getZoomFactor?.() !== zoom) record.win.webContents.setZoomFactor?.(zoom);
    const globalAnchor = {x:parentBounds.x + record.anchor.x * zoom,y:parentBounds.y + record.anchor.y * zoom,
      width:record.anchor.width * zoom,height:record.anchor.height * zoom};
    const area = screen.getDisplayMatching(globalAnchor).workArea;
    const result = profileBounds(parentBounds,record.anchor,record.width,record.height,area,zoom);
    const old = record.win.getBounds();
    if (Object.keys(result.bounds).some(key => old[key] !== result.bounds[key])) record.win.setBounds(result.bounds);
    emit('zhiyu:profile-layout',{id:record.id,...result.layout});
    return result.layout;
  }
  ipcMain.handle('zhiyu:profile-prepare',(event,payload) => {
    if (!trusted(event) || !validAnchor(payload?.anchor)) return null;
    close();
    const id = randomUUID();
    const width = finite(payload.width) ? clamp(payload.width,200,420) : 277.5;
    const record = {id,name:PREFIX + id,anchor:{...payload.anchor},width,height:240,expires:Date.now()+5000};
    record.timer = setTimeout(() => {if (prepared === record) prepared = null;},5000); record.timer.unref?.();
    prepared = record;
    return {id,name:record.name};
  });
  ipcMain.handle('zhiyu:profile-fit',(event,payload) => {
    if (!trusted(event) || !current || payload?.id !== current.id || !finite(payload.height) || payload.height < 1 || payload.height > 20000 || !validAnchor(payload.anchor)) return null;
    current.anchor = {...payload.anchor}; current.height = payload.height;
    const layout = reposition();
    if (layout && !current.win.isVisible()) {current.win.show(); current.win.focus();}
    return layout;
  });
  ipcMain.handle('zhiyu:profile-close',(event,id) => {
    if (!trusted(event) || typeof id !== 'string') return false;
    const exists = current?.id === id || prepared?.id === id;
    close(id); return exists;
  });
  function attach(parent) {
    if (attached.has(parent)) return; attached.add(parent);
    parent.webContents.setWindowOpenHandler(details => {
      if (details.url === 'about:blank' && prepared && !prepared.used && details.frameName === prepared.name && prepared.expires >= Date.now()) {
        prepared.used = true;
        const bounds = parent.getContentBounds(), zoom = parent.webContents.getZoomFactor?.() || 1;
        const area = screen.getDisplayMatching(bounds).workArea;
        const placement = profileBounds(bounds,prepared.anchor,prepared.width,prepared.height,area,zoom);
        return {action:'allow',overrideBrowserWindowOptions:{...placement.bounds,parent,show:false,frame:false,transparent:true,
          backgroundColor:'#00000000',hasShadow:false,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,
          ...(process.platform === 'darwin' ? {vibrancy:'under-window',visualEffectState:'active'} : {}),
          webPreferences:{preload:'',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}}};
      }
      return allowExistingWindow?.(details) ? {action:'allow'} : {action:'deny'};
    });
    parent.webContents.on('did-create-window',(win,details) => {
      if (!details.frameName?.startsWith(PREFIX)) return;
      if (!prepared || !prepared.used || details.url !== 'about:blank' || details.frameName !== prepared.name || prepared.expires < Date.now()) {win.close();return;}
      const record = {...prepared,win,dismissTimer:null}; discardPrepared(); current = record;
      win.webContents.setZoomFactor?.(parent.webContents.getZoomFactor?.() || 1);
      win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      win.webContents.on('will-navigate',event => event.preventDefault());
      win.webContents.on('will-redirect',event => event.preventDefault());
      win.webContents.on('render-process-gone',() => close(record.id));
      win.on('unresponsive',() => close(record.id));
      win.on('blur',() => {
        if (current !== record) return;
        emit('zhiyu:profile-dismiss',{id:record.id});
        clearTimeout(record.dismissTimer);
        record.dismissTimer = setTimeout(() => close(record.id),700); record.dismissTimer.unref?.();
      });
      win.on('closed',() => {
        clearTimeout(record.dismissTimer);
        if (current === record) current = null;
        emit('zhiyu:profile-closed',{id:record.id});
      });
      reposition(record);
    });
    const move = () => reposition();
    parent.on('move',move); parent.on('resize',move);
    parent.on('minimize',() => close());
    parent.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame) => {if(isMainFrame)close();});
    parent.on('closed',() => {close();parent.removeListener('move',move);parent.removeListener('resize',move);});
  }
  return {attach,close};
}
module.exports = {registerProfilePopover,profileBounds,validAnchor};
