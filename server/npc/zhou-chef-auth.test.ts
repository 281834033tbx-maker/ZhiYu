import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ViteDevServer } from 'vite';
import { authLocal } from './auth-plugin';

void test('厨师与陈年接口用真实登录middleware核对账号header；切换账号、缺失和错误header均在next前拒绝', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chef-auth-boundary-'));
  const server = new EventEmitter();
  let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const plugin = authLocal();
  const hook = plugin.configureServer as (server: ViteDevServer) => void;
  hook({ config: { root }, httpServer: server, middlewares: { use: (fn: typeof middleware) => { middleware = fn; } } } as unknown as ViteDevServer);
  const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
  const addAccount = (username: string) => {
    const account = { id: randomUUID(), owner: randomUUID(), token: randomBytes(32).toString('hex') };
    // Synthetic rows only; no production passwords, API calls or credentials are read.
    db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(account.id, username, '0'.repeat(32), '0'.repeat(128), account.owner, Date.now());
    db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(account.token).digest('hex'), account.id, Date.now() + 60_000);
    return account;
  };
  const a = addAccount('syntheticA'), b = addAccount('syntheticB');
  const request = (path: string, token: string, header?: string) => new Promise<{ status: number; next: boolean; cookie: string; body?: unknown }>(resolve => {
    const req = Readable.from([]) as IncomingMessage;
    req.method = 'GET'; req.url = path;
    req.headers = { host: '127.0.0.1:3101', cookie: `zhiyu_auth=${token}; zhiyu_npc=${b.owner}`, ...(header ? { 'x-zhiyu-account': header } : {}) };
    const res = { statusCode: 200, setHeader: () => {}, end(value: string) {
      resolve({ status: this.statusCode, next: false, cookie: req.headers.cookie || '', body: JSON.parse(value) });
    } };
    middleware(req, res as unknown as ServerResponse, () => resolve({ status: 200, next: true, cookie: req.headers.cookie || '' }));
  });
  try {
    for (const path of ['/api/npc/zhou-chef','/api/npc/chen-nian']) {
    const matching = await request(path+'?mode=normal', a.token, a.id);
    assert.equal(matching.next, true);
    assert.match(matching.cookie, new RegExp(`zhiyu_npc=${a.owner}`));
    assert.ok(!matching.cookie.includes(`zhiyu_npc=${b.owner}`), 'client owner cookie must be replaced by authenticated account identity');
    for (const rejected of [
      await request(path, a.token),
      await request(path, a.token, b.id),
      await request(path, b.token, a.id),
    ]) { assert.equal(rejected.status, 409); assert.equal(rejected.next, false); }
    const switched = await request(path, b.token, b.id);
    assert.equal(switched.next, true); assert.match(switched.cookie, new RegExp(`zhiyu_npc=${b.owner}`));
    const unauthenticated = await request(path, randomBytes(32).toString('hex'), a.id);
    assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.next, false);
    }
    const existingNpc = await request('/api/npc/yuan-xiaoman?mode=normal', a.token);
    assert.equal(existingNpc.next, true); assert.match(existingNpc.cookie, new RegExp(`zhiyu_npc=${a.owner}`));
    const session = await request('/api/auth/session', a.token);
    assert.equal(session.status, 200); assert.equal(session.next, false);
    assert.deepEqual((session.body as { account: unknown }).account, { id: a.id, username: 'syntheticA' });
  } finally { db.close(); server.emit('close'); rmSync(root, { recursive: true, force: true }); }
});
