import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {dirname} from 'node:path';
import ts from 'typescript';
import { join } from 'node:path';
import { isolatedNpcRuntime } from './npc-test-runtime.mjs';

// Only synthetic state and source parsing. No account/database/model requests.
const runtime = isolatedNpcRuntime();
try {
  const directory = await runtime.load('lib/npc/character-directory');
  const { groupNpcCatalog } = await runtime.load('lib/npc/group-chat');
  const { dialoguePurposeByCharacter } = await runtime.load('lib/npc/dialogue-purpose');
  // Evaluate the real static App projection inside the same disposable runtime.
  for (const path of ['app/zhiyu/data', 'app/zhiyu/professional-profiles']) {
    const file=join(runtime.root,path+'.mjs'); mkdirSync(dirname(file),{recursive:true});
    const source=readFileSync(path+'.ts','utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
    writeFileSync(file,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  for (const path of ['app/zhiyu/assets.json','npc-skills/data/zhou-chef-profile.json'])
    writeFileSync(join(runtime.root,path+'.mjs'),'export default '+readFileSync(path,'utf8'));
  const {people, archivedPeople}=await runtime.load('app/zhiyu/data');
  assert.deepEqual(people.map(person=>person.id),['chen-nian','he-jiawei','zhou-chef','yuan-xiaoman','liu','xia-xia'],'existing UI order stays stable');
  for (const person of people) {
    const shared=directory.getCharacter(person.id);
    assert.equal(person.name,shared.name); assert.equal(person.realName,shared.realName);
    assert.deepEqual(person.aliases,shared.aliases); assert.equal(person.dialoguePurpose,shared.role);
    assert.equal(person.professionalTitle,shared.professionalTitle||undefined);
    assert.equal(person.publicDirectoryVersion,directory.publicCharacterDirectoryVersion);
  }
  assert.equal(people.some(person=>person.id==='zhao-yifan'),false);
  assert.ok(archivedPeople.some(person=>person.id==='zhao-yifan'));

  const { createMolly, emptyQuery, matchMolly, mollyCatalog, mollyCompanionChoice, parseMolly, applyMolly } = await runtime.load('lib/npc/molly');
  assert.equal(mollyCatalog.length, 6);
  for (const person of mollyCatalog) assert.equal(dialoguePurposeByCharacter[person.id], person.role);
  assert.deepEqual(new Set(groupNpcCatalog.filter(p => p.id !== 'molly').map(p => p.id)), new Set(mollyCatalog.map(p => p.id)));
  assert.equal(directory.getCharacter('zhou-chef').services.includes('cooking'), true);
  assert.equal(directory.getCharacter('he-jiawei').services.includes('nutrition'), false);
  assert.equal(directory.getCharacter('xia-xia').services.includes('cooking'), false, 'food interest is not cooking service');
  assert.equal(directory.getCharacter('zhao-yifan'), undefined);
  assert.deepEqual(matchMolly({ ...emptyQuery(), tags: ['厨师'] }).map(p => p.id), ['zhou-chef']);
  assert.deepEqual(matchMolly({ ...emptyQuery(), name: '周师傅' }).map(p => p.id), ['zhou-chef']);
  assert.equal(matchMolly({...emptyQuery(), ageMin: 25, ageMax: 40}).filter(p => p.id === 'zhou-chef' || p.id === 'he-jiawei').length, 2, 'new confirmed ages participate in ranges');
  assert.deepEqual(mollyCompanionChoice().options, ['徐小曼｜温柔知性', '夏夏｜活泼可爱', '何嘉伟｜高冷克制']);
  assert.deepEqual(mollyCompanionChoice({...emptyQuery(), gender:'女'}).options, ['徐小曼｜温柔知性', '夏夏｜活泼可爱']);
  assert.equal(mollyCompanionChoice({...emptyQuery(), gender:'男'}), null);

  const incoming = '我今天要做西红柿鸡蛋';
  const state = createMolly();
  state.queue = ['turn-1'];
  state.query = {...emptyQuery(), tags:['温柔'], gender:'女'}; // unrelated old search
  state.messages.push({id:'source-1',turnId:'turn-1',role:'user',at:new Date().toISOString(),part:{type:'text',text:incoming}});
  const action = {type:'handoff',targetId:'zhou-chef',service:'cooking',request:incoming,mode:'new',sourceMessageId:'source-1',evidence:incoming,scope:'current_user',polarity:'affirmed',confidence:.96};
  const raw = {intent:'operation',messages:['让赵一帆来'],address:null,query:null,actions:[action]};
  const parsed = parseMolly(raw,incoming,state);
  assert.equal(parsed.actions[0].targetId,'zhou-chef', 'unrelated past interests must not suppress current handoff');
  applyMolly(state,parsed,'job-1');
  assert.equal(state.messages.at(-1).recommendations, undefined, 'handoff is not another contact card');
  assert.throws(()=>parseMolly(raw,incoming), /current user source/);
  const withAction = update => ({...raw,actions:[{...action,...update}]});
  assert.throws(()=>parseMolly(withAction({sourceMessageId:'other-account'}),incoming,state), /current user source/);
  assert.throws(()=>parseMolly(withAction({evidence:'我今天练肩'}),incoming,state), /evidence/);
  assert.throws(()=>parseMolly(withAction({polarity:'negated'}),incoming,state), /evidence/);
  assert.throws(()=>parseMolly(withAction({scope:'another_user'}),incoming,state), /evidence/);
  assert.throws(()=>parseMolly(withAction({confidence:.8}),incoming,state), /evidence/);
  assert.throws(()=>parseMolly(withAction({targetId:'xia-xia'}),incoming,state), /target/);
  assert.throws(()=>parseMolly(withAction({targetId:'unknown-or-archived'}),incoming,state), /target/);
  assert.throws(()=>parseMolly({...raw,query:{...emptyQuery(),gender:'女'}},incoming,state), /constraints/);
  assert.throws(()=>parseMolly({...raw,query:{...emptyQuery(),tags:['深圳']}},incoming,state), /constraints/);
  assert.throws(()=>parseMolly({...raw,candidateIds:['zhou-chef']},incoming,state), /contact cards/);
  assert.throws(()=>parseMolly({...raw,intent:'chat'},incoming,state), /operation/);
  assert.throws(()=>parseMolly({...raw,actions:[]},incoming,state), /requires an action/);
  assert.throws(()=>parseMolly({...raw,actions:[]},'取消明天训练',state), /requires an action/);
  const stop = parseMolly({intent:'operation',messages:['知道了'],address:null,query:emptyQuery(),queryMode:'clear'},'取消搜索');
  assert.equal(stop.queryMode, 'clear');
  const previous = createMolly(); previous.query = {...emptyQuery(),gender:'女',tags:['温柔']};
  applyMolly(previous,stop,'stop-turn'); assert.deepEqual(previous.query,emptyQuery());
  assert.equal(parseMolly({intent:'operation',messages:['知道了'],address:null,query:null},'先别推荐了').intent,'operation');
  const recommendation = parseMolly({intent:'search',messages:['赵一帆'],address:null,query:{...emptyQuery(),tags:['厨师']},candidateIds:['zhou-chef']},'给我推荐一个厨师');
  const recommendationState=createMolly();applyMolly(recommendationState,recommendation,'card-turn');
  assert.equal(recommendationState.messages.at(-1).recommendations[0].id,'zhou-chef');
  assert.throws(()=>parseMolly({...raw,actions:[action,action]},incoming,state), /Duplicate/);
  const stale=structuredClone(state);stale.queue=[];stale.pending=null;
  assert.throws(()=>parseMolly(raw,incoming,stale), /current user source/);

  const skill=readFileSync(join(runtime.root,'npc-skills/skills/molly-dialogue/SKILL.md'),'utf8');
  const liu=readFileSync(join(runtime.root,'npc-skills/skills/zhiyu-professional-dialogue/references/liu-nutrition-guidance.md'),'utf8');
  assert.match(skill,/用户问你在干嘛，仅加班/);
  assert.match(skill,/没有旧计划让柳智敏来/);
  assert.match(skill,/已有饮食计划安排后续时Molly整条只OK/);
  assert.match(skill,/安排下周饮食不自动代表照旧/);
  assert.match(liu,/用户只是安排下周时，先短问是否继续上周方案/);
  assert.match(liu,/Molly的OK是秘书回执，不能当作用户确认/);
  JSON.parse(readFileSync(join(runtime.root,'npc-skills/skills/molly-dialogue/references/secretary-feedback-20261015.json'),'utf8'));
  console.log(JSON.stringify({passed:true,checks:['shared enabled directory','professional service versus interest','unknown-age and gender guards','three companion options','current-turn evidence','service target and duplicate guard','handoff without card','diet confirmation rule'],modelCalls:0}));
} finally { runtime.cleanup(); }
