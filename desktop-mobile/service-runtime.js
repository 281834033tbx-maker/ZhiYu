'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

function resolveProject({ resourcesPath, dirname, env = process.env, exists = fs.existsSync }) {
  const candidates = [env.ZHIYU_PROJECT,
    path.resolve(resourcesPath, '../../../../../../'), path.resolve(dirname, '..')].filter(Boolean);
  return candidates.find(candidate => exists(path.join(candidate, 'node_modules/vinext/dist/cli.js'))) || null;
}

function resolveNode({ project, env = process.env, homedir = os.homedir(), exists = fs.existsSync }) {
  const candidates = [env.NODE_BIN, path.join(homedir, '.local/bin/node'),
    ...(env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, 'node')),
    path.resolve(project, '../../../.hermes/node/bin/node'), '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  return candidates.filter(Boolean).find(candidate => exists(candidate)) || 'node';
}

// No Cookie header: this only identifies the existing local service, without
// opening an account or reading the desktop App's Chromium profile.
function probeService(baseURL, get = http.get) {
  return new Promise(resolve => {
    let settled = false;
    const finish = status => { if (!settled) { settled = true; resolve(status); } };
    const req = get(new URL('/api/auth/session', baseURL), res => {
      if (res.statusCode !== 200) { res.resume(); finish('occupied'); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 8192) { finish('occupied'); req.destroy(); }
      });
      res.on('end', () => {
        try { finish(typeof JSON.parse(body).authenticated === 'boolean' ? 'ready' : 'occupied'); }
        catch { finish('occupied'); }
      });
      res.on('error', () => finish('occupied'));
    });
    req.on('error', error => finish(error.code === 'ECONNREFUSED' ? 'offline' : 'occupied'));
    req.setTimeout(3000, () => { finish('occupied'); req.destroy(); });
  });
}

function createServiceRuntime({ project, baseURL, logDirectory, env = process.env,
  spawnProcess = spawn, probe = probeService, killGroup = process.kill,
  openLog = file => fs.openSync(file, 'a'), closeLog = fs.closeSync,
  makeDirectory = directory => fs.mkdirSync(directory, { recursive: true }),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  timeout = 120000 }) {
  let owned = null;
  let lastError = '';
  const logPath = path.join(logDirectory, 'mobile-preview-server.log');
  function start() {
    if (owned) return;
    makeDirectory(logDirectory);
    const descriptor = openLog(logPath);
    const node = resolveNode({ project, env });
    try {
      const child = spawnProcess(node, [path.join(project, 'node_modules/vinext/dist/cli.js'),
        'dev', '--host', '127.0.0.1', '--port', new URL(baseURL).port || '3100', '--strictPort'], {
        cwd: project, detached: true,
        env: { ...env, PATH: [path.dirname(node), env.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'].filter(Boolean).join(path.delimiter) },
        stdio: ['ignore', descriptor, descriptor],
      });
      owned = child;
      child.once('error', error => { lastError = error.message; if (owned === child) owned = null; });
      child.once('exit', code => { if (code) lastError = `本机服务退出（${code}）`; if (owned === child) owned = null; });
    } catch (error) { lastError = error.message; }
    finally { closeLog(descriptor); }
  }
  async function ensure() {
    const initial = await probe(baseURL);
    if (initial === 'ready') return true;
    // If another service is already answering, wait for it. Never replace it.
    if (initial === 'offline') {
      try { start(); }
      catch (error) { lastError = error.message; return false; }
    }
    const deadline = now() + timeout;
    while (now() < deadline) {
      if (await probe(baseURL) === 'ready') return true;
      if (lastError && !owned) return false;
      await pause(800);
    }
    return false;
  }
  function stop() {
    const child = owned;
    owned = null;
    if (!child || child.killed || child.exitCode != null || !Number.isInteger(child.pid)) return;
    try { killGroup(-child.pid, 'SIGTERM'); }
    catch { try { child.kill('SIGTERM'); } catch { /* Already exited. */ } }
  }
  return { ensure, stop, get logPath() { return logPath; }, get error() { return lastError; } };
}

module.exports = { resolveProject, resolveNode, probeService, createServiceRuntime };
