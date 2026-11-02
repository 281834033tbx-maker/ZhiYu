import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.env.ZHIYU_URL || 'http://localhost:3100';
const mode = 'test';
async function session() {
  const res = await fetch(`${origin}/api/npc/xia-xia?mode=${mode}`);
  assert.equal(res.status, 200);
  return {
    cookie: res.headers.get('set-cookie').split(';')[0],
    data: await res.json(),
  };
}
async function request(cookie, body, selectedMode = mode) {
  const res = await fetch(`${origin}/api/npc/xia-xia?mode=${selectedMode}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json() };
}
const a = await session(),
  b = await session();
assert.equal(a.data.debug.relationship, 'lovers');
assert.equal(a.data.debug.values.trust, 80);
assert.notEqual(a.data.debug.branch, b.data.debug.branch);
assert.equal(
  (await request(a.cookie, { action: 'values', values: { trust: 67 } })).status,
  200,
);
assert.equal((await request(a.cookie)).data.debug.values.trust, 67);
assert.equal((await request(b.cookie)).data.debug.values.trust, 80);
assert.equal(
  (await request(a.cookie, { action: 'pause' })).data.debug.paused,
  true,
);
assert.equal(
  (
    await request(a.cookie, {
      action: 'send',
      text: '暂停期间',
      turnId: crypto.randomUUID(),
    })
  ).status,
  409,
);
assert.equal(
  (await request(a.cookie, { action: 'resume' })).data.debug.paused,
  false,
);
assert.equal(
  (await request(a.cookie, { action: 'pause' }, 'normal')).status,
  403,
);
assert.equal(
  (await request(a.cookie, undefined, 'normal')).data.debug,
  undefined,
);
const forged = await fetch(`${origin}/api/npc/xia-xia?mode=test`, {
  method: 'POST',
  headers: {
    Origin: 'https://unrelated.example',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'reset' }),
});
assert.equal(forged.status, 403);
for (const file of ['cow-user-reference.png', 'cake-night-v1.png']) {
  const res = await fetch(`${origin}/npc/xia-xia/${file}`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('image'));
}
await request(a.cookie, { action: 'reset' });
console.log(
  'PASS API: sessions, persisted values, isolation, pause/resume, permissions, origin, both local assets',
);
if (process.argv.includes('--live')) {
  const turnId = crypto.randomUUID();
  const reply = await request(a.cookie, {
    action: 'send',
    text: '夏夏，今天有点累，想跟你待一会儿。我喜欢蓝色。',
    turnId,
  });
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.ok(reply.data.messages.some((m) => m.role === 'assistant'));
  const duplicate = await request(a.cookie, {
    action: 'send',
    text: '夏夏，今天有点累，想跟你待一会儿。我喜欢蓝色。',
    turnId,
  });
  assert.equal(duplicate.data.messages.length, reply.data.messages.length);
  assert.equal((await request(b.cookie)).data.messages.length, 0);
  mkdirSync('output', { recursive: true });
  writeFileSync(
    'output/xia-xia-live-check.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        provider: 'codex-cli',
        result: reply.data,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS LIVE CODEX:',
    reply.data.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.part),
  );
}
await request(a.cookie, { action: 'reset' }); // Tests never seed the real browser's session.
