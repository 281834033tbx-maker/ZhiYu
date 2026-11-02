import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'social-test-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const file of readdirSync(folder).filter(n=>n.endsWith('.ts'))){const out=join(dir,folder,file.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,ts.transpileModule(readFileSync(join(folder,file),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);}
 cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
 const {MomentInteractions}=await import(pathToFileURL(join(dir,'server/npc/moment-interactions.mjs')));
 const {momentActors}=await import(pathToFileURL(join(dir,'server/npc/moment-policy.mjs')));
 db=new DatabaseSync(':memory:');const owner=crypto.randomUUID(),other=crypto.randomUUID();let replies=0,peerCalls=0;
 const posts=new Map([['post',{id:'post',personId:'yuan-xiaoman',status:'published',text:'只打算下楼买瓶水的。',images:[],reason:'PRIVATE_REASON_CANARY'}]]),seenPeers=new Set();
 const social=new MomentInteractions(db,dir,(o,id)=>o===owner?posts.get(id):undefined,async(root,prompt,options)=>{replies++;assert.match(prompt,/许晓曼/);assert.match(prompt,/公开评论/);assert.equal(options.characterId,'yuan-xiaoman');assert.ok(!prompt.includes('PRIVATE_REASON_CANARY'));return {action:'reply',messages:[{type:'emoji',text:'🥰'},{type:'text',text:'那我下次还买这个颜色。'}]};},async(root,prompt)=>{
  assert.ok(!prompt.includes('PRIVATE_REASON_CANARY'));
  if(prompt.includes('【这次要回应的真实原评论】'))return {action:'reply',reason:'原评论具体夸了颜色，本人愿意简短接住',comment:'🥰 那我下次还买这个颜色。'};
  peerCalls++;const name=/^你是虚构NPC([^。]+)。/.exec(prompt)?.[1],actor=momentActors.find(a=>a.name===name);assert.ok(actor);assert.notEqual(actor.id,'yuan-xiaoman');assert.ok(!seenPeers.has(actor.id));seenPeers.add(actor.id);
  return {like:actor.id==='xia-xia',likeReason:actor.id==='xia-xia'?'她喜欢这次买花的小惊喜':'',comment:'',commentReason:'',silentReason:actor.id==='xia-xia'?'点个赞就够了':'这次没有额外想说的话'};
 });
 const post=posts.get('post');
 assert.ok(social.interact(owner,post,{action:'like',liked:true,name:'测试用户',actorId:'liu'}));
 assert.ok(social.interact(owner,post,{action:'like',liked:true,name:'测试用户'}));
 assert.equal(social.view(owner,post).likeCount,1);assert.equal(social.view(owner,post).likes[0].actorId,'self');
 social.observe(owner,[post]);await social.tick();assert.equal(peerCalls,6);assert.deepEqual(seenPeers,new Set(momentActors.filter(a=>a.id!==post.personId).map(a=>a.id)));assert.equal(social.view(owner,post).likeCount,2);
 assert.ok(social.view(owner,post).likes.some(l=>l.actorId==='xia-xia'));
 social.interact(owner,post,{action:'like',liked:false});assert.equal(social.view(owner,post).likeCount,1);assert.equal(social.view(owner,post).liked,false);
 const requestId=crypto.randomUUID();social.interact(owner,post,{action:'comment',text:'这个颜色好看',name:'测试用户',requestId});social.interact(owner,post,{action:'comment',text:'这个颜色好看',name:'测试用户',requestId});assert.equal(social.view(owner,post).comments.length,1);
 await social.tick();const comments=social.view(owner,post).comments;assert.equal(comments.length,2);assert.equal(comments[1].actorId,'yuan-xiaoman');assert.equal(comments[1].replyTo,comments[0].id);assert.match(comments[1].text,/🥰/);
 await social.tick();social.observe(owner,[post]);await social.tick();assert.equal(replies,1);assert.equal(peerCalls,6);
 assert.equal(social.view(other,post).comments.length,0);assert.equal(social.view(other,post).likeCount,0);
 assert.equal(social.interact(owner,post,{action:'comment',text:'hi',requestId:crypto.randomUUID(),replyTo:'missing'}),false);
 const next=crypto.randomUUID();social.interact(owner,post,{action:'comment',text:'好呀',name:'测试用户',requestId:next,replyTo:comments[1].id});await social.tick();assert.equal(social.view(owner,post).comments.length,4);
 assert.ok(!JSON.stringify(social.view(owner,post)).includes('PRIVATE_REASON_CANARY'));
 console.log('PASS self like/unlike, two distinct actors=2, seven-person selective NPC decisions, spoof rejection, comment idempotency, NPC emoji+text reply, threaded follow-up, no loops, owner isolation and private-reason exclusion');social.stop();
 const silentPost={...post,id:'silent'};posts.set('silent',silentPost);const silent=new MomentInteractions(db,dir,(o,id)=>posts.get(id),async()=>({action:'silent',messages:[]}),async()=>({action:'silent',reason:'这条路过不必每次回复',comment:''}));silent.interact(owner,silentPost,{action:'comment',text:'路过',requestId:crypto.randomUUID()});await silent.tick();assert.equal(silent.view(owner,silentPost).comments.length,1);silent.stop();console.log('PASS NPC may choose not to reply');
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
