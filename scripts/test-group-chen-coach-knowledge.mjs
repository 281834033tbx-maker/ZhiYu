import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';
import { groupParticipationFixture } from './group-participation-fixture.mjs';

// All calls inject offline responses into the real generator; edits below only
// touch its disposable directory, never the live source, model, API or data.
const runtime = isolatedNpcRuntime();
const knowledgePath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-coach-knowledge-20261013.json';
const knowledgeFile = join(runtime.root, knowledgePath);
const originalKnowledge = readFileSync(knowledgeFile, 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const members = [
  { id: 'user', name: '合成用户', role: 'user' },
  { id: 'molly', name: 'Molly', role: 'administrator' },
  { id: 'chen-nian', name: '陈年', role: 'fitness-coach' },
  { id: 'liu', name: '柳智敏', role: 'nutritionist' },
  { id: 'zhou-chef', name: '赵一帆', role: 'chef' },
];
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-offline-group-generator', realModelInvoked: false,
  externalApiCalled: false, productionDatabaseAccessed: false, productionMessagesSent: false, mediaDownloaded: false,
  checks: [], cases: [], limitations: [
    'These checks verify loading, scoped prompt assembly and shared snapshots using injected outputs; they do not prove real-model coaching correctness or semantic character isolation.',
    'The existing group reviewer receives the same source records but remains a text/conversation reviewer; this is not evidence of separate technical validation or real movement observation.',
  ] };
const contextFor = (text, mentionIds = ['chen-nian'], withChen = true) => ({
  group: { id: 'synthetic-coach-group', name: '合成研究群', goal: '合成训练与饮食', members: withChen ? members : members.filter(member => member.id !== 'chen-nian'), messages: [], reminders: [] },
  kind: 'message', now: Date.parse('2026-10-13T03:00:00Z'), facts: { facts: [] },
  incoming: { id: 'synthetic-input', senderId: 'user', senderName: '合成用户', type: 'text', text, mentionIds, at: '2026-10-13T03:00:00Z' },
});
const jsonAfter = (prompt, marker) => {
  const line = prompt.split('\n').find(line => line.startsWith(marker));
  return line ? JSON.parse(line.slice(marker.length)) : undefined;
};
const personBlock = (prompt, id) => {
  const start = prompt.indexOf(`【人物${id}当前Skill`);
  assert.ok(start >= 0, `Missing actual member ${id}`);
  const other = [...prompt.matchAll(/【(?:人物[^】]+当前Skill[^】]*|Molly独立口吻)】/g)].map(match => match.index).filter(index => index > start);
  const final = prompt.indexOf('【当前群规则优先于私聊推进和旧能力限制】', start);
  const reviewFinal = prompt.indexOf('【本轮同一冻结群规则】', start);
  const candidates = [...other, final, reviewFinal].filter(index => index > start);
  return prompt.slice(start, candidates.length ? Math.min(...candidates) : undefined);
};

try {
  const { generateGroupDialogue } = await runtime.load('server/npc/group-dialogue');
  const { loadDialogueSkill } = await runtime.load('server/npc/dialogue-skill');
  const api = await runtime.load('server/npc/chen-coach-knowledge');
  const library = api.parseChenCoachKnowledge(originalKnowledge);
  const runCase = async ({ name, text, expected, mentionIds = ['chen-nian'], withChen = true, speakerId = 'chen-nian', mutateAt = null }) => {
    const context = contextFor(text, mentionIds, withChen);
    const calls = [];
    const stages = [];
    const draft = { messages: [{ senderId: speakerId, text: '合成有条件答复，依据当前状态继续调整。', mentionIds: [] }] };
    const output = await generateGroupDialogue(runtime.root, context, async (_root, prompt) => {
      calls.push(prompt);
      const stage = prompt.startsWith('你是智域群聊发言路由器') ? 'routing' : prompt.startsWith('你是智域群聊成品复核器') ? 'review' : 'generation';
      stages.push(stage);
      if (stage === mutateAt) {
        const changed = JSON.parse(originalKnowledge);
        changed.version += '-mid-turn-change';
        changed.coreRules.push('MID_CALL_KNOWLEDGE_RULE_MUST_NOT_APPEAR');
        changed.entries.find(entry => entry.id === expected).summary = 'MID_CALL_KNOWLEDGE_ENTRY_MUST_NOT_APPEAR';
        writeFileSync(knowledgeFile, JSON.stringify(changed));
      }
      if (stage === 'routing') return groupParticipationFixture([speakerId]);
      if (stage === 'review') return { verdict: 'keep', edits: [] };
      assert.ok(prompt.startsWith('你是智域群聊协作生成器'));
      return structuredClone(draft);
    });
    assert.deepEqual(output, draft);
    assert.deepEqual(stages, ['routing', 'generation', 'review']);
    const generation = calls.find(prompt => prompt.startsWith('你是智域群聊协作生成器'));
    const review = calls.find(prompt => prompt.startsWith('你是智域群聊成品复核器'));
    if (withChen) {
      const selected = api.matchChenCoachKnowledgeEntries(library, text);
      assert.ok(selected.length > 0 && selected.length <= 5 && selected.some(entry => entry.id === expected), name);
      assert.deepEqual(jsonAfter(generation, api.chenCoachKnowledgeMarker), selected, `${name}: exact selected generation records`);
      assert.deepEqual(jsonAfter(review, api.chenCoachKnowledgeMarker), selected, `${name}: same exact selected review records`);
      const chen = personBlock(generation, 'chen-nian');
      assert.ok(chen.includes(api.chenCoachKnowledgeMarker) && chen.includes(api.chenCoachKnowledgeRules));
      for (const id of ['liu', 'zhou-chef']) {
        const block = personBlock(generation, id);
        assert.ok(!block.includes(api.chenCoachKnowledgeMarker) && !block.includes(api.chenCoachKnowledgeRules), `${name}: ${id} own rule block must not contain Chen references`);
        assert.ok(!block.includes('MID_CALL_KNOWLEDGE_'), `${name}: no cross-role rule leakage`);
      }
      const genPersonalities = generation.slice(generation.indexOf('【Molly独立口吻】'), generation.indexOf('【当前群规则优先于私聊推进和旧能力限制】')).trim();
      const reviewPersonalities = review.split('【本轮完整人物规则；与生成同一冻结快照】')[1].split('【本轮同一冻结群规则】')[0].trim();
      assert.equal(genPersonalities, reviewPersonalities, `${name}: complete same-turn personalities and all reference conditions`);
      if (mutateAt) {
        for (const prompt of calls) assert.ok(!prompt.includes('MID_CALL_KNOWLEDGE_'), `${name}: disk change must not affect a loaded turn`);
        const nextLoad = loadDialogueSkill(runtime.root, '你是陈年，稳定人物ID：chen-nian。', 'chen-nian');
        assert.ok(nextLoad.chenCoachKnowledgeLibrary.coreRules.some(rule => rule.includes('MID_CALL_KNOWLEDGE_RULE')));
        writeFileSync(knowledgeFile, originalKnowledge);
      }
    } else {
      for (const prompt of [generation, review]) {
        assert.ok(!prompt.includes(api.chenCoachKnowledgeMarker) && !prompt.includes(api.chenCoachKnowledgeRules));
        assert.ok(!prompt.includes('【人物chen-nian当前Skill'));
      }
    }
    report.cases.push({ name, withChen, stages, selectedIds: withChen ? api.matchChenCoachKnowledgeEntries(library, text).map(entry => entry.id) : [],
      inputHashes: calls.map(digest), mutationStage: mutateAt, passed: true });
  };
  await runCase({ name: 'direct-at-training', text: '我想练上胸，但是哑铃上下凳困难', expected: 'pair-upper_chest' });
  await runCase({ name: 'direct-at-fatigue', text: '疲劳，没睡好，训练状态差该减量吗', expected: 'recovery-fatigue-adjustment' });
  await runCase({ name: 'generation-mid-call-disk-change', text: '在家徒手，俯卧撑做不了', expected: 'home-regression', mutateAt: 'generation' });
  await runCase({ name: 'routing-mid-call-disk-change', text: '一周四练，不设独立手臂日', expected: 'split-4-days', mentionIds: [], mutateAt: 'routing' });
  report.checks.push('Training/fatigue/home/four-day cases include relevant bounded Chen entries; each user message has semantic routing/generation/review, including explicit @; no extra retrieval stages are added.');
  report.checks.push('Mutating only the disposable knowledge file during routing or generation does not affect the current generation/review snapshot; a subsequent loader sees the change, proving the test exercised the real file path.');

  for (const [id, name] of [['liu', '柳智敏'], ['zhou-chef', '赵一帆']]) {
    const loaded = loadDialogueSkill(runtime.root, `你是${name}，稳定人物ID：${id}。`, id);
    assert.ok(!loaded.chenCoachKnowledgeLibrary);
    assert.ok(!loaded.metadata.sources.some(source => source.path === knowledgePath));
    assert.ok(!loaded.rules.includes(api.chenCoachKnowledgeRules));
  }
  renameSync(knowledgeFile, knowledgeFile + '.missing-test');
  try {
    await runCase({ name: 'chen-absent-library-missing', text: '早餐怎么搭配', expected: null, mentionIds: ['liu'], withChen: false, speakerId: 'liu' });
    let calls = 0;
    await assert.rejects(generateGroupDialogue(runtime.root, contextFor('疲劳应该减量吗'), async () => {
      calls++; throw new Error('Unexpected model stage');
    }), error => error.code === 'MODULE_MISSING');
    assert.equal(calls, 0, 'Missing required Chen knowledge must fail before any model stage when Chen is a member');
  } finally { renameSync(knowledgeFile + '.missing-test', knowledgeFile); }
  report.checks.push('Liu/chef individual loaders ignore the new Chen library and their own group blocks contain no Chen source context. A Chen-absent nutrition group succeeds even when that file is absent; Chen-present groups fail before any model call instead of silently dropping the new knowledge.');
  assert.equal(readFileSync(knowledgeFile, 'utf8'), originalKnowledge);
  assert.equal(readFileSync(knowledgePath, 'utf8'), originalKnowledge, 'Live knowledge remains untouched');
  report.passed = true; report.knowledgeHash = digest(originalKnowledge);
  report.command = 'node scripts/test-group-chen-coach-knowledge.mjs';
  mkdirSync('output/chen-coach-completion-20261013', { recursive: true });
  writeFileSync('output/chen-coach-completion-20261013/group-coach-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log('PASS group Chen coaching: 5 isolated cases; training/fatigue retrieval, same-turn frozen generation/review, role-scoped references and absent-member/missing-file isolation. Model/API/production/media operations 0.');
} finally { runtime.cleanup(); }
