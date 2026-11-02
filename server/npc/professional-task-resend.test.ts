import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChef, chefTaskDelegationEvidence, createChef, parseChef, type ChefState } from '../../lib/npc/zhou-chef';
import type { ProfessionalTask } from '../../lib/npc/professional-task';

// Every record here is synthetic. Never load a real account or call a model/API.
const NOW = Date.parse('2026-10-10T07:15:00Z');
const NEW = '重新发一份新的给我';
const RESEND = '把这份再发给我';
const output = (task: unknown, text = '好，按这份步骤来。') => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [], task });
const proposal = (sourceMessageId: string, evidence: string, extra: Record<string, unknown> = {}) => ({
  decision: 'create', basis: 'explicit_request', confidence: .95, scope: 'current_user', polarity: 'affirmed', readiness: 'ready',
  sourceMessageId, evidence, title: '地三鲜', goalKey: '地三鲜', steps: [
    { title: '食材准备', instructions: ['清洗食材并沥干。'], notes: ['食材表面不要留明水。'], completionCondition: '食材处理妥当。' },
    { title: '土豆熟化', instructions: ['按本份方案熟化土豆并观察。'], notes: ['检查中心熟透。'], completionCondition: '土豆中心熟透。', durationSeconds: 300 },
  ], ...extra,
});
function user(state: ChefState, id: string, text: string, at: number, replyTo?: string) {
  const turnId = 'turn-' + id;
  state.messages.push({ id, turnId, role: 'user', origin: 'chat', at: new Date(at).toISOString(), part: { type: 'text', text }, ...(replyTo ? { replyTo } : {}) });
  state.queue.push(turnId);
}
function fixture(status: ProfessionalTask['status'] = 'cancelled', oldAt = NOW - 180_000) {
  const state = createChef();
  const text = '我现在要开始做地三鲜了';
  user(state, 'initial', text, oldAt);
  applyChef(state, parseChef(output(proposal('initial', text, { basis: 'execution_commitment' })), text), 'answer-initial', oldAt + 1000);
  state.completed.push(...state.queue); state.queue = [];
  const old = state.professionalTasks[0];
  old.status = status; old.updatedAt = new Date(oldAt + 2000).toISOString();
  old.steps[0].completedAt = new Date(oldAt + 1500).toISOString();
  old.steps[0].hints.push({ id: 'old-hint', eventId: 'old-event', stepId: old.steps[0].id, text: '旧提示', at: new Date(oldAt + 1600).toISOString(), messageIds: ['old-hint-message'] });
  old.steps[1].timer = { status: 'paused', remainingMs: 123_000, updatedAt: new Date(oldAt + 2000).toISOString() };
  if (status === 'completed') old.steps[1].completedAt = new Date(oldAt + 1800).toISOString();
  return { state, old, card: state.messages.find(message => message.id === old.cardMessageId)! };
}
function request(state: ChefState, replyTo: string | undefined, text = NEW, id = 'request') { user(state, id, text, NOW - 1000, replyTo); return id; }
function apply(state: ChefState, raw: unknown, text = NEW, now = NOW) { return applyChef(state, parseChef(output(raw), text), 'answer-request', now); }
function rejects(state: ChefState, raw: unknown, label: string, text = NEW) {
  const before = structuredClone(state);
  assert.throws(() => apply(state, raw, text), label);
  assert.deepEqual(state, before, label + ': rejected proposal must not mutate state');
}

void test('截图原句引用已取消任务：创建全新任务，保留旧历史且不继承勾选、提示与计时', () => {
  const { state, old } = fixture();
  const before = structuredClone(old);
  request(state, old.cardMessageId);
  const evidence = chefTaskDelegationEvidence(state, NOW);
  assert.deepEqual(evidence.sources[0].taskReference, { taskId: old.id, cardMessageId: old.cardMessageId, goalKey: '地三鲜' });
  const users = structuredClone(state.messages.filter(message => message.role === 'user'));
  const result = apply(state, proposal('request', NEW, { newInstance: true }));
  assert.equal(result?.created, true);
  assert.equal(state.professionalTasks.length, 2);
  assert.deepEqual(old, before);
  const fresh = state.professionalTasks[1];
  assert.notEqual(fresh.id, old.id); assert.notEqual(fresh.cardMessageId, old.cardMessageId);
  assert.equal(fresh.status, 'active'); assert.equal(fresh.sourceMessageId, 'request');
  assert.ok(fresh.steps.every(step => !old.steps.some(previous => previous.id === step.id) && !step.completedAt && !step.timer && !step.hints.length));
  assert.equal(state.messages.filter(message => message.part.type === 'professional_task').length, 2);
  assert.deepEqual(state.messages.filter(message => message.role === 'user'), users);
  assert.deepEqual(state.memories, []);
  assert.deepEqual(state.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
});

void test('明确新份由服务端归一，模型省略或错误false也不能静默复用旧任务', () => {
  for (const extra of [{}, { newInstance: false }]) {
    const { state, old } = fixture('active');
    const before = structuredClone(old);
    request(state, old.cardMessageId);
    assert.equal(apply(state, proposal('request', NEW, extra))?.created, true);
    assert.equal(state.professionalTasks.length, 2);
    assert.deepEqual(old, before);
  }
});

void test('完成、暂停的旧任务可供当前明确新份定位目标，但绝不复活旧任务', () => {
  for (const status of ['completed', 'paused'] as const) {
    const { state, old } = fixture(status);
    const before = structuredClone(old);
    request(state, old.cardMessageId);
    assert.equal(apply(state, proposal('request', NEW))?.created, true);
    assert.deepEqual(old, before);
  }
});

void test('引用跨日旧任务的当前新委托成立，不依赖旧用户执行承诺的30分钟窗口', () => {
  const { state, old } = fixture('cancelled', NOW - 3 * 86_400_000);
  request(state, old.cardMessageId);
  assert.deepEqual(chefTaskDelegationEvidence(state, NOW).contextSources, []);
  assert.equal(apply(state, proposal('request', NEW))?.created, true);
});

void test('简单重发只增加同任务聊天卡，各种任务状态、步骤与运行计时保持不变', () => {
  for (const status of ['active', 'paused', 'completed', 'cancelled'] as const) {
    const { state, old } = fixture(status);
    const beforeSteps = structuredClone(old.steps);
    request(state, old.cardMessageId, RESEND);
    const result = apply(state, proposal('request', RESEND), RESEND);
    assert.equal(result?.created, false); assert.equal(result?.resent, true);
    assert.equal(state.professionalTasks.length, 1);
    assert.equal(old.status, status); assert.deepEqual(old.steps, beforeSteps);
    const cards = state.messages.filter(message => message.part.type === 'professional_task');
    assert.equal(cards.length, 2);
    assert.ok(cards.every(message => message.part.type === 'professional_task' && message.part.taskId === old.id));
    assert.notEqual(cards[0].id, cards[1].id);
    assert.ok(old.cardMessageIds?.includes(cards[1].id));
  }
});

void test('新重显的卡仍能再次被引用定位，且新份不修改原任务', () => {
  const { state, old } = fixture();
  request(state, old.cardMessageId, RESEND);
  apply(state, proposal('request', RESEND), RESEND);
  state.queue = [];
  const secondCard = state.messages.filter(message => message.part.type === 'professional_task').at(-1)!;
  user(state, 'second-request', NEW, NOW + 1000, secondCard.id);
  assert.equal(chefTaskDelegationEvidence(state, NOW + 2000).sources[0].taskReference?.cardMessageId, secondCard.id);
  assert.equal(apply(state, proposal('second-request', NEW), NEW, NOW + 2000)?.created, true);
  assert.equal(state.professionalTasks.length, 2);
  assert.equal(old.status, 'cancelled');
});

void test('普通重发不能由模型newInstance=true升级为新一次执行', () => {
  const { state, old } = fixture();
  request(state, old.cardMessageId, RESEND);
  rejects(state, proposal('request', RESEND, { newInstance: true }), 'plain resend must not create', RESEND);
});

void test('附带提及其他新事物不把普通重发升级为新执行', () => {
  const { state, old } = fixture();
  const text = '重新发给我，今天新的手机到货了';
  request(state, old.cardMessageId, text);
  const result = apply(state, proposal('request', text), text);
  assert.equal(result?.created, false); assert.equal(result?.resent, true);
  assert.equal(state.professionalTasks.length, 1);
  assert.equal(old.status, 'cancelled');
});

void test('create携带另一任务ID或update伪装当前重发都不能写入', () => {
  for (const extra of [{ taskId: 'another-task' }, { decision: 'update', basis: 'existing_task_change' }]) {
    const { state, old } = fixture();
    request(state, old.cardMessageId);
    rejects(state, proposal('request', NEW, { taskId: old.id, ...extra }), JSON.stringify(extra));
  }
});

void test('没有实际引用时，即使同账号存在唯一任务也不能猜目标新建', () => {
  const { state } = fixture();
  request(state, undefined);
  assert.equal(chefTaskDelegationEvidence(state, NOW).sources[0].taskReference, undefined);
  rejects(state, proposal('request', NEW), 'no quote');
});

void test('新委托不接受accepted_plan或existing_task_change伪装引用来源', () => {
  for (const basis of ['accepted_plan', 'existing_task_change']) {
    const { state, old } = fixture();
    request(state, old.cardMessageId);
    rejects(state, proposal('request', NEW, { basis, planMessageId: old.cardMessageId }), basis);
  }
});

void test('服务端任务引用只认真实关联卡：隐藏、未送达、导入、未知时间、人物不符、关联不符均拒', () => {
  for (const kind of ['hidden', 'future', 'future-at', 'invalid-at', 'legacy', 'unknown', 'other-character', 'missing-task', 'wrong-card-id', 'user-card', 'fake-text'] as const) {
    const { state, old, card } = fixture();
    if (kind === 'hidden') state.privateHistoryHiddenIds = [card.id];
    if (kind === 'future') card.deliverAt = NOW + 1000;
    if (kind === 'future-at') card.at = new Date(NOW + 1000).toISOString();
    if (kind === 'invalid-at') card.at = 'unknown';
    if (kind === 'legacy') card.turnId = 'legacy:' + card.id;
    if (kind === 'unknown') card.chronologyUnknown = true;
    if (kind === 'other-character') (old as unknown as { characterId: string }).characterId = 'chen-nian';
    if (kind === 'missing-task') state.professionalTasks = [];
    if (kind === 'wrong-card-id') old.cardMessageId = 'unrelated-card';
    if (kind === 'user-card') card.role = 'user';
    if (kind === 'fake-text') card.part = { type: 'text', text: '[任务] 地三鲜' };
    request(state, card.id);
    assert.equal(chefTaskDelegationEvidence(state, NOW).sources[0].taskReference, undefined, kind);
    rejects(state, proposal('request', NEW), kind);
  }
});

void test('持久卡无origin的兼容记录仍可引用，未知来源时间和legacy标记保持独立门槛', () => {
  const { state, old, card } = fixture();
  delete card.origin;
  request(state, old.cardMessageId);
  assert.equal(chefTaskDelegationEvidence(state, NOW).sources[0].taskReference?.taskId, old.id);
  assert.equal(apply(state, proposal('request', NEW))?.created, true);
});

void test('伪造的同taskId卡未登记为task.cardMessageId/cardMessageIds，不可借此获得引用白名单', () => {
  const { state, old, card } = fixture();
  const fake = { ...structuredClone(card), id: 'invented-card', turnId: 'invented-answer' };
  state.messages.push(fake);
  request(state, fake.id);
  assert.equal(chefTaskDelegationEvidence(state, NOW).sources[0].taskReference, undefined);
  rejects(state, proposal('request', NEW), 'unregistered card');
  assert.equal(old.status, 'cancelled');
});

void test('引用目标不能被模型改成另一道菜，无真实目标修改原文则拒', () => {
  const { state, old } = fixture();
  request(state, old.cardMessageId);
  rejects(state, proposal('request', NEW, { title: '红烧肉', goalKey: '红烧肉' }), 'invented goal');
});

void test('引用旧卡后当前明确委托另一目标，按本轮真实目标创建而非错误继承旧菜', () => {
  const { state, old } = fixture();
  const text = '换成番茄炒蛋，给我一份新的任务';
  request(state, old.cardMessageId, text);
  const before = structuredClone(old);
  const result = apply(state, proposal('request', text, { title: '番茄炒蛋', goalKey: '番茄炒蛋', newInstance: true }), text);
  assert.equal(result?.created, true);
  assert.equal(state.professionalTasks[1].goalKey, '番茄炒蛋');
  assert.deepEqual(old, before);
});

void test('真实用户当前消息ID和原文不可由历史source或伪evidence替代', () => {
  for (const extra of [{ sourceMessageId: 'initial' }, { evidence: '重新发一份新的地三鲜任务给我' }, { contextMessageId: 'invented-context' }]) {
    const { state, old } = fixture();
    request(state, old.cardMessageId);
    rejects(state, proposal('request', NEW, extra), JSON.stringify(extra));
  }
});

void test('真实task引用仍不让否定、知识问题、假设、转述及未来愿望变成委托', () => {
  for (const text of ['不要重新发一份新的给我', '重新发一份新的是什么意思？', '如果重新发一份新的给我会怎样？', '我朋友说重新发一份新的给我', '“重新发一份新的给我”这句话怎么翻译？', '以后再重新发一份新的给我', '先只给我文字，不要任务']) {
    const { state, old } = fixture();
    request(state, old.cardMessageId, text);
    rejects(state, proposal('request', text), text, text);
  }
});

void test('队列后续撤回或改目标优先，不能借第一条引用的新份委托继续建旧菜任务', () => {
  for (const later of ['不要任务', '先不做了', '取消', '改做番茄炒蛋']) {
    const { state, old } = fixture();
    request(state, old.cardMessageId);
    user(state, 'later', later, NOW - 500);
    rejects(state, proposal('request', NEW), later);
  }
});

void test('低confidence、他人scope与否定polarity不能靠真实引用绕过协议', () => {
  for (const extra of [{ confidence: .89 }, { scope: 'other_user' }, { polarity: 'negated' }]) {
    const { state, old } = fixture();
    request(state, old.cardMessageId);
    rejects(state, proposal('request', NEW, extra), JSON.stringify(extra));
  }
});

void test('模型输出运行字段无法复制旧步骤ID、完成状态、计时或hint进新任务', () => {
  const { state, old } = fixture();
  request(state, old.cardMessageId);
  const injectedSteps = old.steps.map(step => ({ ...structuredClone(step) }));
  const before = structuredClone(old);
  apply(state, proposal('request', NEW, { steps: injectedSteps }));
  assert.deepEqual(old, before);
  const fresh = state.professionalTasks[1];
  assert.ok(fresh.steps.every(step => !old.steps.some(previous => previous.id === step.id) && !step.completedAt && !step.timer && !step.hints.length));
});

void test('模型task=none不能以口头回复绕过明确引用卡的重发请求', () => {
  for (const text of [NEW, RESEND]) {
    const { state, old } = fixture();
    request(state, old.cardMessageId, text);
    const before = structuredClone(state);
    assert.throws(() => applyChef(state, parseChef(output({ decision: 'none' }, '好，已经给你发好了。'), text), 'answer-omitted', NOW));
    assert.deepEqual(state, before);
  }
});

void test('询问或描述上次重发的内容不构成当前重发请求，允许正常文字回复', () => {
  for (const text of ['你上次重新发给我的任务还在吗？', '你刚才重新发给我的那一份不对']) {
    const { state, old } = fixture();
    request(state, old.cardMessageId, text);
    const before = structuredClone(old);
    const result = applyChef(state, parseChef(output({ decision: 'none' }, '我先看一下你说的是哪里。'), text), 'answer-question', NOW);
    assert.equal(result, null);
    assert.deepEqual(old, before);
    assert.equal(state.messages.filter(message => message.part.type === 'professional_task').length, 1);
  }
});

void test('完成事件没有本轮用户消息，旧卡不能充当发新任务的委托', () => {
  const { state } = fixture();
  const before = structuredClone(state);
  assert.throws(() => applyChef(state, parseChef(output(proposal('initial', NEW)), NEW), 'event-answer', NOW, []));
  assert.deepEqual(state, before);
});
