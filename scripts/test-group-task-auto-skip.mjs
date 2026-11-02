import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {isolatedNpcRuntime} from './npc-test-runtime.mjs';

const runtime=isolatedNpcRuntime(),db=new DatabaseSync(':memory:');
try{
 const {reconcileGroupTaskExpiry,readGroupTaskSkips}=await runtime.load('server/npc/group-task-expiry');
 const {taskItemsForDate,isTaskItemSkipped}=await runtime.load('lib/npc/task-items');
 db.exec('CREATE TABLE npc_group_chats(owner TEXT,id TEXT,data TEXT); CREATE TABLE npc_secretary_completions(owner TEXT,task_id TEXT,completed INTEGER,PRIMARY KEY(owner,task_id))');
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),date='2026-10-18';
 const now=Date.parse('2026-10-18T23:59:59+08:00'),midnight=Date.parse('2026-10-19T00:00:00+08:00');
 const group={id:'synthetic-daily-meals',name:'合成日程群',members:[],messages:[],goal:'合成三餐',
  plan:{id:'synthetic-week',status:'confirmed',days:[date,'2026-10-19'].map(date=>({date,label:'三餐',breakfast:'合成早餐',lunch:'合成午餐',dinner:'合成晚餐'})),shopping:[]}};
 const insert=db.prepare('INSERT INTO npc_group_chats VALUES(?,?,?)');
 insert.run(owner,group.id,JSON.stringify(group));insert.run(other,group.id,JSON.stringify(group));
 const original=JSON.stringify(group),todayRows=taskItemsForDate([group],date);
 db.prepare('INSERT INTO npc_secretary_completions VALUES(?,?,1)').run(owner,todayRows[0].id);
 assert.equal(reconcileGroupTaskExpiry(db,owner,now),false,'nothing skipped while the assigned day remains open');
 assert.deepEqual(readGroupTaskSkips(db,owner),{});
 db.exec('BEGIN IMMEDIATE');assert.equal(reconcileGroupTaskExpiry(db,owner,midnight),true);db.exec('COMMIT');
 let skipped=readGroupTaskSkips(db,owner);
 assert.deepEqual(Object.keys(skipped).sort(),todayRows.slice(1).map(row=>row.id).sort());
 assert.ok(Object.values(skipped).every(at=>at==='2026-10-18T16:00:00.000Z'),'deadline is Shanghai midnight');
 assert.ok(!skipped[todayRows[0].id],'confirmed completion remains completed');
 assert.deepEqual(readGroupTaskSkips(db,other),{},'owner isolation');
 assert.equal(reconcileGroupTaskExpiry(db,owner,midnight+3600000),false,'repeated scans are idempotent');
 assert.equal(db.prepare('SELECT data FROM npc_group_chats WHERE owner=?').get(owner).data,original,'source plan/history remains unchanged');
 assert.ok(taskItemsForDate([group],'2026-10-19').every(item=>!skipped[item.id]&&!isTaskItemSkipped(item,{},'2026-10-19')),'next day retains its own work');
 assert.ok(todayRows.slice(1).every(item=>isTaskItemSkipped(item,{},'2026-10-19')));
 assert.equal(isTaskItemSkipped(todayRows[0],{[todayRows[0].id]:true},'2026-10-19'),false);
 const draft={...group,id:'synthetic-draft',plan:{...group.plan,status:'draft'}};
 const paused={...group,id:'synthetic-paused-reminder',plan:undefined,reminders:[{id:'paused-r',meal:'breakfast',time:'08:00',timezone:'Asia/Shanghai',status:'paused',startDate:date,endDate:date}]};
 insert.run(owner,draft.id,JSON.stringify(draft));insert.run(owner,paused.id,JSON.stringify(paused));
 assert.equal(reconcileGroupTaskExpiry(db,owner,midnight),false,'unconfirmed drafts and inactive reminder rows are not missed executable work');
 assert.deepEqual(readGroupTaskSkips(db,owner),skipped);
 assert.equal(reconcileGroupTaskExpiry(db,owner,Date.parse('2026-10-22T10:00:00+08:00')),true,'offline days settle on the next reconciliation');
 skipped=readGroupTaskSkips(db,owner);assert.ok(taskItemsForDate([group],'2026-10-19').every(item=>skipped[item.id]==='2026-10-19T16:00:00.000Z'));
 insert.run(owner,'synthetic-corrupt-group','invalid-json');
 assert.doesNotThrow(()=>reconcileGroupTaskExpiry(db,owner,Date.parse('2026-10-22T10:00:00+08:00')),'one unreadable source cannot crash the background clock');
 assert.deepEqual(readGroupTaskSkips(db,owner),skipped);
 console.log('PASS group daily auto-skip: Shanghai day boundary, partial/completed retention, upcoming meals intact, offline catch-up, persistent idempotence, transaction safety, inactive draft/reminder guards and owner isolation; synthetic SQLite only');
}finally{db.close();runtime.cleanup();}
