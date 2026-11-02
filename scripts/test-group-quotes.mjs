import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Real store/API validation, disposable SQLite, synthetic identities, no model or production service.
const runtime = isolatedNpcRuntime();
const {GroupChatStore} = await runtime.load('server/npc/groups-plugin');
const db = new DatabaseSync(join(runtime.root, 'group-quote-fixture.sqlite'));
const contexts = [];
const store = new GroupChatStore(db, runtime.root, async () => '合成引用测试群', () => Date.parse('2026-10-08T05:00:00Z'), randomUUID,
  async (_root, context) => { contexts.push(context); return {messages: [{senderId: 'molly', text: context.kind === 'opening' ? '老大，这是合成开场。' : '合成回应。', mentionIds: []}]}; });
const owner = randomUUID(), other = randomUUID();
const create = async (who = owner) => store.create(who, {requestId: randomUUID(), sourceCharacterId: 'molly', goal: '合成群引用验收', memberIds: ['molly', 'zhou-chef', 'chen-nian'], self: {name: '虚构测试用户'}});
const payload = (groupId, text = '这是合成用户原文。', extra = {}) => ({groupId, text, mentionIds: ['chen-nian'], requestId: randomUUID(), ...extra});
try {
  const group = await create(); await store.run(owner, group.id);
  const original = store.get(owner, group.id).messages[0];
  const quotedRequest = payload(group.id, '我只想引用这一句，请保留原文。', {replyTo: original.id});
  const sent = store.send(owner, quotedRequest);
  const message = sent.messages.at(-1);
  assert.equal(message.text, quotedRequest.text, 'quoting must not prefix or rewrite user text');
  assert.deepEqual(message.mentionIds, ['chen-nian']);
  assert.equal(message.replyTo, original.id);
  assert.deepEqual(message.quote, {id: original.id, senderId: original.senderId, senderName: original.senderName, type: original.type, text: original.text});
  const repeated = store.send(owner, quotedRequest);
  assert.equal(repeated.messages.filter(item => item.requestId === quotedRequest.requestId).length, 1);
  await store.run(owner, group.id);
  assert.deepEqual(contexts.at(-1).incoming.quote, message.quote, 'group generation must receive the persisted quote');
  assert.equal(contexts.at(-1).incoming.text, quotedRequest.text);

  const otherMessage = store.send(owner, payload(group.id, '另一条合成消息。')).messages.at(-1);
  assert.throws(() => store.send(owner, {...quotedRequest, replyTo: otherMessage.id}), /发送编号已用于另一条/);
  assert.throws(() => store.send(owner, payload(group.id, '伪造快照', {replyTo: original.id, quote: {text: '伪造来源'}})), /不支持的字段/);
  assert.throws(() => store.send(owner, payload(group.id, '错误引用', {replyTo: 1})), /无效引用/);
  assert.throws(() => store.send(owner, payload(group.id, '错误引用', {replyTo: ''})), /无效引用/);

  const second = await create(); await store.run(owner, second.id);
  assert.throws(() => store.send(owner, payload(second.id, '不能跨群引用', {replyTo: original.id})), /引用的消息已不可用/);
  const foreign = await create(other); await store.run(other, foreign.id);
  const foreignSource = store.get(other, foreign.id).messages[0];
  assert.throws(() => store.send(owner, payload(group.id, '不能跨账号引用', {replyTo: foreignSource.id})), /引用的消息已不可用/);
  assert.throws(() => store.send(other, payload(group.id, '不能访问其他账号群', {replyTo: original.id})), /群聊不存在/);

  const legacyRequest = payload(second.id, '无引用历史请求');
  store.send(owner, legacyRequest);
  const job = db.prepare('SELECT data FROM npc_group_jobs WHERE owner=? AND group_id=? AND request_id=?').get(owner, second.id, legacyRequest.requestId);
  const legacyHash = createHash('sha256').update(JSON.stringify({text: legacyRequest.text, mentions: legacyRequest.mentionIds})).digest('hex');
  assert.equal(JSON.parse(job.data).inputHash, legacyHash, 'requests without replyTo must retain old idempotency hashes');

  const cleared = store.clear(owner, {groupId: group.id, requestId: randomUUID()});
  assert.deepEqual(cleared.messages, []);
  assert.deepEqual(store.send(owner, quotedRequest).messages, [], 'retry after clear must return visible history only');
  assert.throws(() => store.send(owner, payload(group.id, '不能引用已清空内容', {replyTo: original.id})), /引用的消息已不可用/);
  const fresh = store.send(owner, payload(group.id, '清空后的新消息'));
  assert.equal(fresh.messages.length, 1);
  assert.equal(fresh.messages[0].quote, undefined);
  assert.ok(!JSON.stringify(fresh.messages).includes(original.text));

  console.log('PASS: persisted quote/source identity, raw text and real mention IDs, generator context, idempotent retry/conflict, old hash compatibility, forged/cross-group/cross-account rejection, clear and retry privacy');
} finally {
  store.stop(); db.close(); runtime.cleanup();
}
