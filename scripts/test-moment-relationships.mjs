import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'relationship-test-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const file of readdirSync(folder).filter(n=>n.endsWith('.ts'))){const out=join(dir,folder,file.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,ts.transpileModule(readFileSync(join(folder,file),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);}
 writeFileSync(join(dir,'lib/npc/life-config.json.mjs'),'export default '+readFileSync('lib/npc/life-config.json','utf8'));
 cpSync('npc-skills/references',join(dir,'npc-skills/references'),{recursive:true});
 const {MomentRelationshipReactions,validateReaction}=await import(pathToFileURL(join(dir,'server/npc/moment-relationships.mjs')));
 const {createState}=await import(pathToFileURL(join(dir,'lib/npc/engine.mjs')));
 db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER,data TEXT);CREATE TABLE npc_moment_likes(owner,post,actor,at);CREATE TABLE npc_moment_comments(id,owner,post,actor,text,at);CREATE TABLE npc_moments(owner,id,status,data)`);
 let now=Date.parse('2026-09-19T12:00:00Z'),calls=0,speech=0;const posts=new Map();
 const decision={kind:'suspected_betrayal',reason:'有追求表达，看见与别人含蓄暧昧，想问清楚',commentId:'comment',relationshipEvidence:{id:'pursuit',quote:'我想追你'},ask:true,deltas:{trust:-90,mood:-8,jealousy:8,love:-50}};
 const setup=(owner,liked=true)=>{const s=createState('normal');s.messages=[{id:'pursuit',turnId:'t',role:'user',at:new Date(now-60000).toISOString(),part:{type:'text',text:'我想追你'}},{id:'answer',turnId:'t',role:'assistant',at:new Date(now-55000).toISOString(),part:{type:'text',text:'先慢慢了解吧'}}];db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(owner+':xia-xia:normal',s.revision,JSON.stringify(s));const post={id:owner,personId:'yuan-xiaoman',status:'published',text:'有人欠我一趟环游世界',images:[]};posts.set(owner,post);if(liked)db.prepare('INSERT INTO npc_moment_likes VALUES(?,?,?,?)').run(owner,owner,'xia-xia',now);db.prepare('INSERT INTO npc_moment_comments VALUES(?,?,?,?,?,?)').run('comment',owner,owner,'self','是谁呀 嘿嘿',now);db.prepare('INSERT INTO npc_moments VALUES(?,?,?,?)').run(owner,owner,'published',JSON.stringify({format:'text',lines:[{role:'user',text:'PRIVATE_OTHER_CHAT'}]}));return s;};
 const load=o=>JSON.parse(db.prepare('SELECT data FROM sessions WHERE id=?').get(o+':xia-xia:normal').data);
 const save=(o,s)=>{s.revision++;db.prepare('UPDATE sessions SET data=?,revision=? WHERE id=?').run(JSON.stringify(s),s.revision,o+':xia-xia:normal');};
 const get=(o,id)=>o===id?posts.get(id):undefined;
 const decide=async(root,prompt)=>{calls++;assert.ok(!prompt.includes('PRIVATE_OTHER_CHAT'));return decision;};
 const speak=async()=>{speech++;return {action:'reply',messages:[{type:'text',text:'刚看到小满那条动态，你们这是怎么回事呀？'}]};};
 const service=new MomentRelationshipReactions(db,dir,get,decide,speak,()=>now);
 const initial=setup('main');await service.tick();let s=load('main');assert.equal(s.messages.length,3);assert.equal(s.values.mood,initial.values.mood-8);assert.equal(s.values.trust,initial.values.trust-5);assert.equal(s.values.love,initial.values.love);assert.equal(s.relationship,'strangers');assert.equal(s.audits.at(-1).review,'applied');assert.match(s.impressions.at(-1).text,/尚未证实/);await service.tick();now+=120000;await service.tick();assert.equal(calls,1);assert.equal(speech,1);
 db.prepare('INSERT INTO npc_moment_comments VALUES(?,?,?,?,?,?)').run('followup','main','main','self','再来一条',now);await service.tick();assert.equal(calls,1);
 setup('unseen',false);await service.tick();assert.equal(calls,1);
 const sleeping=setup('sleep');now=Date.parse('2026-09-20T00:00:00Z');await service.tick();assert.equal(calls,1);now=Date.parse('2026-09-20T12:00:00Z');await service.tick();assert.equal(load('sleep').messages.length,3);
 setup('quiet');s=load('quiet');s.life={...load('main').life,proactiveEnabled:false};save('quiet',s);await service.tick();assert.equal(load('quiet').messages.length,2);
 setup('race');const racing=new MomentRelationshipReactions(db,dir,get,async()=>{const state=load('race');state.messages.push({id:'new',turnId:'new',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'新消息'}});save('race',state);return decision;},speak,()=>now);await racing.tick();assert.equal(load('race').messages.length,3);assert.equal(load('race').audits.length,0);racing.stop();
 let confirmed=validateReaction({...decision,kind:'confirmed_betrayal',identityConfirmed:true},initial,[{id:'comment',actor:'self',text:'是我'}]);assert.equal(confirmed.kind,'suspected_betrayal');
 initial.messages.push({id:'exclusive',turnId:'e',role:'user',at:new Date(now).toISOString(),part:{type:'text',text:'我们约定只和彼此交往'}});confirmed=validateReaction({...decision,kind:'confirmed_betrayal',identityConfirmed:true,commitmentEvidence:{id:'exclusive',quote:'我们约定只和彼此交往'}},initial,[{id:'comment',actor:'self',text:'是我'}]);assert.equal(confirmed.kind,'confirmed_betrayal');assert.equal(confirmed.deltas.trust,-15);
 assert.throws(()=>validateReaction({...decision,relationshipEvidence:{id:'missing',quote:'我想追你'}},initial,[{id:'comment',actor:'self',text:'是我'}]));
 service.stop();console.log('PASS public-only evidence, own-history validation, suspicion vs commitment, bounded hidden deltas, proactive message, atomic audit, duplicate/reload/new-comment dedup, unseen exclusion, sleep/opt-out, concurrent-message protection');
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
