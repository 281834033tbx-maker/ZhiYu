import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';

// Real auth middleware, reader and projection; isolated synthetic SQLite only.
// Requests are Readable objects in memory, with no listening server or HTTP calls.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputArgument = process.argv.find(argument => argument.startsWith('--output='));
const temporary = mkdtempSync(join(tmpdir(), 'zhiyu-task-calendar-api-'));
const passed = [];
const compile = (source, replacements = []) => {
  let js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}}).outputText;
  for (const [before, after] of replacements) js = js.replaceAll(before, after);
  return js;
};
for (const [sourcePath, outputName, replacements] of [
  ['lib/npc/task-calendar.ts', 'task-calendar.mjs', ['professional-task-session','professional-task-expiry'].map(name=>["from './"+name+"'","from './"+name+".mjs'"])],
  ...['professional-task','professional-task-timer','professional-task-session','professional-task-expiry'].map(name => [`lib/npc/${name}.ts`, `${name}.mjs`, ['professional-task','professional-task-timer','professional-task-session','professional-task-expiry'].map(dependency=>["from './"+dependency+"'","from './"+dependency+".mjs'"])]),
  ['server/npc/task-calendar-reader.ts', 'task-calendar-reader.mjs', ['task-calendar','professional-task-expiry'].map(name=>["from '../../lib/npc/"+name+"'","from './"+name+".mjs'"])],
  ['server/npc/auth-plugin.ts', 'auth-plugin.mjs', [["from './task-calendar-reader'", "from './task-calendar-reader.mjs'"]]],
]) writeFileSync(join(temporary, outputName), compile(readFileSync(join(project, sourcePath), 'utf8'), replacements));
const {authLocal} = await import(pathToFileURL(join(temporary, 'auth-plugin.mjs')).href);
const {readTaskCalendar} = await import(pathToFileURL(join(temporary, 'task-calendar-reader.mjs')).href);
const server = new EventEmitter();
let middleware;
authLocal().configureServer({config: {root: temporary}, httpServer: server, middlewares: {use(fn) {middleware = fn;}}});
const db = new DatabaseSync(join(temporary, '.npc-runtime/state.sqlite'));
const account = username => {
  const value = {id: randomUUID(), owner: randomUUID(), token: randomBytes(32).toString('hex'), createdAt: Date.parse('2026-10-01T01:00:00Z')};
  db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(value.id, username, '0'.repeat(32), '0'.repeat(128), value.owner, value.createdAt);
  db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(value.token).digest('hex'), value.id, Date.now() + 3_600_000);
  return value;
};
const a = account('calendarSyntheticA'), b = account('calendarSyntheticB'), empty = account('calendarSyntheticEmpty');
const snapshot = () => {
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = schema.filter(row => row.type === 'table').map(row => row.name);
  return JSON.stringify({schema, rows: tables.map(table => ({table,
    rows: db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all()})),
  changes: db.prepare('SELECT total_changes() AS count').get().count});
};
const request = (npc = 'chen-nian', {token = a.token, header = a.id, method = 'GET', host = '127.0.0.1:32001', extra = ''} = {}) => new Promise(resolveResponse => {
  const req = Readable.from([]); req.method = method;
  req.url = `/api/npc/task-calendar?npc=${encodeURIComponent(npc)}${extra}`;
  req.headers = {host, cookie: `zhiyu_auth=${token}; zhiyu_npc=${b.owner}`, ...(header === null ? {} : {'x-zhiyu-account': header})};
  const headers = {};
  const res = {statusCode: 200, setHeader(name, value) {headers[name.toLowerCase()] = value;}, end(value) {
    resolveResponse({status: this.statusCode, next: false, headers, body: JSON.parse(value)});
  }};
  middleware(req, res, () => resolveResponse({status: 200, next: true, headers}));
});
const check = async (name, run) => {await run(); passed.push(name);};
const task = (id, characterId, createdAt = '2026-10-10T01:00:00Z') => ({id, characterId, title: `${id}-PRIVATE`, goalKey: '合成目标', status: 'active',
  createdAt, updatedAt: createdAt, revision: 1, sourceMessageId: `${id}-source`, cardMessageId: `${id}-card`,
  steps: [{id: `${id}-step`, title: '合成步骤', details: ['合成说明'], hints: []}]});
try {
  await check('Empty authenticated reads do not create NPC sessions or alter existing database rows', async () => {
    const before = snapshot();
    const response = await request('chen-nian', {token: empty.token, header: empty.id});
    assert.equal(response.status, 200); assert.equal(response.next, false); assert.deepEqual(response.body.days, []);
    assert.equal(response.body.firstMonth, '2026-10'); assert.equal(response.body.startSource, 'account-created');
    assert.equal(response.body.snapshotOnly, true); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(snapshot(), before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%_sessions' AND name<>'zhiyu_auth_sessions'").get().n, 0);
  });

  for (const table of ['chen_sessions', 'zhou_chef_sessions', 'molly_sessions', 'he_sessions']) db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
  db.exec('CREATE TABLE npc_group_chats(id TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL)');
  const save = (table, id, state) => db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(id, JSON.stringify(state));
  const chen = task('a-chen-task', 'chen-nian'); chen.steps[0].completedAt = '2026-10-11T02:00:00Z';
  const chef = task('a-chef-task', 'zhou-chef', '2026-09-30T01:00:00Z');
  save('chen_sessions', `${a.owner}:chen-nian`, {professionalTasks: [chen], messages: [
    {role: 'assistant', at: '2001-01-01T00:00:00Z'},
    {role: 'user', at: '2002-01-01T00:00:00Z', chronologyUnknown: true},
    {role: 'user', at: '2026-10-04T01:00:00Z'},
  ]});
  save('zhou_chef_sessions', `${a.owner}:zhou-chef`, {professionalTasks: [chef], messages: [{role: 'user', at: '2026-09-30T00:00:00Z'}]});
  save('molly_sessions', `${a.owner}:molly-system-secretary`, {messages: [{role: 'user', at: '2026-08-31T01:00:00Z'}]});
  save('he_sessions', `${a.owner}:he-jiawei`, {messages: [{role: 'assistant', at: '1998-01-01T01:00:00Z'}]});
  for (const suffix of ['chen-nian:test', 'chen-nian:early-sharing', 'chen-nian:normal:backup']) save('chen_sessions', `${a.owner}:${suffix}`, {
    messages: [{role: 'user', at: '1997-01-01T00:00:00Z'}], professionalTasks: [task(`DISALLOWED-${suffix}`, 'chen-nian', '1997-01-01T00:00:00Z')],
  });
  save('chen_sessions', `${b.owner}:chen-nian`, {messages: [{role: 'user', at: '1999-01-01T00:00:00Z'}],
    professionalTasks: [task('OTHER-ACCOUNT-SECRET', 'chen-nian', '1999-01-01T00:00:00Z')]});
  db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?,?)').run('a-group', a.owner, '2026-08-20T01:00:00Z', '{}');
  db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?,?)').run('b-group', b.owner, '1996-01-01T00:00:00Z', '{}');

  await check('Authenticated identity overrides a forged owner cookie and owner/account query parameters', async () => {
    const before = snapshot();
    const response = await request('chen-nian', {extra: `&owner=${b.owner}&accountId=${b.id}`});
    assert.equal(response.status, 200); assert.equal(response.body.accountId, a.id);
    assert.deepEqual(response.body.days.flatMap(day => day.entries.map(entry => entry.taskId)), ['a-chen-task']);
    assert.ok(!JSON.stringify(response.body).includes('OTHER-ACCOUNT-SECRET')); assert.equal(snapshot(), before);
  });

  await check('Missing, expired, wrong-account and mismatched headers are rejected before calendar data is exposed', async () => {
    const before = snapshot();
    for (const options of [{header: null}, {header: b.id}, {token: b.token, header: a.id}]) {
      const response = await request('chen-nian', options); assert.equal(response.status, 409); assert.equal(response.next, false); assert.equal(response.body.days, undefined);
    }
    const unauthenticated = await request('chen-nian', {token: randomBytes(32).toString('hex')});
    assert.equal(unauthenticated.status, 401); assert.equal(unauthenticated.body.days, undefined);
    assert.equal(snapshot(), before);
    db.prepare('UPDATE zhiyu_auth_sessions SET expires_at=? WHERE account_id=?').run(Date.now() - 1000, empty.id);
    const afterExpiry = snapshot();
    assert.equal((await request('chen-nian', {token: empty.token, header: empty.id})).status, 401);
    assert.equal(snapshot(), afterExpiry);
  });

  await check('Unsupported methods, unknown NPCs and non-local hosts cannot read or modify history', async () => {
    const before = snapshot();
    assert.equal((await request('chen-nian', {method: 'POST'})).status, 405);
    assert.equal((await request('chen-nian', {method: 'DELETE'})).status, 405);
    assert.equal((await request('NOT-A-CHARACTER')).status, 400);
    assert.equal((await request('chen-nian', {host: 'example.com'})).status, 403);
    assert.equal(snapshot(), before);
  });

  await check('Exact production suffixes and requested NPC scope exclude other accounts, test branches and other NPC tasks', async () => {
    const before = snapshot();
    const fitness = await request('chen-nian'), cooking = await request('zhou-chef'), noTasks = await request('he-jiawei');
    assert.equal(fitness.status, 200); assert.equal(cooking.status, 200); assert.equal(noTasks.status, 200);
    assert.deepEqual(fitness.body.days.flatMap(day => day.entries.map(entry => entry.characterId)), ['chen-nian']);
    assert.deepEqual(cooking.body.days.flatMap(day => day.entries.map(entry => entry.taskId)), ['a-chef-task']);
    assert.deepEqual(noTasks.body.days, []);
    assert.ok(!JSON.stringify([fitness.body, cooking.body, noTasks.body]).includes('DISALLOWED-'));
    assert.equal(snapshot(), before);
  });

  await check('All NPC scopes share reliable account history, excluding undated imports and assistant seed dates', async () => {
    const before = snapshot();
    const results = await Promise.all(['chen-nian', 'zhou-chef', 'he-jiawei', 'molly'].map(npc => request(npc)));
    for (const response of results) {
      assert.equal(response.status, 200); assert.equal(response.body.firstDate, '2026-08-20');
      assert.equal(response.body.firstMonth, '2026-08'); assert.equal(response.body.startSource, 'usage-record');
      assert.deepEqual(response.body.months, results[0].body.months);
    }
    assert.equal(snapshot(), before);
  });

  await check('Reader alone handles a database without account/NPC tables using reliable supplied metadata', () => {
    const onlyReader = new DatabaseSync(':memory:');
    try {
      const projection = readTaskCalendar(onlyReader, {owner_id: randomUUID(), created_at: Date.parse('2026-12-15T01:00:00Z')}, 'chen-nian', Date.parse('2027-02-03T01:00:00Z'));
      assert.deepEqual(projection.months, ['2026-12', '2027-01', '2027-02']); assert.deepEqual(projection.days, []);
      assert.equal(onlyReader.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
    } finally {onlyReader.close();}
  });

  await check('Invalid calendar dates cannot normalize into an invented first-use month', () => {
    const reader = new DatabaseSync(':memory:');
    const owner = randomUUID();
    try {
      reader.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
      reader.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`, JSON.stringify({messages: [
        {role: 'user', at: '2026-02-30T00:00:00Z'}, {role: 'user', at: '2026-10-01'},
        {role: 'user', at: '2026-10-01T25:00:00Z'}, {role: 'assistant', at: '2001-01-01T00:00:00Z'},
      ]}));
      const projection = readTaskCalendar(reader, {owner_id: owner, created_at: Date.parse('2026-10-01T01:00:00Z')}, 'chen-nian', Date.parse('2026-10-12T01:00:00Z'));
      assert.equal(projection.firstDate, '2026-10-01'); assert.equal(projection.startSource, 'account-created');
      assert.deepEqual(projection.months, ['2026-10']);
    } finally {reader.close();}
  });

  await check('Requested-NPC day aggregation never rounds unfinished 199 of 200 steps to 100 percent', () => {
    const reader = new DatabaseSync(':memory:');
    const owner = randomUUID();
    try {
      reader.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
      const tasks = Array.from({length: 10}, (_, taskIndex) => ({...task(`many-${taskIndex}`, 'chen-nian'), steps: Array.from({length: 20}, (_, stepIndex) => ({
        id: `${taskIndex}-${stepIndex}`, title: '合成步骤', details: [], hints: [],
        ...(taskIndex === 9 && stepIndex === 19 ? {} : {completedAt: '2026-10-10T09:00:00Z'}),
      }))}));
      reader.prepare('INSERT INTO chen_sessions VALUES(?,?)').run(`${owner}:chen-nian`, JSON.stringify({professionalTasks: tasks}));
      const projection = readTaskCalendar(reader, {owner_id: owner}, 'chen-nian', Date.parse('2026-10-12T01:00:00Z'));
      assert.equal(projection.days[0].total, 200); assert.equal(projection.days[0].completed, 199); assert.equal(projection.days[0].percent, 99);
    } finally {reader.close();}
  });

  if (outputArgument) {
    const output = resolve(outputArgument.slice('--output='.length)); mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, `${JSON.stringify({sources: ['server/npc/auth-plugin.ts', 'server/npc/task-calendar-reader.ts', 'lib/npc/task-calendar.ts'],
      syntheticOnly: true, realMiddleware: true, realSqlite: true, productionReads: 0, productionWrites: 0, httpCalls: 0, modelCalls: 0,
      passed: true, checks: passed}, null, 2)}\n`);
  }
  console.log(`PASS task calendar API: ${passed.length} regression groups; real middleware/reader, isolated SQLite and in-memory transport only.`);
} finally {db.close(); server.emit('close'); rmSync(temporary, {recursive: true, force: true});}
