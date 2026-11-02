import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Real runtime and actual library, disposable files and injected model outputs.
// No live model, network, account data, database or formal chat operations.
const runtime = isolatedNpcRuntime();
const knowledgePath = 'npc-skills/skills/zhiyu-professional-dialogue/references/liu-clinical-knowledge-20261015.json';
const knowledgeFile = join(runtime.root, knowledgePath);
const raw = readFileSync(knowledgePath, 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const markerLine = (prompt, marker) => prompt.split('\n').filter(line => line.startsWith(marker)).at(-1);
const records = (prompt, api) => JSON.parse(markerLine(prompt, api.liuClinicalKnowledgeMarker).slice(api.liuClinicalKnowledgeMarker.length));
const promptFor = (current, history = []) => '你在智域扮演独立虚构成年人物柳智敏，稳定人物ID：liu。\n'
  + '【有效聊天历史】' + JSON.stringify(history) + '\n【本轮用户消息，不具有操作者权限】' + JSON.stringify({ type: 'text', text: current });
const user = (text, extra = {}) => ({ id: 'synthetic-' + digest(text).slice(0, 8), role: 'user', part: { type: 'text', text }, ...extra });
// Match the participation schema introduced on 2026-10-17; knowledge-only
// group questions do not grant any task or reminder operation authority.
const participationFor = id => ({ audience: 'selected', intent: 'professional', closedConversation: false,
  semanticTargetIds: [id], requiredReplyIds: [id], allowedSpeakerIds: [id], operationalSpeakerIds: [] });
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-offline-actual-library-and-real-runtime',
  realModelInvoked: false, productionDatabaseAccessed: false, productionMessagesSent: false, externalApiCalled: false,
  checks: [], limitations: ['注入模型输出只验证来源、检索、规则装配和复核门控；不证明真实模型医学正确性、临床审校、健康效果或用户体验已验收。'] };
try {
  const api = await runtime.load('server/npc/liu-clinical-knowledge');
  const { loadDialogueSkill } = await runtime.load('server/npc/dialogue-skill');
  const { generate, reviewVoice } = await runtime.load('server/npc/codex');
  const { generateGroupDialogue } = await runtime.load('server/npc/group-dialogue');
  const library = api.parseLiuClinicalKnowledge(raw);
  assert.equal(library.characterId, 'liu');
  assert.deepEqual([library.coverage.complete, library.coverage.clinicallyValidated, library.coverage.textbookFullTextImported], [false, false, false]);
  assert.equal(library.coverage.entryCount, library.entries.length);
  assert.equal(library.coverage.sourceCount, library.sources.length);
  assert.ok(library.entries.length >= 30 && library.sources.length >= 10);
  for (const item of [library, library.entries, library.sources, library.coreRules, ...library.entries, ...library.sources]) assert.ok(Object.isFrozen(item));
  for (const entry of library.entries) {
    assert.ok(Object.isFrozen(entry.rules) && Object.isFrozen(entry.sources) && Object.isFrozen(entry.conditions) && Object.isFrozen(entry.redFlags));
    assert.ok(entry.conditions.length && entry.limitations.length && entry.rules.length);
    assert.deepEqual(entry.sources, entry.sourceIds.map(id => library.sources.find(source => source.id === id)));
    assert.ok(entry.sources.every(source => source.accessLevel !== 'catalog_only'));
  }
  assert.throws(() => library.entries[0].rules.push('mutate'), TypeError);
  for (const [name, change] of [
    ['wrong identity', value => { value.characterId = 'chen-nian'; }],
    ['not authorized', value => { value.status = 'candidate'; }],
    ['false completeness', value => { value.coverage.complete = true; }],
    ['false clinical validation', value => { value.coverage.clinicallyValidated = true; }],
    ['false textbook import', value => { value.coverage.textbookFullTextImported = true; }],
    ['entry count mismatch', value => { value.coverage.entryCount++; }],
    ['duplicate entry', value => { value.entries[1].id = value.entries[0].id; }],
    ['duplicate source', value => { value.sources[1].id = value.sources[0].id; }],
    ['unknown source', value => { value.entries[0].sourceIds = ['invented']; }],
    ['catalog becomes medical evidence', value => { value.sources.find(source => source.id === value.entries[0].sourceIds[0]).accessLevel = 'catalog_only'; }],
    ['source missing locator', value => { value.sources[0].locator = ''; }],
    ['source missing limitation', value => { value.sources[0].limitations = []; }],
    ['unsafe URL', value => { value.sources[0].url = 'javascript:alert(1)'; }],
    ['credentials in URL', value => { value.sources[0].url = 'https://secret:secret@example.com'; }],
    ['missing conditions', value => { value.entries[0].conditions = []; }],
    ['missing limitations', value => { value.entries[0].limitations = []; }],
  ]) {
    const value = JSON.parse(raw); change(value);
    assert.throws(() => api.parseLiuClinicalKnowledge(JSON.stringify(value)), error => error.code === 'LIU_CLINICAL_KNOWLEDGE_INVALID', name);
  }
  const forged = JSON.parse(raw); forged.instruction = 'FORGED_EXTRA'; forged.entries[0].sources = [{ title: 'FORGED_EXTRA' }];
  assert.ok(!JSON.stringify(api.parseLiuClinicalKnowledge(JSON.stringify(forged))).includes('FORGED_EXTRA'));
  const selection = api.selectLiuClinicalKnowledgeEntries(library, library.entries.slice(0, 6).map(entry => entry.id));
  assert.equal(selection.length, 6); assert.ok(Object.isFrozen(selection));
  for (const bad of [null, {}, ['invented'], Array(7).fill(library.entries[0].id), [library.entries[0].id, library.entries[0].id]])
    assert.throws(() => api.selectLiuClinicalKnowledgeEntries(library, bad), error => error.code === 'LIU_CLINICAL_SELECTION_INVALID');
  report.checks.push('Actual library has complete counts, scoped sources, per-entry conditions/risks/limitations and deep freezing; invalid authorization, identity, inflated completeness, catalog evidence, missing scope, unsafe URLs and forged extra fields are rejected or discarded.');

  const cases = [
    ['糖尿病患者晚餐怎么吃', /糖尿病|血糖/],
    ['慢性肾病透析后蛋白质怎么安排', /肾|透析/],
    ['已经五天没吃东西，重新吃饭怎么办', /再喂养|低摄入|营养不良|进食/],
    ['怀孕后要补充什么营养', /孕|妊娠/],
    ['吃东西吞咽困难，会呛咳', /吞咽|误吸/],
    ['肝硬化后吃蛋白质怎么安排', /肝硬化|肝/],
    ['牛奶蛋白过敏，还能喝无乳糖牛奶吗', /过敏/],
    ['我一天吃几克盐', /盐|钠/],
    ['铁怎么补', /补铁|贫血|铁/],
    ['钠每天多少合适', /盐|钠/],
    ['吃完虾现在嗓子发紧，喘不过气', /食物过敏/],
    ['我已经8天每天只吃两口，今天想补一顿', /再喂养/],
    ['我连续十天几乎没进食，今天能大吃一顿吗', /再喂养/],
  ];
  for (const [current, expected] of cases) {
    const matched = api.matchLiuClinicalKnowledgeEntries(library, current);
    assert.ok(matched.length > 0 && matched.length <= 6 && matched.some(entry => expected.test(JSON.stringify([entry.title, entry.topics]))), current);
  }
  const focused = api.matchLiuClinicalKnowledgeEntries(library, '那我还能喝牛奶吗', ['我有慢性肾病，正在透析']);
  assert.ok(focused.some(entry => /肾|透析/.test(entry.title)), 'Food follow-up must retain renal constraints');
  const mixed = api.matchLiuClinicalKnowledgeEntries(library, '我有糖尿病和慢性肾病，还在透析，早餐蛋白和牛奶怎么安排');
  assert.ok(mixed.some(entry => /肾|透析/.test(entry.title)) && mixed.some(entry => /糖尿病|血糖/.test(entry.title)), 'Multiple disease constraints need bounded retrieval');
  assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, '今天电影很好看', ['我有糖尿病']), []);
  assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, '那电影真的很好看', ['我有糖尿病']), []);
  for (const social of ['糖葫芦真好看', '唐老鸭很好笑', '铁路怎么修', '铁锅怎么保养', '盐系帅哥真好看'])
    assert.ok(!api.matchLiuClinicalKnowledgeEntries(library, social).some(entry => ['sodium', 'sugar', 'iron'].includes(entry.id)), social);
  assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, '换个话题，今天电影很好看', ['我有糖尿病']), []);
  const switched = api.matchLiuClinicalKnowledgeEntries(library, '那我还能喝牛奶吗', ['我有慢性肾病', '刚刚看了一部电影']);
  assert.ok(!switched.some(entry => /肾/.test(entry.title)), 'Unrelated user turn ends inherited nutrition context');
  assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, '糖尿病', [], 0), []);
  for (const bad of [-1, 7, 1.5, NaN]) assert.throws(() => api.matchLiuClinicalKnowledgeEntries(library, '糖尿病', [], bad));
  const manyRisks = ['我有糖尿病肾病，透析，营养不良，孕期呕吐脱水，吞咽困难'];
  for (const [current, expected] of [['吃完饭我现在呼吸困难', 'food-allergy'], ['我现在手抖冒冷汗怎么办', 'hypoglycemia'], ['换个话题，我现在喘不过气', 'food-allergy']]) {
    const selected = api.matchLiuClinicalKnowledgeEntries(library, current, manyRisks);
    assert.equal(selected[0].id, expected, 'Current acute signs must precede inherited chronic conditions: ' + current);
    assert.equal(api.matchLiuClinicalKnowledgeEntries(library, current, manyRisks, 1)[0].id, expected);
    assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, current, manyRisks, 0), []);
  }
  const history = [user('我有慢性肾病，正在透析'), { role: 'assistant', part: { type: 'text', text: '我有糖尿病' } }, user('我有痛风', { chronologyUnknown: true })];
  assert.deepEqual(api.liuClinicalInputFromPrompt(promptFor('那我还能喝牛奶吗', history)), { current: '那我还能喝牛奶吗', recent: ['我有慢性肾病，正在透析'] });
  report.checks.push('Disease/pregnancy/swallowing/refeeding references include oral salt/iron/sodium questions, throat-tightness/breathlessness after food and prolonged near-zero intake; current acute signs outrank inherited chronic risks even with max=1, while max=0 stays empty. Renal food follow-ups and multiple diseases work; social/lexical collisions, topic changes, NPC claims and unknown-chronology history cannot create old diagnoses.');

  const current = '慢性肾病透析后蛋白质怎么安排';
  const context = promptFor(current);
  const expected = api.matchLiuClinicalKnowledgeEntries(library, current);
  const loaded = loadDialogueSkill(runtime.root, context, 'liu');
  assert.ok(loaded.liuClinicalKnowledgeLibrary);
  assert.ok(loaded.metadata.sources.some(source => source.path === knowledgePath && source.sha256 === digest(raw)));
  const changed = JSON.parse(raw); changed.version += '-mid-turn'; changed.coreRules.push('MID_TURN_LIU_SOURCE'); changed.entries.forEach(entry => { entry.summary = 'MID_TURN_LIU_SOURCE'; });
  const draft = { action: 'reply', messages: [{ type: 'text', text: '要结合当前透析方式和营养状态安排，先确认最近的评估结果。' }], event: null, memories: [] };
  const pass = { verdict: 'keep', edits: [], liuClinicalCheck: { verdict: 'pass', issues: [] } };
  const runPrivate = async ({ rejectCount = 0, edit = false, mutate = false, omitCheck = false } = {}) => {
    const calls = []; let reviews = 0;
    const output = await generate(runtime.root, context, { characterId: 'liu', requestId: 'synthetic-liu-' + Math.random(), runRaw: async (_root, input) => {
      calls.push(input);
      if (input.startsWith('你是NPC聊天案例检索器')) { if (mutate) writeFileSync(knowledgeFile, JSON.stringify(changed)); return { ids: [] }; }
      if (input.startsWith('你是人物知识范围判定器')) return { decision: 'not_knowledge', basis: '离线夹具直接进入实际生成' };
      if (input.startsWith('你是柳智敏最终营养成品复核器')) return { liuClinicalCheck: { verdict: 'pass', issues: [] } };
      if (input.startsWith('你是NPC私聊成品编辑')) {
        reviews++;
        if (omitCheck) return { verdict: 'keep', edits: [] };
        if (reviews <= rejectCount) return { verdict: 'keep', edits: [], liuClinicalCheck: { verdict: 'redraft', issues: ['必须保留当前透析条件'] } };
        return edit ? { verdict: 'revise', edits: [{ index: 0, text: '先确认近期的评估结果，再结合透析方式和营养状态安排。' }], liuClinicalCheck: { verdict: 'pass', issues: [] } } : pass;
      }
      assert.ok(input.startsWith('你在智域扮演独立虚构成年人物柳智敏'), input.slice(0, 100));
      return structuredClone(draft);
    } });
    return { output, calls };
  };
  try {
    const result = await runPrivate({ mutate: true });
    assert.deepEqual(result.output, draft);
    const gen = result.calls.find(input => input.startsWith('你在智域扮演独立虚构成年人物柳智敏'));
    const review = result.calls.find(input => input.startsWith('你是NPC私聊成品编辑'));
    assert.deepEqual(records(gen, api), expected); assert.deepEqual(records(review, api), expected);
    assert.ok(result.calls.every(input => !input.includes('MID_TURN_LIU_SOURCE')));
    assert.ok(loadDialogueSkill(runtime.root, context, 'liu').rules.includes('MID_TURN_LIU_SOURCE'));
  } finally { writeFileSync(knowledgeFile, raw); }
  const retry = await runPrivate({ rejectCount: 1 });
  assert.equal(retry.calls.filter(input => input.startsWith('你在智域扮演独立虚构成年人物柳智敏')).length, 2);
  assert.equal(retry.calls.filter(input => input.startsWith('你是NPC私聊成品编辑')).length, 2);
  for (const input of retry.calls.filter(input => input.startsWith('你在智域扮演独立虚构成年人物柳智敏') || input.startsWith('你是NPC私聊成品编辑'))) assert.deepEqual(records(input, api), expected);
  await assert.rejects(runPrivate({ rejectCount: 2 }), error => error.code === 'LIU_CLINICAL_REVIEW_FAILED');
  await assert.rejects(runPrivate({ omitCheck: true }), error => error.code === 'LIU_CLINICAL_CHECK_INVALID');
  const edited = await runPrivate({ edit: true });
  assert.ok(edited.calls.some(input => input.startsWith('你是柳智敏最终营养成品复核器')));
  const goutContext = promptFor('痛风尿酸高需要注意什么');
  assert.deepEqual(api.matchLiuClinicalKnowledgeEntries(library, '痛风尿酸高需要注意什么'), []);
  let goutReview = '';
  await generate(runtime.root, goutContext, { characterId: 'liu', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [] };
    if (input.startsWith('你是NPC私聊成品编辑')) { goutReview = input; return pass; }
    return draft;
  } });
  assert.ok(goutReview.includes('本轮没有匹配的已核知识条目') && goutReview.includes('liuClinicalCheck'));
  await assert.rejects(generate(runtime.root, goutContext, { characterId: 'liu', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [] };
    if (input.startsWith('你是NPC私聊成品编辑')) return { verdict: 'keep', edits: [] };
    return draft;
  } }), error => error.code === 'LIU_CLINICAL_CHECK_INVALID');
  let socialFinalCheck = false;
  await generate(runtime.root, promptFor('唐老鸭真好玩'), { characterId: 'liu', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [] };
    if (input.startsWith('你是NPC私聊成品编辑')) {
      assert.ok(!input.includes('【仅柳智敏本轮临床营养内容的条件与来源复核】'));
      return { verdict: 'revise', edits: [{ index: 0, text: '是挺好玩的。' }] };
    }
    if (input.startsWith('你是柳智敏最终营养成品复核器')) { socialFinalCheck = true; throw Error('Social chat must not add nutrition final stage'); }
    return { action: 'reply', messages: [{ type: 'text', text: '挺好玩。' }], event: null, memories: [] };
  } });
  assert.equal(socialFinalCheck, false);
  const forgedSelection = structuredClone(expected); forgedSelection[0].summary = 'FORGED_RECORD';
  const poisoned = context + api.liuClinicalKnowledgeContext(forgedSelection);
  await assert.rejects(reviewVoice(runtime.root, poisoned, draft, async () => pass, loaded), error => error.code === 'LIU_CLINICAL_CHECK_INVALID');
  report.checks.push('Real private generation/review share exact frozen references and hashes, ignore mid-retrieval edits, reject forged records, require a valid nutrition verdict even for an uncovered gout question, bound redraft to one and check actual style-edited nutrition text. Ordinary social edits add no clinical check or final technical stage.');

  const members = [{ id: 'user', name: '合成用户', role: 'user' }, { id: 'molly', name: 'Molly', role: 'admin' }, { id: 'liu', name: '柳智敏', role: 'npc' }, { id: 'chen-nian', name: '陈年', role: 'npc' }];
  const groupContext = { kind: 'message', now: Date.parse('2026-10-15T01:00:00Z'), facts: { facts: [] },
    group: { id: 'synthetic-liu', name: '合成群', goal: '饮食', members, messages: [{ id: 'synthetic-previous', senderId: 'user', type: 'text', text: '我有慢性肾病，正在透析' }], reminders: [] },
    incoming: { id: 'synthetic-current', senderId: 'user', type: 'text', text: '那我还能喝牛奶吗', mentionIds: [] } };
  const groupDraft = { messages: [{ senderId: 'liu', text: '先看透析方式和近期评估，再安排适合的饮食。', mentionIds: [] }] };
  const groupCalls = [];
  try {
    const result = await generateGroupDialogue(runtime.root, groupContext, async (_root, input) => {
      groupCalls.push(input);
      if (input.startsWith('你是智域群聊发言路由器')) { writeFileSync(knowledgeFile, JSON.stringify(changed)); return participationFor('liu'); }
      if (input.startsWith('你是智域群聊成品复核器')) return { verdict: 'keep', edits: [] };
      return groupDraft;
    });
    assert.deepEqual(result, groupDraft);
    const generation = groupCalls.find(input => input.startsWith('你是智域群聊协作生成器'));
    const review = groupCalls.find(input => input.startsWith('你是智域群聊成品复核器'));
    assert.deepEqual(records(generation, api), focused); assert.deepEqual(records(review, api), focused);
    assert.ok(groupCalls.every(input => !input.includes('MID_TURN_LIU_SOURCE')));
    const chenBlock = generation.split('【人物chen-nian当前Skill')[1].split('【当前群规则优先于私聊推进和旧能力限制】')[0];
    assert.ok(!chenBlock.includes(api.liuClinicalKnowledgeMarker));
  } finally { writeFileSync(knowledgeFile, raw); }
  for (const [id, name] of [['chen-nian', '陈年'], ['zhou-chef', '赵一帆'], ['yuan-xiaoman', '小满']]) {
    const other = loadDialogueSkill(runtime.root, `你是${name}，稳定人物ID：${id}。`, id);
    assert.ok(!other.liuClinicalKnowledgeLibrary && !other.rules.includes(api.liuClinicalKnowledgeRules));
    assert.ok(!other.metadata.sources.some(source => source.path === knowledgePath));
  }
  renameSync(knowledgeFile, knowledgeFile + '.missing');
  try {
    let calls = 0;
    await assert.rejects(generate(runtime.root, context, { characterId: 'liu', runRaw: async () => { calls++; throw Error('Unexpected model stage'); } }), error => error.code === 'MODULE_MISSING');
    assert.equal(calls, 0);
    const absentContext = structuredClone(groupContext); absentContext.group.members = members.filter(member => member.id !== 'liu'); absentContext.incoming.mentionIds = ['chen-nian']; absentContext.group.messages = [];
    const result = await generateGroupDialogue(runtime.root, absentContext, async (_root, input) => input.startsWith('你是智域群聊发言路由器') ? participationFor('chen-nian') : input.startsWith('你是智域群聊成品复核器') ? { verdict: 'keep', edits: [] } : { messages: [{ senderId: 'chen-nian', text: '按当前训练状态继续。', mentionIds: [] }] });
    assert.equal(result.messages[0].senderId, 'chen-nian');
  } finally { renameSync(knowledgeFile + '.missing', knowledgeFile); }
  assert.equal(readFileSync(knowledgePath, 'utf8'), raw);
  report.checks.push('Real group pipeline uses the same scoped Liu snapshot across routing/generation/review, combines recent user renal context with a food follow-up, leaves Chen/chef/companion loaders untouched, fails Liu before a model call when the required file is missing, and still runs Liu-absent groups without that file.');
  report.passed = true; report.entries = library.entries.length; report.sources = library.sources.length; report.knowledgeHash = digest(raw);
  mkdirSync('output/liu-clinical-knowledge-20261015', { recursive: true });
  writeFileSync('output/liu-clinical-knowledge-20261015/runtime-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS Liu clinical foundation: ${library.entries.length} entries / ${library.sources.length} sources; ${report.checks.length} offline check groups. Live model / API / production operations: 0.`);
} finally { runtime.cleanup(); }
