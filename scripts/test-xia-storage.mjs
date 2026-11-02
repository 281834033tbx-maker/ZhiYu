import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
const temp = mkdtempSync(join(tmpdir(), 'xia-storage-'));
let server;
try {
  symlinkSync(resolve('npc-skills'), join(temp, 'npc-skills'));
  for (const [dir, name] of [
    ['lib/npc', 'contracts'],
    ['lib/npc', 'engine'],
    ['lib/npc', 'life'],
    ['server/npc', 'scheduler'],
    ['server/npc', 'prompt'],
    ['server/npc', 'codex'],
    ['server/npc', 'plugin'],
  ]) {
    let source = readFileSync(`${dir}/${name}.ts`, 'utf8');
    source = source.replace(
      /'(?:\.\/|\.\.\/\.\.\/lib\/npc\/)(contracts|engine|prompt|codex|life|scheduler)'/g,
      "'./$1.mjs'",
    );
    source = source.replace(
      "import config from './life-config.json';",
      'const config = ' +
        readFileSync('lib/npc/life-config.json', 'utf8') +
        ';',
    );
    writeFileSync(
      join(temp, name + '.mjs'),
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      }).outputText,
    );
  }
  const { npcLocal } = await import(pathToFileURL(join(temp, 'plugin.mjs')));
  const fixture = {
    action: 'reply',
    messages: [
      { type: 'text', text: '知道啦' },
      { type: 'emoji', text: '💙' },
    ],
    event: null,
    memories: [
      { text: '用户喜欢蓝色', kind: 'user_claim', evidence: '喜欢蓝色' },
    ],
  };
  let release, entered;
  let generate = async () => fixture;
  async function start() {
    let middleware;
    server = createServer((req, res) => {
      req.url = req.url.replace('/api/npc/xia-xia', '');
      middleware(req, res);
    });
    npcLocal({
      available: () => true,
      generate: (...args) => generate(...args),
    }).configureServer({
      config: { root: temp },
      middlewares: {
        use: (_, handler) => {
          middleware = handler;
        },
      },
      httpServer: server,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${server.address().port}`;
  }
  let origin = await start();
  const first = await fetch(origin + '/api/npc/xia-xia?mode=test');
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const request = async (body) => {
    const r = await fetch(origin + '/api/npc/xia-xia?mode=test', {
      method: body ? 'POST' : 'GET',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  await request({ action: 'values', values: { trust: 61 } });
  const turnId = crypto.randomUUID();
  let result = await request({ action: 'send', text: '我喜欢蓝色', turnId });
  assert.equal(result.data.messages.length, 3);
  assert.equal(result.data.debug.memories.length, 1);
  await new Promise((r) => server.close(r));
  origin = await start();
  result = await request();
  assert.equal(result.data.debug.values.trust, 61);
  assert.equal(result.data.debug.memories.length, 1);
  assert.equal(result.data.messages.length, 3);
  console.log(
    'PASS persistence across backend restart: values, history, memories',
  );
  const started = new Promise((r) => {
    entered = r;
  });
  generate = async () => {
    entered();
    return new Promise((r) => {
      release = () => r(fixture);
    });
  };
  const pending = request({
    action: 'send',
    text: '我喜欢蓝色',
    turnId: crypto.randomUUID(),
  });
  await started;
  const simultaneous = await request({
    action: 'send',
    text: '另一条',
    turnId: crypto.randomUUID(),
  });
  assert.equal(simultaneous.status, 409);
  await request({ action: 'pause' });
  release();
  assert.equal((await pending).status, 409);
  result = await request();
  assert.equal(result.data.debug.paused, true);
  assert.equal(result.data.messages.length, 3);
  await request({ action: 'resume' });
  generate = async () => fixture;
  result = await request({
    action: 'send',
    text: '我喜欢蓝色',
    turnId: crypto.randomUUID(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.debug.memories.length, 1);
  console.log(
    'PASS concurrency: one active turn; pause discards in-flight result; resume works; no duplicate memory',
  );
  await request({ action: 'reset' });
  result = await request();
  assert.equal(result.data.messages.length, 0);
  assert.equal(result.data.debug.memories.length, 0);
  assert.equal(result.data.debug.values.trust, 80);
  console.log('PASS reset clears scoped state and history');
  const normal = async body => {
    const r=await fetch(origin+'/api/npc/xia-xia?mode=normal',{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json()};
  };
  let response=await normal();
  assert.ok(['online','offline','busy'].includes(response.data.presence));
  assert.equal(response.data.debug,undefined);
  const clientId=crypto.randomUUID();
  await normal({action:'typing',clientId,sequence:2,active:true});
  await normal({action:'typing',clientId,sequence:1,active:false});
  const db=new DatabaseSync(join(temp,'.npc-runtime/state.sqlite'));
  try {
    let row=db.prepare("SELECT id,data FROM sessions WHERE id LIKE '%:normal'").get(), stored=JSON.parse(row.data);
    assert.ok(stored.life.typingClients[clientId].until>Date.now());
    await normal({action:'typing',clientId,sequence:3,active:false});
    row=db.prepare('SELECT id,data FROM sessions WHERE id=?').get(row.id);stored=JSON.parse(row.data);
    assert.equal(stored.life.typingClients[clientId].until,0);
    stored.messages=[{id:'npc-visible',turnId:'fixture',role:'assistant',at:new Date().toISOString(),part:{type:'text',text:'隔离测试'}},{id:'user-unread',turnId:'fixture2',role:'user',at:new Date().toISOString(),part:{type:'text',text:'隔离测试'}}];
    db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(stored),row.id);
    response=await normal({action:'read',ids:['npc-visible','user-unread']});
    assert.ok(response.data.messages[0].readAt);
    assert.equal(response.data.messages[1].readAt,undefined);
    assert.equal((await normal()).data.messages[0].readAt,response.data.messages[0].readAt);
    console.log('PASS normal API: presence, hidden values, out-of-order typing protection, persisted read receipts, client cannot mark its outgoing messages read');
  } finally {db.close();}

} finally {
  if (server?.listening) await new Promise((r) => server.close(r));
  rmSync(temp, { recursive: true, force: true });
}
