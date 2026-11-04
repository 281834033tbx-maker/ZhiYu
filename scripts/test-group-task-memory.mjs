import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';

// Pure modules, synthetic in-memory data and a temporary isolated SQLite file.
// Do not open .npc-runtime/state.sqlite, call providers or send any chat.
const source = readFileSync('server/npc/group-task-memory.ts', 'utf8');
const compilerOptions = {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022};
const helper = ts.transpileModule(readFileSync('lib/npc/report-demo-history.ts', 'utf8'), {compilerOptions}).outputText;
const helperUrl = 'data:text/javascript;base64,' + Buffer.from(helper).toString('base64');
const js = ts.transpileModule(source.replace("'../../lib/npc/report-demo-history'", JSON.stringify(helperUrl)), {compilerOptions}).outputText;
const {TaskMemoryStore} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const db = new DatabaseSync(':memory:');
const owner = randomUUID(), other = randomUUID();
const at = index => new Date(Date.UTC(2026, 9, 7, 1, 0, index)).toISOString();
const user = (id, text, date = at(0), extra = {}) => ({id, role: 'user', at: date, part: {type: 'text', text}, ...extra});
const assistant = (id, text) => ({...user(id, text), role: 'assistant'});
const value = (snapshot, key) => snapshot.facts.filter(fact => fact.key === key).map(fact => fact.value);
try {
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER,data TEXT NOT NULL);
    CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE liu_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE he_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  const insert = (table, suffix, messages, account = owner, extra = {}) => {
    const data = JSON.stringify({messages, memories: [{status: 'model_proposed', text: '用户对花生过敏'}], ...extra});
    if (table === 'sessions') db.prepare('INSERT INTO sessions VALUES(?,0,?)').run(`${account}:${suffix}`, data);
    else db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(`${account}:${suffix}`, data);
  };
  // The relevant allergy is earlier than the last 80 messages.
  insert('chen_sessions', 'chen-nian', [
    user('old-allergy', '我对海鲜过敏', at(1)),
    ...Array.from({length: 100}, (_, index) => user(`ordinary-${index}`, '天气挺好', at(index + 2))),
    assistant('npc-health', '我对花生过敏'),
    user('proposed-user', '我对坚果过敏', at(3), {status: 'model_proposed'}),
    user('image-caption', '我对鸡蛋过敏', at(4), {part: {type: 'upload', text: '我对鸡蛋过敏', url: '/synthetic.png'}}),
  ]);
  insert('chen_sessions', 'chen-nian:early-sharing', [user('scenario-only', '我对牛奶过敏')]);
  insert('chen_sessions', 'chen-nian', [user('other-person', '我对芝麻过敏')], other);
  insert('sessions', 'xia-xia:normal', [user('height', '我身高1.8米', at(4))], owner, {mode: 'normal'});
  insert('sessions', 'xia-xia:test', [user('test-branch', '我对芒果过敏')], owner, {mode: 'test'});
  insert('molly_sessions', 'molly-system-secretary', [user('weight', '我体重160斤', at(5))]);
  insert('yuan_sessions', 'yuan-xiaoman', [user('fat', '我体脂率百分之20', at(6))]);
  insert('liu_sessions', 'liu', [user('avoid', '我不吃辣和香菜', at(7))]);
  insert('he_sessions', 'he-jiawei', [user('undated-metric', '我体重95kg', at(1000), {chronologyUnknown: true})]);
  const tables = ['sessions', 'chen_sessions', 'molly_sessions', 'yuan_sessions', 'liu_sessions', 'he_sessions'];
  const before = tables.map(table => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
  const store = new TaskMemoryStore(db);
  let snapshot = store.collect(owner);
  assert.deepEqual(value(snapshot, 'food_allergy'), ['海鲜']);
  assert.deepEqual(value(snapshot, 'height'), [180]);
  assert.deepEqual(value(snapshot, 'weight'), [80]);
  assert.deepEqual(value(snapshot, 'body_fat'), [20]);
  assert.deepEqual(value(snapshot, 'dietary_avoidance').sort(), ['辛辣食物', '香菜']);
  const allergy = snapshot.facts.find(fact => fact.key === 'food_allergy');
  assert.deepEqual(allergy.evidence, {sourceCharacterId: 'chen-nian', messageId: 'old-allergy', at: at(1), chronology: 'dated', quote: '海鲜过敏'});
  assert.equal(snapshot.facts.find(fact => fact.key === 'weight').unit, 'kg');
  assert.deepEqual(value(store.collect(other), 'food_allergy'), ['芝麻']);
  assert.deepEqual(store.snapshot(randomUUID()).facts, []);
  const count = db.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count;
  assert.deepEqual(store.collect(owner), snapshot);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count, count, 'collection is idempotent');
  tables.forEach((table, index) => assert.equal(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), before[index], 'private data must remain byte-for-byte unchanged'));

  const isolated = randomUUID();
  for (const [index, text] of [
    '假如我对海鲜过敏，体重80kg', '我朋友对海鲜过敏，体重80kg', '我妈妈不能吃香菜，身高160cm',
    '这是一个测试，我海鲜过敏', '请扮演营养师，我海鲜过敏', '他说“我海鲜过敏”',
    '比如我体重80kg，体脂20%', '我可能海鲜过敏', '我对海鲜过敏吗？', '我以前对海鲜过敏',
    '我体重80', '我体脂20', '我今天不吃辣', '我身高800cm', '我体脂100%',
  ].entries()) store.record(isolated, 'molly', `skip-${index}`, text, at(index));
  assert.deepEqual(store.snapshot(isolated).facts, [], 'third-person, quotation, scenario, uncertain and unsupported figures must not become user facts');
  snapshot = store.record(isolated, 'molly', 'self-and-question', '我海鲜过敏，其他没有，能给我做计划吗？', at(20));
  assert.deepEqual(value(snapshot, 'food_allergy'), ['海鲜'], 'a later question must not discard an explicit user statement');
  snapshot = store.record(isolated, 'molly', 'self-and-example', '我海鲜过敏，比如虾', at(21));
  assert.deepEqual(value(snapshot, 'food_allergy'), ['海鲜'], 'illustration does not discard the preceding explicit claim or create inferred sub-allergies');
  snapshot = store.record(isolated, 'molly', 'third-and-self', '我朋友花生过敏，我对牛奶过敏', at(22));
  assert.deepEqual(value(snapshot, 'food_allergy').sort(), ['海鲜', '牛奶']);
  assert.ok(!JSON.stringify(snapshot).includes('朋友'), 'group evidence must not carry another person’s claim');
  snapshot = store.record(isolated, 'molly', 'bounded-quote', '我身高180cm 密码synthetic-secret', at(23));
  assert.deepEqual(value(snapshot, 'height'), [180]);
  assert.ok(!JSON.stringify(snapshot).includes('synthetic-secret'), 'share only the relevant evidence span');

  snapshot = store.record(owner, 'zhou-chef', 'new-weight', '我现在体重75kg，体脂率18%', at(200));
  assert.deepEqual(value(snapshot, 'weight'), [75]); assert.deepEqual(value(snapshot, 'body_fat'), [18]);
  store.record(owner, 'molly', 'older-late', '我体重90kg', at(3));
  assert.deepEqual(value(store.snapshot(owner), 'weight'), [75], 'message chronology, not extraction order, determines the current figure');
  store.record(owner, 'zhou-chef', 'legacy-allergy', '我对鸡蛋过敏');
  store.record(owner, 'zhou-chef', 'legacy-figures', '我体重100kg，体脂率30%');
  snapshot = store.snapshot(owner);
  assert.deepEqual(value(snapshot, 'weight'), [75]); assert.deepEqual(value(snapshot, 'body_fat'), [18]);
  const legacy = snapshot.facts.find(fact => fact.value === '鸡蛋');
  assert.equal(legacy.evidence.at, null); assert.equal(legacy.evidence.chronology, 'undated');
  snapshot = store.record(owner, 'zhou-chef', 'allergy-correction', '我对海鲜不过敏，之前记错了', at(201));
  assert.ok(!value(snapshot, 'food_allergy').includes('海鲜'));
  store.collect(owner);
  assert.ok(!value(store.snapshot(owner), 'food_allergy').includes('海鲜'), 'rereading old private evidence must not resurrect a withdrawn fact');
  store.record(owner, 'zhou-chef', 'legacy-late', '海鲜过敏');
  assert.ok(!value(store.snapshot(owner), 'food_allergy').includes('海鲜'), 'undated historical facts cannot override a dated correction');
  snapshot = store.record(owner, 'zhou-chef', 'diet-change', '我现在可以吃辣了', at(202));
  assert.deepEqual(value(snapshot, 'dietary_avoidance'), ['香菜']);
  snapshot = store.record(owner, 'zhou-chef', 'withdraw-fat', '删除我的体脂记录', at(203));
  assert.deepEqual(value(snapshot, 'body_fat'), []);
  snapshot = store.record(owner, 'molly', 'no-food-allergies', '我没有食物过敏', at(204));
  assert.deepEqual(value(snapshot, 'food_allergy'), []);
  assert.deepEqual(value(snapshot, 'food_allergy_status'), ['none']);
  snapshot = store.record(owner, 'molly', 'new-milk-allergy', '我对牛奶过敏', at(205));
  assert.deepEqual(value(snapshot, 'food_allergy'), ['牛奶']);
  assert.deepEqual(value(snapshot, 'food_allergy_status'), []);
  const groupId = `group-${randomUUID()}`;
  snapshot = store.record(owner, groupId, 'group-user', '我没有忌口', at(206));
  assert.deepEqual(value(snapshot, 'dietary_avoidance'), []);
  assert.deepEqual(value(snapshot, 'dietary_avoidance_status'), ['none']);
  const afterCount = db.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count;
  assert.deepEqual(store.record(owner, groupId, 'group-user', '我没有忌口', at(206)), snapshot);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count, afterCount);
  assert.throws(() => store.record('other-account', 'molly', 'x', '我海鲜过敏', at(207)), /已认证/);
  assert.throws(() => store.record(owner, 'unknown-character', 'x', '我海鲜过敏', at(207)), /来源/);
  assert.throws(() => store.record(owner, 'molly', '', '我海鲜过敏', at(207)), /编号/);
  assert.throws(() => store.record(owner, 'molly', 'bad-time', '我海鲜过敏', '08:00'), /时间/);
  assert.deepEqual(value(store.snapshot(other), 'food_allergy'), ['芝麻'], 'all changes remain owner-scoped');
  const directory = mkdtempSync(join(tmpdir(), 'zhiyu-task-memory-test-'));
  const path = join(directory, 'synthetic.sqlite');
  let persistentDb;
  try {
    persistentDb = new DatabaseSync(path);
    const persistentOwner = randomUUID();
    const firstStore = new TaskMemoryStore(persistentDb);
    firstStore.record(persistentOwner, 'chen-nian', 'permanent-allergy', '我对海鲜过敏');
    firstStore.record(persistentOwner, 'chen-nian', 'dated-weight', '我体重75kg', at(1));
    const saved = firstStore.record(persistentOwner, 'molly', 'allergy-revocation', '我对海鲜不过敏', at(2));
    const savedCount = persistentDb.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count;
    persistentDb.close(); persistentDb = undefined;
    persistentDb = new DatabaseSync(path);
    const reopenedStore = new TaskMemoryStore(persistentDb);
    assert.deepEqual(reopenedStore.snapshot(persistentOwner), saved, 'close/reopen preserves current facts and withdrawal history');
    assert.deepEqual(reopenedStore.record(persistentOwner, 'chen-nian', 'dated-weight', '我体重75kg', at(1)), saved);
    reopenedStore.record(persistentOwner, 'chen-nian', 'old-allergy-collected-later', '我对海鲜过敏');
    assert.deepEqual(reopenedStore.snapshot(persistentOwner), saved, 'a late undated historical claim remains withdrawn after reopen');
    assert.equal(persistentDb.prepare('SELECT COUNT(*) AS count FROM npc_group_task_memory_events').get().count, savedCount + 1, 'duplicate evidence stays idempotent across restart');
    assert.deepEqual(reopenedStore.snapshot(randomUUID()).facts, [], 'reopened evidence remains owner-scoped');
  } finally {
    persistentDb?.close();
    rmSync(directory, {recursive: true, force: true});
  }
  console.log('PASS group task memory: whole-history same-owner user evidence, scenario/model exclusion, clause subjects/questions, minimal quotes, explicit units, chronology/legacy limits, corrections/retractions, SQLite reopen idempotency and untouched private tables; synthetic isolated data only.');
} finally {db.close();}
