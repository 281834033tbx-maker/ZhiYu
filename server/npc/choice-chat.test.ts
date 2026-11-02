import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer, Plugin } from 'vite';
import type { ChatMessage } from '../../lib/npc/contracts';
import { choicePlainText } from '../../lib/npc/choice-chat';
import { createState, parseOutput } from '../../lib/npc/engine';
import { createYuan, parseYuan } from '../../lib/npc/yuan-xiaoman';
import { createLiu, parseLiu } from '../../lib/npc/liu';
import { createChen, parseChen } from '../../lib/npc/chen-nian';
import { createHe, parseHe } from '../../lib/npc/he-jiawei';
import { createChef, parseChef } from '../../lib/npc/zhou-chef';
import { createMolly, parseMolly, applyMolly } from '../../lib/npc/molly';
import { professionalTaskDelegationEvidence } from '../../lib/npc/professional-task-chat';
import { applyVoiceEdits, generate, mollyTextOnly, plainChatTypography, voiceReplyForVoiceInput } from './codex';
import { prepareChoiceReply, ChoiceReplyError } from './choice-reply';
import { replyContext } from './reply-context';
import { parseGroupDialogue, type GroupDialogueContext } from './group-dialogue';
import { npcLocal } from './plugin';
import { yuanLocal } from './yuan-plugin';
import { liuLocal } from './liu-plugin';
import { chenLocal } from './chen-plugin';
import { heLocal } from './he-plugin';
import { chefLocal } from './zhou-chef-plugin';
import { mollyLocal } from './molly-plugin';
import { buildPrompt } from './prompt';
import { yuanPrompt } from './yuan-prompt';
import { liuPrompt } from './liu-prompt';
import { chenPrompt } from './chen-prompt';
import { hePrompt } from './he-prompt';
import { chefPrompt } from './zhou-chef-prompt';
import { mollyPrompt } from './molly-prompt';

const question = {type: 'choice' as const, text: '想练成哪种？', options: ['肌肉更饱满', '线条更清晰', '先保持习惯']};
const raw = (messages: unknown[]) => ({action: 'reply', messages, event: null, memories: []});
const now = Date.now();
function promptMessage(part: ChatMessage['part'] = structuredClone(question)): ChatMessage {
  return {id: randomUUID(), turnId: randomUUID(), role: 'assistant', at: new Date(now - 1000).toISOString(), part};
}

void test('六个普通角色解析选择气泡、混合消息及旧文字，模型不能预选或偷塞操作', () => {
  const parsers = [parseOutput, parseYuan, parseLiu, parseChen, parseHe, parseChef];
  const messages = [{type: 'text', text: '行，挑一个'}, question, {type: 'emoji', text: '👌'}];
  for (const parse of parsers) {
    assert.deepEqual(parse(raw(messages), '我想练胸').parts, messages);
    assert.deepEqual(parse(raw([{type: 'text', text: '旧消息'}]), '你好').parts, [{type: 'text', text: '旧消息'}]);
    for (const invalid of [
      {...question, options: ['一个']}, {...question, options: Array(7).fill('选项')},
      {...question, options: ['重复', ' 重复 ']}, {...question, options: [' ', '正常']},
      {...question, options: ['长'.repeat(81), '正常']}, {...question, text: '长'.repeat(161)},
      {...question, selection: {index: 1}}, {...question, selected: 1}, {...question, action: 'task_create'},
    ]) assert.throws(() => parse(raw([invalid]), '你好'), /选择消息格式无效/);
  }
  assert.equal(choicePlainText(question), '想练成哪种？\n1. 肌肉更饱满\n2. 线条更清晰\n3. 先保持习惯');
});

void test('Molly旧字符串、选择消息和联系人流程兼容，成品复核保护选项及问题类型', () => {
  const value = {intent: 'clarify', messages: ['想找哪种？', question], address: null, query: null};
  const parsed = parseMolly(value, '帮我找人');
  const state = createMolly(); applyMolly(state, parsed, randomUUID());
  assert.equal(state.messages[0].part.type, 'text');
  assert.deepEqual(state.messages[1].part, question);
  const edited = applyVoiceEdits(value, {verdict: 'revise', edits: [{index: 1, text: '挑个目标？'}]}) as typeof value;
  assert.deepEqual(edited.messages[1], {...question, text: '挑个目标？'});
  assert.deepEqual((mollyTextOnly(edited) as typeof value).messages, edited.messages);
  assert.deepEqual(plainChatTypography(raw([question])), raw([question]));
  assert.deepEqual(voiceReplyForVoiceInput('你在智域扮演陈年\n【本轮输入】[语音转写]你好', raw([question])), raw([question]));
  assert.throws(() => applyVoiceEdits(raw([question]), {verdict: 'revise', edits: [], remove: [0]}), /只能精简/);
  assert.throws(() => parseMolly({...value, messages: [{...question, selection: {index: 1}}]}, '找人'), /选择消息格式无效/);
  assert.throws(() => mollyTextOnly({...value, messages: [{...question, selection: {index: 1}}]}), /选择消息格式无效/);
});

void test('选择只能来自当前账号已送达可见NPC问题；保存后同turn幂等，其他再次点击拒绝', () => {
  const target = promptMessage(), state = {messages: [target], completed: [] as string[]};
  const input = {action: 'send', turnId: randomUUID(), choice: {messageId: target.id, index: 1}} as Record<string, unknown>;
  const prepared = prepareChoiceReply(state, input, now)!;
  assert.equal(input.text, question.options[1]); assert.equal(input.replyTo, target.id);
  assert.equal(target.part.type === 'choice' && target.part.selection, undefined, 'validation alone does not mutate persistence');
  state.messages.push({id: randomUUID(), turnId: input.turnId as string, role: 'user', at: new Date(now).toISOString(), part: {type: 'text', text: input.text as string}, replyTo: target.id});
  state.completed.push(input.turnId as string); prepared.commit();
  assert.deepEqual(target.part.type === 'choice' && target.part.selection, {index: 1, turnId: input.turnId, at: new Date(now).toISOString()});
  const reloaded = JSON.parse(JSON.stringify(state));
  assert.equal(prepareChoiceReply(reloaded, structuredClone(input), now)!.duplicate, true);
  assert.throws(() => prepareChoiceReply(state, {...input, turnId: randomUUID()}, now), error => error instanceof ChoiceReplyError && error.status === 409);
  assert.throws(() => prepareChoiceReply(state, {...input, text: '恶意附加事实'}, now), /文字与选项不一致/);
  for (const other of [
    {messages: [], completed: []},
    {messages: [{...promptMessage(), id: target.id, deliverAt: now + 10_000}], completed: []},
    {messages: [{...promptMessage(), id: target.id, role: 'user' as const}], completed: []},
    {messages: [target], completed: [], privateHistoryHiddenIds: [target.id]},
  ]) assert.throws(() => prepareChoiceReply(other, {...input, turnId: randomUUID(), text: undefined}, now), /已送达对话/);
  assert.throws(() => prepareChoiceReply({messages: [promptMessage()], completed: []}, {...input, choice: {messageId: target.id, index: -1}}, now), /不存在/);
});

void test('点击保留问题原文供续聊，单纯目标选择不升级为接受执行计划或任务', () => {
  const state = createChen(), target = promptMessage();
  state.messages.push(target);
  const turnId = randomUUID();
  state.messages.push({id: randomUUID(), turnId, role: 'user', at: new Date(now).toISOString(), part: {type: 'text', text: question.options[1]}, replyTo: target.id});
  state.queue.push(turnId);
  const evidence = professionalTaskDelegationEvidence(state, now);
  assert.deepEqual(evidence.plans, []); assert.deepEqual(state.professionalTasks, []);
  const context = replyContext(state.messages);
  assert.ok(context.includes(target.id)); assert.ok(context.includes('线条更清晰')); assert.ok(context.includes('想练成哪种？'));
});

void test('群仍使用独立原有文字协议，choice不静默降级成文本', () => {
  const context = {kind: 'message', group: {members: [{id: 'molly'}]}} as GroupDialogueContext;
  assert.throws(() => parseGroupDialogue({messages: [{senderId: 'molly', ...question}]}, context, ['molly']), /群聊当前不支持选择/);
});

void test('七个私聊人物实际generate链路采用同一选择协议；choice-only也接受复核且最终不丢失', async () => {
  const root = mkdtempSync(join(tmpdir(), 'choice-generation-'));
  cpSync(join(process.cwd(), 'npc-skills'), join(root, 'npc-skills'), {recursive: true});
  const incoming = '帮我挑个合适的目标';
  const roles = [
    {id: 'xia-xia', prompt: () => buildPrompt(root, createState('normal'), incoming), parse: parseOutput},
    {id: 'yuan-xiaoman', prompt: () => yuanPrompt(root, createYuan(), incoming), parse: parseYuan},
    {id: 'liu', prompt: () => liuPrompt(root, createLiu(), incoming), parse: parseLiu},
    {id: 'chen-nian', prompt: () => chenPrompt(root, createChen(), incoming), parse: parseChen},
    {id: 'he-jiawei', prompt: () => hePrompt(root, createHe(), incoming), parse: parseHe},
    {id: 'zhou-chef', prompt: () => chefPrompt(root, createChef(), incoming), parse: parseChef},
  ];
  const chefPlan = {taskMode: 'not_cooking', knownFacts: [], conditions: [], answerMode: 'not_cooking', routeBasis: '非烹饪目标选择', qualityBasis: '只按用户实际说明', kitchenVerified: false};
  try {
    for (const role of roles) {
      let generation = 0, review = 0;
      const result = await generate(root, role.prompt(), {requestId: randomUUID(), runRaw: async (_root, prompt) => {
        if (prompt.startsWith('你是NPC聊天案例检索器')) return {ids: [], fitnessEntryIds: [], recipeIds: [], westernDessertRecipeIds: [], chefPlan};
        if (prompt.startsWith('你是NPC私聊成品编辑')) {
          review++; assert.match(prompt, /当前可点击选择聊天协议/); assert.ok(prompt.includes(JSON.stringify(question)));
          return {verdict: 'keep', edits: [], chefCheck: {verdict: 'pass', issues: []}};
        }
        generation++; assert.match(prompt, /当前可点击选择聊天协议/); return raw([question]);
      }});
      assert.deepEqual(role.parse(result, incoming).parts, [question], `${role.id} preserves the choice`);
      assert.equal(generation, 1); assert.equal(review, 1, `${role.id} cannot skip review of choice-only content`);
    }
    let review = 0;
    const result = await generate(root, mollyPrompt(root, createMolly(), '找个有趣的人'), {protocol: 'molly', requestId: randomUUID(), runRaw: async (_root, prompt) => {
      if (prompt.startsWith('你是NPC聊天案例检索器')) return {ids: []};
      if (prompt.startsWith('你是人物知识范围判定器')) return {decision: 'not_knowledge', basis: '找人'};
      if (prompt.startsWith('你是Molly专属成品复核器')) {
        review++; assert.match(prompt, /当前可点击选择聊天协议/); assert.ok(prompt.includes(JSON.stringify(question)));
        return {verdict: 'keep', edits: []};
      }
      assert.match(prompt, /当前可点击选择聊天协议/);
      return {intent: 'clarify', messages: [question], query: null, address: null};
    }});
    assert.deepEqual(parseMolly(result, '找个有趣的人').messages, [question]); assert.equal(review, 1);
  } finally {rmSync(root, {recursive: true, force: true});}
});

// No production API, database or model: each real middleware receives its own synthetic SQLite store.
const unavailableDeps = {available: () => false, generate: async () => {throw new Error('test must never invoke a model');}};
const plugins: {id: string; table: string; suffix: string; create: () => {messages: ChatMessage[]}; plugin: () => Plugin}[] = [
  {id: 'xia-xia', table: 'sessions', suffix: ':xia-xia:normal', create: () => createState('normal'), plugin: () => npcLocal(unavailableDeps)},
  {id: 'yuan-xiaoman', table: 'yuan_sessions', suffix: ':yuan-xiaoman', create: createYuan, plugin: () => yuanLocal(unavailableDeps)},
  {id: 'liu', table: 'liu_sessions', suffix: ':liu', create: createLiu, plugin: () => liuLocal(unavailableDeps)},
  {id: 'chen-nian', table: 'chen_sessions', suffix: ':chen-nian', create: createChen, plugin: () => chenLocal(unavailableDeps)},
  {id: 'he-jiawei', table: 'he_sessions', suffix: ':he-jiawei', create: createHe, plugin: () => heLocal(unavailableDeps)},
  {id: 'zhou-chef', table: 'zhou_chef_sessions', suffix: ':zhou-chef', create: createChef, plugin: () => chefLocal(unavailableDeps)},
  {id: 'molly', table: 'molly_sessions', suffix: ':molly-system-secretary', create: createMolly, plugin: () => mollyLocal(unavailableDeps)},
];
for (const config of plugins) void test(`${config.id}真实middleware选择持久、单次入队、刷新/账号隔离和非法选择不改状态`, async () => {
  const root = mkdtempSync(join(tmpdir(), `choice-${config.id}-`));
  const server = new EventEmitter();
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const hook = config.plugin().configureServer as (server: ViteDevServer) => void;
  hook({config: {root}, httpServer: server, middlewares: {use: (_path: string, fn: typeof handler) => {handler = fn;}}} as unknown as ViteDevServer);
  const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'));
  const user = randomUUID(), target = promptMessage(), state = config.create();
  state.messages.push(target);
  const key = user + config.suffix;
  const seed = (owner: string, value: unknown) => config.table === 'sessions'
    ? db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(owner + config.suffix, 0, JSON.stringify(value))
    : db.prepare(`INSERT OR REPLACE INTO ${config.table} VALUES(?,?)`).run(owner + config.suffix, JSON.stringify(value));
  seed(user, state);
  const read = () => JSON.parse((db.prepare(`SELECT data FROM ${config.table} WHERE id=?`).get(key) as {data: string}).data);
  const request = (body?: unknown, owner = user) => new Promise<{status: number; data: {messages: ChatMessage[]}}>(resolve => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage;
    req.method = body === undefined ? 'GET' : 'POST'; req.url = '?mode=normal';
    req.headers = {host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', cookie: `zhiyu_npc=${owner}`};
    const res = {statusCode: 200, writableEnded: false, setHeader: () => {}, end(value: string) {this.writableEnded = true; resolve({status: this.statusCode, data: JSON.parse(value)});}};
    handler(req, res as unknown as ServerResponse);
  });
  try {
    const input = {action: 'send', turnId: randomUUID(), choice: {messageId: target.id, index: 0}};
    assert.equal((await request({...input, choice: {...input.choice, index: 50}})).status, 400);
    assert.equal((await request({...input, text: '另一个文本'})).status, 400);
    assert.equal((await request(input, randomUUID())).status, 400, 'another account cannot select this question');
    const accepted = await request(input); assert.equal(accepted.status, 200);
    const saved = read(), userMessage = saved.messages.at(-1);
    assert.equal(userMessage.part.text, question.options[0]); assert.equal(userMessage.replyTo, target.id);
    assert.equal(saved.messages.filter((message: ChatMessage) => message.role === 'user').length, 1);
    assert.equal((saved.queue || saved.life?.queue || []).filter((id: string) => id === input.turnId).length, 1);
    assert.deepEqual(saved.messages[0].part.selection, {index: 0, turnId: input.turnId, at: saved.messages[0].part.selection.at});
    assert.equal((await request(input)).status, 200); assert.deepEqual(read(), saved, 'same request does not mutate or enqueue again');
    assert.equal((await request({...input, turnId: randomUUID()})).status, 409); assert.deepEqual(read(), saved);
    const refreshed = await request(); assert.equal(refreshed.data.messages[0].part.type === 'choice' && refreshed.data.messages[0].part.selection?.index, 0);
    assert.deepEqual(saved.memories || [], []); assert.deepEqual(saved.professionalTasks || [], []);
    const cleared = await request({action: 'clear'}); assert.equal(cleared.status, 200);
    assert.equal((await request(input)).status, 400, 'hidden questions are unavailable, even to an old retry');
    const futureState = config.create(), future = promptMessage(); future.deliverAt = Date.now() + 60_000;
    futureState.messages.push(future); seed(user, futureState);
    assert.equal((await request({...input, choice: {messageId: future.id, index: 1}, turnId: randomUUID()})).status, 400);
  } finally {db.close(); server.emit('close'); rmSync(root, {recursive: true, force: true});}
});
