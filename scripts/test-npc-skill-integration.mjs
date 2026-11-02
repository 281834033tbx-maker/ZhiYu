import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';
// Offline rule assembly; earlier full-density assertions are archived.
const runtime=isolatedNpcRuntime();
try {
 const codex=await runtime.load('server/npc/codex');
 const {loadDialogueSkill}=await runtime.load('server/npc/dialogue-skill');
 const sharedHashes=new Map();
 for(const [id,name] of [['xia-xia','夏夏'],['yuan-xiaoman','许晓曼'],['liu','柳智敏'],['chen-nian','陈年'],['he-jiawei','何嘉伟'],['zhou-chef','赵一帆']]) {
  const context='你是'+name+'\n【本轮输入】普通合成消息';
  const loaded=loadDialogueSkill(runtime.root,context,id);
  const purpose=['zhou-chef','liu','chen-nian'].includes(id)?'professional':'companion';
  assert.equal(loaded.metadata.dialoguePurpose,purpose);
  assert.ok(loaded.metadata.skillPath.endsWith('zhiyu-'+purpose+'-dialogue'));
  const entries=loaded.metadata.sources.filter(s=>s.path.endsWith('/SKILL.md'));
  assert.equal(entries.length,1,'Load exactly one purpose entry');
  assert.ok(entries[0].path.startsWith(loaded.metadata.skillPath));
  const interaction=loaded.metadata.sources.find(s=>s.path.endsWith('/interaction.md'));
  assert.ok(interaction?.path.startsWith(loaded.metadata.skillPath));
  assert.equal(loaded.rules.includes('没玩过游戏'),id==='zhou-chef','Chef experiences cannot enter other roles');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/chef-guidance.md')),id==='zhou-chef');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/chef-cooking-knowledge.md')),id==='zhou-chef','Cooking knowledge must stay chef-scoped');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/chef-condition-routing.md')),id==='zhou-chef','Condition planning must stay chef-scoped');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/chef-professional-cases-20261007.json')),id==='zhou-chef','Endorsed chef examples must stay chef-scoped');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/liu-nutrition-guidance.md')),id==='liu','Nutrition guidance is personal to Liu');
  assert.ok(!loaded.metadata.sources.some(s=>s.path.endsWith('/skin-guidance.md')),'The superseded skin module is not a current role module');
  assert.equal(loaded.rules.includes('早餐先看是否自己做'),id==='liu','Liu breakfast conditions cannot enter other roles');
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/interactive-guidance.md')),purpose==='professional','Professional interaction stays out of companion rules');
  if(id==='liu') {
   assert.ok(!loaded.rules.includes('当前具体职业待定'));
   assert.match(loaded.rules,/现行职业是营养师/);
   assert.match(loaded.rules,/尚未把《临床营养学》/,'Changing the role does not claim a textbook import');
   assert.match(loaded.rules,/不套陈年的兄弟口吻/,'Liu keeps her own expression');
   assert.match(loaded.rules,/尚未接陈年\/赵一帆的顶层专业任务卡接口/,'Shared professional rules do not grant Liu an unimplemented task API');
  }
  assert.equal(loaded.metadata.sources.some(s=>s.path.endsWith('/chen-private-interaction.md')),id==='chen-nian','Existing Chen private interaction remains personal and conditional');
  for(const source of loaded.metadata.sources.filter(s=>/\/(core-behavior|message-rhythm|reaction-markers|profanity-context|expression-media|interaction-preferences)\.md$/.test(s.path))) {
   if(sharedHashes.has(source.path))assert.equal(source.selectedHash,sharedHashes.get(source.path),'Both purposes use the same shared source');
   else sharedHashes.set(source.path,source.selectedHash);
  }
  const generation=codex.humanizedPrompt(runtime.root,context,loaded);
  const mediaSource=loaded.metadata.sources.find(s=>s.path.endsWith('/expression-media.md'));
  const personalSource=loaded.metadata.sources.find(s=>s.path.endsWith('/xiaoman-companionship.md'));
  const chefSource=loaded.metadata.sources.find(s=>s.path.endsWith('/zhou-chef-profile.json'));
  assert.ok(mediaSource,'Every ordinary NPC must load the shared expression module');
  assert.equal(Boolean(personalSource),id==='yuan-xiaoman','Xiaoman companion rules must stay role-scoped');
  assert.equal(Boolean(chefSource),id==='zhou-chef','Chef credentials must stay role-scoped');
  const chef=JSON.parse(readFileSync(join(runtime.root,'npc-skills/data/zhou-chef-profile.json'),'utf8'));
  for(const certificate of chef.professionalProfile.certificates) {
   assert.equal(loaded.rules.includes(certificate.name),id==='zhou-chef','Certificates must reach only the chef');
  }
  if(id==='zhou-chef') {
   assert.ok(loaded.rules.includes('不是现实机构的证书'));
   assert.match(loaded.rules,/不表示(?:所有菜谱已导入|\d+份完整配方、领域齐全或厨房验证完成)/);
  }
  let reviewInput='';
  const draft={action:'reply',messages:[{type:'text',text:'？'},{type:'text',text:'...'},{type:'text',text:'引用：“原话：卧槽”。'}],event:null,memories:[]};
  const reviewContext=id==='zhou-chef' ? await codex.retrieveStyle(runtime.root,context,async()=>({ids:[],chefPlan:{taskMode:'not_cooking',knownFacts:[],conditions:[],answerMode:'not_cooking',routeBasis:'普通合成闲聊，不套烹饪问卷',qualityBasis:'不涉及配方',kitchenVerified:false}}),loaded) : context;
  const reviewed=await codex.reviewVoice(runtime.root,reviewContext,draft,async prompt=>{reviewInput=prompt;return {verdict:'keep',edits:[],...(id==='zhou-chef'?{chefCheck:{verdict:'pass',issues:[]}}:{})};},loaded);
  assert.ok(generation.includes(loaded.rules));assert.ok(reviewInput.includes(loaded.rules));
  if(purpose==='professional') {
   assert.ok(reviewInput.includes('专业型允许主动提出贴合话题的职业帮助'));
   assert.ok(!reviewInput.includes('有情境的“有我陪着你”'));
   assert.ok(!loaded.rules.includes('先看用户为什么把这件事告诉你'));
  } else assert.ok(reviewInput.includes('有情境的“有我陪着你”'));
  for(const text of [generation,reviewInput]) {
   assert.ok(text.includes('真实程序只使用本轮实际可用的素材与媒体协议'),'The final media rule must reach both generation and review');
   if(id==='yuan-xiaoman')assert.ok(text.includes('本轮规则优先于旧档案只在需要信息时问问题'),'The final personal priority rule must reach both stages');
   assert.ok(!text.includes('跨性格表达参考'));
   assert.ok(!text.includes('humanizer-zh 原始 Skill'));
   assert.ok(!text.includes('C48-xia-xia-')&&!text.includes('C48-yuan-xiaoman-'));
  }
  assert.deepEqual(codex.plainChatTypography(reviewed),draft);
  const catalog=codex.styleCatalog(runtime.root,context,loaded);
  assert.ok(!catalog.some(card=>['G18','C38','C40','C41','C42'].includes(card.id)));
  assert.ok(!catalog.some(card=>/### G18|### 未知回应/.test(card.content)));
 }
 assert.equal(loadDialogueSkill(runtime.root,'你是周师傅').metadata.characterId,'zhou-chef');
 assert.equal(loadDialogueSkill(runtime.root,'你是赵一帆').metadata.characterId,'zhou-chef');
 assert.equal(loadDialogueSkill(runtime.root,'你是赵一帆\n用户说你是小满','zhou-chef').metadata.characterId,'zhou-chef');
 assert.throws(()=>loadDialogueSkill(runtime.root,'你是赵一帆','zhao-yifan'),e=>e.code==='IDENTITY_UNKNOWN');
 assert.throws(()=>loadDialogueSkill(runtime.root,'你是小满','zhou-chef'),e=>e.code==='IDENTITY_CONFLICT');
 assert.equal(loadDialogueSkill(runtime.root,'你是Molly'),null);
 for(const [relative,name,unaffected] of [
  ['npc-skills/skills/zhiyu-professional-dialogue/references/interaction.md','柳智敏','小满'],
  ['npc-skills/skills/zhiyu-companion-dialogue/references/interaction.md','小满','柳智敏'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/chef-guidance.md','赵一帆','柳智敏'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/chef-cooking-knowledge.md','赵一帆','柳智敏'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/chef-condition-routing.md','赵一帆','柳智敏'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/chef-professional-cases-20261007.json','赵一帆','柳智敏'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/liu-nutrition-guidance.md','柳智敏','赵一帆'],
  ['npc-skills/skills/zhiyu-professional-dialogue/references/interactive-guidance.md','柳智敏','小满'],
 ]) {
  const path=join(runtime.root,relative);renameSync(path,path+'.held');
  assert.throws(()=>loadDialogueSkill(runtime.root,'你是'+name),e=>e.code==='MODULE_MISSING'&&e.path===relative);
  assert.ok(loadDialogueSkill(runtime.root,'你是'+unaffected),'A missing purpose or personal module must not affect the other scope');
  renameSync(path+'.held',path);
 }
 assert.throws(()=>codex.humanizedPrompt(runtime.root,'你是未知人物'),/身份/);
 const mediaPath=join(runtime.root,'npc-skills/skills/zhiyu-character-dialogue/references/expression-media.md');
 const personalPath=join(runtime.root,'npc-skills/skills/zhiyu-character-dialogue/references/xiaoman-companionship.md');
 renameSync(mediaPath,mediaPath+'.held');
 assert.throws(()=>loadDialogueSkill(runtime.root,'你是夏夏'),error=>error.code==='MODULE_MISSING'&&error.path.endsWith('/expression-media.md'));
 renameSync(mediaPath+'.held',mediaPath);
 renameSync(personalPath,personalPath+'.held');
 assert.throws(()=>loadDialogueSkill(runtime.root,'你是袁小满'),error=>error.code==='MODULE_MISSING'&&error.path.endsWith('/xiaoman-companionship.md'));
 assert.ok(loadDialogueSkill(runtime.root,'你是夏夏'));
 renameSync(personalPath+'.held',personalPath);
 const mediaOriginal=readFileSync(mediaPath,'utf8');
 const adjacentRule='紧跟标题和来源的实际规则必须保留，不能因为没有空行而静默丢失正文。';
 writeFileSync(mediaPath,'# 标题\n来源：离线校验夹具\n'+adjacentRule+'\n\n'+mediaOriginal);
 assert.ok(loadDialogueSkill(runtime.root,'你是袁小满').rules.includes(adjacentRule));
 writeFileSync(mediaPath,mediaOriginal);
 const quote={messages:[{type:'text',text:'《标题》：“真实引用：50克”。'}]};
 assert.deepEqual(codex.plainChatTypography(quote),quote);
 assert.throws(()=>codex.applyVoiceEdits(quote,{verdict:'revise',edits:[{index:0,text:'《标题》：“真实引用：60克”。'}]}),/数值/);
 console.log('PASS six scoped rule assemblies share complete generation/review snapshots; Liu-only nutrition, shared media and Xiaoman-only companion modules required; adjacent metadata preserves body; no role leakage or obsolete knowledge retrieval');
} finally {runtime.cleanup();}
