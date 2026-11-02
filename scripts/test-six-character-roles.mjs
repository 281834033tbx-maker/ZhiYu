import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Current source loaders and synthetic state only; no model, network or account data.
const runtime = isolatedNpcRuntime();
try {
  const {getCharacter, characterDirectory} = await runtime.load('lib/npc/character-directory');
  const {loadDialogueSkill, resolveDialogueIdentity} = await runtime.load('server/npc/dialogue-skill');
  const {currentCharacterProfile} = await runtime.load('server/npc/character-profile');
  const {loadMomentRules} = await runtime.load('server/npc/moment-policy');
  const expected = [
    ['yuan-xiaoman', '徐小曼', 26, '湖南', '言情小说'],
    ['xia-xia', '夏夏', 23, null, '无业'],
    ['he-jiawei', '何嘉伟', 28, '福建', '总经理'],
    ['chen-nian', '陈年', 27, '黑龙江', '健身教练'],
    ['zhou-chef', '赵一帆', 32, '河北', '厨师'],
    ['liu', '柳智敏', 28, '上海', '营养师'],
  ];
  assert.equal(characterDirectory.length, 6);
  for (const [id, name, age, origin, occupation] of expected) {
    const person = getCharacter(id);
    assert.equal(person.name, name); assert.equal(person.age, age); assert.equal(person.origin, origin);
    assert.ok(person.occupation.includes(occupation));
    const loaded = loadDialogueSkill(runtime.root, `你是${name}。`, id);
    assert.equal(loaded.metadata.characterId, id);
    assert.ok(loaded.rules.includes(occupation), `${id}: actual loaded rules carry the occupation`);
    assert.match(loaded.rules, person.role === 'companion' ? /浅知只谈浅知/ : /不按职业或本人库白名单拒答/);
    const moments = loadMomentRules(runtime.root, id);
    assert.ok(moments.includes(person.occupation));
    assert.ok(moments.includes(name));
  }
  assert.equal(resolveDialogueIdentity('你在智域扮演虚构成年人物徐小曼。'), 'yuan-xiaoman');
  assert.equal(resolveDialogueIdentity('你在智域扮演虚构成年人物许晓曼。'), 'yuan-xiaoman');
  assert.throws(() => resolveDialogueIdentity('你是许小满。'), /无法确认应用身份/);
  for (const id of ['yuan-xiaoman', 'xia-xia']) {
    const profile = currentCharacterProfile(readFileSync(`npc-skills/references/characters/${id}.md`, 'utf8'));
    assert.doesNotMatch(profile, /# 袁小满｜三号人物档案|# 夏夏／我不是龙虾/);
    const moments = loadMomentRules(runtime.root, id);
    assert.doesNotMatch(moments, /# 袁小满｜三号人物档案|# 夏夏／我不是龙虾/);
  }
  assert.throws(() => currentCharacterProfile('<!-- current-character-profile:start -->empty'), /无效/);

  const {createState} = await runtime.load('lib/npc/engine');
  const {activity, enqueue, dueKind, afterReply} = await runtime.load('lib/npc/life');
  const {prepareContactTurn} = await runtime.load('lib/npc/contact-life');
  const at = hour => Date.UTC(2026, 9, 21, hour - 8);
  const xia = createState('normal');
  assert.equal(activity(xia, at(4)), 'sleeping');
  for (const hour of [12, 14, 15, 18, 20]) assert.equal(activity(xia, at(hour)), 'free');
  enqueue(xia, 'synthetic-turn', at(15), '你好', undefined, () => 0);
  xia.life.nextWorkReplyAt = at(15) + 3600000; // retained legacy data cannot impose a job
  assert.equal(dueKind(xia, at(15)), 'queued');
  afterReply(xia, at(15), () => 0);
  assert.equal(xia.life.nextWorkReplyAt, 0);
  for (const seed of [0, .2, .4, .6, .8, .99]) {
    const state = createState('normal');
    prepareContactTurn(state, at(15), 'share', () => seed);
    assert.notEqual(state.contactLife.scene.topic, 'career_change');
    assert.doesNotMatch(state.contactLife.scene.cue, /剪视频|接单|开会|上班/);
  }
  const {createYuan} = await runtime.load('lib/npc/yuan-xiaoman');
  const yuan = createYuan();
  // Choose the authored-work candidate in the ordinary life pool.
  prepareContactTurn(yuan, at(15), 'share', () => .65);
  const {yuanPrompt} = await runtime.load('server/npc/yuan-prompt');
  const prompt = yuanPrompt(runtime.root, yuan, '你是做什么工作的？');
  assert.match(prompt, /26岁/); assert.match(prompt, /言情小说/);
  assert.doesNotMatch(prompt, /人物22岁，深圳平面模特/);
  const {buildPrompt} = await runtime.load('server/npc/prompt');
  const xiaPrompt = buildPrompt(runtime.root, createState('normal'), '你在做什么？');
  assert.match(xiaPrompt, /23岁/); assert.match(xiaPrompt, /无业/);
  assert.doesNotMatch(xiaPrompt, /现行职业背景为健身营养师/);
  console.log('PASS six current identities/roles, real Skill and Moments loaders, legacy aliases/history isolation and Xia unemployed daytime lifecycle; model/network/database writes: 0.');
} finally { runtime.cleanup(); }
