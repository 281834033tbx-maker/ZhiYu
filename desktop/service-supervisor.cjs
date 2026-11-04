'use strict';
// oxlint-disable-next-line typescript/no-require-imports -- Node-only service lifecycle module shared by Electron and isolated .cjs tests.
const http = require('node:http');

/** Probe only the small, public, loopback service identity endpoint. Never read an account or a page. */
function probeLocalService(value, { timeoutMs = 1500, maxBytes = 8192 } = {}) {
  let target;
  try { target = new URL(value); } catch { return Promise.reject(new TypeError('Invalid local health URL')); }
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.pathname !== '/api/desktop/health' || target.search || target.hash || target.username || target.password)
    return Promise.reject(new TypeError('Only the loopback desktop health endpoint is permitted'));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    return Promise.reject(new TypeError('Invalid health probe limits'));
  // Preserve the renderer's localhost origin, but probe the server's IPv4 bind directly.
  if (target.hostname === 'localhost') target.hostname = '127.0.0.1';
  return new Promise(resolve => {
    let settled = false, bytes = 0, body = [], responseSeen = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(deadline); resolve(result); };
    const req = http.get(target, { headers: { Accept: 'application/json' } }, res => {
      responseSeen = true;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { finish({ kind: 'occupied' }); res.destroy(); req.destroy(); return; }
        body.push(chunk);
      });
      res.on('error', () => finish({ kind: 'unhealthy' }));
      res.on('aborted', () => finish({ kind: 'unhealthy' }));
      res.on('end', () => {
        if (settled) return;
        let data;
        try { data = JSON.parse(Buffer.concat(body).toString('utf8')); } catch { finish({ kind: 'occupied' }); return; }
        body = [];
        const identified = data && data.service === 'zhiyu-local';
        const valid = identified && data.ok === true && Number.isSafeInteger(data.pid) && data.pid > 0
          && typeof data.instanceId === 'string' && data.instanceId.length > 0 && data.instanceId.length <= 128
          && !Array.from(data.instanceId).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
        if (res.statusCode >= 200 && res.statusCode < 300 && valid)
          finish({ kind: 'healthy', instanceId: data.instanceId, pid: data.pid });
        else finish({ kind: identified ? 'unhealthy' : 'occupied' });
      });
    });
    const deadline = setTimeout(() => { finish({ kind: 'unhealthy' }); req.destroy(); }, timeoutMs);
    req.on('error', error => finish({ kind: !responseSeen && ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code) ? 'absent' : 'unhealthy' }));
  });
}

/** One service owner and one serialized recovery operation; no Electron or project globals. */
function createServiceSupervisor({ probe, start, stopOwned, onState = () => {}, intervalMs = 5000,
  startupTimeoutMs = 120000, retryDelayMs = 1000, maxRetryDelayMs = 30000, healthyGraceMs = 60000, now = Date.now } = {}) {
  if (![probe, start, stopOwned, onState, now].every(value => typeof value === 'function')
    || [intervalMs, startupTimeoutMs, retryDelayMs, maxRetryDelayMs].some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(healthyGraceMs) || healthyGraceMs < 0)
    throw new TypeError('Invalid local service supervisor configuration');
  let stopped = false, monitoring = false, epoch = 0, owned = null, flight = null;
  let recycleAllowed = false;
  let monitorTimer = null, recoveryTimer = null, misses = 0, failures = 0, nextStartAt = 0, healthySince = 0;
  let state = { phase: 'stopped', reason: 'not-started' };
  const timers = new Set(), cancelWaiters = new Set(), retiring = new Set();
  const current = token => !stopped && token === epoch;
  function publish(next) {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    try { onState(Object.freeze({ ...state })); } catch { /* Presentation cannot break process recovery. */ }
  }
  function later(callback, ms, unref = true) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, Math.max(0, ms));
    if (unref) timer.unref?.();
    timers.add(timer); return timer;
  }
  function cancelTimer(timer) { if (timer) { clearTimeout(timer); timers.delete(timer); } }
  function bounded(promise, ms, token) {
    if (!current(token)) return Promise.resolve({ cancelled: true });
    return new Promise(resolve => {
      let done = false;
      const finish = result => { if (done) return; done = true; cancelTimer(timer); cancelWaiters.delete(cancel); resolve(result); };
      const cancel = () => finish({ cancelled: true });
      cancelWaiters.add(cancel);
      const timer = later(() => finish({ timeout: true }), ms, false);
      Promise.resolve(promise).then(value => finish({ value }), () => finish({ failed: true }));
    });
  }
  async function sleep(ms, token) { return bounded(new Promise(resolve => { later(resolve, ms, false); }), ms + 1, token); }
  async function inspect(token, deadline) {
    const result = await bounded(Promise.resolve().then(() => current(token) ? probe() : { kind: 'unhealthy' }), Math.max(1, deadline - Date.now()), token);
    if (!current(token) || result.cancelled) return null;
    if (result.timeout) return { kind: 'timeout' };
    if (result.failed || !result.value || !['healthy', 'absent', 'occupied', 'unhealthy'].includes(result.value.kind)) return { kind: 'unhealthy' };
    return result.value;
  }
  function healthy(result) {
    const time = Date.now();
    if (state.phase !== 'healthy') healthySince = time;
    if (time - healthySince >= Math.max(intervalMs * 3, retryDelayMs * 2)) { failures = 0; nextStartAt = 0; }
    misses = 0; recycleAllowed = false;
    if (owned && !owned.ended) {
      owned.instanceId = result.instanceId; owned.healthPid = result.pid;
      if (owned.firstHealthyAt === undefined) owned.firstHealthyAt = now();
    }
    publish({ phase: 'healthy', ...(result.instanceId ? { instanceId: result.instanceId } : {}) });
  }
  function failedChild() {
    failures++;
    nextStartAt = Date.now() + Math.min(maxRetryDelayMs, retryDelayMs * 2 ** Math.min(20, failures - 1));
  }
  function release(record) {
    if (!record || record.stopCalled) return Promise.resolve();
    record.stopCalled = true;
    if (!stopped) retiring.add(record);
    if (owned === record) owned = null;
    try { return Promise.resolve(stopOwned(record.child)).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function isRetiringResponse(result) {
    return [...retiring].some(record => result.kind === 'healthy' && (
      (record.instanceId && record.instanceId === result.instanceId)
      || (record.healthPid && record.healthPid === result.pid)
      || (record.child.pid && record.child.pid === result.pid)
      || (!record.instanceId && !record.healthPid && !record.child.pid && !record.ended)
    ));
  }
  function scheduleRecovery() {
    if (stopped || recoveryTimer || flight) return;
    recoveryTimer = later(() => { recoveryTimer = null; void ensure(); }, Math.max(0, nextStartAt - Date.now()));
  }
  function attach(child) {
    if (!child || typeof child.on !== 'function') throw new TypeError('Service start did not return a child process');
    const record = { child, ended: false, stopCalled: false };
    owned = record; recycleAllowed = false;
    const ended = reason => {
      if (record.ended) return;
      record.ended = true;
      if (stopped || owned !== record) return;
      failedChild(); publish({ phase: 'recovering', reason }); scheduleRecovery();
    };
    // Keep the error handler attached after stop/exit so a late native error cannot escape.
    child.on('error', () => ended('child-error'));
    child.once('exit', () => ended('child-exit'));
    return record;
  }
  async function runEnsure(token) {
    const deadline = Date.now() + startupTimeoutMs;
    let result = await inspect(token, deadline), waitingForOwnedShutdown = retiring.size > 0;
    if (!current(token)) return false;
    // An exit can precede the response to an already in-flight health request.
    // Discard that response; the stopping instance cannot certify its replacement.
    if (owned?.ended) {
      await bounded(release(owned), Math.max(1, deadline - Date.now()), token);
      if (!current(token)) return false;
      waitingForOwnedShutdown = true;
      result = await inspect(token, deadline);
    }
    if (result?.kind === 'healthy' && !isRetiringResponse(result)) { healthy(result); return current(token); }
    if (result?.kind === 'occupied') { publish({ phase: 'blocked', reason: 'port-occupied' }); return false; }
    // A cold page compilation can briefly block the same healthy Node event loop.
    // A caller's failed check is not evidence to kill it. Only monitoring may
    // authorize recycling after three consecutive misses and the startup grace.
    if (owned && !owned.ended && owned.firstHealthyAt !== undefined
      && (!recycleAllowed || now() - owned.firstHealthyAt < healthyGraceMs)) {
      publish({ phase: 'recovering', reason: 'health-check-delayed' });
      return false;
    }
    publish({ phase: owned || state.phase === 'healthy' || failures ? 'recovering' : 'starting', reason: 'service-unavailable' });
    if (owned) {
      const cleanup = await bounded(release(owned), Math.max(1, deadline - Date.now()), token);
      if (!current(token)) return false;
      if (cleanup.timeout) { publish({ phase: 'blocked', reason: 'stop-timeout' }); return false; }
      waitingForOwnedShutdown = true;
      result = await inspect(token, deadline);
    }
    while (current(token) && Date.now() < deadline) {
      if (!result || result.kind === 'timeout') break;
      if (owned?.ended) {
        await bounded(release(owned), Math.max(1, deadline - Date.now()), token);
        if (!current(token)) return false;
        waitingForOwnedShutdown = true;
        result = await inspect(token, deadline); continue;
      }
      if (result.kind === 'healthy') {
        if (!isRetiringResponse(result)) { healthy(result); return current(token); }
        waitingForOwnedShutdown = true; result = { kind: 'unhealthy' };
      }
      if (result.kind === 'occupied') { publish({ phase: 'blocked', reason: 'port-occupied' }); return false; }
      if (result.kind === 'absent') retiring.clear();
      if (result.kind === 'absent' && !owned) {
        if (Date.now() < nextStartAt) {
          await sleep(Math.min(nextStartAt - Date.now(), Math.max(1, deadline - Date.now())), token);
          if (!current(token)) return false;
          // The port may have acquired an external owner during the backoff.
          result = await inspect(token, deadline); continue;
        }
        try { attach(start()); waitingForOwnedShutdown = false; }
        catch { failedChild(); publish({ phase: 'recovering', reason: 'start-failed' }); }
        if (!current(token)) { void release(owned); return false; }
      } else if (result.kind === 'unhealthy' && !owned && !waitingForOwnedShutdown) {
        publish({ phase: 'blocked', reason: 'service-unhealthy' }); return false;
      }
      await sleep(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())), token);
      if (!current(token)) return false;
      result = await inspect(token, deadline);
    }
    if (!current(token)) return false;
    void release(owned);
    if (!current(token)) return false;
    publish({ phase: 'blocked', reason: 'startup-timeout' }); return false;
  }
  function ensure() {
    if (stopped) return Promise.resolve(false);
    if (flight) return flight;
    cancelTimer(recoveryTimer); recoveryTimer = null;
    const token = ++epoch;
    const operation = Promise.resolve().then(() => runEnsure(token)).catch(() => {
      if (current(token)) publish({ phase: 'blocked', reason: 'recovery-failed' });
      return false;
    });
    flight = operation;
    void operation.finally(() => {
      if (flight === operation) {
        flight = null;
        if (!stopped && owned?.ended) scheduleRecovery();
      }
    });
    return operation;
  }
  function queueMonitor() {
    if (stopped || !monitoring || monitorTimer) return;
    monitorTimer = later(() => { monitorTimer = null; void monitor(); }, intervalMs);
  }
  async function monitor() {
    if (stopped || !monitoring) return;
    if (flight) { await flight; queueMonitor(); return; }
    const token = epoch, result = await inspect(token, Date.now() + startupTimeoutMs);
    if (!current(token) || !monitoring) { queueMonitor(); return; }
    if (result?.kind === 'healthy') healthy(result);
    else {
      misses++;
      const inHealthyGrace = owned && !owned.ended && owned.firstHealthyAt !== undefined
        && now() - owned.firstHealthyAt < healthyGraceMs;
      if (misses >= 3 && !inHealthyGrace) { recycleAllowed = true; await ensure(); }
    }
    queueMonitor();
  }
  function startMonitoring() { if (!stopped) { monitoring = true; queueMonitor(); } }
  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true; monitoring = false; epoch++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); monitorTimer = null; recoveryTimer = null;
    for (const cancel of cancelWaiters) cancel();
    publish({ phase: 'stopped', reason: 'shutdown' });
    return release(owned);
  }
  return { ensure, startMonitoring, stop, getState: () => Object.freeze({ ...state }) };
}
module.exports = { createServiceSupervisor, probeLocalService };
