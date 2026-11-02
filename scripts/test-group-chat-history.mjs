import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

const runtime = isolatedNpcRuntime();
const { GroupChatStore, groupChatsLocal } = await runtime.load('server/npc/groups-plugin');
const { groupChatPreview } = await runtime.load('lib/npc/group-chat');
mkdirSync(join(runtime.root, '.npc-runtime'), { recursive: true });
let db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
const owner = randomUUID(), other = randomUUID();
let clock = Date.parse('2026-10-07T03:00:00Z'), mode = 'plain', settle;
const contexts = [];
const namer = async () => '合成群设置检查';
const dialogue = async (_root, context) => {
  contexts.push(structuredClone(context));
  if (mode === 'held') return await new Promise((resolve, reject) => { settle = { resolve, reject }; });
  return { messages: [{ senderId: 'molly', text: context.kind === 'opening' ? '老大，合成群已就位' : '可见的新回复', mentionIds: [] }] };
};
let store = new GroupChatStore(db, runtime.root, namer, () => clock, randomUUID, dialogue);
const raw = id => JSON.parse(db.prepare('SELECT data FROM npc_group_chats WHERE owner=? AND id=?').get(owner, id).data);
const jobs = id => db.prepare('SELECT kind,status,error FROM npc_group_jobs WHERE owner=? AND group_id=? ORDER BY seq').all(owner, id);
const facts = () => db.prepare('SELECT * FROM npc_group_task_memory_events WHERE owner=? ORDER BY seq').all(owner);
const create = () => store.create(owner, { requestId: randomUUID(), sourceCharacterId: 'molly',
  goal: '合成一周营养安排', memberIds: ['chen-nian', 'zhou-chef'], self: { name: '合成检查用户' } });
const send = (id, text, requestId = randomUUID()) => store.send(owner, { groupId: id, text, mentionIds: [], requestId });
const mutation = id => ({ groupId: id, requestId: randomUUID() });
const statusError = status => error => error.status === status;
const seedTask = id => {
  const group = raw(id);
  group.plan = { id: 'synthetic-plan', status: 'confirmed', createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(),
    days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${7 + i}`, label: '常规均衡餐', breakfast: '合成早餐', lunch: '合成午餐', dinner: '合成晚餐' })), shopping: [] };
  group.reminders = [{ id: 'synthetic-reminder', meal: 'breakfast', time: '08:00', timezone: 'Asia/Shanghai',
    startDate: '2026-10-07', endDate: '2026-10-13', status: 'active', confirmationMessageId: 'synthetic-confirmed-evidence' }];
  db.prepare('UPDATE npc_group_chats SET data=? WHERE owner=? AND id=?').run(JSON.stringify(group), owner, id);
};
db.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT)');
const privateHistory = JSON.stringify({ messages: [{ id: 'private-user', role: 'user', at: '2026-10-06T02:00:00Z', part: { type: 'text', text: '我对海鲜过敏' } }], values: { affection: 27 }, memories: ['合成私聊记忆'] });
db.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`, privateHistory);
try {
  const group = await create(); await store.run(owner, group.id);
  assert.equal(group.muted, false);
  const original = store.get(owner, group.id), beforeJobs = jobs(group.id), beforeCalls = contexts.length;
  const settingsRequest = { groupId: group.id, requestId: randomUUID(), purpose: '字'.repeat(120),
    announcement: ' 第一行\n第二行：🍳 ', muted: true };
  const changed = store.settings(owner, settingsRequest);
  assert.equal(changed.purpose.length, 120); assert.equal(changed.announcement, '第一行\n第二行：🍳'); assert.equal(changed.muted, true);
  assert.equal(changed.goal, original.goal); assert.deepEqual(changed.messages, original.messages);
  assert.deepEqual(jobs(group.id), beforeJobs); assert.equal(contexts.length, beforeCalls, 'settings cannot speak or queue AI');
  assert.deepEqual(store.settings(owner, settingsRequest), changed);
  assert.throws(() => store.settings(owner, { ...settingsRequest, muted: false }), statusError(409));
  assert.throws(() => store.settings(other, settingsRequest), statusError(404));
  for (const input of [{ muted: 'true' }, { announcement: '字'.repeat(2001) }, { announcement: '坏\u0000字符' },
    { announcement: null }, { purpose: '字'.repeat(121) }, { purpose: '坏\n备注' }]) {
    assert.throws(() => store.settings(owner, { ...mutation(group.id), ...input }), statusError(400));
  }
  assert.throws(() => store.settings(owner, { ...mutation(group.id), muted: true, goal: '不能覆盖原始目标' }), statusError(400));
  assert.throws(() => store.settings(owner, { groupId: group.id, requestId: 'bad', muted: true }), statusError(400));
  store.settings(owner, { ...mutation(group.id), announcement: '🍳'.repeat(2000) });
  assert.equal(Array.from(store.get(owner, group.id).announcement).length, 2000, 'limits count Unicode characters');
  store.settings(owner, { ...mutation(group.id), announcement: ' \n ', purpose: ' ' });
  assert.equal(store.get(owner, group.id).announcement, undefined); assert.equal(store.get(owner, group.id).purpose, undefined);
  assert.equal(store.get(owner, group.id).muted, true);
  store.settings(owner, { ...mutation(group.id), announcement: '持久化公告\n第二行', purpose: '这是一条超过二十字但仍有效的合成群备注，保持原始目标', muted: false });

  // Clearing hides this owner's displayed messages while retaining raw history,
  // private relationships, shared task facts, confirmed plans and reminders.
  seedTask(group.id);
  send(group.id, 'CLEAR_HIDDEN_USER_TEXT'); await store.run(owner, group.id);
  const beforeClear = raw(group.id), beforeClearFacts = facts();
  const clearRequest = mutation(group.id);
  const cleared = store.clear(owner, clearRequest);
  assert.deepEqual(cleared.messages, []); assert.deepEqual(store.list(owner)[0].messages, []);
  assert.equal(groupChatPreview(cleared), '群聊已建立'); assert.equal(cleared.pending, false); assert.equal(cleared.error, '');
  assert.equal(cleared.clearedAt, new Date(clock).toISOString());
  assert.deepEqual(raw(group.id).messages, beforeClear.messages); assert.deepEqual(facts(), beforeClearFacts);
  assert.deepEqual(cleared.plan, beforeClear.plan); assert.deepEqual(cleared.reminders, beforeClear.reminders);
  assert.equal(db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(`${owner}:chen-nian`).data, privateHistory);
  assert.equal('hiddenBefore' in cleared, false); assert.equal('generationEpoch' in cleared, false); assert.equal('openingDone' in cleared, false);
  assert.throws(() => store.clear(other, clearRequest), statusError(404));
  assert.throws(() => store.clear(owner, { groupId: group.id, requestId: 'bad' }), statusError(400));
  assert.throws(() => store.clear(owner, { ...mutation(group.id), eraseFacts: true }), statusError(400));
  const callsAtClear = contexts.length;
  store.open(owner, group.id); await store.run(owner, group.id);
  assert.equal(contexts.length, callsAtClear, 'clear must not restart the Molly introduction');
  clock += 60_000;
  send(group.id, 'NEW_VISIBLE_USER_TEXT'); await store.run(owner, group.id);
  const afterClear = store.get(owner, group.id);
  assert.equal(afterClear.messages.length, 2);
  assert.ok(contexts.at(-1).group.messages.every(message => message.text !== 'CLEAR_HIDDEN_USER_TEXT'));
  assert.deepEqual(contexts.at(-1).group.messages.map(message => message.text), ['NEW_VISIBLE_USER_TEXT']);
  assert.ok(contexts.at(-1).facts.facts.some(fact => fact.key === 'food_allergy' && fact.value === '海鲜'));
  store.clear(owner, clearRequest);
  assert.deepEqual(store.get(owner, group.id).messages, afterClear.messages, 'retrying the original clear must not hide later messages');
  assert.equal(store.get(owner, group.id).clearedAt, cleared.clearedAt);
  assert.throws(() => store.exit(owner, clearRequest), statusError(409));

  // Late success and failure from requests cancelled by clearing cannot recreate
  // messages, change the plan, activate reminders or show an error.
  mode = 'held';
  send(group.id, '合成待生成消息');
  const heldSuccess = store.run(owner, group.id);
  assert.ok(settle); send(group.id, '排在旧生成后面的消息');
  const taskBeforeRace = raw(group.id), raceFacts = facts();
  store.clear(owner, mutation(group.id));
  const epoch = raw(group.id).generationEpoch;
  settle.resolve({ messages: [{ senderId: 'chen-nian', text: 'LATE_CLEAR_REPLY', mentionIds: [] }],
    planDraft: { days: [], shopping: [] }, reminderProposals: [{ meal: 'lunch', time: '12:00', startDate: '2026-10-07', endDate: '2026-10-13', evidence: '合成待生成消息' }] });
  await heldSuccess;
  assert.deepEqual(store.get(owner, group.id).messages, []); assert.equal(store.get(owner, group.id).pending, false);
  assert.deepEqual(raw(group.id).messages, taskBeforeRace.messages); assert.deepEqual(raw(group.id).plan, taskBeforeRace.plan);
  assert.deepEqual(raw(group.id).reminders, taskBeforeRace.reminders); assert.deepEqual(facts(), raceFacts);
  assert.ok(jobs(group.id).slice(-2).every(job => job.status === 'cancelled' && !job.error));
  send(group.id, '清空失败竞态'); const heldFailure = store.run(owner, group.id);
  store.clear(owner, mutation(group.id)); settle.reject(new Error('late synthetic failure')); await heldFailure;
  assert.equal(store.get(owner, group.id).error, ''); assert.equal(jobs(group.id).at(-1).status, 'cancelled');
  assert.ok(raw(group.id).generationEpoch > epoch);

  // Even an unfinished initial opening remains silent once explicitly cleared.
  const unopened = await create();
  const unfinishedOpening = store.run(owner, unopened.id);
  store.clear(owner, mutation(unopened.id));
  settle.resolve({ messages: [{ senderId: 'molly', text: 'LATE_OPENING', mentionIds: [] }] }); await unfinishedOpening;
  const beforeReopenCalls = contexts.length;
  store.open(owner, unopened.id); await store.run(owner, unopened.id);
  assert.equal(contexts.length, beforeReopenCalls); assert.deepEqual(store.get(owner, unopened.id).messages, []);

  // Exit removes the owner's conversation, pauses reminders and cancels old
  // work, while the underlying historical record remains recoverable.
  mode = 'plain'; const exiting = await create(); await store.run(owner, exiting.id); seedTask(exiting.id);
  mode = 'held'; send(exiting.id, '退出前待回复'); const exitGeneration = store.run(owner, exiting.id);
  send(exiting.id, '退出前排队');
  const beforeExit = raw(exiting.id), exitFacts = facts(), exitRequest = mutation(exiting.id);
  const exited = store.exit(owner, exitRequest);
  assert.equal(exited.leftAt, new Date(clock).toISOString()); assert.equal(exited.pending, false); assert.equal(exited.error, '');
  assert.equal(exited.reminders[0].status, 'paused'); assert.deepEqual(exited.plan, beforeExit.plan);
  assert.ok(!store.list(owner).some(item => item.id === exiting.id));
  assert.deepEqual(raw(exiting.id).messages, beforeExit.messages); assert.deepEqual(facts(), exitFacts);
  settle.resolve({ messages: [{ senderId: 'molly', text: 'LATE_EXIT_REPLY', mentionIds: [] }], planDraft: { days: [], shopping: [] } });
  await exitGeneration;
  assert.deepEqual(raw(exiting.id).messages, beforeExit.messages); assert.deepEqual(raw(exiting.id).plan, beforeExit.plan);
  assert.ok(jobs(exiting.id).slice(-2).every(job => job.status === 'cancelled' && !job.error));
  const exitedEpoch = raw(exiting.id).generationEpoch;
  assert.deepEqual(store.exit(owner, exitRequest), exited); assert.equal(raw(exiting.id).generationEpoch, exitedEpoch);
  assert.throws(() => store.exit(other, exitRequest), statusError(404));
  assert.throws(() => store.exit(owner, { groupId: exiting.id, requestId: 'bad' }), statusError(400));
  for (const action of [
    () => store.open(owner, exiting.id), () => send(exiting.id, '不能复活'), () => store.rename(owner, exiting.id, '不能改名'),
    () => store.settings(owner, { ...mutation(exiting.id), muted: false }), () => store.members(owner, { ...mutation(exiting.id), addIds: ['liu'], removeIds: [] }),
    () => store.retry(owner, exiting.id), () => store.confirmPlan(owner, { ...mutation(exiting.id), planId: 'synthetic-plan' }),
    () => store.controlReminder(owner, { ...mutation(exiting.id), reminderId: 'synthetic-reminder', operation: 'resume' }),
    () => store.clear(owner, mutation(exiting.id)),
  ]) assert.throws(action, statusError(410));
  const exitFailure = await create(); const failingExitOpening = store.run(owner, exitFailure.id);
  store.exit(owner, mutation(exitFailure.id)); settle.reject(new Error('late exit failure')); await failingExitOpening;
  assert.equal(jobs(exitFailure.id).at(-1).status, 'cancelled'); assert.equal(store.get(owner, exitFailure.id).error, '');
  const callsBeforeExitedTick = contexts.length;
  mode = 'plain'; clock = Date.parse('2026-10-08T00:00:01Z'); await store.tick();
  assert.equal(raw(exiting.id).reminders[0].status, 'paused');
  assert.ok(!contexts.slice(callsBeforeExitedTick).some(context => context.group.id === exiting.id || context.group.id === exitFailure.id));

  // Owner scoping and hidden history/settings survive a fresh process.
  const beforeRestart = store.get(owner, group.id), beforeExitedRestart = store.get(owner, exiting.id);
  store.stop(); db.close(); db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  store = new GroupChatStore(db, runtime.root, namer, () => clock, randomUUID, dialogue);
  assert.deepEqual(store.get(owner, group.id), beforeRestart); assert.deepEqual(store.get(owner, exiting.id), beforeExitedRestart);
  assert.ok(!store.list(owner).some(item => item.id === exiting.id)); assert.deepEqual(store.list(other), []);
  assert.equal(db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(`${owner}:chen-nian`).data, privateHistory);

  // Actual route branches use synthetic cookie identities and disabled launch.
  const events = new EventEmitter(); let handler;
  groupChatsLocal({ namer, automatic: false, dialogue }).configureServer({ config: { root: runtime.root }, httpServer: events,
    middlewares: { use: (_path, value) => { handler = value; } } });
  const post = (body, who = owner) => new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.url = '/';
    req.headers = { host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', cookie: `zhiyu_npc=${who}`, 'content-type': 'application/json' };
    const res = { statusCode: 200, writableEnded: false, setHeader() {}, end(value) { this.writableEnded = true; resolve({ status: this.statusCode, data: JSON.parse(value) }); } };
    handler(req, res);
  });
  try {
    const routeGroup = await create();
    const settingsResponse = await post({ action: 'settings', ...mutation(routeGroup.id), announcement: 'HTTP合成公告', muted: true });
    assert.equal(settingsResponse.status, 200); assert.equal(settingsResponse.data.group.announcement, 'HTTP合成公告'); assert.equal(settingsResponse.data.group.muted, true);
    send(routeGroup.id, 'HTTP_SOFT_CLEAR_HISTORY');
    const routeClear = { action: 'clear', ...mutation(routeGroup.id) };
    assert.equal((await post(routeClear, other)).status, 404);
    const clearResponse = await post(routeClear);
    assert.equal(clearResponse.status, 200); assert.deepEqual(clearResponse.data.group.messages, []);
    assert.ok(raw(routeGroup.id).messages.some(message => message.text === 'HTTP_SOFT_CLEAR_HISTORY'));
    const routeExit = { action: 'exit', ...mutation(routeGroup.id) };
    assert.equal((await post(routeExit, other)).status, 404);
    const exitResponse = await post(routeExit);
    assert.equal(exitResponse.status, 200); assert.ok(exitResponse.data.group.leftAt);
    assert.equal((await post(routeExit)).status, 200);
    assert.equal((await post({ action: 'settings', ...mutation(routeGroup.id), muted: false })).status, 410);
    assert.equal((await post({ action: 'open', groupId: routeGroup.id })).status, 410);
  } finally { events.emit('close'); }
  console.log('PASS persistent announcement/120-character remark/mute, owner-scoped soft clear/exit, raw/private/task history preservation, idempotent clears, no repeated opening, late-success/failure cancellation, reminder pause, restart and HTTP branches; isolated synthetic fixtures only.');
} finally { store.stop(); db.close(); runtime.cleanup(); }
