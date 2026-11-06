'use strict';
// oxlint-disable-next-line typescript/no-require-imports -- Native .cjs integration harness uses Node VM and entirely synthetic Electron/process/filesystem dependencies.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { EventEmitter } = require('node:events');
const sourcePath = path.resolve(__dirname, '../main.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fakeClock() {
  let now = 0, nextId = 0; const timers = new Map();
  const setTimeout = (callback, ms) => { const handle = { id: ++nextId, unref() {} }; timers.set(handle, { callback, due: now + ms }); return handle; };
  const clearTimeout = handle => { timers.delete(handle); };
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const entry = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      now = entry[1].due; timers.delete(entry[0]); entry[1].callback();
    }
    now = target;
  }
  return { setTimeout, clearTimeout, advance, timers };
}
function fixture({ lock = true, ensureResult = Promise.resolve(true), stopResult = Promise.resolve() } = {}) {
  const app = new EventEmitter(), powerMonitor = new EventEmitter(), processEvents = new EventEmitter(), ready = deferred(), clock = fakeClock();
  const windows = [], controllers = [], calls = { lock: 0, quit: 0, monitor: 0, ensure: 0, stop: 0, fs: [], spawn: [], signals: [], probes: [], cookies: [] };
  let serviceOptions, spawnFailure = false;
  const supervisor = { ensure: () => { calls.ensure++; return ensureResult; }, startMonitoring: () => { calls.monitor++; }, stop: () => { calls.stop++; return stopResult; }, getState: () => ({ phase: 'healthy' }) };
  app.requestSingleInstanceLock = () => { calls.lock++; return lock; };
  app.whenReady = () => ready.promise;
  app.quit = () => { calls.quit++; app.emit('before-quit', { preventDefault() { calls.quitPrevented = (calls.quitPrevented || 0) + 1; } }); };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.draft = 'synthetic unsent draft'; this.visible = true;
      this.webContents = new EventEmitter(); this.webContents.session = {}; this.webContents.send = () => {};
      this.webContents.isCrashed = () => Boolean(this.crashed); this.webContents.getURL = () => 'http://localhost:3100/';
      windows.push(this);
    }
    isDestroyed() { return Boolean(this.destroyed); } isMinimized() { return Boolean(this.minimized); }
    restore() { this.restores = (this.restores || 0) + 1; this.minimized = false; }
    show() { this.shows = (this.shows || 0) + 1; } focus() { this.focuses = (this.focuses || 0) + 1; }
    setMenuBarVisibility() {} center() {} close() { this.destroyed = true; this.emit('closed'); }
    loadURL() { throw Error('main integration must delegate navigation to the recovery controller'); }
  }
  const fakeFs = {
    existsSync(value) { calls.fs.push(['exists', value]); return value.endsWith('/cli.js') || value.endsWith('/node'); },
    mkdirSync(value) { calls.fs.push(['mkdir', value]); },
    openSync(value, mode) { calls.fs.push(['open', value, mode]); return 77; },
    closeSync(value) { calls.fs.push(['close', value]); },
    appendFileSync(value) { calls.fs.push(['append', value]); },
    statSync() { throw Error('unexpected filesystem stat'); }, renameSync() { throw Error('unexpected filesystem rename'); },
    readFileSync() { throw Error('runtime must not read the real user filesystem'); },
  };
  const fakeProcess = { platform: 'darwin', resourcesPath: '/synthetic/resources',
    env: { ZHIYU_PROJECT: '/synthetic-project', NODE_BIN: '/synthetic-node/bin/node', ZHIYU_NPC_ID: 'synthetic-owner', PATH: '/synthetic-node/bin:/usr/bin', HOME: '/synthetic-home' },
    on: processEvents.on.bind(processEvents), kill: (pid, signal) => { calls.signals.push([pid, signal]); },
  };
  const electron = { app, powerMonitor, BrowserWindow: Window, ipcMain: { handle() {} },
    screen: { getPrimaryDisplay: () => ({ workArea: { width: 1440, height: 1080 } }) },
    session: { defaultSession: { cookies: { set: async cookie => { calls.cookies.push(cookie); } } } },
    systemPreferences: { getMediaAccessStatus: () => 'not-determined' }, shell: {},
  };
  const fakeRequire = name => {
    if (name === 'electron') return electron;
    if (name === 'fs') return fakeFs;
    if (name === 'os') return { homedir: () => '/synthetic-home' };
    if (name === 'path') return path;
    if (name === 'child_process') return { spawn: (...args) => {
      calls.spawn.push(args); if (spawnFailure) throw Error('synthetic spawn failure');
      const child = new EventEmitter(); child.pid = 43210; child.exitCode = null; child.signalCode = null; child.kill = () => {}; return child;
    } };
    if (name === './service-supervisor.cjs') return {
      createServiceSupervisor: options => { serviceOptions = options; return supervisor; },
      probeLocalService: async url => { calls.probes.push(url); return { kind: 'healthy', pid: 43210, instanceId: 'synthetic-boot' }; },
    };
    if (name === './window-recovery.cjs') return { attachWindowRecovery: (win, options) => {
      const item = { win, options, loads: 0, recoveries: [], disposals: 0 };
      const controller = { load: () => { item.loads++; return options.ensureService(); },
        recover: reason => { item.recoveries.push(reason); return Promise.resolve(true); },
        dispose: () => { if (!item.disposals) item.disposals++; } };
      item.controller = controller; controllers.push(item); return controller;
    } };
    if (name === './profile-popover.cjs') return {registerProfilePopover:()=>({attach(){},close(){}})};
    if (name === './image-viewer') return { registerImageViewer: () => ({ close() {} }) };
    if (name === './local-identity.cjs') return { resolveLocalIdentity: () => 'synthetic-owner' };
    throw Error('Unexpected production dependency: ' + name);
  };
  const context = vm.createContext({ require: fakeRequire, process: fakeProcess, __dirname: '/synthetic-project/desktop', console, URL,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  vm.runInContext(source, context, { filename: sourcePath });
  return { app, powerMonitor, processEvents, windows, controllers, calls, clock, options: () => serviceOptions,
    ready: async () => { ready.resolve(); await flush(); }, spawnFailure: value => { spawnFailure = value; } };
}

test('single-instance loser quits without creating windows, probing, starting or monitoring', async () => {
  const f = fixture({ lock: false }); await f.ready(); f.app.emit('activate'); f.app.emit('second-instance');
  assert.equal(f.calls.lock, 1); assert.equal(f.calls.quit, 1); assert.equal(f.windows.length, 0);
  assert.equal(f.calls.ensure, 0); assert.equal(f.calls.monitor, 0); assert.equal(f.calls.spawn.length, 0);
});

test('ready creates and protects the original window before waiting for service; health uses only the fixed endpoint', async () => {
  const unavailable = deferred(), f = fixture({ ensureResult: unavailable.promise }); await f.ready();
  assert.equal(f.windows.length, 1); assert.equal(f.controllers.length, 1); assert.equal(f.controllers[0].loads, 1);
  assert.equal(f.calls.ensure, 1); assert.equal(f.calls.monitor, 1);
  assert.equal(f.controllers[0].options.targetURL, 'http://localhost:3100/');
  assert.equal(f.controllers[0].options.statusFile, '/synthetic-project/desktop/service-status.html');
  assert.equal(f.controllers[0].options.startupFile, '/synthetic-project/desktop/startup.html');
  assert.equal(f.windows[0].options.webPreferences.contextIsolation, true); assert.equal(f.windows[0].options.webPreferences.nodeIntegration, false);
  await f.options().probe(); assert.deepEqual(f.calls.probes, ['http://localhost:3100/api/desktop/health']);
  assert.equal(f.calls.cookies[0].url, 'http://localhost:3100/'); assert.equal(f.calls.cookies[0].value, 'synthetic-owner');
  unavailable.resolve(false); await flush();
  assert.ok(f.calls.fs.every(call => !String(call[1]).includes('/Users/')), 'all runtime fs access is synthetic');
});

test('activate, second-instance and resume recheck service without replacing a healthy draft', async () => {
  const f = fixture(); await f.ready(); const win = f.windows[0], controller = f.controllers[0];
  win.minimized = true; const before = f.calls.ensure;
  f.app.emit('activate'); f.app.emit('second-instance'); f.powerMonitor.emit('resume'); await flush();
  assert.equal(f.calls.ensure, before + 3); assert.equal(win.restores, 1); assert.equal(win.shows, 2); assert.equal(win.focuses, 2);
  assert.equal(controller.loads, 1); assert.equal(controller.recoveries.length, 0); assert.equal(win.draft, 'synthetic unsent draft');
  win.crashed = true; f.app.emit('activate'); await flush(); assert.deepEqual(controller.recoveries, ['activate']);
});

test('service startup passes desktop runtime and closes the parent log descriptor on success and throw', () => {
  const f = fixture(), start = f.options().start; const child = start();
  assert.equal(child.pid, 43210); const [node, args, options] = f.calls.spawn[0];
  assert.equal(node, '/synthetic-node/bin/node'); assert.equal(options.cwd, '/synthetic-project'); assert.equal(options.detached, true);
  assert.equal(options.env.ZHIYU_DESKTOP_RUNTIME, '1'); assert.equal(options.env.ZHIYU_NPC_ID, 'synthetic-owner');
  assert.ok(Array.from(args).includes('--strictPort')); assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1');
  assert.deepEqual(Array.from(options.stdio), ['ignore', 77, 77]); assert.equal(f.calls.fs.filter(call => call[0] === 'close').length, 1);
  f.spawnFailure(true); assert.throws(start, /synthetic spawn failure/);
  assert.equal(f.calls.fs.filter(call => call[0] === 'close').length, 2, 'finally closes the descriptor when spawn throws');
});

test('before-quit waits for cleanup and repeated close/quit events produce exactly one final quit', async () => {
  const cleanup = deferred(), f = fixture({ stopResult: cleanup.promise }); await f.ready(); let prevented = 0;
  f.app.emit('before-quit', { preventDefault() { prevented++; } });
  f.app.emit('before-quit', { preventDefault() { prevented++; } }); f.app.emit('window-all-closed');
  assert.equal(prevented, 2); assert.equal(f.calls.stop, 1); assert.equal(f.calls.quit, 0); assert.equal(f.controllers[0].disposals, 1);
  const before = f.calls.ensure; f.app.emit('activate'); f.app.emit('second-instance'); f.powerMonitor.emit('resume');
  assert.equal(f.calls.ensure, before, 'shutdown never schedules service work');
  cleanup.resolve(); await flush(); assert.equal(f.calls.quit, 1); assert.equal(f.calls.quitPrevented || 0, 0);
  f.processEvents.emit('exit'); f.app.emit('window-all-closed'); await flush(); assert.equal(f.calls.stop, 1); assert.equal(f.calls.quit, 1);
});

function child(pid = 43210) { const value = new EventEmitter(); value.pid = pid; value.exitCode = null; value.signalCode = null; value.kill = () => {}; return value; }
test('owned shutdown sends TERM then KILL at five seconds and clears timers on actual exit', async () => {
  const f = fixture(), owned = child(), pending = f.options().stopOwned(owned);
  assert.deepEqual(f.calls.signals, [[-43210, 'SIGTERM']]); f.clock.advance(4999); assert.equal(f.calls.signals.length, 1);
  f.clock.advance(1); assert.deepEqual(f.calls.signals, [[-43210, 'SIGTERM'], [-43210, 'SIGKILL']]);
  owned.exitCode = 0; owned.emit('exit', 0); await pending; assert.equal(f.clock.timers.size, 0);
  f.clock.advance(30000); assert.equal(f.calls.signals.length, 2); assert.equal(owned.listenerCount('exit'), 0);
});

test('TERM exit cancels forced kill; ignored signals still finish within ten seconds', async () => {
  const f = fixture(), first = child(), early = f.options().stopOwned(first);
  first.signalCode = 'SIGTERM'; first.emit('exit', null, 'SIGTERM'); await early;
  f.clock.advance(15000); assert.equal(f.calls.signals.length, 1); assert.equal(f.clock.timers.size, 0);
  const second = child(43211), bounded = f.options().stopOwned(second); f.clock.advance(10000); await bounded;
  assert.deepEqual(f.calls.signals.slice(1), [[-43211, 'SIGTERM'], [-43211, 'SIGKILL']]); assert.equal(f.clock.timers.size, 0);
});

test('unknown, already exited, signalled and invalid PID values are never killed', async () => {
  const f = fixture();
  const values = [undefined, null, {}, child(0), child(-1), child(1.5), child(NaN), child(Infinity), child('43210')];
  const exited = child(); exited.exitCode = 0; values.push(exited);
  const signalled = child(); signalled.signalCode = 'SIGTERM'; values.push(signalled);
  for (const value of values) await f.options().stopOwned(value);
  assert.equal(f.calls.signals.length, 0); assert.equal(f.clock.timers.size, 0);
});
