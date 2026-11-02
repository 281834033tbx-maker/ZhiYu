import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,appendFileSync,existsSync,chmodSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadEnv} from 'vite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Operator entry for the current human request. It uses the real production
// queue/provider/media chain, never a generated fixture or a replacement DB.
const root=process.cwd(),out=join(root,'output/moments-live-repair-20261021');
const privateContext=JSON.parse(readFileSync(join(out,'operator-context.json'),'utf8'));
if(privateContext.registeredOwners.length!==1)throw Error('An explicit target account is required.');
const owner=privateContext.registeredOwners[0].ownerId;
const fingerprint=createHash('sha256').update(owner).digest('hex').slice(0,16);
const provider=loadEnv('development',root,'');
for(const key of ['NPC_TEXT_PROVIDER','DEEPSEEK_API_KEY','DEEPSEEK_MODEL'])if(provider[key])process.env[key]=provider[key];
// These are the non-secret values verified from this running restored App.
const recoveryRoot=resolve(root,'../../../..');
process.env.NPC_CODEX_BIN=join(recoveryRoot,'system/Applications/ChatGPT.app/Contents/Resources/codex');
process.env.CODEX_HOME=join(recoveryRoot,'home/.codex');
process.env.NPC_CODEX_MODEL='gpt-5.6-terra';
const control=join(out,'live-run-control.json');
const invocationStarted=Date.now(),runtime=isolatedNpcRuntime(),queues=[];
let db;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reportFile=join(out,'live-publication-results.json');
const persistPrivate=(file,value)=>{
  const temporary=file+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  chmodSync(temporary,0o600);renameSync(temporary,file);
};
try{
  db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));
  db.exec('PRAGMA busy_timeout=5000');
  const registered=db.prepare('SELECT DISTINCT owner_id FROM zhiyu_accounts').all();
  if(registered.length!==1||registered[0].owner_id!==owner)throw Error('Target account changed; stopped before mutation.');
  const {MomentsQueue,momentCharacters}=await runtime.load('server/npc/moments-plugin');
  const configuredTargets=momentCharacters.filter(actor=>actor.kind!=='functional').map(actor=>actor.id);
  const previous=existsSync(control)?JSON.parse(readFileSync(control,'utf8')):null;
  const newRequest=process.argv.includes('--new-request');
  if(previous&&newRequest){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(previous.requestId))throw Error('Previous request ID is invalid; stopped before publication.');
    const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_moment_immediate_targets'").get();
    if(table&&db.prepare("SELECT 1 FROM npc_moment_immediate_targets WHERE owner=? AND request_id=? AND status='queued'").get(owner,previous.requestId))throw Error('The previous request is still queued; resume it without --new-request.');
    persistPrivate(join(out,'live-run-control-'+previous.requestId+'.json'),previous);
  }
  const probeFile=join(out,'provider-image-probe.json');
  const imageProbe=existsSync(probeFile)?JSON.parse(readFileSync(probeFile,'utf8')):null;
  const mediaCapability=imageProbe?.status==='failed'&&imageProbe.code==='IMAGE_TOOL_UNAVAILABLE'
    ?{generation:'unavailable',code:'IMAGE_TOOL_UNAVAILABLE',source:'provider-image-probe.json',checkedAt:imageProbe.checkedAt,providerOrModelSwitched:false}
    :{generation:'unconstrained',source:imageProbe?'provider-image-probe.json':null,checkedAt:imageProbe?.checkedAt||null,providerOrModelSwitched:false};
  const saved=previous&&!newRequest?previous:{version:1,date:'2026-10-21',requestId:randomUUID(),ownerFingerprint:fingerprint,intent:'share_now',
    startedAt:invocationStarted,targets:configuredTargets,mediaCapability,
    baselinePublishedIds:db.prepare("SELECT id FROM npc_moments WHERE owner=? AND status='published'").all(owner).map(row=>row.id)};
  if(saved.version!==1||saved.ownerFingerprint!==fingerprint||saved.intent!=='share_now'||!Number.isFinite(saved.startedAt)
    ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(saved.requestId)
    ||!Array.isArray(saved.baselinePublishedIds)||saved.baselinePublishedIds.some(id=>typeof id!=='string')
    ||!Array.isArray(saved.targets)||saved.targets.length!==configuredTargets.length||new Set(saved.targets).size!==configuredTargets.length
    ||saved.targets.some(id=>!configuredTargets.includes(id)))throw Error('Saved request context is incomplete or differs from this account; stopped before publication.');
  const {requestId,targets,startedAt:started}=saved,before=new Set(saved.baselinePublishedIds);
  const {generateRaw}=await runtime.load('server/npc/codex');
  const {createMomentMediaAdapter}=await runtime.load('server/npc/moment-media');
  const formatDecisions=saved.formatDecisions?[...saved.formatDecisions]:[];
  const auditFile=join(out,'live-model-audit-'+requestId+'.jsonl');
  const audit=entry=>{
    appendFileSync(auditFile,JSON.stringify({...entry,at:new Date().toISOString(),requestId})+'\n',{mode:0o600});chmodSync(auditFile,0o600);
  };
  const realRun=actor=>async(project,prompt,images=[])=>{
    const at=Date.now();
    const phase=prompt.startsWith('你为虚构NPC')?'life_generation':prompt.startsWith('复核一条')?'semantic_review':prompt.startsWith('你是虚构NPC朋友圈图片验收器')?'image_review':'source_review';
    const capabilityContext=phase==='life_generation'&&saved.mediaCapability?.generation==='unavailable'
      ?'\n【宿主已实测的本轮媒体能力】当前同账号、同模型、同配置的真实图片调用返回 image generation tool unavailable，本轮生成新图片不可用。这是选择内容与形式前的真实能力条件，不是改写已有候选或代替你的决策。请在本轮从事件、分享理由、内容到 text_only/image_only/text_image 三种形式完整重新选择；有独立分享意义的文字可以自然选择 text_only；若内容依赖本轮无法取得的图片且没有合规素材，应选择其他有独立意义的近况或 no_post。已有真实且来源、授权、时间线都合规的原图仍按原规则允许，但不得为凑发布乱复用原图。本轮不要再次请求生成新图片，不把此前失败图文直接去图硬转文字，不假称图片已成功、已看到或已附上。所有专业依据、来源、隐私、语气、频率与复核规则继续适用；仍原样返回完整合同及本次真实的 format_reason/image_count_reason。':'';
    const effectivePrompt=prompt+capabilityContext,promptHash=createHash('sha256').update(effectivePrompt).digest('hex');
    try{
      const rawJSON=await generateRaw(project,effectivePrompt,images);
      if(phase==='life_generation'){
        const context=rawJSON?.internal_context||rawJSON?.internalContext||{};
        formatDecisions.push({actor,at:new Date().toISOString(),decision:rawJSON?.decision,format:rawJSON?.post?.format,
          formatReason:context.format_reason||context.formatReason,imageCountReason:context.image_count_reason||context.imageCountReason});
      }
      audit({actor,phase,elapsedMs:Date.now()-at,promptHash,attachmentCount:images.length,
        ...(phase==='life_generation'?{mediaCapability:saved.mediaCapability||null}:{}),rawJSON});return rawJSON;
    }catch(error){
      const safeCode=error instanceof SyntaxError?'MODEL_JSON_INVALID':error instanceof Error&&/timeout|超时/i.test(error.message)?'MODEL_TIMEOUT':error instanceof Error&&/rate limit|quota|速率|额度/i.test(error.message)?'MODEL_RATE_LIMIT':'MODEL_CALL_FAILED';
      audit({actor,phase,elapsedMs:Date.now()-at,promptHash,attachmentCount:images.length,safeCode});throw error;
    }
  };
  // Persist the first baseline and UUID before accepting a request. A restart
  // resumes this same operation even if it interrupted the first real post.
  persistPrivate(control,saved);
  const coordinator=new MomentsQueue(db,root,realRun('coordinator'));queues.push(coordinator);
  const request=coordinator.requestImmediateCheck(owner,targets,{intent:'share_now',requestId});
  if(!request.accepted)throw Error('Immediate request was rejected.');
  persistPrivate(control,{...saved,request});
  console.log(JSON.stringify({event:'requested',requestId,queued:request.queued,skipped:request.skipped,duplicate:request.duplicate}));
  const results=[];let cursor=0;
  const progress=setInterval(()=>{
    try{const state=coordinator.status(owner);console.log(JSON.stringify({event:'progress',elapsedSeconds:Math.round((Date.now()-invocationStarted)/1000),actors:state.actors.filter(actor=>actor.canPublish).map(({character,stage,lastError,attempts})=>({character,stage,lastError,attempts}))}));}
    catch{/* A final diagnostic will preserve any durable failure. */}
  },20000);progress.unref();
  const runActor=async actor=>{
    const completed=saved.finishedAt&&saved.results?.find(item=>item.character===actor);
    if(completed){results.push(completed);return;}
    const skipped=request.skipped.find(item=>item.character===actor);
    if(skipped){results.push({character:actor,status:'skipped',reason:skipped.reason,postIds:[]});return;}
    if(!request.queued.includes(actor)){results.push({character:actor,status:'not_queued',postIds:[]});return;}
    const run=realRun(actor),queue=new MomentsQueue(db,root,run,Date.now,createMomentMediaAdapter(undefined,run));queues.push(queue);
    const deadline=invocationStarted+25*60*1000;
    let last='';
    while(Date.now()<deadline){
      const status=queue.status(owner).actors.find(item=>item.character===actor);
      // Match the private receipt for this exact immediate request. Old
      // scheduled items and later autonomous life posts cannot be counted.
      const fresh=db.prepare("SELECT id FROM npc_moments WHERE owner=? AND character=? AND status='published' AND created>=? AND json_extract(data,'$.source')='life' AND json_extract(data,'$.immediateRequestId')=?").all(owner,actor,started,requestId).map(row=>row.id).filter(id=>!before.has(id));
      if(fresh.length){results.push({character:actor,status:'published',postIds:fresh});return;}
      const task=db.prepare('SELECT status FROM npc_moment_immediate_targets WHERE session=? AND request_id=?').get(owner+':'+momentCharacters.find(c=>c.id===actor).suffix,requestId);
      if(!task||task.status!=='queued'){
        results.push({character:actor,status:status.stage,lastError:status.lastError,postIds:[]});return;
      }
      const stateKey=JSON.stringify([status.stage,status.lastError,status.attempts]);
      if(stateKey!==last){console.log(JSON.stringify({event:'actor',character:actor,stage:status.stage,lastError:status.lastError,attempts:status.attempts}));last=stateKey;}
      await queue.tick(owner,[actor]);
      const after=queue.status(owner).actors.find(item=>item.character===actor);
      if(after.lastError&&after.attempts>=3){results.push({character:actor,status:'failed',lastError:after.lastError,postIds:[]});return;}
      await pause(Math.min(20000,Math.max(1000,(after.nextCheck||Date.now())-Date.now())));
    }
    results.push({character:actor,status:'timed_out',postIds:[]});
  };
  const worker=async()=>{while(cursor<targets.length){const actor=targets[cursor++];await runActor(actor);}};
  try{await Promise.all([worker(),worker()]);}finally{clearInterval(progress);}
  const publishedIds=new Set(results.flatMap(item=>item.postIds));
  const projected=coordinator.list(owner).filter(item=>publishedIds.has(item.id));
  const visibleIds=new Set(projected.map(item=>item.id));
  for(const result of results)if(result.status==='published'&&result.postIds.some(id=>!visibleIds.has(id)))result.status='published_not_visible';
  const report={date:'2026-10-21',requestId,ownerFingerprint:fingerprint,startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),
    mode:'real_configured_model_and_media_pipeline',intent:'share_now',mediaCapability:saved.mediaCapability||null,formatDecisions,request,results,
    posts:projected.map(({id,personId,text,images,createdAt})=>({id,character:personId,text,images,createdAt})),
    usedSyntheticPosts:false,frequencyAndPrivacyAndMediaChecksPreserved:true};
  persistPrivate(reportFile,report);
  persistPrivate(control,{...saved,request,results,formatDecisions,finishedAt:report.finishedAt});
  console.log(JSON.stringify({event:'finished',published:results.filter(item=>item.status==='published').length,results}));
  if(results.some(item=>item.status!=='published'))process.exitCode=2;
}finally{for(const queue of queues)queue.stop();db?.close();runtime.cleanup();}
