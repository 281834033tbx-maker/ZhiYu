import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { PublicSession } from '../../lib/npc/contracts';
import { applyHe, createHe, importHeHistory, parseHe, type HeMessage } from '../../lib/npc/he-jiawei';
import { currentExpressionPreferences } from '../../lib/npc/expression-preferences';
import { hePrompt } from './he-prompt';
import { heLocal } from './he-plugin';
import { generate } from './codex';
import { loadDialogueSkill } from './dialogue-skill';

const output = (text = '说说怎么回事。') => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const waitUntil = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await tick(); }
  assert.fail(message);
};

void test('何嘉伟独立零值开局，短消息按顺序保留，未开放能力和关系变更明确失败', () => {
  const a = createHe(), b = createHe();
  assert.notEqual(a.branch, b.branch);
  assert.equal(a.characterId, 'he-jiawei');
  assert.deepEqual(a.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
  assert.deepEqual(a.messages, []); assert.deepEqual(a.memories, []);
  const messages = [{ type: 'text', text: '？' }, { type: 'text', text: '...' }, { type: 'emoji', text: '🙂' }, { type: 'text', text: '一句完整的话' }];
  assert.deepEqual(parseHe({ ...output(), messages }, '你好').parts, messages);
  assert.throws(() => parseHe({ ...output(), messages: [{ type: 'generate_photo', prompt: '自拍' }] }, '你好'), /只支持文字/);
  assert.throws(() => parseHe({ ...output(), messages: [{ type: 'voice', text: '你好' }] }, '你好'), /只支持文字/);
  assert.throws(() => parseHe({ ...output(), messages: Array(31).fill(messages[0]) }, '你好'), /消息数量无效/);
  assert.throws(() => parseHe(output('啊'.repeat(24_001)), '你好'), /超出传输上限/);
  assert.throws(() => parseHe({ ...output(), event: { kind: 'ordinary', basis: 'user_claim', evidence: '你好', reason: '问候', deltas: { attraction: 100 } } }, '你好'), /未开放/);
  assert.throws(() => parseHe({ ...output(), event: { kind: 'ordinary', basis: 'user_claim', evidence: '你好', reason: '问候', relationship: 'crisis', deltas: {} } }, '你好'), /未开放/);
});

void test('记忆与具体措辞偏好有本分支用户证据，关系沿用共用规则且不自动恋爱', () => {
  const state = createHe();
  const text = '我不喜欢“然后呢”';
  state.messages.push({ id: 'user-source', turnId: 'turn', role: 'user', at: new Date().toISOString(), part: { type: 'text', text } });
  applyHe(state, parseHe({ ...output(), messages: [{ type: 'text', text: '好', replyTo: 'foreign' }], memories: [
    { text: '不喜欢“然后呢”', kind: 'user_claim', evidence: text, preference: { category: 'wording', target: '然后呢', action: 'avoid' } },
    { text: '用户是设计师', kind: 'user_claim', evidence: '我是设计师' },
  ], event: { kind: 'ordinary', basis: 'user_claim', evidence: text, reason: '表达具体措辞偏好', deltas: { familiarity: 99, affection: 1 } } }, text), 'reply');
  assert.equal(state.messages.at(-1)?.replyTo, undefined);
  assert.equal(state.memories.length, 1);
  assert.equal(currentExpressionPreferences(state.memories, state.messages)[0].preference.target, '然后呢');
  assert.equal(state.values.familiarity, 2); assert.equal(state.values.affection, 1);
  assert.equal(state.relationship, 'strangers');
  applyHe(state, parseHe({ ...output(), event: { kind: 'ordinary', basis: 'hypothesis', evidence: text, reason: '猜测', deltas: { trust: 8 } } }, text), 'guess');
  assert.equal(state.values.trust, 0);
});

void test('旧留言导入保留ID/原文/时间/附件，不重放、不加分、不混入待回答输入', () => {
  const state = createHe(), initial = structuredClone(state.values);
  const original = { id: 'local-message', text: '', time: '09:22', image: 'data:image/png;base64,private-data' };
  assert.equal(importHeHistory(state, [original], 1_000_000), 1);
  assert.equal(importHeHistory(state, [original], 1_000_000), 0);
  assert.equal(state.messages[0].id, original.id);
  assert.equal(state.messages[0].legacyTime, original.time);
  assert.equal(state.messages[0].chronologyUnknown, true);
  assert.equal(state.messages[0].legacyContent?.image, original.image);
  assert.deepEqual(state.queue, []); assert.deepEqual(state.memories, []); assert.deepEqual(state.values, initial);
  const prompt = hePrompt('', state, '新消息', 1_000_000);
  assert.match(prompt, /本轮待回答的连续消息；只有实际队列，不含导入旧留言】\[\]/);
  assert.match(prompt, /archivedAttachmentKinds/);
  assert.doesNotMatch(prompt, /private-data/);
  assert.doesNotMatch(prompt, /何嘉伟.*\d+岁/);
  assert.doesNotMatch(prompt, /刚把文件合上|撑不起事/);
});

type Session = PublicSession & { messages: HeMessage[] };
async function fixture(root: string, runner: typeof generate, now: () => number) {
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const server = new EventEmitter();
  const plugin = heLocal({ available: () => true, generate: runner, now });
  const hook = plugin.configureServer as (server: ViteDevServer) => void;
  hook({ config: { root }, httpServer: server, middlewares: { use: (path: string, fn: typeof handler) => {
    assert.equal(path, '/api/npc/he-jiawei'); handler = fn;
  } } } as unknown as ViteDevServer);
  const base = 'http://127.0.0.1:3101';
  const request = (owner: string, method: string, body?: unknown, origin = base) => new Promise<{ status: number; json: () => Promise<Session> }>(resolve => {
    // Invoke the real Connect middleware with HTTP-shaped streams, without opening a socket.
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.method = method; req.url = '/';
    req.headers = { host: '127.0.0.1:3101', cookie: owner ? `zhiyu_npc=${owner}` : '', origin, 'content-type': 'application/json' };
    const res = { statusCode: 200, writableEnded: false, setHeader: () => {}, end(value: string) {
      this.writableEnded = true;
      const parsed = JSON.parse(value);
      resolve({ status: this.statusCode, json: async () => parsed });
    } };
    handler(req, res as unknown as ServerResponse);
  });
  return {
    get: (owner: string) => request(owner, 'GET').then(response => response.json()),
    rawGet: () => request('', 'GET'),
    post: (owner: string, body: unknown, origin = base) => request(owner, 'POST', body, origin),
    close: async () => { server.emit('close'); },
  };
}

void test('接口账号隔离、幂等、历史持久化、只回应新消息、失败停止自动重试并支持retry恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'he-api-test-'));
  let clock = Date.now(), calls = 0, fail = false;
  const prompts: string[] = [];
  const runner: typeof generate = async (_root, prompt, options) => {
    calls++; prompts.push(prompt);
    assert.equal(options?.characterId, 'he-jiawei'); assert.ok(options?.requestId);
    if (fail) throw Error('offline');
    return output();
  };
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  let api = await fixture(root, runner, () => clock);
  try {
    assert.equal((await api.rawGet()).status, 401);
    assert.deepEqual((await api.get(owner)).messages, []);
    assert.equal((await api.post(owner, {}, 'https://example.com')).status, 403);
    assert.equal((await api.post(owner, null)).status, 400);
    assert.equal((await api.post(owner, { action: 'send', text: '你好', turnId: 'bad' })).status, 400);
    const legacy = { id: 'local-old', text: '旧留言不应该重放', time: '21:43', at: '2026-10-01T13:43:00.000Z', mine: true };
    assert.equal((await api.post(owner, { action: 'import_history', messages: [legacy] })).status, 200);
    assert.equal((await api.post(owner, { action: 'import_history', messages: [legacy] })).status, 200);
    assert.equal(calls, 0);
    assert.equal((await api.get(owner)).messages.length, 1);
    assert.equal((await api.get(owner)).messages[0].at, legacy.at);
    assert.equal((await api.post(owner, { action: 'import_history', messages: [{ ...legacy, text: '不同原文' }] })).status, 409);
    assert.equal((await api.post(owner, { action: 'import_history', messages: [{ ...legacy, id: 'fake-assistant', mine: false }] })).status, 400);
    const body = { action: 'send', text: '我今天面试失败了', turnId: crypto.randomUUID(), replyTo: legacy.id };
    assert.equal((await api.post(owner, body)).status, 200);
    await api.post(owner, body);
    await waitUntil(() => calls === 1, 'new user input did not generate');
    await tick(); clock += 60_000;
    const answered = await api.get(owner);
    assert.equal(answered.messages.filter(message => message.role === 'user').length, 2);
    assert.equal(answered.messages.filter(message => message.role === 'assistant').length, 1);
    assert.match(prompts[0], /本轮输入，仅为用户消息】"我今天面试失败了"/);
    assert.deepEqual((await api.get(other)).messages, []);
    assert.equal((await api.post(owner, { ...body, turnId: crypto.randomUUID(), replyTo: 'foreign' })).status, 400);
    assert.equal((await api.post(owner, { ...body, turnId: crypto.randomUUID(), imageId: crypto.randomUUID() + '.png' })).status, 400);
    fail = true;
    await api.post(owner, { action: 'send', text: '失败重试测试', turnId: crypto.randomUUID() });
    await waitUntil(() => calls === 2, 'failed call not attempted'); await tick();
    const failed = await api.get(owner);
    assert.equal(failed.pending, false); assert.match(failed.deliveryError || '', /何嘉伟/);
    await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(calls, 2);
    fail = false;
    assert.equal((await api.post(owner, { action: 'retry' })).status, 200);
    await waitUntil(() => calls === 3, 'retry not attempted'); await tick(); clock += 60_000;
    assert.equal((await api.get(owner)).deliveryError, '');
    await api.close();
    api = await fixture(root, runner, () => clock);
    const persisted = await api.get(owner);
    assert.equal(persisted.messages.length, 5);
    assert.equal(persisted.messages[0].legacyTime, legacy.time);
    await tick(); assert.equal(calls, 3);
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});

void test('忙碌输入队列与并发新消息令旧草稿失效，只保存最终有序回复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'he-concurrency-test-'));
  let clock = Date.now(), calls = 0;
  const releases: ((value: unknown) => void)[] = [], prompts: string[] = [];
  const runner: typeof generate = async (_root, prompt) => {
    calls++; prompts.push(prompt);
    return new Promise(resolve => releases.push(resolve));
  };
  const owner = crypto.randomUUID(), clientId = crypto.randomUUID();
  const api = await fixture(root, runner, () => clock);
  try {
    await api.post(owner, { action: 'typing', clientId, sequence: 1, active: true });
    await api.post(owner, { action: 'send', text: '第一句话', turnId: crypto.randomUUID() });
    await tick(); assert.equal(calls, 0);
    await api.post(owner, { action: 'typing', clientId, sequence: 2, active: false });
    await waitUntil(() => calls === 1, 'typing release did not generate');
    await api.post(owner, { action: 'send', text: '还有第二句', turnId: crypto.randomUUID() });
    releases[0](output('旧草稿不应送达')); await tick();
    await api.post(owner, { action: 'retry' });
    await waitUntil(() => calls === 2, 'new input not regenerated');
    assert.match(prompts[1], /本轮输入，仅为用户消息】"第一句话\\n还有第二句"/);
    releases[1]({ ...output(), messages: [{ type: 'text', text: '第一条' }, { type: 'text', text: '第二条' }, { type: 'emoji', text: '😐' }] });
    await tick(); clock += 60_000;
    const state = await api.get(owner);
    assert.deepEqual(state.messages.filter(message => message.role === 'assistant').map(message => 'text' in message.part ? message.part.text : ''), ['第一条', '第二条', '😐']);
    assert.equal(state.messages.some(message => 'text' in message.part && message.part.text === '旧草稿不应送达'), false);
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});

void test('12MiB旧图片的dataURL导入保留超过8MiB附件，无模型重放并能继续新聊天', async () => {
  const root = mkdtempSync(join(tmpdir(), 'he-large-history-test-'));
  let clock = Date.now(), calls = 0, generatedPrompt = '';
  const owner = crypto.randomUUID();
  const api = await fixture(root, async (_root, prompt) => { calls++; generatedPrompt = prompt; return output(); }, () => clock);
  try {
    const image = 'data:image/png;base64,' + 'A'.repeat(16 * 1024 * 1024);
    const imported = await api.post(owner, { action: 'import_history', messages: [{ id: 'old-large-image', mine: true, text: '', time: '19:23', image }] });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).messages[0].legacyContent?.image, image);
    assert.equal(calls, 0);
    await api.post(owner, { action: 'send', text: '今天想跟你聊聊工作', turnId: crypto.randomUUID() });
    await waitUntil(() => calls === 1, 'large old attachment blocked new AI chat');
    await tick(); clock += 60_000;
    assert.equal((await api.get(owner)).messages.filter(message => message.role === 'assistant').length, 1);
    assert.ok(generatedPrompt.length < 30_000, 'archived dataURL must not be sent to the model');
    assert.ok(!generatedPrompt.includes(image));
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});

void test('真实generate编排加载何本人完整Skill，生成与复核共享同一快照且接入仅文字能力', async () => {
  const root = mkdtempSync(join(tmpdir(), 'he-skill-test-'));
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), { recursive: true });
  let generated = '', reviewed = '';
  try {
    const state = createHe(), prompt = hePrompt(root, state, '面试失败了');
    const loaded = loadDialogueSkill(root, prompt, 'he-jiawei')!;
    assert.equal(loaded.metadata.dialoguePurpose, 'companion');
    assert.ok(loaded.metadata.sources.some(source => source.path.endsWith('/he-jiawei-companionship.md')));
    const result = await generate(root, prompt, { characterId: 'he-jiawei', requestId: 'he-isolated-test', runRaw: async (_root, input) => {
      if (input.startsWith('你是NPC私聊成品编辑')) { reviewed = input; return { verdict: 'keep', edits: [], remove: [] }; }
      if (input.startsWith('你在智域扮演独立虚构成年人物何嘉伟')) {
        generated = input;
        appendFileSync(join(root, 'npc-skills/skills/zhiyu-character-dialogue/references/core-behavior.md'), '\nSNAPSHOT-MUTATION-SHOULD-NOT-APPEAR\n');
        return { ...output(), messages: [{ type: 'text', text: '面试没过，还不能说明你选错了路' }, { type: 'text', text: '这次哪一段最没把握？' }] };
      }
      return { ids: [] };
    } });
    assert.ok(generated, 'generation did not load rules'); assert.ok(reviewed, 'review did not run');
    assert.match(generated, /he-jiawei|何嘉伟/);
    assert.match(generated, /【何嘉伟实际语音能力】/);
    assert.match(generated, /【何嘉伟本轮实际媒体能力】/);
    assert.doesNotMatch(generated, /【全角色实际发图能力】/);
    assert.doesNotMatch(reviewed, /SNAPSHOT-MUTATION-SHOULD-NOT-APPEAR/);
    const parsed = parseHe(result, '面试失败了'); assert.equal(parsed.parts.length, 2);
    const traces = readdirSync(join(root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(root, '.npc-runtime/skill-traces', file), 'utf8')));
    const trace = traces.find(value => value.requestId === 'he-isolated-test');
    assert.equal(trace.status, 'complete');
    assert.equal(trace.characterId, 'he-jiawei');
    assert.equal(trace.stages.find((stage: { stage: string }) => stage.stage === 'generation').rulesHash, trace.stages.find((stage: { stage: string }) => stage.stage === 'review').rulesHash);
    assert.ok(trace.skill.sources.length >= 10);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test('何专属必要模块缺失时生成失败，不使用旧提示词继续回答', async () => {
  const root = mkdtempSync(join(tmpdir(), 'he-skill-missing-test-'));
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), { recursive: true });
  let calls = 0;
  try {
    rmSync(join(root, 'npc-skills/skills/zhiyu-companion-dialogue/references/he-jiawei-companionship.md'));
    await assert.rejects(generate(root, hePrompt(root, createHe(), '你好'), { characterId: 'he-jiawei', runRaw: async () => { calls++; return output(); } }), /缺少|缺失|读取|MODULE|模块/);
    assert.equal(calls, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
