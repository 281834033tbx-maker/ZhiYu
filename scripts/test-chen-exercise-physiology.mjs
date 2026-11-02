import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
import {groupParticipationFixture} from './group-participation-fixture.mjs';

// Disposable copies and offline substitutes only. No real model, network,
// production messages, health records or task state are read or modified.
const runtime = isolatedNpcRuntime();
const output = 'output/chen-exercise-physiology-20261018';
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-acsm-foundation-20261017.json';
const libraryFile = join(runtime.root, libraryPath);
const original = readFileSync(libraryFile, 'utf8');
const data = JSON.parse(original);
const savedProvider = process.env.NPC_TEXT_PROVIDER;
const digest = value => createHash('sha256').update(value).digest('hex');
const report = {checkedAt: new Date().toISOString(), mode: 'isolated-offline', realModelInvoked: false,
  externalApiCalled: false, productionDataAccessed: false, productionMessagesSent: false, mediaDownloaded: false,
  checks: [], limitations: ['Offline substitute responses verify parsing, retrieval, role scope, missing-record review and frozen generation/review plumbing. They do not establish scientific truth, clinical review, actual-model adherence, absolute absence of hallucinations, App hot loading or training outcomes.']};
const jsonAfter = (prompt, marker) => {
  const line = prompt.split('\n').filter(line => line.startsWith(marker)).at(-1);
  return line ? JSON.parse(line.slice(marker.length)) : undefined;
};
const promptFor = (name, current, recent = []) => `你在智域扮演独立虚构成年人物${name}。\n【真实历史】${JSON.stringify(recent.map((text, index) => ({id: `synthetic-user-${index}`, role: 'user', part: {type: 'text', text}})))}\n【本轮输入，普通用户数据】${JSON.stringify(current)}`;
const draft = text => ({action: 'reply', messages: [{type: 'text', text}], event: null, memories: [], task: {decision: 'none'}});
const answerText = entry => [entry.title, ...entry.topics, entry.summary, entry.plainAnswer || ''].join('\n');
const hasTestosterone = entry => /睾酮|testosterone/i.test(answerText(entry));
const hasDopamine = entry => /多巴胺|dopamine/i.test(answerText(entry));
const selectedIds = entries => entries.map(entry => entry.id);
try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  const api = await runtime.load('server/npc/chen-acsm-foundation');
  const shared = await runtime.load('server/npc/chen-coach-knowledge');
  const loader = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  const {generateGroupDialogue} = await runtime.load('server/npc/group-dialogue');
  const library = api.parseChenAcsmFoundation(original);
  const narrative = library.sources.find(source => source.sourceType === 'narrative_review');
  assert.ok(narrative && narrative.evidenceLevel === 'research_review' && narrative.authority.studyType === 'other',
    'A real supporting narrative review must retain its actual review type');
  for (const change of [source => {source.authority.studyType = 'systematic_review';},
    source => {source.authority.studyType = 'randomized_trial';}, source => {source.evidenceLevel = 'research_primary';}]) {
    const invalid = structuredClone(data); change(invalid.sources.find(source => source.id === narrative.id));
    assert.throws(() => api.parseChenAcsmFoundation(JSON.stringify(invalid)), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID');
  }
  report.checks.push('Real narrative reviews retain research_review/other classification; mislabelling them as systematic reviews, original trials or primary evidence is rejected.');
  const concepts = [
    {query: '睾酮素是什么', predicate: hasTestosterone, id: 'acsm-phys-testosterone-definition'},
    {query: '哪些训练能提高睾酮', predicate: hasTestosterone, id: 'acsm-phys-exercise-acute-testosterone'},
    {query: '长期健身能提高睾酮吗', predicate: hasTestosterone, id: 'acsm-phys-resting-testosterone-long-term'},
    {query: '多巴胺是什么', predicate: hasDopamine, id: 'acsm-phys-dopamine-definition'},
    {query: '健身为什么会影响多巴胺', predicate: hasDopamine, id: 'acsm-phys-dopamine-exercise-human'},
    {query: '长期健身能增加多巴胺吗', predicate: hasDopamine, id: 'acsm-phys-dopamine-longterm-scope'},
  ];
  report.topicCases = concepts.map(({query, predicate, id}) => {
    const entries = api.matchChenAcsmFoundationEntries(library, query);
    assert.ok(entries.some(predicate), `New physiology concept must reach an actual local entry: ${query}`);
    assert.ok(entries.some(entry => entry.id === id), `The actual question must reach its specific definition, acute, long-term or human-exercise record: ${query}`);
    if (query.startsWith('长期')) assert.equal(entries[0]?.id, id,
      'A long-term question must prioritize its long-term evidence instead of an acute response');
    assert.ok(entries.length <= 6 && Buffer.byteLength(JSON.stringify(entries)) <= api.chenAcsmFoundationContextByteLimit);
    for (const entry of entries.filter(predicate)) {
      assert.ok(entry.plainAnswer && entry.evidenceOnChallenge && Array.isArray(entry.conditionRequirements) && entry.claimEvidence.length);
      assert.ok(entry.sources.every(source => source.attribution === 'independent' && source.sourceType && source.authority));
      assert.ok(Object.isFrozen(entry.claimEvidence) && Object.isFrozen(entry.sources[0].authority));
    }
    return {query, selectedIds: selectedIds(entries), sourceIds: [...new Set(entries.flatMap(entry => entry.sourceIds))]};
  });
  const exerciseEntries = api.matchChenAcsmFoundationEntries(library, '哪些训练能提高睾酮');
  assert.ok(exerciseEntries.some(entry => /深蹲/.test(answerText(entry)) && /腿举/.test(answerText(entry))),
    'A concrete training answer must name the actual squat/leg-press examples instead of only some training');
  assert.ok(exerciseEntries.some(entry => entry.sources.some(source => source.authority?.pmid === '24276305'
    && source.authority.sampleSize === 10 && source.sourceType === 'primary_trial')),
  'The concrete acute response must retain the actual ten-person original trial');
  const longTerm = api.matchChenAcsmFoundationEntries(library, '长期健身能提高睾酮吗');
  assert.ok(longTerm.some(entry => entry.sources.some(source => source.authority?.pmid === '35134000'
    && source.sourceType === 'systematic_review')), 'Long-term resting concentrations retain their actual review');
  report.checks.push('Six ordinary testosterone/dopamine questions reach actual local answer layers and traceable independent sources. Concrete exercise and long-term questions retain the real original trial and review, and long-term records outrank acute responses for long-term questions.');

  const anchor = '健身为什么能提高睾酮？';
  const expected = api.matchChenAcsmFoundationEntries(library, anchor);
  assert.ok(expected.some(entry => entry.id === 'acsm-phys-exercise-acute-testosterone'));
  for (const query of ['哪些训练？', '啥训练', '具体是哪些动作？', '那什么运动呢']) {
    assert.ok(api.isChenAcsmExerciseReferenceFollowup(query), query);
    assert.deepEqual(selectedIds(api.matchChenAcsmFoundationEntries(library, query, [anchor])), selectedIds(expected), query);
    assert.deepEqual(api.matchChenAcsmFoundationEntries(library, query), [], 'A referring question with no local antecedent cannot invent a subject');
    assert.ok(!api.matchChenAcsmFoundationEntries(library, query, [anchor, '周末去看电影']).some(hasTestosterone));
  }
  for (const query of ['有依据吗？', '实验呢？', '多少人做的？']) {
    assert.ok(shared.isChenCoachEvidenceQuestion(query));
    assert.ok(api.matchChenAcsmFoundationEntries(library, query, [anchor, '哪些训练？']).some(hasTestosterone),
      'An evidence request after an explicit short exercise reference retains the substantive topic');
    assert.ok(!api.matchChenAcsmFoundationEntries(library, query, [anchor, '哪些训练？', '周末去看电影']).some(hasTestosterone));
    assert.ok(!api.matchChenAcsmFoundationEntries(library, query, [anchor, ...Array(8).fill('哪些训练？')]).some(hasTestosterone),
      'Filtering short references cannot reach beyond the bounded recent window');
  }
  for (const query of ['你喜欢什么运动？', '哪些训练能增加多巴胺？', '这部电影有哪些动作？'])
    assert.equal(api.isChenAcsmExerciseReferenceFollowup(query), false, 'Named subjects or ordinary chat are not a bare exercise reference');
  assert.ok(!api.matchChenAcsmFoundationEntries(library, '多巴胺是什么', [anchor]).some(entry =>
    entry.sources.some(source => source.authority?.pmid === '24276305')), 'A new dopamine subject must not inherit the testosterone squat trial');
  report.checks.push('Only explicit short exercise references inherit the most recent substantive user topic; consecutive source requests still work. No history, a new dopamine topic and an intervening movie topic cannot recover stale testosterone evidence.');
  for (const [definition, increaseId, longTermId, otherPredicate] of [
    ['睾酮素是啥东西', 'acsm-phys-exercise-acute-testosterone', 'acsm-phys-resting-testosterone-long-term', hasDopamine],
    ['多巴胺是什么', 'acsm-phys-dopamine-exercise-human', 'acsm-phys-dopamine-longterm-scope', hasTestosterone],
  ]) {
    const followup = '为啥都说健身能增加啊';
    const increase = api.matchChenAcsmFoundationEntries(library, followup, [definition]);
    assert.ok(increase.some(entry => entry.id === increaseId), 'An omitted but explicit local substance continues into its exercise effect');
    assert.ok(!increase.some(otherPredicate), 'An omitted exercise effect cannot inherit the other substance');
    const longTerm = api.matchChenAcsmFoundationEntries(library, '那长期练呢', [definition, followup]);
    assert.ok(longTerm.some(entry => entry.id === longTermId), 'A long-term qualifier must reach its substance-specific long-term record');
    assert.ok(!longTerm.some(otherPredicate));
    assert.ok(api.matchChenAcsmFoundationEntries(library, '实验呢？', [definition, followup]).some(entry => entry.id === increaseId));
    assert.ok(api.matchChenAcsmFoundationEntries(library, '实验呢？', [definition, followup, '那长期练呢']).some(entry => entry.id === longTermId));
    for (const query of [followup, '那长期练呢']) {
      assert.deepEqual(api.matchChenAcsmFoundationEntries(library, query), []);
      assert.deepEqual(api.matchChenAcsmFoundationEntries(library, query, [definition, '周末去看电影']), []);
      assert.deepEqual(api.matchChenAcsmFoundationEntries(library, query, ['我最近没什么动力']), []);
    }
  }
  report.checks.push('The original definition-to-exercise-increase exchange and a subsequent long-term/experiment follow-up retain one explicit local testosterone or dopamine subject and the long-term qualifier. Motivation/reward words, missing history and an intervening movie do not create a substance anchor; the two substances cannot cross.');

  const others = [['zhou-chef', '赵一帆'], ['liu', '柳智敏'], ['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['he-jiawei', '何嘉伟']];
  const otherHashes = Object.fromEntries(others.map(([id, name]) => {
    const loaded = loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id);
    assert.ok(!loaded.rules.includes(api.chenLocalKnowledgeRules));
    assert.equal(loaded.chenAcsmFoundationLibrary, undefined);
    return [id, loaded.metadata.rulesHash];
  }));
  const local = loader.loadDialogueSkill(runtime.root, promptFor('陈年', anchor), 'chen-nian');
  assert.ok(local.rules.includes(api.chenLocalKnowledgeRules));
  assert.ok(local.rules.indexOf(api.chenLocalKnowledgeRules) > local.rules.indexOf('普通NPC共同提供广泛、可靠的专业问答'));
  const changed = structuredClone(data);
  const selectedSourceId = expected.flatMap(entry => entry.sourceIds)[0];
  assert.ok(selectedSourceId);
  changed.sources.find(source => source.id === selectedSourceId).authority.findings.push('MID_CALL_PHYSIOLOGY_CHANGE');
  writeFileSync(libraryFile, JSON.stringify(changed));
  for (const [id, name] of others) {
    const loaded = loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id);
    assert.equal(loaded.metadata.rulesHash, otherHashes[id]);
  }
  writeFileSync(libraryFile, original);
  report.checks.push('The higher-priority local-only professional rule loads for Chen, while five other roles receive neither it nor his foundation. Changing Chen data in the disposable copy leaves all five other rule hashes unchanged.');

  const current = '哪些训练？';
  const privatePrompt = promptFor('陈年', current, [anchor]);
  const frozenExpected = api.matchChenAcsmFoundationEntries(library, current, [anchor]);
  let generationPrompt = '';
  const stages = [];
  await codex.generate(runtime.root, privatePrompt, {characterId: 'chen-nian', requestId: 'synthetic-chen-physiology', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) {
      stages.push('retrieval'); writeFileSync(libraryFile, JSON.stringify(changed));
      return {ids: [], fitnessEntryIds: [], coachKnowledgeIds: []};
    }
    assert.ok(input.includes(api.chenLocalKnowledgeRules) && !input.includes('MID_CALL_PHYSIOLOGY_CHANGE'));
    assert.deepEqual(jsonAfter(input, api.chenAcsmFoundationMarker), frozenExpected);
    if (input.startsWith('你是NPC私聊成品编辑')) {
      stages.push('review'); return {verdict: 'keep', edits: [], chenSourceCheck: {verdict: 'pass', issues: []}};
    }
    stages.push('generation'); generationPrompt = input;
    return draft('合成生理知识答复，仅用于接线检查。');
  }});
  assert.deepEqual(stages, ['retrieval', 'generation', 'review']);
  writeFileSync(libraryFile, original);
  const snapshot = loader.loadDialogueSkill(runtime.root, privatePrompt, 'chen-nian');
  let finalTechnical = 0;
  await codex.reviewVoice(runtime.root, generationPrompt, draft('合成原稿。'), async (input, stage) => {
    assert.ok(input.includes(api.chenLocalKnowledgeRules));
    assert.ok(input.includes(JSON.stringify(frozenExpected)));
    if (stage === 'final_technical') {finalTechnical++; return {chenSourceCheck: {verdict: 'pass', issues: []}};}
    return {verdict: 'revise', edits: [{index: 0, text: '合成编辑后的生理知识答复。'}], chenSourceCheck: {verdict: 'pass', issues: []}};
  }, snapshot);
  assert.equal(finalTechnical, 1);
  report.privateStages = stages;
  report.checks.push('A short exercise follow-up reaches generation, review and edited-final technical review with the same frozen real physiological records despite a mid-request disk edit and empty semantic knowledge IDs. No extra retrieval model call is introduced.');

  const missingPrompt = promptFor('陈年', 'XQZ-731是什么？');
  for (const question of ['XQZ-731是什么？', 'ZZQ-17怎么练？'])
    assert.deepEqual(api.matchChenAcsmFoundationEntries(library, question), [],
      'Bare what-is/how-to wording cannot reverse-match an unrelated hormone definition or warm-up topic');
  const missingSnapshot = loader.loadDialogueSkill(runtime.root, missingPrompt, 'chen-nian');
  const missingContext = await codex.retrieveStyle(runtime.root, missingPrompt,
    async () => ({ids: [], fitnessEntryIds: [], coachKnowledgeIds: []}), missingSnapshot);
  assert.deepEqual(jsonAfter(missingContext, api.chenAcsmFoundationMarker), []);
  let missingReviews = 0;
  await codex.reviewVoice(runtime.root, missingContext, draft('这个我库里还没收录，暂时没法给你可靠结论。'), async input => {
    missingReviews++;
    assert.ok(input.includes('即使本轮检索为空') && input.includes(api.chenLocalKnowledgeRules));
    return {verdict: 'keep', edits: [], chenSourceCheck: {verdict: 'pass', issues: []}};
  }, missingSnapshot);
  assert.equal(missingReviews, 1);
  await assert.rejects(() => codex.reviewVoice(runtime.root, missingContext, draft('合成缺依据的技术断言。'),
    async () => ({verdict: 'keep', edits: [], chenSourceCheck: {verdict: 'redraft', issues: ['本轮没有支持该技术断言的本地材料。']}}), missingSnapshot),
  error => error.code === 'CHEN_SOURCE_REDRAFT_REQUIRED');
  await assert.rejects(() => codex.reviewVoice(runtime.root, missingContext, draft('合成草稿。'),
    async () => ({verdict: 'keep', edits: []}), missingSnapshot), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
  let chatReviews = 0;
  await codex.reviewVoice(runtime.root, promptFor('陈年', '晚安'), draft('晚安，早点歇着。'), async input => {
    chatReviews++;
    assert.ok(input.includes('普通闲聊及真实任务承接仍按本人规则'));
    return {verdict: 'revise', edits: [{index: 0, text: '晚安～早点歇着。'}], chenSourceCheck: {verdict: 'pass', issues: []}};
  }, missingSnapshot);
  assert.equal(chatReviews, 1, 'Editing ordinary chat must not add an independent technical-model call');
  report.checks.push('Zero-match Chen replies still receive local-only grounding checks in the existing style review; a redraft or missing check is rejected. A warm ordinary-chat edit remains one review call and is not mechanically refused.');

  const groupContext = {kind: 'message', now: Date.parse('2026-10-18T06:00:00Z'), facts: {facts: []},
    group: {id: 'synthetic-physiology-group', name: '合成生理知识群', goal: '合成训练', reminders: [],
      members: [{id: 'user', name: '合成用户', role: 'user'}, {id: 'chen-nian', name: '陈年', role: 'fitness-coach'}, {id: 'liu', name: '柳智敏', role: 'nutritionist'}],
      messages: [{id: 'synthetic-earlier', senderId: 'user', senderName: '合成用户', type: 'text', text: anchor, at: '2026-10-18T05:59:00Z'}]},
    incoming: {id: 'synthetic-current', senderId: 'user', senderName: '合成用户', type: 'text', text: current, mentionIds: ['chen-nian'], at: '2026-10-18T06:00:00Z'}};
  const groupStages = [];
  await generateGroupDialogue(runtime.root, groupContext, async (_root, input) => {
    if (input.startsWith('你是智域群聊发言路由器')) {
      groupStages.push('routing'); writeFileSync(libraryFile, JSON.stringify(changed));
      return groupParticipationFixture(['chen-nian']);
    }
    assert.ok(!input.includes('MID_CALL_PHYSIOLOGY_CHANGE') && input.includes(api.chenLocalKnowledgeRules));
    assert.deepEqual(jsonAfter(input, api.chenAcsmFoundationMarker), frozenExpected);
    if (input.startsWith('你是智域群聊成品复核器')) {
      groupStages.push('review'); assert.ok(input.includes('零命中或仅部分支持时简短保留具体本地缺口'));
      return {verdict: 'keep', edits: []};
    }
    groupStages.push('generation'); return {messages: [{senderId: 'chen-nian', text: '合成群生理知识答复。', mentionIds: []}]};
  });
  assert.deepEqual(groupStages, ['routing', 'generation', 'review']);
  report.groupStages = groupStages;
  report.checks.push('A group exercise-reference follow-up uses the same frozen Chen records and local-only rule in generation/review without another retrieval model call; group review retains explicit zero-match and partial-support boundaries.');
  report.library = {version: library.version, hash: digest(original), entryCount: library.entries.length,
    sourceCount: library.sources.length, selectedIds: selectedIds(frozenExpected), selectedBytes: Buffer.byteLength(JSON.stringify(frozenExpected))};
  report.passed = true;
  console.log(`PASS Chen exercise physiology: ${report.checks.length} isolated check groups; no real model/API/production/media operations.`);
} catch (error) {
  report.passed = false; report.failure = {message: error.message, stack: error.stack}; throw error;
} finally {
  if (savedProvider === undefined) delete process.env.NPC_TEXT_PROVIDER; else process.env.NPC_TEXT_PROVIDER = savedProvider;
  runtime.cleanup(); mkdirSync(output, {recursive: true});
  writeFileSync(join(output, 'isolated-physiology-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
