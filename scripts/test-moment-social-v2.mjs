import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'moment-social-v2-'));
let db;
try {
  for(const folder of ['server/npc','lib/npc'])for(const file of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
    const out=join(dir,folder,file.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});
    writeFileSync(out,ts.transpileModule(readFileSync(join(folder,file),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
  const {MomentInteractions}=await import(pathToFileURL(join(dir,'server/npc/moment-interactions.mjs')));
  const {momentActors}=await import(pathToFileURL(join(dir,'server/npc/moment-policy.mjs')));
  assert.deepEqual(momentActors.map(a=>a.id).sort(),['xia-xia','yuan-xiaoman','liu','chen-nian','he-jiawei','zhou-chef','molly'].sort());
  db=new DatabaseSync(':memory:');let now=Date.parse('2026-10-20T10:00:00+08:00');
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),posts=new Map(),calls=[],writes=[];
  for(const actor of momentActors){
    db.exec(`CREATE TABLE ${actor.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${actor.table} VALUES(?,?)`).run(owner+':'+actor.suffix,JSON.stringify({paused:false,relationship:'STATE-'+actor.id,messages:[{text:'PRIVATE-HISTORY-'+actor.id}],queue:actor.id==='chen-nian'?['busy']:[]}));
  }
  // The production-compatible old tables and rows survive the additive migration.
  db.exec(`CREATE TABLE npc_moment_likes(owner TEXT,post TEXT,actor TEXT,name TEXT,at INTEGER,PRIMARY KEY(owner,post,actor));
    CREATE TABLE npc_moment_comments(id TEXT PRIMARY KEY,owner TEXT,post TEXT,actor TEXT,name TEXT,text TEXT,at INTEGER,reply_to TEXT,request TEXT,UNIQUE(owner,post,request));
    CREATE TABLE npc_moment_social_jobs(id TEXT PRIMARY KEY,owner TEXT,post TEXT,kind TEXT,source TEXT,status TEXT,attempts INTEGER DEFAULT 0,at INTEGER,UNIQUE(owner,post,kind,source));`);
  db.prepare('INSERT INTO npc_moment_comments VALUES(?,?,?,?,?,?,?,?,?)').run('old-comment',owner,'history','molly','Molly','旧评论保留',now-1000,null,'old-request');
  db.prepare('INSERT INTO npc_moment_likes VALUES(?,?,?,?,?)').run(owner,'history','liu','柳智敏',now-1000);
  db.prepare('INSERT INTO npc_moment_social_jobs VALUES(?,?,?,?,?,?,?,?)').run('old-job',owner,'history','peers','public-post','done',1,now-1000);
  const post={id:'new-post',personId:'xia-xia',status:'published',text:'今天看展，第二幅画的蓝色很喜欢。',images:['/public-art.jpg'],imageDescriptions:['一幅蓝色抽象画'],reason:'PRIVATE-POST-REASON',internal_context:{secret:'PRIVATE-INTERNAL'}};
  posts.set(post.id,post);
  const actorFrom=p=>momentActors.find(a=>p.startsWith('你是虚构NPC'+a.name+'。'));
  const react=async(_root,prompt)=>{
    const actor=actorFrom(prompt);assert.ok(actor);calls.push({id:actor.id,prompt});
    assert.ok(!prompt.includes('PRIVATE-HISTORY'));assert.ok(!prompt.includes('PRIVATE-POST-REASON'));assert.ok(!prompt.includes('PRIVATE-INTERNAL'));assert.ok(!prompt.includes('PROVIDER-PRIVATE'));
    const state=JSON.parse(prompt.split('【仅本人当前状态；不可写进评论或告诉其他角色】')[1].split('\n')[0]);assert.equal(state.relationship,'STATE-'+actor.id);
    if(prompt.includes('【这次要回应的真实原评论】')){
      const source=JSON.parse(prompt.split('【这次要回应的真实原评论】')[1].split('\n')[0]);
      return source.text==='不用回我'?{action:'silent',reason:'无须接续，尊重公开评论意愿',comment:''}:{action:'reply',reason:'REASON-AUTHOR-ONLY：接住这次具体认可',comment:'🥰'};
    }
    if(actor.id==='yuan-xiaoman')return {like:true,likeReason:'REASON-LIKE-ONLY：喜欢公开画面的配色',comment:'',silentReason:''};
    if(actor.id==='he-jiawei')return {like:true,likeReason:'REASON-HE-ONLY：认可这次看展记录',comment:'',silentReason:''};
    if(actor.id==='liu')return {like:false,comment:'蓝色很好看。',commentReason:'REASON-LIU-ONLY：具体欣赏画面，不做营养点评'};
    if(actor.id==='molly')return {like:true,likeReason:'REASON-MOLLY-ONLY：公开画面有意思',comment:'什么时候轮到上班？',commentReason:'REASON-MOLLY-COMMENT：轻微玩笑'};
    return {like:false,comment:'',silentReason:'这次没有特别想说的话'};
  };
  const reply=async(_root,prompt,options)=>{
    const actor=actorFrom(prompt);assert.ok(actor);writes.push({id:actor.id,prompt,options});
    assert.equal(options.characterId,actor.id==='molly'?'molly-system-secretary':actor.id);
    assert.ok(!prompt.includes('PRIVATE-POST-REASON'));assert.ok(!prompt.includes('PRIVATE-HISTORY'));
    const draft=prompt.split('【已选表达方向；只是草稿，可自然改写】')[1].split('\n')[0];
    return {action:'reply',messages:actor.id==='molly'?[draft]:[{type:'text',text:draft}],event:null,memories:[]};
  };
  const social=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,react,()=>now,(_o,id)=>({visible:id!=='zhou-chef',privateHistory:'PROVIDER-PRIVATE'}));
  social.observe(owner,[post]);await social.tick();
  assert.deepEqual(calls.map(c=>c.id).sort((a,b)=>a.localeCompare(b)),['yuan-xiaoman','liu','he-jiawei','molly'].sort((a,b)=>a.localeCompare(b)));
  let view=social.view(owner,post);assert.equal(view.likeCount,3);assert.equal(view.comments.length,2);
  assert.ok(view.likes.some(l=>l.actorId==='molly'));assert.ok(view.likes.some(l=>l.actorId==='he-jiawei'));
  assert.ok(view.comments.some(c=>c.actorId==='molly'));assert.ok(view.comments.some(c=>c.actorId==='liu'));
  assert.ok(!view.comments.some(c=>c.actorId==='zhou-chef'||c.actorId==='chen-nian'));
  assert.ok(!JSON.stringify(view).includes('REASON-'));assert.ok(!JSON.stringify(view).includes('STATE-'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM npc_moment_social_seen WHERE post=?").get(post.id).n,4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM npc_moment_social_evidence WHERE post=? AND kind IN('like','comment')").get(post.id).n,5);
  assert.equal(db.prepare("SELECT text FROM npc_moment_comments WHERE id='old-comment'").get().text,'旧评论保留');
  assert.equal(db.prepare("SELECT status FROM npc_moment_social_jobs WHERE id='old-job'").get().status,'done');
  assert.equal(social.view(other,post).likeCount,0);assert.equal(social.view(other,post).comments.length,0);
  await social.tick();await social.tick();view=social.view(owner,post);
  assert.equal(view.comments.length,4);assert.equal(view.comments.filter(c=>c.actorId==='xia-xia').length,2);
  const afterCalls=calls.length,afterWrites=writes.length;
  for(let i=0;i<8;i++){social.observe(owner,[post]);await social.tick();}
  assert.equal(calls.length,afterCalls);assert.equal(writes.length,afterWrites);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM npc_moment_social_jobs WHERE post=? AND status='pending'").get(post.id).n,0);
  const requestId=crypto.randomUUID();
  assert.ok(social.interact(owner,post,{action:'like',liked:true,name:'测试用户',actorId:'chen-nian'}));
  assert.ok(social.interact(owner,post,{action:'like',liked:true}));assert.equal(social.view(owner,post).likeCount,4);
  social.interact(owner,post,{action:'like',liked:false});assert.equal(social.view(owner,post).likeCount,3);
  social.interact(owner,post,{action:'comment',text:'这个蓝色真好看',name:'测试用户',requestId,actorId:'chen-nian'});
  social.interact(owner,post,{action:'comment',text:'这个蓝色真好看',requestId});
  assert.equal(social.view(owner,post).comments.filter(c=>c.actorId==='self').length,1);
  await social.tick();view=social.view(owner,post);const self=view.comments.find(c=>c.actorId==='self');assert.ok(view.comments.some(c=>c.replyTo===self.id&&c.actorId==='xia-xia'));
  assert.equal(social.interact(owner,post,{action:'comment',text:'x',requestId:crypto.randomUUID(),replyTo:'absent'}),false);
  social.interact(owner,post,{action:'comment',text:'不用回我',requestId:crypto.randomUUID()});const beforeSilent=social.view(owner,post).comments.length;await social.tick();assert.equal(social.view(owner,post).comments.length,beforeSilent);
  social.stop();
  // All seven identities can author replies, including old Molly history; actor spoofing is ignored.
  for(const actor of momentActors){
    const row=db.prepare(`SELECT data FROM ${actor.table} WHERE id=?`).get(owner+':'+actor.suffix);const s=JSON.parse(row.data);s.queue=[];db.prepare(`UPDATE ${actor.table} SET data=? WHERE id=?`).run(JSON.stringify(s),owner+':'+actor.suffix);
    const p={id:'author-'+actor.id,personId:actor.id,status:'published',text:'公开近况',images:[]};posts.set(p.id,p);
    const instance=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,react,()=>now);
    instance.interact(owner,p,{action:'comment',text:'今天怎么样？',requestId:crypto.randomUUID()});await instance.tick();
    assert.ok(instance.view(owner,p).comments.some(c=>c.actorId===actor.id&&c.replyTo));instance.stop();
  }
  // Missing action reasons never produce likes/comments; a robot's invented bodily experience is rejected.
  const unsafe={id:'unsafe',personId:'xia-xia',status:'published',text:'公开蛋糕',images:[]};posts.set(unsafe.id,unsafe);
  const safe=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,async(_r,p)=>actorFrom(p).id==='molly'?{like:false,comment:'我之前吃过这家。',commentReason:'不成立的经历'}:{like:true,comment:'看着不错'},()=>now);
  safe.observe(owner,[unsafe]);await safe.tick();assert.equal(safe.view(owner,unsafe).likeCount,0);assert.equal(safe.view(owner,unsafe).comments.length,0);safe.stop();
  const gone={id:'gone',personId:'xia-xia',status:'published',text:'删除中的动态',images:[]};posts.set(gone.id,gone);
  const stale=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,async()=>{posts.delete('gone');return {like:true,likeReason:'原来可见',comment:''};},()=>now);
  stale.observe(owner,[gone]);await stale.tick();assert.equal(stale.view(owner,gone).likeCount,0);stale.stop();
  const retryPost={id:'retry',personId:'xia-xia',status:'published',text:'另一场公开展览',images:[]};posts.set(retryPost.id,retryPost);
  const retryCalls=[];let failed=false;
  const retrying=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,async(_r,p)=>{
    const actor=actorFrom(p);retryCalls.push(actor.id);
    if(actor.id==='liu'&&!failed){failed=true;throw Error('isolated stub failure');}
    return {like:actor.id==='yuan-xiaoman',likeReason:'认可公开展览记录',comment:'',silentReason:'暂时没有特别要说的'};
  },()=>now);
  retrying.observe(owner,[retryPost]);await retrying.tick();assert.equal(retrying.view(owner,retryPost).likeCount,1);
  now+=61000;await retrying.tick();assert.equal(retryCalls.filter(id=>id==='yuan-xiaoman').length,1);assert.equal(retrying.view(owner,retryPost).likeCount,1);
  assert.equal(db.prepare("SELECT status FROM npc_moment_social_jobs WHERE post='retry'").get().status,'done');retrying.stop();
  const failingPost={id:'always-fails',personId:'xia-xia',status:'published',text:'不会执行的坏结果',images:[]};posts.set(failingPost.id,failingPost);let failures=0;
  const failing=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,reply,async()=>{failures++;return null;},()=>now);
  failing.observe(owner,[failingPost]);for(let i=0;i<5;i++){await failing.tick();now+=61000;}
  assert.equal(failures,3);assert.equal(failing.view(owner,failingPost).likeCount,0);failing.stop();
  console.log('PASS seven identities, own-state visibility/busy filtering, selective likes and active comments, full dialogue writer identity, internal reasons hidden, old rows retained, idempotent self APIs, owner isolation, silent author choice, no automatic reply loop, Molly participation without bodily claims, stale post cancellation');
} finally {db?.close();rmSync(dir,{recursive:true,force:true});}
