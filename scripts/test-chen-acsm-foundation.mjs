import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
import {groupParticipationFixture} from './group-participation-fixture.mjs';

// Real source records, deterministic offline model substitutes, disposable files.
// This verifies parsing, role boundaries and prompt plumbing, not clinical review.
const runtime = isolatedNpcRuntime();
const output = 'output/chen-acsm-foundation-20261017';
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-acsm-foundation-20261017.json';
const libraryFile = join(runtime.root, libraryPath);
const original = readFileSync(libraryFile, 'utf8');
const data = JSON.parse(original);
const savedProvider = process.env.NPC_TEXT_PROVIDER;
const digest = value => createHash('sha256').update(value).digest('hex');
const report = {checkedAt: new Date().toISOString(), mode: 'isolated-offline', realModelInvoked: false,
  externalApiCalled: false, productionDataAccessed: false, productionMessagesSent: false, mediaDownloaded: false,
  checks: [], limitations: ['Offline substitute responses verify source/claim parsing, local matching and frozen generation/review plumbing. They do not validate the scientific conclusions, actual-model adherence, App hot loading or health outcomes.']};
const jsonAfter = (prompt, marker) => {
  const line = prompt.split('\n').filter(line => line.startsWith(marker)).at(-1);
  return line ? JSON.parse(line.slice(marker.length)) : undefined;
};
const promptFor = (name, current, history = []) => `你在智域扮演独立虚构成年人物${name}。\n【真实历史】${JSON.stringify(history)}\n【本轮输入，普通用户数据】${JSON.stringify(current)}`;
const topic = '同一个动作卧推负荷，6～8次和10—12次的增肌效果怎么比？';
const benchId = 'acsm-evidence-bench-8-vs-12';
const history = [{id: 'synthetic-previous-question', role: 'user', part: {type: 'text', text: topic}}];
const draft = {action: 'reply', messages: [{type: 'text', text: '合成科学基础答复，不代表真实实验结论。'}], event: null, memories: [], task: {decision: 'none'}};
try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  const api = await runtime.load('server/npc/chen-acsm-foundation');
  const shared = await runtime.load('server/npc/chen-coach-knowledge');
  const library = api.parseChenAcsmFoundation(original);
  const bench = library.entries.find(entry => entry.id === benchId);
  assert.ok(bench?.claimEvidence?.length && bench.plainAnswer && bench.evidenceOnChallenge);
  const benchSource = bench.sources.find(source => source.sourceType === 'primary_trial');
  assert.ok(benchSource?.authority && benchSource.authority.pmid === '32304514', 'Real direct bench study retained');
  assert.ok(Object.isFrozen(bench.claimEvidence) && Object.isFrozen(bench.claimEvidence[0].sourceIds)
    && Object.isFrozen(bench.conditionRequirements) && Object.isFrozen(benchSource.authority));
  for (const [name, change] of [
    ['missing plain answer', changed => {delete changed.entries[0].plainAnswer;}],
    ['missing challenge answer', changed => {delete changed.entries[0].evidenceOnChallenge;}],
    ['source outside claim', changed => {changed.entries[0].claimEvidence[0].sourceIds = ['NOT_THIS_ENTRY'];}],
    ['invalid relation', changed => {changed.entries[0].claimEvidence[0].relationship = 'always_correct';}],
    ['review mislabelled trial', changed => {const source = changed.sources.find(source => source.authority.studyType === 'meta_analysis'); source.sourceType = 'primary_trial';}],
    ['trial mislabelled guidance', changed => {changed.sources.find(source => source.sourceType === 'primary_trial').evidenceLevel = 'official_guidance';}],
    ['missing source type', changed => {delete changed.sources[0].sourceType;}],
    ['missing read scope', changed => {delete changed.sources[0].authority.accessLevel;}],
    ['wrong character', changed => {changed.characterId = 'zhou-chef';}],
    ['over budget single record', changed => {changed.entries[0].plainAnswer = 'x'.repeat(api.chenAcsmFoundationContextByteLimit);}],
  ]) {
    const changed = structuredClone(data); change(changed);
    assert.throws(() => api.parseChenAcsmFoundation(JSON.stringify(changed)), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID', name);
  }
  for (const sourceType of ['position_stand', 'clinical_guideline', 'expert_consensus', 'official_guidance']) {
    const changed = structuredClone(data);
    changed.sources.find(source => source.id === benchSource.id).sourceType = sourceType;
    assert.throws(() => api.parseChenAcsmFoundation(JSON.stringify(changed)), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID',
      `An original trial cannot be relabelled as ${sourceType}`);
  }
  const unknown = structuredClone(data);
  unknown.entries[0].claimEvidence[0].instruction = 'UNKNOWN_CLAIM_INSTRUCTION';
  unknown.sources[0].sourceInstruction = 'UNKNOWN_CLAIM_INSTRUCTION';
  assert.ok(!JSON.stringify(api.parseChenAcsmFoundation(JSON.stringify(unknown))).includes('UNKNOWN_CLAIM_INSTRUCTION'));
  assert.throws(() => api.selectChenAcsmFoundationEntries(library, [benchId, benchId]), error => error.code === 'CHEN_COACH_SELECTION_INVALID');
  assert.throws(() => api.matchChenAcsmFoundationEntries(library, topic, [], 7), error => error.code === 'CHEN_COACH_SELECTION_INVALID');
  for (const query of ['6~8和10~12', '6～8和10～12', '6—8和10—12', '6–8和10–12', '6 到 8 和 10 至 12', '六到八和十到十二'])
    assert.ok(api.matchChenAcsmFoundationEntries(library, query).some(entry => entry.id === benchId), query);
  report.checks.push('Real foundation source types, complete answer layers, claim-to-source subsets and reading scopes are validated and deeply frozen. Invalid or over-budget records fail closed; unknown fields cannot become instructions. Six rep-range spellings reach the actual bench trial.');

  const sourceQuestions = ['有依据吗？', '有数据支持吗？', '研究表明什么呢？', '论文呢？', '数据呢？', '怎么证明？', '给我论文',
    '实验呢？', '有实验支持吗？', '有研究支撑吗？', '多少人做的？', '分了几组？', '对照组是什么？', '训练了多久得出来的？', '实验几人？'];
  for (const question of sourceQuestions) {
    assert.ok(shared.isChenCoachEvidenceQuestion(question), question);
    const selected = api.matchChenAcsmFoundationEntries(library, question, [topic]);
    assert.ok(selected.some(entry => entry.id === benchId), question);
    assert.ok(selected.length <= 6 && Buffer.byteLength(JSON.stringify(selected)) <= api.chenAcsmFoundationContextByteLimit);
  }
  const dailyMessages = ['手机数据丢了', '准备研究一下明天去哪看电影', '我去实验室上班', '实验数据文件丢了'];
  for (const message of dailyMessages) {
    assert.equal(shared.isChenCoachEvidenceQuestion(message), false, message);
    assert.ok(!api.matchChenAcsmFoundationEntries(library, message, [topic]).some(entry => entry.id === benchId), message);
  }
  for (const [message, recent] of [
    ['有依据吗？', []], ['有依据吗？', [topic, '周末去看电影']],
    ['这部电影的研究有数据支持吗？', [topic]], ['实验呢？', [topic, '我去实验室上班']],
    ['有依据吗？', [topic, '这部电影的研究有数据支持吗？']],
  ]) assert.ok(!api.matchChenAcsmFoundationEntries(library, message, recent).some(entry => entry.id === benchId));
  report.sourceFollowupQuestions = sourceQuestions;
  report.dailyNegativeCases = dailyMessages;
  report.checks.push('Fifteen source/data/experiment follow-ups preserve the current exercise topic. New movie/phone/laboratory subjects, missing history and stale prior training cannot revive bench evidence; every match stays within six whole records and the byte budget.');

  const topicCases = [
    {topic: '练前热身怎么做', followup: '实验几人？', id: 'acsm-foundation-warmup-purpose', sourceId: 'acsm-ribeiro-specific-warmup-2020', primary: true, sampleSize: 40, design: ['26/14', '随机顺序', '48']},
    {topic: '肩痛康复怎么练', followup: '实验呢？', id: 'acsm-foundation-rotator-active-rehab', sourceId: 'acsm-desmeules-rotator-cpg-2025', primary: false},
    {topic: '肩袖肌腱病康复', followup: '有研究支撑吗？', id: 'acsm-foundation-rotator-active-rehab', sourceId: 'acsm-desmeules-rotator-cpg-2025', primary: false},
    {topic: '腰痛好了怎么减少复发', followup: '对照组是什么？', id: 'acsm-foundation-lowback-walking-recurrence', sourceId: 'acsm-pocovi-walkback-2024', primary: true, sampleSize: 701, design: ['351', '350']},
    {topic: '膝前痛怎么康复', followup: '有依据吗？', id: 'acsm-foundation-pfp-hip-and-knee', sourceId: 'acsm-ferber-hip-knee-pfp-2015', primary: true, sampleSize: 199, design: ['111', '88', '146']},
    {topic: '练完冷身能预防酸痛吗', followup: '多少人做的？', id: 'acsm-foundation-cooldown-not-doms-cure', sourceId: 'acsm-law-warmup-cooldown-doms-2007', primary: true, sampleSize: 52, design: ['13', '析因', '48']},
  ];
  report.topicCases = topicCases.map(test => {
    for (const selected of [api.matchChenAcsmFoundationEntries(library, test.topic),
      api.matchChenAcsmFoundationEntries(library, test.followup, [test.topic])]) {
      assert.ok(selected.some(entry => entry.id === test.id), `${test.topic} -> ${test.followup}`);
      assert.notEqual(selected[0]?.id, 'acsm-evidence-answering-citations', 'A generic citation policy cannot outrank an actually matched anatomy or movement');
      assert.ok(!selected.some(entry => entry.id === benchId || entry.sources.some(source => source.authority?.pmid === '32304514')),
        'A different anatomy/rehabilitation topic must not be supported with a bench hypertrophy trial');
    }
    const entry = library.entries.find(entry => entry.id === test.id);
    const source = entry.sources.find(source => source.id === test.sourceId);
    assert.ok(source?.authority);
    if (test.primary) {
      assert.equal(source.sourceType, 'primary_trial');
      assert.equal(source.authority.sampleSize, test.sampleSize);
      for (const fact of test.design) assert.ok(source.authority.comparison.includes(fact), `Verified design retained: ${test.sourceId} ${fact}`);
    }
    else {
      assert.equal(source.sourceType, 'clinical_guideline');
      assert.equal(source.authority.sampleSize, null, 'A clinical guideline is not assigned a fabricated trial sample');
      assert.ok(entry.conditionRequirements.some(condition => /确诊|临床评估/.test(condition)));
    }
    return {...test, selectedIds: api.matchChenAcsmFoundationEntries(library, test.followup, [test.topic]).map(entry => entry.id),
      actualSourceType: source.sourceType, sampleSize: source.authority.sampleSize};
  });
  for (const message of ['康复', '康复训练', '康复训练怎么做', '我想做康复训练']) {
    for (const selected of [api.matchChenAcsmFoundationEntries(library, message),
      api.matchChenAcsmFoundationEntries(library, '有依据吗？', [message])])
      assert.deepEqual(selected.map(entry => entry.id), ['acsm-rehab-assessment-first'], 'An unspecified rehabilitation request must start with assessment, not imply a diagnosed body part');
  }
  report.checks.push('Warm-up, shoulder, recurrent low-back, anterior knee pain and cooldown questions reach their own evidence and conditions. Actual group/sample/follow-up designs remain available (40; 701/351/350; 199/111/88; 52/four groups/13/48h), no bench trial is reused, and unspecified rehabilitation starts with assessment.');

  const loader = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  const {generateGroupDialogue} = await runtime.load('server/npc/group-dialogue');
  const others = [['zhou-chef', '赵一帆'], ['liu', '柳智敏'], ['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['he-jiawei', '何嘉伟']];
  const otherHashes = Object.fromEntries(others.map(([id, name]) => [id, loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id).metadata.rulesHash]));
  const chen = loader.loadDialogueSkill(runtime.root, promptFor('陈年', topic), 'chen-nian');
  assert.equal(chen.chenAcsmFoundationLibrary.version, library.version);
  assert.ok(chen.metadata.sources.some(source => source.path.endsWith('/' + api.chenAcsmFoundationFile) && source.sha256 === digest(original)));
  unlinkSync(libraryFile);
  const withoutNewLibrary = loader.loadDialogueSkill(runtime.root, promptFor('陈年', topic), 'chen-nian');
  assert.ok(withoutNewLibrary.chenCoachKnowledgeLibrary && withoutNewLibrary.chenAcsmFoundationLibrary === undefined,
    'A legacy directory without this optional increment keeps existing Chen knowledge');
  writeFileSync(libraryFile, original);
  for (const [id, name] of others) {
    const loaded = loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id);
    assert.equal(loaded.metadata.rulesHash, otherHashes[id]);
    assert.equal(loaded.chenAcsmFoundationLibrary, undefined);
    assert.ok(!loaded.metadata.sources.some(source => source.path.endsWith('/' + api.chenAcsmFoundationFile)));
  }
  report.checks.push('The actual local foundation loads only for Chen with its source hash; five other roles receive neither rules nor library. A legacy directory without the increment retains previous Chen behavior.');

  const privatePrompt = promptFor('陈年', '有依据吗？', history);
  const expected = api.matchChenAcsmFoundationEntries(library, '有依据吗？', [topic]);
  const stages = []; let generationPrompt = '';
  await codex.generate(runtime.root, privatePrompt, {characterId: 'chen-nian', requestId: 'synthetic-chen-acsm-foundation', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) {
      stages.push('retrieval');
      const changed = structuredClone(data); changed.sources.find(source => source.id === benchSource.id).authority.findings = ['MID_CALL_ACSM_CHANGE'];
      writeFileSync(libraryFile, JSON.stringify(changed));
      return {ids: [], fitnessEntryIds: [], coachKnowledgeIds: []};
    }
    assert.ok(!input.includes('MID_CALL_ACSM_CHANGE'));
    assert.ok(input.includes(api.chenAcsmFoundationRules));
    if (input.startsWith('你是NPC私聊成品编辑')) {
      stages.push('review'); assert.ok(input.includes(JSON.stringify(expected)));
      return {verdict: 'keep', edits: [], chenSourceCheck: {verdict: 'pass', issues: []}};
    }
    stages.push('generation'); generationPrompt = input;
    assert.deepEqual(jsonAfter(input, api.chenAcsmFoundationMarker), expected);
    return structuredClone(draft);
  }});
  assert.deepEqual(stages, ['retrieval', 'generation', 'review']);
  const changedSnapshot = loader.loadDialogueSkill(runtime.root, privatePrompt, 'chen-nian');
  assert.ok(changedSnapshot.chenAcsmFoundationLibrary.sources.find(source => source.id === benchSource.id).authority.findings.includes('MID_CALL_ACSM_CHANGE'));
  writeFileSync(libraryFile, original);
  const frozen = loader.loadDialogueSkill(runtime.root, privatePrompt, 'chen-nian');
  const forged = structuredClone(expected); forged[0].plainAnswer = 'FORGED_SCIENCE';
  await assert.rejects(() => codex.reviewVoice(runtime.root, privatePrompt + '\n' + api.chenAcsmFoundationMarker + JSON.stringify(forged), draft,
    async () => {throw Error('Must reject modified science before review runner');}, frozen), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
  let finalChecks = 0;
  await codex.reviewVoice(runtime.root, generationPrompt, draft, async (input, kind) => {
    assert.ok(input.includes(api.chenAcsmFoundationRules) && input.includes(JSON.stringify(expected)));
    if (kind === 'final_technical') {finalChecks++; return {chenSourceCheck: {verdict: 'pass', issues: []}};}
    return {verdict: 'revise', edits: [{index: 0, text: '合成编辑后答复，仍非真实实验结论。'}], chenSourceCheck: {verdict: 'pass', issues: []}};
  }, frozen);
  assert.equal(finalChecks, 1);
  report.privateStages = stages;
  report.checks.push('Local deterministic selection reaches generation despite empty semantic IDs. Generation, initial review and edited final technical review use one frozen real source/claim snapshot; mid-call disk edits are delayed until the next request and forged answer layers are rejected.');

  // Ordinary answers receive the same material with the explicit instruction to
  // use plainAnswer first, and do not trigger an extra source-retrieval model.
  const ordinaryPrompt = promptFor('陈年', topic);
  const ordinary = await codex.retrieveStyle(runtime.root, ordinaryPrompt,
    async () => ({ids: [], fitnessEntryIds: [], coachKnowledgeIds: []}), loader.loadDialogueSkill(runtime.root, ordinaryPrompt, 'chen-nian'));
  assert.ok(jsonAfter(ordinary, api.chenAcsmFoundationMarker).some(entry => entry.id === benchId));
  assert.ok(ordinary.includes('普通提问先用plainAnswer清楚回答') && ordinary.includes('用户质疑、索据或要求数据时'));
  report.checks.push('Ordinary topical questions receive the local plain-answer layer with an explicit normal-answer-first rule; detailed source data are reserved by instruction for challenge/source requests. This is prompt plumbing, not a real-model style acceptance.');

  const members = [{id: 'user', name: '合成用户', role: 'user'}, {id: 'chen-nian', name: '陈年', role: 'fitness-coach'}, {id: 'liu', name: '柳智敏', role: 'nutritionist'}];
  const context = {kind: 'message', now: Date.parse('2026-10-17T06:00:00Z'), facts: {facts: []},
    group: {id: 'synthetic-acsm-group', name: '合成科学基础群', goal: '合成训练', members, reminders: [], messages: [
      {id: 'synthetic-earlier', senderId: 'user', senderName: '合成用户', type: 'text', text: topic, at: '2026-10-17T05:59:00Z'},
    ]}, incoming: {id: 'synthetic-current', senderId: 'user', senderName: '合成用户', type: 'text', text: '有依据吗？', mentionIds: ['chen-nian'], at: '2026-10-17T06:00:00Z'}};
  const groupInputs = [];
  await generateGroupDialogue(runtime.root, context, async (_root, input) => {
    groupInputs.push(input);
    if (input.startsWith('你是智域群聊发言路由器')) {
      const changed = structuredClone(data); changed.sources.find(source => source.id === benchSource.id).authority.findings = ['MID_GROUP_ACSM_CHANGE'];
      writeFileSync(libraryFile, JSON.stringify(changed));
      return groupParticipationFixture(['chen-nian']);
    }
    assert.ok(!input.includes('MID_GROUP_ACSM_CHANGE'));
    assert.deepEqual(jsonAfter(input, api.chenAcsmFoundationMarker), expected);
    assert.ok(input.includes(api.chenAcsmFoundationRules));
    const liuBlock = input.split('【人物liu当前Skill')[1]?.split('【当前群规则优先于私聊推进和旧能力限制】')[0]
      ?.split('【本轮同一冻结群规则】')[0];
    assert.ok(liuBlock && !liuBlock.includes(api.chenAcsmFoundationMarker) && !liuBlock.includes(benchId));
    return input.startsWith('你是智域群聊成品复核器') ? {verdict: 'keep', edits: []}
      : {messages: [{senderId: 'chen-nian', text: '合成群科学依据答复。', mentionIds: []}]};
  });
  assert.equal(groupInputs.length, 3);
  report.checks.push('Same-group source follow-ups use the group’s recent user topic and the same frozen source/claim snapshot for routing, generation and review. A different role’s own block does not receive Chen’s foundation.');
  writeFileSync(libraryFile, original);
  const editedGroupText = '合成群科学依据的编辑后答复。';
  for (const verdict of ['pass', 'redraft']) {
    let finalChecks = 0;
    const runEditedGroup = () => generateGroupDialogue(runtime.root, context, async (_root, input) => {
      if (input.startsWith('你是智域群聊发言路由器')) return groupParticipationFixture(['chen-nian']);
      if (input.startsWith('你是智域群聊陈年科学依据终检器')) {
        finalChecks++;
        assert.ok(input.includes(JSON.stringify(expected)) && input.includes(editedGroupText));
        return {verdict, issues: verdict === 'pass' ? [] : ['Synthetic final technical rejection.']};
      }
      if (input.startsWith('你是智域群聊成品复核器')) return {verdict: 'revise', edits: [{index: 0, text: editedGroupText}]};
      assert.deepEqual(jsonAfter(input, api.chenAcsmFoundationMarker), expected);
      return {messages: [{senderId: 'chen-nian', text: '合成群科学依据答复。', mentionIds: []}]};
    });
    if (verdict === 'pass') assert.equal((await runEditedGroup()).messages[0].text, editedGroupText);
    else await assert.rejects(runEditedGroup, /群聊陈年编辑后科学依据终检要求重写/);
    assert.equal(finalChecks, 1);
  }
  report.checks.push('Editing Chen’s group scientific answer triggers one final technical pass/redraft check with the same frozen records and actual edited text. A redraft is rejected before return; untouched group text keeps the original three-call path.');
  report.library = {version: library.version, hash: digest(original), entryCount: library.entries.length,
    sourceCount: library.sources.length, selectedIds: expected.map(entry => entry.id), verifiedBenchSourceId: benchSource.id,
    selectedBytes: Buffer.byteLength(JSON.stringify(expected)), byteLimit: api.chenAcsmFoundationContextByteLimit};
  report.passed = true;
  console.log(`PASS Chen scientific foundation: ${report.checks.length} isolated check groups; no real model/API/production/media operations.`);
} catch (error) {
  report.passed = false; report.failure = {message: error.message, stack: error.stack}; throw error;
} finally {
  if (savedProvider === undefined) delete process.env.NPC_TEXT_PROVIDER; else process.env.NPC_TEXT_PROVIDER = savedProvider;
  runtime.cleanup(); mkdirSync(output, {recursive: true});
  writeFileSync(join(output, 'isolated-code-wiring-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
