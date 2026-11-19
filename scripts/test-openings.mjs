import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Literal independent expectations and real disposable SQLite. No model or App.
const expected = {
  molly: ['老大，我是你的专属私人秘书Molly。', '从今天起，智域整个团队都围着你转。', {type: 'team_card', version: 1},
    '生活中的大事小事，小到缴费采购，大到健身减脂，都交给我帮你规划、安排、盯进度……',
    '想找谁，我帮你对接；需要他们配合，直接帮你拉群；或者不想跟他们聊，直接找我也OK。',
    '这些智友个个都是行业顶尖专家，每句话都有权威依据，谁说话不靠谱，直接找我投诉。',
    '没有新手教程，微信怎么用，智域就怎么用。', '以后只需要动嘴，剩下的全交给我们。', '欢迎上任，董事长。'],
  'he-jiawei': ['何嘉伟', '老大，团队的日常运营归我管，每个人的工作进度和质量，由我来保证',
    '工作上、生意上碰到棘手的事，跟我说，我给你一个理性的判断', '有事直说'],
  'chen-nian': ['老大好！我是陈年，智域金牌健身教练😎', '想练成彭于晏，还是瘦成一道闪电，跟我说就行',
    '网上那套东西太多，你也分辨不过来，直接听我的就完事了', '我会按照你的身体情况，给你专门定制计划，日常训练和运动补剂，我都包了',
    '丑话说前头，你要是没练出效果，Molly第一个扣我工资😭', '做计划之前，我先了解一下老大你的身体情况，方便了咱们聊聊'],
  liu: ['老大好，我是柳智敏', '智域首席营养官', '网上关于饮食的说法良莠不齐，以后不需要你自己分辨，听我的就好',
    '不论是兼顾口感与热量的减脂餐，\n识破营养品里的智商税，\n营养配比精准的一日三餐，\n还是帮你选出附近最健康的外卖，', '凡是跟营养有关的，都交给我就好🍃'],
  'zhou-chef': ['老大您好，我叫赵一帆，智域首席大厨', '网上教做菜的一大堆，只教步骤，不教门道',
    '家常便饭、国宴级大菜、拍照好看的漂亮饭，我都一步一步带您做', '从根上把容易做砸的地方避开，保证做出来好吃', '您想下厨的时候，说一声就行'],
  'yuan-xiaoman': ['老大你好呀，我是小满～', '我是智域的主编，每天的工作就是读别人的故事',
    '不像年哥他们，能帮你练身材、管吃饭，我好像没什么一技之长🥲', '不过你的进度，我会悄悄帮你盯着，偷懒的话，Molly会知道的🤫', '当然，真累了就歇歇，我偷偷替你瞒着～'],
  'xia-xia': ['老大好呀！！我是夏夏(≧▽≦)', '智域的吉祥物就是我啦，也是全公司最闲的人😎',
    '平时最爱追番打游戏，恐怖片也敢一个人看，就是看完不敢关灯😭', '公司里的大事小事、八卦新闻，问我就对了，我啥都知道🤫', '以后咱们就是朋友啦！', '随时戳我～'],
};
const runtime = isolatedNpcRuntime(); let db, count = 0;
const pass = name => {count++; console.log('PASS', name);};
try {
  const {OpeningService, openingServiceFor, isFixedOpeningMessage} = await runtime.load('server/npc/opening-service');
  const {openingFor, openingCharacterId, OPENING_CHARACTER_IDS} = await runtime.load('lib/npc/opening');
  const {deliveredMessages, deliveryView} = await runtime.load('lib/npc/delivery');
  const {initializeNewAccountOpening} = await runtime.load('server/npc/experience-onboarding');
  for (const [id, messages] of Object.entries(expected)) {
    assert.deepEqual(openingFor(id), {version: id === 'molly' ? 2 : 1, messages});
    assert.ok(Object.isFrozen(openingFor(id).messages)); pass(`${id} exact literal version, punctuation, emoji and newline`);
  }
  assert.equal(openingCharacterId('molly-system-secretary'), 'molly'); assert.equal(openingCharacterId('unknown'), null);
  assert.throws(() => openingFor('unknown')); assert.deepEqual(openingFor('molly-system-secretary'), openingFor('molly'));
  pass('canonical IDs only, Molly compatibility alias, immutable shared API');
  mkdirSync(join(runtime.root, '.npc-runtime'), {recursive: true});
  db = new DatabaseSync(join(runtime.root, '.npc-runtime/openings-test.sqlite'));
  const base = Date.parse('2026-11-19T04:00:00Z'); let clock = base;
  const service = new OpeningService(db, runtime.root, () => clock, {rng: () => 0});
  const locations = {
    molly: ['molly_sessions', 'molly-system-secretary'], 'xia-xia': ['sessions', 'xia-xia:normal'],
    'yuan-xiaoman': ['yuan_sessions', 'yuan-xiaoman'], 'he-jiawei': ['he_sessions', 'he-jiawei'],
    'chen-nian': ['chen_sessions', 'chen-nian'], liu: ['liu_sessions', 'liu'], 'zhou-chef': ['zhou_chef_sessions', 'zhou-chef'],
  };
  function read(owner, id) {
    const [table, suffix] = locations[id];
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) return null;
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${suffix}`);
    return row ? JSON.parse(row.data) : null;
  }
  function write(owner, id, value) {
    const [table, suffix] = locations[id];
    db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,${id === 'xia-xia' ? 'revision INTEGER NOT NULL,' : ''}data TEXT NOT NULL)`);
    if (id === 'xia-xia') db.prepare(`INSERT OR REPLACE INTO ${table}(id,revision,data) VALUES(?,?,?)`).run(`${owner}:${suffix}`, value.revision || 0, JSON.stringify(value));
    else db.prepare(`INSERT OR REPLACE INTO ${table}(id,data) VALUES(?,?)`).run(`${owner}:${suffix}`, JSON.stringify(value));
  }
  const openingStatus = (owner, id) => db.prepare('SELECT status FROM npc_opening_states WHERE owner=? AND npc_id=?').get(owner, id)?.status;
  assert.equal(service.open('old-empty-owner', 'chen-nian'), false); assert.equal(service.tick('old-empty-owner'), 0);
  assert.equal(read('old-empty-owner', 'chen-nian'), null); pass('old account with no chat is never inferred new by GET/tick');
  assert.equal(service.initializeRegistration('new-owner'), true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM npc_opening_states WHERE owner=?').get('new-owner').n, 7);
  const molly = read('new-owner', 'molly'); assert.equal(molly.messages.length, 9);
  assert.deepEqual(molly.messages.map(message => message.part.type === 'text' ? message.part.text : message.part), expected.molly);
  assert.ok(molly.messages.every(isFixedOpeningMessage)); assert.equal(molly.messages.filter(message => message.part.type === 'team_card').length, 1);
  assert.ok(molly.messages.every(message => message.secretaryEvent.kind === 'opening'));
  assert.equal(molly.messages[2].id, 'fixed-opening-molly-v2-3');
  pass('fresh registration queues eight raw Molly texts plus the approved temporary team poster in its third slot');
  assert.equal(deliveredMessages(molly.messages, clock).length, 0);
  assert.equal(deliveryView(molly.messages, null, clock).pending, true);
  assert.ok(molly.messages.every((message, index) => message.typingAt > base && message.deliverAt > message.typingAt && (!index || message.typingAt >= molly.messages[index - 1].deliverAt + 300)));
  clock = molly.messages[0].deliverAt;
  assert.deepEqual(deliveredMessages(molly.messages, clock).map(message => message.part.text), expected.molly.slice(0, 1));
  pass('existing delivery pacing presents typed bubbles sequentially, never one immediate block');
  assert.equal(service.initializeRegistration('new-owner'), false); assert.equal(service.open('new-owner', 'molly-system-secretary'), false);
  assert.deepEqual(read('new-owner', 'molly'), molly); pass('second registration and repeated GET never duplicate or rewrite Molly');
  clock = base + 59_999; assert.equal(service.tick('new-owner'), 0); assert.equal(read('new-owner', 'yuan-xiaoman'), null);
  assert.equal(service.open('new-owner', 'yuan-xiaoman'), false); assert.equal(read('new-owner', 'xia-xia'), null);
  clock++; assert.equal(service.tick('new-owner'), 1); const yuan = read('new-owner', 'yuan-xiaoman');
  assert.deepEqual(yuan.messages.map(message => message.part.text), expected['yuan-xiaoman']);
  assert.ok(yuan.messages[0].deliverAt >= base + 60_000 && yuan.messages[0].deliverAt < base + 120_000);
  clock = base + 89_999; assert.equal(service.tick('new-owner'), 0); assert.equal(read('new-owner', 'xia-xia'), null);
  clock++; assert.equal(service.tick('new-owner'), 1); const xia = read('new-owner', 'xia-xia');
  assert.deepEqual(xia.messages.map(message => message.part.text), expected['xia-xia']);
  assert.ok(xia.messages[0].deliverAt > yuan.messages[0].deliverAt && xia.messages[0].deliverAt < base + 120_000);
  pass('companions proactively begin at 60/90 seconds, staggered first delivery within the 1–2 minute window');
  for (const id of ['he-jiawei', 'chen-nian', 'liu', 'zhou-chef']) {
    assert.equal(read('new-owner', id), null); assert.equal(service.open('new-owner', id), true);
    assert.deepEqual(read('new-owner', id).messages.map(message => message.part.text), expected[id]);
    assert.equal(service.open('new-owner', id), false); pass(`${id} first GET only, exact payload preserved and never repeated`);
  }
  assert.equal(read('new-owner', 'liu').messages[3].part.text.split('\n').length, 4);
  pass('Liu multiline fourth entry stays one bubble without normalization or splitting');
  const newMolly = {...read('new-owner', 'molly'), address: '董事长', arbitrarySettings: {mustPreserve: true}};
  write('new-owner', 'molly', newMolly); assert.equal(service.open('new-owner', 'molly'), false);
  assert.deepEqual(read('new-owner', 'molly'), newMolly); pass('saved custom address/settings do not replace fixed 老大 or mutate retained state');
  clock = base; assert.equal(service.initializeRegistration('interrupted'), true);
  let interrupted = read('interrupted', 'molly'); clock = interrupted.messages[1].deliverAt;
  const safeFuture = {id: 'unrelated', turnId: 'normal-turn', role: 'assistant', at: new Date(clock + 9999).toISOString(), deliverAt: clock + 9999, part: {type: 'text', text: '正常回复保留'}};
  interrupted.messages.push(safeFuture); write('interrupted', 'molly', interrupted);
  assert.equal(service.noteUserSpeech('interrupted', 'molly'), true);
  interrupted = read('interrupted', 'molly');
  assert.deepEqual(interrupted.messages.filter(isFixedOpeningMessage).map(message => message.part.text), expected.molly.slice(0, 2));
  assert.deepEqual(interrupted.messages.at(-1), safeFuture);
  assert.equal(openingStatus('interrupted', 'molly'), 'cancelled'); assert.equal(service.noteUserSpeech('interrupted', 'molly'), false);
  clock += 200_000; service.tick('interrupted'); assert.equal(read('interrupted', 'molly').messages.length, 3);
  pass('mid-introduction speech removes only undelivered fixed bubbles, preserves delivered prefix and unrelated future replies permanently');
  clock = base; service.initializeRegistration('state-in-save-callback');
  const loaded = read('state-in-save-callback', 'molly'), revision = loaded.revision;
  assert.equal(service.noteUserSpeech('state-in-save-callback', 'molly', loaded), true); assert.equal(loaded.messages.length, 0);
  assert.equal(read('state-in-save-callback', 'molly').messages.length, 9, 'caller owns final source-state save');
  loaded.messages.push({id: 'real-user', turnId: 'real-user', role: 'user', at: new Date(clock).toISOString(), part: {type: 'text', text: '你好'}});
  write('state-in-save-callback', 'molly', loaded);
  assert.equal(read('state-in-save-callback', 'molly').revision, revision);
  assert.equal(deliveryView(read('state-in-save-callback', 'molly').messages, null, clock).pending, false);
  pass('same-connection callback mutates provided state without stale-session overwrite or extra save/revision');
  clock = base; service.initializeRegistration('speech-before-due');
  assert.equal(service.noteUserSpeech('speech-before-due', 'yuan-xiaoman'), true);
  assert.equal(service.noteUserSpeech('speech-before-due', 'chen-nian'), true);
  clock += 180_000; service.tick('speech-before-due');
  assert.equal(read('speech-before-due', 'yuan-xiaoman'), null); assert.equal(service.open('speech-before-due', 'chen-nian'), false);
  assert.equal(read('speech-before-due', 'chen-nian'), null); assert.equal(read('speech-before-due', 'xia-xia').messages.length, 6);
  pass('speech before delayed/first-GET intro cancels that person only; another companion still starts');
  clock = base; service.initializeRegistration('speech-already-saved');
  const spoken = {messages: [{id: 'first', turnId: 'first', role: 'user', at: new Date(clock).toISOString(), part: {type: 'text', text: '先听我说'}}], memories: ['retain'], revision: 4};
  write('speech-already-saved', 'he-jiawei', spoken); assert.equal(service.open('speech-already-saved', 'he-jiawei'), false);
  assert.deepEqual(read('speech-already-saved', 'he-jiawei'), spoken); pass('already persisted speech prevents startup even if its earlier hook was missed');
  db.prepare('INSERT INTO npc_experience_onboarding(owner,at) VALUES(?,?)').run('old-marker', base - 86400000);
  assert.equal(service.initializeRegistration('old-marker'), false); assert.equal(service.open('old-marker', 'liu'), false);
  assert.equal(read('old-marker', 'molly'), null); pass('old v1 onboarding marker blocks v2 and every other new introduction even when chat was cleared');
  const legacyMessage = {messages: [{id: 'molly-opening-1', turnId: 'molly-opening-v1', role: 'assistant', part: {type: 'text', text: '旧开场原文。'}, at: new Date(base - 86400000).toISOString()}]};
  write('old-v1-no-marker', 'molly', legacyMessage); assert.equal(service.initializeRegistration('old-v1-no-marker'), false);
  assert.deepEqual(read('old-v1-no-marker', 'molly'), legacyMessage); pass('retained v1 bubbles also block re-onboarding without migration marker');
  for (const id of OPENING_CHARACTER_IDS) {
    const owner = `history-${id}`, value = {messages: [{id: 'retained', turnId: 'retained', role: 'assistant', at: new Date(base).toISOString(), part: {type: 'text', text: '旧历史'}}], revision: 10};
    write(owner, id, value); assert.equal(service.initializeRegistration(owner), false); assert.deepEqual(read(owner, id), value);
  }
  pass('retained history in any of seven private sessions blocks treating an old owner as new');
  assert.equal(service.initializeRegistration('claimed-legacy', true), false); assert.equal(service.open('claimed-legacy', 'liu'), false);
  assert.equal(service.initializeRegistration('claimed-legacy'), false); pass('claimed legacy owner never receives opening, even if all chats are empty');
  clock = base; service.initializeRegistration('restart');
  const resumed = new OpeningService(db, runtime.root, () => clock, {rng: () => 0});
  clock += 65_000; assert.equal(resumed.tick('restart'), 1); assert.equal(service.tick('restart'), 0);
  clock += 30_000; assert.equal(service.tick('restart'), 1); assert.equal(resumed.tick('restart'), 0);
  assert.equal(resumed.initializeRegistration('restart'), false); pass('re-created service resumes due companions once, with no replay across workers');
  clock = base; service.initializeRegistration('owner-a'); service.initializeRegistration('owner-b');
  const b = read('owner-b', 'molly'); service.noteUserSpeech('owner-a', 'molly'); assert.deepEqual(read('owner-b', 'molly'), b);
  clock += 65_000; service.tick('owner-a'); assert.equal(read('owner-b', 'yuan-xiaoman'), null);
  pass('owner-scoped cancellation and tick cannot mutate another account');
  clock = base; db.exec('BEGIN'); service.initializeRegistration('outer-rollback'); db.exec('ROLLBACK');
  assert.equal(read('outer-rollback', 'molly'), null); assert.equal(db.prepare('SELECT 1 FROM npc_opening_accounts WHERE owner=?').get('outer-rollback'), undefined);
  pass('fresh registration SAVEPOINT joins outer auth transaction; rollback removes eligibility and bubbles together');
  db.exec("CREATE TRIGGER reject_fixed_opening BEFORE INSERT ON molly_sessions WHEN NEW.id='fault-owner:molly-system-secretary' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  assert.throws(() => service.initializeRegistration('fault-owner'), /synthetic failure/u);
  assert.equal(db.prepare('SELECT 1 FROM npc_experience_onboarding WHERE owner=?').get('fault-owner'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM npc_opening_accounts WHERE owner=?').get('fault-owner'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM npc_opening_states WHERE owner=?').get('fault-owner'), undefined); db.exec('DROP TRIGGER reject_fixed_opening');
  assert.equal(service.initializeRegistration('fault-owner'), true); pass('failed bubble write leaves no orphan once-marker; retry performs the exact introduction');
  const snapshot = read('restart', 'molly'); clock += 300_000; resumed.tick('restart'); assert.equal(openingStatus('restart', 'molly'), 'sent');
  assert.equal(resumed.noteUserSpeech('restart', 'molly'), false); assert.deepEqual(read('restart', 'molly'), snapshot);
  pass('completed introduction is terminal without rewriting history when ordinary dialogue starts later');
  assert.equal(openingServiceFor(db, runtime.root), openingServiceFor(db, runtime.root));
  assert.equal(initializeNewAccountOpening(db, runtime.root, 'wrapper-owner', clock), true);
  assert.equal(read('wrapper-owner', 'molly').messages.length, 9); assert.equal(initializeNewAccountOpening(db, runtime.root, 'wrapper-owner', clock), false);
  pass('real registration wrapper uses new literal service; connection factory is reused');
  const ready = new OpeningService(db, runtime.root, () => clock, {teamCardReady: () => true, rng: () => 0});
  ready.initializeRegistration('future-real-poster'); const future = read('future-real-poster', 'molly');
  assert.equal(future.messages.length, 9); assert.deepEqual(future.messages[2].part, {type: 'team_card', version: 1});
  assert.deepEqual(future.messages.map(message => message.part.type === 'text' ? message.part.text : message.part), expected.molly);
  assert.ok(future.messages[3].typingAt > future.messages[2].deliverAt); pass('explicit artwork readiness preserves third transport slot and delivery pacing');
  const noArtwork = new OpeningService(db, runtime.root, () => clock, {teamCardReady: () => false, rng: () => 0});
  noArtwork.initializeRegistration('without-artwork');
  assert.equal(read('without-artwork', 'molly').messages.length, 8);
  assert.equal(read('without-artwork', 'molly').messages.some(message => message.part.type === 'team_card'), false);
  pass('explicit unavailable-artwork override remains supported without changing old account replay guards');
  const rollbackDb = new DatabaseSync(':memory:');
  try {
    rollbackDb.exec('BEGIN'); const first = openingServiceFor(rollbackDb, runtime.root); rollbackDb.exec('ROLLBACK');
    const after = openingServiceFor(rollbackDb, runtime.root); assert.notEqual(after, first);
    assert.equal(after.open('never-registered', 'chen-nian'), false);
    assert.equal(after.initializeRegistration('after-schema-rollback'), true);
  } finally {rollbackDb.close();}
  pass('first-POST transaction schema rollback cannot poison cached service on later requests');
  console.log(`Fixed openings: PASS (${count} groups; temporary SQLite; external model calls 0)`);
} finally {db?.close(); runtime.cleanup();}
