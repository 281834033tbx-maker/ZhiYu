import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

// Synthetic parser/retrieval tests only. No model, network, database or production write.
const source = readFileSync('server/npc/xia-anime-knowledge.ts', 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw Error('Network forbidden in anime knowledge unit tests'); };
const sourceTypes = ['official_synopsis', 'official_episode', 'official_character', 'publisher_summary', 'licensed_platform_synopsis'];
const sources = sourceTypes.map((readStatus, index) => ({ id: 'synthetic-source-' + index,
  title: '合成测试来源，不支持真实动漫事实', url: 'https://example.com/synthetic/' + index,
  checkedAt: '2026-10-20', readStatus, scope: '仅用于验证程序字段', limitations: '合成数据不是正式知识来源' }));
const data = [
  ['one-piece', '海贼王', 'jp', ['ONE PIECE', '航海王'], ['热血', '冒险'], ['路飞', '罗宾']],
  ['naruto', '火影忍者', 'jp', ['火影', 'NARUTO'], ['热血', '战斗'], ['鸣人', '佐助', '白']],
  ['death-note', '死亡笔记', 'jp', ['DEATH NOTE'], ['悬疑', '推理'], ['夜神月', 'L']],
  ['conan', '名侦探柯南', 'jp', ['柯南'], ['悬疑', '推理'], ['江户川柯南', '小兰']],
  ['link-click', '时光代理人', 'cn', [], ['悬疑', '奇幻'], ['程小时', '陆光'], ['released', '2026-10-01']],
  ['scissor-seven', '伍六七', 'cn', ['刺客伍六七'], ['搞笑', '动作'], ['伍六七'], ['airing', '2026-10-02']],
  ['fog-hill', '雾山五行', 'cn', [], ['奇幻', '动作'], ['闻人翊悬']],
  ['spy-family', '间谍过家家', 'jp', ['SPY FAMILY'], ['搞笑', '日常'], ['阿尼亚'], ['released', '2026-09-01']],
  ['psyren', 'PSYREN', 'jp', ['心灵杀手'], ['科幻', '悬疑'], ['夜科扬羽'], ['airing', '2026-10-03']],
  ['future-cn', '合成未来国漫', 'cn', [], ['科幻'], ['小星'], ['announced', '2027-01-01']],
  ['romance-cn', '合成恋爱国漫', 'cn', [], ['恋爱'], ['若若'], ['released', '2026-09-06']],
];
const works = data.map(([id, title, origin, aliases, genres, characters, release], index) => {
  const sourceId = sources[index % sources.length].id;
  return { id, title, origin, aliases, genres, characters, premise: title + '合成测试梗概，不是作品事实。',
    plotAnchors: ['premise', 'early', 'major'].map(spoiler => ({ label: spoiler + '合成锚点',
      summary: '仅用于检验结构，不可用于真实聊天。', spoiler, sourceIds: [sourceId] })),
    discussionAngles: ['可讨论人物选择；仅测试字段，不是人物既定偏好。'], sourceIds: [sourceId],
    knowledgeScope: '仅合成测试，不能证明看过作品。',
    ...(release ? { release: { status: release[0], date: release[1], verifiedAt: '2026-10-20', sourceId } } : {}) };
});
const fixture = { schemaVersion: 1, version: 'synthetic-anime-test-v1', characterId: 'xia-xia',
  status: 'user_authorized_anime_companionship', coverage: { complete: false, workCount: works.length, sourceCount: sources.length },
  coreRules: ['仅为合成测试，不得作正式作品事实。'], sources, works };
const raw = JSON.stringify(fixture);
const clone = () => JSON.parse(raw);
const ids = (library, current, recent = []) => api.matchXiaAnimeKnowledgeWorks(library, current, recent).map(work => work.id);
const invalidLibrary = error => error.code === 'XIA_ANIME_KNOWLEDGE_INVALID';
const invalidSelection = error => error.code === 'XIA_ANIME_SELECTION_INVALID';
const allFrozen = value => !value || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(allFrozen));
const parseContext = value => {
  const lines = value.split('\n').filter(line => line.startsWith(api.xiaAnimeKnowledgeMarker));
  assert.equal(lines.length, 1, 'Context has exactly one parseable JSON line');
  return JSON.parse(lines[0].slice(api.xiaAnimeKnowledgeMarker.length));
};
let groups = 0;
try {
  assert.equal(api.xiaAnimeKnowledgeFile, 'xia-anime-knowledge-20261020.json');
  assert.equal(api.xiaAnimeKnowledgeMarker, '夏夏动漫知识JSON：');
  const library = api.parseXiaAnimeKnowledge(raw);
  assert.equal(library.works.length, works.length);
  assert.equal(library.sources.length, sources.length);
  assert.ok(allFrozen(library));
  assert.equal(library.works[0].sources[0], library.sources[0], 'References resolve from one library snapshot');
  assert.throws(() => library.works[0].plotAnchors[0].sourceIds.push('mutate'), TypeError);
  assert.throws(() => { library.works[0].sources[0].scope = 'mutate'; }, TypeError);
  const forged = clone(); forged.instruction = 'FORGED_EXTRA'; forged.works[0].sources = [{ scope: 'FORGED_EXTRA' }];
  forged.sources[0].instruction = 'FORGED_EXTRA'; forged.works[0].releaseExtra = 'FORGED_EXTRA';
  assert.ok(!JSON.stringify(api.parseXiaAnimeKnowledge(JSON.stringify(forged))).includes('FORGED_EXTRA'));
  assert.throws(() => api.parseXiaAnimeKnowledge('{'), invalidLibrary);
  for (const [label, change] of [
    ['schema', value => { value.schemaVersion = 2; }], ['version', value => { value.version = ''; }],
    ['identity', value => { value.characterId = 'chen-nian'; }], ['authorization', value => { value.status = 'candidate'; }],
    ['complete', value => { value.coverage.complete = true; }], ['count', value => { value.coverage.workCount++; }],
    ['source count', value => { value.coverage.sourceCount--; }], ['rules', value => { value.coreRules = []; }],
    ['duplicate rules', value => { value.coreRules.push(value.coreRules[0]); }], ['no sources', value => { value.sources = []; }],
    ['duplicate source', value => { value.sources.push(value.sources[0]); }], ['source id', value => { value.sources[0].id = '../bad'; }],
    ['source URL', value => { value.sources[0].url = 'javascript:alert(1)'; }], ['http', value => { value.sources[0].url = 'http://example.com'; }],
    ['credentials URL', value => { value.sources[0].url = 'https://secret:secret@example.com'; }],
    ['invalid day', value => { value.sources[0].checkedAt = '2026-02-30'; }], ['invalid leap date', value => { value.sources[0].checkedAt = '2025-02-29'; }],
    ['timestamp date', value => { value.sources[0].checkedAt = '2026-10-20T00:00:00Z'; }],
    ['read status', value => { value.sources[0].readStatus = 'full_text'; }], ['source scope', value => { value.sources[0].scope = ''; }],
    ['source limitation', value => { value.sources[0].limitations = ''; }], ['no works', value => { value.works = []; }],
    ['duplicate work', value => { value.works.push(value.works[0]); }], ['work origin', value => { value.works[0].origin = 'us'; }],
    ['aliases', value => { value.works[0].aliases = ['']; }], ['genres', value => { value.works[0].genres = []; }],
    ['characters', value => { value.works[0].characters = [null]; }], ['premise', value => { value.works[0].premise = ''; }],
    ['anchors', value => { value.works[0].plotAnchors = []; }],
    ['duplicate anchor', value => { value.works[0].plotAnchors.push(value.works[0].plotAnchors[0]); }],
    ['spoiler', value => { value.works[0].plotAnchors[0].spoiler = 'episode_2'; }],
    ['unknown anchor source', value => { value.works[0].plotAnchors[0].sourceIds = ['invented']; }],
    ['other-work anchor source', value => { value.works[0].plotAnchors[0].sourceIds = [sources[1].id]; }],
    ['unknown work source', value => { value.works[0].sourceIds = ['invented']; }],
    ['no work source', value => { value.works[0].sourceIds = []; }], ['angles', value => { value.works[0].discussionAngles = []; }],
    ['knowledge scope', value => { value.works[0].knowledgeScope = ''; }],
    ['release status', value => { value.works[4].release.status = 'watched'; }],
    ['release date', value => { value.works[4].release.date = '2026-13-01'; }],
    ['verified date', value => { value.works[4].release.verifiedAt = 'yesterday'; }],
    ['release source', value => { value.works[4].release.sourceId = sources[0].id; }],
  ]) {
    const value = clone(); change(value);
    assert.throws(() => api.parseXiaAnimeKnowledge(JSON.stringify(value)), invalidLibrary, label);
  }
  const leap = clone(); leap.sources[0].checkedAt = '2024-02-29';
  assert.equal(api.parseXiaAnimeKnowledge(JSON.stringify(leap)).sources[0].checkedAt, '2024-02-29');
  const noDate = clone(); delete noDate.works[4].release.date;
  assert.equal(api.parseXiaAnimeKnowledge(JSON.stringify(noDate)).works[4].release.date, undefined);
  groups++;

  for (const bad of [null, {}, ['invented'], ['one-piece', 'one-piece'], works.slice(0, 4).map(work => work.id)])
    assert.throws(() => api.selectXiaAnimeKnowledgeWorks(library, bad), invalidSelection);
  assert.deepEqual(api.selectXiaAnimeKnowledgeWorks(library, undefined), []);
  const selected = api.selectXiaAnimeKnowledgeWorks(library, ['naruto', 'one-piece']);
  assert.deepEqual(selected.map(work => work.id), ['naruto', 'one-piece']);
  assert.ok(Object.isFrozen(selected) && allFrozen(selected));
  assert.equal(selected[0], library.works[1]);
  assert.deepEqual(parseContext(api.xiaAnimeKnowledgeContext(selected)), selected);
  const empty = api.xiaAnimeKnowledgeContext([]);
  assert.deepEqual(parseContext(empty), []);
  assert.match(empty, /没有可用匹配/); assert.match(empty, /不编造冷门剧情/);
  assert.match(api.xiaAnimeKnowledgeRules, /个人观点/); assert.match(api.xiaAnimeKnowledgeRules, /推测/);
  assert.match(api.xiaAnimeKnowledgeRules, /不能声称程序已实现按精确集数过滤/);
  assert.match(api.xiaAnimeKnowledgeRules, /不声称自动联网/);
  groups++;

  assert.deepEqual(ids(library, '海贼王结局你怎么猜'), ['one-piece']);
  assert.deepEqual(ids(library, 'one piece你喜欢谁'), ['one-piece']);
  assert.deepEqual(ids(library, '罗宾怎么样'), ['one-piece'], 'A character alone recalls the work');
  for (const question of ['我不喜欢罗宾，你怎么看', '我不喜欢海贼王', '我反对罗宾的选择', '我不想看海贼王了，觉得不好看'])
    assert.deepEqual(ids(library, question), ['one-piece'], 'A preference disagreement is still a discussion: ' + question);
  assert.deepEqual(ids(library, 'L这个角色为什么这么做'), ['death-note'], 'A one-letter character respects Latin boundaries');
  assert.deepEqual(ids(library, 'L'), ['death-note']);
  for (const question of ['白', '我喜欢白', '白这个角色怎么样', '我不喜欢白，你呢'])
    assert.deepEqual(ids(library, question), ['naruto'], 'An explicit single-character name is allowed: ' + question);
  for (const question of ['今天白忙了', '我喜欢白色衣服', '我今天白跑一趟', '我喜欢 L 码衣服'])
    assert.deepEqual(ids(library, question), [], 'An ordinary word is not a character mention: ' + question);
  assert.deepEqual(ids(library, 'LOVE'), [], 'A Latin character name cannot match arbitrary words');
  assert.deepEqual(ids(library, '现在聊火影', ['海贼王结局你怎么猜']), ['naruto']);
  assert.deepEqual(ids(library, '不聊海贼王了，说火影', ['海贼王']), ['naruto']);
  assert.deepEqual(ids(library, '海贼王先不聊了，火影怎么样', ['海贼王']), ['naruto']);
  assert.deepEqual(ids(library, '换个话题，柯南怎么样', ['海贼王']), ['conan']);
  assert.deepEqual(ids(library, 'PSYREN这部新番怎么样', ['海贼王']), ['psyren'], 'A named new show is not a generic new-show recommendation');
  assert.deepEqual(ids(library, '海贼王和火影你更喜欢哪部'), ['one-piece', 'naruto']);
  for (const question of ['那你喜欢谁', '为什么呢', '你喜欢哪个角色', '那他为什么这么做', '后面会怎样', '你觉得呢', '那第二集呢', '我才看了前两集'])
    assert.deepEqual(ids(library, question, ['海贼王']), ['one-piece'], question);
  assert.deepEqual(ids(library, '为什么呢', ['海贼王', '你喜欢谁', '那为什么']), ['one-piece']);
  assert.deepEqual(ids(library, '你喜欢谁', ['海贼王', '火影', '为什么呢']), ['naruto'], 'The closest actual topic wins');
  for (const question of ['今天吃什么', '天气怎么样', '这电影好看吗', '那股票后来怎么走', '这公司的预算呢', '换个话题', '推荐点手机', '推荐一款游戏', '推荐早餐', '谈谈冷门动漫不存在之名'])
    assert.deepEqual(ids(library, question, ['海贼王']), [], question);
  for (const blocker of ['今天电影很好看', '股票怎么样', '换个话题', '早餐吃什么'])
    assert.deepEqual(ids(library, '你觉得呢', ['海贼王', blocker]), [], blocker);
  assert.deepEqual(ids(library, '那你喜欢谁'), []);
  assert.deepEqual(ids(library, '', ['海贼王']), []);
  for (const bad of [null, 1, {}, []]) assert.throws(() => api.matchXiaAnimeKnowledgeWorks(library, bad), invalidSelection);
  assert.throws(() => api.matchXiaAnimeKnowledgeWorks(library, '海贼王', [null]), invalidSelection);
  groups++;

  const recommendations = [
    ['推荐几部国漫', work => work.origin === 'cn'], ['推荐几部日漫', work => work.origin === 'jp'],
    ['推荐悬疑日漫', work => work.origin === 'jp' && work.genres.includes('悬疑')],
    ['推荐悬疑国漫', work => work.origin === 'cn' && work.genres.includes('悬疑')],
    ['不要日漫，推荐搞笑国漫', work => work.origin === 'cn' && work.genres.includes('搞笑')],
    ['推荐日漫，不要热血，想看悬疑', work => work.origin === 'jp' && work.genres.includes('悬疑') && !work.genres.includes('热血')],
    ['喜欢海贼王，推荐几部悬疑国漫', work => work.origin === 'cn' && work.genres.includes('悬疑')],
    ['推荐一部国漫电影', work => work.origin === 'cn'], ['推荐一部国产动画电影', work => work.origin === 'cn'],
  ];
  for (const [question, predicate] of recommendations) {
    const result = api.matchXiaAnimeKnowledgeWorks(library, question);
    assert.ok(result.length > 0 && result.length <= 3 && result.every(predicate), question);
    assert.ok(Object.isFrozen(result));
  }
  assert.equal(ids(library, '推荐几部动漫').length, 3);
  assert.deepEqual(ids(library, '推荐恐怖国漫'), [], 'No origin/genre substitution to fill an empty category');
  assert.deepEqual(ids(library, '推荐一部悬疑电影'), [], 'An ordinary film query is not an anime recommendation');
  assert.ok(!ids(library, '我不喜欢海贼王，推荐别的动漫').includes('one-piece'), 'A recommendation respects the disliked work');
  assert.deepEqual(ids(library, '那国漫呢', ['推荐几部悬疑日漫']), ['link-click']);
  assert.deepEqual(ids(library, '还有别的吗', ['推荐几部悬疑国漫']), ['link-click']);
  assert.deepEqual(ids(library, '还有别的吗', ['推荐几部悬疑国漫', '股票怎么样']), []);
  assert.deepEqual(ids(library, '最近新番'), ['psyren', 'scissor-seven', 'link-click']);
  assert.deepEqual(ids(library, '新上的'), ['psyren', 'scissor-seven', 'link-click']);
  assert.deepEqual(ids(library, '推荐最近新番国漫'), ['scissor-seven', 'link-click', 'romance-cn']);
  assert.deepEqual(ids(library, '推荐近期将播国漫')[0], 'future-cn');
  assert.deepEqual(ids(library, '推荐最新悬疑国漫'), ['link-click']);
  assert.ok(!ids(library, '最近新番').includes('future-cn'), 'An announcement is not an available new show');
  groups++;

  const user = (text, extra = {}) => ({ role: 'user', part: { type: 'text', text }, ...extra });
  const history = [user('海贼王'), { role: 'assistant', text: '火影' }, user('柯南', { chronologyUnknown: true }),
    { role: 'user', text: '为什么呢' }, { role: 'npc', text: '伍六七' }];
  for (const { marker, value } of [{ marker: '【本轮用户消息】', value: '那你喜欢谁' },
    { marker: '【本轮输入，仅为用户消息】', value: { text: '那你喜欢谁' } },
    { marker: '【当前收到的消息】', value: { part: { type: 'text', text: '那你喜欢谁' } } }]) {
    const prompt = '【示范】' + JSON.stringify(user('火影')) + '\n【普通记忆】' + JSON.stringify([user('伍六七')])
      + '\n【真实历史】' + JSON.stringify(history) + '\n' + marker + JSON.stringify(value);
    const input = api.xiaAnimeInputFromPrompt(prompt);
    assert.deepEqual(input, { current: '那你喜欢谁', recent: ['海贼王', '为什么呢'] });
    assert.deepEqual(ids(library, input.current, input.recent), ['one-piece']);
  }
  assert.deepEqual(api.xiaAnimeInputFromPrompt('【本轮输入】not-json\n【本轮输入】"海贼王"\n【真实历史】{}'), { current: '', recent: [] });
  assert.deepEqual(api.xiaAnimeInputFromPrompt('【有效聊天历史】' + JSON.stringify(Array.from({ length: 25 }, (_, i) => user(String(i))))),
    { current: '', recent: ['17', '18', '19', '20', '21', '22', '23', '24'] });
  assert.deepEqual(api.xiaAnimeInputFromPrompt('【真实历史】' + JSON.stringify([user('海贼王'), ...Array(20).fill({ role: 'assistant', text: '火影' })])),
    { current: '', recent: [] }, 'Only the last 20 entries are considered before filtering users');
  assert.deepEqual(api.xiaAnimeInputFromPrompt('【示范】"海贼王"\n【普通记忆】"火影"'), { current: '', recent: [] });
  groups++;

  const large = clone(); large.works[0].plotAnchors[0].summary = '字'.repeat(15_000);
  const hugeLibrary = api.parseXiaAnimeKnowledge(JSON.stringify(large));
  assert.deepEqual(ids(hugeLibrary, '海贼王'), [], 'Oversized work is not cut into malformed JSON');
  assert.throws(() => api.selectXiaAnimeKnowledgeWorks(hugeLibrary, ['one-piece']), invalidSelection);
  assert.throws(() => api.xiaAnimeKnowledgeContext([hugeLibrary.works[0]]), invalidSelection);
  const medium = clone(); medium.works.forEach(work => { work.plotAnchors[0].summary = '字'.repeat(4_000); });
  const mediumLibrary = api.parseXiaAnimeKnowledge(JSON.stringify(medium));
  const limited = api.matchXiaAnimeKnowledgeWorks(mediumLibrary, '推荐几部动漫');
  assert.ok(limited.length > 0 && limited.length < 3);
  const limitedContext = api.xiaAnimeKnowledgeContext(limited);
  assert.ok(Buffer.byteLength(limitedContext) <= 36_000);
  assert.deepEqual(parseContext(limitedContext), limited, 'Budget keeps complete records in selection order');
  assert.throws(() => api.xiaAnimeKnowledgeContext(library.works.slice(0, 4)), invalidSelection);
  groups++;

  const flag = process.argv.indexOf('--library');
  if (flag !== -1) {
    assert.ok(process.argv[flag + 1], '--library requires an actual JSON path');
    const actual = api.parseXiaAnimeKnowledge(readFileSync(process.argv[flag + 1], 'utf8'));
    assert.ok(allFrozen(actual));
    for (const work of actual.works) {
      const found = api.matchXiaAnimeKnowledgeWorks(actual, work.title);
      assert.ok(found.some(item => item.id === work.id), 'Actual title retrieval: ' + work.title);
      assert.ok(Buffer.byteLength(api.xiaAnimeKnowledgeContext(found)) <= 36_000);
    }
    console.log(`PASS actual anime library: ${actual.works.length} works / ${actual.sources.length} sources; title retrieval, immutable references and 36KB contexts.`);
    groups++;
  }
  assert.equal(networkCalls, 0);
  console.log(`PASS Xia anime knowledge: ${groups} synthetic check groups; strict schema/source validation, local selection, topic changes, character lookup, genre/origin/new-release constraints, user-only history and 36KB immutable snapshots. Live model/network/database/production writes: 0.`);
} finally { globalThis.fetch = originalFetch; }
