/* oxlint-disable typescript/no-require-imports -- Electron main-process helpers and Node tests use CommonJS. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveLocalIdentity } = require('../local-identity.cjs');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-identity-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('first launch persists a private identity and later launches keep it', t => {
  const root = project(t);
  const id = resolveLocalIdentity({ projectRoot: root });
  assert.match(id, uuid);
  assert.equal(resolveLocalIdentity({ projectRoot: root, createUUID() { throw new Error('must not regenerate'); } }), id);
  const filename = path.join(root, '.npc-runtime', 'desktop-identity.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), { schemaVersion: 1, id });
  if (process.platform !== 'win32') assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(filename)), ['desktop-identity.json']);
});

test('different projects receive independent identities', t => {
  const first = project(t);
  const second = project(t);
  assert.notEqual(resolveLocalIdentity({ projectRoot: first }), resolveLocalIdentity({ projectRoot: second }));
});

test('explicit override is honored without creating or overwriting project identity', t => {
  const root = project(t);
  const override = 'explicit-migration-identity';
  assert.equal(resolveLocalIdentity({ projectRoot: root, override, io: {} }), override);
  assert.equal(fs.existsSync(path.join(root, '.npc-runtime')), false);
  const original = resolveLocalIdentity({ projectRoot: root });
  assert.equal(resolveLocalIdentity({ projectRoot: root, override }), override);
  assert.equal(resolveLocalIdentity({ projectRoot: root }), original);
});

test('storage read and write errors fail instead of inventing a replacement identity', t => {
  const root = project(t);
  const error = Object.assign(new Error('fixture storage denied'), { code: 'EACCES' });
  assert.throws(() => resolveLocalIdentity({ projectRoot: root, io: {
    ...fs, readFileSync() { throw error; },
  } }), candidate => candidate === error);
  assert.throws(() => resolveLocalIdentity({ projectRoot: root, io: {
    ...fs, writeFileSync() { throw error; },
  } }), candidate => candidate === error);
  assert.equal(fs.existsSync(path.join(root, '.npc-runtime', 'desktop-identity.json')), false);
});

test('corrupt saved identity is preserved and startup fails', t => {
  const root = project(t);
  const directory = path.join(root, '.npc-runtime');
  fs.mkdirSync(directory);
  const filename = path.join(directory, 'desktop-identity.json');
  const corrupt = '{"schemaVersion":1,"id":"invalid-existing-identity"}\n';
  fs.writeFileSync(filename, corrupt);
  assert.throws(() => resolveLocalIdentity({ projectRoot: root }), /身份文件无效/);
  assert.equal(fs.readFileSync(filename, 'utf8'), corrupt);
});

test('a concurrent first launcher reuses the atomically published identity', t => {
  const root = project(t);
  let winner;
  const io = { ...fs, linkSync(from, to) {
    winner = resolveLocalIdentity({ projectRoot: root });
    fs.linkSync(from, to);
  } };
  assert.equal(resolveLocalIdentity({ projectRoot: root, io }), winner);
  assert.equal(resolveLocalIdentity({ projectRoot: root }), winner);
  assert.deepEqual(fs.readdirSync(path.join(root, '.npc-runtime')), ['desktop-identity.json']);
});
