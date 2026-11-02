import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { assets, type PublicSession } from '../../lib/npc/contracts';
import {
  createChen, parseChen, applyChen, updateChenShowerFollowUp,
  deliverChenShowerFollowUp, deliverChenLifeShare, setChenPositiveGrowth,
  chenSharingEligible, CHEN_SHOWER_FOLLOW_UP_MS, CHEN_SHARE_INTERVAL_MS,
  CHEN_SHARE_REQUIRED_KEYS,
} from '../../lib/npc/chen-nian';
import { matchMolly, emptyQuery } from '../../lib/npc/molly';
import { chenPrompt } from './chen-prompt';
import { chenLocal } from './chen-plugin';
import { withKnowledgeGate } from './codex';
import { loadDialogueSkill } from './dialogue-skill';

const output = (text = '行，先说你的。') => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [] });

void test('陈年开局隔离，无预填记忆、数值和其他人物关系', () => {
  const a = createChen(), b = createChen();
  assert.notEqual(a.branch, b.branch);
  assert.equal(a.characterId, 'chen-nian');
  assert.equal(a.initialRelationship, 'strangers');
  assert.equal(a.careerStage, 'A');
  assert.deepEqual(a.messages, []);
  assert.deepEqual(a.memories, []);
  assert.deepEqual(a.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
  assert.equal(assets.chenRainySelfie.url, '/npc/chen-nian/share-rainy-selfie-v2.png');
});

void test('专业回复保留多条完整消息，仍拒绝传输超限、跨角色素材和未开放数值', () => {
  assert.equal(parseChen({ ...output(), messages: Array(5).fill({ type: 'text', text: '一步完整的说明' }) }, '你好').parts.length, 5);
  assert.equal(parseChen(output('啊'.repeat(81)), '你好').parts[0].type, 'text');
  assert.throws(() => parseChen({ ...output(), messages: Array(31).fill({ type: 'text', text: '嗯' }) }, '你好'), /消息数量无效/);
  assert.throws(() => parseChen(output('啊'.repeat(24001)), '你好'), /超出传输上限/);
  assert.throws(() => parseChen({ ...output(), messages: [{ type: 'photo', assetId: 'cake' }] }, '你好'));
  assert.equal(parseChen({ ...output(), messages: [{ type: 'photo', assetId: 'chenWorkdesk' }] }, '你好').parts[0].type, 'photo');
  assert.throws(() => parseChen({ ...output(), event: { kind: 'ordinary', basis: 'user_claim', evidence: '你好', reason: '打招呼', deltas: { safety: 1 } } }, '你好'), /未开放的隐藏值/);
  assert.equal(parseChen(output('👀'), '你好').parts.length, 1);
});

void test('记忆必须有用户原文证据，引用不能跨会话', () => {
  const s = createChen();
  s.messages.push({ id: 'user-1', turnId: 'turn-1', role: 'user', at: new Date().toISOString(), part: { type: 'text', text: '我喜欢看球' } });
  const raw = { ...output(), messages: [{ type: 'text', text: '平时看哪个队？', replyTo: 'other-user' }], memories: [
    { text: '用户自述喜欢看球', kind: 'user_claim', evidence: '喜欢看球' },
    { text: '用户有钱', kind: 'user_claim', evidence: '我是富豪' },
  ] };
  applyChen(s, parseChen(raw, '我喜欢看球'), 'reply-1');
  assert.equal(s.memories.length, 1);
  assert.equal(s.memories[0].messageId, 'user-1');
  assert.equal(s.messages.at(-1)?.replyTo, undefined);
});

void test('Molly按姓名、性别与城市创业兴趣匹配陈年', () => {
  assert.deepEqual(matchMolly({ ...emptyQuery(), name: '陈年' }).map(p => p.id), ['chen-nian']);
  assert.deepEqual(matchMolly({ ...emptyQuery(), gender: '男', tags: ['深圳', '创业'] }).map(p => p.id), ['chen-nian']);
  assert.equal(matchMolly({ ...emptyQuery(), name: '陈年', excluded: ['chen-nian'] }).length, 0);
});

void test('普通人物跨职业求助直接进入共同专业问答，不走旧圈外未知出口', async () => {
  let calls = 0;
  const expected = output('可以先从处理器、内存和接口的职责理解；精确型号细节需要核对资料。');
  const result = await withKnowledgeGate('你在智域扮演独立虚构成年人物陈年，稳定人物ID：chen-nian。\n问题：芯片架构怎么理解？', async prompt => {
    calls++;
    assert.doesNotMatch(prompt, /你是人物知识范围判定器/);
    return expected;
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, expected);
});

void test('专业入口保留独立身份、真实状态及本人关系规则，不注入旧陪伴样本', () => {
  const state = createChen();
  const before = structuredClone(state);
  const prompt = chenPrompt(process.cwd(), state, '你好');
  const skill = loadDialogueSkill(process.cwd(), prompt, 'chen-nian')!;
  assert.equal(skill.metadata.dialoguePurpose, 'professional');
  assert.match(prompt, /黑龙江|深圳折返实验室/);
  assert.match(prompt, /【真实历史】\[\]/);
  assert.match(prompt, /没有看图输入/);
  assert.match(prompt, /chenWorkdesk与chenRainySelfie/);
  assert.doesNotMatch(prompt, /CN-T15|CN-U16|CN-U17|10\. 对话样本/);
  for (const preserved of [/恋爱吸引设为80/, /双方已接受时使用/, /不要说“不用跟我汇报”/, /30分钟一次性追问/, /恋爱前只发1—2条/, /确认恋爱后一次连发3—5条/, /【前期分享欲】生活照片分享门槛为/, /5\. 先搞笑再认真/, /6\. 关系分寸/])
    assert.match(skill.rules, preserved);
  assert.match(skill.rules, /只在有效历史支持相应私人关系/);
  assert.doesNotMatch(skill.rules, /没玩过游戏|厨师个人对话纠偏/);
  assert.deepEqual(state, before);
});

void test('离开三十分钟后按关系阶段只追问一轮，提前回来会取消', () => {
  const now = Date.parse('2026-09-19T20:00:00+08:00');
  const s = createChen();
  s.relationship = 'lovers';
  updateChenShowerFollowUp(s, '我叫魏好，先去洗个澡', 'turn-shower', now);
  assert.equal(s.userNickname, '魏好');
  assert.equal(s.showerFollowUp?.dueAt, now + CHEN_SHOWER_FOLLOW_UP_MS);
  assert.equal(s.showerFollowUp?.activity, '洗澡');
  assert.equal(deliverChenShowerFollowUp(s, now + CHEN_SHOWER_FOLLOW_UP_MS - 1), false);
  assert.equal(deliverChenShowerFollowUp(s, now + CHEN_SHOWER_FOLLOW_UP_MS), true);
  assert.equal(s.messages.length, 4);
  assert.equal(s.messages.every(message => message.origin === 'proactive'), true);
  assert.equal(new Set(s.messages.map(message => message.turnId)).size, 1);
  assert.deepEqual(s.messages.map(message => message.part), [
    { type: 'text', text: '魏好，还没回来啊' },
    { type: 'text', text: '魏好，你洗澡怎么要这么这么久啊' },
    { type: 'text', text: '臭宝，臭宝' },
    { type: 'text', text: '[表情包｜一只小狗趴在门口，配字：望眼欲穿]' },
  ]);
  assert.equal(deliverChenShowerFollowUp(s, now + CHEN_SHOWER_FOLLOW_UP_MS + 1), false);

  updateChenShowerFollowUp(s, '我先去洗澡了', 'turn-cancel', now);
  updateChenShowerFollowUp(s, '我洗完了年年', 'turn-return', now + 10 * 60 * 1000);
  assert.equal(s.showerFollowUp, null);
  assert.equal(deliverChenShowerFollowUp(s, now + CHEN_SHOWER_FOLLOW_UP_MS), false);

  const stranger = createChen();
  updateChenShowerFollowUp(stranger, '我去取快递了', 'turn-stranger', now);
  assert.equal(stranger.showerFollowUp?.activity, '取快递');
  assert.equal(deliverChenShowerFollowUp(stranger, now + CHEN_SHOWER_FOLLOW_UP_MS), true);
  assert.deepEqual(stranger.messages.map(message => message.part), [
    { type: 'text', text: '还没回来啊？' },
    { type: 'text', text: '[表情包｜一只塑料袋扒着门框，配字：我寻思人呢]' },
  ]);
  assert.equal(stranger.messages.some(message => 'text' in message.part && message.part.text.includes('臭宝')), false);

  const ordinary = createChen();
  updateChenShowerFollowUp(ordinary, '我喜欢吃饭，也喜欢去深圳玩', 'turn-ordinary', now);
  assert.equal(ordinary.showerFollowUp, null);
});

void test('激烈争吵允许陈年立界暂停，用户缓和后才恢复沟通', () => {
  const s = createChen();
  s.relationship = 'lovers';
  const paused = parseChen({
    action: 'end_conversation',
    messages: [{ type: 'text', text: '你要人身攻击，我不奉陪。' }],
    event: {
      kind: 'harm', basis: 'user_claim', evidence: '你真是个渣男',
      reason: '激烈争吵中出现人身攻击', deltas: {},
    },
    memories: [],
  }, '你真是个渣男');
  applyChen(s, paused, 'turn-argument');
  assert.equal(s.argumentPause?.sinceTurnId, 'turn-argument');
  assert.equal(s.showerFollowUp, null);

  updateChenShowerFollowUp(s, '我先去洗澡了', 'turn-away', Date.now());
  assert.equal(s.showerFollowUp, null);
  assert.equal(deliverChenShowerFollowUp(s, Date.now() + CHEN_SHOWER_FOLLOW_UP_MS), false);

  const calmer = parseChen(output('行，咱俩慢慢说。'), '我冷静了');
  applyChen(s, calmer, 'turn-calm');
  assert.equal(s.argumentPause, null);
});

void test('前期多数积极值提升30点后主动分享半失败生活照，自拍后置且不重复', () => {
  const now = Date.parse('2026-09-19T12:00:00+08:00');
  const s = createChen();
  assert.equal(CHEN_SHARE_REQUIRED_KEYS, 4);
  const noAffection = createChen();
  setChenPositiveGrowth(noAffection, { familiarity: 30, trust: 30, comfort: 30, understood: 30 }, now);
  assert.equal(chenSharingEligible(noAffection), false);
  setChenPositiveGrowth(s, { familiarity: 30, affection: 30, trust: 30 }, now);
  assert.equal(chenSharingEligible(s), false);
  assert.equal(deliverChenLifeShare(s, now), false);

  setChenPositiveGrowth(s, { comfort: 30 }, now);
  assert.equal(chenSharingEligible(s), true);
  assert.equal(deliverChenLifeShare(s, now), true);
  assert.deepEqual(s.messages.map(message => message.part), [
    { type: 'text', text: '搁工作室忙半天，桌子先有创业样了。' },
    { type: 'photo', assetId: 'chenWorkdesk' },
  ]);
  assert.equal(deliverChenLifeShare(s, now + 60 * 60 * 1000), false);

  assert.equal(deliverChenLifeShare(s, now + CHEN_SHARE_INTERVAL_MS), true);
  assert.deepEqual(s.messages.slice(-2).map(message => message.part), [
    { type: 'text', text: '出来整口吃的。雨挺大，给我拍得跟逃难似的。' },
    { type: 'photo', assetId: 'chenRainySelfie' },
  ]);
  assert.equal(deliverChenLifeShare(s, now + 2 * CHEN_SHARE_INTERVAL_MS), false);

  const paused = createChen();
  setChenPositiveGrowth(paused, {
    familiarity: 30, affection: 30, trust: 30, comfort: 30,
  }, now);
  paused.argumentPause = { sinceTurnId: 'argument', sinceAt: new Date(now).toISOString() };
  assert.equal(deliverChenLifeShare(paused, now), false);
});

void test('接口校验、幂等、会话隔离、错误停止重试和重新发送恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chen-test-'));
  cpSync(join(process.cwd(), 'npc-skills/references'), join(root, 'npc-skills/references'), { recursive: true });
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  let calls = 0, fail = false;
  const server = createServer((req, res) => handler(req, res));
  const plugin = chenLocal({ available: () => true, generate: async () => { calls++; if (fail) throw Error('offline'); return output(); } });
  const hook = plugin.configureServer as (s: ViteDevServer) => void;
  hook({ config: { root }, httpServer: server, middlewares: { use: (path: string, fn: typeof handler) => {
    assert.equal(path, '/api/npc/chen-nian'); handler = fn;
  } } } as unknown as ViteDevServer);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const get = (cookie: string): Promise<PublicSession> => fetch(base, { headers: { Cookie: cookie } }).then(r => r.json() as Promise<PublicSession>);
  const post = (cookie: string, body: unknown, origin = base) => fetch(base, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const initial = await fetch(base), cookie = initial.headers.get('set-cookie')!.split(';')[0];
    const initialSession = (await initial.json()) as PublicSession;
    assert.deepEqual(initialSession.messages, []);
    assert.equal(initialSession.relationship, 'strangers');
    const lovers = await fetch(base + '?relationship=lovers', { headers: { Cookie: cookie } }).then(r => r.json() as Promise<PublicSession>);
    assert.equal(lovers.relationship, 'lovers');
    const strangers = await fetch(base + '?relationship=strangers', { headers: { Cookie: cookie } }).then(r => r.json() as Promise<PublicSession>);
    assert.equal(strangers.relationship, 'strangers');
    const sharing = await fetch(base + '?scenario=early-sharing&relationship=strangers&growth=30', { headers: { Cookie: cookie } }).then(r => r.json() as Promise<PublicSession>);
    assert.equal(sharing.sharingEligible, true);
    assert.equal(sharing.positiveGrowth?.familiarity, 30);
    assert.equal((await post(cookie, {}, 'https://example.com')).status, 403);
    assert.equal((await post(cookie, null)).status, 400);
    assert.equal((await post(cookie, { action: 'send', text: '你好', turnId: 'bad' })).status, 400);
    const body = { action: 'send', text: '你好', turnId: crypto.randomUUID() };
    assert.equal((await post(cookie, body)).status, 200);
    await post(cookie, body);
    const state = await get(cookie);
    assert.equal(state.messages.filter((m: {role: string}) => m.role === 'user').length, 1);
    assert.equal(state.messages.filter((m: {role: string}) => m.role === 'assistant').length, 1);
    assert.equal(calls, 1);
    assert.deepEqual((await get('zhiyu_npc=' + crypto.randomUUID())).messages, []);
    assert.equal((await post(cookie, { ...body, turnId: crypto.randomUUID(), replyTo: 'foreign-message' })).status, 400);
    fail = true;
    await post(cookie, { ...body, turnId: crypto.randomUUID(), text: '失败测试' });
    const failed = await get(cookie);
    assert.equal(failed.pending, false);
    assert.match(failed.deliveryError || '', /陈年/);
    const before = calls;
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(calls, before);
    fail = false;
    await post(cookie, { ...body, turnId: crypto.randomUUID(), text: '重新发送' });
    assert.equal((await get(cookie)).deliveryError, '');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
