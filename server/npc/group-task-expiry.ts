import type {DatabaseSync} from 'node:sqlite';
import type {GroupChat} from '../../lib/npc/group-chat';
import {isTaskItemSkipped, shanghaiToday, shiftTaskDate, taskItemsForDate, validTaskDate} from '../../lib/npc/task-items';

const hasTable=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

/** Terminal daily outcomes live beside completion records, never in a new plan. */
export function readGroupTaskSkips(db:DatabaseSync,owner:string):Record<string,string>{
  if(!hasTable(db,'npc_secretary_skips'))return {};
  return Object.fromEntries((db.prepare('SELECT task_id,skipped_at FROM npc_secretary_skips WHERE owner=?').all(owner) as {task_id:string;skipped_at:string}[])
    .map(row=>[row.task_id,row.skipped_at]));
}

/** Idempotent and transaction-neutral; safe before a read or inside a write. */
export function reconcileGroupTaskExpiry(db:DatabaseSync,owner:string,now=Date.now()):boolean{
  const today=shanghaiToday(now);
  db.exec('CREATE TABLE IF NOT EXISTS npc_secretary_skips(owner TEXT NOT NULL,task_id TEXT NOT NULL,date TEXT NOT NULL,skipped_at TEXT NOT NULL,PRIMARY KEY(owner,task_id))');
  if(!hasTable(db,'npc_group_chats'))return false;
  const groups:GroupChat[]=[];
  for(const row of db.prepare('SELECT data FROM npc_group_chats WHERE owner=?').all(owner) as {data:string}[]){
    try{const group=JSON.parse(row.data) as GroupChat;if(group&&typeof group==='object'&&!group.leftAt)groups.push(group);}
    catch{/* The task reader separately records corrupt-source readErrors. */}
  }
  const completed=Object.fromEntries(hasTable(db,'npc_secretary_completions')
    ? (db.prepare('SELECT task_id FROM npc_secretary_completions WHERE owner=? AND completed=1').all(owner) as {task_id:string}[]).map(row=>[row.task_id,true]):[]);
  const dates=new Set<string>();
  for(const group of groups){
    for(const day of group.plan?.days||[])if(validTaskDate(day.date)&&day.date<today)dates.add(day.date);
    for(const reminder of group.reminders||[]){
      if(!validTaskDate(reminder.startDate)||!validTaskDate(reminder.endDate))continue;
      const count=Math.round((Date.parse(reminder.endDate)-Date.parse(reminder.startDate))/86400000)+1;
      if(count<1||count>32)continue;
      for(let index=0;index<count;index++){const date=shiftTaskDate(reminder.startDate,index);if(date<today)dates.add(date);}
    }
  }
  const write=db.prepare('INSERT OR IGNORE INTO npc_secretary_skips(owner,task_id,date,skipped_at) VALUES(?,?,?,?)');
  let changed=false;
  for(const date of dates)for(const item of taskItemsForDate(groups,date)){
    if(!isTaskItemSkipped(item,completed,today))continue;
    const skippedAt=new Date(Date.parse(`${date}T00:00:00+08:00`)+86400000).toISOString();
    if(write.run(owner,item.id,date,skippedAt).changes)changed=true;
  }
  return changed;
}
