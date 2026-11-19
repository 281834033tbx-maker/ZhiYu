import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, symlinkSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Requires an isolated production build as cwd. The HTTP process and all rows
// below are disposable; all provider credentials are explicitly removed.
const folder = mkdtempSync(join(tmpdir(), 'zhiyu-opening-production-'));
const env = {...process.env};
for (const key of Object.keys(env)) if (/API_KEY|TOKEN|SECRET|ZHIYU_ENV_FILE|ZHIYU_PUBLIC|NPC_|DEEPSEEK|DOUBAO|QWEN|DASHSCOPE|WEATHER/.test(key)) delete env[key];
Object.assign(env, {ZHIYU_DATA_ROOT: folder, ZHIYU_BUILD_ROOT: resolve('dist'), ZHIYU_INVITE_ONLY: '0', HOST: '127.0.0.1', PORT: '0',
  NPC_TEXT_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: '', ZHIYU_ADMIN_FOUNDER_PASSWORD: 'Synthetic-' + randomUUID(), ZHIYU_ADMIN_INVESTOR_PASSWORD: 'Synthetic-' + randomUUID()});
for (const name of ['public', 'npc-skills', 'scripts']) symlinkSync(resolve(name), join(folder, name));
const child = spawn(process.execPath, ['dist/beta/server.mjs'], {env, stdio: ['ignore', 'pipe', 'pipe']});
let log = '', origin = '', db; const checks = [];
const pass = text => {checks.push(text); console.log('PASS', text);};
try {
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('isolated production startup timed out')), 30000);
    child.stdout.on('data', chunk => {log += chunk; const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(log); if (match) {origin = 'http://127.0.0.1:' + match[1]; clearTimeout(timer); done();}});
    child.stderr.on('data', chunk => {log += chunk;}); child.once('exit', () => {clearTimeout(timer); reject(Error('isolated production exited before ready: ' + log));});
  });
  async function request(path, {method = 'GET', body, who, headers = {}} = {}) {
    const response = await fetch(origin + path, {method, headers: {Origin: origin, ...(body ? {'Content-Type': 'application/json'} : {}),
      ...(who ? {Cookie: who.cookie, 'X-Zhiyu-Account': who.id} : {}), ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    const text = await response.text(); let data; try {data = JSON.parse(text);} catch {/* readable non-JSON errors remain in assertion */}
    return {status: response.status, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function register(name) {
    const password = 'Synthetic-registration-' + randomUUID();
    const result = await request('/api/auth/register', {method: 'POST', body: {username: name, password, confirmPassword: password, adultConfirmed: true}});
    assert.equal(result.status, 200, result.text); assert.equal(result.data.firstUse, true);
    return {id: result.data.account.id, cookie: result.cookie, password, username: name};
  }
  const posterResponse = await fetch(origin + '/zhiyu-logo.png');
  assert.equal(posterResponse.status, 200); assert.match(posterResponse.headers.get('content-type'), /image\/png/);
  assert.ok((await posterResponse.arrayBuffer()).byteLength > 1000);
  pass('bundled temporary team poster is served as a real PNG without model or external asset calls');
  const a = await register('OpeningA' + randomUUID().slice(0, 8)), b = await register('OpeningB' + randomUUID().slice(0, 8));
  db = new DatabaseSync(join(folder, '.npc-runtime/state.sqlite'));
  const owner = who => db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(who.id).owner_id;
  const locations = [
    ['molly', 'molly_sessions', 'molly-system-secretary'], ['he-jiawei', 'he_sessions', 'he-jiawei'],
    ['chen-nian', 'chen_sessions', 'chen-nian'], ['liu', 'liu_sessions', 'liu'], ['zhou-chef', 'zhou_chef_sessions', 'zhou-chef'],
  ];
  const raw = (who, table, suffix) => JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner(who)}:${suffix}`).data);
  const savedMolly = raw(a, 'molly_sessions', 'molly-system-secretary');
  assert.equal(savedMolly.messages.length, 9); assert.equal(savedMolly.messages[2].part.type, 'team_card');
  const openingJSON = id => JSON.parse(readFileSync(join('npc-skills/skills/zhiyu-dialogue/npcs', id, 'opening.json'), 'utf8'));
  assert.deepEqual(savedMolly.messages.map(message => message.part.type === 'text' ? message.part.text : message.part), openingJSON('molly').messages);
  assert.equal(savedMolly.messages.at(-1).part.text, '欢迎上任，董事长。');
  pass('new public registration stores eight literal Molly texts and the temporary team poster, retaining punctuation');
  for (const [id, table, suffix] of locations) {
    const first = await request('/api/npc/' + id, {who: a}); assert.equal(first.status, 200, first.text);
    assert.equal(first.data.pending, true); assert.equal(first.data.messages.length, 0);
    const state = raw(a, table, suffix);
    const expected = openingJSON(id).messages;
    assert.deepEqual(state.messages.map(message => message.part.type === 'text' ? message.part.text : message.part), expected);
    assert.ok(state.messages.every((message, index) => message.deliverAt > message.typingAt && (!index || message.typingAt > state.messages[index - 1].deliverAt)));
    const again = await request('/api/npc/' + id, {who: a}); assert.equal(again.status, 200); assert.deepEqual(raw(a, table, suffix), state);
    // Advance only this disposable fixture's actual presentation timestamps.
    // The same deployed expose/delivery functions are then checked via HTTP.
    for (const [index, message] of state.messages.entries()) {message.typingAt = Date.now() - 4000 + index; message.deliverAt = Date.now() - 2000 + index; message.at = new Date(message.deliverAt).toISOString();}
    db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state), `${owner(a)}:${suffix}`);
    const delivered = await request('/api/npc/' + id, {who: a}); assert.equal(delivered.status, 200); assert.equal(delivered.data.pending, false);
    assert.deepEqual(delivered.data.messages.map(message => message.part.type === 'text' ? message.part.text : message.part), expected);
    pass(id + ' production GET: eligible first-open raw copy, paced visibility and once-only repeated GET');
  }
  const relogin = await request('/api/auth/login', {method: 'POST', body: {username: a.username, password: a.password}});
  assert.equal(relogin.status, 200); assert.equal(relogin.data.firstUse, false);
  assert.equal(raw(a, 'molly_sessions', 'molly-system-secretary').messages.length, 9); pass('ordinary password relogin never replays new opening');
  const api = '/api/npc/dialogue-preferences';
  assert.equal((await request(api + '?npc=chen-nian')).status, 401);
  let current = await request(api + '?npc=chen-nian', {who: a}); assert.equal(current.status, 200, current.text); assert.equal(current.data.address.name, '老大');
  const set = await request(api, {method: 'POST', who: a, body: {action: 'address', npc: 'chen-nian', scope: 'global', name: 'Jade'}});
  assert.equal(set.status, 200, set.text); assert.equal(set.data.address.name, 'Jade');
  for (const id of ['molly', 'he-jiawei', 'chen-nian', 'liu', 'zhou-chef', 'yuan-xiaoman', 'xia-xia']) {
    current = await request(api + '?npc=' + id, {who: a}); assert.equal(current.status, 200, current.text); assert.equal(current.data.address.name, 'Jade');
    assert.equal(current.data.address.pronoun, id === 'zhou-chef' ? '您' : '你');
    const other = await request(api + '?npc=' + id, {who: b}); assert.equal(other.status, 200); assert.equal(other.data.address.name, '老大');
  }
  pass('production beta exact preferences GET/POST routes are reachable, persist global names for seven, and isolate owner/chef pronoun');
  assert.equal((await request(api + '?npc=chen-nian', {who: a, headers: {'X-Zhiyu-Account': b.id}})).status, 409);
  assert.equal((await request(api, {who: a, method: 'POST', body: {action: 'address', npc: 'liu', scope: 'global', name: '伪造', owner: owner(b)}})).status, 400);
  for (const action of ['create', 'move', 'complete', 'revoke']) assert.equal((await request(api, {who: a, method: 'POST', body: {action, npc: 'liu', title: '伪造安排'}})).status, 403);
  for (const path of [api + '/anything', api + '?npc=unknown', api + '?npc=liu&npc=chen-nian']) assert.equal((await request(path, {who: a})).status, 403);
  assert.equal((await request(api + '?npc=liu', {who: a})).data.address.name, 'Jade');
  assert.equal((await request('/api/npc/arrangements', {who: a})).data.items.length, 0);
  pass('production allowlist rejects forged owner, unsupported create/mutation actions, subpaths and invalid duplicate queries');
  const personal = await request(api, {who: a, method: 'POST', body: {action: 'address', npc: 'yuan-xiaoman', scope: 'personal', name: '小玉'}});
  assert.equal(personal.status, 200); assert.equal(personal.data.address.source, 'personal');
  assert.equal((await request(api + '?npc=liu', {who: a})).data.address.name, 'Jade');
  const reset = await request(api, {who: a, method: 'POST', body: {action: 'reset-address', npc: 'yuan-xiaoman'}});
  assert.equal(reset.status, 200); assert.equal(reset.data.address.name, '老大');
  assert.equal((await request(api, {who: a, method: 'POST', body: {action: 'supervision', npc: 'yuan-xiaoman', scope: 'all'}})).status, 200);
  assert.equal((await request(api + '?npc=yuan-xiaoman', {who: a})).data.supervision.scope, 'all');
  assert.equal((await request(api + '?npc=yuan-xiaoman', {who: b})).data.supervision.scope, 'off');
  pass('production personal/default reset and supervision preference writes persist without granting arrangement mutation rights');
  const boardId = 'mirror-' + randomUUID(), snapshot = {action: 'board-snapshot', accountId: a.id, epoch: randomUUID(), sequence: 1, capturedAt: Date.now(),
    tasks: [{id: boardId, title: '合成只读本地安排', date: '', status: 'todo', npcId: 'chen-nian'}]};
  const mirror = await request(api, {who: a, method: 'POST', body: snapshot});
  assert.equal(mirror.status, 200, mirror.text); assert.equal(mirror.data.readOnly, true); assert.equal(mirror.data.status, 'saved');
  const mirrored = await request(api + '?npc=liu', {who: a});
  assert.ok(mirrored.data.arrangements.items.some(item => item.id === 'board:' + boardId && item.title === '合成只读本地安排'));
  assert.ok(!(await request(api + '?npc=liu', {who: b})).data.arrangements.items.some(item => item.id === 'board:' + boardId));
  assert.equal((await request('/api/npc/arrangements', {who: a})).data.items.length, 0, 'snapshot is not an authoritative arrangement create');
  assert.equal((await request(api, {who: b, method: 'POST', body: snapshot})).status, 409);
  assert.equal((await request(api, {who: a, method: 'POST', body: {...snapshot, executionReceipt: {status: 'success'}}})).status, 400);
  assert.equal((await request(api, {who: a, method: 'POST', body: snapshot})).data.status, 'stale');
  pass('production legacy-board snapshot is owned read-only evidence, visible across actors but isolated by owner, stale-safe and unable to create task/receipt');
  const c = await register('ExclusiveC' + randomUUID().slice(0, 8));
  const globalViaChat = await request('/api/npc/chen-nian', {who: c, method: 'POST', body: {action: 'send', turnId: randomUUID(), text: '叫我Jade'}});
  assert.equal(globalViaChat.status, 200, globalViaChat.text);
  assert.equal((await request(api + '?npc=liu', {who: c})).data.address.name, 'Jade');
  const exclusiveViaChat = await request('/api/npc/yuan-xiaoman', {who: c, method: 'POST', body: {action: 'send', turnId: randomUUID(), text: '只有你这样叫'}});
  assert.equal(exclusiveViaChat.status, 200, exclusiveViaChat.text);
  const exclusive = (await request(api + '?npc=yuan-xiaoman', {who: c})).data.address;
  assert.equal(exclusive.name, 'Jade'); assert.equal(exclusive.source, 'personal');
  for (const id of ['molly', 'he-jiawei', 'chen-nian', 'liu', 'zhou-chef', 'xia-xia']) assert.equal((await request(api + '?npc=' + id, {who: c})).data.address.name, '老大');
  assert.equal((await request(api + '?npc=liu', {who: a})).data.address.name, 'Jade');
  pass('production ordinary Chen POST sets global Jade; Xiaoman short only-you POST converts it to her personal name and restores six defaults without cross-owner change');
  console.log(JSON.stringify({passed: true, groups: checks.length, checks, modelCalls: 0, credentialsPresent: false, storage: 'temporary isolated SQLite', productionDataTouched: false}));
} finally {
  db?.close(); child.kill('SIGTERM');
  await new Promise(done => {if (child.exitCode !== null) return done(); const timer = setTimeout(() => {child.kill('SIGKILL'); done();}, 12000); child.once('exit', () => {clearTimeout(timer); done();});});
  rmSync(folder, {recursive: true, force: true});
}
