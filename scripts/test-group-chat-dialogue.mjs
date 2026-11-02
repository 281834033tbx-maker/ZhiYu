import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

const runtime = isolatedNpcRuntime();
const { GroupChatStore } = await runtime.load('server/npc/groups-plugin');
const { generateGroupDialogue, parseGroupDialogue } = await runtime.load('server/npc/group-dialogue');
const { explicitTimeMatches, explicitConfirmation, reminderSuppressed, reminderOccurrence } = await runtime.load('server/npc/group-reminders');
const owner = randomUUID(), other = randomUUID();
mkdirSync(join(runtime.root, '.npc-runtime'), { recursive: true });
let db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
db.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT)');
const original = { messages: [
  { id: 'real-user-source', role: 'user', at: '2026-10-06T02:00:00.000Z', part: { type: 'text', text: '我对海鲜过敏，我体重72kg，体脂18%，身高178cm' } },
  { id: 'private-assistant', role: 'assistant', at: '2026-10-06T02:00:01.000Z', part: { type: 'text', text: 'PRIVATE_ASSISTANT_HISTORY_MUST_NOT_SHARE' } },
], values: { affection: 23 }, memories: [{ text: 'ASSISTANT_MEMORY_NOT_USER_FACT' }] };
db.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`, JSON.stringify(original));
db.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${other}:chen-nian`, JSON.stringify({ messages: [{ role: 'user', id: 'foreign', at: '2026-10-06T02:00:00Z', part: { type: 'text', text: '我对花生过敏' } }] }));
let clock = Date.parse('2026-10-06T23:55:00Z');
let fail = false, outputMode = 'plain', calls = 0;
let proposalTime = '08:00', holdReminder = false, heldReminder;
let heldPlan;
const contexts = [];
const days = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-${String(7 + index).padStart(2, '0')}`, label: '常规均衡餐', breakfast: '鸡蛋1个、燕麦40克', lunch: '鸡肉100克、米饭150克、蔬菜200克', dinner: '豆腐150克、蔬菜200克、米饭100克' }));
const runner = async (_root, context) => {
  calls++; contexts.push(structuredClone(context));
  if (fail) throw new Error('synthetic offline');
  if (context.kind === 'opening') return { messages: [
    { senderId: 'molly', text: '老大这周想自己做营养餐\n@柳智敏 负责搭配\n@赵一帆 负责做法', mentionIds: ['liu', 'zhou-chef'] },
    { senderId: 'liu', text: '海鲜过敏我看到了。还有没有其他过敏或忌口，平时自己做哪些餐？', mentionIds: ['user'] },
  ] };
  if (context.kind === 'reminder') {
    if (holdReminder) return await new Promise(resolve => { heldReminder = resolve; });
    return { messages: [{ senderId: 'zhou-chef', text: '准备做饭了吗？现在这个时间合适吗？', mentionIds: ['user'] }] };
  }
  if (context.kind === 'confirmation') return { messages: [{ senderId: 'molly', text: '记下了\n@柳智敏 @赵一帆 这周把老大的饭安排明白', mentionIds: ['liu', 'zhou-chef'] }] };
  if (outputMode === 'held-plan') return await new Promise(resolve => { heldPlan = resolve; });
  if (outputMode === 'plan') return { messages: [{ senderId: 'liu', text: '七天安排和采购差额已整理，请核对。', mentionIds: [] }], planDraft: { days, shopping: [{ name: '鸡蛋', required: '7个', available: '3个', toBuy: '4个' }] } };
  if (outputMode === 'propose') return { messages: [{ senderId: 'molly', text: '这个时间先作为提议，请确认准确时段。', mentionIds: [] }], reminderProposals: [{ meal: 'breakfast', time: proposalTime, startDate: days[0].date, endDate: days[6].date, evidence: context.incoming.text }] };
  if (outputMode === 'confirm') return { messages: [{ senderId: 'molly', text: '按确认的准确时间提醒。', mentionIds: [] }], reminderControls: [{ reminderId: context.group.reminders[0].id, operation: 'confirm', evidence: context.incoming.text }] };
  return { messages: [{ senderId: context.incoming?.mentionIds?.find(id => id !== 'user') || 'molly', text: '合成实际群回复', mentionIds: [] }] };
};
let store = new GroupChatStore(db, runtime.root, async () => '合成开饭组', () => clock, randomUUID, runner);
const create = overrides => store.create(owner, { requestId: randomUUID(), sourceCharacterId: 'molly', goal: '一周自己做饭的营养规划', memberIds: ['chen-nian', 'zhou-chef', 'liu', 'he-jiawei', 'yuan-xiaoman', 'xia-xia'], self: { name: '合成用户' }, ...overrides });
const drain = async groupId => { for (let i = 0; i < 25 && store.get(owner, groupId).pending; i++) await store.tick(); };
const send = (groupId, text, mentionIds = [], requestId = randomUUID()) => store.send(owner, { groupId, text, mentionIds, requestId });
try {
  const group = await create();
  assert.equal(group.chatEnabled, true); assert.equal(group.pending, true);
  // A phase-one empty group stays disabled until open/send explicitly starts it.
  const oldGroup = { ...group, chatEnabled: false, messages: [] };
  delete oldGroup.pending; delete oldGroup.error;
  db.prepare('UPDATE npc_group_chats SET data=? WHERE owner=? AND id=?').run(JSON.stringify(oldGroup), owner, group.id);
  db.prepare('DELETE FROM npc_group_jobs WHERE owner=? AND group_id=?').run(owner, group.id);
  assert.equal(store.get(owner, group.id).chatEnabled, false);
  assert.equal(store.list(owner)[0].chatEnabled, false);
  store.open(owner, group.id); store.open(owner, group.id);
  await drain(group.id);
  assert.equal(calls, 1, 'Molly opening must be generated once');
  const opened = store.get(owner, group.id);
  assert.equal(opened.messages[0].senderId, 'molly'); assert.match(opened.messages[0].text, /老大/);
  assert.deepEqual(opened.messages[0].mentionIds, ['liu', 'zhou-chef']);
  assert.equal(opened.messages[1].senderId, 'liu', 'nutrition intake belongs to Liu while Chen remains available for training');
  const facts = contexts[0].facts.facts;
  assert.ok(facts.some(fact => fact.key === 'food_allergy' && fact.value === '海鲜'));
  assert.ok(facts.some(fact => fact.key === 'weight' && fact.value === 72));
  assert.ok(!facts.some(fact => fact.value === '花生'));
  assert.ok(!JSON.stringify(contexts[0]).includes('PRIVATE_ASSISTANT_HISTORY_MUST_NOT_SHARE'));
  const requestId = randomUUID();
  send(group.id, '只问陈年今天怎样热身', ['chen-nian'], requestId);
  send(group.id, '只问陈年今天怎样热身', ['chen-nian'], requestId);
  assert.throws(() => send(group.id, '另一条消息', ['chen-nian'], requestId), /另一条群消息/);
  await drain(group.id);
  assert.equal(store.get(owner, group.id).messages.filter(message => message.requestId === requestId).length, 1);
  assert.equal(store.get(owner, group.id).messages.at(-1).senderId, 'chen-nian');
  for (const id of ['liu', 'he-jiawei', 'yuan-xiaoman', 'xia-xia', 'zhou-chef', 'molly']) { send(group.id, `请${id}接这个话题`, [id]); await drain(group.id); assert.equal(store.get(owner, group.id).messages.at(-1).senderId, id); }
  fail = true; send(group.id, '失败只留输入'); await drain(group.id);
  assert.match(store.get(owner, group.id).error, /重试/);
  send(group.id, '前面失败后继续发的消息');
  assert.equal(store.get(owner, group.id).pending, false, 'a queued turn behind failure must expose retry instead of a permanent spinner');
  assert.match(store.get(owner, group.id).error, /重试/);
  const failedCalls = calls; await store.tick(); assert.equal(calls, failedCalls, 'failed jobs must wait for explicit retry');
  fail = false; store.retry(owner, group.id); await drain(group.id); assert.equal(store.get(owner, group.id).error, '');

  outputMode = 'plan'; send(group.id, '请制定七天计划'); await drain(group.id);
  const plan = store.get(owner, group.id).plan;
  assert.equal(plan.status, 'draft'); assert.equal(plan.days.length, 7); assert.equal(plan.shopping[0].toBuy, '4个');
  const confirmId = randomUUID();
  store.confirmPlan(owner, { groupId: group.id, planId: plan.id, requestId: confirmId });
  store.confirmPlan(owner, { groupId: group.id, planId: plan.id, requestId: confirmId });
  await drain(group.id);
  assert.equal(store.get(owner, group.id).plan.status, 'confirmed');
  const event = store.get(owner, group.id).messages.find(message => message.requestId === confirmId);
  assert.equal(event.type, 'event'); assert.equal(event.text, undefined); assert.equal(event.event.kind, 'plan-confirmed');
  assert.throws(() => store.confirmPlan(other, { groupId: group.id, planId: plan.id, requestId: randomUUID() }), /不存在/);
  outputMode = 'propose'; send(group.id, '2026-10-07到2026-10-13每天08:00，但先别提醒'); await drain(group.id);
  let reminder = store.get(owner, group.id).reminders[0];
  assert.equal(reminder.status, 'proposed', 'explicit negation must prevent activation even with exact dates and time');
  send(group.id, '比如早上8点提醒'); await drain(group.id);
  assert.equal(reminder.status, 'proposed', 'illustrative time cannot enable reminders');
  outputMode = 'confirm'; send(group.id, '确认8点左右吧'); await drain(group.id);
  assert.equal(store.get(owner, group.id).reminders[0].status, 'proposed');
  assert.match(store.get(owner, group.id).error, /重试/);
  outputMode = 'plain'; store.retry(owner, group.id); await drain(group.id);
  outputMode = 'confirm'; send(group.id, '确认每天早上8点提醒'); await drain(group.id);
  reminder = store.get(owner, group.id).reminders[0];
  assert.equal(reminder.status, 'active'); assert.ok(reminder.confirmationMessageId);
  assert.equal(explicitTimeMatches('例如早上8点', '08:00'), false);
  assert.equal(explicitTimeMatches('确认8点左右', '08:00'), false);
  assert.equal(explicitTimeMatches('确认每天8点', '08:00'), false);
  assert.equal(explicitTimeMatches('确认晚上八点半', '20:30'), true);
  assert.equal(explicitTimeMatches('确认08:00', '08:00'), true);
  for (const text of ['你觉得08:00提醒可以吗？', '我不确定08:00提醒是否可以', '每天08:00但先别提醒', '暂时不提醒']) {
    assert.equal(reminderSuppressed(text), true);
    if (/可以|不确定/.test(text)) assert.equal(explicitConfirmation(text), false);
  }
  clock = Date.parse('2026-10-07T00:00:01Z');
  await store.tick();
  assert.equal(store.get(owner, group.id).messages.at(-1).senderId, 'zhou-chef');
  assert.match(store.get(owner, group.id).messages.at(-1).text, /准备做饭/);
  const afterReminder = store.get(owner, group.id).messages.length;
  await store.tick(); assert.equal(store.get(owner, group.id).messages.length, afterReminder, 'each meal occurrence sends once');
  store.controlReminder(owner, { groupId: group.id, reminderId: reminder.id, operation: 'pause', requestId: randomUUID() }); await drain(group.id);
  clock = Date.parse('2026-10-08T00:00:01Z');
  const pausedCount = store.get(owner, group.id).messages.length;
  await store.tick(); assert.equal(store.get(owner, group.id).messages.length, pausedCount);
  store.controlReminder(owner, { groupId: group.id, reminderId: reminder.id, operation: 'resume', requestId: randomUUID() }); await drain(group.id);
  store.stop(); db.close();
  db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  store = new GroupChatStore(db, runtime.root, async () => { throw new Error('Naming must not repeat'); }, () => clock, randomUUID, runner);
  clock = Date.parse('2026-10-09T00:00:01Z'); await store.tick();
  assert.equal(store.get(owner, group.id).messages.at(-1).senderId, 'zhou-chef', 'active reminders recover after restart');
  const beforeOffline = store.get(owner, group.id).messages.length;
  clock = Date.parse('2026-10-10T00:10:00Z'); await store.tick();
  assert.equal(store.get(owner, group.id).messages.length, beforeOffline, 'offline missed meals are not replayed');
  assert.equal(store.get(owner, group.id).reminders[0].lastOccurrence, '2026-10-10');
  assert.equal(reminderOccurrence({ ...reminder, lastOccurrence: undefined }, clock).due, false);
  store.controlReminder(owner, { groupId: group.id, reminderId: reminder.id, operation: 'cancel', requestId: randomUUID() }); await drain(group.id);
  clock = Date.parse('2026-10-11T00:00:00Z'); const cancelledCount = store.get(owner, group.id).messages.length;
  await store.tick(); assert.equal(store.get(owner, group.id).messages.length, cancelledCount);
  assert.throws(() => store.controlReminder(owner, { groupId: group.id, reminderId: reminder.id, operation: 'resume', requestId: randomUUID() }), /重新创建/);
  proposalTime = '08:01'; outputMode = 'propose';
  send(group.id, '2026-10-07到2026-10-13每天08:01，先别提醒'); await drain(group.id);
  const pendingReminder = store.get(owner, group.id).reminders.at(-1);
  store.controlReminder(owner, { groupId: group.id, reminderId: pendingReminder.id, operation: 'confirm', requestId: randomUUID() }); await drain(group.id);
  holdReminder = true; clock = Date.parse('2026-10-11T00:01:01Z');
  const pendingDelivery = store.tick();
  assert.equal(typeof heldReminder, 'function'); assert.equal(store.get(owner, group.id).pending, true);
  store.controlReminder(owner, { groupId: group.id, reminderId: pendingReminder.id, operation: 'pause', requestId: randomUUID() });
  heldReminder({ messages: [{ senderId: 'zhou-chef', text: 'STALE_REMINDER_MUST_NOT_SEND', mentionIds: [] }] });
  await pendingDelivery;
  assert.ok(!store.get(owner, group.id).messages.some(message => message.text === 'STALE_REMINDER_MUST_NOT_SEND'));
  holdReminder = false; await drain(group.id);
  store.remember(owner, { sourceCharacterId: 'zhou-chef', messageId: 'legacy-local-non-uuid', text: '我对牛奶过敏，我体重80kg', at: null });
  send(group.id, '请查看已知过敏', ['chen-nian']); outputMode = 'plain'; await drain(group.id);
  assert.ok(contexts.at(-1).facts.facts.some(fact => fact.key === 'food_allergy' && fact.value === '牛奶' && fact.evidence.chronology === 'undated'));
  assert.ok(!contexts.at(-1).facts.facts.some(fact => fact.key === 'weight' && fact.value === 80));
  assert.equal(db.prepare('SELECT data FROM chen_sessions WHERE id=?').get(`${owner}:chen-nian`).data, JSON.stringify(original), 'private history and relationship values remain untouched');

  store.stop(); db.close(); db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  let finishDelayed;
  store = new GroupChatStore(db, runtime.root, async () => 'Unused', () => clock, randomUUID,
    async () => await new Promise(resolve => { finishDelayed = resolve; }));
  const interruptedId = randomUUID(); send(group.id, '关闭中的用户消息', ['molly'], interruptedId);
  const running = store.run(owner, group.id);
  assert.equal(typeof finishDelayed, 'function');
  store.stop(); db.close();
  finishDelayed({ messages: [{ senderId: 'molly', text: 'LATE_REPLY_AFTER_CLOSED_DB', mentionIds: [] }] });
  await running;
  db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  store = new GroupChatStore(db, runtime.root, async () => 'Unused', () => clock, randomUUID, runner);
  outputMode = 'plain'; await drain(group.id);
  assert.equal(store.get(owner, group.id).messages.filter(message => message.requestId === interruptedId).length, 1);
  assert.ok(!store.get(owner, group.id).messages.some(message => message.text === 'LATE_REPLY_AFTER_CLOSED_DB'));

  const context = { group: store.get(owner, group.id), kind: 'message', incoming: { senderId: 'user', type: 'text', id: 'direct', at: new Date(clock).toISOString(), text: '请陈年回答', mentionIds: ['chen-nian'] }, facts: contexts.at(-1).facts, now: clock };
  assert.throws(() => parseGroupDialogue({ messages: [{ senderId: 'zhou-chef', text: '不应抢答', mentionIds: [] }] }, context, ['chen-nian', 'molly']), /人物/);
  const handed = parseGroupDialogue({ messages: [{ senderId: 'chen-nian', text: '@赵一帆 接一下做法', mentionIds: ['zhou-chef'] }, { senderId: 'zhou-chef', text: '合成做法说明', mentionIds: [] }] }, context, ['chen-nian', 'molly']);
  assert.equal(handed.messages.length, 2);
  const nutritionDraft = { days, shopping: [{ name: '鸡蛋', required: '7个', available: '3个', toBuy: '4个' }] };
  const chenPlan = { messages: [{ senderId: 'chen-nian', text: '合成营养计划', mentionIds: [] }], planDraft: nutritionDraft };
  assert.throws(() => parseGroupDialogue(chenPlan, context, ['chen-nian', 'molly']), /营养计划必须由柳智敏提交/, 'Chen cannot submit a new nutrition plan');
  const liuPlan = { messages: [{ senderId: 'liu', text: '合成营养计划', mentionIds: [] }], planDraft: nutritionDraft };
  const liuContext = {...context, incoming: {...context.incoming, mentionIds: ['liu']}};
  assert.deepEqual(parseGroupDialogue(liuPlan, liuContext, ['liu', 'molly']), liuPlan, 'an authorized, current Liu member can submit the valid seven-day plan');
  assert.throws(() => parseGroupDialogue(liuPlan, context, ['chen-nian', 'molly']), /人物/, 'Liu cannot answer a Chen-only @ without a real handoff');
  const withoutLiu = { ...context, group: { ...context.group, members: context.group.members.filter(member => member.id !== 'liu') } };
  assert.throws(() => parseGroupDialogue(liuPlan, withoutLiu, ['liu', 'molly']), /人物/, 'an absent Liu cannot be fabricated into a legacy group');
  assert.throws(() => parseGroupDialogue(chenPlan, withoutLiu, ['chen-nian', 'molly']), /营养计划必须由柳智敏提交/, 'Liu absence does not transfer nutrition-plan authority to Chen');

  // A valid Liu plan can become stale after generation starts. Keep an
  // unrelated accepted Chen reply, so dropping the plan requires the Liu
  // ownership guard rather than only the generic all-messages-obsolete path.
  const changedMembersGroup = await create({ memberIds: ['liu', 'chen-nian', 'zhou-chef'] });
  await drain(changedMembersGroup.id);
  outputMode = 'held-plan';
  send(changedMembersGroup.id, '请柳智敏安排早餐，陈年看训练');
  const pendingPlan = store.run(owner, changedMembersGroup.id);
  assert.equal(typeof heldPlan, 'function');
  store.members(owner, { groupId: changedMembersGroup.id, addIds: [], removeIds: ['liu'], requestId: randomUUID() });
  heldPlan({ messages: [
    { senderId: 'liu', text: 'STALE_NUTRITION_PLAN_MUST_NOT_SEND', mentionIds: [] },
    { senderId: 'chen-nian', text: 'ACCEPTED_TRAINING_REPLY_AFTER_LIU_LEAVES', mentionIds: [] },
  ], planDraft: nutritionDraft });
  await pendingPlan;
  const afterMemberChange = store.get(owner, changedMembersGroup.id);
  assert.equal(afterMemberChange.plan, undefined, 'removing Liu during generation must discard her nutrition plan even when a Chen reply is accepted');
  assert.ok(!afterMemberChange.messages.some(message => message.text === 'STALE_NUTRITION_PLAN_MUST_NOT_SEND'));
  assert.ok(afterMemberChange.messages.some(message => message.text === 'ACCEPTED_TRAINING_REPLY_AFTER_LIU_LEAVES'));
  outputMode = 'plain';
  const rawPrompts = [];
  const generated = await generateGroupDialogue(runtime.root, context, async (_root, prompt) => {
    rawPrompts.push(prompt);
    if (prompt.startsWith('你是智域群聊发言路由器')) return groupParticipationFixture(['chen-nian']);
    if (prompt.startsWith('你是智域群聊成品复核器')) return { verdict: 'keep', edits: [] };
    return { messages: [{ senderId: 'chen-nian', text: '有来源的合成群回复', mentionIds: [] }] };
  });
  assert.equal(generated.messages[0].senderId, 'chen-nian');
  assert.match(rawPrompts[1], /人物chen-nian当前Skill/); assert.match(rawPrompts[1], /群层覆盖私聊/);
  assert.match(rawPrompts[1], /人物he-jiawei当前Skill/, 'all potential handoff recipients need their current Skill');
  assert.equal(rawPrompts.length, 3, 'direct @ receives current semantic routing and exactly one independent text review');
  assert.match(rawPrompts[2], /人物he-jiawei当前Skill/, 'the review needs all of the same potential handoff rules');
  assert.ok(rawPrompts[0].includes('real-user-source')); assert.ok(!rawPrompts[0].includes('PRIVATE_ASSISTANT_HISTORY_MUST_NOT_SHARE'));
  console.log('PASS group opening once, persistent/idempotent messages, scoped facts, all member voices, direct @ and real handoff, failure/retry, Liu-owned nutrition plans and stale-member rejection, explicit task events, exact-time reminder confirmation, pause/resume/cancel, restart recovery and no overdue replay; isolated synthetic fixtures only.');
} finally { store.stop(); db.close(); runtime.cleanup(); }
