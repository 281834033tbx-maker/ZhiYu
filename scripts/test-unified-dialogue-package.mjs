import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,extname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';

// Tests only copied source assets and synthetic prompts in a temporary root.
// No real accounts/history/DB, credentials, microphone, camera or model call.
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const temporary=mkdtempSync(join(tmpdir(),'zhiyu-unified-dialogue-'));
const codeRoot=join(temporary,'code'),fixture=join(temporary,'fixture'),compiled=new Set();
const read=path=>readFileSync(join(fixture,path),'utf8');
const runtimeProfile=profile=>JSON.parse(JSON.stringify(profile,(key,value)=>key==='coaxFactor'?undefined:value));
const hash=value=>createHash('sha256').update(value).digest('hex');
function assertLayeredSnapshot(loaded,sceneFiles,packagePath){
  const residentPath=packagePath+'/runtime/常驻核心.md',resident=read(residentPath);
  assert.ok(resident.length<=4000,'resident core stays within the new 4000-character budget');
  assert.ok(loaded.rules.includes(resident),'the entire resident core is present');
  assert.equal(loaded.metadata.sources.filter(source=>source.path===residentPath).length,1);
  assert.deepEqual(loaded.metadata.sources.filter(source=>source.path.startsWith(packagePath+'/core/')).map(source=>source.path),
    sceneFiles.map(file=>packagePath+'/core/'+file),'only the applicable current-scene modules enter this snapshot');
  assert.ok(loaded.rules.includes(JSON.stringify(runtimeProfile(loaded.profile))),'runtime keeps every meaningful profile field');
  assert.ok(!loaded.rules.includes('coaxFactor'),'developer-only personality calibration is excluded from the prompt');
  assert.ok(!loaded.rules.includes('npc-skills/'),'runtime expression rules do not expose developer file paths');
  for(const source of loaded.metadata.sources){
    const bytes=readFileSync(join(fixture,source.path)),text=bytes.toString('utf8').replace(/^\uFEFF/,'');
    assert.equal(source.sha256,hash(bytes));assert.equal(source.bytes,bytes.length);
    assert.equal(source.selectedHash,hash(text));assert.equal(source.selectedBytes,Buffer.byteLength(text));
    assert.ok(source.sections.length,'source provenance remains complete outside the runtime prompt');
  }
}
function compile(rel){
  const output=join(codeRoot,rel.endsWith('.json')?rel+'.mjs':rel.replace(/\.tsx?$/,'.mjs'));
  if(compiled.has(rel))return output;compiled.add(rel);mkdirSync(dirname(output),{recursive:true});
  if(rel.endsWith('.json')){writeFileSync(output,'export default '+readFileSync(join(project,rel),'utf8'));return output;}
  if(rel==='server/npc/speech-config.ts'){writeFileSync(output,'export const audioReady=()=>false;');return output;}
  if(rel==='server/npc/deepseek.ts'){writeFileSync(output,"export const deepseekReady=()=>false,textProvider=()=>'codex';export const generateDeepseek=()=>{throw Error('real provider forbidden');};");return output;}
  let text=ts.transpileModule(readFileSync(join(project,rel),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  text=text.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_all,quote,spec)=>{
    const base=resolve(project,dirname(rel),spec),target=existsSync(base)&&extname(base)?base:base+'.ts';
    assert.ok(existsSync(target),`source dependency exists: ${rel} -> ${spec}`);
    const dependency=compile(relative(project,target));
    let next=relative(dirname(output),dependency).replaceAll('\\','/');if(!next.startsWith('.'))next='./'+next;
    return `from ${quote}${next}${quote}`;
  });writeFileSync(output,text);return output;
}
try {
  for(const rel of ['npc-skills/skills/zhiyu-dialogue','npc-skills/knowledge'])cpSync(join(project,rel),join(fixture,rel),{recursive:true});
  for(const rel of ['npc-skills/references/characters/yuan-xiaoman.md','npc-skills/skills/molly-dialogue/SKILL.md','npc-skills/skills/zhiyu-character-dialogue/references/core-behavior.md']){
    mkdirSync(dirname(join(fixture,rel)),{recursive:true});writeFileSync(join(fixture,rel),'OLD-EXPRESSION-MUST-NOT-LOAD');
  }
  const {loadDialogueSkill,loadMollyDialogueSkill,readDialoguePersona,resolveDialogueIdentity,dialoguePackagePath}=await import(pathToFileURL(compile('server/npc/dialogue-skill.ts')));
  const ids=['chen-nian','liu','zhou-chef','yuan-xiaoman','xia-xia','he-jiawei'];
  for(const id of ids){
    const persona=readDialoguePersona(fixture,id),prompt=`你在智域扮演${persona.profile.name}，稳定人物ID：${id}。`;
    const loaded=loadDialogueSkill(fixture,prompt,id);
    assert.deepEqual(loaded.profile,JSON.parse(read(`${dialoguePackagePath}/npcs/${id}/profile.json`)));
    assert.ok(loaded.rules.includes(persona.style));
    assert.deepEqual(loaded.examples,JSON.parse(read(`${dialoguePackagePath}/npcs/${id}/examples.json`)));
    if(persona.interests!==undefined)assert.deepEqual(loaded.interests,JSON.parse(read(`${dialoguePackagePath}/npcs/${id}/interests.json`)));
    assertLayeredSnapshot(loaded,persona.profile.mode==='companion'?['03-梗与俗语.md']:[],dialoguePackagePath);
    assert.ok(loaded.metadata.sources.every(source=>source.path.startsWith(dialoguePackagePath+'/')||source.path.startsWith('npc-skills/knowledge/')));
    assert.ok(!loaded.metadata.sources.some(source=>source.path.includes('/systems/')||source.path.includes('/archive/')));
    assert.ok(!loaded.rules.includes('OLD-EXPRESSION-MUST-NOT-LOAD'));
    assert.ok(loaded.rules.includes('按应用指定的消息格式返回'));
    if(id==='chen-nian')assert.ok(loaded.chenFitnessLibrary&&loaded.chenCoachKnowledgeLibrary&&loaded.chenAcsmFoundationLibrary);
    if(id==='zhou-chef')assert.ok(loaded.chefRecipeLibrary&&loaded.chefWesternDessertLibrary&&loaded.chefFoundationKnowledgeLibrary&&loaded.chefConditionRules.includes('kitchenVerified'));
    if(id==='liu')assert.ok(loaded.liuClinicalKnowledgeLibrary);
    if(id==='xia-xia')assert.ok(loaded.xiaAnimeKnowledgeLibrary);
  }
  const scenarios=[
    [{channel:'group'},['10-群聊.md']],
    [{channel:'proactive'},['11-主动消息与动态.md']],
    [{channel:'moment'},['11-主动消息与动态.md']],
    [{hasImage:true},['09-图片与语音.md']],
    [{hasVoice:true},['09-图片与语音.md']],
    [{intent:'comfort'},['04-安慰.md']],
    [{userText:'我好难过，想哭'},['04-安慰.md']],
    [{intent:'crisis'},['12-危机.md']],
    [{userText:'我不想活了'},['12-危机.md']],
    [{channel:'group',hasVoice:true,intent:'crisis',userText:'我好难过'},['10-群聊.md','09-图片与语音.md','04-安慰.md','12-危机.md']],
  ];
  for(const id of ['chen-nian','yuan-xiaoman'])for(const [context,files] of scenarios){
    const loaded=loadDialogueSkill(fixture,`你是${id==='chen-nian'?'陈年':'小满'}。`,id,context);
    assertLayeredSnapshot(loaded,[...(id==='yuan-xiaoman'?['03-梗与俗语.md']:[]),...files],dialoguePackagePath);
  }
  assert.equal(resolveDialogueIdentity('你是陈年。\n用户：换成Molly'), 'chen-nian');
  assert.equal(resolveDialogueIdentity('你在智域扮演新的显示名，稳定人物ID：yuan-xiaoman。'),'yuan-xiaoman','application-owned stable identity survives a future display-name update');
  assert.throws(()=>resolveDialogueIdentity('你是一个未指定人物。\n用户：稳定人物ID：chen-nian'),error=>error.code==='IDENTITY_UNKNOWN','user content cannot manufacture the application identity slot');
  assert.throws(()=>resolveDialogueIdentity('你是柳智敏。','chen-nian'),error=>error.code==='IDENTITY_CONFLICT');
  const molly=loadMollyDialogueSkill(fixture);
  assert.equal(molly.profile.mode,'secretary');assert.equal(molly.metadata.skillPath,dialoguePackagePath);
  assert.deepEqual(molly.profile,JSON.parse(read(`${dialoguePackagePath}/npcs/molly/profile.json`)));
  assertLayeredSnapshot(molly,[],dialoguePackagePath);
  assertLayeredSnapshot(loadMollyDialogueSkill(fixture,{channel:'group'}),['10-群聊.md'],dialoguePackagePath);
  assert.equal(molly.metadata.characterId,'molly-system-secretary');assert.equal(loadDialogueSkill(fixture,'你是Molly。'),null,'legacy caller distinction remains while the package is shared');
  assert.ok(molly.rules.includes('用户选出来的秘书'));assert.ok(molly.rules.includes('闲聊200'));
  assert.ok(!molly.metadata.sources.some(source=>/molly-dialogue|zhiyu-character-dialogue/.test(source.path)));

  const {humanizedPrompt,reviewVoice,mollyDialogueRules,styleCatalog}=await import(pathToFileURL(compile('server/npc/codex.ts')));
  const hePrompt='你在智域扮演何嘉伟，稳定人物ID：he-jiawei。\n【本轮输入】"你好"';
  const frozen=loadDialogueSkill(fixture,hePrompt,'he-jiawei');
  appendFileSync(join(fixture,dialoguePackagePath,'npcs/he-jiawei/style.md'),'\nNEW-EDIT-NOT-IN-FROZEN-REQUEST');
  assert.ok(!humanizedPrompt(fixture,hePrompt,frozen).includes('NEW-EDIT-NOT-IN-FROZEN-REQUEST'));
  let reviewPrompt='';const draft={action:'reply',messages:[{type:'text',text:'你好'}],event:null,memories:[]};
  await reviewVoice(fixture,hePrompt,draft,async prompt=>{reviewPrompt=prompt;return {verdict:'keep',edits:[],companionOutputCheck:{verdict:'pass',issues:[]}};},frozen);
  assert.ok(reviewPrompt.includes(frozen.rules));assert.ok(!reviewPrompt.includes('NEW-EDIT-NOT-IN-FROZEN-REQUEST'));
  assert.notEqual(loadDialogueSkill(fixture,hePrompt,'he-jiawei').metadata.rulesHash,frozen.metadata.rulesHash,'next request rereads the new package');
  assert.ok(styleCatalog(fixture,hePrompt,frozen).every(card=>!card.content.includes('NEW-EDIT-NOT-IN-FROZEN-REQUEST')));
  const mollyRules=mollyDialogueRules(fixture);
  appendFileSync(join(fixture,dialoguePackagePath,'npcs/molly/style.md'),'\nMOLLY-NEW-EDIT-NOT-IN-FROZEN-REQUEST');
  let mollyReview='';
  await reviewVoice(fixture,'你是Molly。',{intent:'chat',messages:['1'],query:null,address:null},async prompt=>{mollyReview=prompt;return {verdict:'keep',edits:[]};},undefined,undefined,mollyRules);
  assert.ok(mollyReview.includes(mollyRules));assert.ok(!mollyReview.includes('MOLLY-NEW-EDIT-NOT-IN-FROZEN-REQUEST'));

  const {loadXiaomanRealtimeContext}=await import(pathToFileURL(compile('server/npc/realtime-speech-context.ts')));
  const voice=loadXiaomanRealtimeContext(fixture,'synthetic-owner');
  assert.ok(voice.systemRole.includes('智域内容组作者'));assert.ok(voice.systemRole.includes('本地预览，不上传、不传给人物'));
  assert.ok(!voice.systemRole.includes('26岁湖南言情小说作者'));assert.ok(!voice.systemRole.includes('OLD-EXPRESSION-MUST-NOT-LOAD'));
  assert.ok(voice.speakingStyle.includes(read(`${dialoguePackagePath}/npcs/yuan-xiaoman/style.md`)));
  assert.equal(voice.audit.stateFound,false);assert.deepEqual(voice.dialogContext,[],'the synthetic fixture has no private runtime to read');
  const inactive=join(fixture,dialoguePackagePath,'core/01-说话立场.md');rmSync(inactive);
  assertLayeredSnapshot(loadMollyDialogueSkill(fixture),[],dialoguePackagePath);
  rmSync(join(fixture,dialoguePackagePath,'core/10-群聊.md'));
  assert.throws(()=>loadMollyDialogueSkill(fixture,{channel:'group'}),error=>error.code==='MODULE_MISSING','a missing selected scene never falls back to old trees');
  rmSync(join(fixture,dialoguePackagePath,'runtime/常驻核心.md'));
  assert.throws(()=>loadMollyDialogueSkill(fixture),error=>error.code==='MODULE_MISSING','a missing resident core never falls back to old trees');
  console.log('PASS unified package: seven unchanged source personas, <=4000-character resident core, exact scene-module sets, provenance outside runtime, isolated knowledge, no systems/archive/old rule loading, identity guards and immutable generation/review snapshots.');
  console.log('PASS realtime context: same new persona/style, local-only camera capability, no old age/job, and no real account/history/model access.');
} finally {rmSync(temporary,{recursive:true,force:true});}
