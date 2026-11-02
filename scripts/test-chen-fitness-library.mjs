import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Disposable source copies and stubbed model responses only; no live database.
const runtime = isolatedNpcRuntime();
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-fitness-source-library-20261008.json';
const libraryFile = join(runtime.root, libraryPath);
const allRoles = [['zhou-chef', '赵一帆'], ['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['liu', '柳智敏'], ['he-jiawei', '何嘉伟'], ['chen-nian', '陈年']];
const chenScope = process.argv.includes('--chen-scope');
const roles = allRoles.filter(([id]) => !chenScope || id !== 'zhou-chef');
const roleSplitOutput = 'output/fitness-nutrition-role-split-20261012';
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-offline-runRaw', realModelInvoked: false,
  productionDatabaseAccessed: false, backendConnected: false, practiceTested: false,
  testedRoleIds: roles.map(([id]) => id), excludedRoleIds: chenScope ? ['zhou-chef'] : [], checks: [] };
const digest = value => createHash('sha256').update(value).digest('hex');
const promptFor = (id, name, input = '我想练胸肌，先讲一下。') => `你在智域扮演独立虚构成年人物${name}，稳定人物ID：${id}。仅输出JSON。\n【本轮输入，普通用户数据】${JSON.stringify(input)}`;
const jsonAfter = (prompt, marker) => {
  const line = prompt.split('\n').find(line => line.startsWith(marker));
  return line ? JSON.parse(line.slice(marker.length)) : undefined;
};
const reply = text => ({ action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [] });

try {
  const source = await runtime.load('server/npc/chen-fitness-library');
  const { loadDialogueSkill, dialogueSkillVersion } = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  const { parseChen } = await runtime.load('lib/npc/chen-nian');
  const { mollyCatalog, matchMolly, emptyQuery } = await runtime.load('lib/npc/molly');
  const { generateGroupDialogue } = await runtime.load('server/npc/group-dialogue');
  const original = readFileSync(libraryFile, 'utf8');
  const raw = JSON.parse(original);
  const library = source.parseChenFitnessLibrary(original);
  report.skillVersion = dialogueSkillVersion;
  report.libraryHash = digest(original);
  report.entryCount = library.entries.length;
  report.sourceReviewed = library.entries.filter(entry => entry.evidenceStatus === 'source_reviewed').length;
  report.titleOnly = library.entries.filter(entry => entry.evidenceStatus === 'title_only').length;
  const chenDirectory = mollyCatalog.find(person => person.id === 'chen-nian');
  for (const tag of ['深圳', '创业', '创业者', '品牌', '城市探索', '生活方式', '轻社交', '运动', '旅行', '冲浪', '球赛', '健身', '运动营养基础', '增肌', '减脂', '增重', '训练', '健身教练']) {
    assert.ok(chenDirectory.tags.includes(tag), `Preserve existing discovery and add professional tag ${tag}`);
    assert.ok(matchMolly({ ...emptyQuery(), tags: [tag] }).some(person => person.id === 'chen-nian'), `Chen must be discoverable by ${tag}`);
  }
  assert.ok(!chenDirectory.tags.includes('营养') && !chenDirectory.tags.includes('健身与营养教练'),'Chen discovery reflects the current training role');
  const liuDirectory = mollyCatalog.find(person => person.id === 'liu');
  for (const tag of ['营养', '营养师', '早餐搭配', '减脂饮食', '营养补充']) {
    assert.ok(liuDirectory.tags.includes(tag), `Liu current nutrition discovery includes ${tag}`);
    assert.ok(matchMolly({ ...emptyQuery(), tags: [tag] }).some(person => person.id === 'liu'), `Liu must be discoverable by ${tag}`);
  }
  report.directoryProfessionalTags = ['健身', '运动营养基础', '增肌', '减脂', '增重', '训练', '健身教练'];
  for (const entry of library.entries) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.source) && Object.isFrozen(entry.observations) && Object.isFrozen(entry.verification));
    assert.equal(entry.verification.completeProtocol, false); assert.equal(entry.verification.practiceTested, false);
    if (entry.evidenceStatus === 'title_only') {
      assert.deepEqual(entry.observations, []); assert.equal(entry.summary, null); assert.equal(entry.verification.safetyReviewed, false);
    } else {
      assert.ok(entry.source.researchFile && entry.source.reviewedMethod && entry.observations.length);
      assert.ok(existsSync(entry.source.researchFile), `Reviewed evidence file missing for ${entry.id}`);
    }
  }
  assert.ok(Object.isFrozen(library) && Object.isFrozen(library.entries));
  assert.throws(() => { library.entries[0].title = 'mutated'; }, TypeError);
  assert.equal(library.coverage.complete, false);
  assert.deepEqual(source.chenFitnessCatalog(library)[0], { id: library.entries[0].id, title: library.entries[0].title,
    category: library.entries[0].category, topics: library.entries[0].topics, evidenceStatus: library.entries[0].evidenceStatus });
  assert.ok(!JSON.stringify(source.chenFitnessCatalog(library)).includes('observations'));
  report.checks.push('Actual source library preserves partial coverage, evidence medium and missing parameters; title-only records carry no teaching observations; complete/practice flags remain false and all snapshots are deeply frozen.');

  for (const [label, mutate] of [
    ['wrong character', value => { value.characterId = 'zhou-chef'; }],
    ['wrong author', value => { value.author.name = '其他作者'; }],
    ['unapproved library', value => { value.status = 'candidate'; }],
    ['false complete coverage', value => { value.coverage.complete = true; }],
    ['wrong count', value => { value.coverage.trainingEntries += 1; }],
    ['duplicate video', value => { value.entries.push(value.entries[0]); }],
    ['invented source URL', value => { value.entries[0].source.url = 'https://example.com/video'; }],
    ['research path traversal', value => { value.entries[0].source.researchFile = 'output/tan-chengyi-research-20261008/../private.json'; }],
    ['false practical validation', value => { value.entries[0].verification.practiceTested = true; }],
    ['false complete protocol', value => { value.entries[0].verification.completeProtocol = true; }],
    ['title carries teaching', value => { const entry = value.entries[0]; entry.evidenceStatus = 'title_only'; entry.summary = '作者要求每次练这个参数'; }],
    ['invalid observation medium', value => { value.entries[0].evidenceStatus = 'source_reviewed'; value.entries[0].observations = [{ text: '未知媒介', evidenceTimes: [0, 1], evidenceType: 'invented' }]; }],
    ['transcript lacks time', value => { value.entries[0].evidenceStatus = 'source_reviewed'; value.entries[0].observations = [{ text: '无定位', evidenceTimes: null, evidenceType: 'source_transcript' }]; }],
  ]) {
    const value = structuredClone(raw); mutate(value);
    assert.throws(() => source.parseChenFitnessLibrary(JSON.stringify(value)), error => error.code === 'CHEN_LIBRARY_INVALID', label);
  }
  assert.throws(() => source.parseChenFitnessLibrary('{'), error => error.code === 'CHEN_LIBRARY_INVALID');
  const selectedIds = library.entries.slice(0, 3).map(entry => entry.id);
  assert.deepEqual(source.selectChenFitnessEntries(library, undefined), []);
  assert.deepEqual(source.selectChenFitnessEntries(library, []), []);
  assert.deepEqual(source.selectChenFitnessEntries(library, selectedIds), library.entries.slice(0, 3));
  for (const ids of [null, {}, ['invented'], [selectedIds[0], selectedIds[0]], Array(4).fill(selectedIds[0])]) {
    assert.throws(() => source.selectChenFitnessEntries(library, ids), error => error.code === 'CHEN_SELECTION_INVALID');
  }
  const extras = structuredClone(raw); extras.entries[0].hiddenInventedTrainingParameters = 'must-not-enter-runtime';
  assert.ok(!JSON.stringify(source.parseChenFitnessLibrary(JSON.stringify(extras))).includes('must-not-enter-runtime'));
  report.checks.push('Malformed identity/authorization/counts/provenance/evidence and inflated validation flags fail closed; extra unclassified fields are removed; only 0–3 unique real source IDs can be selected.');

  const historicalBefore = JSON.parse(readFileSync('output/tan-chengyi-research-20261008/before-rules-hashes.json', 'utf8'));
  const beforeRoleSplit = JSON.parse(readFileSync(join(roleSplitOutput, 'before/rule-snapshot.json'), 'utf8'));
  const currentOtherHashes = new Map();
  report.roleChangesSinceHistoricalImport = [];
  report.roleSplitBaseline = join(roleSplitOutput, 'before/rule-snapshot.json');
  for (const [id, name] of roles) {
    const loaded = loadDialogueSkill(runtime.root, promptFor(id, name), id);
    assert.equal(Boolean(loaded.chenFitnessLibrary), id === 'chen-nian');
    assert.equal(loaded.metadata.sources.some(row => row.path === libraryPath), id === 'chen-nian');
    assert.equal(loaded.metadata.sources.some(row => row.path.endsWith('/chen-fitness-guidance.md')), id === 'chen-nian');
    assert.equal(Boolean(loaded.chefRecipeLibrary), id === 'zhou-chef');
    assert.equal(loaded.metadata.sources.some(row => row.path.endsWith('/liu-nutrition-guidance.md')), id === 'liu');
    assert.ok(!loaded.metadata.sources.some(row => row.path.endsWith('/skin-guidance.md')));
    if (id !== 'chen-nian') {
      currentOtherHashes.set(id, loaded.metadata.rulesHash);
      const historicalHash = historicalBefore.find(row => row.id === id).rulesHash;
      const roleSplitBeforeHash = digest(beforeRoleSplit[id].rules);
      if (id === 'liu') {
        assert.match(beforeRoleSplit[id].rules, /当前职业为皮肤管理专家/,'Record the exact occupation replaced by the user');
        assert.notEqual(loaded.metadata.rulesHash, roleSplitBeforeHash,'The authorized Liu nutrition role is actually loaded');
        assert.match(loaded.rules, /现行职业是营养师/);
        assert.match(loaded.rules, /早餐与日常餐食搭配、减脂饮食/);
        assert.match(loaded.rules, /营养补充/);
        report.roleChangesSinceHistoricalImport.push({ id, historicalHash, roleSplitBeforeHash, currentHash: loaded.metadata.rulesHash,
          scope: '2026-10-12 user-authorized replacement of Liu skin management with nutrition, breakfast, fat-loss meals and nutrition supplementation; no Chen source library loaded' });
      } else {
        assert.equal(loaded.rules, beforeRoleSplit[id].rules, `${id} complete rule body must be unchanged by the current role split`);
        if (loaded.metadata.rulesHash !== historicalHash) report.roleChangesSinceHistoricalImport.push({ id, historicalHash,
          roleSplitBeforeHash, currentHash: loaded.metadata.rulesHash,
          scope: 'carried-forward rule updates after the 2026-10-08 import; unchanged from the exact 2026-10-12 pre-split snapshot' });
      }
      if (id === 'zhou-chef') {
        assert.ok(loaded.chefWesternDessertLibrary);
        assert.ok(loaded.metadata.sources.some(row => row.path.endsWith('/chef-western-dessert-methods.md')));
      }
    }
    else assert.equal(loaded.metadata.sources.find(row => row.path === libraryPath).sha256, digest(original));
  }
  const chenPrompt = promptFor('chen-nian', '陈年');
  const loaded = loadDialogueSkill(runtime.root, chenPrompt, 'chen-nian');
  assert.match(loaded.rules, /现行专业为健身教练/); assert.match(loaded.rules, /营养补充主责柳智敏/);
  assert.doesNotMatch(loaded.rules, /安秋金53条|赵一帆本人烹饪操作知识/);
  assert.doesNotMatch(loaded.rules, /然后最后整理成一个表，最后都喂给陈年|本轮接入为 user_required/);
  assert.match(loaded.rules, /每周可训练几天/); assert.match(loaded.rules, /器械与环境/); assert.match(loaded.rules, /当前相关伤痛/);
  for (const phrase of [/嘴贱/, /具体表达/, /有效私人关系/, /title_only/, /platform_chapter_summary/, /不授予看图/]) assert.match(loaded.rules, phrase);
  const counterfactualFiles = [
    ['npc-skills/skills/zhiyu-character-dialogue/references/character-design.md', /^\| (?:chen-nian|陈年：)/],
    ['npc-skills/skills/zhiyu-character-dialogue/references/personality-modules.md', /^\| 陈年 \|/],
  ];
  const counterfactualOriginals = counterfactualFiles.map(([path]) => [path, readFileSync(join(runtime.root, path), 'utf8')]);
  const guidancePath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-fitness-guidance.md';
  renameSync(libraryFile, libraryFile + '.scope-test');
  renameSync(join(runtime.root, guidancePath), join(runtime.root, guidancePath) + '.scope-test');
  try {
    for (const [path, rowPattern] of counterfactualFiles) {
      const previousRows = readFileSync(join('output/tan-chengyi-research-20261008/before', path), 'utf8').split('\n').filter(line => rowPattern.test(line));
      let index = 0;
      const current = counterfactualOriginals.find(([candidate]) => candidate === path)[1];
      const reverted = current.split('\n').map(line => rowPattern.test(line) ? previousRows[index++] : line).join('\n');
      assert.equal(index, previousRows.length, 'Restore exactly the Chen-specific shared rows');
      writeFileSync(join(runtime.root, path), reverted);
    }
    for (const [id, name] of roles.filter(([id]) => id !== 'chen-nian')) {
      assert.equal(loadDialogueSkill(runtime.root, promptFor(id, name), id).metadata.rulesHash, currentOtherHashes.get(id),
        `${id} must ignore restored Chen rows and absent Chen-only modules`);
    }
  } finally {
    for (const [path, current] of counterfactualOriginals) writeFileSync(join(runtime.root, path), current);
    renameSync(libraryFile + '.scope-test', libraryFile);
    renameSync(join(runtime.root, guidancePath) + '.scope-test', join(runtime.root, guidancePath));
  }
  report.checks.push(`Only chen-nian loads the fitness library and source rules. Counterfactually restoring the prior Chen-only shared rows and removing both Chen-only modules leaves all ${roles.length - 1} included other rule hashes unchanged. Each unaffected character matches the complete 2026-10-12 pre-split rule body; Liu's user-authorized nutrition replacement and later historical rule changes are explicitly recorded. Chen retains personality/private relationship/media boundaries without chef knowledge.`);

  const evidenceSelection = [...new Set([
    library.entries.find(entry => entry.observations.some(observation => observation.evidenceType === 'video_frame'))?.id,
    library.entries.find(entry => entry.observations.some(observation => observation.evidenceType === 'platform_chapter_summary'))?.id,
    library.entries.find(entry => entry.evidenceStatus === 'title_only')?.id,
    ...selectedIds,
  ].filter(Boolean))].slice(0, 3);

  const pipeline = async (ids, requestId, reviews = [], changeFile = false, draftOverrides = {}) => {
    const captured = { stages: [], inputs: [] };
    let reviewIndex = 0;
    const result = await codex.generate(runtime.root, chenPrompt, { characterId: 'chen-nian', requestId, runRaw: async (_root, input) => {
      captured.inputs.push(input);
      if (input.startsWith('你是NPC聊天案例检索器')) {
        captured.stages.push('retrieval');
        assert.deepEqual(jsonAfter(input, '【陈年训练营养来源目录；只索引主题及证据状态】'), source.chenFitnessCatalog(library));
        if (changeFile) { const changed = structuredClone(raw); changed.version += '-changed-during-retrieval'; changed.entries[0].title = 'LATE_SOURCE_MARKER'; writeFileSync(libraryFile, JSON.stringify(changed)); }
        // This regression isolates the original author library; the new
        // supplement library is covered by test-chen-coach-integration.mjs.
        return { ids: [], fitnessEntryIds: ids, coachKnowledgeIds: [] };
      }
      if (input.startsWith('你是NPC私聊成品编辑')) {
        captured.stages.push('review');
        return reviews[reviewIndex++] || { verdict: 'keep', edits: [], ...(ids.length ? { chenSourceCheck: { verdict: 'pass', issues: [] } } : {}) };
      }
      captured.stages.push('generation');
      return { ...reply('先按你能用的器械和目前训练经验选动作，未说明的来源参数先核对。'), ...draftOverrides };
    } });
    return { result, captured };
  };
  const frozen = await pipeline(evidenceSelection, 'chen-frozen-source-test', [], true);
  assert.deepEqual(frozen.captured.stages, ['retrieval', 'generation', 'review']);
  for (const input of frozen.captured.inputs.slice(1)) {
    assert.deepEqual(jsonAfter(input, source.chenFitnessReferenceMarker), source.selectChenFitnessEntries(library, evidenceSelection));
    assert.ok(!input.includes('LATE_SOURCE_MARKER'));
  }
  assert.ok(loadDialogueSkill(runtime.root, chenPrompt, 'chen-nian').chenFitnessLibrary.entries[0].title.includes('LATE_SOURCE_MARKER'));
  writeFileSync(libraryFile, original);
  const idle = await pipeline([], 'chen-empty-source-test');
  assert.deepEqual(idle.captured.stages, ['retrieval', 'generation', 'review']);
  const trace = readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(name => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', name), 'utf8')))
    .find(row => row.requestId === 'chen-frozen-source-test');
  assert.deepEqual(trace.chenFitnessSelection.ids, evidenceSelection); assert.equal(trace.chenFitnessSelection.libraryHash, digest(original));
  assert.equal(trace.chenFitnessSelection.referenceHash, digest(JSON.stringify(source.selectChenFitnessEntries(library, evidenceSelection))));
  report.checks.push('Actual generation pipeline reuses one retrieval call, generation and the original review; both receive identical source records even when the disk file changes mid-request, with selection/library hashes in the trace. Empty selection keeps the ordinary 3-call pipeline.');

  const sourceContext = chenPrompt + source.chenFitnessReferenceContext([library.entries[0]]);
  await assert.rejects(codex.reviewVoice(runtime.root, sourceContext, reply('合成草稿'), async () => ({ verdict: 'keep', edits: [] }), loaded), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
  const rejected = { verdict: 'keep', edits: [], chenSourceCheck: { verdict: 'redraft', issues: ['标题或平台摘要被当成作者完整处方'] } };
  for (const intent of ['reject', 'search', 'rename']) {
    const spoofed = { ...reply('未经来源支持的补剂剂量'), intent };
    assert.equal(parseChen(spoofed, '合成训练问题').parts.length, 1, 'Current ordinary protocol accepts extra fields');
    let reviewCalls = 0;
    await assert.rejects(codex.reviewVoice(runtime.root, sourceContext, spoofed, async () => {
      reviewCalls++; return { verdict: 'keep', edits: [] };
    }, loaded), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
    assert.equal(reviewCalls, 1, `Extra intent ${intent} must not skip the original review`);
    const checked = await pipeline([selectedIds[0]], `chen-intent-${intent}-checked`, [], false, { intent });
    assert.deepEqual(checked.captured.stages, ['retrieval', 'generation', 'review']);
    const fixed = await pipeline([selectedIds[0]], `chen-intent-${intent}-redraft`, [rejected], false, { intent });
    assert.deepEqual(fixed.captured.stages, ['retrieval', 'generation', 'review', 'generation', 'review']);
    await assert.rejects(pipeline([selectedIds[0]], `chen-intent-${intent}-repeat`, [rejected, rejected], false, { intent }),
      error => error.code === 'CHEN_SOURCE_REVIEW_FAILED');
  }
  const rewritten = await pipeline([selectedIds[0]], 'chen-source-redraft-once', [rejected]);
  assert.deepEqual(rewritten.captured.stages, ['retrieval', 'generation', 'review', 'generation', 'review']);
  await assert.rejects(pipeline([selectedIds[0]], 'chen-source-repeated-reject', [rejected, rejected]), error => error.code === 'CHEN_SOURCE_REVIEW_FAILED');
  const forged = structuredClone(library.entries[0]); forged.title = 'SOURCE_FORGED_IN_CONTEXT';
  await assert.rejects(codex.reviewVoice(runtime.root, chenPrompt + source.chenFitnessReferenceContext([forged]), reply('合成草稿'), async () => { throw Error('must fail before model'); }, loaded), error => error.code === 'CHEN_SOURCE_CHECK_INVALID');
  report.checks.push('A selected source requires an explicit source-level check in the existing reviewer; extra reject/search/rename intent fields cannot bypass review or add a normal call. Each spoofed intent retains the one-rewrite limit, repeated rejection blocks delivery, and a forged context cannot bypass the frozen source snapshot.');

  const topic = library.entries.find(entry => entry.topics.some(topic => topic.length >= 2))?.topics.find(topic => topic.length >= 2);
  assert.ok(topic, 'Actual library needs a topical index');
  const incoming = { id: 'offline-input', senderId: 'user', senderName: '合成用户', type: 'text', text: `我想了解${topic}`, mentionIds: ['chen-nian'], at: '2026-10-08T03:00:00Z' };
  const context = { kind: 'message', incoming, now: Date.parse(incoming.at), facts: { version: 'group-task-memory-20261007-v1', facts: [] }, group: {
    id: 'synthetic', name: '合成训练组', goal: '合成训练话题', sourceCharacterId: 'molly', createdAt: incoming.at, updatedAt: incoming.at,
    createdBy: 'molly', chatEnabled: true, namingSource: 'molly-model', messages: [incoming], members: [
      { id: 'user', name: '合成用户', role: 'user', joinedAt: incoming.at, order: 0 },
      { id: 'molly', name: 'Molly', role: 'admin', joinedAt: incoming.at, order: 1 },
      { id: 'chen-nian', name: '陈年', role: 'npc', joinedAt: incoming.at, order: 2 },
    ],
  } };
  const groupCalls = [];
  await generateGroupDialogue(runtime.root, context, async (_root, input) => {
    groupCalls.push(input);
    if (input.startsWith('你是智域群聊成品复核器')) return { verdict: 'keep', edits: [] };
    assert.ok(input.startsWith('你是智域群聊协作生成器'),'Explicit @ does not add routing or source-retrieval calls');
    return { messages: [{ senderId: 'chen-nian', text: '合成有依据的群回复', mentionIds: [] }] };
  });
  assert.equal(groupCalls.length, 2, 'Source references keep the existing generation plus review pipeline without an extra source retrieval');
  const groupPrompt = groupCalls[0];
  const groupSelected = jsonAfter(groupPrompt, source.chenFitnessReferenceMarker);
  assert.ok(groupSelected.length > 0 && groupSelected.length <= 3);
  assert.deepEqual(groupSelected, source.matchChenFitnessEntries(library, incoming.text));
  assert.deepEqual(jsonAfter(groupCalls[1], source.chenFitnessReferenceMarker), groupSelected,'The existing group review receives the same Chen source records');
  assert.match(groupPrompt, /只属于陈年/); assert.match(groupPrompt, /不读取人物私人关系/);
  assert.deepEqual(source.matchChenFitnessEntries(library, '今天电影挺好看'), []);
  for (const chestInput of ['我要练胸肌', '想练胸']) {
    const chest = source.matchChenFitnessEntries(library, chestInput);
    assert.ok(chest.length > 0 && chest.length <= 3, chestInput);
    assert.ok(chest.some(entry => entry.videoId === '7599135033329384443'), `Reviewed chest 2.0 must be discoverable for ${chestInput}`);
    assert.equal(chest[0].evidenceStatus, 'source_reviewed', 'A newer unread title must not displace reviewed relevant sources');
  }
  report.checks.push('Explicit-@ group source selection adds zero calls to the existing generation/review pipeline, selects 0–3 records by topical overlap inside Chen’s own Skill block, supplies the same records to review, and retains group/private-history isolation.');

  const missingPath = libraryFile + '.missing-test'; renameSync(libraryFile, missingPath);
  let calls = 0;
  try {
    await assert.rejects(codex.generate(runtime.root, chenPrompt, { characterId: 'chen-nian', runRaw: async () => { calls++; throw Error('must not call model'); } }), error => error.code === 'MODULE_MISSING' && error.path === libraryPath);
    assert.equal(calls, 0);
    if (chenScope) assert.ok(loadDialogueSkill(runtime.root, promptFor('xia-xia', '夏夏'), 'xia-xia'));
    else assert.ok(loadDialogueSkill(runtime.root, promptFor('zhou-chef', '赵一帆'), 'zhou-chef').chefRecipeLibrary);
  } finally { renameSync(missingPath, libraryFile); }
  report.checks.push(`Missing Chen library fails before any model call, while the independent ${chenScope ? 'Xiaxia' : 'chef'} loader still succeeds.`);
  report.passed = true;
  const reportName = chenScope ? 'knowledge-integration-chen-scope-validation.json' : 'knowledge-integration-validation.json';
  mkdirSync(roleSplitOutput, { recursive: true });
  writeFileSync(join(roleSplitOutput, reportName), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS Chen source library${chenScope ? ' (pending concurrent chef excluded explicitly)' : ''}: ${report.entryCount} real entries, ${report.sourceReviewed} reviewed and ${report.titleOnly} title-only; ${report.checks.length} isolated integration checks.`);
} finally { runtime.cleanup(); }
