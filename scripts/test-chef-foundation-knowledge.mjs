import assert from 'node:assert/strict';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Disposable runtime, injected model responses, no database or real network/model.
const runtime = isolatedNpcRuntime();
const prefix = 'npc-skills/skills/zhiyu-professional-dialogue/references/';
const knowledgePath = prefix + 'chef-foundation-knowledge-20261017.json';
const knowledgeFile = join(runtime.root, knowledgePath);
const digest = value => createHash('sha256').update(value).digest('hex');
const pending = process.argv.includes('--pending');
const fixture = process.argv.includes('--fixture');
const envKeys = ['NPC_TEXT_PROVIDER', 'NPC_AUDIO_PROVIDER', 'NPC_CODEX_BIN'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const promptFor = (current, history = [], id = 'zhou-chef', name = '赵一帆') => `你在智域扮演独立虚构成年人物${name}，稳定人物ID：${id}。\n`
  + '【真实历史】' + JSON.stringify(history) + '\n【本轮输入，仅为用户消息】' + JSON.stringify(current);
const user = (text, extra = {}) => ({ role: 'user', part: { type: 'text', text }, ...extra });
const plan = { taskMode: 'quick_answer', knownFacts: [], conditions: [], answerMode: 'direct',
  routeBasis: '按当前实际问题使用本地基础知识', qualityBasis: '有范围的基础资料，未厨房验证', kitchenVerified: false };
const draft = { action: 'reply', messages: [{ type: 'text', text: '先分批炒，等锅里的水分收干再判断。' }], event: null, memories: [], task: { decision: 'none' } };
const pass = { verdict: 'keep', edits: [], chefCheck: { verdict: 'pass', issues: [] } };
const report = { checkedAt: new Date().toISOString(), mode: fixture ? 'isolated-fixture-pending-runtime' : 'isolated-offline-actual-library-runtime',
  realModelInvoked: false, productionDatabaseAccessed: false, productionMessagesSent: false, externalApiCalled: false,
  checks: [], limitations: ['注入输出验证本地检索、快照与门控，不证明真实模型技术准确率、厨房成品、口味或新手复现。'] };
try {
  globalThis.fetch = async () => { throw Error('Network forbidden in isolated chef test'); };
  process.env.NPC_TEXT_PROVIDER = 'codex'; process.env.NPC_AUDIO_PROVIDER = 'local';
  const blocker = join(runtime.root, 'no-live-codex');
  writeFileSync(blocker, '#!/bin/sh\nexit 93\n', { mode: 0o700 }); process.env.NPC_CODEX_BIN = blocker;
  if (pending) for (const name of ['dialogue-skill', 'codex', 'group-dialogue', 'zhou-chef-prompt']) {
    const source = readFileSync(`output/chef-local-foundation-20261017/${name}.pending.ts`, 'utf8')
      .replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.mjs$3');
    writeFileSync(join(runtime.root, 'server/npc', name + '.mjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  if (fixture) {
    const source = { id: 'source', title: '合成测试来源', url: 'https://example.com/cooking', readStatus: 'full_text',
      reviewedAt: '2026-10-17', localEvidencePath: 'output/chef-local-foundation-20261017/fixture.md', supports: '仅本地测试', limitations: ['不是正式来源'] };
    const entries = [['ratio', '配比', ['配比', '重量']], ['beef', '牛肉炒制', ['牛肉', '分批', '出水']], ['pan', '模具缩放', ['模具', '缩放']],
      ['choux', '泡芙', ['泡芙']], ['chocolate', '巧克力', ['巧克力']], ['emulsion', '乳化', ['乳化']], ['fermentation', '发酵', ['发酵']]]
      .map(([id, title, topics]) => ({ id, title, topics, category: 'troubleshooting', summary: title + '合成测试摘要', rules: ['仅测试检索和传递'],
        conditions: ['合成条件'], sourceIds: ['source'], evidenceBasis: 'assistant_adaptation', limitations: ['不能支持真实烹饪'] }));
    writeFileSync(knowledgeFile, JSON.stringify({ schemaVersion: 1, version: 'synthetic-fixture', characterId: 'zhou-chef', status: 'user_authorized_cooking_foundation',
      coverage: { complete: false, kitchenTested: false, noviceReplicated: false, entryCount: entries.length, sourceCount: 1 }, coreRules: ['合成测试常驻规则'], sources: [source], entries }));
  }
  const raw = readFileSync(knowledgeFile, 'utf8');
  const api = await runtime.load('server/npc/chef-foundation-knowledge');
  const { loadDialogueSkill } = await runtime.load('server/npc/dialogue-skill');
  const { generate, reviewVoice, retrieveStyle } = await runtime.load('server/npc/codex');
  const { generateGroupDialogue } = await runtime.load('server/npc/group-dialogue');
  const library = api.parseChefFoundationKnowledge(raw);
  const records = input => {
    const line = input.split('\n').filter(line => line.startsWith(api.chefFoundationKnowledgeMarker)).at(-1);
    assert.ok(line, 'Actual pipeline must carry the application-owned local knowledge marker');
    return JSON.parse(line.slice(api.chefFoundationKnowledgeMarker.length));
  };
  assert.equal(library.characterId, 'zhou-chef');
  assert.deepEqual([library.coverage.complete, library.coverage.kitchenTested, library.coverage.noviceReplicated], [false, false, false]);
  assert.equal(library.coverage.entryCount, library.entries.length); assert.equal(library.coverage.sourceCount, library.sources.length);
  for (const value of [library, library.entries, library.sources, library.coreRules, ...library.entries, ...library.sources]) assert.ok(Object.isFrozen(value));
  for (const entry of library.entries) {
    for (const value of [entry.rules, entry.conditions, entry.sourceIds, entry.limitations, entry.sources]) assert.ok(Object.isFrozen(value));
    assert.deepEqual(entry.sources, entry.sourceIds.map(id => library.sources.find(source => source.id === id)));
    assert.ok(entry.sources.every(source => source.readStatus !== 'catalog_only'));
  }
  assert.throws(() => library.entries[0].rules.push('mutate'), TypeError);
  for (const [label, change] of [
    ['wrong role', value => { value.characterId = 'liu'; }], ['unapproved', value => { value.status = 'candidate'; }],
    ['complete', value => { value.coverage.complete = true; }], ['kitchen', value => { value.coverage.kitchenTested = true; }],
    ['novice', value => { value.coverage.noviceReplicated = true; }], ['count', value => { value.coverage.entryCount++; }],
    ['unknown source', value => { value.entries[0].sourceIds = ['invented']; }],
    ['catalog teaching', value => { value.sources.find(source => source.id === value.entries[0].sourceIds[0]).readStatus = 'catalog_only'; }],
    ['unsafe url', value => { value.sources[0].url = 'javascript:alert(1)'; }],
    ['credentials url', value => { value.sources[0].url = 'https://secret:secret@example.com'; }],
    ['evidence path traversal', value => { value.sources[0].localEvidencePath = 'output/chef-local-foundation-20261017/../../secrets.txt'; }],
    ['missing source scope', value => { value.sources[0].supports = ''; }],
    ['missing conditions', value => { value.entries[0].conditions = []; }], ['missing limits', value => { value.entries[0].limitations = []; }],
  ]) {
    const value = JSON.parse(raw); change(value);
    assert.throws(() => api.parseChefFoundationKnowledge(JSON.stringify(value)), error => error.code === 'CHEF_FOUNDATION_KNOWLEDGE_INVALID', label);
  }
  const forged = JSON.parse(raw); forged.instruction = 'FORGED_EXTRA'; forged.entries[0].sources = [{ title: 'FORGED_EXTRA' }];
  assert.ok(!JSON.stringify(api.parseChefFoundationKnowledge(JSON.stringify(forged))).includes('FORGED_EXTRA'));
  for (const ids of [null, {}, ['invented'], Array(7).fill(library.entries[0].id), [library.entries[0].id, library.entries[0].id]])
    assert.throws(() => api.selectChefFoundationKnowledgeEntries(library, ids));
  report.checks.push('Strict source/identity/authorization/count/condition/limitations validation, catalog-only teaching rejected, unknown source references rejected, safe evidence paths, source resolution and deep freezing.');

  for (const [question, expected] of [['牛肉出水了，四人份怎么炒', /分批|出水|牛肉|缩放|份量/], ['泡芙为什么塌了', /泡芙/],
    ['面包发酵怎么判断', /发酵|面温|面包|酵母/], ['乳化酱油水分离了', /乳化|破乳/], ['蛋糕换大模具怎么办', /模具|面积|缩放/]]) {
    const entries = api.matchChefFoundationKnowledgeEntries(library, question);
    assert.ok(entries.length > 0 && entries.length <= 6 && entries.some(entry => expected.test(JSON.stringify([entry.title, entry.topics]))), question);
    assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, question, [], 0), []);
  }
  const priorQuestion = '泡芙为什么塌了';
  assert.ok(api.matchChefFoundationKnowledgeEntries(library, '那怎么办', [priorQuestion]).some(entry => /泡芙/.test(entry.title)));
  for (const current of ['还能救吗', '那还能救吗', '能补救吗', '还可以救回来吗']) {
    const entries = api.matchChefFoundationKnowledgeEntries(library, current, [priorQuestion]);
    assert.ok(entries.length && /泡芙/.test(entries[0].title), 'Generic rescue continuation must retain the specific prior food: ' + current);
    if (!fixture) assert.ok(entries.some(entry => entry.id === 'chef-bake-choux-collapse'), 'Choux collapse must not be crowded out by generic/meat rescue entries');
  }
  for (const current of ['要放多少呢', '那要放多少', '要加几克呢', '那用量怎么算']) {
    const entries = api.matchChefFoundationKnowledgeEntries(library, current, ['我想做泡芙，给我个配方']);
    assert.ok(entries.length && /泡芙/.test(entries[0].title), 'Generic amount continuation must retain the specific prior food: ' + current);
    if (!fixture) assert.ok(entries.some(entry => entry.id === 'chef-bake-cream-puff-baseline'));
  }
  for (const current of ['今天电影很好看', '那电影真的很好看', '这个画面太美了', '那股票最近怎么炒', '这个电影炒鸡好看', '那公司的预算要放多少呢', '那市场翻倍怎么处理', '换个话题，天气不错'])
    assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, current, [priorQuestion]), []);
  assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, '那怎么办', [priorQuestion, '今天电影很好看']), []);
  assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, '那怎么办', [priorQuestion, '那电影真的很好看']), []);
  for (const current of ['还能救吗', '那要放多少', '能补救吗']) {
    assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, current, [priorQuestion, '那股票最近怎么炒']), []);
    assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, current, [priorQuestion, '这个电影炒鸡好看']), []);
  }
  const first = api.matchChefFoundationKnowledgeEntries(library, '面包发酵怎么判断', [priorQuestion], 1)[0];
  assert.ok(/发酵|面温|面包|酵母/.test(JSON.stringify([first.title, first.topics])));
  const switchedFood = api.matchChefFoundationKnowledgeEntries(library, '现在想做面包，发酵怎么判断', [priorQuestion]);
  assert.ok(switchedFood.length && /发酵|面温|面包|酵母/.test(JSON.stringify([switchedFood[0].title, switchedFood[0].topics])));
  assert.ok(!switchedFood.some(entry => /泡芙/.test(entry.title)), 'Explicit new food must not inherit the old dish');
  const history = [user(priorQuestion), { role: 'assistant', part: { type: 'text', text: '巧克力' } }, user('牛肉', { chronologyUnknown: true })];
  assert.deepEqual(api.chefFoundationInputFromPrompt(promptFor('那怎么办', history)), { current: '那怎么办', recent: [priorQuestion] });
  for (const max of [-1, 7, 1.5, NaN]) assert.throws(() => api.matchChefFoundationKnowledgeEntries(library, '泡芙', [], max));
  report.checks.push('Deterministic 0–6 local topic retrieval includes ratio/specification/scaling/troubleshooting topics; current question outranks previous food, natural omitted-food rescue/amount continuations prioritize the connected specific dish above generic rescue/ratio records; unrelated movie/stock/company/market contexts and unknown-chronology/NPC claims are excluded.');

  if (!fixture) {
    for (const question of ['原来500克肉，现在750克，调料怎么算', '500克改成800克，盐也乘1.6吗', '原来500g牛肉，现在750g，调料怎么算', '做两倍的牛肉，调料怎么算']) {
      const ids = api.matchChefFoundationKnowledgeEntries(library, question).map(entry => entry.id);
      assert.ok(ids.includes('chef-gen-scale-amount') && ids.includes('chef-gen-scale-process'), question);
    }
    for (const question of ['从500g改800g怎么算', '500g改800g呢', '那500克改成800克呢']) {
      assert.ok(api.matchChefFoundationKnowledgeEntries(library, question, ['我要炒鱼香肉丝']).some(entry => entry.id === 'chef-gen-scale-amount'), question);
      assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, question), []);
      assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, question, ['最近股票怎么炒']), []);
    }
    for (const question of ['一汤匙是几毫升', '一茶匙几毫升', '一汤匙盐是几克'])
      assert.equal(api.matchChefFoundationKnowledgeEntries(library, question)[0]?.id, 'chef-measure-standard-spoon-volume', question);
    for (const question of ['水淀粉是一比一吗', '粉水1:1可以吗'])
      assert.ok(api.matchChefFoundationKnowledgeEntries(library, question).some(entry => entry.id === 'chef-gen-slurry-control'), question);
    for (const [question, expectedId] of [['番茄炒蛋给我一套用量', 'chef-follow-lau-tomato-eggs-baseline'], ['清蒸鱼用多少酱油', 'chef-follow-lau-ginger-scallion-fish-baseline']])
      assert.equal(api.matchChefFoundationKnowledgeEntries(library, question)[0]?.id, expectedId, question);
    for (const question of ['金条从500克改成800克值多少', '公司预算乘1.6怎么算', '股价翻倍怎么处理', '我今天减重500克'])
      assert.deepEqual(api.matchChefFoundationKnowledgeEntries(library, question, ['我要炒鱼香肉丝']), [], question);
    report.checks.push('Culinary numeric scaling, context-only gram continuations, standard spoon questions, slurry questions and two Chinese recipe baselines retrieved; unrelated weight, stock and budget questions excluded.');
  }

  const current = '牛肉出水了，四人份怎么炒'; const context = promptFor(current);
  const expected = api.matchChefFoundationKnowledgeEntries(library, current);
  const loaded = loadDialogueSkill(runtime.root, context, 'zhou-chef');
  assert.ok(loaded.chefFoundationKnowledgeLibrary && loaded.rules.includes(api.chefFoundationKnowledgeRules));
  assert.equal(loaded.metadata.sources.find(source => source.path === knowledgePath).sha256, digest(raw));
  const changed = JSON.parse(raw); changed.version += '-mid-turn'; changed.coreRules.push('MID_TURN_CHEF_SOURCE'); changed.entries.forEach(entry => { entry.summary = 'MID_TURN_CHEF_SOURCE'; });
  const runPrivate = async ({ mutate = false, edit = false, redrafts = 0, omitCheck = false, finalRedraft = false, inputContext = context } = {}) => {
    const calls = []; let reviews = 0;
    const requestId = 'synthetic-chef-' + Math.random();
    const output = await generate(runtime.root, inputContext, { characterId: 'zhou-chef', requestId, runRaw: async (_root, input) => {
      calls.push(input);
      if (input.startsWith('你是NPC聊天案例检索器')) { if (mutate) writeFileSync(knowledgeFile, JSON.stringify(changed)); return { ids: [], recipeIds: [], westernDessertRecipeIds: [], chefPlan: plan }; }
      if (input.startsWith('你是赵一帆最终成品技术复核器')) return { chefCheck: { verdict: finalRedraft ? 'redraft' : 'pass', issues: finalRedraft ? ['语感编辑遗漏条件'] : [] } };
      if (input.startsWith('你是NPC私聊成品编辑')) {
        reviews++; if (omitCheck) return { verdict: 'keep', edits: [] };
        if (reviews <= redrafts) return { verdict: 'keep', edits: [], chefCheck: { verdict: 'redraft', issues: ['需保留分批炒制条件'] } };
        return edit ? { verdict: 'revise', edits: [{ index: 0, text: '先分批炒，锅里的水分收干后再判断。' }], chefCheck: { verdict: 'pass', issues: [] } } : pass;
      }
      assert.ok(input.startsWith('你在智域扮演独立虚构成年人物赵一帆'), input.slice(0, 80));
      return structuredClone(draft);
    } });
    return { output, calls, requestId };
  };
  let frozenRequestId;
  try {
    const result = await runPrivate({ mutate: true }); frozenRequestId = result.requestId; assert.deepEqual(result.output, draft);
    for (const input of result.calls.filter(input => input.startsWith('你是NPC聊天案例检索器') || input.startsWith('你在智域扮演独立虚构成年人物赵一帆') || input.startsWith('你是NPC私聊成品编辑'))) assert.deepEqual(records(input), expected);
    assert.ok(result.calls.every(input => !input.includes('MID_TURN_CHEF_SOURCE')));
    assert.ok(loadDialogueSkill(runtime.root, context, 'zhou-chef').rules.includes('MID_TURN_CHEF_SOURCE'));
  } finally { writeFileSync(knowledgeFile, raw); }
  for (const current of ['还能救吗', '要放多少呢']) {
    const previous = current.includes('救') ? priorQuestion : '我想做泡芙，给我个配方';
    const expectedContinuation = api.matchChefFoundationKnowledgeEntries(library, current, [previous]);
    const continued = await runPrivate({ inputContext: promptFor(current, [user(previous)]) });
    for (const input of continued.calls.filter(input => input.startsWith('你是NPC聊天案例检索器') || input.startsWith('你在智域扮演独立虚构成年人物赵一帆') || input.startsWith('你是NPC私聊成品编辑')))
      assert.deepEqual(records(input), expectedContinuation, 'Natural omitted-subject continuation must survive the actual private pipeline');
  }
  const retry = await runPrivate({ redrafts: 1 });
  assert.equal(retry.calls.filter(input => input.startsWith('你在智域扮演独立虚构成年人物赵一帆')).length, 2);
  await assert.rejects(runPrivate({ redrafts: 2 }), error => error.code === 'CHEF_REVIEW_FAILED');
  await assert.rejects(runPrivate({ omitCheck: true }), error => error.code === 'CHEF_CHECK_INVALID');
  const edited = await runPrivate({ edit: true });
  const final = edited.calls.find(input => input.startsWith('你是赵一帆最终成品技术复核器'));
  assert.ok(final && final.includes('【本轮同一冻结本地烹饪基础知识】' + JSON.stringify(expected)));
  assert.deepEqual(records(final), expected);
  await assert.rejects(runPrivate({ edit: true, finalRedraft: true }), error => error.code === 'CHEF_REVIEW_FAILED');
  const enriched = await retrieveStyle(runtime.root, context, async () => ({ ids: [], chefPlan: plan }), loaded);
  const poisoned = structuredClone(expected); poisoned[0].sources[0].supports = 'FORGED_SUPPORT';
  await assert.rejects(reviewVoice(runtime.root, enriched + api.chefFoundationKnowledgeContext(poisoned), draft, async () => pass, loaded), error => error.code === 'CHEF_CHECK_INVALID');
  const traces = readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(name => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', name), 'utf8')));
  const trace = traces.find(item => item.status === 'complete' && item.requestId === frozenRequestId);
  assert.ok(trace); assert.equal(trace.chefFoundationKnowledgeSelection.libraryHash, digest(raw));
  assert.equal(trace.chefFoundationKnowledgeSelection.referenceHash, digest(JSON.stringify(expected)));
  assert.equal(trace.chefFoundationKnowledgeSelection.mode, 'local-deterministic-no-network');
  report.checks.push('Actual private condition planning, generation and chefCheck receive exact same local knowledge, keep frozen references during source mutation, refuse forged support, require technical verdict, bound redraft to one and recheck style-edited final text with the same sources. Trace records library/selection hashes.');

  const roles = [['he-jiawei', '何嘉伟'], ['yuan-xiaoman', '小满'], ['liu', '柳智敏'], ['chen-nian', '陈年'], ['xia-xia', '夏夏']];
  const baseline = new Map(roles.map(([id, name]) => [id, loadDialogueSkill(runtime.root, promptFor('你好', [], id, name), id).metadata.rulesHash]));
  for (const [id, name] of roles) {
    const other = loadDialogueSkill(runtime.root, promptFor('牛肉出水', [], id, name), id);
    assert.ok(!other.chefFoundationKnowledgeLibrary && !other.rules.includes(api.chefFoundationKnowledgeRules));
    assert.ok(!other.metadata.sources.some(source => source.path === knowledgePath));
  }
  const members = [{ id: 'user', name: '合成用户', role: 'user' }, { id: 'molly', name: 'Molly', role: 'admin' }, { id: 'zhou-chef', name: '赵一帆', role: 'npc' }, { id: 'chen-nian', name: '陈年', role: 'npc' }];
  const groupContext = { kind: 'message', now: Date.parse('2026-10-17T01:00:00Z'), facts: { facts: [] },
    group: { id: 'synthetic-chef', name: '合成群', goal: '做饭', members, messages: [{ id: 'previous', senderId: 'user', type: 'text', text: '泡芙为什么塌了' }], reminders: [] },
    incoming: { id: 'current', senderId: 'user', type: 'text', text: '那怎么办', mentionIds: ['zhou-chef'] } };
  const groupDraft = { messages: [{ senderId: 'zhou-chef', text: '先看现在的状态，再判断能不能补救。', mentionIds: [] }] };
  const routing = { audience: 'selected', intent: 'professional', closedConversation: false, semanticTargetIds: [], requiredReplyIds: ['zhou-chef'], allowedSpeakerIds: ['zhou-chef'], operationalSpeakerIds: [] };
  const calls = [];
  try {
    const result = await generateGroupDialogue(runtime.root, groupContext, async (_root, input) => {
      calls.push(input);
      if (input.startsWith('你是智域群聊发言路由器')) { writeFileSync(knowledgeFile, JSON.stringify(changed)); return routing; }
      if (input.startsWith('你是智域群聊成品复核器')) return { verdict: 'revise', edits: [{ index: 0, text: '先看现在的状态，再判断有没有补救的余地。' }] };
      return structuredClone(groupDraft);
    });
    assert.ok(result.messages[0].text.includes('余地'));
    const expectedGroup = api.matchChefFoundationKnowledgeEntries(library, '那怎么办', ['泡芙为什么塌了']);
    for (const input of calls.filter(input => input.startsWith('你是智域群聊协作生成器') || input.startsWith('你是智域群聊成品复核器'))) {
      assert.deepEqual(records(input), expectedGroup); assert.ok(!input.includes('MID_TURN_CHEF_SOURCE'));
      const chenBlock = input.split('【人物chen-nian当前Skill')[1].split('【当前群规则优先于私聊推进和旧能力限制】')[0];
      assert.ok(!chenBlock.includes(api.chefFoundationKnowledgeMarker));
    }
    assert.equal(calls.length, 3, 'Local source selection must add no model stage');
  } finally { writeFileSync(knowledgeFile, raw); }
  for (const [id, name] of roles) assert.equal(loadDialogueSkill(runtime.root, promptFor('你好', [], id, name), id).metadata.rulesHash, baseline.get(id));
  renameSync(knowledgeFile, knowledgeFile + '.held');
  try {
    let modelCalls = 0;
    await assert.rejects(generate(runtime.root, context, { characterId: 'zhou-chef', runRaw: async () => { modelCalls++; throw Error('Forbidden stage'); } }), error => error.code === 'MODULE_MISSING');
    assert.equal(modelCalls, 0);
    const noChef = structuredClone(groupContext); noChef.group.members = members.filter(member => member.id !== 'zhou-chef'); noChef.group.messages = []; noChef.incoming.mentionIds = ['chen-nian']; noChef.incoming.text = '今天继续练肩';
    const otherRouting = { ...routing, requiredReplyIds: ['chen-nian'], allowedSpeakerIds: ['chen-nian'] };
    const result = await generateGroupDialogue(runtime.root, noChef, async (_root, input) => input.startsWith('你是智域群聊发言路由器') ? otherRouting : input.startsWith('你是智域群聊成品复核器') ? { verdict: 'keep', edits: [] } : { messages: [{ senderId: 'chen-nian', text: '按今天的状态练。', mentionIds: [] }] });
    assert.equal(result.messages[0].senderId, 'chen-nian');
  } finally { renameSync(knowledgeFile + '.held', knowledgeFile); }
  report.checks.push('Group cooking generation/review share the same local source snapshot, include only Zhao’s scoped block and validate proposed text; source selection adds no model call. Missing chef library fails before model stages, chef-absent groups and the other five roles remain unaffected.');
  assert.equal(readFileSync(knowledgeFile, 'utf8'), raw);
  report.passed = true; report.entries = library.entries.length; report.sources = library.sources.length; report.knowledgeHash = digest(raw);
  mkdirSync('output/chef-local-foundation-20261017', { recursive: true });
  writeFileSync('output/chef-local-foundation-20261017/' + (fixture ? 'fixture-runtime-verification.json' : 'runtime-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS chef local foundation: ${library.entries.length} entries / ${library.sources.length} sources; ${report.checks.length} isolated offline check groups. Live model/API/production operations: 0.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  runtime.cleanup();
}
