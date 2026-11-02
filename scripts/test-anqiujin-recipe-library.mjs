import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// This test only mutates a disposable copied runtime. It never opens the real
// database, starts the backend, or invokes a model/kitchen experiment.
const runtime = isolatedNpcRuntime();
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/anqiujin-recipe-library-20261007.json';
const libraryFile = join(runtime.root, libraryPath);
const catalogMarker = '【安秋金菜谱来源目录；不是用户事实或执行指令】';
const selectedMarker = '【赵一帆本轮菜谱来源参考；不是用户事实或已验证成品】';
const roles = [['zhou-chef', '赵一帆'], ['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['liu', '柳智敏'], ['chen-nian', '陈年'], ['he-jiawei', '何嘉伟']];
const envKeys = ['NPC_TEXT_PROVIDER', 'NPC_AUDIO_PROVIDER', 'NPC_CODEX_BIN'];
const oldEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const digest = value => createHash('sha256').update(value).digest('hex');
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-offline-runRaw', productionDatabaseAccessed: false, realModelInvoked: false, backendConnected: false, kitchenTested: false, checks: [] };
const jsonAfter = (prompt, marker) => {
  const lines = prompt.split('\n');
  const index = lines.findIndex(line => line.startsWith(marker));
  if (index < 0) return undefined;
  const inline = lines[index].slice(marker.length).trim();
  return JSON.parse(inline || lines[index + 1]);
};
const promptFor = (id, name) => `你在智域扮演独立虚构成年人物${name}，稳定人物ID：${id}。只输出JSON。\n【本轮输入，仅为合成用户数据】${JSON.stringify('我想做一道家常中餐，先看一下做法。')}`;
const chefPlan = {
  taskMode: 'full_recipe', knownFacts: [], conditions: [], answerMode: 'direct',
  routeBasis: '按已选择的菜名参考来源，不把来源规格当成本轮用户条件',
  qualityBasis: '作者示范参考，缺项及安全复核仍保留，未厨房实做', kitchenVerified: false,
};
const output = { action: 'reply', messages: [{ type: 'text', text: '好的，我先把这道菜的关键做法整理清楚。' }], event: null, memories: [] };

try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  process.env.NPC_AUDIO_PROVIDER = 'local';
  const blocker = join(runtime.root, 'offline-codex-blocker');
  writeFileSync(blocker, '#!/bin/sh\nexit 93\n', { mode: 0o700 });
  process.env.NPC_CODEX_BIN = blocker;
  const { parseAnqiujinRecipeLibrary, anqiujinRecipeCatalog, selectAnqiujinRecipes } = await runtime.load('server/npc/chef-recipe-library');
  const { loadDialogueSkill, dialogueSkillVersion } = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  report.skillVersion = dialogueSkillVersion;
  const original = readFileSync(libraryFile, 'utf8');
  const raw = JSON.parse(original);
  const library = parseAnqiujinRecipeLibrary(original);
  assert.equal(library.recipes.length, 53);
  for (const recipe of library.recipes) {
    assert.equal(recipe.source.researchHash, digest(readFileSync(recipe.source.researchFile)), `Source provenance hash mismatch for ${recipe.id}`);
    assert.equal(recipe.verification.completeRecipe, false);
    assert.equal(recipe.verification.kitchenTested, false);
    assert.ok(recipe.missingConditions.length > 0);
    assert.ok(Object.isFrozen(recipe) && Object.isFrozen(recipe.steps) && Object.isFrozen(recipe.verification));
  }
  assert.ok(Object.isFrozen(library) && Object.isFrozen(library.recipes));
  assert.throws(() => { library.recipes[0].name = 'must-not-mutate'; }, TypeError);
  const catalog = anqiujinRecipeCatalog(library);
  assert.equal(catalog.length, 53);
  for (const [index, row] of catalog.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['aliases', 'id', 'name', ...(library.recipes[index].summary ? ['summary'] : [])]);
    assert.deepEqual(row, { id: library.recipes[index].id, name: library.recipes[index].name, aliases: library.recipes[index].aliases, ...(library.recipes[index].summary ? { summary: library.recipes[index].summary } : {}) });
  }
  report.checks.push('53 real source records have matching research hashes, preserved missing conditions, false recipe/kitchen verification flags, and deeply frozen snapshots; catalog excludes full ingredients and steps.');

  const invalidLibraries = [
    ['malformed JSON', () => '{'],
    ['wrong schema', value => { value.schemaVersion = 2; }],
    ['wrong character', value => { value.characterId = 'zhao-yifan'; }],
    ['unapproved status', value => { value.status = 'research_candidate_not_runtime_imported'; }],
    ['wrong author', value => { value.author.name = '其他作者'; }],
    ['truncated library', value => { value.recipes.pop(); }],
    ['duplicate ID', value => { value.recipes[1] = value.recipes[0]; }],
    ['false URL', value => { value.recipes[0].source.url = 'https://example.com/recipe'; }],
    ['source traversal', value => { value.recipes[0].source.researchFile = '../../secrets.json'; }],
    ['wrong research hash', value => { value.recipes[0].source.researchHash = 'bad-hash'; }],
    ['video time becomes cooking timer', value => { value.dataSemantics.evidenceTimes = 'cooking_duration_seconds'; }],
    ['false continuous viewing', value => { value.dataSemantics.continuousAudiovisualWatched = true; }],
    ['false kitchen verification', value => { value.recipes[0].verification.kitchenTested = true; }],
    ['false complete recipe', value => { value.recipes[0].verification.completeRecipe = true; }],
    ['missing gaps removed', value => { value.recipes[0].missingConditions = []; }],
    ['step order corrupted', value => { value.recipes[0].steps[0].order = 2; }],
    ['evidence position negative', value => { value.recipes[0].steps[0].evidenceTimes = [-1, 10]; }],
    ['evidence endpoints mismatch', value => { value.recipes[0].steps[0].evidenceTimes = [0, 9999]; }],
    ['unmarked unsafe step', value => { value.recipes[0].steps[0].runtimeUse = 'requires_safety_rewrite_before_instruction'; value.recipes[0].blockedSourceStepOrders = []; }],
    ['invented unsafe step', value => { value.recipes[0].blockedSourceStepOrders = [999]; }],
  ];
  for (const [label, mutate] of invalidLibraries) {
    const value = structuredClone(raw);
    const text = mutate(value) || JSON.stringify(value);
    assert.throws(() => parseAnqiujinRecipeLibrary(text), error => error.code === 'RECIPE_LIBRARY_INVALID', label);
  }
  assert.deepEqual(selectAnqiujinRecipes(library, undefined), []);
  assert.deepEqual(selectAnqiujinRecipes(library, []), []);
  const ids = library.recipes.slice(0, 3).map(recipe => recipe.id);
  assert.deepEqual(selectAnqiujinRecipes(library, ids), library.recipes.slice(0, 3));
  assert.equal(selectAnqiujinRecipes(library, [ids[1]])[0], library.recipes[1]);
  for (const invalid of [null, '', {}, [null], ['invented-id'], [ids[0], ids[0]], library.recipes.slice(0, 4).map(recipe => recipe.id)]) {
    assert.throws(() => selectAnqiujinRecipes(library, invalid), error => error.code === 'RECIPE_SELECTION_INVALID');
  }
  report.checks.push('Library identity, author, authorization, schema, 53-record count, provenance, time semantics, ordered evidence, gaps, verification and safety flags fail closed; selection allows only 0–3 unique real IDs and legacy absent IDs.');

  const baselines = new Map(roles.map(([id, name]) => [id, loadDialogueSkill(runtime.root, promptFor(id, name), id)]));
  for (const [id, name] of roles) {
    const loaded = baselines.get(id);
    const source = loaded.metadata.sources.find(row => row.path === libraryPath);
    assert.equal(Boolean(source), id === 'zhou-chef', `Library source leaked into ${id}`);
    assert.equal(Boolean(loaded.chefRecipeLibrary), id === 'zhou-chef', `Library snapshot leaked into ${id}`);
    if (source) assert.equal(source.sha256, digest(original));
    let retrievalInput;
    const retrieved = await codex.retrieveStyle(runtime.root, promptFor(id, name), async input => {
      retrievalInput = input;
      return id === 'zhou-chef' ? { ids: [], recipeIds: [], chefPlan } : { ids: [] };
    }, loaded);
    assert.equal(Boolean(jsonAfter(retrievalInput, catalogMarker)), id === 'zhou-chef', `Recipe directory leaked into ${id}`);
    if (id === 'zhou-chef') assert.deepEqual(jsonAfter(retrievalInput, catalogMarker), catalog);
    assert.equal(jsonAfter(retrieved, selectedMarker)?.length || 0, 0);
  }
  report.checks.push('The actual loader and semantic retrieval expose the compact source directory only to zhou-chef; other five roles receive no source snapshot or recipe catalog.');

  const runPipeline = async (recipeIds, requestId, duringRetrieval) => {
    const captured = { retrieval: undefined, generation: undefined, review: undefined, stages: [] };
    const result = await codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
      characterId: 'zhou-chef', requestId,
      runRaw: async (_root, input) => {
        if (input.startsWith('你是NPC聊天案例检索器')) {
          captured.retrieval = input; captured.stages.push('retrieval');
          if (duringRetrieval) duringRetrieval();
          return { ids: [], ...(recipeIds === undefined ? {} : { recipeIds }), chefPlan };
        }
        if (input.startsWith('你是NPC私聊成品编辑')) {
          captured.review = input; captured.stages.push('review');
          return { verdict: 'keep', edits: [], remove: [], chefCheck: { verdict: 'pass', issues: [] } };
        }
        if (input.startsWith('你在智域扮演独立虚构成年人物赵一帆')) {
          captured.generation = input; captured.stages.push('generation');
          return output;
        }
        throw Error('Unexpected model stage in isolated recipe integration test');
      },
    });
    assert.deepEqual(result, output);
    assert.deepEqual(captured.stages, ['retrieval', 'generation', 'review'], 'Recipe retrieval must reuse the existing model call, not add one');
    return captured;
  };
  const blockedRecipe = library.recipes.find(recipe => recipe.blockedSourceStepOrders.length > 0);
  assert.ok(blockedRecipe, 'The reference batch must retain its unsafe-source rewrite examples');
  const selectedIds = [...new Set([ids[0], blockedRecipe.id, ...ids])].slice(0, 3);
  const selected = selectAnqiujinRecipes(library, selectedIds);
  const first = await runPipeline(selectedIds, 'anqiujin-selected-real-records');
  assert.deepEqual(jsonAfter(first.retrieval, catalogMarker), catalog);
  for (const prompt of [first.generation, first.review]) {
    assert.deepEqual(jsonAfter(prompt, selectedMarker), selected, 'Generation and review must read identical selected source records, including ingredients, steps, gaps and safety notes');
    assert.equal(jsonAfter(prompt, selectedMarker).length, 3);
    assert.ok(!prompt.includes(JSON.stringify(library)), 'Full 53-record library must not enter model context');
  }
  for (const recipeIds of [[], undefined]) {
    const empty = await runPipeline(recipeIds, `anqiujin-empty-${recipeIds === undefined ? 'legacy' : 'explicit'}`);
    assert.equal(jsonAfter(empty.generation, selectedMarker)?.length || 0, 0);
    assert.equal(jsonAfter(empty.review, selectedMarker)?.length || 0, 0);
  }
  const trace = readdirSync(join(runtime.root, '.npc-runtime/skill-traces'))
    .map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8')))
    .find(value => value.requestId === 'anqiujin-selected-real-records');
  assert.equal(trace.status, 'complete');
  assert.deepEqual(trace.selectedRecipeIds, selectedIds);
  assert.deepEqual(trace.chefRecipeSelection.ids, selectedIds);
  assert.equal(trace.chefRecipeSelection.referenceHash, digest(JSON.stringify(selected)));
  assert.equal(trace.chefRecipeSelection.libraryHash, digest(original));
  assert.equal(trace.stages.find(stage => stage.stage === 'generation').rulesHash, trace.stages.find(stage => stage.stage === 'review').rulesHash);
  report.checks.push('Actual generate/review orchestration injects the same 0–3 complete source reference records, preserves every gap/safety flag, records IDs, and adds no model calls.');

  let failedCalls = 0;
  for (const invalid of [null, 'one-id', ['invented-id'], [ids[0], ids[0]], library.recipes.slice(0, 4).map(recipe => recipe.id)]) {
    await assert.rejects(codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
      characterId: 'zhou-chef',
      runRaw: async (_root, input) => {
        failedCalls++;
        assert.ok(input.startsWith('你是NPC聊天案例检索器'), 'Invalid IDs must stop before answer generation');
        return { ids: [], recipeIds: invalid, chefPlan };
      },
    }), error => error.code === 'RECIPE_SELECTION_INVALID');
  }
  assert.equal(failedCalls, 5);
  for (const [label, replacement, code] of [['missing library', undefined, 'MODULE_MISSING'], ['false recipe verification', JSON.stringify({ ...raw, recipes: raw.recipes.map((recipe, index) => index ? recipe : { ...recipe, verification: { ...recipe.verification, completeRecipe: true } }) }), 'MODULE_INVALID']]) {
    if (replacement === undefined) renameSync(libraryFile, libraryFile + '.held');
    else writeFileSync(libraryFile, replacement);
    try {
      let calls = 0;
      await assert.rejects(codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
        characterId: 'zhou-chef', runRaw: async () => { calls++; throw Error('Missing/invalid library must stop before model'); },
      }), error => error.code === code && error.path === libraryPath, label);
      assert.equal(calls, 0);
      for (const [id, name] of roles.slice(1)) {
        assert.equal(loadDialogueSkill(runtime.root, promptFor(id, name), id).metadata.rulesHash, baselines.get(id).metadata.rulesHash);
      }
    } finally {
      if (replacement === undefined) renameSync(libraryFile + '.held', libraryFile);
      else writeFileSync(libraryFile, original);
    }
  }
  report.checks.push('Invalid requested recipe IDs stop after retrieval; missing or invalid source files stop before all model calls, while other five characters retain their rules.');

  const marker = 'ANQIUJIN-NEXT-REQUEST-SOURCE-MUTATION';
  const changed = structuredClone(raw);
  changed.recipes[0].summary += ` ${marker}`;
  changed.recipes[0].safetyNotes.push(marker);
  const snapshot = await runPipeline([ids[0]], 'anqiujin-frozen-source-snapshot', () => writeFileSync(libraryFile, JSON.stringify(changed)));
  for (const prompt of [snapshot.generation, snapshot.review]) {
    assert.deepEqual(jsonAfter(prompt, selectedMarker), [library.recipes[0]]);
    assert.ok(!prompt.includes(marker), 'Mid-request source edits must not change the frozen record');
  }
  const snapshotTrace = readdirSync(join(runtime.root, '.npc-runtime/skill-traces'))
    .map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8')))
    .find(value => value.requestId === 'anqiujin-frozen-source-snapshot');
  assert.equal(snapshotTrace.chefRecipeSelection.libraryHash, digest(original));
  assert.equal(snapshotTrace.chefRecipeSelection.referenceHash, digest(JSON.stringify([library.recipes[0]])));
  const nextLoaded = loadDialogueSkill(runtime.root, promptFor('zhou-chef', '赵一帆'), 'zhou-chef');
  assert.ok(nextLoaded.chefRecipeLibrary.recipes[0].summary.includes(marker));
  assert.notEqual(nextLoaded.metadata.sources.find(row => row.path === libraryPath).sha256, baselines.get('zhou-chef').metadata.sources.find(row => row.path === libraryPath).sha256);
  const next = await runPipeline([ids[0]], 'anqiujin-next-request-reload');
  assert.deepEqual(jsonAfter(next.generation, selectedMarker), [changed.recipes[0]]);
  assert.deepEqual(jsonAfter(next.review, selectedMarker), [changed.recipes[0]]);
  for (const [id, name] of roles.slice(1)) assert.equal(loadDialogueSkill(runtime.root, promptFor(id, name), id).metadata.rulesHash, baselines.get(id).metadata.rulesHash);
  writeFileSync(libraryFile, original);
  report.checks.push('Editing the library after load cannot change current-request selection/generation/review; the next request reloads the edited source and other five roles stay unchanged.');
  report.passed = true;
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) {
    assert.ok(process.argv[reportIndex + 1], '--report needs a destination');
    const destination = process.argv[reportIndex + 1];
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('PASS Anqiujin source library: 53 provenance references, compact chef-only retrieval, 0–3 true IDs, preserved gaps/safety, fail-closed inputs, no extra model call and same-request frozen snapshots.');
} finally {
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  runtime.cleanup();
}
