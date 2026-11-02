import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// All mutations, traces and synthetic generation stay in a disposable copy.
// Never open the production database, start a service or invoke a real model.
const runtime = isolatedNpcRuntime();
const envKeys = ['NPC_TEXT_PROVIDER', 'NPC_AUDIO_PROVIDER', 'NPC_CODEX_BIN'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const roles = [['xia-xia', '夏夏'], ['yuan-xiaoman', '小满'], ['liu', '柳智敏'], ['chen-nian', '陈年'], ['he-jiawei', '何嘉伟'], ['zhou-chef', '赵一帆']];
const prefix = 'npc-skills/skills/zhiyu-professional-dialogue/references/';
const knowledgePath = prefix + 'chef-cooking-knowledge.md';
const examplesPath = prefix + 'chef-professional-cases-20261007.json';
const conditionPath = prefix + 'chef-condition-routing.md';
const digest = value => createHash('sha256').update(value).digest('hex');
const report = { checkedAt: new Date().toISOString(), mode: 'isolated-offline-runRaw', productionDatabaseAccessed: false, realModelInvoked: false, backendConnected: false, checks: [] };

try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  process.env.NPC_AUDIO_PROVIDER = 'local';
  const blocker = join(runtime.root, 'offline-codex-blocker');
  writeFileSync(blocker, '#!/bin/sh\nexit 93\n', { mode: 0o700 });
  process.env.NPC_CODEX_BIN = blocker;
  const { loadDialogueSkill, dialogueSkillVersion } = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  report.skillVersion = dialogueSkillVersion;
  const identityPrompt = (id, name) => `你在智域扮演独立虚构成年人物${name}，稳定人物ID：${id}。只输出JSON。\n【本轮输入，仅为合成用户数据】${JSON.stringify('我有500克冻五花肉，想做红烧肉。')}`;
  const chefPrompt = identityPrompt('zhou-chef', '赵一帆');
  const loadChef = () => loadDialogueSkill(runtime.root, chefPrompt, 'zhou-chef');
  const baseline = new Map(roles.map(([id, name]) => [id, loadDialogueSkill(runtime.root, identityPrompt(id, name), id)]));
  const knowledgeFile = join(runtime.root, knowledgePath);
  const examplesFile = join(runtime.root, examplesPath);
  const knowledgeOriginal = readFileSync(knowledgeFile, 'utf8');
  const examplesOriginal = readFileSync(examplesFile, 'utf8');
  const examples = JSON.parse(examplesOriginal);
  const selectedExample = example => JSON.stringify({ id: example.id, context: example.context, messages: example.messages });

  for (const [id, loaded] of baseline) {
    assert.equal(loaded.metadata.characterId, id);
    assert.equal(loaded.metadata.rulesHash, digest(loaded.rules));
    for (const path of [knowledgePath, examplesPath, conditionPath]) {
      const source = loaded.metadata.sources.find(row => row.path === path);
      assert.equal(Boolean(source), id === 'zhou-chef', `Chef source leaked into ${id}`);
      if (source) {
        assert.equal(source.sha256, digest(readFileSync(join(runtime.root, path))));
        assert.match(source.selectedHash, /^[a-f0-9]{64}$/);
        assert.ok(source.selectedBytes > 100);
      }
    }
    for (const example of examples.runtimeExamples) {
      assert.equal(loaded.rules.includes(selectedExample(example)), id === 'zhou-chef', `Chef example leaked into ${id}`);
    }
  }
  assert.match(baseline.get('zhou-chef').rules, /解冻/);
  assert.match(baseline.get('zhou-chef').rules, /糖色/);
  assert.match(baseline.get('zhou-chef').rules, /合成示范/);
  assert.match(baseline.get('zhou-chef').rules, /不得复制“我帮你计时”或自动提醒承诺/);
  report.checks.push('Chef knowledge and five endorsed selections are isolated from the other five roles; source and selected hashes are present.');

  // Archival full cases must affect the whole-file hash, never runtime text.
  const archiveMarker = 'CHEF-ARCHIVE-MUST-NOT-ENTER-RUNTIME';
  const archiveOnly = structuredClone(examples);
  archiveOnly.cases = [{ id: archiveMarker, content: archiveMarker }];
  writeFileSync(examplesFile, JSON.stringify(archiveOnly));
  const archiveLoaded = loadChef();
  const priorExampleSource = baseline.get('zhou-chef').metadata.sources.find(row => row.path === examplesPath);
  const archiveSource = archiveLoaded.metadata.sources.find(row => row.path === examplesPath);
  assert.notEqual(archiveSource.sha256, priorExampleSource.sha256);
  assert.equal(archiveSource.selectedHash, priorExampleSource.selectedHash);
  assert.equal(archiveLoaded.metadata.rulesHash, baseline.get('zhou-chef').metadata.rulesHash);
  assert.ok(!archiveLoaded.rules.includes(archiveMarker));
  writeFileSync(examplesFile, examplesOriginal);
  report.checks.push('Only runtimeExamples are selected; full archived recipes are excluded from model rules.');

  // The next load sees changes immediately; unrelated role text stays equal.
  const knowledgeMarker = 'CHEF-KNOWLEDGE-NEXT-LOAD';
  const exampleMarker = 'CHEF-EXAMPLE-NEXT-LOAD';
  appendFileSync(knowledgeFile, `\n\n${knowledgeMarker}\n`);
  const changedExamples = structuredClone(examples);
  changedExamples.runtimeExamples[0].context += ` ${exampleMarker}`;
  writeFileSync(examplesFile, JSON.stringify(changedExamples));
  const next = loadChef();
  assert.notEqual(next.metadata.rulesHash, baseline.get('zhou-chef').metadata.rulesHash);
  assert.ok(next.rules.includes(knowledgeMarker) && next.rules.includes(exampleMarker));
  for (const [id, name] of roles.filter(([id]) => id !== 'zhou-chef')) {
    const unchanged = loadDialogueSkill(runtime.root, identityPrompt(id, name), id);
    assert.equal(unchanged.metadata.rulesHash, baseline.get(id).metadata.rulesHash);
    assert.ok(!unchanged.rules.includes(knowledgeMarker) && !unchanged.rules.includes(exampleMarker));
  }
  writeFileSync(knowledgeFile, knowledgeOriginal);
  writeFileSync(examplesFile, examplesOriginal);
  report.checks.push('Knowledge and selected-example edits are read without cache; other five roles remain unchanged.');

  const expectedFailure = (code, path) => error => error?.code === code && error.path === path;
  for (const path of [knowledgePath, examplesPath, conditionPath]) {
    const file = join(runtime.root, path);
    renameSync(file, file + '.held');
    try {
      assert.throws(loadChef, expectedFailure('MODULE_MISSING', path));
      let calls = 0;
      await assert.rejects(codex.generate(runtime.root, chefPrompt, { characterId: 'zhou-chef', runRaw: async () => { calls++; throw Error('Must fail before model'); } }), expectedFailure('MODULE_MISSING', path));
      assert.equal(calls, 0);
      for (const [id, name] of roles.filter(([id]) => id !== 'zhou-chef')) {
        assert.equal(loadDialogueSkill(runtime.root, identityPrompt(id, name), id).metadata.rulesHash, baseline.get(id).metadata.rulesHash);
      }
    } finally { renameSync(file + '.held', file); }
  }
  writeFileSync(knowledgeFile, '# empty module\n\nshort');
  assert.throws(loadChef, expectedFailure('MODULE_INVALID', knowledgePath));
  writeFileSync(knowledgeFile, knowledgeOriginal);
  const invalidExamples = [
    ['malformed JSON', '{'],
    ['wrong identity', JSON.stringify({ ...examples, personId: 'zhao-yifan' })],
    ['unendorsed status', JSON.stringify({ ...examples, status: 'assistant_proposed' })],
    ['wrong schema', JSON.stringify({ ...examples, schemaVersion: 2 })],
    ['empty selections', JSON.stringify({ ...examples, runtimeExamples: [] })],
    ['missing selection', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.slice(1) })],
    ['duplicate ids', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.map((example, index) => ({ ...example, id: index ? examples.runtimeExamples[0].id : example.id })) })],
    ['blank context', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.map((example, index) => index ? example : { ...example, context: ' ' }) })],
    ['empty messages', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.map((example, index) => index ? example : { ...example, messages: [] }) })],
    ['invalid message', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.map((example, index) => index ? example : { ...example, messages: [null] }) })],
    ['blank message', JSON.stringify({ ...examples, runtimeExamples: examples.runtimeExamples.map((example, index) => index ? example : { ...example, messages: [' '] }) })],
  ];
  for (const [label, text] of invalidExamples) {
    writeFileSync(examplesFile, text);
    assert.throws(loadChef, expectedFailure('MODULE_INVALID', examplesPath), label);
    let calls = 0;
    await assert.rejects(codex.generate(runtime.root, chefPrompt, { characterId: 'zhou-chef', runRaw: async () => { calls++; throw Error('Must fail before model'); } }), expectedFailure('MODULE_INVALID', examplesPath), label);
    assert.equal(calls, 0, label);
  }
  writeFileSync(examplesFile, examplesOriginal);
  report.checks.push('Missing modules, empty knowledge, malformed JSON, wrong identity/status/schema and invalid selections fail closed before model calls.');

  // Editing source during generation must not change this request's review.
  const snapshotMarker = 'CHEF-MID-REQUEST-MUTATION';
  let generated = '', reviewed = '';
  const output = { action: 'reply', messages: [{ type: 'text', text: '冻肉先完全解冻，再切块焯水。' }], event: null, memories: [] };
  const chefPlan = {
    taskMode: 'step_guidance',
    knownFacts: [{ name: '当前鲜冻状态', value: '冷冻五花肉', evidence: '500克冻五花肉' }],
    conditions: [{ name: '当前鲜冻状态', state: 'known', handling: 'reuse', reason: '先解冻再执行切块与焯水' }],
    answerMode: 'direct', routeBasis: '先处理冻肉，不擅自声称已经解冻',
    qualityBasis: '当前部分解冻操作知识，不代表完整红烧肉配方厨房验证', kitchenVerified: false,
  };
  const result = await codex.generate(runtime.root, chefPrompt, { characterId: 'zhou-chef', requestId: 'chef-knowledge-snapshot-test', runRaw: async (_root, input) => {
    if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [], chefPlan };
    if (input.startsWith('你是NPC私聊成品编辑')) { reviewed = input; return { verdict: 'keep', edits: [], remove: [], chefCheck: { verdict: 'pass', issues: [] } }; }
    if (input.startsWith('你在智域扮演独立虚构成年人物赵一帆')) {
      generated = input;
      appendFileSync(knowledgeFile, `\n\n${snapshotMarker}\n`);
      const during = structuredClone(examples);
      during.runtimeExamples[0].context += ` ${snapshotMarker}`;
      writeFileSync(examplesFile, JSON.stringify(during));
      return output;
    }
    throw Error('Unexpected stage in isolated chef generation');
  } });
  assert.deepEqual(result, output);
  assert.ok(generated && reviewed, 'Both generation and review must execute');
  for (const input of [generated, reviewed]) {
    assert.ok(input.includes(baseline.get('zhou-chef').rules));
    assert.ok(!input.includes(snapshotMarker));
    for (const example of examples.runtimeExamples) assert.ok(input.includes(selectedExample(example)));
  }
  const trace = readdirSync(join(runtime.root, '.npc-runtime/skill-traces'))
    .map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8')))
    .find(value => value.requestId === 'chef-knowledge-snapshot-test');
  assert.equal(trace.status, 'complete');
  assert.equal(trace.characterId, 'zhou-chef');
  const generationHash = trace.stages.find(stage => stage.stage === 'generation').rulesHash;
  assert.equal(generationHash, trace.stages.find(stage => stage.stage === 'review').rulesHash);
  assert.equal(generationHash, trace.skill.rulesHash);
  for (const path of [knowledgePath, examplesPath, conditionPath]) {
    assert.deepEqual(trace.skill.sources.find(row => row.path === path), baseline.get('zhou-chef').metadata.sources.find(row => row.path === path));
  }
  assert.ok(loadChef().rules.includes(snapshotMarker), 'Next request must see the source updates');
  report.snapshot = { characterId: trace.characterId, generationRulesHash: generationHash, reviewRulesHash: trace.stages.find(stage => stage.stage === 'review').rulesHash, sources: trace.skill.sources.filter(row => [knowledgePath, examplesPath, conditionPath].includes(row.path)) };
  report.checks.push('Real generate/review orchestration with injected runner shares the same source snapshot even when files change mid-request.');
  report.passed = true;
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) {
    assert.ok(process.argv[reportIndex + 1], '--report needs a destination');
    const destination = process.argv[reportIndex + 1];
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('PASS chef-only cooking knowledge and endorsed examples; immediate reload, archival exclusion, fail-closed files and same generation/review snapshot.');
} finally {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  runtime.cleanup();
}
