import assert from 'node:assert/strict';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=mkdtempSync(join(tmpdir(),'life-moments-'));let db;
try{
  for(const folder of ['server/npc','lib/npc'])for(const file of readdirSync(folder).filter(name=>name.endsWith('.ts'))){
    const out=join(dir,folder,file.replace('.ts','.mjs'));mkdirSync(dirname(out),{recursive:true});
    const source=readFileSync(join(folder,file),'utf8').replace(/(from\s+['"])(\.[^'"]+)(['"])/g,'$1$2.mjs$3');
    writeFileSync(out,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  writeFileSync(join(dir,'lib/npc/life-config.json.mjs'),'export default '+readFileSync('lib/npc/life-config.json','utf8'));
  cpSync('npc-skills',join(dir,'npc-skills'),{recursive:true});
  // This suite isolates autonomous posts; the approved historical import has its
  // own scheduled-moments suite and must not seed unrelated production examples.
  writeFileSync(join(dir,'npc-skills/data/moments-approved-20260919.json'),JSON.stringify({version:1,timezone:'Asia/Shanghai',items:[]}));
  const {MomentsQueue,momentCharacters,momentFrequencyPolicy}=await import(pathToFileURL(join(dir,'server/npc/moments-plugin.mjs')));
  db=new DatabaseSync(':memory:');
  for(const c of momentCharacters)db.exec(`CREATE TABLE ${c.table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
  const owner=crypto.randomUUID(),xia=momentCharacters.find(c=>c.id==='xia-xia');
  let now=Date.parse('2026-09-20T00:00:00Z'),calls=0,reviews=0;
  const state={branch:'life-branch',messages:[],queue:[],pending:null,paused:false,values:{mood:70},relationship:'strangers'};
  const session=owner+':'+xia.suffix;db.prepare('INSERT INTO sessions VALUES(?,?)').run(session,JSON.stringify(state));
  const generate=async(root,prompt)=>{
    if(prompt.startsWith('复核一条虚构NPC朋友圈候选')){reviews++;return {accepted:true,privacy:true,sourceFaithful:true,voiceMatch:true};}
    calls++;assert.match(prompt,/朋友圈不依赖用户聊天/);assert.match(prompt,/普通美食|普通饭/);
    const sourceId=/本轮可信来源ID：([^。\n]+)/.exec(prompt)?.[1];assert.ok(sourceId,'host supplies the real event source ID');
    return {schema_version:'1.2',decision:'post',publicSafe:true,importance:.82,eventType:'creative',eventSummary:`第${calls}个独立生活事件`,nextHours:3,
      post:{format:'text_only',text:`生活事件第${calls}条。`,media:[],image_task:null},
      internal_context:{npc_type:'companion',topic_kind:'daily_life',topic:`第${calls}个独立生活事件`,event_summary:`第${calls}个独立生活事件`,share_reason:'这次结果对自己有阶段意义',format_reason:'简短文字足以表达本次感受',image_count_reason:'不需要图片',evidence_refs:[sourceId]}};
  };
  const queue=new MomentsQueue(db,dir,generate,()=>now);
  now+=momentFrequencyPolicy.lifeCheckMinMs;await queue.tick();
  let items=queue.list(owner);assert.equal(items.length,1);assert.equal(items[0].personId,'xia-xia');assert.equal(items[0].images.length,0);assert.equal(items[0].chatScreenshot,undefined);assert.equal(calls,1);
  assert.equal(db.prepare('SELECT count(*) n FROM npc_life_events').get().n,1);
  // Force an event check one hour later: it is inside the interval, so no model
  // evaluation, event row, or delayed candidate may be created.
  now+=3600000;db.prepare('UPDATE npc_life_moment_checks SET next_check=? WHERE session=?').run(now,session);await queue.tick();
  assert.equal(calls,1);assert.equal(queue.list(owner).length,1);assert.equal(db.prepare('SELECT count(*) n FROM npc_life_events').get().n,1);
  // At the two-hour boundary a new event may publish immediately.
  now+=3600000;db.prepare('UPDATE npc_life_moment_checks SET next_check=? WHERE session=?').run(now,session);await queue.tick();
  assert.equal(calls,2);assert.equal(reviews,2);assert.equal(queue.list(owner).length,2);
  for(let n=0;n<2;n++){now+=2*3600000;db.prepare('UPDATE npc_life_moment_checks SET next_check=? WHERE session=?').run(now,session);await queue.tick();}
  items=queue.list(owner);assert.equal(items.length,2);assert.equal(calls,2);
  now+=2*3600000;db.prepare('UPDATE npc_life_moment_checks SET next_check=? WHERE session=?').run(now,session);await queue.tick();
  assert.equal(queue.list(owner).length,2);assert.equal(calls,2);assert.equal(reviews,2);
  assert.equal(db.prepare("SELECT count(*) n FROM npc_moment_publication_receipts").get().n,2);
  assert.equal(db.prepare("SELECT count(*) n FROM npc_life_events WHERE json_extract(data,'$.status')='pending'").get().n,0);
  assert.equal(momentFrequencyPolicy.maxDaily,2);
  assert.equal(momentFrequencyPolicy.minGapMs,2*3600000);
  const legacy=crypto.randomUUID();db.prepare('INSERT INTO npc_life_events VALUES(?,?,?,?,?,?,?,?)').run(legacy,owner,session,'xia-xia','life-branch',now,'旧等待事件',JSON.stringify({status:'pending',text:'不应补发'}));
  const restarted=new MomentsQueue(db,dir,generate,()=>now);assert.equal(JSON.parse(db.prepare('SELECT data FROM npc_life_events WHERE id=?').get(legacy).data).status,'discarded_by_interval_policy');restarted.stop();
  queue.stop();
  console.log('PASS life moments run without chat through Skill1.2 generation/review, discard interval events without queueing, enforce two-hour spacing and two-post daily maximum');
}finally{db?.close();rmSync(dir,{recursive:true,force:true});}
