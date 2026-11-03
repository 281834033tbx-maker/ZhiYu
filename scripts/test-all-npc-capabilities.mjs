import assert from 'node:assert/strict';
import ts from 'typescript';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const dir=mkdtempSync(join(tmpdir(),'all-npc-'));let db;
try{
 for(const folder of ['server/npc','lib/npc'])for(const name of readdirSync(folder).filter(n=>n.endsWith('.ts'))){
  const dest=join(dir,folder,name.replace('.ts','.mjs'));mkdirSync(dirname(dest),{recursive:true});
  writeFileSync(dest,ts.transpileModule(readFileSync(join(folder,name),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 for(const name of readdirSync('lib/npc').filter(n=>n.endsWith('.json')))writeFileSync(join(dir,'lib/npc',name+'.mjs'),'export default '+readFileSync(join('lib/npc',name),'utf8'));
 cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
 const load=p=>import(pathToFileURL(join(dir,p+'.mjs')));
 const {createLiu,parseLiu,applyLiu}=await load('lib/npc/liu');
 const {createYuan,parseYuan,applyYuan}=await load('lib/npc/yuan-xiaoman');
 const {createMolly,parseMolly,applyMolly}=await load('lib/npc/molly');
 const {createState,parseOutput,finishTurn}=await load('lib/npc/engine');
 const {ImageQueue}=await load('server/npc/image-worker');const {VoiceQueue}=await load('server/npc/voice-worker');
 const {humanizedPrompt,reviewVoice}=await load('server/npc/codex');
 const {buildPrompt}=await load('server/npc/prompt');const {yuanPrompt}=await load('server/npc/yuan-prompt');
 const {liuPrompt}=await load('server/npc/liu-prompt');const {mollyPrompt}=await load('server/npc/molly-prompt');
 const photo={type:'generate_photo',prompt:'窗边一杯茶，自然下午光线',caption:'刚泡的',withCharacter:false};
 const raw={action:'reply',messages:[photo,{type:'voice',text:'茶还挺烫的'}],event:null,memories:[]};
 const states=[['sessions','xia-xia',createState('normal'),buildPrompt],['yuan_sessions','yuan-xiaoman',createYuan(),yuanPrompt],['liu_sessions','liu',createLiu(),liuPrompt],['molly_sessions','molly-system-secretary',createMolly(),mollyPrompt]];
 db=new DatabaseSync(join(dir,'isolated.sqlite'));const user=crypto.randomUUID();
 for(const [table,character,state,prompt] of states){
  const beforeValues=JSON.stringify(state.values);
  if(table==='sessions')finishTurn(state,'test','给我看看茶，再说句话',parseOutput(raw,''),Date.now(),false);
  if(table==='yuan_sessions')applyYuan(state,parseYuan(raw,''),'test');
  if(table==='liu_sessions')applyLiu(state,parseLiu(raw,''),'test');
  if(table==='molly_sessions')applyMolly(state,parseMolly({intent:'chat',messages:['茶还挺烫的'],voiceIndex:0,photo,address:null,query:null},''),'test');
  assert.equal(JSON.stringify(state.values),beforeValues);
  assert.ok(state.messages.some(m=>m.part.type==='generated_photo'));
  assert.ok(state.messages.some(m=>m.part.type==='voice'));
  const base=prompt(dir,state,'给我看看茶，再说句话');const generation=humanizedPrompt(dir,base);
  assert.ok(generation.includes('全角色自然聊天与基础媒体能力'));
  assert.ok(generation.includes('内向可以短、克制'));
  assert.ok(generation.includes('不复制其表情'));
  let review='';await reviewVoice(dir,base,{action:'reply',messages:[{type:'text',text:'刚泡的茶'}]},async p=>{review=p;return {verdict:'keep',edits:[]}});
  assert.ok(review.includes('全角色自然聊天与基础媒体能力'));
  db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY,${table==='sessions'?'revision INTEGER,':''}data TEXT)`);
  const id=`${user}:${character}${table==='sessions'?':normal':''}`;
  if(table==='sessions')db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(id,state.revision,JSON.stringify(state));else db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(id,JSON.stringify(state));
 }
 const images=[],voices=[];
 const iq=new ImageQueue(db,dir,async(_r,_u,c)=>{images.push(c);return '/api/npc/media/test.png'});
 const vq=new VoiceQueue(db,dir,async(_r,_u,_text,c)=>{voices.push(c);return '/api/npc/audio/test.mp3'});
 for(let i=0;i<4;i++){await iq.tick();await vq.tick();}
 assert.deepEqual(images.sort((a,b)=>a<b?-1:a>b?1:0),['liu','molly-system-secretary','xia-xia','yuan-xiaoman']);
 assert.deepEqual(voices.sort((a,b)=>a<b?-1:a>b?1:0),['liu','molly','xia-xia','yuan-xiaoman']);
 for(const [table] of states){const s=JSON.parse(db.prepare(`SELECT data FROM ${table}`).get().data);assert.ok(s.messages.filter(m=>['voice','generated_photo'].includes(m.part.type)).every(m=>m.part.status==='ready'));}
 const failed=JSON.parse(db.prepare('SELECT data FROM liu_sessions').get().data);const m=failed.messages.find(m=>m.part.type==='generated_photo');m.part.status='failed';db.prepare('UPDATE liu_sessions SET data=?').run(JSON.stringify(failed));
 assert.equal(iq.retry(crypto.randomUUID(),'liu',m.id),false);assert.equal(iq.retry(user,'liu',m.id),true);await iq.tick();
 assert.throws(()=>parseLiu({...raw,messages:[{type:'generated_photo',url:'/fake',status:'ready'}]},''));
 assert.throws(()=>parseMolly({intent:'chat',messages:[],photo:{type:'generated_photo',url:'/fake'},address:null,query:null},''));
 iq.stop();vq.stop();
 console.log('PASS all four roles: generation/review guidance, per-role parsers, isolated photo+voice queues, ownership retry, state preservation, no fabricated URLs');
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
