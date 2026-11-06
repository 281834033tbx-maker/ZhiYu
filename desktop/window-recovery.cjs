'use strict';

// oxlint-disable-next-line typescript/no-require-imports -- Electron's main-process helper is deliberately CommonJS.
const { URL, pathToFileURL } = require('node:url');

// Only restores this window's existing local application origin. It never
// changes session storage, permissions, preload settings, or navigation policy.
function attachWindowRecovery(win, options) {
  const {
    ensureService, statusFile, startupFile = statusFile, targetURL, isStopping = () => false,
    log = () => {}, retryMs = 1000, maxRetryMs = 30000,
  } = options;
  const origin = new URL(targetURL);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
    throw new TypeError('Window recovery requires a trusted application URL');
  const statusURL = pathToFileURL(statusFile).href;
  const startupURL = pathToFileURL(startupFile).href;
  const baseDelay = Math.min(30000, Math.max(1, Number(retryMs) || 1000));
  const maxDelay = Math.min(30000, Math.max(baseDelay, Number(maxRetryMs) || 30000));
  const contents = win.webContents;
  let target = origin.href;
  let disposed = false;
  let initialized = false;
  let healthy = false;
  let outsideOrigin = false;
  let showStatus = false;
  let placeholderFile = statusFile;
  let failureEpoch = 0;
  let targetVersion = 0;
  let pendingNavigation = null;
  let trustedInternalError = false;
  let unresponsive = false;
  let failures = 0;
  let nextAttemptAt = 0;
  let flight = null;
  let stableTimer = null;
  let hangTimer = null;
  let retryTimer = null;
  let delayTimer = null;
  let resolveDelay = null;
  const listeners = [];
  const navigationCancels = new Set();

  function record(event, detail = {}) {
    try { log(event, detail); } catch { /* Diagnostics cannot break recovery. */ }
  }

  function stopped() {
    if (disposed || win.isDestroyed()) return true;
    try { return Boolean(isStopping()); } catch { return true; }
  }

  function trustedURL(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new URL(value, target);
      return parsed.origin === origin.origin && !parsed.username && !parsed.password
        ? parsed.href : null;
    } catch { return null; }
  }

  function currentURL() {
    try { return contents.getURL(); } catch { return ''; }
  }

  function isStatus(value) {
    try { return [statusURL, startupURL].includes(new URL(value).href.split('#')[0]); }
    catch { return false; }
  }

  function inScope() {
    const current = currentURL();
    return !outsideOrigin && (!current || current === 'about:blank'
      || isStatus(current) || Boolean(trustedURL(current))
      || (trustedInternalError && isInternalError(current)));
  }

  function isInternalError(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'chrome-error:' && parsed.hostname === 'chromewebdata';
    } catch { return false; }
  }

  // Electron navigation promises may never settle when the renderer hangs.
  // Cancellation detaches our wait, and late native completion cannot revive it.
  function nativeLoad(operation, stage, timeoutMs = 10000, onTimeout = null) {
    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        if (timer !== null) clearTimeout(timer);
        navigationCancels.delete(cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(Object.assign(new Error('Window recovery cancelled'), { code: 'CANCELLED' }));
      navigationCancels.add(cancel);
      timer = setTimeout(() => {
        try { onTimeout?.(); }
        catch (error) { record('navigation-cancel-failed', { code: error?.code || 'failed' }); }
        finish(Object.assign(new Error('Native navigation timed out'), { code: 'NAVIGATION_TIMEOUT', stage }));
      }, timeoutMs);
      timer.unref?.();
      Promise.resolve().then(() => {
        if (stopped()) throw Object.assign(new Error('Window recovery cancelled'), { code: 'CANCELLED' });
        return operation();
      }).then(value => finish(null, value), error => finish(error));
    });
  }

  function clearStable() {
    if (stableTimer !== null) clearTimeout(stableTimer);
    stableTimer = null;
  }

  function armStable() {
    clearStable();
    stableTimer = setTimeout(() => {
      stableTimer = null;
      if (!stopped() && healthy && inScope()) {
        failures = 0;
        nextAttemptAt = 0;
      }
    }, 60000);
    stableTimer.unref?.();
  }

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function waitUntilAllowed() {
    const remaining = Math.max(0, nextAttemptAt - Date.now());
    if (!remaining || stopped()) return Promise.resolve(!stopped());
    return new Promise(resolve => {
      resolveDelay = resolve;
      delayTimer = setTimeout(() => {
        delayTimer = null;
        resolveDelay = null;
        resolve(!stopped());
      }, remaining);
      delayTimer.unref?.();
    });
  }

  async function displayStatus() {
    const file = placeholderFile;
    if (stopped() || !inScope() || currentURL().split('#')[0] === pathToFileURL(file).href) return;
    const stage = file === statusFile ? 'status' : 'startup';
    try { await nativeLoad(() => win.loadFile(file), stage); }
    catch (error) { record(`${stage}-load-failed`, { code: error?.code || 'load-failed' }); }
  }

  async function displayRecoveryStatus() {
    placeholderFile = statusFile;
    showStatus = false;
    await displayStatus();
  }

  function scheduleRetry() {
    if (stopped() || !inScope() || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void recover('retry');
    }, Math.max(1, nextAttemptAt - Date.now()));
    retryTimer.unref?.();
  }

  async function attempt(reason) {
    // A crashed renderer is recreated using this script-free bundled page.
    // A healthy page is left in place during a service-only interruption.
    if (showStatus) {
      showStatus = false;
      await displayStatus();
    }
    if (!(await waitUntilAllowed()) || stopped() || !inScope()) return false;
    failures += 1;
    const delay = Math.min(maxDelay, baseDelay * 2 ** Math.min(failures - 1, 20));
    nextAttemptAt = Date.now() + delay;
    record('recovery-attempt', { reason, attempt: failures, retryMs: delay });
    let attemptedVersion = null;
    try {
      const ready = await ensureService();
      if (stopped() || !inScope()) return false;
      if (!ready) {
        if (!healthy) await displayRecoveryStatus();
        return false;
      }
      // A background service check must not replace a live document or drafts.
      if (!healthy) {
        if (showStatus) {
          showStatus = false;
          await displayStatus();
          if (stopped() || !inScope()) return false;
        }
        const epoch = failureEpoch;
        const navigation = { url: target, version: targetVersion };
        attemptedVersion = navigation.version;
        pendingNavigation = navigation;
        try {
          // Every HTTP route can compile on demand, including after a renderer
          // crash or service restart. Local status files retain a 10s deadline;
          // this trusted navigation gets 120s without another service ensure.
          await nativeLoad(() => win.loadURL(navigation.url), 'application', 120000, () => {
            if (pendingNavigation === navigation && !stopped() && !outsideOrigin
              && typeof contents.stop === 'function') contents.stop();
          });
        } catch (error) {
          if (!outsideOrigin && isInternalError(currentURL())) trustedInternalError = true;
          throw error;
        } finally {
          if (pendingNavigation === navigation) pendingNavigation = null;
        }
        if (stopped() || !inScope()) return false;
        if (navigation.version !== targetVersion) return attempt('target-changed');
        if (epoch !== failureEpoch) return false;
        showStatus = false;
        trustedInternalError = false;
        healthy = true;
        armStable();
      }
      return true;
    } catch (error) {
      record('recovery-failed', { code: error?.code || 'load-failed' });
      if (attemptedVersion !== null && attemptedVersion !== targetVersion && !stopped() && inScope())
        return attempt('target-changed');
      if (!healthy && !stopped() && inScope()) await displayRecoveryStatus();
      return false;
    }
  }

  function recover(reason = 'requested') {
    if (stopped() || !inScope()) return Promise.resolve(false);
    if (flight) return flight;
    clearRetry();
    // Assign the flight before invoking any async load, so its did-fail-load
    // and rejected loadURL promise share one retry rather than two attempts.
    flight = Promise.resolve().then(() => attempt(String(reason))).then(result => {
      flight = null;
      if (!result && !stopped() && inScope()) scheduleRetry();
      return result;
    }, error => {
      flight = null;
      record('recovery-failed', { code: error?.code || 'unexpected' });
      if (!stopped() && inScope()) scheduleRetry();
      return false;
    });
    return flight;
  }

  function load(url) {
    if (stopped()) return Promise.resolve(false);
    if (url !== undefined) {
      const next = trustedURL(url);
      if (!next) {
        record('recovery-url-rejected');
        return Promise.resolve(false);
      }
      target = next;
    }
    if (!initialized) {
      initialized = true;
      placeholderFile = startupFile;
      showStatus = true;
    }
    outsideOrigin = false;
    healthy = false;
    failureEpoch += 1;
    targetVersion += 1;
    clearStable();
    return recover('load');
  }

  function needsRecovery(reason) {
    if (stopped() || !inScope()) return;
    healthy = false;
    failureEpoch += 1;
    showStatus = true;
    placeholderFile = statusFile;
    clearStable();
    void recover(reason);
  }

  function onFailure(_event, code, _description, failedURL, isMainFrame) {
    if (isMainFrame !== true || code === -3 || isStatus(failedURL)
      || !trustedURL(failedURL) || stopped()) return;
    if (!outsideOrigin && pendingNavigation && trustedURL(failedURL) === pendingNavigation.url
      && isInternalError(currentURL())) trustedInternalError = true;
    if (!inScope()) return;
    needsRecovery('did-fail-load');
  }

  function onGone(_event, details = {}) {
    if (details.reason !== 'clean-exit') needsRecovery('render-process-gone');
  }

  function onResponsive() {
    unresponsive = false;
    if (hangTimer !== null) clearTimeout(hangTimer);
    hangTimer = null;
  }

  function onUnresponsive() {
    if (stopped() || !inScope() || hangTimer !== null) return;
    unresponsive = true;
    hangTimer = setTimeout(() => {
      hangTimer = null;
      if (stopped() || !inScope() || !unresponsive) return;
      if (typeof contents.forcefullyCrashRenderer === 'function') {
        try { contents.forcefullyCrashRenderer(); }
        catch (error) { record('renderer-restart-failed', { code: error?.code || 'failed' }); }
      }
      needsRecovery('unresponsive');
    }, 10000);
    hangTimer.unref?.();
  }

  function onNavigate(_event, url, isMainFrame = true) {
    if (isMainFrame === false) return;
    if (isStatus(url)) return;
    if (isInternalError(url) && pendingNavigation && !outsideOrigin) {
      trustedInternalError = true;
      return;
    }
    const next = trustedURL(url);
    outsideOrigin = !next;
    if (next) {
      if (!pendingNavigation || pendingNavigation.version === targetVersion) target = next;
    }
    else {
      healthy = false;
      clearStable();
      clearRetry();
    }
  }

  function listen(emitter, event, handler) {
    emitter.on(event, handler);
    listeners.push([emitter, event, handler]);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearStable();
    clearRetry();
    onResponsive();
    if (delayTimer !== null) clearTimeout(delayTimer);
    delayTimer = null;
    resolveDelay?.(false);
    resolveDelay = null;
    for (const cancel of navigationCancels) cancel();
    for (const [emitter, event, handler] of listeners) emitter.removeListener(event, handler);
    listeners.length = 0;
  }

  listen(contents, 'did-fail-load', onFailure);
  listen(contents, 'render-process-gone', onGone);
  listen(contents, 'did-navigate', onNavigate);
  listen(contents, 'did-navigate-in-page', onNavigate);
  listen(win, 'unresponsive', onUnresponsive);
  listen(win, 'responsive', onResponsive);
  listen(win, 'closed', dispose);

  return { load, recover, dispose };
}

module.exports = { attachWindowRecovery };
