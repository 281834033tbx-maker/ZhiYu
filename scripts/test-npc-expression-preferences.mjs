import assert from 'node:assert/strict';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Isolated state fixtures only: no model call, live server or production SQLite.
const runtime = isolatedNpcRuntime();
try {
  const prefs = await runtime.load('lib/npc/expression-preferences');
  const engine = await runtime.load('lib/npc/engine');
  const yuan = await runtime.load('lib/npc/yuan-xiaoman');
  const liu = await runtime.load('lib/npc/liu');
  const chen = await runtime.load('lib/npc/chen-nian');
  const xiaPrompt = await runtime.load('server/npc/prompt');
  const yuanPrompt = await runtime.load('server/npc/yuan-prompt');
  const liuPrompt = await runtime.load('server/npc/liu-prompt');
  const chenPrompt = await runtime.load('server/npc/chen-prompt');
  const raw = (evidence, action = 'avoid', target = '然后呢', category = 'wording', text = '用户对具体表达的偏好') => ({
    action: 'reply', messages: [{ type: 'text', text: '好，换个说法。' }], event: null,
    memories: [{ text, kind: 'user_claim', evidence, preference: { category, target, action } }],
  });
  const addUser = (state, text) => state.messages.push({ id: crypto.randomUUID(), turnId: crypto.randomUUID(), role: 'user', at: new Date().toISOString(), part: { type: 'text', text } });
  const actors = [
    { id: 'xia-xia', create: () => engine.createState('normal'), parse: engine.parseOutput,
      apply: (s, out, text) => engine.finishTurn(s, crypto.randomUUID(), text, out), prompt: xiaPrompt.buildPrompt },
    { id: 'yuan-xiaoman', create: yuan.createYuan, parse: yuan.parseYuan,
      apply: (s, out, text) => { addUser(s, text); yuan.applyYuan(s, out, crypto.randomUUID()); }, prompt: yuanPrompt.yuanPrompt },
    { id: 'liu', create: liu.createLiu, parse: liu.parseLiu,
      apply: (s, out, text) => { addUser(s, text); liu.applyLiu(s, out, crypto.randomUUID()); }, prompt: liuPrompt.liuPrompt },
    { id: 'chen-nian', create: chen.createChen, parse: chen.parseChen,
      apply: (s, out, text) => { addUser(s, text); chen.applyChen(s, out, crypto.randomUUID()); }, prompt: chenPrompt.chenPrompt },
  ];
  for (const actor of actors) {
    const state = actor.create();
    const before = structuredClone(state.values);
    let text = '我不喜欢你说然后呢';
    actor.apply(state, actor.parse(raw(text), text), text);
    assert.equal(state.memories[0].preference.action, 'avoid');
    for (let i = 0; i < 90; i++) {
      const filler = `合成普通记忆${i}`;
      addUser(state, filler);
      state.memories.push({ id: crypto.randomUUID(), text: filler, kind: 'user_claim', evidence: filler, messageId: state.messages.at(-1).id, status: 'model_proposed' });
    }
    assert.equal(prefs.currentExpressionPreferences(state.memories, state.messages)[0].preference.action, 'avoid');
    const context = actor.prompt(runtime.root, state, '合成下一轮');
    assert.ok(context.includes('"target":"然后呢","action":"avoid"'), actor.id + ': active preference survives 80 ordinary memories');
    text = '然后呢这句话可以再说了';
    actor.apply(state, actor.parse(raw(text, 'allow'), text), text);
    assert.equal(prefs.currentExpressionPreferences(state.memories, state.messages)[0].preference.action, 'allow');
    text = '我不喜欢你说然后呢';
    actor.apply(state, actor.parse(raw(text), text), text);
    assert.equal(prefs.currentExpressionPreferences(state.memories, state.messages)[0].preference.action, 'avoid', actor.id + ': repeated old text can reverse a later allowance');
    const cycle = JSON.parse(JSON.stringify(state));
    assert.equal(prefs.currentExpressionPreferences(cycle.memories, cycle.messages)[0].preference.action, 'avoid', actor.id + ': existing JSON storage preserves optional metadata');
    const isolated = actor.create();
    assert.deepEqual(prefs.currentExpressionPreferences(isolated.memories, isolated.messages), []);
    isolated.memories.push(state.memories[0]);
    assert.deepEqual(prefs.currentExpressionPreferences(isolated.memories, isolated.messages), [], actor.id + ': foreign memory without same-branch source message is ignored');
    assert.deepEqual(state.values, before, actor.id + ': preference creates no score changes');
    assert.equal(state.memories.filter(m => m.preference).length, 3);
  }
  const stickerEvidence = '我特别讨厌奶牛施法这个表情包';
  assert.equal(engine.parseOutput(raw(stickerEvidence, 'avoid', '奶牛施法', 'sticker'), stickerEvidence).memories[0].preference.category, 'sticker');
  assert.deepEqual(engine.parseOutput(raw('不存在的原话'), '完全不同的输入').memories, []);
  assert.equal(engine.parseOutput(raw('我不喜欢你这样说'), '我不喜欢你这样说').memories[0].preference, undefined);
  const inferred = raw('我不喜欢你说然后呢'); inferred.memories[0].kind = 'character_inference';
  assert.equal(engine.parseOutput(inferred, '我不喜欢你说然后呢').memories[0].preference, undefined);
  const broad = '你以后不要和我分享生活了';
  assert.equal(engine.parseOutput(raw(broad, 'avoid', '分享生活'), broad).memories[0].preference, undefined);
  const vague = '我特别讨厌这个表情包';
  assert.equal(engine.parseOutput(raw(vague, 'avoid', '这个表情包', 'sticker'), vague).memories[0].preference, undefined);
  for (const negative of ['不可以再说然后呢', '不能恢复然后呢', '不要恢复然后呢']) {
    assert.equal(engine.parseOutput(raw(negative, 'allow'), negative).memories[0].preference, undefined, negative + ': negated permission must not revoke avoidance');
  }
  const mixed = '别再说然后呢，但可以发翻白眼的猫';
  const specific = raw('别再说然后呢');
  specific.memories.push(raw('可以发翻白眼的猫', 'allow', '翻白眼的猫', 'sticker').memories[0]);
  assert.deepEqual(engine.parseOutput(specific, mixed).memories.map(m => m.preference.action), ['avoid', 'allow']);
  assert.equal(engine.parseOutput(raw(mixed, 'avoid'), mixed).memories[0].preference, undefined, 'whole mixed evidence cannot use another target permission');
  assert.equal(engine.parseOutput(raw(mixed, 'allow', '翻白眼的猫', 'sticker'), mixed).memories[0].preference, undefined, 'model must isolate the precise clause for each target');
  assert.equal(engine.parseOutput(raw(broad, 'avoid', '分享生活', 'sticker'), broad).memories[0].preference, undefined, 'category=sticker cannot bypass the role-change boundary');
  const old = { action: 'reply', messages: [{ type: 'text', text: '知道啦' }], event: null, memories: [{ text: '用户喜欢猫', kind: 'user_claim', evidence: '我喜欢猫' }] };
  assert.equal(engine.parseOutput(old, '我喜欢猫').memories[0].preference, undefined);
  console.log('PASS four existing NPC parsers/apply/prompt paths: exact evidenced wording/sticker preferences persist, survive 80 ordinary memories, revoke and reverse, remain branch-local, reject unsupported metadata, preserve old memories and relationship values');
} finally { runtime.cleanup(); }
