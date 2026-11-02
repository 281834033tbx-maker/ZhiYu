import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

// Only temporary fixture databases are opened; model and media calls are stubs.
const runtime=isolatedNpcRuntime(),databases=[],queues=[],results=[];
let server;
try {
  writeFileSync(join(runtime.root,'npc-skills/data/moments-approved-20260919.json'),JSON.stringify({version:1,timezone:'Asia/Shanghai',items:[]}));
  const {MomentsQueue,momentCharacters,npcMoments}=await runtime.load('server/npc/moments-plugin');
  const {authLocal}=await runtime.load('server/npc/auth-plugin');
  let now=Date.parse('2026-10-21T14:00:00+08:00');
  function schema(db){for(const c of momentCharacters)db.exec(`CREATE TABLE IF NOT EXISTS ${c.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);}
  function session(db,owner,id='xia-xia',extra={}) {
    const c=momentCharacters.find(c=>c.id===id),key=owner+':'+c.suffix;
    db.prepare(`INSERT OR REPLACE INTO ${c.table} VALUES(?,?)`).run(key,JSON.stringify({branch:'fixture-branch',messages:[],queue:[],pending:null,paused:false,contactLife:{activity:'ordinary'},...extra}));return key;
  }
  function candidate(prompt,sequence=1){
    const sourceId=/本轮可信来源ID：([^。\n]+)/.exec(prompt)?.[1];assert.ok(sourceId);
    return {schema_version:'1.2',decision:'post',publicSafe:true,eventSummary:'独立日常记录'+sequence,nextHours:3,
      post:{format:'text_only',text:'日常记录'+sequence,media:[],image_task:null},
      internal_context:{npc_type:'companion',topic_kind:'daily_life',topic:'日常记录',event_summary:'独立日常记录'+sequence,
        share_reason:'PRIVATE_REASON_FIXTURE',format_reason:'文字足以表达',image_count_reason:'不需要图片',evidence_refs:[sourceId]}};
  }
  const review={accepted:true,privacy:true,sourceFaithful:true,voiceMatch:true};
  function fixture({registered=true,generate,reviewCandidate}={}){
    const db=new DatabaseSync(':memory:');databases.push(db);schema(db);
    const owner=randomUUID(),ghost=randomUUID(),account=randomUUID();
    if(registered){db.exec('CREATE TABLE zhiyu_accounts(id TEXT PRIMARY KEY,owner_id TEXT UNIQUE)');db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?)').run(account,owner);}
    const key=session(db,owner);session(db,ghost);
    let calls=0;
    const run=async(_root,prompt)=>{
      if(prompt.startsWith('复核一条虚构NPC朋友圈候选'))return reviewCandidate?reviewCandidate(prompt):review;
      calls++;return generate?generate(prompt,calls):candidate(prompt,calls);
    };
    const queue=new MomentsQueue(db,runtime.root,run,()=>now);queues.push(queue);
    return {db,owner,ghost,account,key,queue,run,calls:()=>calls};
  }
  async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
  await check('registered owners only; UUID idempotency; scoped share_now; paused/Molly policy',async()=>{
    const h=fixture();
    assert.equal(h.queue.requestImmediateCheck(h.ghost).accepted,false);
    assert.equal(h.queue.status(h.ghost).actors.length,0);
    assert.equal(h.db.prepare('SELECT count(*) n FROM npc_life_moment_checks').get().n,1);
    assert.equal(h.queue.requestImmediateCheck(h.owner,['molly']).accepted,false);
    assert.equal(h.queue.requestImmediateCheck(h.owner,['xia-xia'],{requestId:'bad'}).accepted,false);
    const requestId=randomUUID();const first=h.queue.requestImmediateCheck(h.owner,['xia-xia'],{requestId,intent:'share_now'});
    assert.deepEqual(first.queued,['xia-xia']);assert.equal(first.intent,'share_now');
    h.db.prepare('UPDATE npc_life_moment_checks SET attempts=2 WHERE session=?').run(h.key);
    assert.equal(h.queue.requestImmediateCheck(h.owner,['xia-xia'],{requestId,intent:'share_now'}).duplicate,true);
    assert.equal(h.db.prepare('SELECT attempts FROM npc_life_moment_checks WHERE session=?').get(h.key).attempts,2);
    let sawIntent=false;const queue=new MomentsQueue(h.db,runtime.root,async(root,prompt)=>{
      if(!prompt.startsWith('复核')){sawIntent=prompt.includes('【本次明确分享请求】');}
      return h.run(root,prompt);
    },()=>now);queues.push(queue);await queue.tick(h.owner,['xia-xia']);
    assert.equal(sawIntent,true);assert.equal(h.queue.list(h.owner).length,1);
    assert.equal(JSON.parse(h.db.prepare('SELECT data FROM npc_moments').get().data).immediateRequestId,requestId);
    assert.ok(!JSON.stringify(h.queue.list(h.owner)).includes('immediateRequestId'));
    assert.equal(h.db.prepare('SELECT status FROM npc_moment_immediate_targets').get().status,'completed');
    assert.equal(h.queue.requestImmediateCheck(h.owner,['xia-xia']).skipped[0].reason,'FREQUENCY_LIMIT');
    const publicStatus=JSON.stringify(h.queue.status(h.owner));assert.ok(!publicStatus.includes('PRIVATE_REASON_FIXTURE'));assert.ok(!publicStatus.includes(h.owner));
    session(h.db,h.owner,'liu',{paused:true});assert.equal(h.queue.requestImmediateCheck(h.owner,['liu']).skipped[0].reason,'PAUSED');
  });
  await check('three failures cool down and recover; legacy attempt=3 never locks forever; safe diagnostics',async()=>{
    const h=fixture({generate:(_prompt,n)=>{if(n<=3)throw Error('fixture secret token and private content');return {decision:'no_post',nextHours:3};}});
    h.queue.requestImmediateCheck(h.owner,['xia-xia'],{intent:'share_now'});
    for(let n=1;n<=3;n++){
      await h.queue.tick(h.owner,['xia-xia']);
      const row=h.db.prepare('SELECT * FROM npc_life_moment_checks WHERE session=?').get(h.key);assert.equal(row.attempts,n);assert.equal(row.error,'PIPELINE_FAILED');
      now=row.next_check;
    }
    assert.equal(h.queue.status(h.owner).actors.find(c=>c.character==='xia-xia').stage,'cooldown');
    assert.ok(h.queue.errors(h.owner).includes('PIPELINE_FAILED'));assert.ok(!JSON.stringify(h.queue.status(h.owner)).includes('secret'));
    await h.queue.tick(h.owner,['xia-xia']);assert.equal(h.calls(),4);
    assert.equal(h.db.prepare('SELECT attempts FROM npc_life_moment_checks WHERE session=?').get(h.key).attempts,0);
    h.db.prepare("UPDATE npc_life_moment_checks SET next_check=?,attempts=3,error='old generic failure' WHERE session=?").run(now,h.key);
    await h.queue.tick(h.owner,['xia-xia']);assert.equal(h.calls(),5);
  });
  await check('cross-connection leases stop duplicate generation and fence a stale worker before commit',async()=>{
    const path=join(runtime.root,'lease-fixture.sqlite'),a=new DatabaseSync(path),b=new DatabaseSync(path);databases.push(a,b);schema(a);
    const owner=randomUUID(),key=session(a,owner);let unblock,started,calls=0;
    const began=new Promise(r=>{started=r;}),wait=new Promise(r=>{unblock=r;});
    const run=async(_root,prompt)=>{if(prompt.startsWith('复核'))return review;calls++;started();await wait;return candidate(prompt);};
    const q1=new MomentsQueue(a,runtime.root,run,()=>now),q2=new MomentsQueue(b,runtime.root,run,()=>now);queues.push(q1,q2);
    q1.requestImmediateCheck(owner,['xia-xia'],{intent:'share_now'});
    const job=q1.tick(owner,['xia-xia']);await began;await q2.tick(owner,['xia-xia']);assert.equal(calls,1);
    // Simulate another process taking an expired lease while old generation was pending.
    a.prepare('UPDATE npc_moment_leases SET token=?,expires=? WHERE session=?').run(randomUUID(),now+120000,key);
    a.prepare("UPDATE npc_moment_runtime_state SET stage='new_worker',last_error='' WHERE session=?").run(key);
    unblock();await job;
    assert.equal(a.prepare('SELECT count(*) n FROM npc_moments').get().n,0);
    assert.equal(a.prepare('SELECT stage FROM npc_moment_runtime_state WHERE session=?').get(key).stage,'new_worker');
  });
  await check('legacy no-auth fixture fallback is preserved',async()=>{
    const h=fixture({registered:false});assert.equal(h.queue.requestImmediateCheck(h.owner,['xia-xia']).accepted,true);
  });
  await check('inner event summary survives real-contract output; life-only simulation context; immediate intent and automatic choice remain distinct',async()=>{
    let reviewed=false;
    const h=fixture({generate:prompt=>{
      assert.match(prompt,/【宿主背景生活生成职责】/);assert.match(prompt,/不因已有事件为空或今天没有聊天就直接no_post/);
      assert.match(prompt,/用户本轮明确命令现在发布/);assert.match(prompt,/不输出未来scheduled_at/);
      const value=candidate(prompt);delete value.eventSummary;return value;
    },reviewCandidate:prompt=>{
      const marker='【本人已落地来源正文/当前生活，及本次低风险虚构事件候选；新ID本身不证明事件已发生】';
      const context=JSON.parse(prompt.split(marker)[1].split('\n')[0]);
      assert.equal(context.sourceKind,'npc_background_life_candidate');assert.equal(context.newLowRiskFictionalEvent,'独立日常记录1');
      assert.match(prompt,/本次待确认候选/);assert.match(prompt,/重大人生变化、实际用户\/学员成果、他人返图许可/);reviewed=true;return review;
    }});
    h.queue.requestImmediateCheck(h.owner,['xia-xia'],{intent:'share_now'});await h.queue.tick(h.owner,['xia-xia']);
    assert.equal(reviewed,true);assert.equal(h.queue.list(h.owner).length,1);
    assert.equal(h.db.prepare('SELECT summary FROM npc_life_events').get().summary,'独立日常记录1');
    const automatic=fixture({generate:prompt=>{
      assert.ok(!prompt.includes('【本次明确分享请求】'));assert.match(prompt,/自动模式保留本人分享概率和不发选择/);
      return {decision:'no_post',reason_codes:['CHARACTER_WOULD_NOT_SHARE']};
    }});
    automatic.db.prepare('UPDATE npc_life_moment_checks SET next_check=? WHERE session=?').run(now,automatic.key);
    await automatic.queue.tick(automatic.owner,['xia-xia']);assert.equal(automatic.queue.list(automatic.owner).length,0);
    assert.equal(automatic.queue.status(automatic.owner).actors.find(c=>c.character==='xia-xia').decisionReason,'NO_POST_CHARACTER_WOULD_NOT_SHARE');
  });
  await check('no_post stores only a whitelisted diagnostic code and persists after restart',async()=>{
    const secret='PRIVATE_REASON_TOKEN_MUST_NOT_PERSIST';
    const h=fixture({generate:()=>({decision:'no_post',reason:secret,reason_codes:[secret,'PRIVACY_RISK']})});
    h.queue.requestImmediateCheck(h.owner,['xia-xia'],{intent:'share_now'});await h.queue.tick(h.owner,['xia-xia']);
    const row=h.db.prepare('SELECT * FROM npc_moment_runtime_state WHERE session=?').get(h.key);
    assert.equal(row.stage,'no_post');assert.equal(row.last_error,'NO_POST_PRIVACY_RISK');assert.ok(!JSON.stringify(row).includes(secret));
    const fresh=new MomentsQueue(h.db,runtime.root,h.run,()=>now);queues.push(fresh);
    const status=fresh.status(h.owner).actors.find(c=>c.character==='xia-xia');assert.equal(status.decisionReason,'NO_POST_PRIVACY_RISK');assert.equal(status.lastError,'');
    assert.ok(!JSON.stringify(fresh.status(h.owner)).includes(secret));assert.equal(fresh.list(h.owner).length,0);
  });
  await check('chat context receives no background-life simulation permission',async()=>{
    let reviewed=false;
    const messages=[{id:randomUUID(),turnId:'fixture',role:'user',at:new Date(now+1000).toISOString(),part:{type:'text',text:'你这次分享挺有意思。'}},
      {id:randomUUID(),turnId:'fixture',role:'assistant',at:new Date(now+2000).toISOString(),part:{type:'text',text:'我也挺喜欢。'}}];
    const h=fixture({generate:prompt=>{
      assert.ok(prompt.startsWith('你是虚构NPC的朋友圈分享意愿判定器'));const value=candidate(prompt);value.messageIds=messages.map(m=>m.id);return value;
    },reviewCandidate:prompt=>{
      assert.ok(!prompt.includes('【本轮背景生活模拟权限】'));assert.ok(!prompt.includes('"sourceKind":"npc_background_life_candidate"'));reviewed=true;return review;
    }});
    session(h.db,h.owner,'xia-xia',{messages});now+=30000;await h.queue.tick(h.owner,['xia-xia']);
    assert.equal(reviewed,true);assert.equal(h.queue.list(h.owner).length,1);assert.equal(h.db.prepare('SELECT count(*) n FROM npc_life_events').get().n,0);
  });
  await check('real auth middleware gates run-now; body/origin/account checks; health has only operational fields',async()=>{
    mkdirSync(join(runtime.root,'.npc-runtime'),{recursive:true});
    const handlers=[];
    server=createServer((req,res)=>{
      let index=0;const dispatch=()=>{
        const entry=handlers[index++];if(!entry){res.statusCode=404;res.end();return;}
        if(typeof entry[0]==='function'){entry[0](req,res,dispatch);return;}
        const [prefix,fn]=entry;if(!req.url.startsWith(prefix)){dispatch();return;}
        const original=req.url;req.url=req.url.slice(prefix.length)||'/';fn(req,res,()=>{req.url=original;dispatch();});
      };dispatch();
    });
    const fake={config:{root:runtime.root},middlewares:{use:(...args)=>handlers.push(args)},httpServer:server};
    authLocal().configureServer(fake);
    const db=new DatabaseSync(join(runtime.root,'.npc-runtime/state.sqlite'));databases.push(db);schema(db);
    const owner=randomUUID(),other=randomUUID(),account=randomUUID(),token='c'.repeat(64);
    db.prepare('INSERT INTO zhiyu_accounts VALUES(?,?,?,?,?,?)').run(account,'fixtureuser','salt','digest',owner,now);
    db.prepare('INSERT INTO zhiyu_auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),account,Date.now()+600000);
    session(db,owner);session(db,other);
    npcMoments({automatic:false,available:()=>false,now:()=>now,generate:async()=>{throw Error('must never call provider');}}).configureServer(fake);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port,body={requestId:randomUUID(),intent:'share_now',characters:['xia-xia']};
    const request=(path,options={})=>fetch(origin+path,{...options,headers:{Origin:origin,Cookie:'zhiyu_auth='+token+'; zhiyu_npc='+other,'Content-Type':'application/json','x-zhiyu-account':account,...options.headers}});
    const path='/api/npc/moments/run-now';
    assert.equal((await request(path,{method:'POST',headers:{Cookie:'zhiyu_npc='+owner},body:JSON.stringify(body)})).status,401);
    assert.equal((await request(path,{method:'POST',headers:{Origin:'http://evil.example'},body:JSON.stringify(body)})).status,403);
    assert.equal((await request(path,{method:'POST',headers:{'x-zhiyu-account':randomUUID()},body:JSON.stringify(body)})).status,409);
    assert.equal((await request(path,{method:'POST',body:JSON.stringify({...body,owner:other})})).status,400);
    const response=await request(path,{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,202);const queued=await response.json();assert.deepEqual(queued.queued,['xia-xia']);
    const target=db.prepare('SELECT owner FROM npc_moment_immediate_targets').get();assert.equal(target.owner,owner);
    const repeated=await request(path,{method:'POST',body:JSON.stringify(body)});assert.equal((await repeated.json()).duplicate,true);
    const status=await(await request('/api/npc/moments/status')).json();assert.equal(status.registeredOwner,true);assert.ok(!JSON.stringify(status).includes(other));
    const health=await(await fetch(origin+'/api/zhiyu-moments-health')).json();assert.deepEqual(Object.keys(health).sort(),['version','startedAt','lastTickAt','workerRunning','modelAvailable'].sort());
    await new Promise(resolve=>server.close(resolve));server=null;
  });
  mkdirSync('output/moments-live-repair-20261021',{recursive:true});
  writeFileSync('output/moments-live-repair-20261021/recovery-isolated-tests.json',JSON.stringify({status:'passed',mode:'isolated-fixture-only',cases:results},null,2)+'\n');
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const q of queues)q.stop();for(const db of databases)db.close();runtime.cleanup();
}
