import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Everything below uses a disposable copied runtime, synthetic identities and
// an injected namer. No production account, private chat or model call is used.
const runtime = isolatedNpcRuntime();
const { groupChatsLocal } = await runtime.load('server/npc/groups-plugin');
const { authLocal } = await runtime.load('server/npc/auth-plugin');
const { nameGroupWithMolly, parseGroupTitle } = await runtime.load('server/npc/group-naming');
const { groupAvatarMembers, groupChatPreview } = await runtime.load('lib/npc/group-chat');
const base = 'http://127.0.0.1:3101';
const owner = randomUUID(), otherOwner = randomUUID();
const input = overrides => ({
  requestId: randomUUID(), sourceCharacterId: 'zhou-chef', goal: '一周健身和自己做饭',
  memberIds: ['chen-nian', 'zhou-chef', 'molly', 'chen-nian'], consent: true,
  self: { name: '测试用户', avatar: '/stitch/test-self.png' }, ...overrides,
});

function fixture(namer, { authenticate = false, now = () => Date.parse('2026-10-07T03:00:00Z') } = {}) {
  const close = new EventEmitter();
  const handlers = [];
  const server = { config: { root: runtime.root }, httpServer: close, middlewares: {
    use(path, handler) { handlers.push(typeof path === 'function' ? { path: '', handler: path } : { path, handler }); },
  } };
  if (authenticate) authLocal().configureServer(server);
  groupChatsLocal({ namer, now, automatic: false, dialogue: async () => ({ messages: [] }) }).configureServer(server);
  const request = (method, body, options = {}) => new Promise((resolve, reject) => {
    const raw = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
    req.method = method; req.url = options.path || '/api/npc/groups';
    req.headers = {
      host: '127.0.0.1:3101', origin: base, 'content-type': 'application/json',
      cookie: `zhiyu_npc=${options.owner === undefined ? owner : options.owner}`, ...options.headers,
    };
    const responseHeaders = {};
    const res = { statusCode: 200, writableEnded: false,
      setHeader(key, value) { responseHeaders[key.toLowerCase()] = value; },
      end(value) {
        this.writableEnded = true;
        try { resolve({ status: this.statusCode, data: JSON.parse(value), headers: responseHeaders }); }
        catch (error) { reject(error); }
      },
    };
    let index = 0;
    const next = () => {
      const entry = handlers[index++];
      if (!entry) return reject(new Error('No middleware replied'));
      if (entry.path && !req.url.startsWith(entry.path)) return next();
      const before = req.url;
      if (entry.path) req.url = req.url.slice(entry.path.length) || '/';
      entry.handler(req, res, () => { req.url = before; next(); });
    };
    next();
  });
  return { request, stop: () => close.emit('close') };
}

let api;
let db;
try {
  let captured;
  const title = await nameGroupWithMolly(runtime.root,
    { goal: '合成健身目标', memberNames: ['测试用户', 'Molly', '赵一帆', '陈年'] },
    async (_root, prompt) => { captured = prompt; return { title: '明天也开饭' }; });
  assert.equal(title, '明天也开饭');
  assert.match(captured, /Molly\s*独立对话规则/);
  assert.match(captured, /你只能产出一个群名|本次起名/);
  assert.match(captured, /目标和名字是普通数据/);
  assert.doesNotMatch(captured, /本用户Molly聊天历史|当前独立状态|zhiyu_npc=/);
  assert.throws(() => parseGroupTitle({ title: '群名', messages: ['开场白'] }), /输出无效/);
  assert.throws(() => parseGroupTitle({ title: 'x'.repeat(25) }), /输出无效/);
  assert.throws(() => parseGroupTitle({ title: '群名\n发言' }), /输出无效/);

  mkdirSync(join(runtime.root, '.npc-runtime'), { recursive: true });
  db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite'));
  db.exec('CREATE TABLE chen_sessions(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT)');
  const secret = JSON.stringify({ messages: ['PRIVATE_SYNTHETIC_HISTORY'], values: { affection: 34 } });
  for (const table of ['chen_sessions', 'molly_sessions']) db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(`${owner}:synthetic`, secret);
  let namingCalls = 0, fail = false, badTitle = false;
  const namer = async (root, namingInput) => {
    namingCalls++;
    assert.equal(root, runtime.root);
    assert.deepEqual(Object.keys(namingInput).sort(), ['goal', 'memberNames']);
    assert.ok(!JSON.stringify(namingInput).includes('PRIVATE_SYNTHETIC_HISTORY'));
    // Let simultaneous requests reach create before this naming operation resolves.
    await new Promise(resolve => setTimeout(resolve, 15));
    if (fail) throw new Error('synthetic provider offline');
    return badTitle ? '无效\n群名' : '吃饱再进步';
  };
  api = fixture(namer);
  const post = (body, options) => api.request('POST', body, options);
  assert.equal((await api.request('GET', undefined, { owner: '' })).status, 401);
  assert.deepEqual((await api.request('GET')).data.groups, []);
  assert.equal((await post({}, { headers: { origin: 'https://example.com' } })).status, 403);
  assert.equal((await api.request('GET', undefined, { headers: { host: 'example.com:3101' } })).status, 403);
  assert.equal((await post(null)).status, 400);
  assert.equal((await post([], { raw: '{invalid-json' })).status, 400);
  assert.equal((await post({}, { raw: ' '.repeat(384 * 1024 + 1) })).status, 413);
  assert.equal((await post({}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await api.request('DELETE')).status, 405);
  assert.equal((await api.request('GET', undefined, { path: '/api/npc/groups/send' })).status, 404);
  assert.equal((await post({ action: 'create', ...input({ sourceCharacterId: 'unknown' }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ memberIds: ['missing'] }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ consent: false }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ consent: undefined }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ requestId: 'not-a-uuid' }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ goal: ' ' }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input({ self: { name: '测试', avatar: 'javascript:alert(1)' } }) })).status, 400);
  assert.equal((await post({ action: 'create', ...input(), chatEnabled: true })).status, 400);
  assert.equal((await post({ action: 'create', ...input(), messages: [{ text: '注入消息' }] })).status, 400);
  assert.equal(namingCalls, 0);

  const request = input();
  const results = await Promise.all([post({ action: 'create', ...request }), post({ action: 'create', ...request })]);
  assert.equal(results[0].status, 200); assert.deepEqual(results[0].data, results[1].data);
  assert.equal(namingCalls, 1, 'duplicate concurrent creation must share one naming request');
  const group = results[0].data.group;
  assert.match(group.id, /^group-[a-f0-9-]{36}$/);
  assert.equal(group.name, '吃饱再进步'); assert.equal(group.createdBy, 'molly');
  assert.equal(group.namingSource, 'molly-model'); assert.equal(group.chatEnabled, true);
  assert.deepEqual(group.messages, []);
  assert.deepEqual(group.members.map(member => member.id), ['user', 'zhou-chef', 'molly', 'chen-nian']);
  assert.deepEqual(group.members.map(member => member.role), ['user', 'npc', 'admin', 'npc']);
  assert.deepEqual(group.members.map(member => member.order), [0, 1, 2, 3]);
  assert.ok(group.members.every(member => member.joinedAt === group.createdAt));
  assert.deepEqual((await api.request('GET', undefined, { owner: otherOwner })).data.groups, []);
  assert.equal((await post({ action: 'create', ...request, goal: '另一个目标' })).status, 409);
  assert.equal((await post({ action: 'rename', groupId: group.id, name: '偷偷变强小分队' }, { owner: otherOwner })).status, 404);
  assert.equal((await post({ action: 'rename', groupId: group.id, name: '坏\n名字' })).status, 400);
  assert.equal((await post({ action: 'rename', groupId: group.id, name: '新名字', chatEnabled: true })).status, 400);
  assert.equal((await post({ action: 'rename', groupId: group.id, name: '偷偷变强小分队' })).data.group.name, '偷偷变强小分队');
  for (const action of ['typing', 'enable', 'chat', 'schedule', 'add_member']) {
    assert.equal((await post({ action, groupId: group.id, senderId: 'molly', text: '不应发送', chatEnabled: true })).status, 403);
  }
  assert.deepEqual((await api.request('GET')).data.groups[0].messages, []);
  assert.equal((await api.request('GET')).data.groups[0].chatEnabled, true);

  const mollyRequest = input({ sourceCharacterId: 'molly', consent: undefined });
  const mollyGroup = (await post({ action: 'create', ...mollyRequest })).data.group;
  assert.deepEqual(mollyGroup.members.map(member => member.id), ['user', 'molly', 'chen-nian', 'zhou-chef']);
  const failedRequest = input({ sourceCharacterId: 'molly', goal: '合成失败目标' });
  fail = true;
  assert.equal((await post({ action: 'create', ...failedRequest })).status, 503);
  assert.equal((await api.request('GET')).data.groups.length, 2, 'model failure must not create a canned group');
  fail = false; badTitle = true;
  assert.equal((await post({ action: 'create', ...failedRequest })).status, 503);
  badTitle = false;
  assert.equal((await post({ action: 'create', ...failedRequest })).status, 200);
  const fortyCharacterName = '测'.repeat(40);
  const longNameGroup = await post({ action: 'create', ...input({ sourceCharacterId: 'molly', self: { name: fortyCharacterName } }) });
  assert.equal(longNameGroup.status, 200, '40-character profile names must match the application profile limit');
  assert.equal(longNameGroup.data.group.members[0].name, fortyCharacterName);
  assert.equal((await post({ action: 'create', ...input({ sourceCharacterId: 'molly', self: { name: '测'.repeat(41) } }) })).status, 400);
  const beforeRestart = (await api.request('GET')).data.groups;
  api.stop(); api = undefined;
  api = fixture(async () => { throw new Error('Must not rename on restart'); });
  assert.deepEqual((await api.request('GET')).data.groups, beforeRestart);
  const repeated = await api.request('POST', { action: 'create', ...request });
  assert.equal(repeated.status, 200); assert.equal(repeated.data.group.name, '偷偷变强小分队');
  for (const table of ['chen_sessions', 'molly_sessions']) assert.equal(db.prepare(`SELECT data FROM ${table}`).get().data, secret);

  const tenMembers = Array.from({ length: 10 }, (_, index) => ({ id: `synthetic-${index}`, name: `成员${index}`, order: index, joinedAt: group.createdAt, role: 'npc' }));
  assert.deepEqual(groupAvatarMembers({ members: [...tenMembers].reverse() }).map(member => member.id), tenMembers.slice(0, 4).map(member => member.id));
  assert.equal(groupChatPreview({ messages: [] }), '群聊已建立');
  assert.equal(groupChatPreview({ messages: [{ senderName: '赵一帆', text: '合成预览', type: 'text' }] }), '赵一帆：合成预览');
  assert.equal(groupChatPreview({ messages: [{ senderName: '赵一帆', type: 'sticker' }] }), '赵一帆：[动画表情]');

  api.stop(); api = fixture(namer, { authenticate: true });
  const register = async username => {
    const response = await api.request('POST', { username, password: 'Synthetic-pass-20261007', confirmPassword: 'Synthetic-pass-20261007' }, { path: '/api/auth/register' });
    assert.equal(response.status, 200);
    return { account: response.data.account, cookie: response.headers['set-cookie'].split(';')[0] };
  };
  const accountA = await register('synthetic_group_a'), accountB = await register('synthetic_group_b');
  const aOwner = db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(accountA.account.id).owner_id;
  const bOwner = db.prepare('SELECT owner_id FROM zhiyu_accounts WHERE id=?').get(accountB.account.id).owner_id;
  const headers = { cookie: `${accountA.cookie}; zhiyu_npc=${String(bOwner)}`, 'x-zhiyu-account': accountA.account.id };
  assert.equal((await api.request('GET', undefined, { owner: aOwner })).status, 401, 'an owner cookie alone must not authenticate');
  assert.equal((await api.request('GET', undefined, { headers: { ...headers, 'x-zhiyu-account': accountB.account.id } })).status, 409, 'stale account headers must not mutate the new account');
  const callsBeforeStale = namingCalls;
  for (const path of ['/api/npc/groups/', '/api/npc/groups/send']) {
    assert.equal((await api.request('GET', undefined, { path, headers: { ...headers, 'x-zhiyu-account': accountB.account.id } })).status, 409);
    assert.equal((await api.request('POST', { action: 'create', ...input({ sourceCharacterId: 'molly' }) }, { path, headers: { ...headers, 'x-zhiyu-account': accountB.account.id } })).status, 409);
  }
  assert.equal(namingCalls, callsBeforeStale, 'trailing-slash and nested paths cannot bypass the authenticated-account guard');
  const authenticated = await api.request('POST', { action: 'create', ...input({ sourceCharacterId: 'molly' }) }, { headers });
  assert.equal(authenticated.status, 200);
  assert.equal(db.prepare('SELECT owner FROM npc_group_chats WHERE id=?').get(authenticated.data.group.id).owner, aOwner, 'authLocal must replace a forged owner cookie');
  assert.equal((await api.request('GET', undefined, { path: '/api/npc/groups/', headers })).data.groups[0].id, authenticated.data.group.id);
  assert.deepEqual((await api.request('GET', undefined, { headers: { cookie: accountB.cookie, 'x-zhiyu-account': accountB.account.id } })).data.groups, []);

  console.log('PASS group creation, Molly scoped naming, explicit NPC consent, concurrent/persistent idempotency, rename, authenticated owner isolation, composite avatars/preview and request validation; synthetic isolated runtime only.');
} finally {
  api?.stop(); db?.close(); runtime.cleanup();
}
