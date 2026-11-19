import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Seven actual HTTP middlewares, normal send/save workers, real temporary SQLite.
// Model/ASR bytes are local synthetic fixtures; external provider calls are zero.
const runtime = isolatedNpcRuntime(), close = new EventEmitter(), handlers = [];
close.setMaxListeners(30);
const nativeNow = Date.now, baseClock = Date.parse('2026-11-19T04:00:00Z');
let clock = baseClock, db, checks = 0, modelCalls = 0, activeActor = '', groupCalls = 0;
Date.now = () => clock;
const prompts = [], groupContexts = [];
const success = name => {checks++; console.log('PASS', name);};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = {config: {root: runtime.root, server: {port: 3101}}, httpServer: close, middlewares: {
  use(path, handler) {handlers.push(typeof path === 'function' ? {path: '', handler: path} : {path, handler});},
}};
const actors = [
  {id: 'molly', path: 'molly', table: 'molly_sessions', suffix: 'molly-system-secretary'},
  {id: 'xia-xia', path: 'xia-xia', table: 'sessions', suffix: 'xia-xia:normal'},
  {id: 'yuan-xiaoman', path: 'yuan-xiaoman', table: 'yuan_sessions', suffix: 'yuan-xiaoman'},
  {id: 'he-jiawei', path: 'he-jiawei', table: 'he_sessions', suffix: 'he-jiawei'},
  {id: 'chen-nian', path: 'chen-nian', table: 'chen_sessions', suffix: 'chen-nian'},
  {id: 'liu', path: 'liu', table: 'liu_sessions', suffix: 'liu'},
  {id: 'zhou-chef', path: 'zhou-chef', table: 'zhou_chef_sessions', suffix: 'zhou-chef'},
];
function request(path, identity, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method; req.url = path; req.socket = {remoteAddress: '127.0.0.1'};
    req.headers = {host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'content-type': 'application/json',
      'x-zhiyu-account': identity?.accountId || '', cookie: identity ? `zhiyu_npc=${identity.owner}; zhiyu_auth=${identity.token}` : ''};
    const timer = setTimeout(() => reject(Error('Middleware timeout: ' + path)), 8000);
    const res = {statusCode: 200, writableEnded: false, setHeader() {}, end(content) {
      this.writableEnded = true; clearTimeout(timer);
      try {resolve({status: this.statusCode, data: JSON.parse(content)});} catch (error) {reject(error);}
    }};
    let index = 0;
    function next() {
      const route = handlers[index++]; if (!route) {clearTimeout(timer); reject(Error('No route ' + path)); return;}
      if (route.path && !req.url.startsWith(route.path)) {next(); return;}
      const original = req.url; if (route.path) req.url = req.url.slice(route.path.length) || '/';
      try {route.handler(req, res, () => {req.url = original; next();});} catch (error) {clearTimeout(timer); reject(error);}
    }
    next();
  });
}
async function until(check, detail) {
  for (let i = 0; i < 400; i++) {if (check()) return; await pause(5);}
  assert.fail('Actual worker did not finish: ' + (typeof detail === 'function' ? detail() : detail));
}
try {
  const [auth, identityModule, summer, yuan, he, chen, liu, chef, molly, groups, scheduler, openings, literal, prefsModule, sceneModule] = await Promise.all([
    runtime.load('server/npc/auth-plugin'), runtime.load('server/npc/beta-identity'), runtime.load('server/npc/plugin'),
    runtime.load('server/npc/yuan-plugin'), runtime.load('server/npc/he-plugin'), runtime.load('server/npc/chen-plugin'),
    runtime.load('server/npc/liu-plugin'), runtime.load('server/npc/zhou-chef-plugin'), runtime.load('server/npc/molly-plugin'),
    runtime.load('server/npc/groups-plugin'), runtime.load('server/npc/scheduler'), runtime.load('server/npc/opening-service'),
    runtime.load('lib/npc/opening'), runtime.load('server/npc/dialogue-preferences'), runtime.load('server/npc/dialogue-skill'),
  ]);
  const generate = async (_root, prompt, options) => {
    const scene = sceneModule.deriveDialogueSceneContext(prompt);
    assert.ok(scene.userText?.trim(), activeActor + ' current user JSON remains parseable after host experience injection');
    modelCalls++; prompts.push({actor: activeActor, text: prompt, requestId: options?.requestId, scene});
    return options?.protocol === 'molly'
      ? {intent: 'chat', messages: ['1'], address: null, query: null}
      : {action: 'reply', messages: [{type: 'text', text: '我听到了'}], event: null, memories: []};
  };
  const now = () => clock, available = () => true;
  auth.authLocal().configureServer(server);
  summer.npcLocal({generate, available}).configureServer(server);
  yuan.yuanLocal({generate, available, now}).configureServer(server);
  he.heLocal({generate, available, now}).configureServer(server);
  chen.chenLocal({generate, available, now}).configureServer(server);
  liu.liuLocal({generate, available, now}).configureServer(server);
  chef.chefLocal({generate, available, now}).configureServer(server);
  molly.mollyLocal({generate, available, now}).configureServer(server);
  groups.groupChatsLocal({now, automatic: false, namer: async () => '隔离开场偏好群', dialogue: async (_root, context) => {
    groupCalls++; groupContexts.push(structuredClone(context));
    return {messages: [{senderId: context.kind === 'opening' ? 'molly' : 'yuan-xiaoman', text: '大家都在呢', mentionIds: []}]};
  }}).configureServer(server);
  db = new DatabaseSync(join(runtime.root, '.npc-runtime/state.sqlite')); identityModule.initBetaIdentity(db);
  const service = new openings.OpeningService(db, runtime.root, now, {rng: () => 0});
  const preferences = new prefsModule.DialoguePreferencesStore(db, now);
  function account() {
    const owner = randomUUID(), accountId = randomUUID(), token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    db.prepare('INSERT INTO zhiyu_accounts(id,username,password_salt,password_digest,owner_id,created_at,display_number,is_internal,is_beta) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(accountId, 'isolation-' + accountId, 'local-salt', 'local-unusable', owner, clock, accountId, 1, 0);
    db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), accountId, clock + 7 * 86400000);
    return {owner, accountId, token};
  }
  function raw(who, actor) {
    const row = db.prepare(`SELECT data FROM ${actor.table} WHERE id=?`).get(`${who.owner}:${actor.suffix}`);
    return row ? JSON.parse(row.data) : null;
  }
  function save(who, actor, state) {
    if (actor.id === 'xia-xia') db.prepare(`UPDATE ${actor.table} SET data=?,revision=? WHERE id=?`).run(JSON.stringify(state), state.revision, `${who.owner}:${actor.suffix}`);
    else db.prepare(`UPDATE ${actor.table} SET data=? WHERE id=?`).run(JSON.stringify(state), `${who.owner}:${actor.suffix}`);
  }
  const get = (actor, who) => request('/api/npc/' + actor.path, who);
  const post = (actor, who, body) => request('/api/npc/' + actor.path, who, 'POST', body);
  async function runSummer(who) {
    const key = `${who.owner}:xia-xia:normal`, actor = actors[1];
    const load = () => raw(who, actor);
    const saveSummer = (_id, state, revision) => {
      state.revision = revision + 1;
      const result = db.prepare('UPDATE sessions SET data=?,revision=? WHERE id=? AND revision=?').run(JSON.stringify(state), state.revision, key, revision);
      assert.equal(result.changes, 1, 'optimistic real Summer session save');
    };
    const ok = await scheduler.runScheduledTurn({root: runtime.root, db, load, save: saveSummer, generate, now}, key);
    assert.equal(ok, true, JSON.stringify(load()));
  }
  function promptFacts(actor, from = 0) {
    const relevant = prompts.slice(from).filter(row => row.actor === actor.id && row.text.includes('【本轮服务端称呼与安排只读事实】'));
    assert.ok(relevant.length, actor.id + ' real generation prompt contains trusted host context');
    const line = relevant.at(-1).text.split('【本轮服务端称呼与安排只读事实】').at(-1).split('\n')[0];
    return JSON.parse(line);
  }
  async function send(actor, who, text, extra = {}) {
    activeActor = actor.id;
    const from = prompts.length, turnId = randomUUID();
    const response = await post(actor, who, {action: 'send', text, turnId, ...extra});
    assert.equal(response.status, 200, actor.id + ': ' + JSON.stringify(response.data));
    if (actor.id === 'xia-xia') await runSummer(who);
    await until(() => {
      const state = raw(who, actor), queue = state?.queue || state?.life?.queue || [];
      return state && !state.pending && !queue.length && (state.messages.some(message => message.role === 'assistant' && !openings.isFixedOpeningMessage(message)) || state.error || state.life?.lastError);
    }, () => actor.id + ': ' + JSON.stringify(raw(who, actor)));
    const state = raw(who, actor);
    assert.equal(state.error || state.life?.lastError || '', '', actor.id + ': ' + JSON.stringify(state));
    assert.ok(state.messages.some(message => message.role === 'assistant' && !openings.isFixedOpeningMessage(message)), actor.id + ' normal reply while intro had pending delivery');
    const facts = promptFacts(actor, from);
    // Finish this actual reply's recorded presentation clock before a later
    // ordinary send; do not skip opening delivery to make interruption pass.
    clock = Math.max(clock, ...state.messages.filter(message => message.role === 'assistant' && !openings.isFixedOpeningMessage(message)).map(message => message.deliverAt || 0)) + 1;
    return {state, turnId, response, from, facts};
  }
  const fresh = account(); service.initializeRegistration(fresh.owner);
  const modelBefore = modelCalls;
  for (const actor of actors) {
    if (['xia-xia', 'yuan-xiaoman'].includes(actor.id)) continue;
    const view = await get(actor, fresh); assert.equal(view.status, 200);
    const state = raw(fresh, actor), wanted = literal.openingFor(actor.id).messages;
    assert.deepEqual(state.messages.filter(openings.isFixedOpeningMessage).map(message => message.part.type === 'text' ? message.part.text : message.part), wanted);
    assert.equal(view.data.messages.length, 0); assert.equal(view.data.pending, true);
    const again = await get(actor, fresh); assert.equal(again.status, 200); assert.deepEqual(raw(fresh, actor), state);
    success(actor.id + ' real GET queues literal opening once, exposes paced typing and hides future bubbles');
  }
  assert.equal(modelCalls, modelBefore, 'host opening makes zero generation calls');
  clock += 60_000; await get(actors[2], fresh);
  clock += 30_000; await get(actors[1], fresh);
  for (const actor of [actors[1], actors[2]]) {
    const state = raw(fresh, actor); assert.deepEqual(state.messages.filter(openings.isFixedOpeningMessage).map(message => message.part.text), literal.openingFor(actor.id).messages);
  }
  success('both actual companion GET routes drive delayed registration openings with original copy');
  // Separate owner per actor keeps every first ordinary POST inside its own
  // still-pending introduction, rather than waiting for all openings to finish.
  for (const actor of actors) {
    const who = account(); service.initializeRegistration(who.owner);
    if (['xia-xia', 'yuan-xiaoman'].includes(actor.id)) clock += actor.id === 'xia-xia' ? 90_000 : 60_000;
    const first = await get(actor, who); assert.equal(first.status, 200); assert.equal(first.data.pending, true);
    const initial = raw(who, actor), future = initial.messages.filter(message => openings.isFixedOpeningMessage(message) && message.deliverAt > clock);
    assert.ok(future.length);
    const rejected = await post(actor, who, {action: 'send', text: '叫我无效昵称', turnId: 'invalid'});
    assert.equal(rejected.status, 400); assert.deepEqual(raw(who, actor), initial);
    assert.equal(preferences.effectiveAddress(who.owner, actor.id).source, 'default');
    assert.equal(db.prepare('SELECT status FROM npc_opening_states WHERE owner=? AND npc_id=?').get(who.owner, actor.id).status, 'queued');
    const result = await send(actor, who, '叫我Jade');
    assert.equal(result.facts.addressing.name, 'Jade'); assert.equal(result.facts.addressing.source, 'global');
    assert.equal(result.facts.addressing.pronoun, actor.id === 'zhou-chef' ? '您' : '你');
    assert.ok(!result.state.messages.some(message => future.some(old => old.id === message.id)));
    assert.equal(db.prepare('SELECT status FROM npc_opening_states WHERE owner=? AND npc_id=?').get(who.owner, actor.id).status, 'cancelled');
    const address = preferences.effectiveAddress(who.owner, actor.id), count = modelCalls;
    const duplicate = await post(actor, who, {action: 'send', text: '叫我伪造重复称呼', turnId: result.turnId});
    assert.ok([200, 409].includes(duplicate.status), actor.id + JSON.stringify(duplicate.data));
    assert.deepEqual(preferences.effectiveAddress(who.owner, actor.id), address); assert.equal(modelCalls, count);
    const bad = await post(actor, who, {action: 'send', text: '叫我非法编号', turnId: 'invalid'});
    assert.equal(bad.status, 400); assert.deepEqual(preferences.effectiveAddress(who.owner, actor.id), address);
    success(actor.id + ' real pending-opening POST interrupts future copy, replies normally, and invalid/duplicate POST cannot change global address');
    clock += 30_000;
  }
  const who = account(), outsider = account();
  // An old persisted Molly.address may be retained for backwards compatibility;
  // the new trusted context must still use the host's global preference.
  await get(actors[0], who); const mollyState = raw(who, actors[0]); mollyState.address = '旧称呼'; save(who, actors[0], mollyState);
  await send(actors[4], who, '以后都叫我Jade');
  for (const actor of actors) {
    const result = await send(actor, who, '聊聊今天'); assert.equal(result.facts.addressing.name, 'Jade');
    assert.equal(result.facts.arrangements.readOnly, true); assert.equal(result.facts.supervision.scope, 'off');
  }
  assert.equal(raw(who, actors[0]).address, '旧称呼');
  await get(actors[3], outsider); const outside = await send(actors[3], outsider, '聊聊今天');
  assert.equal(outside.facts.addressing.name, '老大'); assert.equal(outside.facts.addressing.source, 'default');
  success('global address reaches actual generation prompt for all seven, chef keeps 您, old Molly.address never overrides host context, other owner stays default');
  const personal = await send(actors[2], who, '叫我小玉，只有你这样叫我');
  assert.equal(personal.facts.addressing.name, '小玉'); assert.equal(personal.facts.addressing.source, 'personal');
  assert.equal((await send(actors[4], who, '聊聊今天')).facts.addressing.name, 'Jade');
  const reset = await send(actors[2], who, '别这样叫了'); assert.equal(reset.facts.addressing.name, '老大');
  assert.equal((await send(actors[4], who, '聊聊今天')).facts.addressing.name, 'Jade');
  success('real private local-only setting affects one actor; reset restores that default while global name remains active elsewhere');
  const voiceWho = account(), voiceActor = actors[2], audioId = randomUUID() + '.wav';
  const audioDir = join(runtime.root, '.npc-runtime/audio', voiceWho.owner); mkdirSync(audioDir, {recursive: true});
  writeFileSync(join(audioDir, audioId), Buffer.from('synthetic local bytes; never decoded'));
  writeFileSync(join(audioDir, audioId + '.json'), JSON.stringify({text: '叫我语音昵称', durationSeconds: 2}));
  const voice = await send(voiceActor, voiceWho, '', {audioId});
  assert.equal(voice.state.messages.findLast(message => message.role === 'user').part.type, 'voice');
  assert.equal(voice.facts.addressing.name, '语音昵称');
  assert.ok(prompts.slice(voice.from).some(row => row.text.includes('[语音转写，可能有识别误差')));
  assert.equal(preferences.effectiveAddress(voiceWho.owner, 'chen-nian').name, '语音昵称');
  success('actual audioId POST uses grounded voice transcript for global address; model still gets host ASR disclaimer');
  for (const agrees of [true, false]) {
    const listener = account(); service.initializeRegistration(listener.owner); clock += 60_000;
    await get(actors[2], listener); const opening = raw(listener, actors[2]);
    clock = opening.messages.find(message => message.secretaryEvent?.id === 'opening:yuan-xiaoman:v1:4').deliverAt;
    await send(actors[2], listener, agrees ? '好呀' : '不用盯了');
    assert.equal(preferences.supervision(listener.owner, 'yuan-xiaoman').scope, agrees ? 'all' : 'off');
    assert.ok(!raw(listener, actors[2]).messages.some(message => message.secretaryEvent?.id === 'opening:yuan-xiaoman:v1:5'));
    success('Xiaoman actual fourth-opening-bubble reply ' + (agrees ? 'consents to supervision and cancels fifth bubble' : 'refuses supervision and cancels fifth bubble'));
  }
  const groupStore = groups.groupStoreFor(runtime.root);
  const groupRaw = (account, id) => JSON.parse(db.prepare('SELECT data FROM npc_group_chats WHERE owner=? AND id=?').get(account.owner, id).data);
  async function drainGroup(account, id) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await groupStore.run(account.owner, id);
      const jobs = db.prepare("SELECT status,error FROM npc_group_jobs WHERE owner=? AND group_id=? AND status IN ('queued','running','failed')").all(account.owner, id);
      assert.ok(!jobs.some(job => job.status === 'failed'), JSON.stringify(jobs));
      const at = Math.max(clock, ...groupRaw(account, id).messages.map(message => message.deliverAt || 0)); clock = at + 1;
      if (!jobs.length) return;
    }
    assert.fail('group job not drained');
  }
  const created = await request('/api/npc/groups', who, 'POST', {action: 'create', requestId: randomUUID(), sourceCharacterId: 'molly', goal: '隔离开场偏好测试', memberIds: actors.filter(actor => actor.id !== 'molly').map(actor => actor.id), self: {name: '合成用户'}});
  assert.equal(created.status, 200, JSON.stringify(created.data)); const groupId = created.data.group.id; await drainGroup(who, groupId);
  const result = await request('/api/npc/groups', who, 'POST', {action: 'send', groupId, text: '大家聊聊今天', mentionIds: ['yuan-xiaoman'], requestId: randomUUID()});
  assert.equal(result.status, 200, JSON.stringify(result.data)); await drainGroup(who, groupId);
  const context = groupContexts.findLast(item => item.kind !== 'opening');
  assert.ok(context); assert.equal(Object.keys(context.characterExperience).length, 7);
  for (const actor of actors) {
    const facts = JSON.parse(context.characterExperience[actor.id].split('【本轮服务端称呼与安排只读事实】').at(-1));
    assert.equal(facts.addressing.name, actor.id === 'yuan-xiaoman' ? '老大' : 'Jade');
    assert.equal(facts.addressing.pronoun, actor.id === 'zhou-chef' ? '您' : '你');
    assert.equal(facts.supervision.channel, 'group'); assert.equal(facts.arrangements.readOnly, true);
  }
  success('actual group middleware/runner receives separate current seven-character address and read-only arrangement context');
  const crisisWho = account(), crisisText = '我想伤害自己';
  const crisis = await send(actors[4], crisisWho, crisisText);
  const crisisScene = prompts.slice(crisis.from).find(row => row.actor === 'chen-nian').scene;
  assert.equal(crisisScene.userText, crisisText);
  assert.ok(sceneModule.dialogueSceneModules('professional', crisisScene).includes('12-危机.md'));
  assert.ok(prompts.every(row => row.scene.userText.trim()));
  assert.equal(prompts.slice(voice.from).find(row => row.actor === voiceActor.id && row.scene.hasVoice)?.scene.hasVoice, true);
  success('all seven actual generation prompts retain nonempty current-input parsing; synthetic crisis still loads crisis module and real voice wrapper remains recognized');
  const crossActor = account();
  await send(actors[4], crossActor, '叫我Jade');
  const exclusive = await send(actors[2], crossActor, '只有你这样叫');
  assert.equal(exclusive.facts.addressing.name, 'Jade'); assert.equal(exclusive.facts.addressing.source, 'personal');
  for (const actor of actors.filter(actor => actor.id !== 'yuan-xiaoman')) assert.equal(preferences.effectiveAddress(crossActor.owner, actor.id).name, '老大');
  assert.equal((await send(actors[5], crossActor, '聊聊今天')).facts.addressing.name, '老大');
  success('real Chen global Jade then Xiaoman only-you short phrase retains Jade solely for Xiaoman and restores other six default addresses');
  console.log(JSON.stringify({ok: true, groups: checks, privateActors: actors.map(actor => actor.id), syntheticModelCalls: modelCalls, syntheticGroupCalls: groupCalls, externalModelCalls: 0, storage: 'temporary SQLite only'}));
} finally {close.emit('close'); await pause(30); db?.close(); Date.now = nativeNow; runtime.cleanup();}
