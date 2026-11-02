import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the browser migration helper in memory; never read or write a real account's storage.
const helperPath = 'app/zhiyu/chef-chat-history.ts';
const source = readFileSync(helperPath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/^import .*;\s*$/gm, '').replace('export async function ensureChefChatHistory', 'async function ensureChefChatHistory')
  .replace('export function captureChefChatHistorySources', 'function captureChefChatHistorySources');
const accountId = 'offline-chef-account';
const keys = {
  local: `zhiyu-local-character-chat:v1:${accountId}:zhou-chef`,
  archive: `zhiyu-stitch-desktop-v2:${accountId}`,
  backup: `zhiyu-chef-pre-ai-history:v1:${accountId}`,
  sources: `zhiyu-chef-pre-ai-sources:v1:${accountId}`,
};
const message = (id, extra = {}) => ({ id, text: `旧留言 ${id}`, mine: true, time: '09:31', ...extra });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function harness({ seed = {}, known = [], authIds = [], postErrors = [] } = {}) {
  const storage = new Map(Object.entries(seed));
  const original = new Map(storage);
  const requests = [];
  const writes = [];
  let authChecks = 0;
  let postIndex = 0;
  const context = vm.createContext({
    TextEncoder,
    localCharacterChatKey: (id, npc) => `zhiyu-local-character-chat:v1:${id}:${npc}`,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { writes.push(key); storage.set(key, value); },
      removeItem: () => { throw Error('The migration must never remove old storage'); },
      clear: () => { throw Error('The migration must never clear old storage'); },
    },
    fetch: async url => {
      assert.equal(url, '/api/auth/session');
      const id = authIds[authChecks++] ?? accountId;
      return response({ account: { id } });
    },
    npcFetch: async (url, init = {}) => {
      assert.equal(url, '/api/npc/zhou-chef?mode=normal');
      assert.equal(new Headers(init.headers).get('X-Zhiyu-Account'), accountId);
      const request = { method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
      requests.push(request);
      if (request.method === 'GET') return response({ messages: known.map(id => ({ id })) });
      assert.equal(request.method, 'POST');
      assert.equal(request.body.action, 'import_history', 'Old user messages cannot be replayed as send turns');
      const error = postErrors[postIndex++];
      return error ? response({ error }, 409) : response({ imported: request.body.messages.length });
    },
  });
  new vm.Script(`${compiled}\nglobalThis.migration = { ensureChefChatHistory, captureChefChatHistorySources };`, { filename: helperPath }).runInContext(context);
  return {
    ensure: () => context.migration.ensureChefChatHistory(accountId), storage, original, requests, writes,
    capture: () => context.migration.captureChefChatHistorySources(accountId),
    posts: () => requests.filter(item => item.method === 'POST'),
    imported: () => requests.filter(item => item.method === 'POST').flatMap(item => item.body.messages),
    preserved: () => { for (const [key, value] of original) assert.equal(storage.get(key), value, `${key} must remain unchanged`); },
  };
}

// The local key, full App archive, and earlier backup can overlap without duplicate imports.
{
  const duplicate = message('same', { image: '/legacy/photo.png' });
  const h = harness({ seed: {
    [keys.local]: JSON.stringify([duplicate, message('local-only', { replyTo: 'same' })]),
    [keys.archive]: JSON.stringify({ messages: { 'zhou-chef': [duplicate, message('archive-only'), message('npc-preview', { mine: false })] } }),
    [keys.backup]: JSON.stringify([message('backup-only'), duplicate]),
  } });
  await Promise.all([h.ensure(), h.ensure()]);
  assert.equal(h.posts().length, 1, 'Concurrent surfaces must share one import');
  assert.deepEqual(new Set(h.imported().map(item => item.id)), new Set(['backup-only', 'same', 'archive-only', 'local-only']));
  assert.ok(h.imported().every(item => item.mine === true));
  assert.equal(h.imported().find(item => item.id === 'same').image, '/legacy/photo.png');
  assert.equal(h.imported().find(item => item.id === 'local-only').replyTo, 'same');
  h.preserved();
  await h.ensure();
  assert.equal(h.posts().length, 1, 'A completed snapshot must not be sent twice');
}

// Known server IDs (including live App previews) are never imported a second time.
{
  const h = harness({ seed: { [keys.local]: JSON.stringify([message('known'), message('missing')]) }, known: ['known'] });
  await h.ensure();
  assert.deepEqual(h.imported().map(item => item.id), ['missing']);
  assert.ok(h.storage.has(keys.backup));
  h.preserved();
}

// A 16 MiB legacy data URL gets its own batch; small records and media metadata survive.
{
  const hugeImage = 'data:image/png;base64,' + 'A'.repeat(16 * 1024 * 1024);
  const old = [message('before'), message('large-media', { image: hugeImage, audio: '/legacy/voice.wav', audioDurationSeconds: 7,
    file: '旧资料.pdf', at: '2026-10-01T01:31:00.000Z' }), message('after')];
  const h = harness({ seed: { [keys.local]: JSON.stringify(old) } });
  await h.ensure();
  assert.equal(h.posts().length, 3);
  assert.ok(h.posts().every(item => item.body.messages.length === 1));
  const large = h.imported().find(item => item.id === 'large-media');
  assert.equal(large.image, hugeImage);
  assert.equal(large.audio, '/legacy/voice.wav');
  assert.equal(large.audioDurationSeconds, 7);
  assert.deepEqual(large.file, old[1].file);
  assert.equal(large.at, old[1].at);
  h.preserved();
}

// Count batching independently of byte size.
{
  const old = Array.from({ length: 101 }, (_, index) => message(`count-${index}`));
  const h = harness({ seed: { [keys.local]: JSON.stringify(old) } });
  await h.ensure();
  assert.deepEqual(h.posts().map(item => item.body.messages.length), [100, 1]);
  h.preserved();
}

// A changed account at either auth check cannot submit old records to the new account.
for (const authIds of [['different-account'], [accountId, 'different-account']]) {
  const h = harness({ seed: { [keys.local]: JSON.stringify([message('private')]) }, authIds });
  await assert.rejects(h.ensure(), /账号已变化/);
  assert.equal(h.posts().length, 0);
  h.preserved();
}

// A server-side account mismatch after the final client check fails and remains retryable.
{
  const h = harness({ seed: { [keys.local]: JSON.stringify([message('private')]) }, postErrors: ['账号已变化'] });
  await assert.rejects(h.ensure(), /账号已变化/);
  h.preserved();
  await h.ensure();
  assert.equal(h.posts().length, 2, 'A rejected import must not be cached as complete');
}

// Conflicting IDs must retain both original stores and stop before sending anything.
for (const extra of [{ text: '另一条旧留言' }, { image: '/other.png' }, { audio: '/other.wav' },
  { file: '另一资料.pdf' }, { time: '10:02' }, { at: '2026-10-02T01:31:00.000Z' },
  { audioDurationSeconds: 8 }, { replyTo: 'other-id' }]) {
  const original = { image:'/original.png', audio:'/original.wav', file:'原资料.pdf',
    at:'2026-10-01T01:31:00.000Z', audioDurationSeconds:7, replyTo:'original-id' };
  const h = harness({ seed: {
    [keys.local]: JSON.stringify([message('collision',original)]),
    [keys.archive]: JSON.stringify({ messages: { 'zhou-chef': [message('collision', {...original,...extra})] } }),
  } });
  await assert.rejects(h.ensure(), /重复ID冲突/);
  assert.equal(h.requests.length, 0);
  h.preserved();
}

// Hydration may overwrite the main preview before a background migration opens the chef.
// The synchronous snapshot must retain archive-only and local-only original records.
{
  const archive = JSON.stringify({messages:{'zhou-chef':[message('archive-only')]}});
  const local = JSON.stringify([message('local-only')]);
  const h = harness({seed:{[keys.archive]:archive,[keys.local]:local}});
  h.capture();
  h.storage.set(keys.archive,JSON.stringify({messages:{'zhou-chef':JSON.parse(local)}}));
  await h.ensure();
  assert.deepEqual(new Set(h.imported().map(item=>item.id)),new Set(['archive-only','local-only']));
  const frozen=JSON.parse(h.storage.get(keys.sources));
  assert.equal(frozen.local,local);
  assert.deepEqual(JSON.parse(frozen.archive),JSON.parse(archive).messages['zhou-chef']);
  assert.equal(h.storage.get(keys.local),local);
  const originalSource=h.storage.get(keys.sources);
  h.capture();
  assert.equal(h.storage.get(keys.sources),originalSource);
}

// Live API previews are never treated as legacy user turns, even after a clear hides IDs.
{
  const h = harness({seed:{[keys.archive]:JSON.stringify({messages:{'zhou-chef':[
    message('hidden-api-turn',{chefApiPreview:true,at:'2026-10-08T01:31:00.000Z'}),
  ]}})}});
  await h.ensure();
  assert.equal(h.requests.length,0);
  h.preserved();
}

// Imported legacy previews can acquire an unknown date without conflicting with originals.
{
  const old=message('legacy');
  const h=harness({seed:{[keys.backup]:JSON.stringify([old]),[keys.archive]:JSON.stringify({messages:{'zhou-chef':[
    {...old,chefApiPreview:true,at:'2026-10-08T01:31:00.000Z'},
  ]}})},known:['legacy']});
  await h.ensure();
  assert.equal(h.posts().length,0);
  h.preserved();
}

const appSource=readFileSync('app/zhiyu/app.tsx','utf8');
assert.ok(appSource.indexOf('captureChefChatHistorySources(account.id)')<appSource.indexOf('setMessages({...keepRecords(d.messages)'));
assert.ok(appSource.includes('if (!ready || chefHistoryProtectedFor !== account.id) return;'));
assert.ok(appSource.includes('chefApiPreview:true'));

// Guard every NPC request in the current Chef-capable surfaces, including typing/read/retry.
let checkedRequests = 0;
for (const file of [helperPath, 'app/zhiyu/app.tsx', 'app/zhiyu/xia-xia.tsx', 'app/character-window/character-window-client.tsx']) {
  const text = readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'npcFetch') {
      const target = node.arguments[0]?.getText(parsed) || '';
      const supportsChef = target === 'endpoint' || target.includes('/api/npc/zhou-chef') || target.includes('/api/npc/${personId}');
      if (supportsChef) {
        const options = node.arguments[1]?.getText(parsed) || '';
        assert.ok(options.includes('X-Zhiyu-Account'), `${file}:${parsed.getLineAndCharacterOfPosition(node.pos).line + 1} lacks an account guard`);
        assert.ok(options.includes(file === helperPath ? 'accountId' : 'account.id'));
        checkedRequests++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}
assert.ok(checkedRequests >= 10);
console.log(`PASS Chef history migration: deduplication, media preservation, batching, original stores, no replay, auth races, and ${checkedRequests} guarded frontend request sites`);
