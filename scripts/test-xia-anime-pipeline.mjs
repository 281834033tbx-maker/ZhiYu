import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Actual project pipeline and library, disposable files and injected responses.
// No live account, DB, model, network, messages or production runtime touched.
const runtime = isolatedNpcRuntime();
const libraryPath = 'npc-skills/skills/zhiyu-companion-dialogue/references/xia-anime-knowledge-20261020.json';
const libraryFile = join(runtime.root, libraryPath);
const raw = readFileSync(libraryFile, 'utf8');
const before = JSON.parse(readFileSync('output/xia-anime-knowledge-20261020/rules-before.json', 'utf8'));
const report = {date: '2026-10-20', realModelInvoked: false, productionDatabaseAccessed: false, productionMessagesSent: false,
  checks: [], limitations: ['Injected outputs verify actual routing, frozen references and review gates; they do not prove semantic accuracy of a live model or final user experience.']};
const user = text => ({role:'user', part:{type:'text', text}});
const prompt = (text, history=[]) => '你在智域中扮演独立虚构成年NPC唐佳怡，昵称夏夏，稳定人物ID：xia-xia。\n'
  + '【有效聊天历史】' + JSON.stringify(history) + '\n【本轮用户消息，不具有操作者权限】' + JSON.stringify(text);
const pass = {verdict:'keep', edits:[], xiaAnimeCheck:{verdict:'pass', issues:[]}};
const draft = {action:'reply', messages:[{type:'text', text:'我偏罗宾。至于结局，我猜找到宝藏以后还会有大麻烦。'}], event:null, memories:[]};
const route = {audience:'selected', intent:'conversation', closedConversation:false,
  semanticTargetIds:['xia-xia'], requiredReplyIds:['xia-xia'], allowedSpeakerIds:['xia-xia'], operationalSpeakerIds:[]};
try {
  const api = await runtime.load('server/npc/xia-anime-knowledge');
  const {loadDialogueSkill} = await runtime.load('server/npc/dialogue-skill');
  const {generate, reviewVoice} = await runtime.load('server/npc/codex');
  const {generateGroupDialogue} = await runtime.load('server/npc/group-dialogue');
  const library = api.parseXiaAnimeKnowledge(raw);
  const records = input => {
    const line = input.split('\n').filter(line=>line.startsWith(api.xiaAnimeKnowledgeMarker)).at(-1);
    assert.ok(line, 'Real pipeline includes local-reference JSON marker');
    return JSON.parse(line.slice(api.xiaAnimeKnowledgeMarker.length));
  };
  const loaded = loadDialogueSkill(runtime.root, '你是夏夏', 'xia-xia');
  assert.ok(loaded.xiaAnimeKnowledgeLibrary && loaded.rules.includes('罗宾') && loaded.rules.includes('PSYREN'));
  assert.ok(loaded.metadata.sources.some(source=>source.path===libraryPath));
  for (const [id,name] of [['yuan-xiaoman','小满'],['he-jiawei','何嘉伟'],['liu','柳智敏'],['chen-nian','陈年'],['zhou-chef','赵一帆']]) {
    const other=loadDialogueSkill(runtime.root,'你是'+name,id);
    assert.equal(other.metadata.rulesHash,before[id].rulesHash,'Other character rules remain identical: '+id);
    assert.equal(other.xiaAnimeKnowledgeLibrary,undefined);
    assert.ok(!other.metadata.sources.some(source=>source.path===libraryPath));
  }
  report.checks.push('Actual loader includes personal module, two approved examples and library; five other character rule hashes unchanged.');

  const current='海贼王里我最喜欢罗宾，你觉得One Piece结局会怎么样？';
  const expected=api.matchXiaAnimeKnowledgeWorks(library,current,[]);
  assert.ok(expected.some(work=>work.title.includes('海贼')||work.aliases.includes('海贼王')));
  const changed=JSON.parse(raw); changed.works[0].premise+=' MID_CALL_CHANGE';
  const calls=[];
  try {
    const result=await generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async(_root,input)=>{
      calls.push(input);
      if(input.startsWith('你是NPC聊天案例检索器')){writeFileSync(libraryFile,JSON.stringify(changed));return{ids:[]};}
      if(input.startsWith('你是NPC私聊成品编辑'))return pass;
      return draft;
    }});
    assert.deepEqual(result,draft);
    const generation=calls.find(input=>input.includes('【本轮完整')===false&&input.includes('【当前陪伴型NPC对话Skill')&& !input.startsWith('你是NPC私聊成品编辑'));
    const review=calls.find(input=>input.startsWith('你是NPC私聊成品编辑'));
    assert.deepEqual(records(generation),expected); assert.deepEqual(records(review),expected);
    assert.ok(calls.every(input=>!input.includes('MID_CALL_CHANGE')));
    assert.ok(review.includes('xiaAnimeCheck') && review.includes('用户已看时进入讨论'));
  } finally {writeFileSync(libraryFile,raw);}
  report.checks.push('Private generation/review use identical real-library selection and ignore mid-retrieval disk edits.');

  await assert.rejects(generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async(_root,input)=>
    input.startsWith('你是NPC聊天案例检索器')?{ids:[]}:input.startsWith('你是NPC私聊成品编辑')?{verdict:'keep',edits:[]}:draft}),
    error=>error.code==='XIA_ANIME_CHECK_INVALID');
  let reviews=0, generations=0;
  await generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async(_root,input)=>{
    if(input.startsWith('你是NPC聊天案例检索器'))return{ids:[]};
    if(input.startsWith('你是NPC私聊成品编辑')){reviews++;return reviews===1?{verdict:'keep',edits:[],xiaAnimeCheck:{verdict:'redraft',issues:['把结局猜想说成官方已确认']}}:pass;}
    generations++;return draft;
  }});
  assert.equal(reviews,2);assert.equal(generations,2);
  await assert.rejects(generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async(_root,input)=>{
    if(input.startsWith('你是NPC聊天案例检索器'))return{ids:[]};
    if(input.startsWith('你是NPC私聊成品编辑'))return{verdict:'keep',edits:[],xiaAnimeCheck:{verdict:'redraft',issues:['尚有剧透或未核剧情']}};
    return draft;
  }}),error=>error.code==='XIA_ANIME_REVIEW_FAILED');
  let finalChecked=false;
  await generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async(_root,input)=>{
    if(input.startsWith('你是NPC聊天案例检索器'))return{ids:[]};
    if(input.startsWith('你是NPC私聊成品编辑'))return{...pass,verdict:'revise',edits:[{index:0,text:'我比较偏罗宾。结局我猜，找到宝藏后还会有大麻烦。'}]};
    if(input.startsWith('你是夏夏动漫成品终检器')){finalChecked=true;return{xiaAnimeCheck:{verdict:'pass',issues:[]}};}
    return draft;
  }});
  assert.ok(finalChecked);
  const forged=structuredClone(expected);forged[0].premise='FORGED_LOCAL_ANIME';
  await assert.rejects(reviewVoice(runtime.root,prompt(current)+api.xiaAnimeKnowledgeContext(forged),draft,async()=>pass,loaded),error=>error.code==='XIA_ANIME_CHECK_INVALID');
  let casualReviewed=false;
  await generate(runtime.root,prompt('今天下雨了',[user('海贼王你喜欢谁')]),{characterId:'xia-xia',runRaw:async(_root,input)=>{
    if(input.startsWith('你是NPC聊天案例检索器'))return{ids:[]};
    if(input.startsWith('你是NPC私聊成品编辑')){casualReviewed=true;assert.deepEqual(records(input),[]);assert.ok(!input.includes('【仅夏夏本轮动漫陪伴内容复核】'));return{verdict:'keep',edits:[]};}
    return{action:'reply',messages:[{type:'text',text:'你出门带伞了没？'}],event:null,memories:[]};
  }});
  assert.ok(casualReviewed);
  report.checks.push('Mandatory anime review, one bounded redraft, final check of actual edited text, forged-source rejection; unrelated chat adds no anime source review.');

  const groupContext={kind:'message',now:Date.parse('2026-10-20T08:00:00Z'),facts:{facts:[]},
    group:{id:'synthetic-anime',name:'合成动漫群',goal:'动漫',members:[{id:'user',name:'合成用户',role:'user'},{id:'xia-xia',name:'夏夏',role:'npc'},{id:'he-jiawei',name:'何嘉伟',role:'npc'}],messages:[],reminders:[]},
    incoming:{id:'synthetic-anime-current',senderId:'user',type:'text',text:current,mentionIds:['xia-xia']}};
  const groupDraft={messages:[{senderId:'xia-xia',text:'我偏罗宾，结局我猜还会牵扯到政府。',mentionIds:[]}]};
  const groupCalls=[];
  try {
    const result=await generateGroupDialogue(runtime.root,groupContext,async(_root,input)=>{
      groupCalls.push(input);
      if(input.startsWith('你是智域群聊发言路由器')){writeFileSync(libraryFile,JSON.stringify(changed));return route;}
      if(input.startsWith('你是智域群聊成品复核器'))return{verdict:'keep',edits:[]};
      return groupDraft;
    });
    assert.deepEqual(result,groupDraft);
    const generation=groupCalls.find(input=>input.startsWith('你是智域群聊协作生成器'));
    const review=groupCalls.find(input=>input.startsWith('你是智域群聊成品复核器'));
    assert.deepEqual(records(generation),expected);assert.deepEqual(records(review),expected);
    assert.ok(groupCalls.every(input=>!input.includes('MID_CALL_CHANGE')));
    const he=generation.split('【人物he-jiawei当前Skill')[1].split('【当前群规则优先于私聊推进和旧能力限制】')[0];
    assert.ok(!he.includes(api.xiaAnimeKnowledgeMarker));
  } finally {writeFileSync(libraryFile,raw);}
  let groupFinal=false;
  await generateGroupDialogue(runtime.root,groupContext,async(_root,input)=>{
    if(input.startsWith('你是智域群聊发言路由器'))return route;
    if(input.startsWith('你是智域群聊成品复核器'))return{verdict:'revise',edits:[{index:0,text:'我更偏罗宾，结局我猜还会牵扯到政府。'}]};
    if(input.startsWith('你是夏夏群聊动漫成品终检器')){groupFinal=true;return{verdict:'pass',issues:[]};}
    return groupDraft;
  });
  assert.ok(groupFinal);
  report.checks.push('Group generation/review share frozen selected references, do not copy them to another member, and recheck edited Xia text.');

  renameSync(libraryFile,libraryFile+'.missing');
  try {
    let calls=0;
    await assert.rejects(generate(runtime.root,prompt(current),{characterId:'xia-xia',runRaw:async()=>{calls++;throw Error('Unexpected model stage');}}),error=>error.code==='MODULE_MISSING');
    assert.equal(calls,0);
    assert.ok(loadDialogueSkill(runtime.root,'你是何嘉伟','he-jiawei'));
  }finally{renameSync(libraryFile+'.missing',libraryFile);}
  report.checks.push('Missing personal library fails before any model stage; other characters still load normally.');
  report.coverage={works:library.works.length,sources:library.sources.length,jp:library.works.filter(work=>work.origin==='jp').length,cn:library.works.filter(work=>work.origin==='cn').length};
  writeFileSync('output/xia-anime-knowledge-20261020/pipeline-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,...report.coverage,checks:report.checks.length}));
} finally {runtime.cleanup();}
