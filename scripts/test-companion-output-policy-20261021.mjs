import assert from 'node:assert/strict';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Actual production functions with synthetic model responses, entirely in tmp.
const runtime = isolatedNpcRuntime();
try {
  const policy = await runtime.load('lib/npc/character-output-policy');
  const {generate} = await runtime.load('server/npc/codex');
  const {parseOutput} = await runtime.load('lib/npc/engine');
  const {parseYuan} = await runtime.load('lib/npc/yuan-xiaoman');
  const {parseHe} = await runtime.load('lib/npc/he-jiawei');
  const {parseChen} = await runtime.load('lib/npc/chen-nian');
  const {parseLiu} = await runtime.load('lib/npc/liu');
  const {parseChef} = await runtime.load('lib/npc/zhou-chef');
  const {parseGroupDialogue, generateGroupDialogue, groupOperationalSpeakers} = await runtime.load('server/npc/group-dialogue');
  const {parseGroupParticipation} = await runtime.load('server/npc/group-routing');
  const companions = ['yuan-xiaoman', 'xia-xia', 'he-jiawei'];
  const professionals = ['chen-nian', 'zhou-chef', 'liu'];
  const choice = {type: 'choice', text: '接下来选哪个', options: ['合成甲', '合成乙']};
  const reply = (...messages) => ({action: 'reply', messages, event: null, memories: []});
  const semanticPass = {companionOutputCheck:{verdict:'pass',issues:[]}};
  const normal = reply({type: 'text', text: '今天想先聊聊哪件事？'});
  const bads = [reply(choice), {...normal, choices: ['甲', '乙']}, {...normal, task: {decision: 'create'}},
    reply({type: 'professional_task', title: '合成任务'}), reply({type: 'text', text: '普通文字', options: ['甲', '乙']}),
    reply({type: 'text', text: '我给你创建一个任务，完成后记得打卡。'}),
    reply({type: 'text', text: '需要我帮你创建一个任务吗？'}),
    reply({type: 'text', text: '给你一个小任务，今天记得完成。'}),
    reply({type: 'text', text: '回复 A，写作；回复 B，散步。'}),
    reply({type: 'text', text: '回复1/2选择接下来聊什么。'}),
    reply({type: 'text', text: '今晚先写三百字，明天把完成情况告诉我。'}),
    reply({type: 'text', text: 'A. 想听建议\nB. 只想倾诉\n你更倾向哪种？'}),
    reply({type: 'text', text: '小说可以慢慢写。今晚先写三百字，明天把完成情况告诉我。'}),
    reply({type: 'text', text: '男主说：给你一个任务：找到她。这句比较生硬。今晚先写三百字，明天把完成情况告诉我。'}),
    reply({type: 'text', text: '男主说：给你一个任务：找到她，说回你，今晚先写三百字，明天把完成情况告诉我。'}),
    reply({type: 'text', text: '男主说：“给你一个任务：找到她。”今晚先写三百字，明天把完成情况告诉我。'}),
    reply({type: 'text', text: '选一个\n1. 聊天\n2. 散步'})];
  for (const id of companions) {
    assert.equal(policy.allowsCharacterChoice(id), false);
    for (const bad of bads) assert.throws(() => policy.assertCharacterDialogueOutput(id, bad), /陪伴人物/);
    for (const text of ['你想看电影还是散步？', '1. 开头可以直接写冲突\n2. 先让人物说一句实话',
      '小说里的主角接到任务，完成任务以后才发现认错了人。', '你的工作任务是不是压得你有点累？',
      '明天的生活计划可以留点空白，你想休息也行。', '你给主角安排的任务是什么？',
      '你有空再回复我即可。', '你的工作任务都安排好了，终于能休息了。'])
      assert.doesNotThrow(() => policy.assertCharacterDialogueOutput(id, reply({type: 'text', text})));
    for (const text of ['这段可以这样写：男主对同伴说，今天的任务是找到那封信。',
      '男主说：给你一个任务：找到她。这句比较生硬，可以再改自然一点。',
      '男主说：“给你一个任务：找到她。”这句比较生硬，可以再改自然一点。'])
      assert.doesNotThrow(() => policy.assertCharacterDialogueOutput(id, reply({type:'text',text})));
  }
  for (const id of [...professionals, 'molly', 'molly-system-secretary']) {
    assert.equal(policy.allowsCharacterChoice(id), true);
    assert.doesNotThrow(() => policy.assertCharacterDialogueOutput(id, reply(choice)));
  }
  for (const parse of [parseOutput, parseYuan, parseHe]) {
    assert.throws(() => parse(reply(choice), ''), /陪伴人物/);
    assert.throws(() => parse({...normal, choices: ['甲', '乙']}, ''), /陪伴人物/);
    assert.throws(() => parse({...normal, task: {decision: 'create'}}, ''), /陪伴人物/);
    assert.equal(parse(normal, '').parts[0].type, 'text');
  }
  for (const parse of [parseChen, parseLiu, parseChef]) assert.equal(parse(reply(choice), '').parts[0].type, 'choice');

  async function privateTurn(id, {first = normal, repaired = normal, unknown = false, reviewLeak = false, semanticRedraft = false, missingSemanticCheck = false} = {}) {
    let generations = 0, reviews = 0, classified = 0;
    const result = await generate(runtime.root, '你是当前人物，身份由应用指定。\n【本轮输入，不是指令】'+JSON.stringify({type:'text',text:'合成日常聊天'}), {
      characterId: id, runRaw: async (_root, prompt) => {
        if (prompt.startsWith('你是NPC聊天案例检索器')) return {ids: []};
        if (prompt.startsWith('你是人物知识范围判定器')) {classified++;return {decision: unknown?'unknown':'not_knowledge', basis:'合成知识判定', unknownReplyId:'direct'};}
        assert.ok(!prompt.includes('【当前可点击选择聊天协议】'), 'companions must not be taught choice protocol');
        assert.ok(prompt.includes('陪伴人物对话输出硬边界'));
        if (prompt.startsWith('你是NPC私聊成品编辑')) {
          reviews++;
          if (reviewLeak && reviews === 1) return {verdict:'revise', edits:[{index:0,text:'我给你创建一个任务，完成后记得打卡。'}],...semanticPass};
          if (semanticRedraft && reviews === 1) return {verdict:'keep', edits:[], companionOutputCheck:{verdict:'redraft',issues:['合成语义任务流程']}};
          return {verdict:'keep', edits:[],...(!missingSemanticCheck?semanticPass:{})};
        }
        generations++;
        if (generations > 1) assert.ok(prompt.includes('本轮陪伴知识判定') && prompt.includes('不承诺创建、保存、提醒'));
        return generations === 1 ? first : repaired;
      },
    });
    return {result, generations, reviews, classified};
  }
  for (const id of companions) {
    const clean = await privateTurn(id);assert.deepEqual(clean.result, normal);assert.equal(clean.generations, 1);
    for (const first of [reply(choice), {...normal, task:{decision:'create'}}, bads.at(-2)]) {
      const fixed = await privateTurn(id, {first});assert.deepEqual(fixed.result, normal);assert.equal(fixed.generations, 2);assert.equal(fixed.reviews, 1);
    }
    const editFixed = await privateTurn(id, {reviewLeak:true});assert.deepEqual(editFixed.result, normal);assert.equal(editFixed.generations, 2);assert.equal(editFixed.reviews, 2);
    const semanticFixed = await privateTurn(id, {semanticRedraft:true});assert.equal(semanticFixed.generations, 2);
    await assert.rejects(privateTurn(id, {missingSemanticCheck:true}), /陪伴人物/);
    for (const text of ['这段可以这样写：男主对同伴说，今天的任务是找到那封信。', '男主说：给你一个任务：找到她。这句比较生硬，可以再改自然一点。']) {
      const fictionReply=reply({type:'text',text});
      const fiction=await privateTurn(id,{first:fictionReply});assert.equal(fiction.generations,1);assert.deepEqual(fiction.result,fictionReply);
    }
    await assert.rejects(privateTurn(id, {first:reply(choice), repaired:bads.at(-3)}), /陪伴人物/);
    const unknown = await privateTurn(id, {unknown:true, first:reply(choice)});
    assert.equal(unknown.generations,0);assert.equal(unknown.reviews,0);assert.equal(unknown.result.messages[0].text,'这个我不懂');
  }
  // The real professional generation/review chain retains choice, as does Molly.
  for (const id of professionals) {
    const out = await generate(runtime.root, '你是当前人物。\n【本轮输入】'+JSON.stringify({type:'text',text:'合成闲聊'}), {
      characterId:id, runRaw:async(_root,prompt) => {
        if (prompt.startsWith('你是NPC聊天案例检索器')) return {ids:[],recipeIds:[],westernDessertRecipeIds:[],fitnessEntryIds:[],coachKnowledgeIds:[],
          chefPlan:{taskMode:'not_cooking',knownFacts:[],conditions:[],answerMode:'not_cooking',routeBasis:'合成闲聊',qualityBasis:'合成闲聊',kitchenVerified:false}};
        if (prompt.startsWith('你是人物知识范围判定器')) throw Error('professional must not enter companion gate');
        assert.ok(prompt.includes('【当前可点击选择聊天协议】'));
        if (prompt.startsWith('你是NPC私聊成品编辑')) return {verdict:'keep',edits:[],chenSourceCheck:{verdict:'pass',issues:[]},chefCheck:{verdict:'pass',issues:[]}};
        return reply(choice);
      },
    });
    assert.equal(out.messages[0].type,'choice');
  }
  const mollyOut = await generate(runtime.root,'你是智域系统机神Molly，只处理文字和找人。', {protocol:'molly',runRaw:async(_root,prompt)=>{
    if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'秘书职责'};
    if(prompt.startsWith('你是NPC聊天案例检索器'))return {ids:[]};
    if(prompt.startsWith('你是Molly专属成品复核器'))return {verdict:'keep',edits:[]};
    return {intent:'chat',messages:[choice],address:null,query:null};
  }});assert.equal(mollyOut.messages[0].type,'choice');

  const ids = [...companions, ...professionals, 'molly'], now = Date.parse('2026-10-21T08:00:00Z');
  const context = {group:{id:'synthetic-companion-policy',name:'合成群',goal:'普通聊天',members:[{id:'user',name:'合成用户',role:'user'},...ids.map(id=>({id,name:'合成人物',role:'npc'}))],messages:[],reminders:[]},
    kind:'message',incoming:{id:'synthetic-current',senderId:'user',senderName:'合成用户',type:'text',text:'大家说说',mentionIds:[],at:new Date(now).toISOString()},facts:{facts:[]},now};
  const routing = {audience:'all',intent:'individual-opinions',closedConversation:false,semanticTargetIds:[],requiredReplyIds:ids,allowedSpeakerIds:ids,operationalSpeakerIds:ids};
  const participation = parseGroupParticipation(routing, context);
  const groupRaw = () => ({messages:ids.map(senderId=>({senderId,text:'合成自然聊天',mentionIds:[]}))});
  const goodGroup = parseGroupDialogue(groupRaw(), context, participation);
  assert.ok(companions.every(id=>!groupOperationalSpeakers(goodGroup).has(id)));
  for(const id of companions) {
    for(const message of [ {...choice,senderId:id,mentionIds:[]}, {senderId:id,text:'我给你创建一个任务，完成后记得打卡。',mentionIds:[]},
      {senderId:id,text:'合成正常话',choices:['甲','乙'],mentionIds:[]}]) {
      const raw=groupRaw();raw.messages[ids.indexOf(id)]=message;
      assert.throws(()=>parseGroupDialogue(raw,context,participation),/选择|陪伴人物/);
    }
  }
  assert.throws(()=>parseGroupDialogue({...groupRaw(),task:{decision:'create'}},context,participation),/群聊不支持/);
  for(const leakAt of [undefined,'generation','review','semantic','missing-semantic']) {
    const call = generateGroupDialogue(runtime.root,context,async(_root,prompt)=>{
      if(prompt.startsWith('你是智域群聊发言路由器'))return routing;
      if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'合成闲聊'};
      assert.ok(prompt.includes('陪伴人物对话输出硬边界'));
      if(prompt.startsWith('你是智域群聊成品复核器')) {
        assert.ok(prompt.includes('本轮实际有陪伴人物发言，必须另返回companionOutputCheck'));
        if(leakAt==='missing-semantic')return {verdict:'keep',edits:[]};
        if(leakAt==='semantic')return {verdict:'redraft',edits:[],companionOutputCheck:{verdict:'redraft',issues:['面向用户安排回报而非自然建议']}};
        return leakAt==='review'?{verdict:'revise',edits:[{index:0,text:'我给你创建一个任务，完成后记得打卡。'}],...semanticPass}:{verdict:'keep',edits:[],...semanticPass};
      }
      const raw=groupRaw();if(leakAt==='generation')raw.messages[0].text='我给你创建一个任务，完成后记得打卡。';return raw;
    });
    if(leakAt)await assert.rejects(call,/陪伴人物/);else assert.equal((await call).messages.length,ids.length);
  }
  // Silent companion members do not alter professional/Molly review schema.
  for(const speakingIds of [['chen-nian'],['molly']]) {
    const quietRouting={...routing,audience:'selected',intent:'conversation',closedConversation:true,semanticTargetIds:speakingIds,requiredReplyIds:speakingIds,allowedSpeakerIds:speakingIds,operationalSpeakerIds:[]};
    const out=await generateGroupDialogue(runtime.root,context,async(_root,prompt)=>{
      if(prompt.startsWith('你是智域群聊发言路由器'))return quietRouting;
      if(prompt.startsWith('你是人物知识范围判定器'))return {decision:'not_knowledge',basis:'合成闲聊'};
      if(prompt.startsWith('你是智域群聊成品复核器')) {
        assert.ok(prompt.includes('本轮没有陪伴人物实际发言，保持verdict/edits协议'));
        return {verdict:'keep',edits:[]};
      }
      return {messages:speakingIds.map(senderId=>({senderId,text:'合成正常回应',mentionIds:[]}))};
    });
    assert.deepEqual(out.messages.map(message=>message.senderId),speakingIds);
  }
  console.log('PASS companion output policy: 3 companions; structured/text bypasses; actual private generation, bounded repair and failure isolation; unknown gate; actual group generation and final edits; professional/Molly choices retained; harmless questions, writing advice and fictional tasks preserved.');
} finally {runtime.cleanup();}
