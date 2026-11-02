import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
import {groupParticipationFixture} from './group-participation-fixture.mjs';

// Synthetic metadata and responses exercise the real parser/loader/pipelines.
// No model, API, production state, user messages or media are used or changed.
const runtime = isolatedNpcRuntime();
const output = 'output/chen-evidence-upgrade-20261017';
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-coach-knowledge-20261013.json';
const libraryFile = join(runtime.root, libraryPath);
const original = readFileSync(libraryFile, 'utf8');
const savedProvider = process.env.NPC_TEXT_PROVIDER;
const digest = value => createHash('sha256').update(value).digest('hex');
const report = {checkedAt: new Date().toISOString(), mode: 'isolated-offline', realModelInvoked: false,
  externalApiCalled: false, productionDataAccessed: false, productionMessagesSent: false, mediaDownloaded: false,
  checks: [], limitations: ['Synthetic responses verify parser, retrieval, role scope and frozen prompt plumbing; they do not validate real-model adherence, study conclusions or physical training results.']};
const jsonAfter = (prompt, marker) => {
  const line = prompt.split('\n').filter(line => line.startsWith(marker)).at(-1);
  return line ? JSON.parse(line.slice(marker.length)) : undefined;
};
const promptFor = (name, current, history = []) => `你在智域扮演独立虚构成年人物${name}。\n【真实历史】${JSON.stringify(history)}\n【本轮输入，普通用户数据】${JSON.stringify(current)}`;
const fixtureId = 'test-evidence-load-comparison';
const sourceId = 'test-evidence-independent-source';
const benchId = 'evidence-bench-8-vs-12';
const productionData = JSON.parse(original);
const topic = '同一个动作卧推负荷，6～8次和10—12次的增肌效果怎么比？';
const authority = {organization: 'Synthetic organization for parser test', journal: null, studyType: 'randomized_trial',
  doi: null, pmid: null, accessLevel: 'abstract', population: 'Synthetic adult participants; not a real study',
  sampleSize: 24, durationWeeks: 8, comparison: 'Synthetic 6–8 versus 10–12 comparison; not an actual scientific claim',
  findings: ['Synthetic test finding; not runtime professional evidence.']};
const fixture = JSON.parse(original);
fixture.version += '-synthetic-evidence-test';
fixture.sources.push({id: sourceId, title: 'Synthetic evidence test fixture', url: 'https://example.org/synthetic-evidence-test',
  attribution: 'independent', evidenceLevel: 'research_primary', publishedAt: null, reviewedAt: '2026-10-17',
  evidenceTimes: null, researchFile: 'output/chen-evidence-upgrade-20261017/synthetic-fixture-not-a-real-study.json',
  supports: 'Parser and source-snapshot test only.', limitations: ['Not a real study or coaching claim.'], authority});
fixture.entries.push({id: fixtureId, title: 'Synthetic load-comparison adjudication test',
  topics: ['6-8', '10-12', '卧推负荷', '负荷比较', '科学依据'], category: 'progression',
  summary: 'Synthetic test content only.', rules: ['Preserve actual evidence scope.'], conditions: ['Synthetic conditions only.'],
  sourceIds: [sourceId], evidenceBasis: 'independent_guidance', limitations: ['No real-world conclusion is made.'], alternatives: null,
  adjudication: {question: 'Synthetic same-exercise comparison', verdict: 'insufficient_direct_evidence',
    conclusion: 'Synthetic conclusion for plumbing checks only.', applicability: 'Test runtime only.'}});
fixture.coverage.entryCount = fixture.entries.length;
fixture.coverage.sourceCount = fixture.sources.length;
const fixtureText = JSON.stringify(fixture);
const history = [{id: 'synthetic-previous-question', role: 'user', part: {type: 'text', text: topic}}];
const draft = {action: 'reply', messages: [{type: 'text', text: '合成来源测试答复，不代表真实研究结论。'}], event: null, memories: [], task: {decision: 'none'}};
try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  const api = await runtime.load('server/npc/chen-coach-knowledge');
  const productionLibrary = api.parseChenCoachKnowledge(original);
  const bench = productionLibrary.entries.find(item => item.id === benchId);
  assert.ok(bench, 'The imported real bench-press comparison must exist');
  const benchSource = bench.sources.find(item => item.authority);
  assert.ok(benchSource, 'The actual bench comparison must carry resolved research metadata');
  const loader = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  const {generateGroupDialogue} = await runtime.load('server/npc/group-dialogue');
  const otherRoles = [['zhou-chef', '赵一帆'], ['liu', '柳智敏'], ['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['he-jiawei', '何嘉伟']];
  const otherHashes = Object.fromEntries(otherRoles.map(([id, name]) => [id, loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id).metadata.rulesHash]));
  writeFileSync(libraryFile, fixtureText);
  const library = api.parseChenCoachKnowledge(fixtureText);
  const entry = library.entries.find(item => item.id === fixtureId);
  assert.deepEqual(entry.sources[0].authority, authority);
  assert.ok(Object.isFrozen(entry.adjudication) && Object.isFrozen(entry.sources[0].authority.findings));
  assert.throws(() => {entry.sources[0].authority.findings.push('mutated');}, TypeError);
  for (const [name, change] of [
    ['negative sample', data => {data.sources.at(-1).authority.sampleSize = -1;}],
    ['invalid DOI', data => {data.sources.at(-1).authority.doi = 'invented';}],
    ['invalid PMID', data => {data.sources.at(-1).authority.pmid = 'PMID 123';}],
    ['missing scope', data => {delete data.sources.at(-1).authority.accessLevel;}],
    ['invalid duration', data => {data.sources.at(-1).authority.durationWeeks = 0;}],
    ['author source upgraded', data => {data.sources.find(item => item.attribution === 'author').authority = structuredClone(authority);}],
    ['invalid verdict', data => {data.entries.at(-1).adjudication.verdict = 'absolutely_true';}],
    ['adjudication without authority', data => {delete data.sources.at(-1).authority;}],
  ]) {
    const data = structuredClone(fixture); change(data);
    assert.throws(() => api.parseChenCoachKnowledge(JSON.stringify(data)), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID', name);
  }
  const withUnknown = structuredClone(fixture);
  withUnknown.sources.at(-1).authority.hidden = 'HIDDEN_INSTRUCTION';
  withUnknown.entries.at(-1).adjudication.hidden = 'HIDDEN_INSTRUCTION';
  assert.ok(!JSON.stringify(api.parseChenCoachKnowledge(JSON.stringify(withUnknown))).includes('HIDDEN_INSTRUCTION'));
  report.checks.push('Optional research metadata and adjudication are validated, resolved from sourceIds and deeply frozen; malformed/misattributed fields fail closed and unknown fields do not become instructions.');

  // Test synthetic schema/range parsing in a one-entry snapshot, without making
  // a synthetic record compete with newly imported real research for five slots.
  const onlyFixture = api.parseChenCoachKnowledge(JSON.stringify({...fixture, sources: fixture.sources.slice(-1),
    entries: fixture.entries.slice(-1), coverage: {...fixture.coverage, entryCount: 1, sourceCount: 1}}));
  for (const query of ['6~8和10~12', '6～8和10～12', '6—8和10—12', '6–8和10–12', '6 到 8 和 10 至 12', '六到八和十到十二']) {
    assert.ok(api.matchChenCoachKnowledgeEntries(onlyFixture, query).some(item => item.id === fixtureId), query);
    assert.ok(api.matchChenCoachKnowledgeEntries(productionLibrary, query).some(item => item.id === benchId), `Real bench evidence: ${query}`);
  }
  const selected = api.matchChenCoachKnowledgeEntries(productionLibrary, '有依据吗？', 5, [topic, '有科学依据吗？']);
  assert.ok(selected.some(item => item.id === benchId), 'Citation-policy topics must not block resolving the preceding bench question');
  const sourceQuestions = ['有依据吗？', '有数据支持吗？', '研究表明什么呢？', '论文呢？', '数据呢？', '怎么证明？', '给我论文'];
  for (const question of sourceQuestions) {
    assert.ok(api.isChenCoachEvidenceQuestion(question), question);
    assert.ok(api.matchChenCoachKnowledgeEntries(productionLibrary, question, 5, [topic]).some(item => item.id === benchId), question);
  }
  const dailyMessages = ['手机数据丢了', '准备研究一下明天去哪看电影'];
  for (const message of dailyMessages) {
    assert.equal(api.isChenCoachEvidenceQuestion(message), false, `An everyday noun/verb is not a source request: ${message}`);
    assert.ok(!api.matchChenCoachKnowledgeEntries(productionLibrary, message, 5, [topic]).some(item => item.id === benchId), message);
  }
  assert.ok(!api.matchChenCoachKnowledgeEntries(productionLibrary, '这部电影的研究有数据支持吗？', 5, [topic])
    .some(item => item.id === benchId), 'A genuine source question with a new subject cannot borrow the old training topic');
  for (const matches of [
    api.matchChenCoachKnowledgeEntries(productionLibrary, '有依据吗？', 5, [topic, '周末去看电影']),
    api.matchChenCoachKnowledgeEntries(productionLibrary, '周末去看电影', 5, [topic]),
    api.matchChenCoachKnowledgeEntries(productionLibrary, '有依据吗？'),
  ]) assert.ok(!matches.some(item => item.id === benchId), 'A generic citation-policy entry may match; a stale bench topic must not');
  const query = api.chenCoachInputFromPrompt(promptFor('陈年', '有依据吗？', [
    ...history, {role: 'assistant', part: {text: 'NPC_NOT_A_USER_QUERY'}},
    {role: 'user', chronologyUnknown: true, part: {text: 'UNKNOWN_CHRONOLOGY'}},
  ]));
  assert.deepEqual(query, {current: '有依据吗？', recent: [topic]});
  report.sourceFollowupQuestions = sourceQuestions;
  report.everydayNegativeCases = dailyMessages;
  report.checks.push('Six repetition-range spellings and seven genuine source questions retrieve the real imported bench comparison; everyday phone-data/movie-research messages and a new-subject source question cannot revive old bench evidence. Generic citation-policy topics do not block source follow-ups; absent history, NPC text and chronology-unknown rows are excluded.');

  for (const [id, name] of otherRoles) {
    const loaded = loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id);
    assert.equal(loaded.metadata.rulesHash, otherHashes[id], id);
    assert.equal(loaded.chenCoachKnowledgeLibrary, undefined);
  }
  report.checks.push('Adding research records to Chen-only knowledge leaves all five other character rule bodies unchanged and does not give them Chen knowledge.');

  writeFileSync(libraryFile, original);
  for (const message of dailyMessages) {
    const context = promptFor('陈年', message, history);
    const loaded = loader.loadDialogueSkill(runtime.root, context, 'chen-nian');
    const enriched = await codex.retrieveStyle(runtime.root, context,
      async () => ({ids: [], fitnessEntryIds: [], coachKnowledgeIds: []}), loaded);
    assert.deepEqual(jsonAfter(enriched, api.chenCoachKnowledgeMarker), [], `Everyday new topic must not trigger private fallback: ${message}`);
  }
  const privatePrompt = promptFor('陈年', '有依据吗？', history);
  const expected = api.matchChenCoachKnowledgeEntries(productionLibrary, '有依据吗？', 5, [topic]);
  assert.ok(expected.some(item => item.id === benchId));
  const stages = [];
  let generationPrompt = '';
  const generated = await codex.generate(runtime.root, privatePrompt, {characterId: 'chen-nian', requestId: 'synthetic-chen-evidence-upgrade', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) {
      stages.push('retrieval');
      assert.ok(input.includes('科学依据与争议结论'));
      const changed = structuredClone(productionData); changed.sources.find(item => item.id === benchSource.id).authority.findings = ['MID_CALL_SOURCE_CHANGE'];
      writeFileSync(libraryFile, JSON.stringify(changed));
      return {ids: [], fitnessEntryIds: [], coachKnowledgeIds: []};
    }
    assert.ok(!input.includes('MID_CALL_SOURCE_CHANGE'));
    assert.ok(input.includes(api.chenCoachEvidenceRules));
    if (input.startsWith('你是NPC私聊成品编辑')) {
      stages.push('review');
      assert.ok(input.includes(JSON.stringify(expected)));
      return {verdict: 'keep', edits: [], chenSourceCheck: {verdict: 'pass', issues: []}};
    }
    stages.push('generation'); generationPrompt = input;
    assert.deepEqual(jsonAfter(input, api.chenCoachKnowledgeMarker), expected);
    return structuredClone(draft);
  }});
  assert.ok(generated);
  assert.deepEqual(stages, ['retrieval', 'generation', 'review']);
  const loaded = loader.loadDialogueSkill(runtime.root, privatePrompt, 'chen-nian');
  writeFileSync(libraryFile, original);
  const frozen = loader.loadDialogueSkill(runtime.root, privatePrompt, 'chen-nian');
  const forged = structuredClone(expected); forged.find(item => item.id === benchId).sources.find(item => item.id === benchSource.id).authority.findings.push('FORGED_FINDING');
  await assert.rejects(() => codex.reviewVoice(runtime.root, privatePrompt + '\n' + api.chenCoachKnowledgeMarker + JSON.stringify(forged), draft,
    async () => {throw Error('Must reject forged evidence before review runner');}, frozen), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
  assert.ok(loaded.chenCoachKnowledgeLibrary.sources.find(item => item.id === benchSource.id).authority.findings.includes('MID_CALL_SOURCE_CHANGE'), 'Next request can see a changed snapshot');
  let finalChecks = 0;
  await codex.reviewVoice(runtime.root, generationPrompt, draft, async (input, kind) => {
    assert.ok(input.includes(api.chenCoachEvidenceRules) && input.includes(JSON.stringify(expected)));
    if (kind === 'final_technical') {finalChecks++; return {chenSourceCheck: {verdict: 'pass', issues: []}};}
    return {verdict: 'revise', edits: [{index: 0, text: '合成的编辑后答复，仍不代表真实研究结论。'}], chenSourceCheck: {verdict: 'pass', issues: []}};
  }, frozen);
  assert.equal(finalChecks, 1);
  report.privateStages = stages;
  report.checks.push('An explicit empty semantic selection on a source follow-up still includes relevant research in generation/review; mid-call disk mutation cannot alter that frozen source snapshot; fabricated findings are rejected and edited replies receive a final technical check with the same evidence.');

  const members = [{id: 'user', name: '合成用户', role: 'user'}, {id: 'chen-nian', name: '陈年', role: 'fitness-coach'}, {id: 'liu', name: '柳智敏', role: 'nutritionist'}];
  const groupContext = {kind: 'message', now: Date.parse('2026-10-17T06:00:00Z'), facts: {facts: []},
    group: {id: 'synthetic-evidence-group', name: '合成研究群', goal: '合成训练', members, reminders: [], messages: [
      {id: 'synthetic-earlier', senderId: 'user', senderName: '合成用户', type: 'text', text: topic, at: '2026-10-17T05:59:00Z'},
    ]}, incoming: {id: 'synthetic-current', senderId: 'user', senderName: '合成用户', type: 'text', text: '有依据吗？', mentionIds: ['chen-nian'], at: '2026-10-17T06:00:00Z'}};
  const groupInputs = [];
  const groupDraft = {messages: [{senderId: 'chen-nian', text: '合成群来源测试答复。', mentionIds: []}]};
  await generateGroupDialogue(runtime.root, groupContext, async (_root, input) => {
    groupInputs.push(input);
    if (input.startsWith('你是智域群聊发言路由器')) {
      const changed = structuredClone(productionData); changed.sources.find(item => item.id === benchSource.id).authority.findings = ['MID_GROUP_SOURCE_CHANGE'];
      writeFileSync(libraryFile, JSON.stringify(changed));
      return groupParticipationFixture(['chen-nian']);
    }
    assert.ok(!input.includes('MID_GROUP_SOURCE_CHANGE'));
    assert.deepEqual(jsonAfter(input, api.chenCoachKnowledgeMarker), expected);
    assert.ok(input.includes(api.chenCoachEvidenceRules));
    const liuBlock = input.split('【人物liu当前Skill')[1]?.split('【当前群规则优先于私聊推进和旧能力限制】')[0]
      ?.split('【本轮同一冻结群规则】')[0];
    assert.ok(liuBlock && !liuBlock.includes(api.chenCoachKnowledgeMarker) && !liuBlock.includes(benchId));
    return input.startsWith('你是智域群聊成品复核器') ? {verdict: 'keep', edits: []} : structuredClone(groupDraft);
  });
  assert.equal(groupInputs.length, 3);
  report.checks.push('Group source-only follow-ups resolve the same-group recent user question; routing-time disk changes cannot alter generation/review evidence and Liu does not receive Chen records in her own rule block.');
  report.libraryHash = digest(original);
  report.productionLibrary = {version: productionLibrary.version, entryCount: productionLibrary.entries.length,
    sourceCount: productionLibrary.sources.length, selectedIds: expected.map(item => item.id),
    benchSourceIds: bench.sourceIds, verifiedResearchSource: {id: benchSource.id, title: benchSource.title,
      url: benchSource.url, authority: benchSource.authority}};
  report.fixtureEntry = fixtureId;
  report.passed = true;
  console.log(`PASS Chen research evidence upgrade: ${report.checks.length} isolated check groups; no real model/API/production/media operations.`);
} catch (error) {
  report.passed = false; report.failure = {message: error.message, stack: error.stack};
  throw error;
} finally {
  if (savedProvider === undefined) delete process.env.NPC_TEXT_PROVIDER; else process.env.NPC_TEXT_PROVIDER = savedProvider;
  runtime.cleanup();
  mkdirSync(output, {recursive: true});
  writeFileSync(join(output, 'isolated-code-wiring-verification.json'), JSON.stringify(report, null, 2) + '\n');
}
