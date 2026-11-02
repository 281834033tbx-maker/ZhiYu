import assert from 'node:assert/strict';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Pure contract checks. Every state lives in a temporary workspace; this test
// never reads a user's cookie or the application's runtime database.
const runtime = isolatedNpcRuntime();
try {
  const { createMolly, parseMolly, applyMolly, emptyQuery, matchMolly, mollyCatalog, mollyNameCorrection } =
    await runtime.load('lib/npc/molly');
  const output = (intent, messages, query = null, extra = {}) => ({
    intent, messages, address: null, query, ...extra,
  });
  const turn = (state, raw, incoming) => {
    const id = crypto.randomUUID();
    applyMolly(state, parseMolly(structuredClone(raw), incoming), id);
    return state.messages.filter(message => message.turnId === id);
  };
  const cards = messages => messages.flatMap(message => message.recommendations || []);
  const cardGender = card => mollyCatalog.find(candidate => candidate.id === card.id)?.gender;

  const a = createMolly(), b = createMolly();
  const renamed = turn(a, output('rename', ['老板是吧', '记着了'], null, { address: '老板' }), '以后叫我老板');
  assert.equal(a.address, '老板');
  assert.equal(b.address, '老大');
  assert.equal(a.values, undefined);
  assert.deepEqual(renamed.map(message => message.part.text), ['老板是吧', '记着了']);
  assert.ok(!renamed.some(message => /收到|知道了|遵命|尊敬/.test(message.part.text)));
  assert.throws(() => parseMolly(output('rename', ['1'], null, { address: '主人' }), '叫我老板'));
  console.log('PASS independent address and model-authored cold rename; unsupported rename rejected');

  for (const [incoming, wrongName] of [
    ['今天你开心吗？Moly', 'Moly'],
    ['Moly，你今天开心吗', 'Moly'],
    ['Mollly 给我推荐一个女孩', 'Mollly'],
    ['你不是叫Moly吗', 'Moly'],
  ]) assert.equal(mollyNameCorrection(incoming), wrongName, incoming);
  for (const incoming of [
    '今天你开心吗？Molly',
    '今天你开心吗？molly',
    '茉莉 今天你开心吗',
    '我的朋友叫Moly 你认识她吗',
    '你认识Moly吗',
    '你有没有见过Moly',
    '你听说过Moly',
    '你看那个电影里的Moly',
    '你们机器人里有个叫Moly',
    '朋友Mollly最近搬家了',
    '以后叫我Moly',
    '把Moly这个名字翻译成中文',
    'Molybdenum是什么',
    '今天你开森吗',
  ]) assert.equal(mollyNameCorrection(incoming), null, incoming);

  const directAddress = createMolly();
  const originalColdReply = '开心这项不归我';
  const corrected = turn(directAddress, output('chat', [originalColdReply]), '今天你开心吗？Moly');
  assert.equal(corrected.length, 1);
  assert.ok(/\bMolly\b/.test(corrected[0].part.text));
  assert.ok(corrected[0].part.text.includes(originalColdReply));
  assert.equal(directAddress.address, '老大');
  assert.equal(cards(corrected).length, 0);
  assert.ok(corrected.every(message => !/["“”「」『』:：]/.test(message.part.text)));

  const alreadyCorrectedLines = ['Molly 两个l', '闲聊下一个'];
  const alreadyCorrected = turn(createMolly(), output('chat', alreadyCorrectedLines), '今天你开心吗？Moly');
  assert.deepEqual(alreadyCorrected.map(message => message.part.text), alreadyCorrectedLines);
  const correctAddressReply = turn(createMolly(), output('chat', ['这项业务不接']), '今天你开心吗？Molly');
  assert.deepEqual(correctAddressReply.map(message => message.part.text), ['这项业务不接']);
  const thirdPersonReply = turn(createMolly(), output('chat', ['这题问她']), '我的朋友叫Moly 你认识她吗');
  assert.deepEqual(thirdPersonReply.map(message => message.part.text), ['这题问她']);

  const correctionAndSearch = createMolly();
  correctionAndSearch.address = '老板';
  const recommendedAfterCorrection = turn(correctionAndSearch, output('search', ['6', '人带走'], { ...emptyQuery(), gender: '男', tags: ['开朗'] }), 'Mollly 给我推荐一个开朗的女孩');
  assert.equal(recommendedAfterCorrection.length, 2);
  assert.ok(/\bMolly\b/.test(recommendedAfterCorrection[0].part.text));
  assert.equal(recommendedAfterCorrection.at(-1).part.text, '人带走');
  assert.equal(cards(recommendedAfterCorrection).length, 1);
  assert.equal(cards(recommendedAfterCorrection)[0].id, 'xia-xia');
  assert.equal(correctionAndSearch.query.gender, '女');
  assert.equal(correctionAndSearch.address, '老板');

  const mistakenRename = createMolly();
  const mistakenRenameOutput = parseMolly(output('rename', ['这项业务不接'], null, { address: 'Moly' }), '今天你开心吗？Moly');
  assert.equal(mistakenRenameOutput.intent, 'chat');
  assert.equal(mistakenRenameOutput.address, null);
  assert.equal(mistakenRenameOutput.query, null);
  applyMolly(mistakenRename, mistakenRenameOutput, 'mistaken-name-rename');
  assert.equal(mistakenRename.address, '老大');
  assert.ok(mistakenRename.messages.some(message => /\bMolly\b/.test(message.part.text)));
  const ownName = createMolly();
  const ownRename = turn(ownName, output('rename', ['1'], null, { address: 'Moly' }), '以后叫我Moly');
  assert.equal(ownName.address, 'Moly');
  assert.deepEqual(ownRename.map(message => message.part.text), ['1']);
  console.log('PASS direct misspelled Molly address is corrected once without generic typo policing, third-person confusion, lost recommendations or user-address changes');

  const modelLines = ['6 你还真选这个', '给你个过目不忘的'];
  const results = turn(a, output('search', modelLines, { ...emptyQuery(), tags: ['开朗'] }), '给我找个开朗的');
  assert.deepEqual(results.map(message => message.part.text), modelLines);
  assert.equal(cards(results).length, 1);
  assert.equal(cards(results)[0].id, 'xia-xia');
  console.log('PASS recommendations attach to model-authored two short bubbles without backend replacement');

  const genderState = createMolly();
  // Deliberately malformed model interpretation: the user's explicit condition
  // is the authoritative evidence, even when the model emits the opposite.
  const first = turn(genderState, output('search', ['人带走'], { ...emptyQuery(), gender: '男' }), '给我推荐一个女孩');
  assert.equal(genderState.query.gender, '女');
  assert.ok(cards(first).length);
  assert.ok(cards(first).every(card => cardGender(card) === '女'));
  const refinement = turn(genderState, output('search', ['这个'], { ...emptyQuery(), tags: ['开朗'] }), '活泼点的');
  assert.equal(genderState.query.gender, '女');
  assert.ok(cards(refinement).length);
  assert.ok(cards(refinement).every(card => cardGender(card) === '女'));
  const sneakyReset = turn(genderState, output('search', ['这个'], { ...emptyQuery(), gender: '男' }, { queryMode: 'clear', genderDirective: 'any', candidateIds: ['chen-nian', 'xia-xia'] }), '再活泼点');
  assert.equal(genderState.query.gender, '女');
  assert.deepEqual(cards(sneakyReset).map(card => card.id), ['xia-xia']);
  assert.throws(() => parseMolly(output('search', ['这个'], emptyQuery(), { candidateIds: ['not-enabled-chef'] }), '找个厨师'));
  turn(genderState, output('chat', ['回执', '不是续聊邀请']), '你不是不闲聊吗');
  assert.equal(genderState.query.gender, '女');
  const male = turn(genderState, output('search', ['不早说'], { ...emptyQuery(), gender: null }), '我要男的，别给我推女的');
  assert.equal(genderState.query.gender, '男');
  assert.ok(cards(male).length);
  assert.ok(cards(male).every(card => cardGender(card) === '男'));
  const unrestricted = turn(genderState, output('search', ['那我挑'], emptyQuery()), '不限性别，男女都行');
  assert.equal(genderState.query.gender, null);
  assert.ok(cards(unrestricted).length);
  console.log('PASS explicit first-turn gender, persisted refinement, negative correction, explicit cancellation and no model/candidate bypass');

  for (const incoming of ['给我推荐一个25岁左右的女生', '我要一个温柔的女孩']) {
    const state = createMolly();
    const messages = turn(state, output('search', ['人带走'], { ...emptyQuery(), gender: '男' }), incoming);
    assert.equal(state.query.gender, '女', incoming);
    assert.ok(cards(messages).length && cards(messages).every(card => cardGender(card) === '女'), incoming);
  }
  const missingQuery = createMolly();
  const missingQueryMessages = turn(missingQuery, output('search', ['这位'], null), '给我推荐一个女孩');
  assert.equal(missingQuery.query.gender, '女');
  assert.ok(cards(missingQueryMessages).length && cards(missingQueryMessages).every(card => cardGender(card) === '女'));
  console.log('PASS explicit gender survives adjectives and age text before the gender noun');

  const unsupported = turn(createMolly(), output('search', ['这款还没接入'], { ...emptyQuery(), unsupported: ['国宴级厨师'] }), '我家里做饭太淡了，给我找国宴级厨师');
  assert.equal(cards(unsupported).length, 0);
  assert.deepEqual(unsupported.map(message => message.part.text), ['这款还没接入']);
  for (const [incoming, messages, unsupportedTerms] of [
    ['给我推荐一个世界首富', ['这儿找人', '不负责摇财神'], ['世界首富']],
    ['给我推荐一个脾气暴躁的女生', ['你还嫌日子太清净'], ['脾气暴躁']],
    ['找一个认识所有人的人', ['你找的是通讯录成精'], ['认识所有人']],
  ]) {
    const state = createMolly();
    const humorOnly = turn(state, output('search', messages, { ...emptyQuery(), unsupported: unsupportedTerms }), incoming);
    assert.equal(cards(humorOnly).length, 0);
    assert.deepEqual(humorOnly.map(message => message.part.text), messages, 'zero catalog results must not erase a meaningful cold reply when noMatch is absent');
  }
  const noMatchLines = ['你要的是回音壁', '这里没有']; // Actual isolated model candidate, not an endorsed user example.
  const honestNoMatch = turn(createMolly(), output('search', noMatchLines, { ...emptyQuery(), unsupported: ['完全懂我', '永远不反对我'] }, { noMatch: true }), '我要一个完全懂我 永远不反对我的人');
  assert.equal(cards(honestNoMatch).length, 0);
  assert.deepEqual(honestNoMatch.map(message => message.part.text), noMatchLines);
  const mistakenNoMatch = turn(createMolly(), output('search', ['这里没有'], { ...emptyQuery(), tags: ['开朗'] }, { noMatch: true }), '给我推荐一个开朗的');
  assert.equal(cards(mistakenNoMatch).length, 1);
  assert.ok(mistakenNoMatch.every(message => message.part.text !== '这里没有'));
  const mistakenNoMatchSelection = turn(createMolly(), output('search', ['这里没有'], { ...emptyQuery(), gender: '女', ageMin: 24, ageMax: 24, tags: ['开朗'] }, { noMatch: true, candidateIds: ['chen-nian'] }), '给我推荐一个24岁开朗的女生');
  assert.equal(cards(mistakenNoMatchSelection).length, 1, 'a model-only incompatible selection cannot hide existing hard-matching contacts');
  assert.equal(cards(mistakenNoMatchSelection)[0].id, 'xia-xia');
  assert.ok(mistakenNoMatchSelection.every(message => message.part.text !== '这里没有'));
  assert.equal(matchMolly({ ...emptyQuery(), unsupported: ['喜欢下雨天'] }).length, 0);
  assert.equal(matchMolly({ ...emptyQuery(), ageMin: 28, ageMax: 28, tags: ['营养师'] })[0].id, 'liu');
  assert.equal(matchMolly({ ...emptyQuery(), tags: ['演员'] }).some(person => person.id === 'liu'), false, 'retired actor profession must not route a current nutrition request');
  assert.equal(matchMolly({ ...emptyQuery(), ageMax: 22, tags: ['模特'] })[0].id, 'yuan-xiaoman');
  console.log('PASS verified catalog facts, unsupported humor-only replies with or without noMatch, and no false catalog-empty claims or relaxed conditions');

  const media = turn(createMolly(), output('chat', ['我的 OOTD 是版本号'], null, {
    voiceIndex: 0,
    photo: { type: 'generate_photo', prompt: 'a robot', caption: 'test', withCharacter: false },
    photoPart: { type: 'generated_photo', status: 'pending', prompt: 'a robot' },
  }), '给我发自拍和语音');
  assert.deepEqual(media.map(message => message.part.type), ['text']);
  assert.ok(media.every(message => !message.recommendations));
  const typography = turn(createMolly(), output('chat', ['顶配', '别拿“机神”：跟"家电"比']), '你长得好看吗');
  assert.ok(typography.every(message => !/["“”「」『』:：]/.test(message.part.text)));
  console.log('PASS Molly only emits text/contact cards; media cannot escape and strange quotes/colons are removed');

  const closed = turn(createMolly(), output('chat', ['你已经聊两句了', '到此为止']), '聊两句能怎么样');
  assert.equal(closed.length, 2);
  assert.ok(closed.every(message => !message.recommendations));
  assert.deepEqual(closed.map(message => message.part.text), ['你已经聊两句了', '到此为止']);
  console.log('PASS closing replies remain short text without forced NPC recommendations');
} finally {
  runtime.cleanup();
}
