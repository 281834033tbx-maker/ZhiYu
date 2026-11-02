import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Only source, the new user-authored package, knowledge libraries and synthetic
// states are copied. No application runtime, database or model is opened.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'zhiyu-new-prompt-'));
const now=Date.parse('2026-11-02T03:00:00.000Z');
const entries=[
  ['xia-xia','prompt','buildPrompt','engine','createState'],
  ['chen-nian','chen-prompt','chenPrompt','chen-nian','createChen'],
  ['liu','liu-prompt','liuPrompt','liu','createLiu'],
  ['yuan-xiaoman','yuan-prompt','yuanPrompt','yuan-xiaoman','createYuan'],
  ['zhou-chef','zhou-chef-prompt','chefPrompt','zhou-chef','createChef'],
  ['he-jiawei','he-prompt','hePrompt','he-jiawei','createHe'],
];
// Frozen application-binding expectations only, not a second persona/rule source.
const preservedBindings={
  "chen-nian": {
    "id": "chen-nian",
    "age": 27,
    "gender": "男",
    "origin": "黑龙江",
    "avatar": "/npc/chen-nian/avatar-20260926.png",
    "services": [
      "fitness"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/chen-nian"
  },
  "liu": {
    "id": "liu",
    "age": 28,
    "gender": "女",
    "origin": "上海",
    "avatar": "/stitch/6ee1d45916762d31.jpg",
    "services": [
      "nutrition"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/liu"
  },
  "zhou-chef": {
    "id": "zhou-chef",
    "age": 32,
    "gender": "男",
    "origin": "河北",
    "avatar": "/desktop-npc/scenes/zhou-chef-night-sofa-20261005-v1.png",
    "services": [
      "cooking"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/zhou-chef"
  },
  "yuan-xiaoman": {
    "id": "yuan-xiaoman",
    "age": 26,
    "gender": "女",
    "origin": "湖南",
    "avatar": "/npc/yuan-xiaoman/avatar.png",
    "services": [
      "companionship"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/yuan-xiaoman"
  },
  "xia-xia": {
    "id": "xia-xia",
    "age": 23,
    "gender": "女",
    "origin": null,
    "avatar": "/npc/xia-xia/avatar.png",
    "services": [
      "companionship"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/xia-xia"
  },
  "he-jiawei": {
    "id": "he-jiawei",
    "age": 28,
    "gender": "男",
    "origin": "福建",
    "avatar": "/desktop-npc/scenes/he-jiawei-20260926.png",
    "services": [
      "companionship"
    ],
    "enabled": true,
    "chatEndpoint": "/api/npc/he-jiawei"
  }
};
const load=path=>import(pathToFileURL(join(temporary,path+'.mjs')));
const call=(id,builder,state)=>id==='xia-xia'?builder(temporary,state,'我不喜欢“然后呢”','reply'):id==='yuan-xiaoman'?builder(temporary,state,'我不喜欢“然后呢”','chat'):id==='liu'?builder(temporary,state,'我不喜欢“然后呢”',null,now):builder(temporary,state,'我不喜欢“然后呢”',now);
try {
  for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(join(project,folder)).filter(name=>name.endsWith('.ts')&&!name.endsWith('.test.ts'))) {
    const output=join(temporary,folder,name.replace(/\.ts$/,'.mjs'));
    mkdirSync(dirname(output),{recursive:true});
    const source=readFileSync(join(project,folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
    writeFileSync(output,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  for(const name of readdirSync(join(project,'lib/npc')).filter(name=>name.endsWith('.json')))
    writeFileSync(join(temporary,'lib/npc',name+'.mjs'),'export default '+readFileSync(join(project,'lib/npc',name),'utf8'));
  for(const relative of ['npc-skills/skills/zhiyu-dialogue','npc-skills/knowledge']) {
    mkdirSync(dirname(join(temporary,relative)),{recursive:true});
    cpSync(join(project,relative),join(temporary,relative),{recursive:true});
  }
  for(const id of entries.map(entry=>entry[0])) {
    const relative=`npc-skills/skills/zhiyu-dialogue/npcs/${id}/profile.json`;
    writeFileSync(join(temporary,relative+'.mjs'),'export default '+readFileSync(join(project,relative),'utf8'));
  }
  const certificatePath='npc-skills/data/zhou-chef-profile.json';
  mkdirSync(dirname(join(temporary,certificatePath)),{recursive:true});
  writeFileSync(join(temporary,certificatePath+'.mjs'),'export default '+readFileSync(join(project,certificatePath),'utf8'));
  mkdirSync(join(temporary,'app/zhiyu'),{recursive:true});
  writeFileSync(join(temporary,'app/zhiyu/professional-profiles.mjs'),ts.transpileModule(readFileSync(join(project,'app/zhiyu/professional-profiles.ts'),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  assert.equal(existsSync(join(temporary,'npc-skills/references')),false);
  const {loadDialogueSkill}=await load('server/npc/dialogue-skill');
  const directory=await load('lib/npc/character-directory');
  const boundary=await load('server/npc/companion-knowledge');
  const professionalProfiles=await load('app/zhiyu/professional-profiles');
  const results=[];
  for(const [id,promptModule,builderName,stateModule,factoryName] of entries) {
    const builder=(await load('server/npc/'+promptModule))[builderName];
    const factory=(await load('lib/npc/'+stateModule))[factoryName];
    const state=id==='xia-xia'?factory('normal'):factory(now);
    const userId='synthetic-user-'+id,turnId='synthetic-turn-'+id;
    state.messages.push({id:userId,turnId,role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'我不喜欢“然后呢”'}});
    state.queue?.push(turnId);
    state.memories.push({id:'synthetic-memory-'+id,text:'合成普通记忆',kind:'user_claim',evidence:'我不喜欢“然后呢”',messageId:userId,status:'model_proposed'});
    state.memories.push({id:'synthetic-preference-'+id,text:'不喜欢特定说法',kind:'user_claim',evidence:'我不喜欢“然后呢”',messageId:userId,status:'model_proposed',preference:{category:'wording',target:'然后呢',action:'avoid'}});
    const original=JSON.stringify({messages:state.messages,memories:state.memories,values:state.values,tasks:state.professionalTasks});
    const prompt=call(id,builder,state),snapshot=loadDialogueSkill(temporary,prompt,id);
    assert.ok(snapshot);
    assert.match(prompt,/稳定人物ID/);
    assert.ok(prompt.split('\n')[0].includes(snapshot.profile.name));
    assert.ok(prompt.includes(userId)&&prompt.includes('合成普通记忆'));
    assert.ok(prompt.includes('"target":"然后呢","action":"avoid"'),'account-specific wording preferences stay available');
    assert.equal(JSON.stringify({messages:state.messages,memories:state.memories,values:state.values,tasks:state.professionalTasks}),original,'prompt migration cannot reset user history, memory, values or tasks');
    const composed=prompt+'\n'+snapshot.rules;
    assert.equal(composed.split('【统一规则 01-说话立场.md】').length-1,1,'one new expression layer');
    assert.equal(composed.split('【当前人物资料】').length-1,1,'one complete new persona layer');
    assert.ok(snapshot.metadata.sources.every(source=>source.path.startsWith('npc-skills/skills/zhiyu-dialogue/')||source.path.startsWith('npc-skills/knowledge/')));
    assert.ok(!snapshot.metadata.sources.some(source=>/humanizer|zhiyu-character-dialogue|zhiyu-companion-dialogue|zhiyu-professional-dialogue|npc-skills\/references/.test(source.path)));
    assert.ok(!/common-rules\.md|accepted-examples\.json|corrections\.md|characters\/.+\.md|28岁|26岁|无业游民|深圳折返实验室|广州出生长大|湖南人|福建人|创业早期三人团队/.test(prompt),'old persona and expression are absent from generated prompt');
    const publicPerson=directory.getCharacter(id),baselinePerson=preservedBindings[id];
    assert.equal(publicPerson.name,snapshot.profile.name);assert.equal(publicPerson.realName,snapshot.profile.realName||snapshot.profile.name);
    assert.deepEqual(publicPerson.aliases,snapshot.profile.aliases||[]);
    assert.equal(publicPerson.occupation,snapshot.profile.identity.job);assert.equal(publicPerson.personality,snapshot.profile.traits.join('、'));
    assert.equal(publicPerson.role,snapshot.profile.mode);
    assert.equal(publicPerson.age,snapshot.profile.identity.age??baselinePerson.age);
    assert.equal(publicPerson.origin,snapshot.profile.identity.hometown||baselinePerson.origin);
    for(const field of ['id','avatar','enabled','chatEndpoint'])assert.equal(publicPerson[field],baselinePerson[field],'existing application binding '+field);
    assert.deepEqual(publicPerson.services,baselinePerson.services);
    if(snapshot.profile.mode==='professional') {
      const shown=professionalProfiles[id==='chen-nian'?'chenFitnessProfile':id==='liu'?'liuNutritionProfile':'chefCookingProfile'];
      assert.equal(shown.title,snapshot.profile.title);assert.deepEqual(shown.titles,[snapshot.profile.title]);
      assert.ok(shown.summary.includes(snapshot.profile.identity.job));
      assert.equal(boundary.hasCompanionKnowledgeBoundary(id),false);
    } else {
      assert.equal(boundary.hasCompanionKnowledgeBoundary(id),true);
      const classifier=boundary.companionKnowledgePrompt(id,snapshot.rules,{incoming:'合成问题'},[]);
      assert.ok(classifier.includes('interests.circles.levels')&&classifier.includes('defaultKnownCategories'));
      assert.ok(classifier.includes(JSON.stringify(snapshot.interests)),'classifier receives the same frozen interests');
      assert.ok(!classifier.includes('何嘉伟是软件公司管理者')&&!classifier.includes('小说创作也不赋予徐小曼'));
      for(const decision of ['known','unknown','not_knowledge','safety_support'])assert.equal(boundary.parseCompanionKnowledgeDecision({decision,basis:'合成依据'}).decision,decision);
      assert.throws(()=>boundary.parseCompanionKnowledgeDecision({decision:'execute',basis:'错误动作'}));
    }
    assert.ok(prompt.includes('memories')&&prompt.includes('event')&&prompt.includes('24000'),'wire protocol and transport guard remain');
    if(['chen-nian','liu','zhou-chef'].includes(id)) {
      for(const guard of ['sourceMessageId','contextMessageId','secretaryDelegation','taskClarification','scheduledDate'])assert.ok(prompt.includes(guard),id+' keeps '+guard);
      assert.ok(prompt.includes('"decision":"none"')||prompt.includes('decision:"none"'));
    } else assert.ok(prompt.includes('本接口动作门控')&&prompt.includes('task、choice'));
    if(id==='chen-nian')assert.ok(prompt.includes('training.restSeconds')&&prompt.includes('用户逐次点击休息胶囊'));
    if(id==='liu')assert.ok(prompt.includes('下周续排当前必须先确认')&&prompt.includes('7个日期'));
    if(id==='zhou-chef')assert.ok(prompt.includes('仅update所需已有ID')&&prompt.includes('不输出voice'));
    const cardPath=join(temporary,'npc-skills/skills/zhiyu-dialogue/npcs',id,'profile.json');
    const card=JSON.parse(readFileSync(cardPath,'utf8'));
    writeFileSync(cardPath,JSON.stringify({...card,name:'合成改名-'+id,identity:{job:'合成新职业-'+id}}));
    const renamed=call(id,builder,state),renamedSnapshot=loadDialogueSkill(temporary,renamed,id);
    assert.ok(renamed.split('\n')[0].includes('合成改名-'+id),'identity header follows new profile, not source constants');
    assert.equal(renamedSnapshot.profile.identity.job,'合成新职业-'+id);
    writeFileSync(cardPath,JSON.stringify(card));
    results.push({id,sourceCount:snapshot.metadata.sources.length,rulesBytes:snapshot.metadata.rulesBytes,promptChars:prompt.length});
  }
  console.log('PASS: six prompts without the old rule tree; single new persona/expression, dynamic profile, preserved state/preferences and task guards, new public directory with unchanged application bindings, circle classifier and displayed professional titles.');
  console.log(JSON.stringify(results,null,2));
} finally { rmSync(temporary,{recursive:true,force:true}); }
