import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// All mutations, traces and model stubs use a disposable copied runtime.
// The source research files are read only for provenance hash verification.
const runtime = isolatedNpcRuntime();
const libraryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/western-dessert-recipe-library-20261008.json';
const methodsPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/chef-western-dessert-methods.md';
const primaryPath = 'npc-skills/skills/zhiyu-professional-dialogue/references/anqiujin-recipe-library-20261007.json';
const libraryFile = join(runtime.root, libraryPath);
const catalogMarker = '【主厨广坦西餐甜品来源目录；不是用户事实或执行指令】';
const selectedMarker = '【赵一帆本轮西餐甜品来源参考；不是用户事实或已验证成品】';
const primaryMarker = '【赵一帆本轮菜谱来源参考；不是用户事实或已验证成品】';
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
const promptFor = (id, name) => `你在智域扮演独立虚构成年人物${name}，稳定人物ID：${id}。只输出JSON。\n【本轮输入，仅为合成用户数据】${JSON.stringify('我想了解一道西餐或甜品的做法。')}`;
const chefPlan = { taskMode: 'full_recipe', knownFacts: [], conditions: [], answerMode: 'direct', routeBasis: '按真实菜名和技法选来源，不假定研究条件属于当前用户', qualityBasis: '公开示范来源，缺项及安全仍保留，未厨房实做', kitchenVerified: false };
const output = { action: 'reply', messages: [{ type: 'text', text: '好的，我先把这道菜的关键做法整理清楚。' }], event: null, memories: [] };

try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  process.env.NPC_AUDIO_PROVIDER = 'local';
  const blocker = join(runtime.root, 'offline-codex-blocker');
  writeFileSync(blocker, '#!/bin/sh\nexit 93\n', { mode: 0o700 });
  process.env.NPC_CODEX_BIN = blocker;
  const { parseWesternDessertRecipeLibrary, westernDessertRecipeCatalog, selectWesternDessertRecipes, validateChefReferenceSelectionCount } = await runtime.load('server/npc/chef-western-dessert-library');
  const { parseAnqiujinRecipeLibrary, selectAnqiujinRecipes } = await runtime.load('server/npc/chef-recipe-library');
  const { loadDialogueSkill, dialogueSkillVersion } = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  report.skillVersion = dialogueSkillVersion;
  const original = readFileSync(libraryFile, 'utf8');
  const raw = JSON.parse(original);
  const library = parseWesternDessertRecipeLibrary(original);
  const primaryOriginal = readFileSync(join(runtime.root, primaryPath), 'utf8');
  const primary = parseAnqiujinRecipeLibrary(primaryOriginal);
  assert.equal(library.recipes.length, library.coverage.cookingSamples);
  assert.equal(primary.recipes.length, 53);
  const beforeFile = 'output/western-dessert-runtime-integration-20261008/before-rules-hashes.json';
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
  assert.equal(digest(primaryOriginal), before.anqiujinHash, 'The original 53-record library must stay byte-for-byte unchanged');
  for (const recipe of library.recipes) {
    assert.equal(recipe.source.researchHash, digest(readFileSync(recipe.source.researchFile)), `Source research hash mismatch for ${recipe.id}`);
    assert.equal(recipe.verification.completeRecipe, false);
    assert.equal(recipe.verification.kitchenTested, false);
    assert.equal(recipe.verification.noviceReplicated, false);
    assert.ok(recipe.missingConditions.length > 0);
    assert.ok(Object.isFrozen(recipe) && Object.isFrozen(recipe.steps) && Object.isFrozen(recipe.verification));
    assert.equal(recipe.reviewMethod, 'full-span_sampled_visual_review_with_subtitle_supplement');
    assert.ok(['western', 'dessert'].includes(recipe.domain));
  }
  assert.ok(Object.isFrozen(library) && Object.isFrozen(library.recipes));
  assert.throws(() => { library.recipes[0].name = 'must-not-mutate'; }, TypeError);
  const catalog = westernDessertRecipeCatalog(library);
  assert.equal(catalog.length, library.recipes.length);
  for (const [index, row] of catalog.entries()) {
    const recipe = library.recipes[index];
    assert.deepEqual(row, { id: recipe.id, name: recipe.name, domain: recipe.domain, aliases: recipe.aliases, ...(recipe.summary ? { summary: recipe.summary } : {}) });
    assert.deepEqual(Object.keys(row).sort(), ['aliases', 'domain', 'id', 'name', ...(recipe.summary ? ['summary'] : [])]);
  }
  report.coverage = { cookingSamples: library.recipes.length, western: library.recipes.filter(recipe => recipe.domain === 'western').length, dessert: library.recipes.filter(recipe => recipe.domain === 'dessert').length, sourceActions: library.recipes.reduce((sum, recipe) => sum + recipe.steps.length, 0) };
  report.checks.push('Actual source count, per-record domains, visual review methods, provenance hashes, gaps, safety and false kitchen/novice/complete flags are preserved in deeply frozen snapshots; the original Anqiujin 53-record JSON is unchanged.');

  const invalidLibraries = [
    ['malformed JSON', () => '{'],
    ['wrong schema', value => { value.schemaVersion = 2; }],
    ['wrong character', value => { value.characterId = 'zhao-yifan'; }],
    ['unapproved status', value => { value.status = 'research_candidate_not_runtime_imported'; }],
    ['wrong author', value => { value.author.name = '其他作者'; }],
    ['wrong account', value => { value.author.account = 'other-account'; }],
    ['empty library', value => { value.recipes = []; value.coverage.cookingSamples = 0; }],
    ['coverage mismatch', value => { value.coverage.cookingSamples++; }],
    ['wrong ID namespace', value => { value.recipes[0].id = `aqj-${value.recipes[0].videoId}`; }],
    ['duplicate ID', value => { value.recipes.push(value.recipes[0]); value.coverage.cookingSamples++; }],
    ['unknown domain', value => { value.recipes[0].domain = 'all-world-cooking'; }],
    ['unreviewed title promoted to observation', value => { value.recipes[0].reviewMethod = 'title_only'; }],
    ['false URL', value => { value.recipes[0].source.url = 'https://example.com/recipe'; }],
    ['source traversal', value => { value.recipes[0].source.researchFile = '../../secrets.json'; }],
    ['wrong hash', value => { value.recipes[0].source.researchHash = 'bad-hash'; }],
    ['video time becomes cooking timer', value => { value.dataSemantics.evidenceTimes = 'cooking_duration_seconds'; }],
    ['false continuous viewing', value => { value.dataSemantics.continuousAudiovisualWatched = true; }],
    ['false kitchen verification', value => { value.recipes[0].verification.kitchenTested = true; }],
    ['false novice verification', value => { value.recipes[0].verification.noviceReplicated = true; }],
    ['false complete recipe', value => { value.recipes[0].verification.completeRecipe = true; }],
    ['missing gaps removed', value => { value.recipes[0].missingConditions = []; }],
    ['step order corrupted', value => { value.recipes[0].steps[0].order = 2; }],
    ['evidence position negative', value => { value.recipes[0].steps[0].evidenceTimes = [-1, 10]; }],
    ['evidence endpoints mismatch', value => { value.recipes[0].steps[0].evidenceTimes = [0, 9999]; }],
    ['unmarked unsafe step', value => { value.recipes[0].steps[0].runtimeUse = 'requires_safety_rewrite_before_instruction'; value.recipes[0].blockedSourceStepOrders = []; }],
    ['invented unsafe step', value => { value.recipes[0].blockedSourceStepOrders = [999]; }],
    ['malformed safety object', value => { value.recipes[0].safetyNotes = [{ stepOrders: [1], reason: '危险', requiredRewrite: '', basisSeconds: [0] }]; }],
    ['safety step out of range', value => { value.recipes[0].safetyNotes = [{ stepOrders: [999], reason: '危险', requiredRewrite: '先核验条件', basisSeconds: [0] }]; }],
    ['safety evidence negative', value => { value.recipes[0].safetyNotes = [{ stepOrders: [1], reason: '危险', requiredRewrite: '先核验条件', basisSeconds: [-1] }]; }],
    ['structured safety rewrite not reflected in step flags', value => {
      const recipe = value.recipes[0];
      const step = recipe.steps.find(candidate => candidate.runtimeUse === 'source_reference') || recipe.steps[0];
      step.runtimeUse = 'source_reference';
      recipe.blockedSourceStepOrders = recipe.blockedSourceStepOrders.filter(order => order !== step.order);
      recipe.safetyNotes = [{ stepOrders: [step.order], reason: '这个动作需改写', requiredRewrite: '按适用条件替换操作', basisSeconds: [0] }];
    }],
  ];
  for (const [label, mutate] of invalidLibraries) {
    const value = structuredClone(raw);
    assert.throws(() => parseWesternDessertRecipeLibrary(mutate(value) || JSON.stringify(value)), error => error.code === 'RECIPE_LIBRARY_INVALID', label);
  }
  const ids = library.recipes.slice(0, 3).map(recipe => recipe.id);
  const primaryIds = primary.recipes.slice(0, 3).map(recipe => recipe.id);
  assert.deepEqual(selectWesternDessertRecipes(library, undefined), []);
  assert.deepEqual(selectWesternDessertRecipes(library, []), []);
  assert.deepEqual(selectWesternDessertRecipes(library, ids), library.recipes.slice(0, 3));
  for (const invalid of [null, '', {}, [null], ['invented-id'], [primaryIds[0]], [ids[0], ids[0]], Array(4).fill(ids[0])]) {
    assert.throws(() => selectWesternDessertRecipes(library, invalid), error => error.code === 'RECIPE_SELECTION_INVALID');
  }
  assert.throws(() => selectAnqiujinRecipes(primary, [ids[0]]), error => error.code === 'RECIPE_SELECTION_INVALID');
  validateChefReferenceSelectionCount(primary.recipes.slice(0, 2), library.recipes.slice(0, 1));
  assert.throws(() => validateChefReferenceSelectionCount(primary.recipes.slice(0, 3), library.recipes.slice(0, 1)), error => error.code === 'RECIPE_SELECTION_INVALID');
  report.checks.push('Wrong identity/author/coverage/evidence/verification/safety fail closed; publisher namespaces remain separate, absent new IDs are backwards compatible, and both chef libraries combined cannot exceed three selected records.');

  const baselines = new Map(roles.map(([id, name]) => [id, loadDialogueSkill(runtime.root, promptFor(id, name), id)]));
  // Keep the original checkpoint. A parallel Chen task can legitimately change
  // Chen's documents and loader; do not erase that history to make hashes pass.
  // Compare current code with only this task's western additions removed as
  // well as the true historical loader reading today's source documents.
  const currentLoaderSource = readFileSync('server/npc/dialogue-skill.ts', 'utf8');
  const historicalLoaderSource = readFileSync('output/western-dessert-runtime-integration-20261008/before/dialogue-skill.ts', 'utf8');
  const removeOnce = (source, fragment) => {
    assert.ok(source.includes(fragment), 'The western-only counterfactual must match the current loader exactly');
    assert.equal(source.indexOf(fragment), source.lastIndexOf(fragment), 'Counterfactual removal must be unique');
    return source.replace(fragment, '');
  };
  let withoutWestern = currentLoaderSource;
  for (const fragment of [
    "import { parseWesternDessertRecipeLibrary, type WesternDessertRecipeLibrary } from './chef-western-dessert-library';\n",
    '  /** Separate western/dessert source snapshot; combined chef selection is at most three. */\n  chefWesternDessertLibrary?: WesternDessertRecipeLibrary;\n',
    '  let chefWesternDessertLibrary: WesternDessertRecipeLibrary | undefined;\n',
    '    ...(chefWesternDessertLibrary ? { chefWesternDessertLibrary } : {}),\n',
  ]) withoutWestern = removeOnce(withoutWestern, fragment);
  const westernBlock = withoutWestern.match(/    const westernMethodsPath = [\s\S]*?(?=    const examplesPath =)/g);
  assert.equal(westernBlock?.length, 1, 'Exactly one chef-specific western block is removed');
  withoutWestern = removeOnce(withoutWestern, westernBlock[0]);
  const loadComparison = async (name, source) => {
    const rewritten = source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.mjs$3');
    writeFileSync(join(runtime.root, 'server/npc', name + '.mjs'), ts.transpileModule(rewritten, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
    return (await runtime.load('server/npc/' + name)).loadDialogueSkill;
  };
  const historicalLoader = await loadComparison('dialogue-skill-historical-comparison', historicalLoaderSource);
  const withoutWesternLoader = await loadComparison('dialogue-skill-without-western-comparison', withoutWestern);
  report.nonChefIsolation = { originalCheckpointPreserved: true, currentLoaderHash: digest(currentLoaderSource), historicalLoaderHash: digest(historicalLoaderSource), isolatedLoaderWithoutWesternHash: digest(withoutWestern), roles: {} };
  for (const [id, name] of roles) {
    const loaded = baselines.get(id);
    assert.equal(Boolean(loaded.chefWesternDessertLibrary), id === 'zhou-chef', `Western snapshot leaked into ${id}`);
    for (const path of [libraryPath, methodsPath]) {
      assert.equal(Boolean(loaded.metadata.sources.find(source => source.path === path)), id === 'zhou-chef', `Source ${path} leaked into ${id}`);
    }
    if (id !== 'zhou-chef') {
      const comparison = withoutWesternLoader(runtime.root, promptFor(id, name), id);
      const historical = historicalLoader(runtime.root, promptFor(id, name), id);
      assert.equal(loaded.metadata.rulesHash, comparison.metadata.rulesHash, `Western additions changed another person's rules: ${id}`);
      if (id !== 'chen-nian') assert.equal(loaded.metadata.rulesHash, before.records[id].rulesHash, `Other-person historical rules changed: ${id}`);
      report.nonChefIsolation.roles[id] = {
        originalCheckpointHash: before.records[id].rulesHash,
        currentHash: loaded.metadata.rulesHash,
        currentDocsHistoricalLoaderHash: historical.metadata.rulesHash,
        currentDocsLoaderWithoutWesternHash: comparison.metadata.rulesHash,
        unchangedFromOriginalCheckpoint: loaded.metadata.rulesHash === before.records[id].rulesHash,
        unaffectedByWesternAdditions: true,
        ...(id === 'chen-nian' ? { concurrentChange: 'Chen fitness guidance/library and loader were independently updated in parallel; compare with the western-only additions removed, preserving all concurrent Chen changes.' } : {}),
      };
    }
    let retrievalInput;
    await codex.retrieveStyle(runtime.root, promptFor(id, name), async input => {
      retrievalInput = input;
      return id === 'zhou-chef' ? { ids: [], recipeIds: [], westernDessertRecipeIds: [], chefPlan } : { ids: [], fitnessEntryIds: [] };
    }, loaded);
    assert.equal(Boolean(jsonAfter(retrievalInput, catalogMarker)), id === 'zhou-chef', `Western directory leaked into ${id}`);
    if (id === 'zhou-chef') assert.deepEqual(jsonAfter(retrievalInput, catalogMarker), catalog);
  }
  report.checks.push('Only zhou-chef receives western/dessert modules, snapshot and compact directory. Four other roles retain the original checkpoint hashes; Chen parallel changes are separately recorded. All five match current documents with only western loader additions removed.');

  const runPipeline = async ({ westernIds, primaryIds: requestedPrimary, requestId, duringRetrieval }) => {
    const captured = { retrieval: undefined, generation: undefined, review: undefined, stages: [] };
    const result = await codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
      characterId: 'zhou-chef', requestId,
      runRaw: async (_root, input) => {
        if (input.startsWith('你是NPC聊天案例检索器')) {
          captured.retrieval = input; captured.stages.push('retrieval');
          if (duringRetrieval) duringRetrieval();
          return { ids: [], ...(requestedPrimary === undefined ? {} : { recipeIds: requestedPrimary }), ...(westernIds === undefined ? {} : { westernDessertRecipeIds: westernIds }), chefPlan };
        }
        if (input.startsWith('你是NPC私聊成品编辑')) {
          captured.review = input; captured.stages.push('review');
          return { verdict: 'keep', edits: [], remove: [], chefCheck: { verdict: 'pass', issues: [] } };
        }
        if (input.startsWith('你在智域扮演独立虚构成年人物赵一帆')) {
          captured.generation = input; captured.stages.push('generation');
          return output;
        }
        throw Error('Unexpected model stage in isolated western/dessert integration test');
      },
    });
    assert.deepEqual(result, output);
    assert.deepEqual(captured.stages, ['retrieval', 'generation', 'review'], 'No extra model call for second-source retrieval');
    return captured;
  };
  const first = await runPipeline({ westernIds: ids, primaryIds: [], requestId: 'western-selected-real-records' });
  const selected = selectWesternDessertRecipes(library, ids);
  for (const prompt of [first.generation, first.review]) {
    assert.deepEqual(jsonAfter(prompt, selectedMarker), selected);
    assert.ok(!prompt.includes(JSON.stringify(library)), 'The full new library must not enter generation/review');
    assert.ok(!prompt.includes(JSON.stringify(primary)), 'The full original library must not enter generation/review');
  }
  const mixed = await runPipeline({ westernIds: [ids[0]], primaryIds: primaryIds.slice(0, 2), requestId: 'western-primary-mixed-selection' });
  for (const prompt of [mixed.generation, mixed.review]) {
    assert.deepEqual(jsonAfter(prompt, selectedMarker), [library.recipes[0]]);
    assert.deepEqual(jsonAfter(prompt, primaryMarker), primary.recipes.slice(0, 2));
  }
  for (const westernIds of [[], undefined]) {
    const empty = await runPipeline({ westernIds, requestId: `western-empty-${westernIds === undefined ? 'legacy' : 'explicit'}` });
    assert.equal(jsonAfter(empty.generation, selectedMarker)?.length || 0, 0);
    assert.equal(jsonAfter(empty.review, selectedMarker)?.length || 0, 0);
  }
  const traceFor = requestId => readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8'))).find(trace => trace.requestId === requestId);
  const trace = traceFor('western-selected-real-records');
  assert.equal(trace.status, 'complete');
  assert.deepEqual(trace.selectedWesternDessertRecipeIds, ids);
  assert.deepEqual(trace.chefWesternDessertSelection.ids, ids);
  assert.equal(trace.chefWesternDessertSelection.referenceHash, digest(JSON.stringify(selected)));
  assert.equal(trace.chefWesternDessertSelection.libraryHash, digest(original));
  assert.equal(trace.chefRecipeSelection.libraryHash, digest(primaryOriginal));
  assert.equal(trace.stages.find(stage => stage.stage === 'generation').rulesHash, trace.stages.find(stage => stage.stage === 'review').rulesHash);
  report.checks.push('Existing generate/review orchestration uses three model stubs, selects true new or mixed source records, keeps all gaps/safety, supports absent new IDs, and records separate source/selection hashes from the same frozen snapshot.');

  let failedCalls = 0;
  const invalidSelections = [
    { westernDessertRecipeIds: null }, { westernDessertRecipeIds: 'one-id' },
    { westernDessertRecipeIds: ['invented-id'] }, { westernDessertRecipeIds: [primaryIds[0]] },
    { westernDessertRecipeIds: [ids[0], ids[0]] },
    { recipeIds: primaryIds, westernDessertRecipeIds: [ids[0]] },
  ];
  for (const selection of invalidSelections) {
    await assert.rejects(codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
      characterId: 'zhou-chef',
      runRaw: async (_root, input) => {
        failedCalls++;
        assert.ok(input.startsWith('你是NPC聊天案例检索器'), 'Invalid source IDs stop before generation');
        return { ids: [], chefPlan, ...selection };
      },
    }), error => error.code === 'RECIPE_SELECTION_INVALID');
  }
  assert.equal(failedCalls, invalidSelections.length);
  for (const [label, filePath, replacement, code] of [
    ['missing library', libraryPath, undefined, 'MODULE_MISSING'],
    ['missing methods', methodsPath, undefined, 'MODULE_MISSING'],
    ['false recipe verification', libraryPath, JSON.stringify({ ...raw, recipes: raw.recipes.map((recipe, index) => index ? recipe : { ...recipe, verification: { ...recipe.verification, completeRecipe: true } }) }), 'MODULE_INVALID'],
  ]) {
    const file = join(runtime.root, filePath);
    const saved = readFileSync(file, 'utf8');
    if (replacement === undefined) renameSync(file, file + '.held');
    else writeFileSync(file, replacement);
    try {
      let calls = 0;
      await assert.rejects(codex.generate(runtime.root, promptFor('zhou-chef', '赵一帆'), {
        characterId: 'zhou-chef', runRaw: async () => { calls++; throw Error('Invalid sources stop before model'); },
      }), error => error.code === code && error.path === filePath, label);
      assert.equal(calls, 0);
      for (const [id, name] of roles.slice(1)) assert.equal(loadDialogueSkill(runtime.root, promptFor(id, name), id).metadata.rulesHash, baselines.get(id).metadata.rulesHash);
    } finally {
      if (replacement === undefined) renameSync(file + '.held', file);
      else writeFileSync(file, saved);
    }
  }
  report.checks.push('Malformed, cross-publisher and over-budget selection stops after retrieval; missing/invalid new source modules stop before model calls without disturbing other characters.');

  const marker = 'WESTERN-DESSERT-NEXT-REQUEST-SOURCE-MUTATION';
  const changed = structuredClone(raw);
  changed.recipes[0].summary = `${changed.recipes[0].summary || ''} ${marker}`;
  changed.recipes[0].safetyNotes.push(marker);
  const snapshot = await runPipeline({ westernIds: [ids[0]], requestId: 'western-frozen-source-snapshot', duringRetrieval: () => writeFileSync(libraryFile, JSON.stringify(changed)) });
  for (const prompt of [snapshot.generation, snapshot.review]) {
    assert.deepEqual(jsonAfter(prompt, selectedMarker), [library.recipes[0]]);
    assert.ok(!prompt.includes(marker), 'Mid-request edits cannot change the frozen source reference');
  }
  const snapshotTrace = traceFor('western-frozen-source-snapshot');
  assert.equal(snapshotTrace.chefWesternDessertSelection.libraryHash, digest(original));
  assert.equal(snapshotTrace.chefWesternDessertSelection.referenceHash, digest(JSON.stringify([library.recipes[0]])));
  const nextLoaded = loadDialogueSkill(runtime.root, promptFor('zhou-chef', '赵一帆'), 'zhou-chef');
  assert.ok(nextLoaded.chefWesternDessertLibrary.recipes[0].summary.includes(marker));
  assert.notEqual(nextLoaded.metadata.sources.find(source => source.path === libraryPath).sha256, baselines.get('zhou-chef').metadata.sources.find(source => source.path === libraryPath).sha256);
  const next = await runPipeline({ westernIds: [ids[0]], requestId: 'western-next-request-reload' });
  assert.deepEqual(jsonAfter(next.generation, selectedMarker), [changed.recipes[0]]);
  assert.deepEqual(jsonAfter(next.review, selectedMarker), [changed.recipes[0]]);
  for (const [id, name] of roles.slice(1)) assert.equal(loadDialogueSkill(runtime.root, promptFor(id, name), id).metadata.rulesHash, baselines.get(id).metadata.rulesHash);
  assert.equal(digest(readFileSync(join(runtime.root, primaryPath), 'utf8')), before.anqiujinHash);
  writeFileSync(libraryFile, original);
  report.checks.push('Same-request library mutations cannot change generation, review or trace; the next request reloads the changed source, the original 53-record library and other five rule texts stay intact.');
  report.afterRulesHashes = Object.fromEntries(roles.map(([id]) => [id, { rulesHash: baselines.get(id).metadata.rulesHash, rulesBytes: baselines.get(id).metadata.rulesBytes }]));
  report.passed = true;
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) {
    assert.ok(process.argv[reportIndex + 1], '--report needs a destination');
    const destination = process.argv[reportIndex + 1];
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`PASS western/dessert source library: ${report.coverage.cookingSamples} real references, ${report.coverage.western} western/${report.coverage.dessert} dessert, two publishers combined 0–3 IDs, no extra model call, frozen generation/review, four original hashes unchanged and five roles unaffected by western additions; parallel Chen changes recorded separately.`);
} finally {
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  runtime.cleanup();
}
