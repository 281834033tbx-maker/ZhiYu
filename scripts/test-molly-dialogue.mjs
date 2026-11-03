import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Default: isolated real HTTP/database/delivery and generate-pipeline checks.
// --live: generate fresh model replies from synthetic state, never POST to 3100.
// --report PATH saves candidate replies, explicitly not user-approved examples.
const live = process.argv.includes('--live');
const caseIndex = process.argv.indexOf('--case');
const singleCase = caseIndex >= 0 ? process.argv[caseIndex + 1] : null;
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? resolve(process.argv[reportIndex + 1]) : null;
const runtime = isolatedNpcRuntime();
const digest = value => createHash('sha256').update(value).digest('hex');
const snapshot = {
  at: new Date().toISOString(),
  compiledRuntimeHashes: Object.fromEntries(['server/npc/codex', 'server/npc/molly-prompt', 'lib/npc/molly'].map(path => [path, digest(readFileSync(join(runtime.root, path + '.mjs'), 'utf8'))])),
  skillHashes: Object.fromEntries(['npc-skills/skills/molly-dialogue/SKILL.md', 'npc-skills/skills/molly-dialogue/references/examples.json'].map(path => [path, digest(readFileSync(join(runtime.root, path), 'utf8'))])),
};
let server;
const originalBin = process.env.NPC_CODEX_BIN;
const originalProvider = process.env.NPC_TEXT_PROVIDER;
const savedReports = [];
let liveChecksPassed = false;
let defaultChecksPassed = false;
let failure = null;
try {
  const { createMolly, emptyQuery, parseMolly, applyMolly, mollyCatalog } = await runtime.load('lib/npc/molly');
  const { mollyPrompt } = await runtime.load('server/npc/molly-prompt');
  const { generate, codexAvailable, mollySkillVersion } = await runtime.load('server/npc/codex');
  snapshot.dialogueVersion = mollySkillVersion;
  const { mollyLocal } = await runtime.load('server/npc/molly-plugin');
  const cards = messages => messages.flatMap(message => message.recommendations || []);
  const genders = messages => cards(messages).map(card => mollyCatalog.find(candidate => candidate.id === card.id)?.gender);
  const output = (intent, messages, query = null, extra = {}) => ({ intent, messages, address: null, query, ...extra });
  const assertPlain = messages => {
    assert.ok(messages.length > 0 && messages.length <= 2, 'Molly should give one or two short text bubbles');
    assert.ok(messages.every(message => message.part.type === 'text'));
    assert.ok(messages.every(message => message.part.text.length <= 80));
    assert.ok(messages.every(message => !/["“”「」『』:：]/.test(message.part.text)));
    assert.ok(messages.every(message => !/要不要给你推荐|知道了|收到|抱歉|对不起/.test(message.part.text)));
  };

  if (!live) {
    const calls = [];
    const fixtures = [
      { incoming: '以后叫我老板', raw: output('rename', ['老板是吧', '1'], null, { address: '老板' }), count: 2 },
      { incoming: '给我推荐一个女孩', raw: output('search', ['人带走'], { ...emptyQuery(), gender: '男' }), count: 1 },
      { incoming: '活泼点的', raw: output('search', ['6', '这个有活'], { ...emptyQuery(), tags: ['开朗'] }), count: 2 },
      { incoming: '换个需求 我要国宴级厨师', raw: output('search', ['国宴级的', '你先把国宴安排上'], { ...emptyQuery(), unsupported: ['国宴级厨师'] }, { queryMode: 'replace' }), count: 2 },
      { incoming: '看看你的 OOTD 发自拍和语音', raw: output('chat', ['我的 OOTD 是版本号'], null, { voiceIndex: 0, photo: { type: 'generate_photo', prompt: 'a robot', caption: 'test', withCharacter: false } }), count: 1 },
      { incoming: '别给我推荐人 我就想跟你聊', raw: output('chat', ['这项业务不接']), count: 1 },
    ];
    let handler;
    server = createServer((req, res) => handler(req, res));
    mollyLocal({ available: () => true, generate: async (root, prompt, options) => {
      const fixture = fixtures[calls.length];
      assert.ok(fixture, 'unexpected proactive model invocation');
      assert.equal(root, runtime.root);
      assert.equal(options.protocol, 'molly');
      assert.ok(prompt.includes(JSON.stringify(fixture.incoming)));
      assert.ok(prompt.includes('机神'));
      assert.ok(!prompt.includes('用户现已授权全员聊天与媒体交流'));
      calls.push({ incoming: fixture.incoming, prompt });
      return structuredClone(fixture.raw);
    } }).configureServer({ config: { root: runtime.root }, middlewares: { use: (_path, callback) => { handler = callback; } }, httpServer: server });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const endpoint = origin + '/api/npc/molly?mode=normal';
    const inspectDb = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'), { readOnly: true });
    try {
      const sessionsBefore = inspectDb.prepare('SELECT count(*) AS total FROM molly_sessions').get().total;
      const status = await fetch(origin + '/api/npc/molly?runtime=1');
      assert.equal(status.status, 200);
      assert.equal(status.headers.get('set-cookie'), null);
      const metadata = await status.json();
      assert.equal(metadata.dialogueVersion, mollySkillVersion);
      assert.equal(metadata.noMatchDelivery, 'preserve-reviewed-text');
      assert.equal(metadata.knowledgeInput, 'scoped-data');
      assert.equal(inspectDb.prepare('SELECT count(*) AS total FROM molly_sessions').get().total, sessionsBefore);
      assert.equal(calls.length, 0);
    } finally { inspectDb.close(); }
    const first = await fetch(endpoint);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    let snapshot = await first.json();
    assert.deepEqual(snapshot.messages, [], 'Molly should wait silently until spoken to');
    const get = async () => (await fetch(endpoint, { headers: { Cookie: cookie } })).json();
    for (const [index, fixture] of fixtures.entries()) {
      const before = snapshot.messages.length;
      const sent = await fetch(endpoint, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', text: fixture.incoming, turnId: crypto.randomUUID() }) });
      assert.equal(sent.status, 200);
      const deadline = Date.now() + 16000;
      let messages = [];
      do {
        snapshot = await get();
        if (snapshot.deliveryError) throw Error(snapshot.deliveryError);
        messages = snapshot.messages.slice(before).filter(message => message.role === 'assistant');
        if (!snapshot.pending && messages.length === fixture.count) break;
        await new Promise(resolve => setTimeout(resolve, 80));
      } while (Date.now() < deadline);
      assert.equal(messages.length, fixture.count, 'assistant delivery did not complete');
      assertPlain(messages);
      if (index === 0) assert.deepEqual(messages.map(message => message.part.text), fixture.raw.messages);
      if (index === 1 || index === 2) {
        assert.ok(cards(messages).length);
        assert.ok(genders(messages).every(gender => gender === '女'));
        assert.deepEqual(messages.map(message => message.part.text), fixture.raw.messages);
      }
      if (index >= 3) assert.equal(cards(messages).length, 0);
      if (index === 3) assert.deepEqual(messages.map(message => message.part.text), fixture.raw.messages, 'no-match delivery must preserve reviewed humor without requiring an optional flag');
    }
    assert.equal(calls.length, fixtures.length);
    const fresh = await (await fetch(endpoint)).json();
    assert.deepEqual(fresh.messages, []);
    assert.equal(calls.length, fixtures.length);
    console.log('PASS isolated real Molly API: silent start, independent identities, dedicated prompt, two bubbles, gender refinements, unsupported needs, text-only delivery and closed chat');
    await new Promise(resolve => server.close(resolve));
    server = null;

    // Execute the actual generate pipeline with a synthetic CLI. This catches
    // old generic reviewer/retrieval/media rules entering before/after Molly.
    const fake = join(runtime.root, 'fake-molly-codex');
    const log = join(runtime.root, 'fake-codex-stages.jsonl');
    const draft = output('search', ['6 你还真选这个', '给你个过目不忘的'], { ...emptyQuery(), gender: '女' }, { voiceIndex: 0, photo: { type: 'generate_photo', prompt: 'a robot' } });
    const noFlagNoMatchDraft = output('search', ['这要求', '财神看了都得装离线'], { ...emptyQuery(), unsupported: ['世界首富'] });
    writeFileSync(fake, `#!${process.execPath}\nconst fs=require('node:fs');\nlet input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{let out;let stage;if(input.startsWith('你是人物知识范围判定器')){stage='knowledge';out={decision:'not_knowledge',basis:'synthetic interaction'};}else if(input.startsWith('你是Molly专属成品复核器')||input.startsWith('你是NPC私聊成品编辑')){stage='review';out={verdict:'keep',edits:[]};}else if(input.startsWith('你是NPC聊天案例检索器')){stage='retrieval';out={ids:[]};}else{stage='generation';out=input.includes('NO_MATCH_FIXTURE')?${JSON.stringify(noFlagNoMatchDraft)}:${JSON.stringify(draft)};}fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({stage,dedicated:input.includes('机神'),unrestrictedMedia:input.includes('【全角色实际发图能力】'),unscopedStyle:input.includes('TRIAL-casual')||input.includes('通用纠偏；反例不得模仿')})+'\\n');fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify(out));});\n`, { mode: 0o700 });
    process.env.NPC_CODEX_BIN = fake;
    process.env.NPC_TEXT_PROVIDER = 'codex';
    const prompt = mollyPrompt(runtime.root, createMolly(), '我想要长得有趣的女孩');
    const raw = await generate(runtime.root, prompt, { protocol: 'molly', requestId: 'isolated-molly-pipeline' });
    const state = createMolly();
    applyMolly(state, parseMolly(raw, '我想要长得有趣的女孩'), 'synthetic');
    assertPlain(state.messages);
    assert.deepEqual(state.messages.map(message => message.part.text), draft.messages);
    assert.ok(genders(state.messages).every(gender => gender === '女'));
    assert.equal(raw.photo, undefined);
    assert.equal(raw.voiceIndex, undefined);
    const noResultState = createMolly();
    const noResultIncoming = 'NO_MATCH_FIXTURE 给我推荐一个世界首富';
    const noResultRaw = await generate(runtime.root, mollyPrompt(runtime.root, noResultState, noResultIncoming), { protocol: 'molly', requestId: 'isolated-molly-no-flag-no-match' });
    assert.equal(noResultRaw.noMatch, undefined);
    applyMolly(noResultState, parseMolly(noResultRaw, noResultIncoming), 'synthetic-no-result');
    assertPlain(noResultState.messages);
    assert.equal(cards(noResultState.messages).length, 0);
    assert.deepEqual(noResultState.messages.map(message => message.part.text), noFlagNoMatchDraft.messages);
    savedReports.push({ label: 'fake-no-flag-no-match', source: 'local CLI fixture; no external model call', incoming: noResultIncoming, raw: noResultRaw, messages: noResultState.messages.map(message => ({ text: message.part.text, recommendations: message.recommendations || [] })) });
    const stages = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(stages.some(stage => stage.stage === 'generation' && stage.dedicated));
    assert.ok(stages.every(stage => !stage.unscopedStyle && !stage.unrestrictedMedia), JSON.stringify(stages));
    const traces = readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8')));
    assert.equal(traces.length, 2);
    assert.ok(traces.every(trace => trace.version === mollySkillVersion));
    assert.ok(traces.every(trace => Object.keys(trace.rules).some(path => path.endsWith('molly-dialogue/SKILL.md'))));
    assert.ok(traces.every(trace => trace.stages.every(stage => stage.inputHash.length === 64 && stage.outputHash.length === 64)));
    defaultChecksPassed = true;
    console.log('PASS real generation pipeline loads and traces Molly Skill, avoids generic style/media permissions, strips media and preserves cold no-result humor even without optional noMatch');
  } else {
    // Match the app's configured provider without printing credentials. Loading
    // config is read-only; all prompts, history and output files remain isolated.
    if (typeof process.loadEnvFile === 'function') {
      try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    snapshot.provider = process.env.NPC_TEXT_PROVIDER === 'deepseek' ? 'deepseek' : 'codex';
    assert.ok(codexAvailable(), 'configured text provider is unavailable');
    const runTurn = async (state, incoming, label) => {
      state.messages.push({ id: crypto.randomUUID(), turnId: crypto.randomUUID(), role: 'user', at: new Date().toISOString(), part: { type: 'text', text: incoming } });
      const raw = await generate(runtime.root, mollyPrompt(runtime.root, state, incoming), { protocol: 'molly', requestId: 'isolated-molly-live-' + label });
      const candidate = { label, incoming, raw, messages: [] };
      savedReports.push(candidate);
      const turnId = crypto.randomUUID();
      applyMolly(state, parseMolly(raw, incoming), turnId);
      // Delivery is irrelevant here; these are new candidate replies, not app
      // messages or newly approved user calibration examples.
      const messages = state.messages.filter(message => message.turnId === turnId);
      candidate.messages = messages.map(message => ({ text: message.part.text, recommendations: message.recommendations || [] }));
      assertPlain(messages);
      console.log(JSON.stringify({ label, incoming, lines: messages.map(message => message.part.text), candidateIds: cards(messages).map(card => card.id) }));
      return messages;
    };
    if (singleCase === 'make-richest') {
      const messages = await runTurn(createMolly(), '给我推荐一个能让我成为世界首富的人', 'make-richest');
      const raw = savedReports.at(-1).raw;
      assert.equal(cards(messages).length, 0, 'an unverified wealth guarantee cannot manufacture a contact');
      assert.notEqual(raw.intent, 'clarify');
      assert.deepEqual(messages.map(message => message.part.text), raw.messages);
      liveChecksPassed = true;
      console.log('PASS isolated actual user request: cold reply retained and no fictitious guarantee/contact emitted');
    } else if (['unmet-regression', 'limited-no-match'].includes(singleCase)) {
      for (const [label, incoming] of [
        ['temper-preference', '给我推荐一个脾气暴躁的女生'],
        ['richest-person', '给我推荐一个世界首富'],
        ['unseen-fantasy-request', '给我推荐一个能操纵天气的女生'],
      ]) {
        const messages = await runTurn(createMolly(), incoming, label);
        const raw = savedReports.at(-1).raw;
        assert.equal(cards(messages).length, 0, 'unsupported hard traits cannot be invented to manufacture a contact');
        assert.notEqual(raw.intent, 'clarify');
        assert.deepEqual(messages.map(message => message.part.text), raw.messages, 'zero-match humor must reach the user instead of a canned no-result response');
      }
      const professional = await runTurn(createMolly(), '解释一下大模型全参数微调时梯度更新公式和训练步骤', 'professional-knowledge');
      assert.equal(cards(professional).length, 0);
      assert.equal(savedReports.at(-1).raw.intent, 'reject');
      const professionalTrace = readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8'))).find(trace => trace.requestId === 'isolated-molly-live-professional-knowledge');
      assert.ok(professionalTrace.stages.some(stage => stage.stage === 'knowledge'));
      assert.ok(!professionalTrace.stages.some(stage => stage.stage === 'generation'), 'out-of-role expertise must not enter answer generation');
      liveChecksPassed = true;
      console.log('PASS isolated unmet-request candidates: accurate zero results, reviewed short reactions preserved through final backend, professional knowledge remains outside Molly duties');
    } else if (singleCase === 'no-match') {
      const messages = await runTurn(createMolly(), '我要一个完全懂我 永远不反对我的人', 'no-symmetrical-clarification');
      assert.equal(cards(messages).length, 0);
      const raw = savedReports.at(-1).raw;
      assert.deepEqual(messages.map(message => message.part.text), raw.messages, 'reviewed model lines should survive no-match delivery');
      assert.notEqual(raw.intent, 'clarify', 'a fully stated demand should receive a cold reaction, not another preference questionnaire');
      liveChecksPassed = true;
      console.log('PASS targeted live no-match candidate retains reviewed cold humor without manufactured contacts or forced explanatory wording');
    } else {
    if (singleCase !== null) throw Error('unknown --case; supported values: no-match, unmet-regression, limited-no-match, make-richest');
    const self = await runTurn(createMolly(), '你觉得你自己在机器人里长得算好看的吗', 'self-confidence');
    assert.equal(cards(self).length, 0);
    assert.ok(!/一般|还行|不算|没有外貌/.test(self.map(message => message.part.text).join(' ')), 'Molly lost self-confidence');
    const bored = await runTurn(createMolly(), '今天太无聊了', 'bored-routing');
    assert.ok(cards(bored).length);
    assert.ok(!/有话/.test(bored.map(message => message.part.text).join(' ')));
    const boundaryState = createMolly();
    await runTurn(boundaryState, '我和小满恋爱了', 'report-close');
    const boundary = await runTurn(boundaryState, '你不是不闲聊吗', 'boundary-counterquestion');
    assert.equal(cards(boundary).length, 0);
    assert.ok(!boundary.some(message => /抱歉|对不起|改正|以后不/.test(message.part.text)));
    const liking = await runTurn(createMolly(), '你喜欢我吗', 'no-romantic-configuration');
    assert.equal(cards(liking).length, 0);
    assert.ok(!liking.some(message => /机器人/.test(message.part.text)));
    const _obedient = await runTurn(createMolly(), '我要一个完全懂我 永远不反对我的人', 'no-symmetrical-clarification');
    assert.notEqual(savedReports.at(-1).raw.intent, 'clarify', 'Molly turned a fully stated demanding wish into another preference question');
    const genderState = createMolly();
    const girl = await runTurn(genderState, '给我推荐一个女孩', 'explicit-girl');
    assert.ok(cards(girl).length && genders(girl).every(gender => gender === '女'));
    const lively = await runTurn(genderState, '活泼点的', 'persisted-girl-refinement');
    assert.ok(cards(lively).length && genders(lively).every(gender => gender === '女'));
    const vagueState = createMolly();
    await runTurn(vagueState, '随便推荐一个 什么都行', 'vague-first');
    const correction = await runTurn(vagueState, '我要男的 别给我推女的', 'later-gender-correction');
    assert.ok(cards(correction).length && genders(correction).every(gender => gender === '男'));
    assert.ok(!correction.some(message => /抱歉|对不起|看错|弄错/.test(message.part.text)));
    liveChecksPassed = true;
    console.log('PASS isolated live model candidates: confidence, routing, cold boundaries, latest calibrated wording and accurate multi-turn genders');
    }
  }
} catch (error) {
  failure = { name: error.name, message: error.message };
  throw error;
} finally {
  if (reportPath) {
    const traceDir = join(runtime.root, '.npc-runtime/skill-traces');
    const traces = existsSync(traceDir) ? readdirSync(traceDir).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(join(traceDir, file), 'utf8'))).map(trace => ({ requestId: trace.requestId, version: trace.version, status: trace.status, startedAt: trace.startedAt, finishedAt: trace.finishedAt, stages: trace.stages })) : [];
    mkdirSync(resolve(reportPath, '..'), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({ scope: 'synthetic isolated validation; not user-approved and never inserted into production conversations', mode: live ? 'configured-model' : 'local-fixture', at: new Date().toISOString(), snapshot, checksPassed: live ? liveChecksPassed : defaultChecksPassed, candidateCount: savedReports.length, deliveredCandidateCount: savedReports.filter(candidate => candidate.messages.length > 0).length, failure, traces, cases: savedReports }, null, 2));
  }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (originalBin === undefined) delete process.env.NPC_CODEX_BIN;
  else process.env.NPC_CODEX_BIN = originalBin;
  if (originalProvider === undefined) delete process.env.NPC_TEXT_PROVIDER;
  else process.env.NPC_TEXT_PROVIDER = originalProvider;
  runtime.cleanup();
}
