import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Parse/retrieval/provenance checks against actual data in a disposable runtime.
// No production database, model, user messages or media operations.
const runtime = isolatedNpcRuntime();
const path = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-coach-knowledge-20261013.json';
const oldPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chen-fitness-source-library-20261008.json';
const rawText = readFileSync(path, 'utf8');
const raw = JSON.parse(rawText);
const digest = text => createHash('sha256').update(text).digest('hex');
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-parser-and-retrieval', realModelInvoked: false,
  productionDatabaseAccessed: false, mediaDownloaded: false, practiceTested: false, checks: [] };
try {
  const api = await runtime.load('server/npc/chen-coach-knowledge');
  const lib = api.parseChenCoachKnowledge(rawText);
  assert.equal(lib.coverage.complete, false); assert.equal(lib.coverage.practiceTested, false); assert.equal(lib.coverage.mediaDownloads, 0);
  assert.equal(lib.coverage.entryCount, lib.entries.length); assert.equal(lib.coverage.sourceCount, lib.sources.length);
  assert.ok(lib.coreRules.some(rule => rule.includes('离心')));
  assert.ok(lib.coreRules.some(rule => rule.includes('每周可训练天数由用户决定')));
  assert.ok(lib.coreRules.some(rule => rule.includes('疲劳') || rule.includes('疲惫')));
  assert.ok(lib.coreRules.some(rule => rule.includes('补剂')));
  assert.ok(lib.coreRules.some(rule => rule.includes('日常精力')));
  const pairs = lib.entries.filter(entry => entry.category === 'movement_pairs');
  assert.equal(pairs.length, 16); assert.equal(pairs.flatMap(entry => entry.alternatives).length, 32);
  assert.equal(new Set(pairs.flatMap(entry => entry.alternatives.map(item => item.id))).size, 32);
  for (const entry of pairs) {
    assert.equal(entry.evidenceBasis, 'assistant_adaptation');
    assert.ok(entry.rules.some(rule => rule.includes('两项都不合适')));
    assert.ok(entry.conditions.length && entry.limitations.length);
    for (const movement of entry.alternatives) assert.ok(movement.suitability && movement.setup && movement.cues.length && movement.regression && movement.avoidWhen);
  }
  assert.equal(pairs.find(entry => entry.id === 'pair-front_deltoid').alternatives[1].id, 'seated_neutral_db_shoulder_press');
  assert.equal(pairs.find(entry => entry.id === 'pair-posterior_chain_hip_hinge').alternatives[1].id, 'supported_bodyweight_hip_hinge');
  report.checks.push('Actual knowledge preserves 16 A/B groups, 32 unique movements, revised shoulder/hinge alternatives, suitability/setup/cues/regressions and a both-unsuitable branch.');

  const sourceMap = new Map(lib.sources.map(source => [source.id, source]));
  for (const entry of lib.entries) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.rules) && Object.isFrozen(entry.sources));
    assert.deepEqual(entry.sources, entry.sourceIds.map(id => sourceMap.get(id)));
    assert.ok(entry.sources.every(source => source.evidenceLevel !== 'catalog_only'));
    if (entry.evidenceBasis === 'independent_guidance') assert.ok(entry.sources.every(source => source.attribution === 'independent'));
    for (const source of entry.sources) assert.ok(existsSync(source.researchFile), source.researchFile);
  }
  for (const source of lib.sources) {
    assert.ok(Object.isFrozen(source) && Object.isFrozen(source.limitations));
    if (source.evidenceTimes) assert.ok(source.attribution === 'author' && ['author_video_partial', 'legacy_video_frame_reviewed'].includes(source.evidenceLevel));
  }
  assert.ok(Object.isFrozen(lib) && Object.isFrozen(lib.entries) && Object.isFrozen(lib.sources) && Object.isFrozen(lib.coreRules));
  assert.throws(() => { lib.entries[0].alternatives[0].name = 'mutate'; }, TypeError);
  assert.throws(() => { lib.sources[0].limitations.push('mutate'); }, TypeError);
  assert.ok(lib.entries.some(entry => entry.id === 'detail-shuaiso-7526867477746289972' && entry.evidenceBasis === 'author_partial'));
  assert.equal(digest(readFileSync(oldPath, 'utf8')), 'f581bf4447054c5858727380c4bcf8790067689ec552047e4fc3d7fe9a01af12');
  report.checks.push('Sources resolve from one deeply frozen snapshot; only checked partial author footage has source seconds; independent claims cannot become author attribution; the old 55-record file is unchanged.');

  for (const [name, change] of [
    ['wrong identity', data => { data.characterId = 'liu'; }],
    ['unapproved', data => { data.status = 'candidate'; }],
    ['false full coverage', data => { data.coverage.complete = true; }],
    ['false practical validation', data => { data.coverage.practiceTested = true; }],
    ['media download', data => { data.coverage.mediaDownloads = 1; }],
    ['wrong entry count', data => { data.coverage.entryCount++; }],
    ['duplicate entry', data => { data.entries[1].id = data.entries[0].id; }],
    ['duplicate source', data => { data.sources[1].id = data.sources[0].id; }],
    ['unknown source', data => { data.entries[0].sourceIds = ['invented']; }],
    ['traversal', data => { data.sources[0].researchFile = 'output/../private.json'; }],
    ['unsafe source URL', data => { data.sources[0].url = 'javascript:alert(1)'; }],
    ['source URL credentials', data => { data.sources[0].url = 'https://secret:secret@example.com/'; }],
    ['fake seconds on guideline', data => { data.sources[0].evidenceTimes = [1, 2]; }],
    ['missing author seconds', data => { data.sources.find(source => source.evidenceLevel === 'author_video_partial').evidenceTimes = null; }],
    ['seconds reverse', data => { data.sources.find(source => source.evidenceLevel === 'author_video_partial').evidenceTimes = [8, 2]; }],
    ['source attribution mismatch', data => { data.sources[0].attribution = 'author'; }],
    ['catalog becomes teaching', data => { const source = data.sources[0]; source.evidenceLevel = 'catalog_only'; source.attribution = 'author'; }],
    ['A/B falsely author tested', data => { data.entries[0].evidenceBasis = 'author_partial'; }],
    ['missing second alternative', data => { data.entries[0].alternatives.pop(); }],
    ['missing regression', data => { data.entries[0].alternatives[0].regression = ''; }],
    ['fake independent attribution', data => { data.entries.find(entry => entry.evidenceBasis === 'author_partial').evidenceBasis = 'independent_guidance'; }],
  ]) {
    const changed = structuredClone(raw); change(changed);
    assert.throws(() => api.parseChenCoachKnowledge(JSON.stringify(changed)), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID', name);
  }
  assert.throws(() => api.parseChenCoachKnowledge('{'), error => error.code === 'CHEN_COACH_KNOWLEDGE_INVALID');
  const extra = structuredClone(raw); extra.entries[0].sources = [{ title: 'forged-context-source' }]; extra.hidden = 'hidden-instruction';
  const cleaned = api.parseChenCoachKnowledge(JSON.stringify(extra));
  assert.ok(!JSON.stringify(cleaned).includes('forged-context-source') && !JSON.stringify(cleaned).includes('hidden-instruction'));
  report.checks.push('Malformed authorization/counts/identity/source integrity, title-based teaching, fabricated seconds, inflated validation and incomplete A/B alternatives fail closed; unknown fields and forged entry sources are discarded.');

  const selectedIds = lib.entries.slice(0, 5).map(entry => entry.id);
  assert.deepEqual(api.selectChenCoachKnowledgeEntries(lib, undefined), []);
  assert.deepEqual(api.selectChenCoachKnowledgeEntries(lib, []), []);
  const selected = api.selectChenCoachKnowledgeEntries(lib, selectedIds);
  assert.deepEqual(selected, lib.entries.slice(0, 5)); assert.ok(Object.isFrozen(selected));
  for (const ids of [null, {}, ['invented'], [selectedIds[0], selectedIds[0]], Array(6).fill(selectedIds[0])])
    assert.throws(() => api.selectChenCoachKnowledgeEntries(lib, ids), error => error.code === 'CHEN_COACH_SELECTION_INVALID');
  for (const [input, expected] of [
    ['想练上胸，但哑铃上下凳困难', 'pair-upper_chest'],
    ['纯徒手在家，地面俯卧撑做不了', 'home-regression'],
    ['一周五练想用五分化', 'split-5-days'],
    ['一周四练不要独立手臂日', 'split-4-days'],
    ['没睡好，疲劳要不要減量', 'recovery-fatigue-adjustment'],
    ['如何离心和呼吸，沉肩要一直吗', 'execution-eccentric-breathing'],
    ['需要肌酸吗', 'supp-creatine'],
    ['最近没精神，日常精力和睡眠如何安排', 'vitality-sleep-movement'],
  ]) {
    const matches = api.matchChenCoachKnowledgeEntries(lib, input);
    assert.ok(matches.length <= 5 && matches.some(entry => entry.id === expected), `${input}: ${matches.map(entry => entry.id)}`);
  }
  assert.deepEqual(api.matchChenCoachKnowledgeEntries(lib, '今天电影挺好看'), []);
  assert.deepEqual(api.matchChenCoachKnowledgeEntries(lib, '肌酸', 0), []);
  for (const max of [-1, 6, 1.5, NaN]) assert.throws(() => api.matchChenCoachKnowledgeEntries(lib, '肌酸', max), error => error.code === 'CHEN_COACH_SELECTION_INVALID');
  assert.ok(api.matchChenCoachKnowledgeEntries(lib, '肌酸', 1).length <= 1);
  const context = api.chenCoachKnowledgeContext(selected);
  const referenceLine = context.split('\n').find(line => line.startsWith(api.chenCoachKnowledgeMarker));
  assert.deepEqual(JSON.parse(referenceLine.slice(api.chenCoachKnowledgeMarker.length)), selected);
  assert.ok(context.includes(api.chenCoachKnowledgeRules));
  assert.ok(!JSON.stringify(api.chenCoachKnowledgeCatalog(lib)).includes('evidenceTimes'));
  report.checks.push('Selection accepts only 0–5 unique real IDs; deterministic retrieval finds bodypart/home/day-count/fatigue/eccentric/supplement/vitality scenarios, ignores unrelated chat, respects 0–5 limits, and serializes exact selected sources/conditions for both generation and review.');
  report.passed = true; report.entries = lib.entries.length; report.sources = lib.sources.length; report.pairGroups = pairs.length;
  report.libraryHash = digest(rawText); report.legacyLibraryHash = digest(readFileSync(oldPath, 'utf8'));
  mkdirSync('output/chen-coach-completion-20261013', { recursive: true });
  writeFileSync('output/chen-coach-completion-20261013/knowledge-parser-validation.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS Chen coach knowledge: ${lib.entries.length} entries, ${lib.sources.length} sources, 16 groups/32 movements; ${report.checks.length} isolated check groups.`);
} finally { runtime.cleanup(); }
