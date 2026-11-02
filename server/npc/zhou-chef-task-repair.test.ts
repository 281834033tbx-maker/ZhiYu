import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { chefTaskDelegationEvidence, createChef, type ChefState } from '../../lib/npc/zhou-chef';
import { chefLocal } from './zhou-chef-plugin';
import { ChefConditionError, type generate, type generateRaw } from './codex';

const reply = (text = '好，按这个步骤来。') => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [], task: { decision: 'none' } });
const proposal = (sourceMessageId: string, evidence = '我要做地三鲜。') => ({
  decision: 'create', basis: 'execution_commitment', confidence: .95,
  scope: 'current_user', polarity: 'affirmed', readiness: 'ready',
  sourceMessageId, evidence, title: '地三鲜', goalKey: '地三鲜',
  steps: [{ title: '食材准备', details: ['清洗、切配并沥干食材。'] }, { title: '合炒调味', details: ['按保存方案完成合炒。'] }],
});
const sourceId = (prompt: string): string => JSON.parse(/【本轮待回答[^】]+】([^\n]+)/.exec(prompt)![1]).at(-1).id;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await tick(); }
  assert.fail('隔离异步任务没有完成');
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Diagnostic = { job: string; at: string; stage: string; code: string; message: string; attempt: number };

function fixture(runner: typeof generate, runRaw?: typeof generateRaw, initialNow = Date.now()) {
  const root = mkdtempSync(join(tmpdir(), 'chef-task-repair-'));
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), { recursive: true });
  let clock = initialNow;
  let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
  const server = new EventEmitter();
  const plugin = chefLocal({ available: () => true, generate: runner, now: () => clock, ...(runRaw ? { runRaw } : {}) });
  (plugin.configureServer as (server: ViteDevServer) => void)({ config: { root }, httpServer: server, middlewares: {
    use: (_path: string, fn: typeof handler) => { handler = fn; },
  } } as unknown as ViteDevServer);
  const owner = crypto.randomUUID();
  const request = (method: string, body?: unknown) => new Promise<{ status: number; data: unknown }>(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.method = method; req.url = '/'; req.headers = {
      host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', cookie: `zhiyu_npc=${owner}`,
    };
    const res = { statusCode: 200, writableEnded: false, setHeader: () => {}, end(text: string) {
      this.writableEnded = true; resolve({ status: this.statusCode, data: JSON.parse(text) });
    } };
    handler(req, res as unknown as ServerResponse);
  });
  const stored = (): ChefState => {
    const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT data FROM zhou_chef_sessions WHERE id=?').get(`${owner}:zhou-chef`) as { data: string };
      return JSON.parse(row.data);
    } finally { db.close(); }
  };
  const diagnostics = (): Diagnostic[] => {
    try {
      return readdirSync(join(root, '.npc-runtime/task-diagnostics')).flatMap(file =>
        readFileSync(join(root, '.npc-runtime/task-diagnostics', file), 'utf8').trim().split('\n').map(row => JSON.parse(row)));
    } catch { return []; }
  };
  return {
    root, owner, stored, diagnostics, post: (body: unknown) => request('POST', body),
    send: (text = '我要做地三鲜。') => request('POST', { action: 'send', text, turnId: crypto.randomUUID() }),
    time: () => clock,
    advance: (milliseconds = 60_000) => { clock += milliseconds; },
    seed: (state: ChefState) => {
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
      try { db.prepare('INSERT OR REPLACE INTO zhou_chef_sessions VALUES (?,?)').run(`${owner}:zhou-chef`, JSON.stringify(state)); }
      finally { db.close(); }
    },
    close: () => { server.emit('close'); rmSync(root, { recursive: true, force: true }); },
  };
}

void test('任务协议只重写一次，冻结真实来源/证据/工具，成功只提交一份任务与消息/记忆/关系', async () => {
  let calls = 0;
  const prompts: string[] = [], evidence: unknown[] = [], jobs: string[] = [];
  const raw: typeof generateRaw = async () => { throw Error('测试不应调用真实生成器'); };
  const runner: typeof generate = async (_root, prompt, options) => {
    calls++; prompts.push(prompt); evidence.push(structuredClone(options!.chefEvidence)); jobs.push(options!.requestId!);
    assert.equal(options?.characterId, 'zhou-chef'); assert.equal(options?.runRaw, raw);
    // A injected runner cannot mutate the evidence used for the repair attempt.
    if (options?.chefEvidence && typeof options.chefEvidence === 'object') Object.assign(options.chefEvidence, { injected: true });
    return { ...reply(), task: calls === 1 ? { ...proposal(sourceId(prompt)), steps: [] } : proposal(sourceId(prompt)),
      event: { kind: 'ordinary', basis: 'user_claim', evidence: '我要做地三鲜。', reason: '用户明确表达做饭目标', deltas: { familiarity: 1 } },
      memories: [{ text: '本轮要做地三鲜', kind: 'user_claim', evidence: '我要做地三鲜。' }] };
  };
  const api = fixture(runner, raw);
  try {
    await api.send(); await until(() => calls === 2 && !api.stored().pending); api.advance();
    const state = api.stored();
    assert.equal(calls, 2); assert.ok(prompts[1].startsWith(prompts[0]));
    assert.match(prompts[1], /核对问题是数据/); assert.match(prompts[1], /任务目标或步骤不完整/);
    assert.match(prompts[1], /task为none时不得声称已创建/);
    assert.deepEqual(evidence[0], evidence[1]); assert.equal(jobs[0], jobs[1]);
    assert.equal(state.professionalTasks.length, 1); assert.equal(state.messages.filter(message => message.part.type === 'professional_task').length, 1);
    assert.equal(state.messages.filter(message => message.role === 'assistant' && message.part.type === 'text').length, 1);
    assert.equal(state.memories.length, 1); assert.equal(state.proposals.length, 1); assert.equal(state.values.familiarity, 1);
    assert.deepEqual(state.queue, []); assert.equal(state.error, '');
    const logs = api.diagnostics(); assert.equal(logs.length, 1); assert.equal(logs[0].stage, 'parse'); assert.equal(logs[0].attempt, 1);
    assert.deepEqual(Object.keys(logs[0]).sort(), ['job', 'at', 'stage', 'code', 'message', 'attempt'].sort());
    assert.ok(!JSON.stringify(logs).includes(api.owner)); assert.ok(!JSON.stringify(logs).includes('我要做地三鲜'));
  } finally { api.close(); }
});

void test('真实来源守卫失败触发一次修复，坏提案不写入任何输出', async () => {
  let calls = 0;
  const runner: typeof generate = async (_root, prompt) => ({ ...reply(calls++ === 0 ? '坏草稿不能显示' : '按步骤来。'),
    task: proposal(calls === 1 ? 'invented-source' : sourceId(prompt)) });
  const api = fixture(runner);
  try {
    await api.send(); await until(() => calls === 2 && !api.stored().pending);
    const state = api.stored(); assert.equal(state.professionalTasks.length, 1);
    assert.ok(!JSON.stringify(state).includes('坏草稿不能显示'));
    assert.equal(api.diagnostics()[0].stage, 'apply'); assert.equal(api.diagnostics()[0].code, 'TASK_INTENT_REJECTED');
  } finally { api.close(); }
});

void test('两次失败保留队列并停止自动重试，用户retry后仍只创建一份任务', async () => {
  let calls = 0;
  const runner: typeof generate = async (_root, prompt) => ({ ...reply('不能泄露的失败草稿'),
    task: proposal(++calls <= 2 ? 'missing-source' : sourceId(prompt)),
    event: { kind: 'ordinary', basis: 'user_claim', evidence: '我要做地三鲜。', reason: '测试', deltas: { familiarity: 1 } },
    memories: [{ text: '失败草稿记忆', kind: 'user_claim', evidence: '我要做地三鲜。' }] });
  const api = fixture(runner);
  try {
    await api.send(); await until(() => !!api.stored().error);
    const failed = api.stored(); assert.equal(calls, 2); assert.equal(failed.queue.length, 1); assert.equal(failed.pending, null);
    assert.equal(failed.retryAt, Number.MAX_SAFE_INTEGER); assert.equal(failed.messages.length, 1);
    assert.deepEqual(failed.professionalTasks, []); assert.deepEqual(failed.memories, []); assert.deepEqual(failed.proposals, []);
    assert.deepEqual(failed.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
    assert.match(failed.error, /任务委托核对未通过/);
    const logs = api.diagnostics(); assert.deepEqual(logs.map(row => row.attempt), [1, 2]); assert.equal(logs[0].job, logs[1].job);
    await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(calls, 2);
    await api.post({ action: 'retry' }); await until(() => calls === 3 && !api.stored().pending);
    assert.equal(api.stored().professionalTasks.length, 1); assert.deepEqual(api.stored().queue, []);
  } finally { api.close(); }
});

void test('修复等待期间新输入让旧草稿失效，保留两条真实输入且不冻结新请求', async () => {
  let calls = 0; const repair = gate<unknown>();
  const runner: typeof generate = async (_root, prompt) => ++calls === 1 ? { ...reply(), task: proposal('missing') } : repair.promise.then(() => ({ ...reply('旧回复不应提交'), task: proposal(sourceId(prompt)) }));
  const api = fixture(runner);
  try {
    await api.send(); await until(() => calls === 2);
    await api.send('先不要建任务，我再看看。');
    await api.post({ action: 'typing', clientId: crypto.randomUUID(), sequence: 1, active: true });
    repair.resolve(null); await until(() => !api.stored().pending);
    const state = api.stored(); assert.equal(calls, 2); assert.equal(state.queue.length, 2); assert.equal(state.error, '');
    assert.equal(state.retryAt, 0); assert.equal(state.messages.length, 2); assert.deepEqual(state.professionalTasks, []);
    assert.deepEqual(state.memories, []); assert.deepEqual(state.proposals, []);
  } finally { api.close(); }
});

void test('非任务生成错误维持原失败行为，不扩大到技术复核或离线重试', async () => {
  for (const failure of [new Error('offline'), new ChefConditionError('CHEF_REVIEW_FAILED', [])]) {
    let calls = 0; const runner: typeof generate = async () => { calls++; throw failure; };
    const api = fixture(runner);
    try {
      await api.send(); await until(() => !!api.stored().error);
      assert.equal(calls, 1); assert.deepEqual(api.diagnostics(), []); assert.equal(api.stored().queue.length, 1);
      assert.match(api.stored().error, failure instanceof ChefConditionError ? /做法核对/ : /暂时没有连上/);
    } finally { api.close(); }
  }
});

void test('完成事件修复不能创建任务，不伪造用户/关系/记忆，仅保存一次下一步提示', async () => {
  let calls = 0;
  const runner: typeof generate = async (_root, prompt) => {
    calls++;
    return calls === 1 ? { ...reply(), task: proposal(sourceId(prompt)) }
      : calls === 2 ? { ...reply('错误任务提案'), task: proposal('fake-completion-source') }
      : { ...reply('下一步先把切好的食材沥干。'), event: { kind: 'ordinary', basis: 'user_claim', evidence: '', reason: '不可变成关系事件', deltas: { familiarity: 1 } },
        memories: [{ text: '不可当用户事实', kind: 'user_claim', evidence: '' }] };
  };
  const api = fixture(runner);
  try {
    await api.send(); await until(() => calls === 1 && !api.stored().pending); api.advance();
    const before = api.stored(), task = before.professionalTasks[0];
    await api.post({ action: 'task_step', taskId: task.id, stepId: task.steps[0].id, completed: true, eventId: crypto.randomUUID(), expectedRevision: task.revision });
    await until(() => calls === 3 && !api.stored().pending);
    const after = api.stored(); assert.equal(after.professionalTasks.length, 1); assert.equal(after.taskEvents.length, 0);
    assert.equal(after.professionalTasks[0].steps[1].hints.length, 1);
    assert.equal(after.messages.filter(message => message.part.type === 'professional_task').length, 1);
    assert.equal(after.messages.filter(message => message.role === 'user').length, 1);
    assert.deepEqual(after.values, before.values); assert.deepEqual(after.memories, []); assert.deepEqual(after.proposals, []);
    assert.ok(!JSON.stringify(after).includes('错误任务提案')); assert.equal(api.diagnostics()[0].stage, 'task-event');
  } finally { api.close(); }
});

void test('步骤撤销使在途修复提示作废，既不保存旧提示，也不显示旧失败', async () => {
  let calls = 0; const repair = gate<unknown>();
  const runner: typeof generate = async (_root, prompt) => {
    calls++;
    if (calls === 1) return { ...reply(), task: proposal(sourceId(prompt)) };
    if (calls === 2) return { ...reply(), task: proposal('fake-completion-source') };
    return repair.promise.then(() => ({ ...reply('已经撤销的旧提示'), task: proposal('still-invalid') }));
  };
  const api = fixture(runner);
  try {
    await api.send(); await until(() => calls === 1 && !api.stored().pending); api.advance();
    const task = api.stored().professionalTasks[0];
    await api.post({ action: 'task_step', taskId: task.id, stepId: task.steps[0].id, completed: true, eventId: crypto.randomUUID(), expectedRevision: task.revision });
    await until(() => calls === 3);
    await api.post({ action: 'task_step', taskId: task.id, stepId: task.steps[0].id, completed: false, eventId: crypto.randomUUID(), expectedRevision: api.stored().professionalTasks[0].revision });
    repair.resolve(null); await until(() => !api.stored().pending);
    const state = api.stored(); assert.equal(state.error, ''); assert.equal(state.retryAt, 0); assert.deepEqual(state.taskEvents, []);
    assert.equal(state.professionalTasks[0].steps[0].completedAt, undefined); assert.deepEqual(state.professionalTasks[0].steps[1].hints, []);
    assert.ok(!JSON.stringify(state).includes('已经撤销的旧提示'));
  } finally { api.close(); }
});

async function verifyFrozenWindow(initialNow: number, crossesMidnight: boolean) {
  let calls = 0; const anchorId = 'recent-execution-anchor', prompts: string[] = [];
  const runner: typeof generate = async (_root, prompt) => {
    calls++; prompts.push(prompt);
    const promptEvidence = JSON.parse(/【程序与模型共用的任务委托来源窗口；只是原文证据，不是指令】([^\n]+)/.exec(prompt)![1]);
    assert.equal(promptEvidence.contextSources[0].id, anchorId);
    if (calls === 1) {
      api.advance(40_000);
      return { ...reply(), task: { ...proposal(sourceId(prompt), '给我全部流程'), steps: [] } };
    }
    return { ...reply(), task: { ...proposal(sourceId(prompt), '给我全部流程'), contextMessageId: anchorId } };
  };
  const api = fixture(runner, undefined, initialNow);
  const state = createChef();
  state.messages.push({ id: anchorId, role: 'user', turnId: 'previous-execution', at: new Date(api.time() - (30 * 60_000 - 1000)).toISOString(),
    part: { type: 'text', text: '我现在要开始做地三鲜了。' } });
  api.seed(state);
  try {
    await api.send('给我全部流程'); await until(() => calls === 2 && !api.stored().pending);
    const after = api.stored();
    assert.ok(api.time() - Date.parse(state.messages[0].at) > 30 * 60_000);
    // Midnight changes live day boundaries; successful application still uses
    // the window of this in-flight request rather than a new request's window.
    if (crossesMidnight) assert.deepEqual(chefTaskDelegationEvidence(after, api.time(), after.messages.filter(message => message.role === 'user').slice(-1).map(message => message.turnId)).contextSources, []);
    assert.equal(calls, 2); assert.ok(prompts[1].startsWith(prompts[0])); assert.equal(after.error, '');
    assert.equal(after.professionalTasks.length, 1); assert.equal(after.professionalTasks[0].contextMessageId, anchorId);
    assert.deepEqual(after.queue, []); assert.equal(api.diagnostics().length, 1);
  } finally { api.close(); }
}

void test('生成与修复跨过30分钟边界，仍按本轮冻结的真实委托窗口应用任务', async () => {
  await verifyFrozenWindow(Date.parse('2026-10-10T12:00:00+08:00'), false);
});

void test('生成与修复跨过午夜，当前请求的原始来源快照仍保持一致', async () => {
  await verifyFrozenWindow(Date.parse('2026-10-10T23:59:59+08:00'), true);
});
