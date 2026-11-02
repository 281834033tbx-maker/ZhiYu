import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';

// Synthetic browser preferences only. Never open the user's browser storage,
// database, chats or tasks, and never call a provider or network endpoint.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'output');
mkdirSync(outputRoot, {recursive: true});
const fixtureRoot = mkdtempSync(join(outputRoot, '.task-completion-fixture-'));
const originals = new Map(['window', 'localStorage', 'CustomEvent'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const values = new Map();
let readsBlocked = false;
let writesBlocked = false;
const storage = {
  getItem(key) {if (readsBlocked) throw Error('synthetic storage read unavailable'); return values.get(String(key)) ?? null;},
  setItem(key, value) {if (writesBlocked) throw Error('synthetic storage write unavailable'); values.set(String(key), String(value));},
  removeItem(key) {if (writesBlocked) throw Error('synthetic storage write unavailable'); values.delete(String(key));},
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
  const source = readFileSync(join(projectRoot, 'app/zhiyu/task-completion.ts'), 'utf8');
  const modulePath = join(fixtureRoot, 'task-completion.mjs');
  writeFileSync(modulePath, ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText);
  const moduleUrl = pathToFileURL(modulePath).href;
  const {TASK_COMPLETION_CHANGED, taskCompletionKey, readTaskCompletions, setTaskComplete} = await import(moduleUrl);
  browser.addEventListener(TASK_COMPLETION_CHANGED, event => events.push(event.detail));
  assert.equal(TASK_COMPLETION_CHANGED, 'zhiyu-task-completion-changed');
  const accountA = 'synthetic/account:A', accountB = 'synthetic/account:B';
  const originalTask = 'group-a:plan-a:2026-10-08:breakfast:content-v1';
  const nextDayTask = 'group-a:plan-a:2026-10-09:breakfast:content-v1';
  const editedTask = 'group-a:plan-a:2026-10-08:breakfast:content-v2';
  const otherGroupTask = 'group-b:plan-a:2026-10-08:breakfast:content-v1';
  const reminderTask = 'group-a:reminder-a:2026-10-08:breakfast:content-v1';
  const unchangedLegacyKey = `zhiyu-stitch-desktop-v2:${accountA}`;
  const unchangedLegacyValue = JSON.stringify({messages: {synthetic: []}, muted: ['molly']});
  values.set(unchangedLegacyKey, unchangedLegacyValue);

  assert.notEqual(taskCompletionKey(accountA), taskCompletionKey(accountB));
  assert.deepEqual(readTaskCompletions(''), {});
  assert.deepEqual(readTaskCompletions(accountA), {});
  assert.deepEqual(readTaskCompletions(accountB), {});
  setTaskComplete(accountA, originalTask, true);
  assert.deepEqual(readTaskCompletions(accountA), {[originalTask]: true});
  assert.deepEqual(readTaskCompletions(accountB), {}, 'account B must not inherit account A completion');
  assert.equal(readTaskCompletions(accountA)[nextDayTask], undefined, 'the next date occurrence is a different task');
  assert.equal(readTaskCompletions(accountA)[editedTask], undefined, 'changed task content does not inherit an old completion');
  assert.equal(readTaskCompletions(accountA)[otherGroupTask], undefined, 'another group is isolated even with the same plan ID');
  assert.equal(readTaskCompletions(accountA)[reminderTask], undefined, 'plan and reminder sources do not share completion');
  assert.equal(events.at(-1)?.accountId, accountA);
  const eventCountBeforeMissingIdentity = events.length;
  assert.throws(() => setTaskComplete('', originalTask, true), /账号|登录|加载|account/i);
  assert.throws(() => setTaskComplete(accountA, '', true), /任务|加载|task/i);
  assert.equal(events.length, eventCountBeforeMissingIdentity, 'missing account/task identity cannot announce a saved completion');
  const eventCountBeforeDuplicate = events.length;
  setTaskComplete(accountA, originalTask, true);
  assert.equal(events.length, eventCountBeforeDuplicate, 'saving the same state does not announce another change');

  const reopened = await import(`${moduleUrl}?synthetic-reopen=1`);
  assert.deepEqual(reopened.readTaskCompletions(accountA), {[originalTask]: true}, 'a fresh module reads the persisted completion');
  setTaskComplete(accountB, originalTask, true);
  assert.deepEqual(readTaskCompletions(accountB), {[originalTask]: true});
  assert.deepEqual(readTaskCompletions(accountA), {[originalTask]: true});

  // Simulate another window writing after this module read its earlier snapshot.
  values.set(taskCompletionKey(accountA), JSON.stringify({[originalTask]: true, [otherGroupTask]: true}));
  setTaskComplete(accountA, nextDayTask, true);
  assert.deepEqual(readTaskCompletions(accountA), {[originalTask]: true, [otherGroupTask]: true, [nextDayTask]: true}, 'one write merges into the latest storage and preserves a second window task');
  setTaskComplete(accountA, originalTask, false);
  assert.deepEqual(readTaskCompletions(accountA), {[otherGroupTask]: true, [nextDayTask]: true}, 'undo affects only its own task');
  assert.deepEqual(readTaskCompletions(accountB), {[originalTask]: true}, 'undo in account A does not alter account B');
  const eventCountBeforeAbsentUndo = events.length;
  setTaskComplete(accountA, editedTask, false);
  assert.equal(events.length, eventCountBeforeAbsentUndo, 'undoing an already incomplete task is a no-op');
  assert.equal(storage.getItem(unchangedLegacyKey), unchangedLegacyValue, 'completion writes preserve the existing App state');

  for (const malformed of ['invalid-json', 'null', 'true', '42', '"done"', '[]', '["done"]']) {
    values.set(taskCompletionKey(accountA), malformed);
    assert.deepEqual(readTaskCompletions(accountA), {}, `malformed completion storage ${malformed} must be harmless`);
  }
  values.set(taskCompletionKey(accountA), JSON.stringify({[originalTask]: true, wrongFalse: false, wrongString: 'true', wrongNumber: 1, wrongObject: {done: true}}));
  assert.deepEqual(readTaskCompletions(accountA), {[originalTask]: true}, 'only the boolean true completion marker is accepted');
  readsBlocked = true;
  assert.deepEqual(readTaskCompletions(accountA), {}, 'unavailable storage reads do not prevent opening tasks');
  readsBlocked = false;

  const stateBeforeFailedWrite = storage.getItem(taskCompletionKey(accountA));
  const eventCountBeforeFailedWrite = events.length;
  writesBlocked = true;
  assert.throws(() => setTaskComplete(accountA, nextDayTask, true), /保存|存储|失败|unavailable/);
  assert.equal(events.length, eventCountBeforeFailedWrite, 'a failed completion save never announces success');
  writesBlocked = false;
  assert.equal(storage.getItem(taskCompletionKey(accountA)), stateBeforeFailedWrite, 'a failed write leaves prior completion data untouched');
  setTaskComplete(accountA, nextDayTask, true);
  assert.equal(readTaskCompletions(accountA)[nextDayTask], true, 'a later successful retry saves its task');

  delete globalThis.window;
  assert.deepEqual(readTaskCompletions(accountA), {}, 'server rendering reads an empty snapshot without browser access');
  console.log('PASS task completion account/source/date/content isolation, fresh-module persistence, latest-storage merge, undo, damaged/unavailable storage, write-failure events and SSR; synthetic fixtures only.');
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  rmSync(fixtureRoot, {recursive: true, force: true});
}
