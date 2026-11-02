import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { PublicSession } from '../../lib/npc/contracts';
import { applyChef, createChef, importChefHistory, parseChef, type ChefMessage } from '../../lib/npc/zhou-chef';
import { currentExpressionPreferences } from '../../lib/npc/expression-preferences';
import { chefPrompt, chefApplicationEvidence } from './zhou-chef-prompt';
import { chefLocal } from './zhou-chef-plugin';
import { generate, collectChefUserEvidence, ChefConditionError } from './codex';
import { loadDialogueSkill } from './dialogue-skill';
import { TaskMemoryStore } from './group-task-memory';

const output = (text = '说说怎么回事。') => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const waitUntil = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await tick(); }
  assert.fail(message);
};

void test('赵一帆独立零值开局，短消息按顺序保留，未开放能力和关系变更明确失败', () => {
  const a = createChef(), b = createChef();
  assert.notEqual(a.branch, b.branch);
  assert.equal(a.characterId, 'zhou-chef');
  assert.deepEqual(a.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
  assert.deepEqual(a.messages, []); assert.deepEqual(a.memories, []);
  const messages = [{ type: 'text', text: '？' }, { type: 'text', text: '...' }, { type: 'emoji', text: '🙂' }, { type: 'text', text: '一句完整的话' }];
  assert.deepEqual(parseChef({ ...output(), messages }, '你好').parts, messages);
  assert.throws(() => parseChef({ ...output(), messages: [{ type: 'generate_photo', prompt: '自拍' }] }, '你好'), /只支持文字/);
  assert.throws(() => parseChef({ ...output(), messages: [{ type: 'voice', text: '你好' }] }, '你好'), /只支持文字/);
  assert.throws(() => parseChef({ ...output(), messages: Array(31).fill(messages[0]) }, '你好'), /消息数量无效/);
  assert.throws(() => parseChef(output('啊'.repeat(24_001)), '你好'), /超出传输上限/);
  assert.throws(() => parseChef({ ...output(), event: { kind: 'ordinary', basis: 'user_claim', evidence: '你好', reason: '问候', deltas: { attraction: 100 } } }, '你好'), /未开放/);
  assert.throws(() => parseChef({ ...output(), event: { kind: 'ordinary', basis: 'user_claim', evidence: '你好', reason: '问候', relationship: 'crisis', deltas: {} } }, '你好'), /未开放/);
});

void test('记忆与具体措辞偏好有本分支用户证据，关系沿用共用规则且不自动恋爱', () => {
  const state = createChef();
  const text = '我不喜欢“然后呢”';
  state.queue.push('turn');
  state.messages.push({ id: 'user-source', turnId: 'turn', role: 'user', at: new Date().toISOString(), part: { type: 'text', text } });
  applyChef(state, parseChef({ ...output(), messages: [{ type: 'text', text: '好', replyTo: 'foreign' }], memories: [
    { text: '不喜欢“然后呢”', kind: 'user_claim', evidence: text, preference: { category: 'wording', target: '然后呢', action: 'avoid' } },
    { text: '用户是设计师', kind: 'user_claim', evidence: '我是设计师' },
  ], event: { kind: 'ordinary', basis: 'user_claim', evidence: text, reason: '表达具体措辞偏好', deltas: { familiarity: 99, affection: 1 } } }, text), 'reply');
  assert.equal(state.messages.at(-1)?.replyTo, undefined);
  assert.equal(state.memories.length, 1);
  assert.equal(currentExpressionPreferences(state.memories, state.messages)[0].preference.target, '然后呢');
  assert.equal(state.values.familiarity, 2); assert.equal(state.values.affection, 1);
  assert.equal(state.relationship, 'strangers');
  applyChef(state, parseChef({ ...output(), event: { kind: 'ordinary', basis: 'hypothesis', evidence: text, reason: '猜测', deltas: { trust: 8 } } }, text), 'guess');
  assert.equal(state.values.trust, 0);
});

void test('旧留言导入保留ID/原文/时间/附件，不重放、不加分、不混入待回答输入', () => {
  const state = createChef(), initial = structuredClone(state.values);
  const original = { id: 'local-message', text: '', time: '09:22', image: 'data:image/png;base64,private-data' };
  assert.equal(importChefHistory(state, [original], 1_000_000), 1);
  assert.equal(importChefHistory(state, [original], 1_000_000), 0);
  assert.equal(state.messages[0].id, original.id);
  assert.equal(state.messages[0].legacyTime, original.time);
  assert.equal(state.messages[0].chronologyUnknown, true);
  assert.equal(state.messages[0].legacyContent?.image, original.image);
  assert.deepEqual(state.queue, []); assert.deepEqual(state.memories, []); assert.deepEqual(state.values, initial);
  const prompt = chefPrompt(process.cwd(), state, '新消息', 1_000_000);
  assert.match(prompt, /本轮待回答的连续消息；只有实际队列，不含导入旧留言】\[\]/);
  assert.match(prompt, /archivedAttachmentKinds/);
  assert.doesNotMatch(prompt, /private-data/);
  assert.doesNotMatch(prompt, /旧周明川|App厨师AI后端.*仍未/);
  assert.doesNotMatch(prompt, /刚把文件合上|撑不起事/);
});

type Session = PublicSession & { messages: ChefMessage[] };
async function fixture(root: string, runner: typeof generate, now: () => number) {
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), { recursive: true });
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const server = new EventEmitter();
  const plugin = chefLocal({ available: () => true, generate: runner, now });
  const hook = plugin.configureServer as (server: ViteDevServer) => void;
  hook({ config: { root }, httpServer: server, middlewares: { use: (path: string, fn: typeof handler) => {
    assert.equal(path, '/api/npc/zhou-chef'); handler = fn;
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
    assert.equal(options?.characterId, 'zhou-chef'); assert.ok(options?.requestId);
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
    for (const changed of [
      { image: 'data:image/png;base64,changed' }, { audio: 'changed-audio' },
      { audioDurationSeconds: 12 }, { file: 'changed-file.pdf' }, { replyTo: 'changed-target' },
      { time: '09:31' }, { at: '2026-10-02T13:43:00.000Z' },
    ]) assert.equal((await api.post(owner, { action: 'import_history', messages: [{ ...legacy, ...changed }] })).status, 409);
    const conflictingId = { ...legacy, id: 'batch-conflict' };
    assert.equal((await api.post(owner, { action: 'import_history', messages: [conflictingId, { ...conflictingId, image: 'changed' }] })).status, 409);
    assert.equal((await api.get(owner)).messages.length, 1, 'conflicting batches must not partially import');
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
    assert.equal((await api.post(owner, { ...body, text: '重复ID冲突' })).status, 409);
    assert.equal((await api.post(owner, { ...body, turnId: crypto.randomUUID(), replyTo: 'foreign' })).status, 400);
    assert.equal((await api.post(owner, { ...body, turnId: crypto.randomUUID(), imageId: crypto.randomUUID() + '.png' })).status, 400);
    assert.equal((await api.post(owner, { ...body, turnId: crypto.randomUUID(), file: '菜谱.pdf' })).status, 400);
    fail = true;
    await api.post(owner, { action: 'send', text: '失败重试测试', turnId: crypto.randomUUID() });
    await waitUntil(() => calls === 2, 'failed call not attempted'); await tick();
    const failed = await api.get(owner);
    assert.equal(failed.pending, false); assert.match(failed.deliveryError || '', /赵一帆/);
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

void test('厨师条件证据只提升有本会话原话支持的用户自述，假设和失效来源保持候选', () => {
  const state = createChef();
  state.messages.push({ id: 'fact-source', turnId: 'source', role: 'user', at: new Date().toISOString(), part: { type: 'text', text: '我不吃葱，家里有500克冻五花肉' } });
  state.memories.push(
    { id: 'fact', text: '用户不吃葱', kind: 'user_claim', evidence: '我不吃葱', messageId: 'fact-source', status: 'model_proposed' },
    { id: 'guess', text: '用户可能喜欢甜口', kind: 'hypothesis', evidence: '我不吃葱', messageId: 'fact-source', status: 'model_proposed' },
    { id: 'forged', text: '用户有烤箱', kind: 'user_claim', evidence: '有烤箱', messageId: 'fact-source', status: 'model_proposed' },
    { id: 'foreign', text: '用户买了鱼', kind: 'user_claim', evidence: '买了鱼', messageId: 'foreign-source', status: 'model_proposed' },
  );
  const evidence = chefApplicationEvidence(state);
  assert.equal(evidence.userMemories?.length, 1);
  assert.deepEqual(collectChefUserEvidence('', evidence), [{ source: 'verified_user_memory', messageId: 'fact-source', text: '我不吃葱' }]);
  const prompt = chefPrompt(process.cwd(), state, '想做红烧肉');
  assert.match(prompt, /无法|不能|未接入/);
  assert.match(prompt, /用户点击式步骤倒计时/);
  assert.match(prompt, /NPC到点主动消息及系统通知仍未接入本接口/);
  assert.match(prompt, /不能自行启动、暂停或修改运行计时/);
  assert.match(prompt, /步骤完成后的下一步提示/);
  assert.doesNotMatch(prompt, /archivedAttachmentKinds.*private-data/);
});

void test('真实接口使用完整generate检索/条件校验/生成/复核流水线和两套实际来源库，不调用真实模型', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chef-real-pipeline-test-'));
  let clock = Date.now();
  const inputs: Record<string, string> = {};
  const incoming = '我有500克冻五花肉，想做肉燥饭，再配个法式土豆泥。';
  const plan = {
    taskMode: 'step_guidance',
    knownFacts: [{ name: '食材状态', value: '500克冻五花肉', evidence: '500克冻五花肉' }],
    conditions: [{ name: '食材状态', state: 'known', handling: 'reuse', reason: '先解冻再执行切肉与加热' }],
    answerMode: 'direct', routeBasis: '已知冻肉，先给解冻操作', qualityBasis: '有来源的处理方法，未厨房验证', kitchenVerified: false,
  };
  const expected = output('好的，冻肉先完全解冻，再切块。');
  const runner: typeof generate = async (runRoot, prompt, options) => {
    assert.equal(runRoot, root); assert.equal(options?.characterId, 'zhou-chef');
    assert.deepEqual(options?.chefEvidence, { userMemories: [] });
    assert.match(prompt, /【本轮输入，仅为用户消息】/);
    return generate(runRoot, prompt, { ...options, runRaw: async (_root, input, images) => {
      assert.deepEqual(images || [], []);
      if (input.startsWith('你是NPC聊天案例检索器')) {
        inputs.retrieval = input;
        return { ids: [], recipeIds: ['aqj-7304633134027476259'], westernDessertRecipeIds: ['gt-6923172381867412743'], chefPlan: plan };
      }
      if (input.startsWith('你在智域扮演独立虚构成年人物赵一帆')) { inputs.generation = input; return expected; }
      if (input.startsWith('你是NPC私聊成品编辑')) {
        inputs.review = input;
        return { verdict: 'keep', edits: [], remove: [], chefCheck: { verdict: 'pass', issues: [] } };
      }
      throw Error('Unexpected offline stage');
    } });
  };
  const owner = crypto.randomUUID(), api = await fixture(root, runner, () => clock);
  try {
    await api.post(owner, { action: 'send', text: incoming, turnId: crypto.randomUUID() });
    await waitUntil(() => Boolean(inputs.review), 'chef pipeline did not review');
    await tick(); clock += 60_000;
    const exposed = await api.get(owner);
    assert.equal(exposed.deliveryError, '');
    assert.equal(exposed.messages.filter(message => message.role === 'assistant').length, 1);
    assert.ok(inputs.retrieval.includes('主厨广坦'));
    assert.ok(inputs.retrieval.includes('安秋金'));
    for (const stage of ['generation', 'review']) {
      assert.ok(inputs[stage].includes('aqj-7304633134027476259'));
      assert.ok(inputs[stage].includes('gt-6923172381867412743'));
      assert.ok(inputs[stage].includes('500克冻五花肉'));
    }
    const trace = readdirSync(join(root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(root, '.npc-runtime/skill-traces', file), 'utf8')))
      .find(value => value.characterId === 'zhou-chef');
    assert.equal(trace.status, 'complete');
    assert.equal(trace.stages.find((stage: { stage: string }) => stage.stage === 'generation').rulesHash, trace.stages.find((stage: { stage: string }) => stage.stage === 'review').rulesHash);
    assert.deepEqual(Object.keys(inputs).sort(), ['generation', 'retrieval', 'review']);
    assert.equal(trace.stages.filter((stage: { stage: string }) => ['retrieval', 'generation', 'review'].includes(stage.stage)).length, 3);
    const loaded = loadDialogueSkill(root, chefPrompt(root, createChef(), incoming), 'zhou-chef')!;
    assert.equal(loaded.metadata.dialoguePurpose, 'professional');
    assert.equal(loaded.chefRecipeLibrary?.recipes.length, 53);
    assert.equal(loaded.chefWesternDessertLibrary?.recipes.length, 18);
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});

void test('清空时取消在途草稿，保留原记录和记忆，隐藏消息不能被新引用，核对失败显示错误', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chef-clear-inflight-test-'));
  let clock = Date.now(), calls = 0;
  let release: (value: unknown) => void = () => {};
  const owner = crypto.randomUUID();
  const api = await fixture(root, async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { release = resolve; });
    throw new ChefConditionError('CHEF_REVIEW_FAILED', ['synthetic review failure']);
  }, () => clock);
  try {
    await api.post(owner, { action: 'send', text: '我想做鱼', turnId: crypto.randomUUID() });
    await waitUntil(() => calls === 1, 'request did not start');
    const old = (await api.get(owner)).messages[0];
    await api.post(owner, { action: 'clear' });
    release(output('已经清空，不该送达')); await tick(); clock += 60_000;
    assert.deepEqual((await api.get(owner)).messages, []);
    assert.equal((await api.post(owner, { action: 'send', text: '问新问题', turnId: crypto.randomUUID(), replyTo: old.id })).status, 400);
    await api.post(owner, { action: 'send', text: '新问题', turnId: crypto.randomUUID() });
    await waitUntil(() => calls === 2, 'new request did not start'); await tick();
    assert.match((await api.get(owner)).deliveryError || '', /做法核对未通过/);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`) as { data: string };
      const state = JSON.parse(row.data);
      assert.equal(state.messages.length, 2); assert.ok(state.privateHistoryHiddenIds.includes(old.id));
      assert.equal(state.messages.some((message: { role: string }) => message.role === 'assistant'), false);
    } finally { db.close(); }
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});

void test('缺少厨师必要Skill时在真实生成前失败，不使用旧角色或空知识回复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chef-skill-missing-test-'));
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), { recursive: true });
  let calls = 0;
  try {
    rmSync(join(root, 'npc-skills/skills/zhiyu-professional-dialogue/references/chef-condition-routing.md'));
    await assert.rejects(generate(root, chefPrompt(root, createChef(), '怎么煮饺子'), { characterId: 'zhou-chef', chefEvidence: { userMemories: [] }, runRaw: async () => { calls++; return output(); } }), /缺少|缺失|读取|MODULE|模块/);
    assert.equal(calls, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test('群任务记忆按账号记录真实厨师私聊原话，模型菜谱与旧无日期身体参数不提升为用户事实', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chef-shared-task-memory-test-'));
  let clock = Date.now();
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const api = await fixture(root, async () => output('我对鸡蛋过敏，身高180厘米'), () => clock);
  try {
    await api.post(owner, { action: 'import_history', messages: [{ id: 'undated-body', text: '我体重90公斤', time: '10:18', mine: true }] });
    await api.post(owner, { action: 'send', text: '我对花生过敏', turnId: crypto.randomUUID() });
    await tick(); clock += 60_000;
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
    try {
      const memory = new TaskMemoryStore(db);
      const facts = memory.collect(owner).facts;
      assert.equal(facts.length, 1); assert.equal(facts[0].key, 'food_allergy'); assert.equal(facts[0].value, '花生');
      assert.equal(facts[0].evidence.sourceCharacterId, 'zhou-chef');
      const actualUser = (await api.get(owner)).messages.find(message => message.role === 'user' && 'text' in message.part && message.part.text === '我对花生过敏')!;
      assert.equal(facts[0].evidence.messageId, actualUser.id);
      assert.deepEqual(memory.collect(other).facts, []);
      // Exact persisted chef source can recover optional sync after event loss.
      db.prepare('DELETE FROM npc_group_task_memory_events WHERE owner=?').run(owner);
      assert.equal(memory.collect(owner).facts[0].value, '花生');
      assert.equal(memory.snapshot(owner).facts.length, 1);
    } finally { db.close(); }
  } finally { await api.close(); rmSync(root, { recursive: true, force: true }); }
});
