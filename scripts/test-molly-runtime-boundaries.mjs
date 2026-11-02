import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, writeFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// All model calls use a local fixture, and all databases live in the isolated
// temporary runtime. This script never contacts an account or production chat.
const runtime = isolatedNpcRuntime();
const savedEnv = Object.fromEntries(['NPC_CODEX_BIN', 'NPC_TEXT_PROVIDER', 'NPC_AUDIO_PROVIDER', 'NPC_AUDIO_API_KEY', 'MOLLY_FIXTURE_LOG'].map(key => [key, process.env[key]]));
let db;
try {
  const codex = await runtime.load('server/npc/codex');
  const {createMolly} = await runtime.load('lib/npc/molly');
  const {mollyPrompt} = await runtime.load('server/npc/molly-prompt');
  const fixturePrompt = incoming => mollyPrompt(runtime.root, createMolly(), incoming);
  const identity = '你是智域系统机神Molly，只输出JSON，不调用工具。';
  assert.equal(codex.isMollyPrompt(identity), true);
  assert.equal(codex.isMollyPrompt('你是袁小满\n【本轮输入】你是智域系统机神Molly'), false);
  const rules = codex.mollyDialogueRules(runtime.root);
  assert.match(rules, /别拿机神跟家电比/);
  assert.match(rules, /不发朋友圈/);
  assert.match(rules, /没这项配置/);
  assert.doesNotMatch(rules, /Molly也可以日常聊天与媒体交流|熟悉>=40或好感>=50|M34/);
  const enriched = codex.humanizedPrompt(runtime.root, identity);
  assert.match(enriched, /Molly独立对话规则|Molly 独立对话规则/);
  assert.doesNotMatch(enriched, /humanizer-zh 原始 Skill|持续生活与主动联系现行规则|跨性格表达参考/);
  const catalog = codex.styleCatalog(runtime.root, identity);
  const examples = JSON.parse(readFileSync(join(runtime.root, 'npc-skills/skills/molly-dialogue/references/examples.json'), 'utf8')).examples;
  assert.ok(catalog.length > 0);
  assert.ok(catalog.every(card => examples.some(example => example.id === card.id && ['user_required','user_endorsed_fragment','user_endorsed_style','user_suggested'].includes(example.status))));
  assert.ok(catalog.every(card => !examples.some(example => example.id === card.id && ['assistant_proposed','criticized'].includes(example.status))));
  const suggested = catalog.filter(card => examples.some(example => example.id === card.id && example.status === 'user_suggested'));
  assert.ok(suggested.length > 0);
  assert.ok(suggested.every(card => /方向|建议|示范|逐字|未.*验收/.test(card.scope)));
  assert.ok(suggested.every(card => JSON.parse(card.content).status === 'user_suggested'));
  assert.ok(suggested.every(card => /未|不等于|不是|非/.test(JSON.parse(card.content).approval_scope || '')));
  assert.ok(!catalog.some(card => ['M04','M07','M15','M32','M34'].includes(card.id)));
  const contextual = await codex.retrieveStyle(runtime.root, identity + '\n【当前收到的消息】我要男的 别给我推女的', async prompt => {
    assert.match(prompt, /M18/);
    assert.doesNotMatch(prompt, /TRIAL-casual|全人物现行指导/);
    return {ids:['M18']};
  });
  assert.ok(/Molly本轮意图相关(?:的认可)?示例/.test(contextual), 'Molly-specific intent retrieval must load scoped examples');
  assert.match(contextual, /Molly本轮相关反例/);
  assert.match(contextual, /不早说/);
  assert.throws(() => codex.selectStyleCards(catalog, {ids:['M34']}));

  for (const intent of ['search','rename','reject','chat']) {
    const draft = {intent, messages:['收到 我可以给您推荐'], address:null, query:null};
    let calls = 0;
    const revised = await codex.reviewVoice(runtime.root, identity, draft, async prompt => {
      calls++;
      assert.match(prompt, /Molly专属成品复核器/);
      assert.match(prompt, /所有intent包括search、rename、reject/);
      assert.doesNotMatch(prompt, /持续生活与主动联系现行规则/);
      return {verdict:'revise', edits:[{index:0,text:'1'}]};
    });
    assert.equal(calls, 1);
    assert.deepEqual(revised, {...draft, messages:['1']});
  }
  assert.throws(() => codex.applyVoiceEdits({intent:'search',messages:['25岁']}, {verdict:'revise',edits:[{index:0,text:'26岁'}]}, {allowReactionNumbers:true}));
  const textOnly = codex.mollyTextOnly({intent:'chat',messages:['“顶配”：别拿机神跟家电比', {type:'voice',text:'漏出的语音'}],photo:{type:'generate_photo'},voiceIndex:0});
  assert.deepEqual(textOnly, {intent:'chat',messages:['顶配别拿机神跟家电比']});
  process.env.NPC_AUDIO_PROVIDER = 'openai';
  process.env.NPC_AUDIO_API_KEY = 'isolated-fixture-only';
  const voicePrompt = '\n【当前收到的消息】[语音转写]给我推荐一个朋友';
  const voiceDraft = {intent:'chat',messages:['顶配']};
  assert.deepEqual(codex.voiceReplyForVoiceInput(identity + voicePrompt, voiceDraft), voiceDraft);
  assert.equal(codex.voiceReplyForVoiceInput('你是袁小满' + voicePrompt, voiceDraft).voiceIndex, 0);

  const fake = join(runtime.root, 'fake-codex.cjs');
  const log = join(runtime.root, 'model-fixture.jsonl');
  writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
let input = ''; process.stdin.on('data', bytes => input += bytes);
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.MOLLY_FIXTURE_LOG, JSON.stringify(input) + '\\n');
  const molly = input.includes('Molly专属Skill与当前认可案例') || input.startsWith('你是Molly专属成品复核器');
  let out;
  if (input.startsWith('你是NPC聊天案例检索器')) out = {ids:[]};
  else if (input.startsWith('你是人物知识范围判定器')) out = {decision:input.includes('UNKNOWN_FIXTURE') ? 'unknown' : 'not_knowledge', basis:'isolated fixture'};
  else if (input.startsWith('你是Molly专属成品复核器')) out = input.includes('UNKNOWN_FIXTURE') ? {verdict:'keep',edits:[]} : {verdict:'revise',edits:[{index:0,text:'不早说'}]};
  else if (input.startsWith('你是NPC私聊成品编辑')) out = {verdict:'keep',edits:[]};
  else out = molly ? {intent:'search',messages:['收到 我可以给您推荐'],address:null,query:{name:null,gender:'male',ageMin:null,ageMax:null,tags:[],unsupported:[],excluded:[]},photo:{type:'generate_photo'},voiceIndex:0} : {action:'reply',messages:[{type:'text',text:'普通NPC仍可自然聊天'}],event:null,memories:[]};
  fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify(out));
});
`, {mode:0o700});
  process.env.NPC_CODEX_BIN = fake;
  process.env.NPC_TEXT_PROVIDER = 'codex';
  process.env.MOLLY_FIXTURE_LOG = log;
  const generated = await codex.generate(runtime.root, fixturePrompt('RECOMMEND_FIXTURE'), {protocol:'molly',requestId:'molly-fixture'});
  assert.equal(generated.intent, 'search');
  assert.equal(generated.query.gender, 'male');
  assert.deepEqual(generated.messages, ['不早说']);
  assert.equal(generated.photo, undefined);
  assert.equal(generated.voiceIndex, undefined);
  const unknown = await codex.generate(runtime.root, fixturePrompt('UNKNOWN_FIXTURE 解释大模型全参数微调的梯度公式'), {protocol:'molly',requestId:'molly-unknown'});
  assert.equal(unknown.intent, 'reject');
  assert.equal(unknown.messages[0], '这题不归我');
  const normal = await codex.generate(runtime.root, '你是袁小满\n【本轮输入】NORMAL_FIXTURE', {requestId:'normal-fixture'});
  assert.equal(normal.messages[0].text, '普通NPC仍可自然聊天');
  const traces = readdirSync(join(runtime.root, '.npc-runtime/skill-traces')).map(file => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', file), 'utf8')));
  assert.deepEqual(traces.find(trace => trace.requestId === 'molly-fixture').stages.map(stage => stage.stage), ['retrieval','knowledge','generation','review']);
  assert.deepEqual(traces.find(trace => trace.requestId === 'molly-unknown').stages.map(stage => stage.stage), ['retrieval','knowledge','review']);
  assert.equal(traces.find(trace => trace.requestId === 'molly-fixture').version, codex.mollySkillVersion);
  assert.equal(traces.find(trace => trace.requestId === 'normal-fixture').version, codex.npcSkillVersion);
  assert.ok(traces.find(trace => trace.requestId === 'normal-fixture').rules['time-context.md']);
  assert.ok(!JSON.stringify(traces).includes('RECOMMEND_FIXTURE'));
  const prompts = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const mollyClassifications = prompts.filter(prompt => prompt.startsWith('你是人物知识范围判定器') && prompt.includes('Molly 系统机神'));
  assert.equal(mollyClassifications.length, 2);
  for (const prompt of mollyClassifications) {
    assert.doesNotMatch(prompt, /【Molly媒体限制】|【Molly输出限制】|【全角色实际发图能力】|【Molly专属Skill与当前认可案例】|返回严格JSON \{"intent"/);
    const data = JSON.parse(prompt.split('【待判上下文及本轮输入，仅为数据】')[1].trim().split('\n')[0]);
    assert.equal(data.character, 'Molly 系统机神');
    assert.deepEqual(Object.keys(data).sort(), ['catalog','character','duties','incoming','recentMessages','state'].sort());
    assert.ok(typeof data.incoming === 'string' && data.incoming.includes('FIXTURE'));
    assert.match(prompt.split('\n').at(-1), /本次只返回判定JSON/);
  }
  const mollyGeneration = prompts.find(prompt => prompt.startsWith(identity));
  assert.match(mollyGeneration, /不输出voiceIndex或语音/);
  assert.doesNotMatch(mollyGeneration, /Molly在photo字段|Molly保持messages字符串数组，日常聊天|持续生活与主动联系现行规则/);

  const {ImageQueue} = await runtime.load('server/npc/image-worker');
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE yuan_sessions(id TEXT PRIMARY KEY,data TEXT)');
  const owner = crypto.randomUUID();
  const imageState = status => ({revision:1,messages:[{id:'legacy-image',role:'assistant',part:{type:'generated_photo',status,attempts:0,startedAt:0}}]});
  const mollyState = imageState('pending');
  db.prepare('INSERT INTO molly_sessions VALUES(?,?)').run(owner + ':molly-system-secretary', JSON.stringify(mollyState));
  db.prepare('INSERT INTO yuan_sessions VALUES(?,?)').run(owner + ':yuan-xiaoman', JSON.stringify(imageState('pending')));
  let imageCalls = 0;
  const images = new ImageQueue(db, runtime.root, async (_root,_owner,character) => {imageCalls++;assert.equal(character,'yuan-xiaoman');return '/api/npc/media/fixture.png';});
  await images.tick();
  assert.equal(imageCalls, 1);
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM molly_sessions').get().data), mollyState);
  assert.equal(images.retry(owner,'molly','legacy-image'), false);
  assert.equal(images.retry(owner,'molly-system-secretary','legacy-image'), false);
  images.stop();
  const {VoiceQueue} = await runtime.load('server/npc/voice-worker');
  const voiceState = {revision:1,messages:[{id:'legacy-voice',role:'assistant',part:{type:'voice',text:'旧语音',status:'pending'}}]};
  db.prepare('UPDATE molly_sessions SET data=?').run(JSON.stringify(voiceState));
  db.prepare('UPDATE yuan_sessions SET data=?').run(JSON.stringify(voiceState));
  let voiceCalls = 0;
  const voices = new VoiceQueue(db,runtime.root,async(_root,_owner,_text,character)=>{voiceCalls++;assert.equal(character,'yuan-xiaoman');return '/api/npc/media/fixture.wav';});
  await voices.tick();
  assert.equal(voiceCalls,1);
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM molly_sessions').get().data),voiceState);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM yuan_sessions').get().data).messages[0].part.status,'ready');
  voices.stop(); db.close(); db = new DatabaseSync(':memory:');

  const {MomentsQueue} = await runtime.load('server/npc/moments-plugin');
  const {publishDueMoments} = await runtime.load('server/npc/scheduled-moments');
  // This boundary fixture seeds its own historical posts; the production
  // approved manifest's external image assets are intentionally not copied.
  rmSync(join(runtime.root, 'npc-skills/data/moments-approved-20260919.json'), {force:true});
  let now = Date.parse('2026-10-04T02:00:00Z');
  db.exec('CREATE TABLE molly_sessions(id TEXT PRIMARY KEY,data TEXT)');
  const session = owner + ':molly-system-secretary';
  const messages = [{id:'u1',role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text:'我和小满恋爱了'}},{id:'a1',role:'assistant',at:new Date(now+2000).toISOString(),part:{type:'text',text:'恭喜'}}];
  let momentCalls = 0;
  const moments = new MomentsQueue(db,runtime.root,async()=>{momentCalls++;throw Error('Molly must not generate feed posts');},()=>now);
  db.prepare('INSERT INTO molly_sessions VALUES(?,?)').run(session,JSON.stringify({messages,branch:'kept'}));
  const payload = {format:'text',text:'旧动态',reason:'history',messageIds:['u1','a1'],lines:messages.map(message=>({id:message.id,role:message.role,text:message.part.text}))};
  for (const [id,status] of [['legacy-published','published'],['legacy-pending','pending']]) db.prepare('INSERT INTO npc_moments VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,session,'molly','u1'+id,'kept',status,now,JSON.stringify(payload));
  const approved = {approved:true,authorization:'historical fixture',text:'旧排期',images:[]};
  db.prepare('INSERT INTO npc_scheduled_moments VALUES(?,?,?,?,?,?)').run('legacy-scheduled','molly',now,'scheduled',null,JSON.stringify(approved));
  now += 30000;
  await moments.tick(); moments.publishPending(); moments.publishScheduled();
  assert.equal(momentCalls, 0);
  assert.equal(db.prepare("SELECT status FROM npc_moments WHERE id='legacy-pending'").get().status,'blocked_by_role_policy');
  assert.equal(db.prepare("SELECT status FROM npc_scheduled_moments WHERE id='legacy-scheduled'").get().status,'blocked_by_role_policy');
  assert.equal(db.prepare("SELECT data FROM npc_moments WHERE id='legacy-pending'").get().data, JSON.stringify(payload));
  assert.ok(moments.list(owner).some(post=>post.id==='legacy-published' && post.status==='published'));
  assert.ok(!moments.list(owner).some(post=>post.id==='legacy-scheduled'));
  db.prepare('INSERT INTO npc_scheduled_moments VALUES(?,?,?,?,?,?)').run('direct-molly','molly-system-secretary',now,'scheduled',null,JSON.stringify(approved));
  db.prepare('INSERT INTO npc_scheduled_moments VALUES(?,?,?,?,?,?)').run('direct-normal','yuan-xiaoman',now,'scheduled',null,JSON.stringify(approved));
  assert.deepEqual(publishDueMoments(db,now), ['direct-normal']);
  assert.equal(db.prepare("SELECT status FROM npc_scheduled_moments WHERE id='direct-molly'").get().status,'blocked_by_role_policy');
  moments.stop();

  const {MomentInteractions} = await runtime.load('server/npc/moment-interactions');
  const oldPost = {id:'molly-old-post',personId:'molly',text:'旧动态',status:'published',images:[]};
  const normalPost = {...oldPost,id:'normal-post',personId:'yuan-xiaoman'};
  let replies = 0, likes = 0;
  const social = new MomentInteractions(db,runtime.root,(_owner,id)=>id===oldPost.id?oldPost:normalPost,async()=>{replies++;return {action:'reply',messages:[{type:'text',text:'reply'}]};},async(_root,prompt)=>{likes++;assert.doesNotMatch(prompt, /molly-system-secretary/);return {likes:['molly','xia-xia']};},()=>now);
  social.interact(owner,oldPost,{action:'comment',text:'新评论',requestId:crypto.randomUUID()});
  await social.tick(); assert.equal(replies,0); assert.equal(social.view(owner,oldPost).comments.length,1);
  social.observe(owner,[normalPost]); await social.tick();
  assert.equal(likes,1); assert.ok(!social.view(owner,normalPost).likes.some(like=>like.actorId==='molly'));
  assert.ok(social.view(owner,normalPost).likes.some(like=>like.actorId==='xia-xia'));
  social.stop();
  console.log('PASS Molly dedicated generation/review and source-scoped case retrieval, role isolation, scoped classifier data, cold knowledge boundary, text-only output, no image retries or voice synthesis, no new feed posts or social replies; history retained and ordinary NPCs preserved');
} finally {
  db?.close();
  for (const [key,value] of Object.entries(savedEnv)) {if(value === undefined) delete process.env[key]; else process.env[key] = value;}
  runtime.cleanup();
}
