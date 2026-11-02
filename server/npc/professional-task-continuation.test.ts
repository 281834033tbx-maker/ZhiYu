import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChef, chefTaskDelegationEvidence, createChef, parseChef, type ChefState } from '../../lib/npc/zhou-chef';
import { applyProfessionalTaskOperation, mutateProfessionalTaskStep, parseProfessionalTaskOperation, type ProfessionalTaskOperation } from '../../lib/npc/professional-task';

// These fixtures replay only synthetic state and model proposals, not a user's session.
const NOW = new Date(2026, 9, 10, 12, 0, 0).getTime();
const reply = (task: unknown = { decision: 'none' }) => ({
  action: 'reply', messages: [{ type: 'text', text: '好，按这份步骤做。' }], memories: [], task,
});
const proposal = (sourceMessageId: string, evidence: string, extra: Record<string, unknown> = {}) => ({
  decision: 'create', basis: 'execution_commitment', confidence: .95, scope: 'current_user', polarity: 'affirmed', readiness: 'ready',
  sourceMessageId, evidence, title: '地三鲜', goalKey: '地三鲜', steps: [
    { title: '食材准备', details: ['洗净土豆、茄子和青椒，切块。'] },
    { title: '土豆与茄子熟化', details: ['分批熟化，检查食材软透。'] },
    { title: '合炒与调味', details: ['加入青椒和料汁，炒匀。'] },
  ], ...extra,
});
function user(state: ChefState, id: string, text: string, at = NOW - 60_000, current = false) {
  const turnId = `turn-${id}`;
  state.messages.push({ id, turnId, role: 'user', at: new Date(at).toISOString(), origin: 'chat', part: { type: 'text', text } });
  if (current) state.queue.push(turnId);
  else state.completed.push(turnId);
  return id;
}
function nextQueue(state: ChefState) {
  state.completed.push(...state.queue);
  state.queue = [];
}
function apply(state: ChefState, raw: unknown, now = NOW) {
  const { sources, plans, contextSources } = chefTaskDelegationEvidence(state, now);
  return applyProfessionalTaskOperation(state.professionalTasks, parseProfessionalTaskOperation(raw), sources, plans, now, contextSources);
}
function reject(state: ChefState, raw: unknown, label: string, now = NOW) {
  const before = structuredClone(state.professionalTasks);
  assert.throws(() => apply(state, raw, now), label);
  assert.deepEqual(state.professionalTasks, before, `${label}: rejected proposals must not mutate task state`);
}

void test('明确动手后索取全部流程：按本轮原文与近期承诺创建交互卡，来源不冒充为本轮', () => {
  const state = createChef();
  user(state, 'commitment', '我现在要开始做地三鲜了', NOW - 180_000);
  state.messages.push({ id: 'ack', turnId: 'answer-1', role: 'assistant', at: new Date(NOW - 170_000).toISOString(), part: { type: 'text', text: '好，先把土豆、茄子和青椒拿出来。' } });
  user(state, 'flow', '给我全部流程', NOW - 30_000, true);
  user(state, 'self', '我可以自己看', NOW - 20_000, true);
  const beforeUsers = structuredClone(state.messages.filter(message => message.role === 'user'));
  const raw = proposal('flow', '给我全部流程', { contextMessageId: 'commitment' });
  applyChef(state, parseChef(reply(raw), '给我全部流程\n我可以自己看'), 'answer-2', NOW);
  assert.equal(state.professionalTasks.length, 1);
  assert.equal(state.messages.filter(message => message.part.type === 'professional_task').length, 1);
  assert.equal(state.professionalTasks[0].sourceMessageId, 'flow');
  assert.equal(state.professionalTasks[0].contextMessageId, 'commitment');
  assert.ok(state.professionalTasks[0].delegationSourceMessageIds?.includes('commitment'));
  assert.ok(state.professionalTasks[0].delegationSourceMessageIds?.includes('flow'));
  assert.deepEqual(state.messages.filter(message => message.role === 'user'), beforeUsers);
  assert.deepEqual(state.memories, []);
  assert.deepEqual(state.values, { familiarity: 0, affection: 0, trust: 0, comfort: 0 });
});

void test('连续错字纠正“我要一个人物”→“任务”：用纠正消息委托且复用原任务', () => {
  const state = createChef();
  user(state, 'commitment', '我现在要开始做地三鲜了', NOW - 180_000);
  user(state, 'flow', '给我全部流程', NOW - 120_000, true);
  applyChef(state, parseChef(reply(proposal('flow', '给我全部流程', { contextMessageId: 'commitment' })), '给我全部流程'), 'answer-flow', NOW - 100_000);
  nextQueue(state);
  const task = state.professionalTasks[0];
  mutateProfessionalTaskStep(task, task.steps[0].id, true, task.revision, NOW - 80_000);
  const oldIds = task.steps.map(step => step.id);
  user(state, 'typo', '我要一个人物', NOW - 20_000, true);
  user(state, 'correction', '任务', NOW - 10_000, true);
  const result = applyChef(state, parseChef(reply(proposal('correction', '任务', { basis: 'explicit_request', contextMessageId: 'commitment' })), '我要一个人物\n任务'), 'answer-correction', NOW);
  assert.equal(result?.created, false);
  assert.equal(state.professionalTasks.length, 1);
  assert.equal(state.messages.filter(message => message.part.type === 'professional_task').length, 1);
  assert.deepEqual(task.steps.map(step => step.id), oldIds);
  assert.ok(task.steps[0].completedAt);
  assert.equal(state.messages.find(message => message.id === 'typo')?.part.type, 'text');
  assert.deepEqual(chefTaskDelegationEvidence(state, NOW).sources.map(({ id, text }) => ({ id, text })), [
    { id: 'typo', text: '我要一个人物' }, { id: 'correction', text: '任务' },
  ]);
});

void test('连续错字纠正在尚未建卡时也可创建：保留两条真实委托来源', () => {
  const state = createChef();
  user(state, 'commitment', '我现在要开始做地三鲜了', NOW - 180_000);
  user(state, 'flow', '给我全部流程', NOW - 120_000);
  user(state, 'self', '我可以自己看', NOW - 110_000);
  user(state, 'typo', '我要一个人物', NOW - 20_000, true);
  user(state, 'correction', '任务', NOW - 10_000, true);
  const result = apply(state, proposal('correction', '任务', { basis: 'explicit_request', contextMessageId: 'commitment' }));
  assert.equal(result?.created, true);
  assert.equal(result?.task.sourceMessageId, 'correction');
  assert.ok(result?.task.delegationSourceMessageIds?.includes('typo'));
  assert.ok(result?.task.delegationSourceMessageIds?.includes('correction'));
});

void test('普通咨询后同样索取流程仍是文字：近期菜名不等于执行承诺', () => {
  for (const prior of ['地三鲜怎么做？', '最近挺想吃地三鲜的', '给我介绍一下地三鲜']) {
    const state = createChef();
    user(state, 'prior', prior);
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), prior);
    reject(state, proposal('flow', '给我全部流程', { basis: 'explicit_request', contextMessageId: 'prior' }), prior + ' cannot become an explicit request');
  }
});

void test('当前明确索要任务可以承接近期用户提及的菜名，不要求重新说一遍菜名', () => {
  const state = createChef();
  user(state, 'prior', '地三鲜怎么做？');
  user(state, 'request', '给我一个任务', NOW - 10_000, true);
  const result = apply(state, proposal('request', '给我一个任务', { basis: 'explicit_request', contextMessageId: 'prior' }));
  assert.equal(result?.created, true);
  assert.equal(result?.task.sourceMessageId, 'request');
  assert.equal(result?.task.contextMessageId, 'prior');
});

void test('光有“任务”或更正标记不构成委托，不能把任意两个词合成命令', () => {
  for (const [earlier, correction] of [['地三鲜任务是什么', '任务'], ['我要一个人物', '人物和任务有什么区别'], ['我朋友说他要一个人物', '任务'], ['如果我要一个人物', '任务']] as const) {
    const state = createChef();
    user(state, 'prior', '地三鲜怎么做？');
    user(state, 'first', earlier, NOW - 20_000, true);
    user(state, 'last', correction, NOW - 10_000, true);
    reject(state, proposal('last', correction, { basis: 'explicit_request', contextMessageId: 'prior' }), `${earlier} → ${correction}`);
  }
  const state = createChef();
  user(state, 'prior', '地三鲜怎么做？', NOW - 120_000);
  user(state, 'typo', '我要一个人物', NOW - 90_000, true);
  user(state, 'correction', '任务', NOW - 10_000, true);
  reject(state, proposal('correction', '任务', { basis: 'explicit_request', contextMessageId: 'prior' }), 'not an adjacent correction after more than 60 seconds');
});

void test('历史委托与目标都须真实：当前源不可用旧id或伪造原文、历史引用也必须存在', () => {
  const state = createChef();
  user(state, 'prior', '我现在要开始做地三鲜了');
  user(state, 'flow', '给我全部流程', NOW - 10_000, true);
  reject(state, proposal('prior', '我现在要开始做地三鲜了'), 'historical source id is not a current source');
  reject(state, proposal('flow', '我要做地三鲜', { contextMessageId: 'prior' }), 'invented current evidence');
  reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'missing' }), 'invented historical source id');
  reject(state, proposal('flow', '给我全部流程'), 'missing required contextual source');
  reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior', goalKey: '红烧肉', title: '红烧肉' }), 'invented goal');
});

void test('承诺之后普通知识提问不借历史创建任务', () => {
  for (const text of ['茄子为什么吸油？', '地三鲜这个名字什么意思？', '土豆怎么切才好看？', '我可以自己看']) {
    const state = createChef();
    user(state, 'prior', '我现在要开始做地三鲜了');
    user(state, 'question', text, NOW - 10_000, true);
    reject(state, proposal('question', text, { contextMessageId: 'prior' }), text);
  }
});

void test('显式只要文字、撤回、暂停、取消和完成不能被新流程消息重新激活', () => {
  const barriers = ['先不做地三鲜了', '今天先暂停', '取消刚才的任务', '我已经做好地三鲜了', '先只给我文字，不要任务', '换个话题，今天北京天气怎么样？', '我现在要做番茄炒蛋了'];
  for (const barrier of barriers) {
    const state = createChef();
    user(state, 'prior', '我现在要开始做地三鲜了', NOW - 120_000);
    user(state, 'barrier', barrier, NOW - 60_000);
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), barrier);
  }
  for (const refusal of ['给我全部流程，只要文字', '不用给任务卡，给我全部流程', '给我一个任务，但先别创建']) {
    const state = createChef();
    user(state, 'prior', '我现在要开始做地三鲜了');
    user(state, 'current', refusal, NOW - 10_000, true);
    reject(state, proposal('current', refusal, { basis: refusal.includes('一个任务') ? 'explicit_request' : 'execution_commitment', contextMessageId: 'prior' }), refusal);
  }
});

void test('当前队列后续撤回或换目标，前一条片段不再授权创建原目标', () => {
  for (const later of ['不要任务', '先不做了', '先暂停', '取消', '刚才说错了，改做番茄炒蛋']) {
    const state = createChef();
    user(state, 'prior', '我现在要开始做地三鲜了');
    user(state, 'flow', '给我全部流程', NOW - 20_000, true);
    user(state, 'later', later, NOW - 10_000, true);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), later);
  }
});

void test('同队列尚未创建的承诺与补充也可引用，保持sourceMessageId为补充消息', () => {
  const state = createChef();
  user(state, 'start', '我现在要开始做地三鲜了', NOW - 20_000, true);
  user(state, 'flow', '给我全部流程', NOW - 10_000, true);
  const result = apply(state, proposal('flow', '给我全部流程', { contextMessageId: 'start' }));
  assert.equal(result?.created, true);
  assert.equal(result?.task.sourceMessageId, 'flow');
});

void test('引用、假设和别人的承诺不能成为历史执行委托', () => {
  for (const prior of ['我朋友说“我要做地三鲜”', '如果明天有空我就开始做地三鲜', '“我现在要开始做地三鲜了”这句话怎么翻译？', '妈妈让我做地三鲜，我只是问问']) {
    const state = createChef();
    user(state, 'prior', prior);
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), prior);
  }
});

void test('已经完成不是正在执行，当前或历史完成陈述都不能建新任务', () => {
  for (const text of ['我已经做好地三鲜了', '地三鲜我做完了', '我刚做完地三鲜']) {
    const state = createChef();
    user(state, 'finished', text, NOW - 10_000, true);
    reject(state, proposal('finished', text), text);
  }
  const state = createChef();
  user(state, 'start', '我已经开始做地三鲜了', NOW - 10_000, true);
  assert.equal(apply(state, proposal('start', '我已经开始做地三鲜了'))?.created, true);
});

void test('步骤完成事件没有当轮用户发言，不得借旧需求创建另一任务', () => {
  const state = createChef();
  user(state, 'prior', '我现在要开始做地三鲜了');
  const evidence = chefTaskDelegationEvidence(state, NOW, []);
  assert.deepEqual(evidence.sources, []);
  reject(state, proposal('prior', '我现在要开始做地三鲜了'), 'structured event has no current delegation');
});

void test('近期窗口只包含可见已送达用户消息；隐藏、旧导入、未来、过期和跨日不能引用', () => {
  for (const kind of ['hidden', 'legacy', 'unknown', 'future', 'expired', 'priorDay'] as const) {
    const state = createChef();
    const at = kind === 'expired' ? NOW - 31 * 60_000 : kind === 'priorDay' ? new Date(2026, 9, 9, 23, 59).getTime() : NOW - 60_000;
    user(state, 'prior', '我现在要开始做地三鲜了', at);
    const prior = state.messages[0];
    if (kind === 'hidden') state.privateHistoryHiddenIds = ['prior'];
    if (kind === 'legacy') prior.turnId = 'legacy:prior';
    if (kind === 'unknown') prior.chronologyUnknown = true;
    if (kind === 'future') prior.deliverAt = NOW + 60_000;
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    assert.equal(chefTaskDelegationEvidence(state, NOW).contextSources.some(source => source.id === 'prior'), false, kind);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), kind);
  }
  const midnight = new Date(2026, 9, 10, 0, 5).getTime(), state = createChef();
  user(state, 'prior', '我现在要开始做地三鲜了', midnight - 10 * 60_000);
  user(state, 'flow', '给我全部流程', midnight - 10_000, true);
  reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'prior' }), 'crossing midnight within 30 min', midnight);
});

void test('近期最多四条用户证据，不允许越过四条闲聊借更旧的承诺', () => {
  const state = createChef();
  user(state, 'old', '我现在要开始做地三鲜了', NOW - 300_000);
  for (let index = 0; index < 5; index++) user(state, `recent-${index}`, `闲聊第${index}条`, NOW - 240_000 + index * 30_000);
  user(state, 'flow', '给我全部流程', NOW - 10_000, true);
  const evidence = chefTaskDelegationEvidence(state, NOW);
  assert.ok(evidence.contextSources.length <= 4);
  assert.equal(evidence.contextSources.some(source => source.id === 'old'), false);
  reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'old' }), 'outside last four users');
});

void test('已结束的任务不由旧执行承诺复建；新的明确执行仍然可以创建', () => {
  for (const status of ['completed', 'cancelled', 'paused'] as const) {
    const state = createChef();
    user(state, 'start', '我现在要开始做地三鲜了', NOW - 120_000, true);
    const task = apply(state, proposal('start', '我现在要开始做地三鲜了'), NOW - 110_000)!.task;
    task.status = status;
    nextQueue(state);
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    reject(state, proposal('flow', '给我全部流程', { contextMessageId: 'start' }), `${status} task cannot reactivate old delegation`);
    if (status !== 'paused') {
      nextQueue(state);
      user(state, 'fresh', '我现在重新做地三鲜', NOW - 5_000, true);
      assert.equal(apply(state, proposal('fresh', '我现在重新做地三鲜'))?.created, true);
      assert.equal(state.professionalTasks.length, 2);
    }
  }
});

void test('contextMessageId有格式门槛，none提案仍兼容旧客户端', () => {
  for (const contextMessageId of ['', 123, 'x'.repeat(161)])
    assert.throws(() => parseProfessionalTaskOperation(proposal('flow', '给我全部流程', { contextMessageId })), String(contextMessageId));
  assert.deepEqual(parseProfessionalTaskOperation({ decision: 'none' }), { decision: 'none' } satisfies ProfessionalTaskOperation);
});

void test('修改已有任务也不能附加伪造的历史来源', () => {
  const state = createChef();
  user(state, 'start', '我现在要开始做地三鲜了', NOW - 120_000, true);
  const task = apply(state, proposal('start', '我现在要开始做地三鲜了'), NOW - 110_000)!.task;
  nextQueue(state);
  user(state, 'edit', '把青椒换成彩椒', NOW - 10_000, true);
  reject(state, proposal('edit', '把青椒换成彩椒', {
    decision: 'update', basis: 'existing_task_change', taskId: task.id, contextMessageId: 'missing',
  }), 'update cannot silently ignore invalid context reference');
});

void test('已明确执行并索取完整流程，却仅返回文字步骤，会在展示前触发漏卡修复', () => {
  const state = createChef();
  user(state, 'start', '我现在要开始做地三鲜了', NOW - 60_000);
  user(state, 'flow', '给我全部流程', NOW - 10_000, true);
  const before = structuredClone(state);
  const raw = { ...reply(), messages: [{ type: 'text', text: '第一步，准备土豆、茄子和青椒。第二步，把土豆和茄子熟化。第三步，合炒调味。' }] };
  assert.throws(() => applyChef(state, parseChef(raw, '给我全部流程'), 'reply-flow', NOW),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'TASK_CARD_OMITTED');
  assert.deepEqual(state, before, 'the omitted card must not publish a partial reply or change any state');
});

void test('纯咨询索取流程允许完整文字；明确只要文字也不强制任务卡', () => {
  for (const [prior, text] of [['地三鲜怎么做？', '给我全部流程'], ['我现在要开始做地三鲜了', '给我全部流程，只要文字']] as const) {
    const state = createChef();
    user(state, 'prior', prior);
    user(state, 'flow', text, NOW - 10_000, true);
    const raw = { ...reply(), messages: [{ type: 'text', text: '第一步，准备土豆、茄子和青椒。第二步，熟化。第三步，合炒。' }] };
    applyChef(state, parseChef(raw, text), 'reply-flow', NOW);
    assert.equal(state.professionalTasks.length, 0);
    assert.equal(state.messages.filter(message => message.role === 'assistant').length, 1);
  }
});

void test('没有保存任务不得声称已创建；普通否定说明不误触发漏卡', () => {
  const state = createChef();
  user(state, 'flow', '地三鲜怎么做？', NOW - 10_000, true);
  const raw = { ...reply(), messages: [{ type: 'text', text: '已经给你创建了任务。' }] };
  const before = structuredClone(state);
  assert.throws(() => applyChef(state, parseChef(raw, '地三鲜怎么做？'), 'reply-lie', NOW),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'TASK_CARD_OMITTED');
  assert.deepEqual(state, before);
  const denial = { ...reply(), messages: [{ type: 'text', text: '我还没有创建任务，先告诉你做法。' }] };
  applyChef(state, parseChef(denial, '地三鲜怎么做？'), 'reply-denial', NOW);
  assert.equal(state.professionalTasks.length, 0);
});

void test('“我可以自己看”仅在已经明确执行并索取了完整流程时承接交付', () => {
  const state = createChef();
  user(state, 'start', '我现在要开始做地三鲜了', NOW - 120_000);
  user(state, 'flow', '给我全部流程', NOW - 60_000);
  user(state, 'self', '我可以自己看', NOW - 10_000, true);
  const result = apply(state, proposal('self', '我可以自己看', { contextMessageId: 'start' }));
  assert.equal(result?.created, true);
  assert.equal(result?.task.sourceMessageId, 'self');
  assert.equal(result?.task.contextMessageId, 'start');
});

void test('直接委托也须服从同队列后续改菜，不能通过省略contextMessageId创建旧目标', () => {
  for (const later of ['改做番茄炒蛋', '改成番茄炒蛋', '刚才说错了，改做番茄炒蛋']) {
    const state = createChef();
    user(state, 'start', '我现在要开始做地三鲜了', NOW - 20_000, true);
    user(state, 'change', later, NOW - 10_000, true);
    reject(state, proposal('start', '我现在要开始做地三鲜了'), later);
  }
});

void test('自然索取完整流程的同义表达可承接执行，知识前文仍不能误建任务', () => {
  for (const text of ['给我全部流程吧', '把全部流程发给我吧', '给我完整步骤，我可以自己看']) {
    const state = createChef();
    user(state, 'start', '我现在要开始做地三鲜了');
    user(state, 'flow', text, NOW - 10_000, true);
    assert.equal(apply(state, proposal('flow', text, { contextMessageId: 'start' }))?.created, true, text);
    const consulting = createChef();
    user(consulting, 'question', '地三鲜怎么做？');
    user(consulting, 'flow', text, NOW - 10_000, true);
    reject(consulting, proposal('flow', text, { contextMessageId: 'question' }), `${text} after knowledge question`);
  }
});

void test('数字列表和先接着最后的完整流程同样检测漏卡，普通知识回复不强制建卡', () => {
  for (const text of ['1. 准备土豆、茄子和青椒。\n2. 分批熟化食材。\n3. 合炒调味。', '先把土豆、茄子和青椒切好，接着分批熟化土豆和茄子，最后合炒调味。']) {
    const state = createChef();
    user(state, 'start', '我现在要开始做地三鲜了');
    user(state, 'flow', '给我全部流程', NOW - 10_000, true);
    const raw = { ...reply(), messages: [{ type: 'text', text }] }, before = structuredClone(state);
    assert.throws(() => applyChef(state, parseChef(raw, '给我全部流程'), 'reply-flow', NOW),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'TASK_CARD_OMITTED');
    assert.deepEqual(state, before, 'omission handling must not publish either recipe format');
    const consulting = createChef();
    user(consulting, 'question', '地三鲜怎么做？');
    user(consulting, 'flow', '给我全部流程', NOW - 10_000, true);
    applyChef(consulting, parseChef(raw, '给我全部流程'), 'reply-flow', NOW);
    assert.equal(consulting.professionalTasks.length, 0);
    assert.equal(consulting.messages.filter(message => message.role === 'assistant').length, 1);
  }
});

void test('队列生成与同日显式重试保留请求时的30分钟窗口；跨日和请求时已过期仍拒绝', () => {
  const delayedNow = NOW + 90 * 60_000, state = createChef();
  user(state, 'start', '我现在要开始做地三鲜了', NOW - 60_000);
  user(state, 'flow', '给我全部流程', NOW - 10_000, true);
  const requestEvidence = chefTaskDelegationEvidence(state, NOW);
  const retryEvidence = chefTaskDelegationEvidence(state, delayedNow);
  assert.deepEqual(retryEvidence.contextSources, requestEvidence.contextSources);
  assert.equal(apply(state, proposal('flow', '给我全部流程', { contextMessageId: 'start' }), delayedNow)?.created, true);
  const expired = createChef();
  user(expired, 'start', '我现在要开始做地三鲜了', NOW - 31 * 60_000);
  user(expired, 'flow', '给我全部流程', NOW, true);
  reject(expired, proposal('flow', '给我全部流程', { contextMessageId: 'start' }), 'already expired when current request was made', delayedNow);
  const crossDay = createChef();
  user(crossDay, 'start', '我现在要开始做地三鲜了', NOW - 60_000);
  user(crossDay, 'flow', '给我全部流程', NOW - 10_000, true);
  reject(crossDay, proposal('flow', '给我全部流程', { contextMessageId: 'start' }), 'retry crossed a local calendar day', new Date(2026, 9, 11, 0, 1).getTime());
});

void test('改菜不能由证据截断或重提旧菜名绕过，同菜替换配料仍保留原目标', () => {
  const continued = createChef();
  user(continued, 'start', '我现在要开始做地三鲜了');
  user(continued, 'flow', '给我全部流程，不过改做番茄炒蛋', NOW - 10_000, true);
  reject(continued, proposal('flow', '给我全部流程', { contextMessageId: 'start' }), 'a positive flow fragment cannot discard changing the dish in the same message');
  const changed = createChef();
  user(changed, 'start', '我要做地三鲜', NOW - 20_000, true);
  user(changed, 'change', '把地三鲜换成番茄炒蛋', NOW - 10_000, true);
  reject(changed, proposal('start', '我要做地三鲜'), 'mentioning the old dish while replacing it is not permission to create the old dish');
  const ingredient = createChef();
  user(ingredient, 'start', '我要做地三鲜', NOW - 20_000, true);
  user(ingredient, 'change', '把青椒换成彩椒', NOW - 10_000, true);
  const result = apply(ingredient, proposal('start', '我要做地三鲜'));
  assert.equal(result?.created, true);
  assert.equal(result?.task.goalKey, '地三鲜');
});
