import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage} from '../../lib/npc/contracts';
import type {GroupChat} from '../../lib/npc/group-chat';
import type {ProfessionalTask} from '../../lib/npc/professional-task';
import {professionalTasksForDate, taskItemsForDate, shanghaiToday, shiftTaskDate, validTaskDate, type TaskItem} from '../../lib/npc/task-items';
import {reconcileProfessionalTaskState,isCanonicalProfessionalTaskSessionId} from './professional-task-mutation';
import {reconcileGroupTaskExpiry,readGroupTaskSkips} from './group-task-expiry';

export const privateTaskSources = [
  {table:'chen_sessions',suffix:'chen-nian',id:'chen-nian',name:'陈年'},
  {table:'zhou_chef_sessions',suffix:'zhou-chef',id:'zhou-chef',name:'赵一帆'},
  {table:'liu_sessions',suffix:'liu',id:'liu',name:'柳智敏'},
] as const;
export type SecretaryTaskEntry = {
  id:string; title:string; characterId?:string; characterName?:string; groupId?:string;
  dates:string[]; status:string; completed:number; total:number; skipped:number;
};
export type SecretaryTaskSnapshot = {
  today:string; todayEntries:SecretaryTaskEntry[]; allEntries:SecretaryTaskEntry[];
  groups:GroupChat[]; professionalTasks:ProfessionalTask[]; readErrors:number;
};
export function existingTables(db:DatabaseSync) {
  return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name));
}
export function readSecretaryCompletions(db:DatabaseSync,owner:string):Record<string,true> {
  if(!existingTables(db).has('npc_secretary_completions'))return {};
  return Object.fromEntries((db.prepare('SELECT task_id FROM npc_secretary_completions WHERE owner=? AND completed=1').all(owner) as {task_id:string}[]).map(row=>[row.task_id,true]));
}
function assertPrivateTaskSource(state:{characterId?:unknown;professionalTasks?:ProfessionalTask[]},characterId:string){
  if(state.characterId!==undefined&&state.characterId!==characterId||state.professionalTasks!==undefined&&(!Array.isArray(state.professionalTasks)
    ||state.professionalTasks.some(task=>task.characterId!==characterId||!Array.isArray(task.steps))))throw Error('Invalid task source');
}
/** Runs independently of settings/provider availability; no message generation. */
export function reconcileStoredPrivateTasks(db:DatabaseSync,now=Date.now()) {
  const tables=existingTables(db);let changed=0,readErrors=0;
  for(const source of privateTaskSources){
    if(!tables.has(source.table))continue;
    for(const row of db.prepare(`SELECT id,data FROM ${source.table}`).all() as {id:string;data:string}[]){
      if(!isCanonicalProfessionalTaskSessionId(row.id,source.id))continue;
      try{
        const state=JSON.parse(row.data) as {characterId?:unknown;professionalTasks?:ProfessionalTask[];revision?:number};
        assertPrivateTaskSource(state,source.id);
        if(reconcileProfessionalTaskState(state,now)){
          state.revision=(state.revision||0)+1;
          db.prepare(`UPDATE ${source.table} SET data=? WHERE id=?`).run(JSON.stringify(state),row.id);changed++;
        }
      }catch{readErrors++;}
    }
  }
  return {changed,readErrors};
}
export function readSecretaryTasks(db:DatabaseSync,owner:string,now=Date.now()):SecretaryTaskSnapshot {
  reconcileGroupTaskExpiry(db,owner,now);
  const tables=existingTables(db),today=shanghaiToday(now),professionalTasks:ProfessionalTask[]=[],groups:GroupChat[]=[];
  let readErrors=0;
  for(const source of privateTaskSources){
    if(!tables.has(source.table))continue;
    const row=db.prepare(`SELECT data FROM ${source.table} WHERE id=?`).get(`${owner}:${source.suffix}`) as {data:string}|undefined;
    if(!row)continue;
    try {
      const state=JSON.parse(row.data) as {characterId?:unknown;professionalTasks?:ProfessionalTask[];revision?:number};
      assertPrivateTaskSource(state,source.id);
      if(reconcileProfessionalTaskState(state,now)){
        state.revision=(state.revision||0)+1;
        db.prepare(`UPDATE ${source.table} SET data=? WHERE id=?`).run(JSON.stringify(state),`${owner}:${source.suffix}`);
      }
      for(const task of state.professionalTasks||[]) {
        if(task.characterId!==source.id||!Array.isArray(task.steps))throw Error('Invalid task source');
        professionalTasks.push(structuredClone(task));
      }
    }catch{readErrors++;}
  }
  if(tables.has('npc_group_chats'))for(const row of db.prepare('SELECT data FROM npc_group_chats WHERE owner=?').all(owner) as {data:string}[]){
    try{const group=JSON.parse(row.data) as GroupChat;if(!group.leftAt)groups.push(group);}catch{readErrors++;}
  }
  const completions=readSecretaryCompletions(db,owner);
  const skips=readGroupTaskSkips(db,owner);
  const npcEntry=(task:ProfessionalTask,date?:string):SecretaryTaskEntry=>{
    const dated=task.steps.some(step=>!!step.scheduledDate);
    const steps=date&&dated?task.steps.filter(step=>step.scheduledDate===date):task.steps;
    const resolved=steps.length>0&&steps.every(step=>!!step.completedAt||!!step.skippedAt);
    const status=date&&resolved&&['active','paused'].includes(task.status)?(steps.some(step=>!!step.skippedAt)?'skipped':'completed'):task.status;
    return {id:task.id,title:task.title,characterId:task.characterId,
      characterName:privateTaskSources.find(source=>source.id===task.characterId)?.name,
      dates:[...new Set(task.steps.map(step=>step.scheduledDate).filter((value):value is string=>!!value))],
      status,completed:steps.filter(step=>!!step.completedAt).length,total:steps.length,skipped:steps.filter(step=>!!step.skippedAt).length};
  };
  const groupEntry=(item:TaskItem):SecretaryTaskEntry=>({id:item.id,title:item.title,groupId:item.groupId,
    dates:[item.date],status:completions[item.id]?'completed':skips[item.id]?'skipped':item.canComplete?'active':'pending',completed:completions[item.id]?1:0,total:1,skipped:skips[item.id]?1:0});
  const todayEntries=[...professionalTasksForDate(professionalTasks,today,today).map(task=>npcEntry(task,today)),...taskItemsForDate(groups,today).map(groupEntry)];
  const groupDates=[...new Set(groups.flatMap(group=>[
    ...(group.plan?.days||[]).map(day=>day.date),
    ...(group.reminders||[]).flatMap(reminder=>{
      if(!validTaskDate(reminder.startDate)||!validTaskDate(reminder.endDate))return [];
      const count=Math.round((Date.parse(reminder.endDate)-Date.parse(reminder.startDate))/86400000)+1;
      return count>0&&count<=32?Array.from({length:count},(_,index)=>shiftTaskDate(reminder.startDate,index)):[];
    }),
  ]))];
  const allGroupItems=groupDates.flatMap(date=>taskItemsForDate(groups,date));
  const allEntries=[...professionalTasks.map(task=>npcEntry(task)),...allGroupItems.map(groupEntry)];
  return {today,todayEntries,allEntries,groups,professionalTasks,readErrors};
}
export function secretaryTaskContext(snapshot:SecretaryTaskSnapshot) {
  const compact=(items:SecretaryTaskEntry[])=>({count:items.length,entries:items.slice(0,60)});
  return {today:snapshot.today,todayTasks:compact(snapshot.todayEntries),allTasks:compact(snapshot.allEntries),
    readErrors:snapshot.readErrors,partial:snapshot.readErrors>0,
    rule:'只根据实际条目汇总，不将未读取/缺失当作零任务；暂停、取消及已跳过不催办。已跳过保留历史，不算完成，不续做旧任务。'};
}
export function secretaryPlanContext(snapshot:SecretaryTaskSnapshot) {
  const nutrition=snapshot.professionalTasks.filter(task=>task.characterId==='liu'&&task.status!=='cancelled')
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const group=snapshot.groups.filter(item=>item.plan?.status==='confirmed').sort((a,b)=>(b.plan?.confirmedAt||'').localeCompare(a.plan?.confirmedAt||''))[0];
  return {hasPreviousPlan:!!nutrition||!!group,latestPrivatePlan:nutrition?{id:nutrition.id,title:nutrition.title,dates:nutrition.steps.map(step=>step.scheduledDate).filter(Boolean)}:null,
    latestConfirmedGroupPlan:group?.plan?{groupId:group.id,planId:group.plan.id,dates:group.plan.days.map(day=>day.date)}:null,
    rule:'没明确照旧，先由柳智敏确认上周方案是否继续并询问不喜欢的菜；明确照旧仍核对当前限制。'};
}
export function taskReminderCards(db:DatabaseSync,owner:string,snapshot:SecretaryTaskSnapshot,occurrence:string,now:number) {
  // One transaction, no await: another chat cannot be overwritten between load/save.
  for(const source of privateTaskSources){
    if(!existingTables(db).has(source.table))continue;
    const key=`${owner}:${source.suffix}`,row=db.prepare(`SELECT data FROM ${source.table} WHERE id=?`).get(key) as {data:string}|undefined;
    if(!row)continue;
    const state=JSON.parse(row.data) as {messages:ChatMessage[];professionalTasks:ProfessionalTask[];revision?:number;privateHistoryHiddenIds?:string[]};
    if(!Array.isArray(state.messages))continue;
    let changed=reconcileProfessionalTaskState(state,now);
    for(const previous of snapshot.professionalTasks.filter(task=>task.characterId===source.id)){
      const task=state.professionalTasks?.find(candidate=>candidate.id===previous.id);
      if(!task||task.status!=='active'||!task.steps.some(step=>step.scheduledDate===occurrence&&!step.completedAt&&!step.skippedAt))continue;
      const eventId=`task-morning:${task.id}:${occurrence}`;
      if(state.messages.some(message=>message.secretaryEvent?.id===eventId))continue;
      if(state.messages.some(message=>message.part.type==='professional_task'&&message.part.taskId===task.id
        &&!state.privateHistoryHiddenIds?.includes(message.id)&&Date.parse(message.at)<=now&&shanghaiToday(Date.parse(message.at))===occurrence))continue;
      const cardId=crypto.randomUUID();
      state.messages.push({id:cardId,turnId:eventId,role:'assistant',at:new Date(now).toISOString(),origin:'proactive',
        part:{type:'professional_task',taskId:task.id},secretaryEvent:{id:eventId,kind:'task-reminder',targetId:source.id}});
      (task.cardMessageIds||=[]).push(cardId);
      changed=true;
    }
    if(changed){state.revision=(state.revision||0)+1;db.prepare(`UPDATE ${source.table} SET data=? WHERE id=?`).run(JSON.stringify(state),key);}
  }
}
