import type {DatabaseSync} from 'node:sqlite';
import type {GroupChat} from '../../lib/npc/group-chat';
import {taskItemsForDate,validTaskDate,shiftTaskDate,shanghaiToday} from '../../lib/npc/task-items';

export type ReadonlyArrangementStatus='not_started'|'completed'|'overdue'|'skipped';
export type ReadonlyArrangementItem={id:string;title:string;status:ReadonlyArrangementStatus;date:string|null;source:'arrangement'|'professional'|'group'|'board';sourceNpcId?:string;completed:number;total:number;supervisable?:boolean};
const tables=(db:DatabaseSync)=>new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(v=>v.name));
const status=(raw:string,date:string|null,today:string):ReadonlyArrangementStatus=>['done','completed'].includes(raw)?'completed':['skipped','missed','ended','cancelled'].includes(raw)?'skipped':date&&date<today?'overdue':'not_started';
type StoredBoard={contentResetAt?:number;tasks?:Array<{id:string;title:string;date?:string;status:string;npcId?:string;steps?:Array<{done?:boolean}>;count?:{current:number;target:number};completedAt?:string;source?:{kind?:string;id?:string;key?:string;createdAt?:string};manualRecord?:{importedAt?:string}}>};

/** SELECTs and in-memory projection only. Do not call readSecretaryTasks here:
 * it reconciles expiry by writing professional/group records. */
export function readArrangementStatus(db:DatabaseSync,owner:string,now=Date.now()):{items:ReadonlyArrangementItem[];readErrors:number}{
 const names=tables(db),today=shanghaiToday(now),items=new Map<string,ReadonlyArrangementItem>(),groupAliases=new Map<string,string>();let readErrors=0;
 const add=(item:ReadonlyArrangementItem)=>{if(item.id&&item.title)items.set(item.id,item);};
 if(names.has('npc_arrangements'))for(const row of db.prepare("SELECT data FROM npc_arrangements WHERE owner=? AND status!='revoked'").all(owner) as {data:string}[])try{
  const item=JSON.parse(row.data),date=validTaskDate(item.time?.deadline)?item.time.deadline:validTaskDate(item.time?.date)?item.time.date:null;
  add({id:'arrangement:'+item.id,title:item.title,status:status(item.status,date,today),date,source:'arrangement',sourceNpcId:item.sourceNpcId,completed:item.status==='completed'?1:0,total:1});
 }catch{readErrors++;}
 for(const [table,npc] of [['chen_sessions','chen-nian'],['liu_sessions','liu'],['zhou_chef_sessions','zhou-chef']] as const){
  if(!names.has(table))continue;const row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${owner}:${npc}`) as {data:string}|undefined;if(!row)continue;
  try{const state=JSON.parse(row.data);for(const task of state.professionalTasks||[]){if(task.characterId!==npc||!Array.isArray(task.steps))throw Error('Invalid task source');
   const dates=task.steps.filter((s:{completedAt?:string;skippedAt?:string})=>!s.completedAt&&!s.skippedAt).map((s:{scheduledDate?:string})=>s.scheduledDate).filter(validTaskDate).sort();
   {const date=dates[0]||null,steps=task.steps,completed=steps.filter((s:{completedAt?:string})=>s.completedAt).length,skipped=steps.filter((s:{skippedAt?:string})=>s.skippedAt).length;
    const raw=completed===steps.length&&steps.length?'completed':completed+skipped===steps.length&&skipped?'skipped':task.status;
    const id=`professional:${npc}:${task.id}`;add({id,title:task.title,status:status(raw,date,today),date,source:'professional',sourceNpcId:npc,completed,total:steps.length,supervisable:task.status==='active'});
   }
  }}catch{readErrors++;}
 }
 const completions=new Set(names.has('npc_secretary_completions')?(db.prepare('SELECT task_id FROM npc_secretary_completions WHERE owner=? AND completed=1').all(owner) as {task_id:string}[]).map(v=>v.task_id):[]);
 const skips=new Set(names.has('npc_secretary_skips')?(db.prepare('SELECT task_id FROM npc_secretary_skips WHERE owner=?').all(owner) as {task_id:string}[]).map(v=>v.task_id):[]);
 if(names.has('npc_group_chats'))for(const row of db.prepare('SELECT data FROM npc_group_chats WHERE owner=?').all(owner) as {data:string}[])try{
  const group=JSON.parse(row.data) as GroupChat;if(group.leftAt||group.demonstration)continue;const dates=new Set((group.plan?.days||[]).map(v=>v.date).filter(validTaskDate));
  for(const reminder of group.reminders||[])if(validTaskDate(reminder.startDate)&&validTaskDate(reminder.endDate)){const count=Math.round((Date.parse(reminder.endDate)-Date.parse(reminder.startDate))/86400000)+1;if(count>0&&count<=366)for(let i=0;i<count;i++)dates.add(shiftTaskDate(reminder.startDate,i));}
  for(const date of dates)for(const item of taskItemsForDate([group],date)){const id='group:'+item.id,[groupId,sourceId,day,meal]=item.id.split(':').map(decodeURIComponent);if(sourceId?.startsWith('plan:'))groupAliases.set(`group-plan:${groupId}:${sourceId.slice(5)}:${day}:${meal}`,id);add({id,title:item.title,status:status(completions.has(item.id)?'completed':skips.has(item.id)?'skipped':'active',date,today),date,source:'group',completed:completions.has(item.id)?1:0,total:1,supervisable:item.canComplete});}
 }catch{readErrors++;}
 const mergeBoard=(board:StoredBoard)=>{for(const task of board.tasks||[]){if(board.contentResetAt&&Date.parse(task.completedAt||task.source?.createdAt||task.manualRecord?.importedAt||'')<board.contentResetAt)continue;
  const date=validTaskDate(task.date)?task.date:null,steps=Array.isArray(task.steps)?task.steps:[],completed=steps.length?steps.filter(v=>v.done).length:task.count?.current??(task.status==='done'?1:0);
  const item:ReadonlyArrangementItem={id:'board:'+task.id,title:task.title,status:status(task.status,date,today),date,source:'board',sourceNpcId:task.npcId,completed,total:steps.length||task.count?.target||1};
  if(task.source?.kind==='professional'){item.id=`professional:${task.npcId}:${task.source.id}`;if(items.has(item.id))continue;}
  if(task.source?.kind==='group'&&task.source.key&&groupAliases.has(task.source.key))continue;
  item.supervisable=!task.source&&!['paused','ended','missed'].includes(task.status);add(item);
 }};
 // A legacy mirror can outlive a switch to server storage. Apply it first so
 // the server-backed board remains authoritative as well as private/group data.
 if(names.has('npc_dialogue_board_snapshots')){const row=db.prepare('SELECT data FROM npc_dialogue_board_snapshots WHERE owner=?').get(owner) as {data:string}|undefined;if(row)try{mergeBoard(JSON.parse(row.data));}catch{readErrors++;}}
 if(names.has('zhiyu_accounts')&&names.has('zhiyu_account_state')){
  const account=db.prepare('SELECT id FROM zhiyu_accounts WHERE owner_id=?').get(owner) as {id:string}|undefined;
  if(account){const row=db.prepare('SELECT value FROM zhiyu_account_state WHERE account_id=? AND key=?').get(account.id,'zhiyu-task-board-demo-v1:'+account.id) as {value:string|null}|undefined;
   if(row?.value)try{mergeBoard(JSON.parse(row.value));}catch{readErrors++;}
  }
 }
 return {items:[...items.values()],readErrors};
}
