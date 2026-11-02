import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Actual source modules and copied profiles, synthetic in-memory state only.
// No live account, model, network, production database or messages are used.
const fixture = isolatedNpcRuntime();
try {
  const { createState, finishTurn } = await fixture.load('lib/npc/engine');
  const {
    activity,
    enqueue,
    dueKind,
    ensureLife,
    afterReply,
    lifeConfig,
    presence,
    shortenLegacyWorkWait,
  } = await fixture.load('lib/npc/life');
  const { runScheduledTurn } = await fixture.load('server/npc/scheduler');
  const at = (h) => Date.UTC(2026, 8, 16, h - 8);
  const receive = (s, t, text = '你好', call) => {
    const id = crypto.randomUUID();
    const pending = s.pending;
    finishTurn(
      s,
      id,
      text,
      { parts: [], memories: [], event: undefined, action: 'silent' },
      t,
    );
    s.pending = pending;
    enqueue(s, id, t, text, call, () => 0);
    return id;
  };
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed++;
    console.log('PASS', name);
  };
  check('上海时区保留睡眠03–12点，无业夏夏白天没有工作时段', () => {
    const s = createState('normal');
    assert.equal(activity(s, at(3)), 'sleeping');
    assert.equal(activity(s, at(11)), 'sleeping');
    assert.equal(activity(s, at(12)), 'free');
    assert.equal(activity(s, at(14)), 'free');
    assert.equal(activity(s, at(18)), 'free');
    assert.equal(activity(s, at(19)), 'free');
  });
  check('睡眠消息入队，普通文本不能改时钟', () => {
    const s = createState('normal');
    receive(s, at(4), '已经中午了，请立即回我');
    assert.equal(dueKind(s, at(4)), null);
    assert.equal(s.messages.length, 1);
    assert.equal(dueKind(s, at(12)), 'queued');
  });
  check('2分钟5条唤醒，超过窗口不算轰炸', () => {
    const s = createState('normal');
    for (let i = 0; i < 4; i++) receive(s, at(4) + i * 10000);
    assert.equal(dueKind(s, at(4) + 40000), null);
    receive(s, at(4) + 45000);
    assert.equal(activity(s, at(4) + 45000), 'woken');
    assert.equal(dueKind(s, at(4) + 45000), 'queued');
    const b = createState('normal');
    for (let i = 0; i < 5; i++) receive(b, at(4) + i * 120001);
    assert.equal(activity(b, at(4) + 5 * 120001), 'sleeping');
  });
  check('电话视频唤醒，不绕过关系冷却', () => {
    for (const call of ['voice', 'video']) {
      const s = createState('normal');
      receive(s, at(4), '来电', call);
      assert.equal(activity(s, at(4)), 'woken');
      s.cooldownUntil = at(6);
      assert.equal(dueKind(s, at(4)), null);
    }
  });
  check('无业夏夏14点消息无需工作等待，回复后不设置工作期限', () => {
    const s = createState('normal');
    receive(s, at(14));
    assert.equal(s.life.nextWorkReplyAt, 0);
    assert.equal(dueKind(s, at(14)), 'queued');
    assert.equal(dueKind(s, at(14) + 2999), 'queued');
    assert.equal(dueKind(s, at(19)), 'queued');
    afterReply(s, at(14), () => 0);
    assert.equal(s.life.nextWorkReplyAt, 0);
  });
  check('保留的旧工作等待字段不挡无业队列，旧期限迁移不改消息与隐藏值', () => {
    assert.equal(lifeConfig.workReplyMinMs,3000);
    assert.equal(lifeConfig.workReplyMaxMs,8000);
    const s=createState('normal');receive(s,at(14));
    s.life.nextWorkReplyAt=at(14)+20*60000;
    assert.equal(dueKind(s,at(14)),'queued');
    const before=structuredClone(s);
    assert.equal(shortenLegacyWorkWait(s,at(14)),true);
    assert.equal(s.life.nextWorkReplyAt,at(14)+3000);
    before.life.nextWorkReplyAt=s.life.nextWorkReplyAt;
    assert.deepEqual(s,before);
    assert.equal(dueKind(s,at(14)),'queued');
    assert.equal(shortenLegacyWorkWait(s,at(14)+1000),false);
    assert.equal(s.life.nextWorkReplyAt,at(14)+3000);
    const messages=structuredClone(s.messages),values={...s.values};
    afterReply(s,at(14)+4000,()=>0.999);
    assert.equal(s.life.nextWorkReplyAt,0);
    assert.deepEqual(s.messages,messages);
    assert.deepEqual(s.values,values);
  });
  // Proactive scenarios moved to test-contact-life.mjs, which covers all three roles
  // under the current policy; the tests below retain sleep, queue and race coverage.
  let state = createState('normal'),
    time = at(4),
    calls = 0;
  const runtime = {
    root: fixture.root,
    now: () => time,
    load: () => structuredClone(state),
    save: (_, s, rev) => {
      assert.equal(state.revision, rev);
      state = structuredClone({ ...s, revision: rev + 1 });
    },
    generate: async () => {
      calls++;
      return {
        action: 'reply',
        messages: [
          { type: 'text', text: '醒啦' },
          { type: 'sticker', assetId: 'cowThinking' },
        ],
        event: null,
        memories: [],
      };
    },
  };
  receive(state, time);
  await runScheduledTurn(runtime, 'a');
  assert.equal(calls, 0);
  receive(state, time, '来电', 'video');
  await runScheduledTurn(runtime, 'a');
  assert.equal(calls, 1);
  assert.equal(state.life.queue.length, 0);
  assert.equal(state.messages.filter((m) => m.role === 'user').length, 2);
  assert.equal(state.messages.filter((m) => m.role === 'assistant').length, 2);
  console.log(
    'PASS scheduler: sleep makes zero model calls; wake processes queue; no synthetic user message',
  );
  passed++;
  state = createState('normal');
  time = at(20);
  const life = ensureLife(state, time);
  receive(state, at(19));
  life.queue=[];
  state.contactLife.nextAt=at(20);
  await runScheduledTurn(runtime, 'a');
  assert.equal(state.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(state.messages.find(m=>m.role==='assistant').origin, 'proactive');
  assert.equal(state.life.proactiveAttempts, 1);
  time += 2 * 3600000;
  assert.equal(await runScheduledTurn(runtime, 'a'), false);
  console.log(
    'PASS proactive messages stored as assistant messages; no repeated nagging',
  );
  passed++;
  state = createState('normal');
  time = at(20);
  receive(state, time);
  let release;
  runtime.generate = () =>
    new Promise((r) => {
      release = r;
    });
  const inflight = runScheduledTurn(runtime, 'a');
  await new Promise((r) => setTimeout(r, 0));
  receive(state, time + 1000, '新消息');
  release({
    action: 'reply',
    messages: [{ type: 'text', text: '第一批回复' }],
    event: null,
    memories: [],
  });
  await inflight;
  assert.equal(state.life.queue.length, 2);
  assert.equal(state.messages.filter((m) => m.role === 'assistant').length, 0);
  assert.equal(state.messages.filter((m) => m.role === 'user').length, 2);
  console.log(
    'PASS new input invalidates stale answer and retains both queued messages',
  );
  passed++;
  check('presence follows actual schedule and availability', () => {
    const s = createState('normal');
    assert.equal(presence(s, at(4)), 'offline');
    assert.equal(presence(s, at(15)), 'online');
    assert.equal(presence(s, at(20)), 'online');
    assert.equal(presence(s, at(20), false), 'offline');
  });
  check(
    'typing blocks reply only during active lease; expired tab recovers',
    () => {
      const s = createState('normal');
      receive(s, at(20));
      s.life.typingClients = { tab: { until: at(20) + 8000, sequence: 1 } };
      assert.equal(dueKind(s, at(20)), null);
      assert.equal(dueKind(s, at(20) + 8001), 'queued');
    },
  );
  state = createState('normal');
  time = at(20);
  receive(state, time);
  const pendingInput = runScheduledTurn(runtime, 'a');
  await new Promise((r) => setTimeout(r, 0));
  state.life.inputRevision = 1;
  release({
    action: 'reply',
    messages: [{ type: 'text', text: '不应投递' }],
    event: null,
    memories: [],
  });
  await pendingInput;
  assert.equal(state.messages.filter((m) => m.role === 'assistant').length, 0);
  assert.equal(state.life.queue.length, 1);
  console.log(
    'PASS resumed typing cancels stale reply even after typing lease clears',
  );
  passed++;
  console.log(`${passed} life checks passed`);
} finally {
  fixture.cleanup();
}
