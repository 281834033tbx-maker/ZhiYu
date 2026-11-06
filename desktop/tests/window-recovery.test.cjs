'use strict';

/* oxlint-disable typescript/no-require-imports -- This VM harness exercises the CommonJS Electron main-process boundary. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const source = fs.readFileSync(path.join(__dirname, '../window-recovery.cjs'), 'utf8');
const statusFile = path.join(__dirname, '../service-status.html');
const startupFile = path.join(__dirname, '../startup.html');
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const watchdog=setTimeout(()=>{console.error('Window recovery regression did not finish its fake-clock promises');process.exitCode=1;},2000);

function harness({startup = false} = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const clock = {
    async tick(ms) {
      const until = now + ms;
      let count = 0;
      for (;;) {
        await flush();
        const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++count < 1000, 'no recovery timer storm');
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
      await flush();
    },
  };
  const context = vm.createContext({
    module: { exports: {} }, require, console,
    Date: { now: () => now },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context);
  class Window extends EventEmitter {
    constructor() {
      super(); this.webContents = new EventEmitter(); this.url = ''; this.urls = []; this.files = []; this.destroyed = false;
      this.webContents.getURL = () => this.url;
    }
    isDestroyed() { return this.destroyed; }
    async loadFile(file) { this.files.push(file); this.url = pathToFileURL(file).href; }
    async loadURL(url) {
      this.urls.push(url); this.url = url;
      if (this.rejectLoads) {
        this.webContents.emit('did-fail-load', {}, -102, 'connection-refused', url, true);
        throw Object.assign(new Error('unavailable'), { code: -102 });
      }
      this.webContents.emit('did-navigate', {}, url, 200, 'OK');
    }
  }
  const win = new Window();
  let stopping = false;
  let ensures = 0;
  let ensure = async () => true;
  const events = [];
  const recovery = context.module.exports.attachWindowRecovery(win, {
    targetURL: 'http://localhost:3100/character-window?npc=chen-nian#chat', statusFile,
    ...(startup ? {startupFile} : {}),
    ensureService: () => { ensures += 1; return ensure(); },
    isStopping: () => stopping,
    log: (event, detail) => events.push({ event, detail }), retryMs: 2, maxRetryMs: 32,
  });
  return {
    win, recovery, clock, events, timers,
    setEnsure: value => { ensure = value; }, stop: () => { stopping = true; },
    count: () => ensures,
  };
}

(async () => {
  {
    const h = harness({startup:true}); let finish;
    h.setEnsure(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.recovery.load(); await flush();
    assert.deepEqual(h.win.files, [startupFile], 'normal cold start presents the branded startup page before the backend is ready');
    assert.equal(h.win.urls.length, 0);
    await h.clock.tick(45000);
    assert.deepEqual(h.win.files, [startupFile], 'slow but pending startup is not reported as a connection failure');
    finish(true); assert.equal(await pending, true);
    assert.equal(h.win.files.includes(statusFile), false, 'normal readiness never flashes the failure copy');
    h.recovery.dispose();
  }
  {
    const h = harness({startup:true}); h.setEnsure(async () => false);
    assert.equal(await h.recovery.load(), false);
    assert.deepEqual(h.win.files, [startupFile, statusFile], 'a real backend failure switches startup to recovery status');
    h.setEnsure(async () => true); await h.clock.tick(2);
    assert.match(h.win.url, /^http:\/\/localhost:3100\//);
    assert.equal(h.win.files.filter(file => file === startupFile).length, 1, 'retries do not replay the first-launch animation');
    h.recovery.dispose();
  }
  {
    const h = harness({startup:true}); h.win.rejectLoads = true;
    assert.equal(await h.recovery.load(), false);
    assert.equal(h.win.files[0], startupFile);
    assert.equal(h.win.files.at(-1), statusFile, 'a real initial application navigation failure shows recovery status');
    h.win.rejectLoads = false; await h.clock.tick(2);
    h.win.webContents.emit('render-process-gone', {}, {reason:'crashed'});
    await h.clock.tick(4);
    assert.equal(h.win.files.filter(file => file === startupFile).length, 1);
    assert.equal(h.win.files.at(-1), statusFile, 'later renderer faults use recovery, not first-launch branding');
    h.recovery.dispose();
  }
  {
    const h = harness({startup:true}); await h.recovery.load();
    const pages=h.win.files.length, loads=h.win.urls.length;
    h.setEnsure(async () => false);
    const pending=h.recovery.recover('service-only-check');await h.clock.tick(2);
    assert.equal(await pending, false);
    assert.equal(h.win.files.length,pages); assert.equal(h.win.urls.length,loads,'a failed background health check cannot replace a healthy document or draft');
    h.recovery.dispose();
  }
  {
    const h = harness(); h.win.rejectLoads = true;
    assert.equal(await h.recovery.load(), false);
    h.win.webContents.emit('did-fail-load', {}, -102, 'offline', h.win.url, true);
    h.win.webContents.emit('did-fail-load', {}, -102, 'offline', h.win.url, true);
    await flush(); assert.equal(h.count(), 1, 'rejection and repeated event share one attempt');
    h.win.rejectLoads = false; await h.clock.tick(2);
    assert.equal(h.count(), 2); assert.equal(h.win.urls.length, 2);
    assert.equal(h.win.url, 'http://localhost:3100/character-window?npc=chen-nian#chat');
    h.recovery.dispose();
  }
  {
    const h = harness(); await h.recovery.load();
    const queries = 'http://localhost:3100/character-window?npc=liu&conversation=3#draft';
    h.win.url = queries; h.win.webContents.emit('did-navigate-in-page', {}, queries, true);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await flush(); assert.equal(h.win.files.length, 2, 'crash immediately recreates a status renderer');
    await h.clock.tick(2); assert.equal(h.count(), 2); assert.equal(h.win.url, queries);
    const before = h.count();
    h.win.webContents.emit('did-fail-load', {}, -102, 'offline', queries, false);
    h.win.webContents.emit('did-fail-load', {}, -3, 'aborted', queries, true);
    h.win.webContents.emit('did-fail-load', {}, -102, 'outside', 'https://example.com/', true);
    h.win.webContents.emit('did-fail-load', {}, -102, 'status', pathToFileURL(statusFile).href, true);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
    await h.clock.tick(100); assert.equal(h.count(), before);
    assert.equal(await h.recovery.load('https://example.com/'), false);
    h.win.url = 'https://example.com/'; h.win.webContents.emit('did-navigate', {}, h.win.url, 200);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await h.clock.tick(100); assert.equal(h.count(), before, 'external document is not reclaimed');
    h.recovery.dispose();
  }
  {
    const h = harness(); h.setEnsure(async () => false);
    assert.equal(await h.recovery.load(), false); assert.equal(h.count(), 1);
    await h.clock.tick(2); assert.equal(h.count(), 2);
    await h.clock.tick(3); assert.equal(h.count(), 2, 'second failure backs off four milliseconds');
    h.setEnsure(async () => true); await h.clock.tick(1); assert.equal(h.count(), 3); assert.equal(h.win.urls.length, 1);
    const pages = h.win.files.length; const loads = h.win.urls.length;
    await h.clock.tick(8); await h.recovery.recover('service-only-check');
    assert.equal(h.win.files.length, pages); assert.equal(h.win.urls.length, loads, 'healthy page/draft is not replaced');
    h.recovery.dispose();
  }
  {
    const h = harness(); const originalLoad = h.win.loadURL.bind(h.win);
    h.win.loadURL = async url => {
      h.win.urls.push(url); h.win.url = 'chrome-error://chromewebdata/';
      h.win.webContents.emit('did-navigate', {}, h.win.url, -1);
      h.win.webContents.emit('did-fail-load', {}, -102, 'offline', url, true);
      throw Object.assign(new Error('offline'), { code: -102 });
    };
    assert.equal(await h.recovery.load(), false);
    assert.equal(h.count(), 1);
    h.win.loadURL = originalLoad; await h.clock.tick(2);
    assert.equal(h.count(), 2); assert.match(h.win.url, /^http:\/\/localhost:3100\//);
    h.win.url = 'chrome-error://chromewebdata/';
    h.win.webContents.emit('did-navigate', {}, h.win.url, -1);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await h.clock.tick(100);
    assert.equal(h.count(), 2, 'an internal page without a current trusted failed load is not reclaimed');
    h.recovery.dispose();
  }
  {
    const h = harness();
    h.win.loadFile = file => { h.win.files.push(file); return new Promise(() => {}); };
    const pending = h.recovery.load(); await flush(); assert.equal(h.count(), 0);
    await h.clock.tick(10000);
    assert.equal(await pending, true, 'a hanging status load cannot permanently hold the service flight');
    assert.equal(h.count(), 1);
    assert.ok(h.events.some(x => x.event === 'status-load-failed' && x.detail.code === 'NAVIGATION_TIMEOUT'));
    h.recovery.dispose();
  }
  {
    const h = harness(); const originalLoad = h.win.loadURL.bind(h.win);
    await h.recovery.load();
    let stops = 0;
    h.win.webContents.stop = () => { stops += 1; };
    h.win.loadURL = url => { h.win.urls.push(url); h.win.url = url; return new Promise(() => {}); };
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await h.clock.tick(2); assert.equal(h.count(), 2);
    await h.clock.tick(119999); assert.equal(h.count(), 2); assert.equal(stops, 0);
    await h.clock.tick(1); assert.equal(stops, 1, 'the owned hung HTTP navigation is stopped only at 120 seconds');
    assert.ok(h.events.some(x => x.event === 'recovery-failed' && x.detail.code === 'NAVIGATION_TIMEOUT'));
    h.win.loadURL = originalLoad; await h.clock.tick(1);
    assert.equal(h.count(), 3); assert.match(h.win.url, /^http:\/\/localhost:3100\//);
    h.recovery.dispose();
  }
  for (const scenario of [
    { duration: 20000, kind: 'startup' },
    { duration: 60000, kind: 'explicit-switch' },
    { duration: 60000, kind: 'renderer-recovery' },
  ]) {
    const h = harness();
    if (scenario.kind !== 'startup') await h.recovery.load();
    let finish, stops = 0, forced = 0;
    h.win.webContents.stop = () => { stops += 1; };
    h.win.webContents.forcefullyCrashRenderer = () => { forced += 1; };
    h.win.loadURL = url => {
      h.win.urls.push(url); h.win.url = url;
      return new Promise(resolve => { finish = () => { h.win.webContents.emit('did-navigate', {}, url, 200); resolve(); }; });
    };
    let pending;
    if (scenario.kind === 'renderer-recovery') {
      h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      pending = h.recovery.recover('same-flight');
      await h.clock.tick(2);
    } else {
      pending = h.recovery.load(scenario.kind === 'explicit-switch'
        ? 'http://localhost:3100/character-window?npc=liu#cold' : undefined);
      if (scenario.kind === 'explicit-switch') await h.clock.tick(2);
      else await flush();
    }
    const attempts = h.count();
    await h.clock.tick(scenario.duration);
    assert.equal(h.count(), attempts, scenario.kind + ': slow HTTP compilation does not call ensure again');
    assert.equal(stops, 0); assert.equal(forced, 0);
    assert.ok(!h.events.some(x => x.detail.code === 'NAVIGATION_TIMEOUT'));
    finish(); assert.equal(await pending, true);
    h.recovery.dispose();
  }
  {
    const h = harness(); const originalLoad = h.win.loadURL.bind(h.win);
    let finishA; let first = true;
    h.win.loadURL = url => {
      if (!first) return originalLoad(url);
      first = false; h.win.urls.push(url); h.win.url = url;
      return new Promise(resolve => { finishA = () => { h.win.webContents.emit('did-navigate', {}, url, 200); resolve(); }; });
    };
    const a = h.recovery.load('http://localhost:3100/character-window?npc=liu#a'); await flush();
    const bURL = 'http://localhost:3100/character-window?npc=chen-nian&conversation=2#b';
    const b = h.recovery.load(bURL); assert.equal(a, b);
    finishA(); await h.clock.tick(2);
    assert.equal(await b, true); assert.equal(h.win.url, bURL, 'the newest target wins over a late old navigation');
    assert.equal(h.win.urls.length, 2);
    h.recovery.dispose();
  }
  {
    const h = harness(); let finish;
    h.setEnsure(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.recovery.load(); await flush(); h.stop(); h.recovery.dispose(); finish(true);
    assert.equal(await pending, false); assert.equal(h.win.urls.length, 0, 'late service readiness cannot revive quitting window');
    assert.equal(h.timers.size, 0); assert.equal(h.win.webContents.listenerCount('did-fail-load'), 0);
  }
  {
    const h = harness(); h.win.loadFile = () => new Promise(() => {});
    const pending = h.recovery.load(); await flush(); h.stop(); h.recovery.dispose();
    assert.equal(await pending, false); assert.equal(h.count(), 0); assert.equal(h.timers.size, 0);
  }
  {
    const h = harness(); await h.recovery.load();
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); await flush();
    const pending = h.recovery.recover('same-flight'); h.recovery.dispose();
    assert.equal(await pending, false); assert.equal(h.count(), 1, 'dispose resolves a pending backoff');
  }
  {
    const h = harness(); await h.recovery.load();
    for (let i = 0; i < 20; i += 1) h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await flush(); await h.clock.tick(1); assert.equal(h.count(), 1);
    await h.clock.tick(1); assert.equal(h.count(), 2);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await h.clock.tick(3); assert.equal(h.count(), 2, 'successful load does not immediately clear crash backoff');
    await h.clock.tick(1); assert.equal(h.count(), 3);
    for (let i = 0; i < 7; i += 1) {
      h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); await h.clock.tick(32);
    }
    assert.ok(h.events.filter(x => x.event === 'recovery-attempt').every(x => x.detail.retryMs <= 32));
    const prior = h.count(); await h.clock.tick(60000);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' }); await flush();
    assert.equal(h.count(), prior + 1, 'sixty stable seconds reset backoff');
    h.recovery.dispose();
  }
  {
    const h = harness(); await h.recovery.load();
    const originalLoad = h.win.loadURL.bind(h.win);
    let finishNavigation;
    h.win.loadURL = url => {
      h.win.urls.push(url); h.win.url = url;
      return new Promise(resolve => { finishNavigation = resolve; });
    };
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    await h.clock.tick(2); assert.equal(h.count(), 2);
    h.win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    finishNavigation(); await flush();
    h.win.loadURL = originalLoad;
    await h.clock.tick(4);
    assert.equal(h.count(), 3, 'a load resolving after its renderer crashed is not mistaken for success');
    h.recovery.dispose();
  }
  {
    const h = harness(); await h.recovery.load();
    let forceCount = 0;
    h.win.webContents.forcefullyCrashRenderer = () => {
      forceCount += 1;
      h.win.webContents.emit('render-process-gone', {}, { reason: 'killed' });
    };
    h.win.emit('unresponsive'); await h.clock.tick(9999); assert.equal(h.count(), 1);
    h.win.emit('responsive'); await h.clock.tick(1); assert.equal(h.count(), 1); assert.equal(forceCount, 0);
    h.win.emit('unresponsive'); await h.clock.tick(10000); assert.equal(h.count(), 2); assert.equal(forceCount, 1);
    h.recovery.dispose(); assert.equal(h.timers.size, 0);
  }
  const html = fs.readFileSync(statusFile, 'utf8');
  assert.match(html, /Content-Security-Policy/); assert.match(html, /default-src 'none'/);
  assert.ok(!/<script|onload=|onclick=/i.test(html)); assert.ok(!html.includes('/Users/'));
  const startup = fs.readFileSync(startupFile, 'utf8');
  assert.match(startup, /default-src 'none'/); assert.match(startup, /img-src 'self'/);
  assert.match(startup, /prefers-reduced-motion/); assert.match(startup, /正在打开智域/);
  assert.ok(!/<script|onload=|onclick=/i.test(startup)); assert.ok(!/https?:|\/Users\//.test(startup));
  assert.ok(!startup.includes('恢复连接'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../startup-logo.png')).equals(fs.readFileSync(path.join(__dirname, '../../public/zhiyu-logo.png'))), 'bundled startup image is the unchanged established logo');
  clearTimeout(watchdog);
  console.log('PASS window recovery: branded normal startup, real-failure recovery, safe same-origin targets, single-flight failures, renderer/hang recovery, continuous bounded backoff, draft preservation, cancellation and script-free local pages.');
})().catch(error => { clearTimeout(watchdog);console.error(error); process.exitCode = 1; });
