import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// New-package integration in a temporary copied tree only. No live DB, API,
// model, user conversation, media device or actual publishing is accessed.
const runtime=isolatedNpcRuntime();
try {
  for(const name of ['references','skills/zhiyu-character-dialogue','skills/zhiyu-companion-dialogue','skills/zhiyu-professional-dialogue','skills/molly-dialogue','skills/zhiyu-group-dialogue'])
    rmSync(join(runtime.root,'npc-skills',name),{recursive:true,force:true});
  const {loadDialogueSkill,loadMollyDialogueSkill}=await runtime.load('server/npc/dialogue-skill');
  const {ordinaryStyleCatalog}=await runtime.load('server/npc/style-catalog');
  const {loadMomentRules,momentProfessionalEvidence}=await runtime.load('server/npc/moment-policy');
  const {dialogueHealth}=await runtime.load('server/npc/dialogue-health');
  const {parseGroupParticipation}=await runtime.load('server/npc/group-routing');
  const {generateGroupDialogue,parseGroupDialogue,groupOperationalSpeakers}=await runtime.load('server/npc/group-dialogue');
  const names={'chen-nian':'陈年',liu:'柳智敏','zhou-chef':'赵一帆','yuan-xiaoman':'小满','xia-xia':'夏夏','he-jiawei':'何嘉伟'};
  for(const [id,name] of Object.entries(names)) {
    const prompt=`你是${name}，稳定人物ID：${id}。`;
    const loaded=loadDialogueSkill(runtime.root,prompt,id),cards=ordinaryStyleCatalog(runtime.root,prompt,loaded);
    assert.equal(cards[0].id,`PERSONAL-${id}`);
    assert.equal(cards.length,loaded.examples.length+1);
    assert.deepEqual(cards.slice(1).map(card=>JSON.parse(card.content)),loaded.examples);
    assert.ok(cards.slice(1).every(card=>card.id.startsWith(id+'-SCENE-')));
    assert.ok(!cards.some(card=>/^(G\d|C\d|A\d|TRIAL-)/.test(card.id)));
    assert.ok(loaded.metadata.sources.every(source=>source.path.startsWith('npc-skills/skills/zhiyu-dialogue/')||source.path.startsWith('npc-skills/knowledge/')));
    assert.throws(()=>ordinaryStyleCatalog(runtime.root,'你是Molly',loaded),/冲突/);
    for(const section of ['post','interaction']) {
      const rules=loadMomentRules(runtime.root,id,section);
      assert.ok(rules.includes(JSON.stringify(loaded.profile))&&rules.includes(loaded.style));
      assert.ok(rules.includes('npc-skills/skills/zhiyu-moments/'));
      assert.ok(!rules.includes('npc-skills/references/characters/'));
    }
  }
  const molly=loadMollyDialogueSkill(runtime.root);
  assert.equal(molly.profile.mode,'secretary');
  assert.ok(loadMomentRules(runtime.root,'molly').includes(molly.rules));
  assert.throws(()=>ordinaryStyleCatalog(runtime.root,'你是Molly'),/Molly/);
  for(const id of ['chen-nian','liu','zhou-chef'])
    assert.ok(!momentProfessionalEvidence(runtime.root,id,'训练 营养 做饭').includes('LOCAL_KNOWLEDGE_UNAVAILABLE'));

  const frozen=loadDialogueSkill(runtime.root,'你是陈年','chen-nian');
  const originalCards=ordinaryStyleCatalog(runtime.root,'你是陈年',frozen);
  const file=join(runtime.root,'npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/examples.json');
  const examples=JSON.parse(readFileSync(file,'utf8'));
  examples.push({scene:'SYNTHETIC_NEW_CASE_AFTER_SNAPSHOT',lines:['合成后续案例'],status:'未确认'});
  writeFileSync(file,JSON.stringify(examples));
  assert.deepEqual(ordinaryStyleCatalog(runtime.root,'你是陈年',frozen),originalCards);
  const fresh=ordinaryStyleCatalog(runtime.root,'你是陈年');
  assert.equal(fresh.length,originalCards.length+1);
  assert.ok(fresh.at(-1).summary.includes('未确认内容不能提升为已验收规则'));

  let handler;
  dialogueHealth().configureServer({config:{root:runtime.root},middlewares:{use:(_path,value)=>{handler=value;}}});
  let result,status=200;
  handler({method:'GET',url:'/'},{setHeader(){},set statusCode(value){status=value;},end(value){result=JSON.parse(value);}});
  assert.equal(status,200);assert.equal(result.ok,true);assert.equal(result.characters.length,7);
  assert.equal(result.characters.find(item=>item.characterId==='molly').dialogueMode,'secretary');
  assert.deepEqual(result.groupDialogue.sources.map(item=>item.path),['npc-skills/protocols/group-collaboration.md','npc-skills/skills/zhiyu-dialogue/core/10-群聊.md']);

  const now=Date.parse('2026-11-02T10:00:00Z');
  const context={kind:'message',now,facts:{facts:[]},group:{id:'synthetic-unified-group',name:'合成群',goal:'普通交流',members:[
    {id:'user',name:'合成用户',role:'user'},{id:'molly',name:'Molly',role:'admin'},{id:'chen-nian',name:'陈年',role:'npc'}],messages:[],reminders:[]},
    incoming:{id:'synthetic-unified-turn',senderId:'user',senderName:'合成用户',type:'text',text:'有人在吗',mentionIds:[],at:new Date(now).toISOString()}};
  const raw={audience:'selected',intent:'open-help',closedConversation:false,semanticTargetIds:[],requiredReplyIds:[],allowedSpeakerIds:['chen-nian'],operationalSpeakerIds:[]};
  const participation=parseGroupParticipation(raw,context);
  assert.deepEqual(participation.allowedSpeakerIds,['chen-nian'],'open-help label no longer forces all members to speak');
  const parsed=parseGroupDialogue({messages:[{senderId:'chen-nian',text:'合成响应',mentionIds:[]}]},context,participation);
  assert.equal(groupOperationalSpeakers(parsed).size,0);
  assert.throws(()=>parseGroupDialogue({messages:[{senderId:'molly',text:'合成响应',mentionIds:[]}]},context,participation),/人物|范围/);
  let generationSeen=false,reviewSeen=false;
  const output=await generateGroupDialogue(runtime.root,context,async(_root,prompt)=>{
    if(prompt.startsWith('你是智域群聊发言路由器'))return raw;
    if(prompt.startsWith('你是智域群聊成品复核器')){reviewSeen=true;assert.ok(prompt.includes('统一对话Skill'));return {verdict:'keep',edits:[]};}
    generationSeen=true;
    assert.ok(prompt.includes('群协作运行协议')&&prompt.includes('Molly统一对话Skill')&&prompt.includes('群的种类'));
    assert.ok(!prompt.includes('智域共享群协作层')&&!prompt.includes('Molly在opening第一条称老大'));
    return {messages:[{senderId:'chen-nian',text:'合成响应',mentionIds:[]}]};
  });
  assert.ok(generationSeen&&reviewSeen);assert.equal(output.messages[0].senderId,'chen-nian');
  const opening={...context,kind:'opening',incoming:undefined};
  assert.ok(parseGroupDialogue({messages:[{senderId:'molly',text:'老板，合成群已就绪',mentionIds:[]}]},opening,['molly']),'opening uses the current persona rather than forcing an archived address');
  console.log('PASS unified surfaces: six isolated snapshot catalogs, pending-case status, no legacy trees, same-turn freeze, seven-person health, retained public Skills/knowledge, new group protocol/rules and unchanged membership/authority boundaries; synthetic only.');
} finally {runtime.cleanup();}
