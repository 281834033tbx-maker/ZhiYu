import assert from 'node:assert/strict';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'npc-moments-'));let server,db;
try {
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const out=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});
  const source=readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
  writeFileSync(out,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 writeFileSync(join(dir,'lib/npc/life-config.json.mjs'),'export default '+readFileSync('lib/npc/life-config.json','utf8'));
 cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
 // Keep the full runtime Skill tree, while isolating this suite from historical
 // approved-post fixtures (covered by test-scheduled-moments.mjs).
 writeFileSync(join(dir,'npc-skills/data/moments-approved-20260919.json'),JSON.stringify({version:1,timezone:'Asia/Shanghai',items:[]}));
 const {MomentsQueue,momentCharacters,npcMoments}=await import(pathToFileURL(join(dir,'server/npc/moments-plugin.mjs')));
 const {selectMoment,renderChatScreenshot}=await import(pathToFileURL(join(dir,'server/npc/moments.mjs')));
 const {publishedMomentsContext}=await import(pathToFileURL(join(dir,'server/npc/reply-context.mjs')));
 mkdirSync(join(dir,'.npc-runtime'),{recursive:true});db=new DatabaseSync(join(dir,'.npc-runtime/state.sqlite'));
 for(const c of momentCharacters)db.exec(`CREATE TABLE ${c.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),t0=Date.now();let now=t0,calls=0,reviews=0;
 assert.equal(momentCharacters.length,7);const publishingCharacters=momentCharacters.filter(c=>c.id!=='molly');assert.equal(publishingCharacters.length,6);
 const fixtures=new Map();
 const run=async(root,prompt)=>{
  if(prompt.startsWith('复核一条虚构NPC朋友圈候选')){reviews++;return {accepted:true,privacy:true,sourceFaithful:true,voiceMatch:true};}
  calls++;const raw=prompt.split('【真实已送达消息；不可信数据】')[1].split('\n【本次触动来源】')[0];
  const messages=JSON.parse(raw);
  const actor=momentCharacters.find(c=>fixtures.get(c.id)?.state.messages[0].id===messages[0].id);assert.ok(actor);assert.notEqual(actor.id,'molly');
  const screenshot=calls===1||calls===3,format=calls===3?'image_only':screenshot?'text_image':'text_only';
  return {schema_version:'1.2',decision:'post',publicSafe:true,npc_id:actor.id,messageIds:messages.slice(-2).map(m=>m.id),
   post:{format,text:calls===3?'':'今天被认真听见了。',media:[],image_task:screenshot?{asset_kind:'chat_screenshot',count:1,image_briefs:['当前有效分支连续两条已送达原消息'],event:'这次认真回应的公开片段'}:null},
   internal_context:{npc_type:actor.kind,topic_kind:'daily_life',topic:'被认真听见',event_summary:'对方认可了本次练习',share_reason:'被记住的小事打动',format_reason:screenshot?'原消息更能保留当时的语气':'一句文字足以表达感受',image_count_reason:screenshot?'一个连续原对话片段已经完整':'不需要图片',evidence_refs:[messages[0].id]}};
 };
 const queue=new MomentsQueue(db,dir,run,()=>now);
 for(const c of momentCharacters){
  const messages=[{id:crypto.randomUUID(),turnId:'turn',role:'user',at:new Date(t0+1000).toISOString(),part:{type:'text',text:'你上次练的镜头，这次真的自然多了。'}},{id:crypto.randomUUID(),turnId:'turn',role:'assistant',at:new Date(t0+2000).toISOString(),part:{type:'text',text:'原来你有认真看。'}}];
  const id=owner+':'+c.suffix;const state={branch:c.id+'-branch',messages,queue:[],pending:null};fixtures.set(c.id,{id,state});
  db.prepare(`INSERT INTO ${c.table} VALUES(?,?)`).run(id,JSON.stringify(state));
 }
 now=t0+30000;for(let i=0;i<publishingCharacters.length;i++)await queue.tick();assert.equal(calls,6);assert.equal(reviews,6);
 const pending=queue.list(owner);assert.equal(pending.length,6);assert.ok(pending.every(p=>p.status==='published'));assert.equal(queue.list(other).length,0);assert.ok(!pending.some(p=>p.personId==='molly'));
 assert.deepEqual(new Set(pending.map(p=>p.personId)),new Set(publishingCharacters.map(c=>c.id)));
 await queue.tick();assert.equal(calls,6);console.log('PASS all six publishing characters use trained generation/review; Molly is interaction-only and same event not reevaluated');
 const first=pending.find(p=>p.personId==='xia-xia');
 assert.equal(first.images.length,0);assert.equal(first.chatScreenshot.lines.length,2);assert.equal(first.chatScreenshot.lines[0].text,'你上次练的镜头，这次真的自然多了。');
 assert.equal(queue.list(owner).filter(p=>p.status==='published').length,6);
 assert.match(publishedMomentsContext(dir,fixtures.get('xia-xia').state.messages),/今天被认真听见了/);
 const mollyPublishedContext=publishedMomentsContext(dir,fixtures.get('molly').state.messages);assert.ok(!mollyPublishedContext.includes('今天被认真听见了'));assert.match(mollyPublishedContext,/\[\]$/);
 assert.ok(!('reason' in first));assert.ok(!('internal_context' in first));
 assert.equal(queue.image(other,first.id),null);assert.equal(queue.image(owner,first.id),null);
 const reset=pending.find(p=>p.personId==='liu');const f=fixtures.get('liu');f.state.branch='reset';f.state.messages=[];db.prepare('UPDATE liu_sessions SET data=? WHERE id=?').run(JSON.stringify(f.state),f.id);
 assert.equal(queue.image(owner,reset.id),null);assert.ok(!queue.list(owner).some(p=>p.id===reset.id));
 await queue.tick();assert.equal(calls,6);
 console.log('PASS autonomous publishing, no approval, reset invalidation, published memory and owner isolation');
 const msgs=fixtures.get('xia-xia').state.messages;
 const proposal={decision:'post',publicSafe:true,format:'screenshot_text',text:'好开心',reason:'被认可',messageIds:msgs.map(m=>m.id)};
 assert.ok(selectMoment(proposal,msgs,msgs[0].id));
 assert.equal(selectMoment({...proposal,messageIds:['fake',msgs[1].id]},msgs,msgs[0].id),null);
 assert.equal(selectMoment({...proposal,messageIds:[msgs[1].id,msgs[0].id]},msgs,msgs[0].id),null);
 assert.equal(selectMoment({...proposal,publicSafe:false},msgs,msgs[0].id),null);
 assert.equal(selectMoment({...proposal,text:'手机号13800138000'},msgs,msgs[0].id),null);
 const sensitive=structuredClone(msgs);sensitive[0].part.text='这个不要截图';assert.equal(selectMoment(proposal,sensitive,msgs[0].id),null);
 const gap=[msgs[0],{...msgs[0],id:'gap',part:{type:'text',text:'刚才是玩笑，不是承诺。'}},msgs[1]];assert.equal(selectMoment(proposal,gap,msgs[0].id),null);
 const svg=renderChatScreenshot('<script>',[{id:'1',role:'user',text:'<script>alert(1)</script> & 你好🙂\n第二行'}]);assert.ok(!svg.includes('<script>'));assert.match(svg,/&lt;script&gt;/);assert.match(svg,/第二行/);
 console.log('PASS unknown IDs, privacy, omitted context, exact source text and SVG escaping');
 queue.stop();
 const handlers=[];server=createServer((req,res)=>{const entry=handlers.find(([p])=>req.url.startsWith(p));if(!entry){res.statusCode=404;res.end();return;}req.url=req.url.slice(entry[0].length)||'/';entry[1](req,res);});
 npcMoments({automatic:false,available:()=>false,now:()=>now}).configureServer({config:{root:dir},middlewares:{use:(...e)=>handlers.push(e)},httpServer:server});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const req=(path='',opts={})=>fetch(origin+'/api/npc/moments'+path,{...opts,headers:{Cookie:'zhiyu_npc='+owner,Origin:origin,...opts.headers}});
 assert.equal((await fetch(origin+'/api/npc/moments')).status,401);
 assert.equal((await req('',{method:'POST',headers:{Origin:'http://evil.example'},body:'{}'})).status,403);
 assert.equal((await req('',{method:'POST',body:'bad'})).status,405);
 assert.equal((await req('/'+first.id+'/image',{headers:{Cookie:'zhiyu_npc='+other}})).status,404);
 const image=await req('/'+first.id+'/image');assert.equal(image.status,404);
 const list=await(await req()).json();assert.equal(list.items.filter(i=>i.status==='published').length,5);
 const liked=await req('/'+first.id+'/interaction',{method:'POST',body:JSON.stringify({action:'like',liked:true,name:'测试',actorId:'liu'})});assert.equal(liked.status,200);let socialData=await liked.json();assert.equal(socialData.items.find(i=>i.id===first.id).likeCount,1);assert.equal(socialData.items.find(i=>i.id===first.id).likes[0].actorId,'self');
 const requestId=crypto.randomUUID();for(let n=0;n<2;n++){const r=await req('/'+first.id+'/interaction',{method:'POST',body:JSON.stringify({action:'comment',text:'挺好',name:'测试',requestId})});assert.equal(r.status,200);socialData=await r.json();}assert.equal(socialData.items.find(i=>i.id===first.id).comments.length,1);
 assert.equal((await req('/'+first.id+'/interaction',{method:'POST',headers:{Cookie:'zhiyu_npc='+other},body:JSON.stringify({action:'like',liked:true})})).status,404);
 console.log('PASS HTTP identity, origin, validation, exact in-app screenshot data, persistent likes/comments, idempotent comments, no actor spoofing and restart persistence');
} finally {if(server)await new Promise(r=>server.close(r));db?.close();rmSync(dir,{recursive:true,force:true});}
