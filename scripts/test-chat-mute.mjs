import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';

// Synthetic browser preferences only: no hooks, network, live storage or NPC state.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'output');
mkdirSync(outputRoot, {recursive: true});
const fixtureRoot = mkdtempSync(join(outputRoot, '.chat-mute-fixture-'));
const originals = new Map(['window', 'localStorage', 'CustomEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const values = new Map();
let blocked = false;
const storage = {
  getItem(key) {if (blocked) throw new Error('synthetic storage unavailable'); return values.get(String(key)) ?? null;},
  setItem(key, value) {if (blocked) throw new Error('synthetic storage unavailable'); values.set(String(key), String(value));},
  removeItem(key) {values.delete(String(key));},
};
class FixtureCustomEvent extends Event {
  constructor(type, options = {}) {super(type, options); this.detail = options.detail;}
}
const browser = new EventTarget();
const events = [];
for (const [key, value] of [['window', browser], ['localStorage', storage], ['CustomEvent', FixtureCustomEvent]]) {
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
try {
  const source = readFileSync(join(projectRoot, 'app/zhiyu/chat-mute.ts'), 'utf8');
  const modulePath = join(fixtureRoot, 'chat-mute.mjs');
  writeFileSync(modulePath, ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText);
  const {CHAT_MUTE_CHANGED, chatMuteKey, readMutedChats, writeMutedChats, notificationMessages} = await import(pathToFileURL(modulePath).href);
  browser.addEventListener(CHAT_MUTE_CHANGED, event => events.push(event.detail));
  const first = 'synthetic-account-a', second = 'synthetic-account-b';
  const legacyKey = accountId => `zhiyu-stitch-desktop-v2:${accountId}`;

  assert.deepEqual(readMutedChats(''), []);
  assert.deepEqual(readMutedChats(first), []);
  storage.setItem(legacyKey(first), JSON.stringify({muted: ['chen-nian', 'chen-nian', 'molly', 12, null]}));
  assert.deepEqual(readMutedChats(first), ['chen-nian', 'molly'], 'existing account muted preferences migrate without losing valid IDs');
  assert.deepEqual(readMutedChats(second), [], 'legacy preferences are account-scoped');
  const legacyBefore = storage.getItem(legacyKey(first));
  writeMutedChats(first, ['molly', 'chen-nian', 'molly']);
  assert.equal(storage.getItem(chatMuteKey(first)), '["chen-nian","molly"]');
  assert.equal(storage.getItem(legacyKey(first)), legacyBefore, 'dedicated preference writes preserve the original legacy record');
  assert.deepEqual(events, [{accountId: first}]);
  writeMutedChats(first, ['chen-nian', 'molly']);
  writeMutedChats(first, ['molly', 'chen-nian', 'chen-nian']);
  assert.equal(events.length, 1, 'ordering and duplicates do not create duplicate change events');
  writeMutedChats(second, ['he-jiawei']);
  assert.deepEqual(readMutedChats(first), ['chen-nian', 'molly']);
  assert.deepEqual(readMutedChats(second), ['he-jiawei']);
  assert.deepEqual(events.at(-1), {accountId: second});
  writeMutedChats(first, []);
  assert.deepEqual(readMutedChats(first), [], 'an explicit empty dedicated preference overrides a legacy muted list');
  assert.deepEqual(readMutedChats(second), ['he-jiawei'], 'unmuting account A does not unmute account B');
  const changedEvents = events.length;
  writeMutedChats(first, []);
  assert.equal(events.length, changedEvents);

  for (const malformed of ['not-json', 'null', 'true', '42', '"chen-nian"', '{}', '{"muted":["molly"]}']) {
    storage.setItem(chatMuteKey(first), malformed);
    assert.deepEqual(readMutedChats(first), [], `invalid dedicated preference ${malformed} must be harmless`);
  }
  storage.setItem(chatMuteKey(first), JSON.stringify(['molly', false, {}, 'molly', 'group-synthetic']));
  assert.deepEqual(readMutedChats(first), ['molly', 'group-synthetic'], 'valid strings survive a mixed malformed array');
  storage.removeItem(chatMuteKey(first));
  for (const malformed of ['bad-json', 'null', '{}', '{"muted":"molly"}', '{"muted":null}']) {
    storage.setItem(legacyKey(first), malformed);
    assert.deepEqual(readMutedChats(first), [], 'invalid legacy records do not prevent opening the app');
  }

  const mixed = Object.freeze([
    Object.freeze({id: 'npc-before', mine: false, text: 'synthetic NPC message'}),
    Object.freeze({id: 'user', mine: true, text: 'synthetic user message'}),
    Object.freeze({id: 'npc-after', mine: false, text: 'synthetic NPC reply'}),
  ]);
  const muted = notificationMessages(mixed, true);
  assert.deepEqual(muted, [mixed[1]], 'muting suppresses NPC floating bubbles while retaining user input');
  assert.equal(muted[0], mixed[1]);
  assert.deepEqual(notificationMessages(mixed, false), mixed, 'unmuted presentation retains every received message');
  assert.deepEqual(notificationMessages([], true), []);
  assert.equal(mixed.length, 3, 'presentation filtering does not mutate the received history');
  blocked = true;
  assert.deepEqual(readMutedChats(first), [], 'unavailable browser storage is harmless on read');
  assert.throws(() => writeMutedChats(first, ['molly']), /synthetic storage unavailable/);
  assert.equal(events.length, changedEvents, 'a failed write cannot announce a saved preference');
  blocked = false;
  delete globalThis.window;
  assert.deepEqual(readMutedChats(first), [], 'server rendering has no browser storage dependency');
  console.log('PASS legacy mute compatibility, account isolation, exact change events, malformed/unavailable storage, SSR reads and NPC popup suppression with preserved user input; synthetic fixtures only.');
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  rmSync(fixtureRoot, {recursive: true, force: true});
}
