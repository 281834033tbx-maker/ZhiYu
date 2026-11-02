// One isolated synthetic API conversation. Never use an existing browser cookie.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const origin = 'http://localhost:3100';
const user = crypto.randomUUID();
const endpoint = origin + '/api/npc/yuan-xiaoman';
const cookie = `zhiyu_npc=${user}`;
const started = Date.now();
let settled = false;
try {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send', turnId: crypto.randomUUID(), text: '今天工作怎么样，有没有什么想吐槽的？' }),
  });
  assert.equal(response.status, 200);
  for (let i = 0; i < 210; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const state = await (await fetch(endpoint, { headers: { Cookie: cookie } })).json();
    if (state.deliveryError) { settled = true; throw Error(state.deliveryError); }
    const replies = state.messages?.filter(m => m.role === 'assistant') || [];
    if (state.pending || !replies.length) continue;
    settled = true;
    const trace = readdirSync('.npc-runtime/skill-traces').map(name => JSON.parse(readFileSync('.npc-runtime/skill-traces/' + name, 'utf8')))
      .find(t => t.requestId === replies[0].turnId && Date.parse(t.startedAt) >= started);
    assert.ok(trace, 'Missing request-correlated trace');
    assert.equal(trace.version, 'npc-personality-media-20260919');
    assert.equal(trace.status, 'complete');
    assert.deepEqual(trace.stages.map(s => s.stage), ['retrieval', 'knowledge', 'generation', 'review']);
    const result = { checkedAt: new Date().toISOString(), syntheticOnly: true, userEffectAcceptance: 'unreviewed',
      input: '今天工作怎么样，有没有什么想吐槽的？', reply: replies.map(m => m.part), trace, elapsedMs: Date.now() - started };
    writeFileSync('output/npc-density-runtime-check.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  assert.ok(settled, 'Timed out; retain this isolated row until its pending generation is finished: ' + user);
} finally {
  if (settled) {
    const db = new DatabaseSync('.npc-runtime/state.sqlite');
    db.prepare('DELETE FROM yuan_sessions WHERE id=?').run(user + ':yuan-xiaoman');
    db.close();
  }
}
