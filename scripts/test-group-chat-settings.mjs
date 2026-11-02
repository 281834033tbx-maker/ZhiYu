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
const owner = randomUUID(), otherOwner = randomUUID();
mkdirSync(join(runtime.root, '.npc-runtime'), { recursive: true });
let db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
let clock = Date.parse('2026-10-07T03:00:00Z'), calls = 0, finishDraft;
let hold = false;
const dialogue = async (_root, context) => {
  calls++;
  if (hold) return await new Promise(resolve => { finishDraft = resolve; });
  return { messages: [{ senderId: 'molly', text: context.kind === 'opening' ? '老大，这里是合成测试群\n@陈年' : '合成回复', mentionIds: context.kind === 'opening' ? ['chen-nian'] : [] }] };
};
const namer = async () => '合成设置测试群';
let store = new GroupChatStore(db, runtime.root, namer, () => clock, randomUUID, dialogue);
db.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT)');
const privateHistory = JSON.stringify({ messages: [], values: { affection: 27 }, memories: ['private synthetic memory'] });
db.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`, privateHistory);
store.remember(owner, { sourceCharacterId: 'zhou-chef', messageId: 'stable-food-evidence', text: '我对海鲜过敏', at: '2026-10-07T02:00:00Z' });
const taskFactsBefore = db.prepare('SELECT operations FROM npc_group_task_memory_events WHERE owner=? ORDER BY seq').all(owner);
const requestId = () => randomUUID();
const memberInput = (groupId, addIds = [], removeIds = [], id = requestId()) => ({ groupId, addIds, removeIds, requestId: id });
try {
  const group = await store.create(owner, { requestId: requestId(), sourceCharacterId: 'zhou-chef', consent: true,
    goal: '原始营养任务保持原样', memberIds: ['chen-nian'], self: { name: '合成设置用户' } });
  await store.tick();
  assert.equal(group.purpose, '聊天群'); assert.equal(group.pinned, false);
  const before = store.get(owner, group.id);
  const originalMessages = structuredClone(before.messages);
  const queueCount = () => db.prepare('SELECT COUNT(*) AS count FROM npc_group_jobs WHERE owner=? AND group_id=?').get(owner, group.id).count;
  const beforeQueue = queueCount();
  const settingsId = requestId();
  const changed = store.settings(owner, { groupId: group.id, purpose: '健身群', pinned: true, requestId: settingsId });
  assert.equal(changed.purpose, '健身群'); assert.equal(changed.pinned, true); assert.equal(changed.goal, before.goal);
  assert.deepEqual(changed.messages, originalMessages);
  store.settings(owner, { groupId: group.id, purpose: '健身群', pinned: true, requestId: settingsId });
  assert.throws(() => store.settings(owner, { groupId: group.id, purpose: '聊天群', pinned: true, requestId: settingsId }), /其他群设置/);
  assert.throws(() => store.settings(otherOwner, { groupId: group.id, purpose: '健身群', requestId: requestId() }), /不存在/);
  assert.throws(() => store.settings(owner, { groupId: group.id, purpose: '字'.repeat(121), requestId: requestId() }), /120字/);
  assert.throws(() => store.settings(owner, { groupId: group.id, pinned: 'yes', requestId: requestId() }), /置顶/);
  assert.throws(() => store.settings(owner, { groupId: group.id, purpose: '聊天群', goal: '禁止改任务', requestId: requestId() }), /不支持/);
  assert.throws(() => store.settings(owner, { groupId: group.id, requestId: requestId() }), /要修改/);
  assert.throws(() => store.settings(owner, { groupId: group.id, pinned: true, requestId: 'bad' }), /编号/);
  store.settings(owner, { groupId: group.id, purpose: '', requestId: requestId() });
  assert.equal(store.get(owner, group.id).purpose, undefined);
  assert.equal(store.get(owner, group.id).pinned, true, 'changing the label must retain pin state');

  const chen = before.members.find(member => member.id === 'chen-nian');
  const maxOriginalOrder = Math.max(...before.members.map(member => member.order));
  clock += 60_000;
  const addId = requestId();
  const members = store.members(owner, memberInput(group.id, ['he-jiawei', 'liu', 'he-jiawei'], [], addId)).members;
  assert.equal(members.find(member => member.id === 'he-jiawei').order, maxOriginalOrder + 1);
  assert.equal(members.find(member => member.id === 'liu').order, maxOriginalOrder + 2);
  const afterAdd = structuredClone(members);
  store.members(owner, memberInput(group.id, ['he-jiawei', 'liu', 'he-jiawei'], [], addId));
  assert.deepEqual(store.get(owner, group.id).members, afterAdd, 'duplicate member requests must not change join order');
  assert.throws(() => store.members(owner, memberInput(group.id, ['xia-xia'], [], addId)), /其他群设置/);
  assert.throws(() => store.members(otherOwner, memberInput(group.id, ['xia-xia'])), /不存在/);
  for (const id of ['molly', 'user', 'unknown', 'zhao-yifan']) {
    assert.throws(() => store.members(owner, memberInput(group.id, [], [id])), /普通 NPC/);
    assert.throws(() => store.members(owner, memberInput(group.id, [id])), /普通 NPC/);
  }
  assert.throws(() => store.members(owner, memberInput(group.id, ['chen-nian'], ['chen-nian'])), /同时/);
  store.members(owner, memberInput(group.id, [], ['chen-nian']));
  let snapshot = store.get(owner, group.id);
  assert.ok(!snapshot.members.some(member => member.id === 'chen-nian'));
  assert.deepEqual(snapshot.formerMembers.find(member => member.id === 'chen-nian'), chen);
  assert.deepEqual(snapshot.messages, originalMessages, 'old sender and @ histories are retained');
  clock += 60_000;
  store.members(owner, memberInput(group.id, ['chen-nian']));
  snapshot = store.get(owner, group.id);
  const rejoined = snapshot.members.find(member => member.id === 'chen-nian');
  assert.equal(rejoined.order, maxOriginalOrder + 3); assert.notEqual(rejoined.joinedAt, chen.joinedAt);
  assert.equal(snapshot.formerMembers.find(member => member.id === 'chen-nian').order, chen.order);
  assert.equal(queueCount(), beforeQueue); assert.equal(calls, 1, 'settings and member mutations cannot launch AI or repeat the opening');
  store.open(owner, group.id); await store.tick(); assert.equal(calls, 1);

  // A pending generation cannot reply as a member who left, nor pass along a
  // handoff from that removed message to a still-present member.
  hold = true;
  const userId = requestId();
  store.send(owner, { groupId: group.id, text: '@陈年 请接这个话题', mentionIds: ['chen-nian'], requestId: userId });
  const inflight = store.run(owner, group.id);
  assert.equal(typeof finishDraft, 'function');
  store.members(owner, memberInput(group.id, [], ['chen-nian']));
  finishDraft({ messages: [
    { senderId: 'chen-nian', text: 'REMOVED_MEMBER_REPLY', mentionIds: ['he-jiawei'] },
    { senderId: 'he-jiawei', text: 'DEPENDENT_STALE_HANDOFF', mentionIds: [] },
    { senderId: 'molly', text: '保留的主持回应', mentionIds: [] },
  ], planDraft: { days: [], shopping: [] } });
  await inflight;
  snapshot = store.get(owner, group.id);
  assert.ok(snapshot.messages.some(message => message.requestId === userId));
  assert.ok(!snapshot.messages.some(message => /REMOVED_MEMBER_REPLY|DEPENDENT_STALE_HANDOFF/.test(message.text || '')));
  assert.equal(snapshot.messages.at(-1).text, '保留的主持回应');
  assert.equal(snapshot.plan, undefined); assert.equal(snapshot.error, '');

  // Removing a handoff target drops that obsolete instruction and dependent
  // speech. Removing and immediately rejoining cannot revive old drafts.
  clock += 60_000;
  store.members(owner, memberInput(group.id, ['chen-nian']));
  store.send(owner, { groupId: group.id, text: '@陈年 再答一次', mentionIds: ['chen-nian'], requestId: requestId() });
  const rejoinDraft = store.run(owner, group.id);
  store.members(owner, memberInput(group.id, [], ['chen-nian'])); clock += 60_000;
  store.members(owner, memberInput(group.id, ['chen-nian']));
  finishDraft({ messages: [{ senderId: 'chen-nian', text: 'OLD_JOIN_DRAFT', mentionIds: [] }] });
  await rejoinDraft;
  assert.ok(!store.get(owner, group.id).messages.some(message => message.text === 'OLD_JOIN_DRAFT'));
  store.send(owner, { groupId: group.id, text: '@Molly 请安排', mentionIds: ['molly'], requestId: requestId() });
  const obsoleteMention = store.run(owner, group.id);
  store.members(owner, memberInput(group.id, [], ['he-jiawei']));
  finishDraft({ messages: [
    { senderId: 'molly', text: '@何嘉伟 交给你', mentionIds: ['he-jiawei'] },
    { senderId: 'he-jiawei', text: '已离群不应回应', mentionIds: [] },
  ] });
  await obsoleteMention;
  assert.ok(!store.get(owner, group.id).messages.some(message => message.text === '@何嘉伟 交给你'));
  assert.equal(store.get(owner, group.id).error, '');
  assert.throws(() => store.send(owner, { groupId: group.id, text: '不能再@离群者', mentionIds: ['he-jiawei'], requestId: requestId() }), /@成员/);

  // If a member leaves during the very first introduction, filtering Molly's
  // stale @ assignment must not make a later NPC the first speaker.
  const openingRace = await store.create(owner, { requestId: requestId(), sourceCharacterId: 'molly',
    goal: '合成开场竞态', memberIds: ['chen-nian', 'zhou-chef'], self: { name: '合成开场用户' } });
  const obsoleteOpening = store.run(owner, openingRace.id);
  store.members(owner, memberInput(openingRace.id, [], ['chen-nian']));
  finishDraft({ messages: [
    { senderId: 'molly', text: '老大\n@陈年 先安排', mentionIds: ['chen-nian'] },
    { senderId: 'zhou-chef', text: 'OLD_OPENING_CHEF_MUST_NOT_BE_FIRST', mentionIds: [] },
  ] });
  await obsoleteOpening;
  assert.deepEqual(store.get(owner, openingRace.id).messages, []);
  assert.equal(store.get(owner, openingRace.id).pending, true);
  assert.equal(store.get(owner, openingRace.id).error, '');
  const freshOpening = store.run(owner, openingRace.id);
  finishDraft({ messages: [
    { senderId: 'molly', text: '老大\n@赵一帆 来接做饭', mentionIds: ['zhou-chef'] },
    { senderId: 'zhou-chef', text: '做饭前叫我', mentionIds: [] },
  ] });
  await freshOpening;
  const finishedOpening = store.get(owner, openingRace.id);
  assert.equal(finishedOpening.messages[0].senderId, 'molly');
  assert.ok(!finishedOpening.messages.some(message => message.text === 'OLD_OPENING_CHEF_MUST_NOT_BE_FIRST'));
  assert.equal(finishedOpening.pending, false);
  store.open(owner, openingRace.id);
  assert.equal(store.get(owner, openingRace.id).pending, false, 'the repaired opening still completes only once');

  // Chef departure pauses previously confirmed preparation reminders and does
  // not resume them merely because the chef is added back later.
  const row = db.prepare('SELECT data FROM npc_group_chats WHERE owner=? AND id=?').get(owner, group.id);
  const stored = JSON.parse(row.data);
  stored.reminders = [{ id: 'synthetic-reminder', meal: 'breakfast', time: '08:00', timezone: 'Asia/Shanghai',
    startDate: '2026-10-07', endDate: '2026-10-13', status: 'active', confirmationMessageId: 'synthetic-confirmed-event' }];
  db.prepare('UPDATE npc_group_chats SET data=? WHERE owner=? AND id=?').run(JSON.stringify(stored), owner, group.id);
  store.members(owner, memberInput(group.id, [], ['zhou-chef']));
  assert.equal(store.get(owner, group.id).reminders[0].status, 'paused');
  assert.throws(() => store.controlReminder(owner, { groupId: group.id, reminderId: 'synthetic-reminder', operation: 'resume', requestId: requestId() }), /赵一帆/);
  store.members(owner, memberInput(group.id, ['zhou-chef']));
  assert.equal(store.get(owner, group.id).reminders[0].status, 'paused');
  hold = false;
  const beforeRestart = store.get(owner, group.id);
  store.stop(); db.close(); db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  store = new GroupChatStore(db, runtime.root, namer, () => clock, randomUUID, dialogue);
  assert.deepEqual(store.get(owner, group.id), beforeRestart);
  assert.equal(db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(`${owner}:chen-nian`).data, privateHistory);
  assert.deepEqual(db.prepare('SELECT operations FROM npc_group_task_memory_events WHERE owner=? ORDER BY seq').all(owner), taskFactsBefore,
    'member management must not delete private history, relationship values or existing task facts');
  store.settings(owner, { groupId: group.id, purpose: '健身群', pinned: true, requestId: settingsId });
  assert.equal(store.get(owner, group.id).purpose, undefined, 'replaying an older request must not overwrite later label changes');

  // Exercise the actual new HTTP branches with synthetic owner cookies; the
  // existing auth integration regression checks authenticated cookie binding.
  const events = new EventEmitter(); let handler;
  groupChatsLocal({ namer, automatic: false, dialogue }).configureServer({ config: { root: runtime.root }, httpServer: events,
    middlewares: { use: (_path, value) => { handler = value; } } });
  const post = (body, who = owner) => new Promise(resolve => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.url = '/';
    req.headers = { host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', cookie: `zhiyu_npc=${who}`, 'content-type': 'application/json' };
    const res = { statusCode: 200, writableEnded: false, setHeader() {}, end(raw) { this.writableEnded = true; resolve({ status: this.statusCode, data: JSON.parse(raw) }); } };
    handler(req, res);
  });
  try {
    assert.equal((await post({ action: 'settings', groupId: group.id, pinned: false, requestId: requestId() })).status, 200);
    assert.equal((await post({ action: 'members', ...memberInput(group.id, ['xia-xia']) })).status, 200);
    assert.equal((await post({ action: 'settings', groupId: group.id, purpose: '聊天群', requestId: requestId() }, otherOwner)).status, 404);
    assert.equal((await post({ action: 'members', ...memberInput(group.id, ['liu']) }, otherOwner)).status, 404);
    assert.equal((await post({ action: 'members', ...memberInput(group.id, [], ['molly']) })).status, 400);
    assert.equal(store.get(owner, group.id).pinned, false);
  } finally { events.emit('close'); }
  console.log('PASS owner-scoped persistent labels/pins, idempotent member management, join order and former identities, history preservation, no AI side effects, pending departure/handoff/rejoin filtering and chef-reminder pause; isolated synthetic data only.');
} finally { store.stop(); db.close(); runtime.cleanup(); }
