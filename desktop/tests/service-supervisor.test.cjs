'use strict';
// oxlint-disable-next-line typescript/no-require-imports -- Node's built-in test runner; no Electron, project accounts, devices or model service.
const { test } = require('node:test');
// oxlint-disable-next-line typescript/no-require-imports -- Isolated assertions.
const assert = require('node:assert/strict');
// oxlint-disable-next-line typescript/no-require-imports -- Ephemeral loopback fixture only, never port 3100.
const http = require('node:http');
// oxlint-disable-next-line typescript/no-require-imports -- Synthetic process doubles.
const { EventEmitter } = require('node:events');
// oxlint-disable-next-line typescript/no-require-imports -- Exercise actual standalone production module.
const { createServiceSupervisor, probeLocalService } = require('../service-supervisor.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await pause(2);
  assert.ok(check(), 'condition reached within bounded fixture time');
}
function fixture(overrides = {}) {
  let answer = { kind: 'absent' }, mode = 'ready', pid = 50000;
  const children = [], stopped = [], states = [], starts = [];
  const supervisor = createServiceSupervisor({ intervalMs: 8, startupTimeoutMs: 180, retryDelayMs: 5, maxRetryDelayMs: 40, healthyGraceMs: 0,
    probe: async () => answer,
    start: () => {
      starts.push(Date.now());
      if (mode === 'throw') throw Object.assign(Error('sensitive-synthetic-path ENOENT'), { code: 'ENOENT' });
      const child = new EventEmitter(); child.pid = ++pid; children.push(child);
      if (mode === 'ready') answer = { kind: 'healthy', pid: child.pid, instanceId: 'owned-' + child.pid };
      return child;
    },
    stopOwned: child => { stopped.push(child); answer = { kind: 'absent' }; },
    onState: state => { states.push(state); }, ...overrides,
  });
  return { supervisor, children, stopped, states, starts, currentAnswer: () => answer, answer: value => { answer = value; }, mode: value => { mode = value; } };
}

test('concurrent ensure is one flight and starts one child; stop does not restart it', async () => {
  const f = fixture();
  try {
    const first = f.supervisor.ensure(), second = f.supervisor.ensure();
    assert.equal(first, second); assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(f.children.length, 1); assert.equal(f.supervisor.getState().phase, 'healthy');
    assert.ok(Object.isFrozen(f.supervisor.getState()));
    await f.supervisor.stop(); assert.equal(f.stopped.length, 1);
    f.children[0].emit('exit', 1); f.children[0].emit('error', Error('late synthetic error'));
    await pause(25); assert.equal(await f.supervisor.ensure(), false); assert.equal(f.children.length, 1);
  } finally { await f.supervisor.stop(); }
});

test('external healthy instance is reused; only three failed checks allow absent-port takeover', async () => {
  const f = fixture(); f.answer({ kind: 'healthy', pid: 12345, instanceId: 'external' });
  try {
    assert.equal(await f.supervisor.ensure(), true); assert.equal(f.children.length, 0);
    f.supervisor.startMonitoring(); f.answer({ kind: 'absent' });
    await pause(10); assert.equal(f.children.length, 0, 'the first missed heartbeat is not a restart');
    await until(() => f.children.length === 1 && f.supervisor.getState().phase === 'healthy');
    assert.equal(f.stopped.length, 0, 'the old external service is never sent a stop');
    await f.supervisor.stop(); assert.equal(f.stopped.length, 1); assert.equal(f.stopped[0], f.children[0]);
  } finally { await f.supervisor.stop(); }
});

test('an unknown occupied or unhealthy service is not killed or overwritten', async () => {
  for (const kind of ['occupied', 'unhealthy']) {
    const f = fixture(); f.answer({ kind });
    try {
      assert.equal(await f.supervisor.ensure(), false); f.supervisor.startMonitoring(); await pause(40);
      assert.equal(f.supervisor.getState().phase, 'blocked'); assert.equal(f.children.length, 0); assert.equal(f.stopped.length, 0);
    } finally { await f.supervisor.stop(); }
  }
});

test('owned child exit and error both trigger serialized bounded recovery', async () => {
  for (const event of ['exit', 'error']) {
    const f = fixture();
    try {
      assert.equal(await f.supervisor.ensure(), true); f.answer({ kind: 'absent' });
      const old = f.children[0]; old.emit(event, event === 'error' ? Error('synthetic crash') : 1);
      await until(() => f.children.length === 2 && f.supervisor.getState().phase === 'healthy');
      assert.deepEqual(f.stopped, [old]); assert.ok(f.starts[1] - f.starts[0] >= 4);
      assert.ok(f.states.some(state => state.phase === 'recovering'));
      old.emit('exit', 1); await pause(12); assert.equal(f.children.length, 2, 'late old exit cannot replace the new child');
    } finally { await f.supervisor.stop(); }
  }
});

test('successfully loaded but repeatedly crashing children retain increasing backoff', async () => {
  const f = fixture({ intervalMs: 1000, retryDelayMs: 10 });
  try {
    assert.equal(await f.supervisor.ensure(), true);
    for (let index = 0; index < 3; index++) {
      f.answer({ kind: 'absent' }); f.children[index].emit('exit', 1);
      await until(() => f.children.length === index + 2 && f.supervisor.getState().phase === 'healthy');
    }
    assert.ok(f.starts[2] - f.starts[1] >= 19, 'a brief successful load does not erase crash history');
    assert.ok(f.starts[3] - f.starts[2] >= 39, 'repeated crashes back off up to the configured cap');
  } finally { await f.supervisor.stop(); }
});

test('child exit during a health request cannot be certified by its late healthy response', async () => {
  let crashDuringProbe = false;
  const f = fixture({ probe: async () => {
    const response = f.currentAnswer();
    if (crashDuringProbe) { crashDuringProbe = false; f.answer({ kind: 'absent' }); f.children[0].emit('exit', 1); }
    return response;
  } });
  try {
    assert.equal(await f.supervisor.ensure(), true); crashDuringProbe = true;
    assert.equal(await f.supervisor.ensure(), true);
    assert.equal(f.children.length, 2, 'old healthy response is discarded before recovery completes');
    assert.deepEqual(f.stopped, [f.children[0]]);
  } finally { await f.supervisor.stop(); }
});

test('synchronous SIGTERM callback cannot make the still-answering old instance look recovered', async () => {
  const f = fixture({ stopOwned: child => {
    f.stopped.push(child);
    f.answer({ kind: 'healthy', pid: child.pid, instanceId: 'owned-' + child.pid });
    setTimeout(() => { f.answer({ kind: 'absent' }); child.emit('exit', 0); }, 15);
  } });
  try {
    assert.equal(await f.supervisor.ensure(), true); f.answer({ kind: 'unhealthy' }); f.supervisor.startMonitoring();
    await until(() => f.children.length === 2 && f.supervisor.getState().phase === 'healthy');
    assert.equal(f.children.length, 2, 'monitor-authorized recovery waits for the retiring identity to disappear');
    assert.deepEqual(f.stopped, [f.children[0]]);
  } finally { await f.supervisor.stop(); await pause(20); }
});

test('onState shutdown re-entry cannot turn a stopped ensure into success', async () => {
  const f = fixture({ onState: state => { if (state.phase === 'healthy') void f.supervisor.stop(); } });
  assert.equal(await f.supervisor.ensure(), false);
  assert.equal(f.supervisor.getState().phase, 'stopped'); assert.equal(f.stopped.length, 1);
});

test('a never-resolving owned-stop callback cannot hang ensure beyond its deadline', async () => {
  const f = fixture({ startupTimeoutMs: 30, stopOwned: () => new Promise(() => {}) });
  try {
    assert.equal(await f.supervisor.ensure(), true); f.answer({ kind: 'unhealthy' });
    const started = Date.now(); f.supervisor.startMonitoring();
    await until(() => f.supervisor.getState().reason === 'stop-timeout');
    assert.ok(Date.now() - started < 180); assert.equal(f.supervisor.getState().reason, 'stop-timeout');
    assert.equal(f.children.length, 1, 'no replacement is started while ownership release is uncertain');
  } finally { await f.supervisor.stop(); }
});

test('synchronous ENOENT retries with backoff and never exposes raw failures', async () => {
  const f = fixture({ startupTimeoutMs: 65 }); f.mode('throw');
  try {
    assert.equal(await f.supervisor.ensure(), false); assert.ok(f.starts.length >= 2 && f.starts.length <= 5);
    assert.ok(f.starts[1] - f.starts[0] >= 4);
    if (f.starts.length > 2) assert.ok(f.starts[2] - f.starts[1] >= 9);
    assert.equal(f.supervisor.getState().phase, 'blocked'); assert.ok(!JSON.stringify(f.states).includes('sensitive-synthetic-path'));
    f.mode('ready'); assert.equal(await f.supervisor.ensure(), true, 'a later explicit retry can recover from a missing executable');
  } finally { await f.supervisor.stop(); }
});

test('owned process that stops answering is stopped before replacement', async () => {
  const f = fixture();
  try {
    assert.equal(await f.supervisor.ensure(), true); const old = f.children[0];
    f.supervisor.startMonitoring(); f.answer({ kind: 'unhealthy' });
    await until(() => f.children.length === 2 && f.supervisor.getState().phase === 'healthy');
    assert.deepEqual(f.stopped, [old]);
  } finally { await f.supervisor.stop(); }
});

test('twenty seconds of cold compilation misses do not kill an already verified owned service', async () => {
  let time = 0;
  const f = fixture({ healthyGraceMs: 60000, now: () => time });
  try {
    assert.equal(await f.supervisor.ensure(), true); const old = f.children[0];
    f.answer({ kind: 'unhealthy' }); f.supervisor.startMonitoring(); time = 20000;
    for (let index = 0; index < 12; index++) assert.equal(await f.supervisor.ensure(), false, 'failed probes must not claim health');
    await pause(40); assert.equal(f.stopped.length, 0); assert.equal(f.children.length, 1);
    assert.equal(f.supervisor.getState().reason, 'health-check-delayed');
    time = 25000; f.answer({ kind: 'healthy', pid: old.pid, instanceId: 'owned-' + old.pid });
    assert.equal(await f.supervisor.ensure(), true); assert.equal(f.children[0], old); assert.equal(f.stopped.length, 0);
  } finally { await f.supervisor.stop(); }
});

test('manual failed checks do not count as monitor misses; a truly stuck process is recycled after grace and three monitor failures', async () => {
  let time = 0;
  const f = fixture({ healthyGraceMs: 60000, now: () => time });
  try {
    assert.equal(await f.supervisor.ensure(), true); const old = f.children[0]; time = 65000; f.answer({ kind: 'unhealthy' });
    for (let index = 0; index < 10; index++) assert.equal(await f.supervisor.ensure(), false);
    assert.equal(f.stopped.length, 0, 'caller retries cannot authorize a restart');
    f.supervisor.startMonitoring(); await pause(10); assert.equal(f.stopped.length, 0, 'one missed monitor check is insufficient');
    await until(() => f.children.length === 2 && f.supervisor.getState().phase === 'healthy'); assert.deepEqual(f.stopped, [old]);
  } finally { await f.supervisor.stop(); }
});

test('actual child exit bypasses cold-compilation grace and recovers immediately with backoff', async () => {
  let time = 0;
  const f = fixture({ healthyGraceMs: 60000, now: () => time });
  try {
    assert.equal(await f.supervisor.ensure(), true); time = 20000; f.answer({ kind: 'absent' }); f.children[0].emit('exit', 1);
    await until(() => f.children.length === 2 && f.supervisor.getState().phase === 'healthy');
    assert.deepEqual(f.stopped, [f.children[0]]); assert.equal(time, 20000, 'no sixty-second wait is required after a real exit');
  } finally { await f.supervisor.stop(); }
});

test('stop cancels a pending probe and never permits its late answer to spawn', async () => {
  let release;
  const f = fixture({ probe: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.supervisor.ensure(); await until(() => typeof release === 'function');
  await f.supervisor.stop(); assert.equal(await pending, false);
  release({ kind: 'absent' }); await pause(20); assert.equal(f.children.length, 0); assert.equal(f.supervisor.getState().phase, 'stopped');
});

test('stop while waiting for startup stops only its owned process and cancels polling', async () => {
  const f = fixture(); f.mode('hang');
  const pending = f.supervisor.ensure(); await until(() => f.children.length === 1);
  await f.supervisor.stop(); assert.equal(await pending, false); await pause(20);
  assert.equal(f.stopped.length, 1); assert.equal(f.children.length, 1); assert.equal(f.supervisor.getState().phase, 'stopped');
});

test('hanging startup and hanging injected probe both finish within the startup deadline', async () => {
  const f = fixture({ startupTimeoutMs: 35 }); f.mode('hang');
  try {
    const start = Date.now(); assert.equal(await f.supervisor.ensure(), false); assert.ok(Date.now() - start < 180);
    assert.equal(f.supervisor.getState().reason, 'startup-timeout'); assert.equal(f.children.length, 1); assert.equal(f.stopped.length, 1);
  } finally { await f.supervisor.stop(); }
  const probeHang = fixture({ startupTimeoutMs: 25, probe: () => new Promise(() => {}) });
  try { assert.equal(await probeHang.supervisor.ensure(), false); assert.equal(probeHang.children.length, 0); }
  finally { await probeHang.supervisor.stop(); }
});

test('port ownership is rechecked after backoff before any spawn', async () => {
  const f = fixture({ retryDelayMs: 25 }); f.mode('throw');
  const pending = f.supervisor.ensure(); await until(() => f.starts.length === 1); f.answer({ kind: 'occupied' });
  try { assert.equal(await pending, false); assert.equal(f.starts.length, 1); assert.equal(f.stopped.length, 0); }
  finally { await f.supervisor.stop(); }
});

async function withHttp(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(), url = `http://127.0.0.1:${address.port}/api/desktop/health`;
  assert.notEqual(address.port, 3100);
  try { await run(url); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const identity = { service: 'zhiyu-local', ok: true, pid: 12345, instanceId: 'fixture-identity' };
test('real isolated health HTTP verifies status and service identity without returning extra fields', async () => {
  for (const [status, body, expected] of [
    [200, { ...identity, privateField: 'not-returned' }, 'healthy'], [500, identity, 'unhealthy'],
    [200, { ...identity, service: 'other-service' }, 'occupied'], [200, { ...identity, pid: -1 }, 'unhealthy'],
    [200, { ...identity, instanceId: '' }, 'unhealthy'], [404, { error: 'not-found' }, 'occupied'],
  ]) await withHttp((req, res) => { assert.equal(req.method, 'GET'); assert.equal(req.url, '/api/desktop/health'); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }, async url => {
    const result = await probeLocalService(url.replace('127.0.0.1', 'localhost')); assert.equal(result.kind, expected);
    if (expected === 'healthy') assert.deepEqual(result, { kind: 'healthy', instanceId: identity.instanceId, pid: identity.pid });
  });
});

test('health HTTP rejects HTML/oversized bodies, times out hung sockets, and distinguishes absent port', async () => {
  await withHttp((_req, res) => { res.end('<html>foreign</html>'); }, async url => assert.equal((await probeLocalService(url)).kind, 'occupied'));
  await withHttp((_req, res) => { res.end('x'.repeat(2048)); }, async url => assert.equal((await probeLocalService(url, { maxBytes: 128 })).kind, 'occupied'));
  await withHttp(() => {}, async url => assert.equal((await probeLocalService(url, { timeoutMs: 25 })).kind, 'unhealthy'));
  let closedURL; await withHttp((_req, res) => { res.end(); }, async url => { closedURL = url; });
  assert.equal((await probeLocalService(closedURL)).kind, 'absent');
  for (const url of ['http://example.com/api/desktop/health', 'http://127.0.0.1:3100/', 'http://127.0.0.1:3100/api/desktop/health?owner=secret', 'file:///api/desktop/health'])
    await assert.rejects(probeLocalService(url), TypeError);
});
