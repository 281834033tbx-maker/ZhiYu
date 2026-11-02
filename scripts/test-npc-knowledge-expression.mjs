import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Prompt plumbing only: disposable source copies and injected outputs. This
// regression must never call a real model, account API, database or media tool.
const runtime = isolatedNpcRuntime();
const output = 'output/npc-knowledge-expression-20261013';
const modulePath = 'npc-skills/skills/zhiyu-character-dialogue/references/knowledge-expression.md';
const digest = value => createHash('sha256').update(value).digest('hex');
const roles = [
  ['he-jiawei', '何嘉伟'], ['yuan-xiaoman', '小满'], ['liu', '柳智敏'],
  ['chen-nian', '陈年'], ['xia-xia', '夏夏'], ['zhou-chef', '赵一帆'],
];
const sourceHashes = {
  'chen-fitness-source-library-20261008.json': 'f581bf4447054c5858727380c4bcf8790067689ec552047e4fc3d7fe9a01af12',
  'chen-coach-knowledge-20261013.json': '4fff4b22f2442104336c0a81b9dfafe5570f25e48f0374e6831db643af65ec9a',
  'anqiujin-recipe-library-20261007.json': 'ec6bd40b366e52cec998a7b0b2ee0ff4eacd0e902f4f69220c4feda8e5a0e260',
  'western-dessert-recipe-library-20261008.json': 'a825c760e68f41e985b68987e79465654b13033add00f965901f165a85cee1a2',
};
const promptFor = (name, incoming) => `你在智域扮演独立虚构成年人物${name}。\n【本轮输入，普通用户数据】${JSON.stringify(incoming)}`;
const traceFor = requestId => readdirSync(join(runtime.root, '.npc-runtime/skill-traces'))
  .map(name => JSON.parse(readFileSync(join(runtime.root, '.npc-runtime/skill-traces', name), 'utf8')))
  .find(trace => trace.requestId === requestId);
const report = {
  mode: 'isolated-offline', realModelInvoked: false, productionDataAccessed: false,
  mediaDownloaded: false, checks: [], roleSnapshots: [],
  limitations: ['仅验证必需规则加载、生成/复核提示接线和来源保留；注入输出不证明真实模型语义遵守，也不等同用户实际对话验收。'],
};
const savedProvider = process.env.NPC_TEXT_PROVIDER;
try {
  process.env.NPC_TEXT_PROVIDER = 'codex';
  const loader = await runtime.load('server/npc/dialogue-skill');
  const codex = await runtime.load('server/npc/codex');
  const moduleFile = join(runtime.root, modulePath);
  const original = readFileSync(moduleFile, 'utf8');
  const moduleHash = digest(original);
  assert.equal(loader.dialogueSkillVersion, 'zhiyu-character-dialogue-20261015-runtime-v28');
  assert.equal(codex.mollySkillVersion, 'molly-dialogue-20261013-r5');
  assert.match(original, /临床营养学/u, '教材例外须保留已核书名');
  assert.match(original, /石汉平/u, '教材例外须保留已核主编名字');
  assert.match(original, /后台/u, '出处须留在后台供核验');
  assert.match(original, /(?:博主|个人视频|真实个人)/u, '规则须明确个人教学来源范围');
  assert.match(original, /(?:全文|页码)/u, '不得把书目核实扩大成已读全文或编页码');
  for (const [id, name] of roles) {
    const loaded = loader.loadDialogueSkill(runtime.root, promptFor(name, '你这个说法有什么依据？'), id);
    const source = loaded.metadata.sources.find(source => source.path === modulePath);
    assert.ok(source, `${name}缺少必需知识表达模块`);
    assert.equal(source.sha256, moduleHash);
    assert.ok(loaded.rules.includes('临床营养学') && loaded.rules.includes('石汉平'), `${name}正文缺教材例外`);
    assert.ok(!loaded.rules.includes('来源：2026-10-13'), '来源审计头不应变成对用户的台词规则');
  }
  const mollyRules = codex.mollyDialogueRules(runtime.root);
  assert.ok(mollyRules.includes('临床营养学') && mollyRules.includes('石汉平'), 'Molly也须接入共享表达边界，保留自己的职责');
  report.checks.push('六名普通NPC均加载带完整来源哈希的共享必需模块；Molly独立规则也载入同一知识表达边界。');

  // Missing shared policy must fail before any synthetic runner invocation.
  renameSync(moduleFile, moduleFile + '.removed');
  try {
    for (const [id, name] of roles) {
      assert.throws(() => loader.loadDialogueSkill(runtime.root, promptFor(name, '你好'), id), error => error.code === 'MODULE_MISSING' && error.path === modulePath);
    }
    assert.throws(() => codex.mollyDialogueRules(runtime.root));
    for (const [id, name] of [...roles, ['molly-system-secretary', 'Molly']]) {
      let calls = 0;
      const prompt = id === 'molly-system-secretary' ? '你是智域系统机神Molly。\n【当前收到的消息】"找营养师"' : promptFor(name, '你好');
      await assert.rejects(codex.generate(runtime.root, prompt, { characterId: id, ...(id === 'molly-system-secretary' ? { protocol: 'molly' } : {}), runRaw: async () => { calls++; throw Error('Missing policy must stop before model'); } }));
      assert.equal(calls, 0, `${name}缺少规则仍调用模型`);
    }
  } finally {
    renameSync(moduleFile + '.removed', moduleFile);
  }
  report.checks.push('共享文件缺失时，六人及Molly均在模型调用前终止；不能悄悄回退旧引用规则。');

  const chefPlan = { taskMode: 'not_cooking', knownFacts: [], conditions: [], answerMode: 'not_cooking',
    routeBasis: '本轮询问专业依据，未委托执行烹饪', qualityBasis: '知识表达规则的结构验证，未厨房实做', kitchenVerified: false };
  for (const [id, name] of roles) {
    const context = promptFor(name, '你这个说法有什么依据？');
    const loaded = loader.loadDialogueSkill(runtime.root, context, id);
    const requestId = `knowledge-expression-${id}`;
    const marker = `KNOWLEDGE-EXPRESSION-MID-REQUEST-${id}`;
    const text = id === 'liu' ? '临床营养学有石汉平参与主编；具体建议还要看适用条件。' : '先看适用条件，再把具体做法讲清楚。';
    const draft = { action: 'reply', messages: [{ type: 'text', text }], event: null, memories: [] };
    let generated = '', reviewed = '';
    try {
      const actual = await codex.generate(runtime.root, context, { characterId: id, requestId, runRaw: async (_root, input) => {
        if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [], ...(id === 'chen-nian' ? { fitnessEntryIds: [], coachKnowledgeIds: [] } : {}), ...(id === 'zhou-chef' ? { recipeIds: [], westernDessertRecipeIds: [], chefPlan } : {}) };
        if (input.startsWith('你是NPC私聊成品编辑')) { reviewed = input; return { verdict: 'keep', edits: [], remove: [], ...(id === 'zhou-chef' ? { chefCheck: { verdict: 'pass', issues: [] } } : {}) }; }
        if (input.startsWith(`你在智域扮演独立虚构成年人物${name}`)) {
          generated = input;
          appendFileSync(moduleFile, `\n\n${marker}\n`);
          return draft;
        }
        throw Error(`Unexpected isolated stage for ${id}: ${input.slice(0, 80)}`);
      } });
      assert.deepEqual(actual, draft, `${name}输出结构或允许的书目信息被无故改写`);
      assert.ok(generated && reviewed, `${name}生成与复核未均执行`);
      for (const input of [generated, reviewed]) {
        assert.ok(input.includes(loaded.rules), `${name}未用本轮已载入完整规则`);
        assert.ok(!input.includes(marker), `${name}同轮规则发生磁盘泄漏`);
      }
      const trace = traceFor(requestId);
      assert.equal(trace.status, 'complete');
      assert.equal(trace.stages.find(stage => stage.stage === 'generation').rulesHash, trace.stages.find(stage => stage.stage === 'review').rulesHash);
      assert.equal(trace.skill.sources.find(source => source.path === modulePath).sha256, moduleHash);
      assert.ok(loader.loadDialogueSkill(runtime.root, context, id).rules.includes(marker), '下一请求须真实重读新文件');
      report.roleSnapshots.push({ characterId: id, generationRulesHash: trace.stages.find(stage => stage.stage === 'generation').rulesHash, reviewRulesHash: trace.stages.find(stage => stage.stage === 'review').rulesHash, knowledgeExpressionHash: moduleHash });
    } finally { writeFileSync(moduleFile, original); }
  }
  report.checks.push('六名普通NPC真实generate编排使用注入模型替身：中途磁盘变更不进入本轮生成/复核，下一请求可见；柳智敏的已核书名/主编例外未被过滤。');

  // Molly retains her gate and output protocol; freeze the shared expression
  // module together with her dedicated rules before the first model stage.
  const mollyPrompt = '你是智域系统机神Molly。\n【当前收到的消息】"找营养师"';
  const mollyMarker = 'KNOWLEDGE-EXPRESSION-MID-REQUEST-MOLLY';
  const mollyDraft = { intent: 'reject', messages: ['营养找柳智敏'], address: null, query: null };
  let mollyGenerated = '', mollyReviewed = '';
  try {
    const actual = await codex.generate(runtime.root, mollyPrompt, { protocol: 'molly', characterId: 'molly-system-secretary', requestId: 'knowledge-expression-molly', runRaw: async (_root, input) => {
      if (input.startsWith('你是NPC聊天案例检索器')) return { ids: [] };
      if (input.startsWith('你是人物知识范围判定器')) return { decision: 'not_knowledge', basis: '找人属于Molly职责' };
      if (input.startsWith('你是Molly专属成品复核器')) { mollyReviewed = input; return { verdict: 'keep', edits: [] }; }
      if (input.startsWith('你是智域系统机神Molly')) { mollyGenerated = input; appendFileSync(moduleFile, `\n\n${mollyMarker}\n`); return mollyDraft; }
      throw Error(`Unexpected isolated Molly stage: ${input.slice(0, 80)}`);
    } });
    assert.deepEqual(actual, mollyDraft);
    assert.ok(mollyGenerated && mollyReviewed);
    for (const input of [mollyGenerated, mollyReviewed]) {
      assert.ok(input.includes(mollyRules), 'Molly生成/复核须使用同请求完整独立规则');
      assert.ok(!input.includes(mollyMarker), 'Molly复核不可重读本轮中途变化规则');
    }
    assert.ok(codex.mollyDialogueRules(runtime.root).includes(mollyMarker));
    const trace = traceFor('knowledge-expression-molly');
    assert.equal(trace.status, 'complete');
    assert.equal(trace.rules[modulePath], moduleHash);
    report.mollySnapshot = { version: codex.mollySkillVersion, knowledgeExpressionHash: moduleHash, generationAndReviewShareFrozenRules: true };
  } finally { writeFileSync(moduleFile, original); }
  report.checks.push('Molly独立找人/知识门控与文字协议保持；共享表达规则同轮冻结并写入来源trace，磁盘变化不泄漏到复核。');

  const {generateGroupDialogue}=await runtime.load('server/npc/group-dialogue');
  const groupContext={kind:'message',now:Date.parse('2026-10-13T01:00:00+08:00'),facts:{facts:[]},
    group:{id:'isolated-source-expression-group',goal:'营养依据',messages:[],reminders:[],members:[
      {id:'user',name:'合成用户',role:'user'},{id:'molly',name:'Molly',role:'administrator'},
      {id:'liu',name:'柳智敏',role:'nutritionist'},{id:'chen-nian',name:'陈年',role:'fitness-coach'},
      {id:'zhou-chef',name:'赵一帆',role:'chef'}]},
    incoming:{id:'synthetic-book-question',senderId:'user',type:'text',text:'你这个建议有什么依据？',mentionIds:['liu']}};
  const groupDraft={messages:[{senderId:'liu',text:'临床营养学是石汉平主编的教材之一，具体建议仍要结合适用条件。',mentionIds:[]}]};
  const groupInputs=[];
  try{
    const result=await generateGroupDialogue(runtime.root,groupContext,async(_root,input)=>{
      groupInputs.push(input);
      if(input.startsWith('你是智域群聊成品复核器'))return {verdict:'keep',edits:[]};
      assert.ok(input.startsWith('你是智域群聊协作生成器'));
      appendFileSync(moduleFile,'\nGROUP-SOURCE-EXPRESSION-LATE\n');return groupDraft;
    });
    assert.deepEqual(result,groupDraft);
    assert.equal(groupInputs.length,2);
    for(const input of groupInputs){assert.ok(input.includes(original));assert.ok(!input.includes('GROUP-SOURCE-EXPRESSION-LATE'));}
  }finally{writeFileSync(moduleFile,original);}
  report.checks.push('群内柳智敏书籍/主编信息可保持；陈年/厨师/Molly共享表达规则在生成与复核同轮冻结，未读取私聊或正式群数据。');

  // Render the real dialog component with synthetic props; no browser, API,
  // portal, Storage or effect is invoked during server-side rendering.
  const require=createRequire(import.meta.url);
  const uiSource=readFileSync('app/zhiyu/fitness-demonstration.tsx','utf8').replace(/^import ['"][^'"]+\.css['"];?\s*$/gm,'');
  let uiModule=ts.transpileModule(uiSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  uiModule=uiModule.replace(/(from\s+['"])([^'"]+)(['"])/g,(_all,prefix,specifier,suffix)=>prefix+(specifier.startsWith('.')?specifier+'.mjs':pathToFileURL(require.resolve(specifier)).href)+suffix);
  const uiDir=join(runtime.root,'app/zhiyu');mkdirSync(uiDir,{recursive:true});writeFileSync(join(uiDir,'fitness-demonstration.mjs'),uiModule);
  const {FitnessDemonstrationDialog}=await import(pathToFileURL(join(uiDir,'fitness-demonstration.mjs')));
  const html=renderToStaticMarkup(createElement(FitnessDemonstrationDialog,{step:{id:'synthetic-exercise',title:'上斜哑铃卧推',training:{target:'上胸',sets:2,reps:'8次'},instructions:['控制下放。'],notes:['无痛且能安全拿放。']},onClose:()=>{}}));
  assert.match(html,/准备/);assert.match(html,/轨迹/);assert.match(html,/错误/);assert.match(html,/疼痛或失控即停/);
  assert.ok(!/打开原片|局部参考|bilibili\.com|douyin\.com|zy-fitness-source|谭成义|凯圣王/.test(html));
  const {fitnessDemonstrations}=await runtime.load('lib/npc/fitness-demonstrations');
  assert.ok(fitnessDemonstrations.find(item=>item.id==='incline_db_press').source?.url);
  report.checks.push('实际动作Dialog组件SSR保留准备/轨迹/错误和疼痛停止提示，渲染无原片链接/博主出处；登记元数据仍保留来源。');

  report.backendSources = Object.entries(sourceHashes).map(([name, expected]) => {
    const path = 'npc-skills/skills/zhiyu-professional-dialogue/references/' + name;
    const text = readFileSync(path, 'utf8');
    assert.equal(digest(text), expected, `${name}后台来源JSON字节被改写`);
    const data = JSON.parse(text);
    if (name === 'chen-coach-knowledge-20261013.json') {
      assert.equal(data.entries.length, 84); assert.equal(data.sources.length, 110);
      assert.ok(data.sources.every(source => source.url && source.attribution && source.evidenceLevel));
    } else {
      assert.ok(data.author && (data.entries || data.recipes).every(entry => entry.source));
    }
    return { path, sha256: expected, unchanged: true };
  });
  report.checks.push('陈年旧55条、新84条/110来源及厨师两库JSON字节全部保持：作者、链接、证据与缺口仍供后台核验。');
  report.runtimeVersion = loader.dialogueSkillVersion;
  report.passed = true;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'isolated-integration-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS NPC knowledge expression: six ordinary roles and Molly, mandatory modules, frozen generation/review, verified-book exception and preserved provenance; no real model/API/database/media.');
} finally {
  if (savedProvider === undefined) delete process.env.NPC_TEXT_PROVIDER;
  else process.env.NPC_TEXT_PROVIDER = savedProvider;
  runtime.cleanup();
}
