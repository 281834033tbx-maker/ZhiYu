import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

// No model, scheduler, formal account or database access. Exercises the real
// group generator/parser and numeric-preserving editor with injected outputs.
const runtime = isolatedNpcRuntime();
const { generateGroupDialogue } = await runtime.load('server/npc/group-dialogue');
const digest = value => createHash('sha256').update(value).digest('hex');
const members = [
  { id: 'user', name: '合成用户', role: 'user' },
  { id: 'molly', name: 'Molly', role: 'administrator' },
  { id: 'chen-nian', name: '陈年', role: 'fitness-coach' },
  { id: 'liu', name: '柳智敏', role: 'nutritionist' },
  { id: 'zhou-chef', name: '赵一帆', role: 'chef' },
];
const context = {
  group: { id: 'PRIVATE_GROUP_IDENTIFIER', goal: 'PRIVATE_SYNTHETIC_GOAL', members, messages: [], reminders: [] },
  kind: 'message', now: Date.parse('2026-10-10T03:00:00Z'), facts: { facts: [] },
  incoming: { id: 'PRIVATE_MESSAGE_IDENTIFIER', senderId: 'user', type: 'text', text: '合成用户准备动手', mentionIds: ['chen-nian'] },
};
const draft = {
  messages: [
    { senderId: 'molly', text: '老大这周自己做饭\n@柳智敏 定搭配\n@陈年 配合训练\n@赵一帆 带做法', mentionIds: ['liu', 'chen-nian', 'zhou-chef'] },
    { senderId: 'chen-nian', text: '好的，我明白了。我靠，这也太卷了😂，鸡蛋1个先摆出来。', mentionIds: [] },
    { senderId: 'zhou-chef', text: '先慢慢下放，再推起，做8次。没有不适再继续。', mentionIds: [] },
    { senderId: 'liu', text: '饮食安排和采购差额已经整理，请先核对。', mentionIds: [] },
  ],
  planDraft: {
    days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(10 + i).padStart(2, '0')}`, label: '合成安排', breakfast: '鸡蛋1个', lunch: '米饭150克', dinner: '合成晚餐' })),
    shopping: [{ name: '鸡蛋', required: '7个', available: '1个', toBuy: '6个' }],
  },
  confirmPlan: { planId: 'synthetic-plan', evidence: '合成确认原话' },
  reminderProposals: [{ meal: 'breakfast', time: '08:00', startDate: '2026-10-10', endDate: '2026-10-16', evidence: '合成时段原话' }],
  reminderControls: [{ reminderId: 'synthetic-reminder', operation: 'pause', evidence: '合成暂停原话' }],
};
const replacement = '我靠，这也太卷了😂\n鸡蛋1个先摆出来。';
const runWithReview = async (review, turnContext = context, turnDraft = draft) => {
  const calls = [];
  const output = await generateGroupDialogue(runtime.root, turnContext, async (_root, prompt) => {
    calls.push(prompt);
    if (prompt.startsWith('你是智域群聊发言路由器')) return groupParticipationFixture(['molly','liu','zhou-chef'],{intent:'task-coordination',operationalSpeakerIds:['molly','liu','zhou-chef']});
    if (prompt.startsWith('你是智域群聊成品复核器')) return review;
    assert.ok(prompt.startsWith('你是智域群聊协作生成器'));
    return structuredClone(turnDraft);
  });
  return { output, calls };
};

try {
  const kept = await runWithReview({ verdict: 'keep', edits: [] });
  assert.deepEqual(kept.output, draft, 'matched rough words, emoji, sequence and all executable proposals must survive unchanged');
  assert.equal(kept.calls.length, 3, 'direct @ receives semantic routing and one independent review');
  assert.match(kept.calls[1], /人物liu当前Skill/, 'nutrition plan author receives her actual current personality rules');
  assert.match(kept.calls[2], /人物liu当前Skill/, 'review uses the same Liu nutrition rules as generation');
  const revised = await runWithReview({ verdict: 'revise', edits: [{ index: 1, text: replacement }] });
  const expected = structuredClone(draft); expected.messages[1].text = replacement;
  assert.deepEqual(revised.output, expected, 'text edit must not mutate plans, confirmations, reminders, senders or real @ IDs');
  assert.match(revised.calls[2], /数字不变也不能把分钟改成温度、反转动作方向或删掉关键完成判断/);
  assert.match(revised.calls[2], /符合语境的已有表达保留，不文明化或抹平/);

  const oneMessage = (senderId, text) => ({ messages: [{ senderId, text, mentionIds: [] }] });
  // The new user-@ completeness rule must match these isolated Molly-only
  // editorial cases, rather than requiring an unrelated Chen reply.
  const mollyContext = {...context, incoming: {...context.incoming, mentionIds: ['molly']}};
  const receipt = await runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '1' }] }, mollyContext, oneMessage('molly', '收到'));
  assert.equal(receipt.output.messages[0].text, '1', 'Molly may use her endorsed pure reaction numeral');
  const noNumeral = await runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '懂' }] }, mollyContext, oneMessage('molly', '1'));
  assert.equal(noNumeral.output.messages[0].text, '懂', 'Molly may naturally replace a pure reaction numeral');
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '提醒09:00' }] }, mollyContext, oneMessage('molly', '提醒08:00')), /不得增删数值/);
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '免费' }] }, mollyContext, oneMessage('molly', '价格1元')), /不得增删数值/);
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '懂' }] }, context, oneMessage('chen-nian', '1')), /不得增删数值/);

  // Sign is part of the numeric fact. Exercise the real group review path,
  // including its global-list and per-speaker numeric protection.
  for (const signed of ['-18', '−18', '－18', '- 18', '− 18', '－ 18']) {
    await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '冷冻温度18℃。' }] }, context, oneMessage('chen-nian', `冷冻温度${signed}℃。`)), /不得增删数值/, `cannot drop ${signed} sign`);
    await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '冷冻温度+18℃。' }] }, context, oneMessage('chen-nian', `冷冻温度${signed}℃。`)), /不得增删数值/, `cannot reverse ${signed} sign`);
  }
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '温度-18℃。' }] }, context, oneMessage('chen-nian', '温度＋18℃。')), /不得增删数值/);
  for (const equivalent of ['−18', '－18', '− 18', '－ 18']) {
    const normalized = await runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '冷冻温度-18℃。' }] }, context, oneMessage('chen-nian', `冷冻温度${equivalent}℃。`));
    assert.equal(normalized.output.messages[0].text, '冷冻温度-18℃。', `equivalent ${equivalent} minus notation is allowed`);
  }

  /** @type {Array<[string, unknown]>} */
  const rejectedReviews = [
    ['missing review', undefined],
    ['missing edits', { verdict: 'keep' }],
    ['whole replacement', { verdict: 'revise', edits: [], messages: [] }],
    ['deletion', { verdict: 'revise', edits: [], remove: [1] }],
    ['sender edit', { verdict: 'revise', edits: [{ index: 1, text: replacement, senderId: 'zhou-chef' }] }],
    ['mention edit', { verdict: 'revise', edits: [], mentionIds: ['user'] }],
    ['plan edit', { verdict: 'revise', edits: [], planDraft: { days: [] } }],
    ['numeric change', { verdict: 'revise', edits: [{ index: 2, text: '先慢慢下放，再推起，做80次。没有不适再继续。' }] }],
    ['incorrect keep', { verdict: 'keep', edits: [{ index: 1, text: replacement }] }],
    ['invalid index', { verdict: 'revise', edits: [{ index: 9, text: replacement }] }],
    ['duplicate index', { verdict: 'revise', edits: [{ index: 1, text: replacement }, { index: 1, text: replacement }] }],
    ['lost display handoff', { verdict: 'revise', edits: [{ index: 0, text: '老大这周自己做饭\n定搭配\n@陈年 配合训练\n@赵一帆 带做法' }] }],
    ['technical redraft', { verdict: 'redraft', edits: [] }],
  ];
  for (const [label, review] of rejectedReviews) {
    let returned = false;
    await assert.rejects(async () => { await runWithReview(review); returned = true; }, undefined, label);
    assert.equal(returned, false, `${label}: no unchecked output may reach the storage caller`);
  }
  const opening = { ...structuredClone(context), kind: 'opening', incoming: undefined };
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '@柳智敏 定搭配\n@陈年 配合训练\n@赵一帆 带做法' }] }, opening), /称呼/);
  await assert.rejects(() => runWithReview({ verdict: 'revise', edits: [{ index: 0, text: '老大这周自己做饭 @柳智敏 定搭配 @陈年 配合训练 @赵一帆 带做法' }] }, opening), /分行/);

  // Slow-call mutation: both personality and group rules were assembled before
  // routing, and changing their files while models run cannot affect this turn.
  const corePath = join(runtime.root, 'npc-skills/skills/zhiyu-character-dialogue/references/core-behavior.md');
  const groupPath = join(runtime.root, 'npc-skills/skills/zhiyu-group-dialogue/SKILL.md');
  const oldCore = readFileSync(corePath, 'utf8'), oldGroup = readFileSync(groupPath, 'utf8');
  const changedContext = structuredClone(opening), calls = [];
  const frozen = await generateGroupDialogue(runtime.root, changedContext, async (_root, prompt) => {
    calls.push(prompt);
    if (prompt.startsWith('你是智域群聊发言路由器')) {
      await new Promise(resolve => setTimeout(resolve, 5));
      writeFileSync(corePath, oldCore + '\n\nMID_ROUTING_RULE_CHANGE_MUST_NOT_APPEAR\n');
      changedContext.group.goal = 'MID_CALL_INPUT_CHANGE_MUST_NOT_APPEAR';
      return groupParticipationFixture(['molly','liu','zhou-chef'],{intent:'task-coordination',operationalSpeakerIds:['molly','liu','zhou-chef']});
    }
    if (prompt.startsWith('你是智域群聊协作生成器')) {
      writeFileSync(groupPath, oldGroup + '\n\nMID_GENERATION_GROUP_CHANGE_MUST_NOT_APPEAR\n');
      return structuredClone(draft);
    }
    assert.ok(prompt.startsWith('你是智域群聊成品复核器'));
    return { verdict: 'keep', edits: [] };
  });
  assert.deepEqual(frozen, draft);
  assert.equal(calls.length, 3, 'opening uses routing, generation and one review');
  for (const prompt of calls) assert.doesNotMatch(prompt, /MID_(?:ROUTING|GENERATION|CALL)_/);
  const generatedRules = calls[1].split('【当前群规则优先于私聊推进和旧能力限制】')[0]
    .slice(calls[1].indexOf('【Molly独立口吻】')).trim();
  const reviewedRules = calls[2].split('【本轮完整人物规则；与生成同一冻结快照】')[1]
    .split('【本轮同一冻结群规则】')[0].trim();
  assert.equal(generatedRules, reviewedRules, 'generation and review must carry exactly the same assembled personality rules');
  assert.ok(calls[2].includes(oldGroup), 'review must carry the pre-generation group policy');
  writeFileSync(corePath, oldCore); writeFileSync(groupPath, oldGroup);

  const traces = readdirSync(join(runtime.root, '.npc-runtime/group-skill-traces')).map(name => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/group-skill-traces', name), 'utf8')));
  const completed = traces.filter(trace => trace.status === 'complete');
  assert.equal(completed.length, 9);
  assert.ok(traces.some(trace => trace.status === 'failed'));
  for (const trace of traces) {
    assert.match(trace.rulesHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(trace), /PRIVATE_(?:GROUP|MESSAGE|SYNTHETIC)|我靠|鸡蛋|合成用户/);
    if (trace.status === 'failed') assert.ok(!trace.resultHash, 'rejected reviews must not claim a finalized output');
  }
  const last = completed.find(trace => trace.stages.some(stage => stage.inputHash === digest(calls[2])));
  assert.ok(last);
  assert.deepEqual(last.stages.map(stage => stage.stage), ['load', 'routing', 'generation', 'review', 'finalize']);
  console.log('PASS group frozen generation/review, ordinary rough words + emoji preservation, text-only edits, real @ handoffs, Molly opening/line breaks, numeric rejection, technical redraft blocking and hash-only traces; isolated synthetic inputs, model/production writes 0. Semantic completeness is not proved by these structural checks.');
} finally { runtime.cleanup(); }
