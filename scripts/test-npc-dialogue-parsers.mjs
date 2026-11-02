import assert from 'node:assert/strict';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

const runtime = isolatedNpcRuntime();
const incoming = '同事拿走我的成果，气死我了。再帮我写一个完整的起步方案。';
const raw = messages => ({ action: 'reply', messages, event: null, memories: [] });
try {
  const engine = await runtime.load('lib/npc/engine');
  const yuan = await runtime.load('lib/npc/yuan-xiaoman');
  const liu = await runtime.load('lib/npc/liu');
  const chen = await runtime.load('lib/npc/chen-nian');
  const parsers = [
    ['xia-xia', engine.parseOutput],
    ['yuan-xiaoman', yuan.parseYuan],
    ['liu', liu.parseLiu],
    ['chen-nian', chen.parseChen],
  ];
  const texts = [
    '？', '…', '...', '卧槽，这事真够离谱的。',
    '先确定预算和可用时间，记录收入、成本和实际交付。'.repeat(220),
    '最后一步：检查反馈，再决定是否扩大投入。',
  ];
  const input = raw(texts.map(text => ({ type: 'text', text })));
  for (const [id, parse] of parsers) {
    const copy = structuredClone(input);
    const output = parse(copy, incoming);
    assert.deepEqual(output.parts.map(part => part.text), texts, `${id}: preserve every message and the last step`);
    assert.deepEqual(copy, input, `${id}: parsing must not mutate its input`);
    assert.throws(() => parse(raw(Array.from({ length: engine.MAX_REPLY_MESSAGES + 1 }, () => ({ type: 'text', text: '继续' }))), incoming), /消息数量无效/);
    assert.throws(() => parse(raw([
      { type: 'text', text: '甲'.repeat(engine.MAX_REPLY_TEXT_CHARS / 2 + 1) },
      { type: 'text', text: '乙'.repeat(engine.MAX_REPLY_TEXT_CHARS / 2 + 1) },
    ]), incoming), /超出传输上限.*未截断/);
    assert.throws(() => parse(raw([{ type: 'text', text: '甲'.repeat(engine.MAX_REPLY_TEXT_CHARS + 1) }]), incoming), /超出传输上限.*未截断/);
    assert.equal(parse({ action: 'silent', messages: [], event: null, memories: [] }, incoming).parts.length, 0);
    assert.throws(() => parse({ ...raw([]), action: 'reply' }, incoming), /动作和消息不一致/);
    assert.throws(() => parse({ ...input, event: { kind: 'ordinary', basis: 'user_claim', evidence: '气死我了', reason: '候选事件', deltas: { affection: Infinity } } }, incoming), /无效数值/);
  }
  assert.throws(() => chen.parseChen(raw([{ type: 'photo', assetId: 'cake' }]), incoming), /只支持文字/);
  assert.equal(chen.parseChen(raw([{ type: 'photo', assetId: 'chenWorkdesk' }]), incoming).parts[0].type, 'photo');
  assert.throws(() => chen.parseChen({ ...input, event: { kind: 'ordinary', basis: 'user_claim', evidence: '气死我了', reason: '候选事件', deltas: { safety: 1 } } }, incoming), /未开放的隐藏值/);
  for (const parse of [yuan.parseYuan, liu.parseLiu])
    assert.throws(() => parse(raw([{ type: 'sticker', assetId: 'cow' }]), incoming), /表情包素材/);
  const photo = { type: 'generate_photo', prompt: '窗边的桌面', caption: '', withCharacter: false };
  assert.throws(() => engine.parseOutput(raw([photo, photo]), incoming), /最多生成一张/);
  assert.throws(() => engine.parseOutput(raw([
    { type: 'voice', text: '第一段' }, { type: 'voice', text: '第二段' },
  ]), incoming), /最多一条语音/);
  assert.throws(() => engine.parseOutput(raw([{ type: 'voice', text: '啊'.repeat(601) }]), incoming), /不支持/);

  const promptBuilders = [
    ['xia-xia', (await runtime.load('server/npc/prompt')).buildPrompt, engine.createState('normal')],
    ['yuan-xiaoman', (await runtime.load('server/npc/yuan-prompt')).yuanPrompt, yuan.createYuan()],
    ['liu', (await runtime.load('server/npc/liu-prompt')).liuPrompt, liu.createLiu()],
    ['chen-nian', (await runtime.load('server/npc/chen-prompt')).chenPrompt, chen.createChen()],
  ];
  for (const [id, build, state] of promptBuilders) {
    const before = structuredClone(state);
    const prompt = build(runtime.root, state, incoming);
    assert.ok(prompt.split('\n')[0].includes(`稳定人物ID：${id}`), `${id}: stable identity stays on the app-owned header`);
    assert.match(prompt, /现行共同规则优先/);
    assert.doesNotMatch(prompt, /## G18|### G18|### 未知回应|unknown走服务端简短回复|unknown只自然表示不知道/);
    assert.match(prompt, /24000字符/);
    assert.match(prompt, /必要步骤/);
    for (const key of ['characterId', 'values', 'relationship', 'memories', 'messages'])
      assert.deepEqual(state[key], before[key], `${id}: building a prompt must not change ${key}`);
  }
  const summerPrompt = promptBuilders[0][1](runtime.root, promptBuilders[0][2], incoming);
  assert.ok(summerPrompt.split('\n')[0].includes('现行职业为健身营养师'));
  const yuanPrompt = promptBuilders[1][1](runtime.root, promptBuilders[1][2], incoming);
  assert.doesNotMatch(yuanPrompt, /科技仅普通使用\/社媒浅知|不做精确技术答题/);
  const liuPrompt = promptBuilders[2][1](runtime.root, promptBuilders[2][2], incoming);
  assert.match(liuPrompt, /专业型皮肤管理专家/);
  assert.doesNotMatch(liuPrompt, /新职业尚未定稿|当前具体职业待定|她对表演或音乐/);
  assert.doesNotMatch(liuPrompt, /不因名气就懂金融/);
  assert.doesNotMatch(liuPrompt, /## G03|## G16|## G17|【NPC独立生活|可原创她自己的轻量生活插曲|已是一线知名演员/);
  assert.match(liuPrompt, /专业型/);
  const ongoing=liu.createLiu();
  const contactLife=(await runtime.load('lib/npc/contact-life'));
  const contact=contactLife.ensureContact(ongoing,Date.now());
  contact.returning={gapMs:7200000,explained:true,conflict:false,followedUp:true};
  contact.journal=[{at:Date.now(),topic:'work',sceneId:'synthetic',text:'已有记录：昨天把手头方案整理完了',major:false,step:1}];
  const snapshot=structuredClone(ongoing);
  const continuity=promptBuilders[2][1](runtime.root,ongoing,'我刚忙完回来');
  assert.match(continuity,/"returning":\{"gapMs":7200000,"explained":true/);
  assert.match(continuity,/昨天把手头方案整理完了/);
  assert.doesNotMatch(continuity,/kind为share\/evening时主动分享/);
  assert.deepEqual(ongoing,snapshot,'Professional continuity must be read-only');
  const chenPrompt = promptBuilders[3][1](runtime.root, promptBuilders[3][2], incoming);
  assert.doesNotMatch(chenPrompt, /最多4条|每条最多80字|\*\*默认 2 条\*\*|不自动变成金融法律医学工程专家|不能自动成为法律、医疗、投资/);
  assert.doesNotMatch(chenPrompt, /9\. 场景反应|10\. 对话样本|CN-U\d+|【恋人疲惫】|【离开追问】|【高吸引关系】|## G03/);
  assert.match(chenPrompt, /活动策划、城市体验、现场组织/);
  console.log('PASS four real parsers preserve independent reactions, coarse language, 6 messages and a >4000-character professional section; transport overflow fails explicitly; media/value guards remain');
  console.log('PASS four real prompt builders remove occupational knowledge gates and Chen hard quotas, expose stable identity and current-rule precedence, without changing relationship or memory');
} finally {
  runtime.cleanup();
}
