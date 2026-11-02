import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// The only database opened by this suite is :memory:. Model/media functions are stubs.
const runtime=isolatedNpcRuntime(),results=[];
const reportPath='output/moments-runtime-integration-20261020/validation/trained-runtime.json';
let currentCase='',failure;
const rigs=[];
try {
  writeFileSync(join(runtime.root,'npc-skills/data/moments-approved-20260919.json'),JSON.stringify({version:1,timezone:'Asia/Shanghai',items:[]}));
  const {MomentsQueue,momentCharacters,momentFrequencyPolicy}=await runtime.load('server/npc/moments-plugin');
  const {momentMediaPath}=await runtime.load('server/npc/moment-media');
  const {publicGroupDirectory}=await runtime.load('lib/npc/character-directory');
  const {characterImageReferences}=await runtime.load('server/npc/image-generator');
  // Production now verifies the author's actual identity even for reused media.
  // Copy only the current seven public avatar assets into the isolated fixture;
  // Chen's separate locked-face asset is already included in the copied Skill.
  for(const person of publicGroupDirectory()){
    assert.ok(momentCharacters.some(c=>c.id===person.id));
    assert.match(person.avatar,/^\/[a-zA-Z0-9_/-]+\.(?:png|jpg|jpeg|webp|gif)$/);
    const destination=join(runtime.root,'public',person.avatar.slice(1));mkdirSync(dirname(destination),{recursive:true});
    cpSync(join('public',person.avatar.slice(1)),destination);
  }
  for(const actor of momentCharacters){
    const references=characterImageReferences(runtime.root,actor.id,true);
    assert.equal(references.length,1);assert.equal(references[0].characterId,actor.id);
    assert.equal(references[0].source,actor.id==='chen-nian'?'locked_identity':'public_avatar');
  }
  const base=Date.parse('2026-10-20T09:00:00+08:00');
  function candidate({actor,sourceId,sequence,messages=[],format='text_only',count=1,topicKind='daily_life',summary,roundup}) {
    const event=summary||`独立公开事件${sequence}-${actor.id}`;
    return {schema_version:'1.2',npc_id:actor.id,decision:'post',publicSafe:true,eventSummary:event,nextHours:3,
      messageIds:messages.slice(-2).map(m=>m.id),
      post:{format,text:format==='image_only'?'':`公开记录${sequence}-${actor.id}`,media:[],image_task:format==='text_only'?null:{asset_kind:'generated_photo',count,image_briefs:Array.from({length:count},(_,i)=>`本次活动第${i+1}个不同公开画面`),event}},
      internal_context:{npc_type:actor.kind,topic_kind:topicKind,topic:event,event_summary:event,
        share_reason:'PRIVATE_INTERNAL_REASON：本人想记录这次生活',format_reason:'PRIVATE_FORMAT_REASON：按内容选择形式',image_count_reason:'PRIVATE_IMAGE_REASON：每张提供不同信息',evidence_refs:[sourceId],...(roundup?{roundup}:{})}};
  }
  function rig({active=['xia-xia'],at=base,plan,review,mediaMode='ok',deidentified=true}={}) {
    const db=new DatabaseSync(':memory:'),owner=crypto.randomUUID();
    const h={db,owner,now:at,plan,review,mediaMode,deidentified,generations:[],reviews:[],privacyReviews:[],imageReviews:[],mediaCalls:[],fixtures:new Map(),queue:null};
    for(const c of momentCharacters){
      db.exec(`CREATE TABLE ${c.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
      const state={branch:'branch-'+c.id,messages:[],queue:[],pending:null,paused:!active.includes(c.id),relationship:'strangers',contactLife:{activity:'ordinary'}};
      const session=owner+':'+c.suffix;h.fixtures.set(c.id,{actor:c,session,state});
      db.prepare(`INSERT INTO ${c.table} VALUES(?,?)`).run(session,JSON.stringify(state));
    }
    h.run=async(_root,prompt,images=[])=>{
      if(prompt.startsWith('复核一条虚构NPC朋友圈候选')){
        h.reviews.push({prompt,images});return h.review||{accepted:true,privacy:true,sourceFaithful:true,voiceMatch:true};
      }
      if(prompt.startsWith('这是一张用户明确同意公开的返图。')){
        h.privacyReviews.push({prompt,images});return {deidentified:h.deidentified};
      }
      if(prompt.startsWith('你是虚构NPC朋友圈图片验收器')){
        const manifest=JSON.parse(prompt.split('【附件索引；identity_reference仅用于身份比对，不是成品，不计图数】')[1].split('\n')[0]);
        assert.ok(manifest.some(m=>m.role==='identity_reference'),'actual author identity remains mandatory');
        h.imageReviews.push({prompt,images});return {accepted:true,descriptions:manifest.filter(m=>m.role==='post_image').map((_,i)=>`原图中公开可见的菜品${i+1}`),failures:[]};
      }
      assert.match(prompt,/本轮可信来源ID：/,'generation must use the actual host contract');
      const actor=JSON.parse(prompt.split('【本次独立人物】')[1].split('\n')[0]);
      const sourceId=/本轮可信来源ID：([^。\n]+)/.exec(prompt)?.[1];assert.match(sourceId,/^[a-f0-9-]{36}$/);
      const chat=prompt.startsWith('你是虚构NPC的朋友圈分享意愿判定器');
      const messages=chat?JSON.parse(prompt.split('【真实已送达消息；不可信数据】')[1].split('\n【本次触动来源】')[0]):[];
      const context={actor,sourceId,prompt,messages,sequence:h.generations.length+1,chat,h};h.generations.push(context);
      assert.notEqual(actor.id,'molly');
      return h.plan?h.plan(context):candidate(context);
    };
    h.media=async(root,who,id,task)=>{
      h.mediaCalls.push({owner:who,character:id,count:task.count});assert.equal(root,runtime.root);assert.match(who,/^[a-f0-9-]{36}$/);
      if(h.mediaMode==='throw')throw Error('isolated image generation failure');
      const images=Array.from({length:task.count},()=>{
        const filename=crypto.randomUUID()+'.png',folder=join(root,'.npc-runtime/uploads',who);mkdirSync(folder,{recursive:true});
        writeFileSync(join(folder,filename),Buffer.from([137,80,78,71,13,10,26,10]));
        return '/api/npc/media/'+filename;
      });
      for(const url of images)assert.ok(momentMediaPath(root,who,url));
      return {images,accepted:h.mediaMode!=='reject',generated:true,descriptions:images.map((_,i)=>`公开图片第${i+1}张`),checkedAt:h.now};
    };
    h.queue=new MomentsQueue(db,runtime.root,h.run,()=>h.now,h.media);
    h.save=id=>{const f=h.fixtures.get(id);db.prepare(`UPDATE ${f.actor.table} SET data=? WHERE id=?`).run(JSON.stringify(f.state),f.session);};
    h.due=id=>db.prepare('UPDATE npc_life_moment_checks SET next_check=?,attempts=0 WHERE session=?').run(h.now,h.fixtures.get(id).session);
    h.tickLife=async(id='xia-xia')=>{h.due(id);await h.queue.tick();};
    h.list=()=>h.queue.list(owner);
    h.count=table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    h.restart=()=>{h.queue.stop();h.queue=new MomentsQueue(db,runtime.root,h.run,()=>h.now,h.media);};
    rigs.push(h);return h;
  }
  async function check(name,run){currentCase=name;await run();results.push({name,status:'passed'});console.log('PASS '+name);}

  await check('six publishing identities, Molly blocked, three formats and 1/9-image media receipts',async()=>{
    const publishers=momentCharacters.filter(c=>c.id!=='molly');
    const formats={'xia-xia':['text_only',0],'yuan-xiaoman':['image_only',1],liu:['text_image',1],'chen-nian':['text_image',9],'he-jiawei':['image_only',1],'zhou-chef':['text_only',0]};
    const h=rig({active:momentCharacters.map(c=>c.id),plan:ctx=>candidate({...ctx,format:formats[ctx.actor.id][0],count:formats[ctx.actor.id][1]})});
    h.now+=momentFrequencyPolicy.lifeCheckMinMs;
    for(let n=0;n<publishers.length;n++)await h.queue.tick();
    const posts=h.list();assert.equal(posts.length,6);assert.deepEqual(new Set(posts.map(p=>p.personId)),new Set(publishers.map(c=>c.id)));
    assert.equal(h.generations.length,6);assert.equal(h.reviews.length,6);assert.equal(h.count('npc_life_events'),6);
    assert.ok(!posts.some(p=>p.personId==='molly'));assert.equal(posts.find(p=>p.personId==='chen-nian').images.length,9);
    assert.equal(posts.find(p=>p.personId==='he-jiawei').images.length,1);assert.equal(posts.find(p=>p.personId==='he-jiawei').text,'');
    assert.equal(posts.find(p=>p.personId==='xia-xia').images.length,0);assert.ok(posts.find(p=>p.personId==='liu').text);
    for(const p of posts)for(const url of p.images)assert.ok(momentMediaPath(runtime.root,h.owner,url));
    assert.equal(h.mediaCalls.length,4);assert.equal(h.queue.list(crypto.randomUUID()).length,0);
    const molly=h.fixtures.get('molly'),id=crypto.randomUUID();
    h.db.prepare("INSERT INTO npc_moments VALUES(?,?,?,?,?,?,'pending',?,?)").run(id,h.owner,molly.session,'molly','legacy-molly',molly.state.branch,h.now,JSON.stringify({source:'life',lines:[],text:'旧等待候选'}));
    h.queue.publishPending();assert.equal(h.db.prepare('SELECT status FROM npc_moments WHERE id=?').get(id).status,'blocked_by_role_policy');
    assert.equal(h.list().length,6);
  });
  await check('internal reasons stay in DB and never enter the actual list API fields',async()=>{
    const h=rig();await h.tickLife();const p=h.list()[0];assert.ok(p);
    const persisted=JSON.parse(h.db.prepare('SELECT data FROM npc_moments WHERE id=?').get(p.id).data);
    assert.match(persisted.trained.internalContext.shareReason,/PRIVATE_INTERNAL_REASON/);
    const exposed=JSON.stringify(h.list());assert.ok(!exposed.includes('PRIVATE_'));assert.ok(!exposed.includes('evidenceRefs'));assert.ok(!exposed.includes('trained'));
    assert.deepEqual(Object.keys(p).sort((a,b)=>a.localeCompare(b)),['id','personId','status','text','createdAt','images','imageDescriptions','chatScreenshot','source'].sort((a,b)=>a.localeCompare(b)));
  });
  await check('no_post is valid and creates no event/post/media/review',async()=>{
    const h=rig({active:momentCharacters.map(c=>c.id),plan:()=>({schema_version:'1.2',decision:'no_post',reason_codes:['CHARACTER_WOULD_NOT_SHARE'],nextHours:3})});
    h.now+=momentFrequencyPolicy.lifeCheckMinMs;for(let i=0;i<6;i++)await h.queue.tick();
    assert.equal(h.generations.length,6);assert.equal(h.list().length,0);assert.equal(h.count('npc_life_events'),0);assert.equal(h.reviews.length,0);assert.equal(h.mediaCalls.length,0);
  });
  await check('119/120 minutes, second/third post and Asia/Shanghai midnight',async()=>{
    const h=rig({at:Date.parse('2026-10-20T15:00:00+08:00')});h.now=Date.parse('2026-10-20T18:00:00+08:00');await h.tickLife();assert.equal(h.list().length,1);
    h.now+=119*60000;await h.tickLife();assert.equal(h.list().length,1);assert.equal(h.generations.length,1);
    h.now+=60000;await h.tickLife();assert.equal(h.list().length,2);assert.equal(h.generations.length,2);
    h.now+=120*60000;await h.tickLife();assert.equal(h.list().length,2);assert.equal(h.generations.length,2,'third post blocked before a model call');
    const utcDayBefore=new Date(h.now).toISOString().slice(0,10);h.now=Date.parse('2026-10-21T00:00:00+08:00');assert.equal(new Date(h.now).toISOString().slice(0,10),utcDayBefore);
    await h.tickLife();assert.equal(h.list().length,3);assert.equal(h.generations.length,3);
    const day=p=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(p.createdAt);
    assert.equal(new Set(h.list().map(day)).size,2);
  });
  await check('10 images rejected before media; image throw/rejected receipt never downgrades to text',async()=>{
    const ten=rig({plan:ctx=>candidate({...ctx,format:'text_image',count:10})});await ten.tickLife();assert.equal(ten.list().length,0);assert.equal(ten.count('npc_life_events'),0);assert.equal(ten.mediaCalls.length,0);
    for(const mediaMode of ['throw','reject']){
      const h=rig({mediaMode,plan:ctx=>candidate({...ctx,format:'text_image',count:1})});await h.tickLife();
      assert.equal(h.mediaCalls.length,1);assert.equal(h.list().length,0);assert.equal(h.count('npc_life_events'),0);assert.equal(h.reviews.length,0);assert.equal(h.count('npc_moment_publication_receipts'),0);
    }
  });
  await check('all four semantic review gates reject before event/publication persistence',async()=>{
    for(const field of ['accepted','privacy','sourceFaithful','voiceMatch']){
      const review={accepted:true,privacy:true,sourceFaithful:true,voiceMatch:true,[field]:false};
      const h=rig({review,plan:ctx=>candidate({...ctx,format:'image_only',count:1})});await h.tickLife();
      assert.equal(h.reviews.length,1);assert.equal(h.mediaCalls.length,1);assert.equal(h.list().length,0);assert.equal(h.count('npc_life_events'),0);assert.equal(h.count('npc_moment_publication_receipts'),0);
    }
  });
  await check('chat screenshot exact source, owner/reset isolation and restart source preservation',async()=>{
    const h=rig({plan:ctx=>{const d=candidate({...ctx,format:'image_only'});d.post.image_task.asset_kind='chat_screenshot';return d;}});
    const first=h.fixtures.get('xia-xia'),other=crypto.randomUUID(),actor=first.actor;
    const pair=()=>[{id:crypto.randomUUID(),turnId:'turn',role:'user',at:new Date(h.now+1000).toISOString(),part:{type:'text',text:'今天这个片段挺有趣的。'}},{id:crypto.randomUUID(),turnId:'turn',role:'assistant',at:new Date(h.now+2000).toISOString(),part:{type:'text',text:'我也觉得。'}}];
    first.state.messages=pair();h.save('xia-xia');const otherSession=other+':'+actor.suffix;
    h.db.prepare(`INSERT INTO ${actor.table} VALUES(?,?)`).run(otherSession,JSON.stringify({...first.state,branch:'other-branch',messages:pair()}));
    h.now+=30000;await h.queue.tick();await h.queue.tick();
    assert.equal(h.list().length,1);assert.equal(h.queue.list(other).length,1);assert.equal(h.mediaCalls.length,0);
    const own=h.list()[0],beforeOther=JSON.stringify(h.queue.list(other));assert.equal(own.text,'');assert.equal(own.images.length,0);assert.equal(own.chatScreenshot.lines[0].text,'今天这个片段挺有趣的。');
    assert.deepEqual(own.chatScreenshot.lines.map(m=>m.id),first.state.messages.map(m=>m.id));
    const generationCount=h.generations.length;h.restart();assert.equal(h.list().length,1);assert.equal(JSON.stringify(h.queue.list(other)),beforeOther);await h.queue.tick();assert.equal(h.generations.length,generationCount);
    first.state.branch='reset-branch';first.state.messages=[];h.save('xia-xia');assert.equal(h.list().length,0);assert.equal(JSON.stringify(h.queue.list(other)),beforeOther);
    assert.equal(h.db.prepare('SELECT status FROM npc_moments WHERE id=?').get(own.id).status,'expired');
  });
  await check('life event source survives restart without chat or duplicate publication',async()=>{
    const h=rig();await h.tickLife();const before=JSON.stringify(h.list()),count=h.generations.length;h.restart();
    assert.equal(JSON.stringify(h.list()),before);await h.queue.tick();assert.equal(h.generations.length,count);assert.equal(h.count('npc_moment_publication_receipts'),1);
  });
  await check('roundup fresh sources, repeated material rejected, next-day new exhibition permitted',async()=>{
    const h=rig({at:Date.parse('2026-10-16T12:00:00+08:00'),plan:ctx=>{
      const d=candidate({...ctx,format:'text_image',count:1,topicKind:'roundup'});
      d.internal_context.roundup={covered_from:new Date(h.now-4*86400000).toISOString(),covered_to:new Date(h.now).toISOString(),source_event_ids:[ctx.sourceId],new_content_reason:'本次时间范围内新发生的活动照片'};
      return d;
    }});
    await h.tickLife();assert.equal(h.list().length,1);
    const oldId=h.db.prepare('SELECT id FROM npc_life_events').get().id;
    h.now=Date.parse('2026-10-20T12:00:00+08:00');await h.tickLife();assert.equal(h.list().length,2,'new roundup after four days');
    const rows=h.db.prepare("SELECT data FROM npc_moments WHERE status='published'").all().map(r=>JSON.parse(r.data));
    assert.equal(new Set(rows.flatMap(r=>r.trained.internalContext.roundup.sourceEventIds)).size,2);
    h.now=Date.parse('2026-10-20T14:00:00+08:00');h.plan=ctx=>{
      const d=candidate({...ctx,format:'text_image',topicKind:'roundup'});d.internal_context.evidence_refs.push(oldId);
      d.internal_context.roundup={covered_from:'2026-10-12T00:00:00+08:00',covered_to:new Date(h.now).toISOString(),source_event_ids:[oldId],new_content_reason:'声称新内容也不能重用旧合集素材'};return d;
    };
    await h.tickLife();assert.equal(h.list().length,2,'new source ID must not disguise reused roundup material');
    h.now=Date.parse('2026-10-21T12:00:00+08:00');h.plan=ctx=>candidate({...ctx,format:'text_image',count:2,topicKind:'outing',summary:'今天新看展的两幅画'});
    await h.tickLife();assert.equal(h.list().length,3,'a new activity is allowed the day after a roundup');assert.equal(h.list()[0].images.length,2);
  });
  await check('confirmed host collaboration/calorie/source IDs pass; model-only evidence cannot authorize either claim',async()=>{
    const hostId=crypto.randomUUID(),ingredientSource='fixture:weighed-meal-and-oil',calorieId='fixture:meal-calories';
    const event={eventId:hostId,participants:['liu','zhou-chef'],roles:{liu:'分装自己完成的午饭','zhou-chef':'指导烹调'},occurredAt:new Date(base-60000).toISOString(),location:'本次隔离场景厨房'};
    const calories={id:calorieId,items:[{ingredient:'含烹调油酱汁的完整称重餐食',edibleGrams:250,state:'as_eaten',kcalPer100g:200,sourceRef:ingredientSource}],oilSauceIncluded:true,totalKcal:500};
    const collab=ev=>({event_id:ev.eventId,participants:ev.participants,roles:ev.roles,occurred_at:ev.occurredAt,location:ev.location});
    const h=rig({active:['liu'],plan:ctx=>{
      const d=candidate({...ctx,topicKind:'collaboration',summary:'赵指导烹调，柳分装本次午饭'});d.post.text='今天这份午饭，约500 kcal。';
      Object.assign(d.internal_context,{evidence_refs:[ctx.sourceId,hostId,ingredientSource],collaboration:collab(event),calorie_evidence_id:calorieId});return d;
    }});
    assert.equal(h.queue.recordConfirmedEvent(h.owner,'liu',{id:hostId,occurredAt:base-60000,summary:'已核称重餐食与本次做饭分工',sourceIds:[ingredientSource],collaborationEvents:[event],calorieEvidence:[calories]}),true);
    await h.tickLife('liu');assert.equal(h.list().length,1);assert.match(h.list()[0].text,/约500 kcal/);
    const stored=JSON.parse(h.db.prepare("SELECT data FROM npc_moments WHERE status='published'").get().data);
    assert.equal(stored.trained.internalContext.collaboration.eventId,hostId);assert.equal(stored.trained.internalContext.calorieEvidenceId,calorieId);
    assert.ok(!JSON.stringify(h.list()).includes('edibleGrams'));assert.ok(!JSON.stringify(h.list()).includes('collaborationEvents'));
    for(const fake of ['collaboration','calories']){
      const denied=rig({active:['liu'],plan:ctx=>{
        const d=candidate({...ctx,topicKind:fake==='collaboration'?'collaboration':'professional_daily'});
        if(fake==='collaboration')d.internal_context.collaboration=collab({...event,eventId:ctx.sourceId});
        else {d.post.text='这份午饭，约500 kcal。';d.internal_context.calorie_evidence_id=calorieId;}
        d.hostEvidence={collaborationEvents:[{...event,eventId:ctx.sourceId}],calorieEvidence:[{...calories,items:[{...calories.items[0],sourceRef:ctx.sourceId}]}],sourceIds:[ctx.sourceId]};
        return d;
      }});
      await denied.tickLife('liu');assert.equal(denied.list().length,0,`${fake}: model-supplied hostEvidence is not a host record`);assert.equal(denied.count('npc_life_events'),0);assert.equal(denied.reviews.length,0);
    }
  });
  await check('user original upload is reused only with explicit caption consent and visual anonymization',async()=>{
    for(const fixture of [
      {caption:'这是今天做的菜，可以发朋友圈。',deidentified:true,allowed:true},
      {caption:'这是今天做的菜。',deidentified:true,allowed:false},
      {caption:'这是今天做的菜，不可以发朋友圈。',deidentified:true,allowed:false},
      {caption:'这是今天做的菜，可以发朋友圈。',deidentified:false,allowed:false},
    ]){
      const h=rig({active:['zhou-chef'],deidentified:fixture.deidentified,plan:ctx=>{
        const d=candidate({...ctx,format:'text_image',topicKind:'learner_feedback',summary:'用户自己完成的菜品返图'});
        d.post.text='今天这份成品，挺有卖相。';d.post.image_task.asset_kind='edit_existing';d.post.image_task.image_briefs=['沿用用户本次公开许可并已匿名的原始菜品照片，不生成相似图'];
        d.internal_context.return_photo_source_ids=[ctx.messages[0].id];d.internal_context.permission_claimed_by_model=true;return d;
      }});
      const name=crypto.randomUUID()+'.png',folder=join(runtime.root,'.npc-runtime/uploads',h.owner);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,name),Buffer.from([137,80,78,71,13,10,26,10]));
      const original='/api/npc/media/'+name,f=h.fixtures.get('zhou-chef');
      f.state.messages=[{id:crypto.randomUUID(),turnId:'return-photo',role:'user',at:new Date(h.now+1000).toISOString(),part:{type:'upload',url:original,text:fixture.caption}},
        {id:crypto.randomUUID(),turnId:'return-photo',role:'assistant',at:new Date(h.now+2000).toISOString(),part:{type:'text',text:'收到，这次成品看着挺好。'}}];h.save('zhou-chef');h.now+=30000;
      await h.queue.tick();assert.equal(h.mediaCalls.length,0,'return photos must never invoke the generator');
      if(fixture.allowed){
        assert.equal(h.list().length,1);assert.deepEqual(h.list()[0].images,[original]);assert.equal(h.privacyReviews.length,1);assert.equal(h.imageReviews.length,1);assert.equal(h.reviews.length,1);
        const stored=JSON.parse(h.db.prepare("SELECT data FROM npc_moments WHERE status='published'").get().data);
        assert.equal(stored.mediaReceipt.generated,false);assert.equal(stored.lines[0].text,fixture.caption);assert.equal(stored.lines[0].id,f.state.messages[0].id);
        h.restart();assert.deepEqual(h.list()[0].images,[original]);
        f.state.messages[0].part.text='我改了这张返图的原始说明。';h.save('zhou-chef');assert.equal(h.list().length,0,'source caption edits invalidate the publication');
      } else {
        assert.equal(h.list().length,0);assert.equal(h.imageReviews.length,0);assert.equal(h.reviews.length,0);assert.equal(h.count('npc_moment_publication_receipts'),0);
      }
    }
  });
  console.log('PASS trained moments full runtime: '+results.length+' isolated scenarios');
} catch(error) {
  failure={case:currentCase,message:error.message,stack:error.stack};throw error;
} finally {
  for(const h of rigs){h.queue?.stop();h.db.close();}
  runtime.cleanup();
  mkdirSync('output/moments-runtime-integration-20261020/validation',{recursive:true});
  writeFileSync(reportPath,JSON.stringify({checkedAt:new Date().toISOString(),scope:'real MomentsQueue/life tick/list; isolatedNpcRuntime and :memory: DB; model/media stubs only',status:failure?'failed':'passed',scenarios:results,...(failure?{failure}:{})},null,2)+'\n');
}
