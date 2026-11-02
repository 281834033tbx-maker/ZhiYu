'use client';
import {useCallback, useSyncExternalStore} from 'react';
import type {ProfessionalTask} from '../../lib/npc/professional-task';
import {projectProfessionalTaskExpiry} from '../../lib/npc/professional-task-expiry';
import {freezeProfessionalTaskStepTimer,freezeProfessionalTaskTimers,mutateProfessionalTaskTimer} from '../../lib/npc/professional-task-timer';
import {completeProfessionalTaskSession,freezeProfessionalTaskSessions,mutateProfessionalTaskSession,reconcileProfessionalTaskSessions} from '../../lib/npc/professional-task-session';
import {npcFetch} from './npc-fetch';
import {shanghaiToday, taskScheduleOptions} from './task-items';

type Operation = {eventId:string; taskId:string; localAt:string} & (
  | {action:'task_step'; stepId:string; completed:boolean}
  | {action:'task_status'; status:ProfessionalTask['status']}
  | {action:'task_step_date'; stepId:string; scheduledDate:string}
  | {action:'task_timer'; stepId:string; operation:'start'|'pause'|'resume'}
  | {action:'task_session_start'}
  | {action:'task_session_complete'; expectedSessionId:string}
);
type AccountTasks = {base:ProfessionalTask[]; operations:Operation[]; snapshot:readonly ProfessionalTask[]; signature:string; day?:string; sessionRevisions:Record<string,number>; listeners:Set<()=>void>; clock?:ReturnType<typeof setInterval>};
const empty:readonly ProfessionalTask[]=Object.freeze([]);
const accounts=new Map<string,AccountTasks>();
const queues=new Map<string,Promise<void>>();
function accountTasks(accountId:string){
  let state=accounts.get(accountId);
  if(!state){state={base:[],operations:[],snapshot:empty,signature:'[]',sessionRevisions:{},listeners:new Set()};accounts.set(accountId,state);}
  return state;
}
function publish(state:AccountTasks){
  const now=Date.now();state.day=shanghaiToday(now);
  const tasks=state.base.map(source=>{
    const task=projectProfessionalTaskExpiry(source,now);
    const operations=state.operations.filter(operation=>operation.taskId===task.id);
    if(!operations.length)return task;
    const next=structuredClone(task);
    for(const operation of operations){
      if(next.status==='skipped')continue;
      next.updatedAt=operation.localAt;
      if(operation.action==='task_session_complete'){
        const revision=next.revision;
        try{completeProfessionalTaskSession(next,operation.expectedSessionId,revision,Date.parse(operation.localAt));}catch{}
        next.revision=revision;continue;
      }
      if(operation.action==='task_session_start'){
        const revision=next.revision;
        try{mutateProfessionalTaskSession(next,'start',revision,Date.parse(operation.localAt));}catch{}
        next.revision=revision;continue;
      }
      if(operation.action==='task_timer'){
        const revision=next.revision;
        // A newer remote state may invalidate a pending local timer action.
        // Keep rendering that server state until its queued save is rejected.
        try{mutateProfessionalTaskTimer(next,operation.stepId,operation.operation,revision,Date.parse(operation.localAt));}catch{}
        next.revision=revision;continue;
      }
      if(operation.action==='task_status'){
        if(operation.status!=='active'){
          freezeProfessionalTaskTimers(next,Date.parse(operation.localAt));
          freezeProfessionalTaskSessions(next,operation.status==='cancelled'?'cancelled':'paused',Date.parse(operation.localAt));
        }
        next.status=operation.status;continue;
      }
      const step=next.steps.find(item=>item.id===operation.stepId);
      if(!step||step.skippedAt)continue;
      if(operation.action==='task_step_date'){step.scheduledDate=operation.scheduledDate;continue;}
      if(operation.completed){step.completedAt=step.completedAt||operation.localAt;freezeProfessionalTaskStepTimer(step,Date.parse(operation.localAt));}else delete step.completedAt;
      if(next.steps.every(item=>item.completedAt||item.skippedAt)){next.status=next.steps.some(item=>item.skippedAt)?'skipped':'completed';freezeProfessionalTaskTimers(next,Date.parse(operation.localAt));}else if(next.status==='completed')next.status='active';
      reconcileProfessionalTaskSessions(next,Date.parse(operation.localAt));
    }
    return next;
  });
  const signature=JSON.stringify(tasks);
  if(signature===state.signature)return;
  state.signature=signature;state.snapshot=Object.freeze(tasks);state.listeners.forEach(listener=>listener());
}
/** Sessions and all task views share this account-scoped server snapshot. Older polls cannot undo a newer save. */
export function ingestProfessionalTasks(accountId:string,tasks:ProfessionalTask[],sessionRevision?:number,characterId:ProfessionalTask['characterId']=tasks[0]?.characterId||'zhou-chef'){
  if(!accountId||!Array.isArray(tasks))return;
  const state=accountTasks(accountId);
  if(typeof sessionRevision==='number'&&Number.isFinite(sessionRevision)){
    if(sessionRevision<(state.sessionRevisions[characterId]??-1))return;
    state.sessionRevisions[characterId]=sessionRevision;
  }
  const known=new Map(state.base.map(task=>[task.id,task]));
  for(const task of tasks){const previous=known.get(task.id);if(!previous||task.revision>=previous.revision)known.set(task.id,task);}
  // Tasks have lifecycle statuses, so hiding a chat message never removes their independent record.
  state.base=[...known.values()];publish(state);
}
export function readProfessionalTasks(accountId:string):readonly ProfessionalTask[]{return accountId?accountTasks(accountId).snapshot:empty;}
function currentTask(accountId:string,taskId:string){
  const task=readProfessionalTasks(accountId).find(item=>item.id===taskId);
  return task?projectProfessionalTaskExpiry(task,Date.now()):undefined;
}
export function useProfessionalTasks(accountId:string){
  const subscribe=useCallback((listener:()=>void)=>{
    if(!accountId)return()=>{};
    const state=accountTasks(accountId);publish(state);state.listeners.add(listener);
    // Expiry is visible at a day boundary even before the next server poll.
    state.clock ||= setInterval(()=>{if(state.day!==shanghaiToday(Date.now()))publish(state);},30_000);
    return()=>{state.listeners.delete(listener);if(!state.listeners.size&&state.clock){clearInterval(state.clock);delete state.clock;}};
  },[accountId]);
  const snapshot=useCallback(()=>readProfessionalTasks(accountId),[accountId]);
  return useSyncExternalStore(subscribe,snapshot,()=>empty);
}
export async function refreshProfessionalTasks(accountId:string){
  if(!accountId)return;
  // Each character has its own session revision; one cannot suppress the other.
  const results=await Promise.allSettled((['zhou-chef','chen-nian','liu'] as const).map(async characterId=>{
    const response=await npcFetch(`/api/npc/${characterId}?mode=normal`,{cache:'no-store',headers:{'X-Zhiyu-Account':accountId}});
    const result=await response.json() as {professionalTasks?:ProfessionalTask[];revision?:number;error?:string};
    if(!response.ok)throw Error(result.error||'任务暂时无法同步，请稍后重试。');
    if(Array.isArray(result.professionalTasks))ingestProfessionalTasks(accountId,result.professionalTasks,result.revision,characterId);
  }));
  const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
}
async function saveOperation(accountId:string,operation:Operation){
  if(!accountId)throw Error('账号尚未加载，请稍后重试。');
  const state=accountTasks(accountId);
  if(!state.base.some(task=>task.id===operation.taskId))throw Error('任务尚未加载，请稍后重试。');
  state.operations.push(operation);publish(state);
  const queueKey=JSON.stringify([accountId,operation.taskId]);
  const previous=queues.get(queueKey)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
    const task=state.base.find(item=>item.id===operation.taskId);
    if(!task)throw Error('任务尚未加载，请稍后重试。');
    const common={action:operation.action,eventId:operation.eventId,taskId:operation.taskId};
    const payload=operation.action==='task_step'?{...common,stepId:operation.stepId,completed:operation.completed}
      :operation.action==='task_step_date'?{...common,stepId:operation.stepId,scheduledDate:operation.scheduledDate}
      :operation.action==='task_timer'?{...common,stepId:operation.stepId,operation:operation.operation}
      :operation.action==='task_session_start'?common
      :operation.action==='task_session_complete'?{...common,expectedSessionId:operation.expectedSessionId}
      :{...common,status:operation.status};
    const response=await npcFetch(`/api/npc/${task.characterId}?mode=normal`,{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify({...payload,expectedRevision:task.revision})});
    const result=await response.json() as {professionalTasks?:ProfessionalTask[];revision?:number;error?:string};
    if(Array.isArray(result.professionalTasks))ingestProfessionalTasks(accountId,result.professionalTasks,result.revision,task.characterId);
    if(!response.ok)throw Error(result.error||(response.status===409?'任务已更新，请再点一次。':'任务状态未保存，请稍后重试。'));
    if(!Array.isArray(result.professionalTasks))throw Error('任务状态尚未确认，请同步后重试。');
  }).finally(()=>{
    state.operations=state.operations.filter(item=>item.eventId!==operation.eventId);publish(state);
    if(queues.get(queueKey)===work)queues.delete(queueKey);
  });
  queues.set(queueKey,work);await work;
}
export async function setProfessionalTaskStep(accountId:string,taskId:string,stepId:string,completed:boolean){
  const task=currentTask(accountId,taskId),step=task?.steps.find(item=>item.id===stepId);
  if(!task||!step)throw Error('任务尚未加载，请稍后重试。');
  if(task.status==='skipped'||step.skippedAt)throw Error('已跳过的任务不能修改。');
  if(!!step.completedAt===completed)return;
  if(task.status==='cancelled')throw Error('任务已结束。');
  if(completed&&task.status==='paused')throw Error('请先继续任务。');
  await saveOperation(accountId,{action:'task_step',taskId,stepId,completed,eventId:crypto.randomUUID(),localAt:new Date().toISOString()});
}
export async function setProfessionalTaskStatus(accountId:string,taskId:string,status:ProfessionalTask['status']){
  const task=currentTask(accountId,taskId);
  if(!task)throw Error('任务尚未加载，请稍后重试。');
  if(task.status==='skipped'||status==='skipped')throw Error('已跳过的任务不能恢复，请重新安排。');
  if(task.status===status)return;
  await saveOperation(accountId,{action:'task_status',taskId,status,eventId:crypto.randomUUID(),localAt:new Date().toISOString()});
}
export async function setProfessionalTaskTimer(accountId:string,taskId:string,stepId:string,operation:'start'|'pause'|'resume'){
  const task=currentTask(accountId,taskId);
  if(!task)throw Error('任务尚未加载，请稍后重试。');
  const now=Date.now();
  // Validate against the shared optimistic snapshot so rapid start/pause/resume
  // uses the preceding local action while the transport remains serialized.
  if(!mutateProfessionalTaskTimer(structuredClone(task),stepId,operation,task.revision,now))return;
  await saveOperation(accountId,{action:'task_timer',taskId,stepId,operation,eventId:crypto.randomUUID(),localAt:new Date(now).toISOString()});
}

export async function startProfessionalTaskSession(accountId:string,taskId:string){
  const task=currentTask(accountId,taskId);
  if(!task)throw Error('任务尚未加载，请稍后重试。');
  const now=Date.now();
  if(!mutateProfessionalTaskSession(structuredClone(task),'start',task.revision,now))return;
  await saveOperation(accountId,{action:'task_session_start',taskId,eventId:crypto.randomUUID(),localAt:new Date(now).toISOString()});
}

export async function completeProfessionalTaskSessionForAccount(accountId:string,taskId:string,expectedSessionId:string){
  const task=currentTask(accountId,taskId);
  if(!task)throw Error('任务尚未加载，请稍后重试。');
  const now=Date.now();
  if(!completeProfessionalTaskSession(structuredClone(task),expectedSessionId,task.revision,now))return;
  await saveOperation(accountId,{action:'task_session_complete',taskId,expectedSessionId,eventId:crypto.randomUUID(),localAt:new Date(now).toISOString()});
}

export async function setProfessionalTaskStepDate(accountId:string,taskId:string,stepId:string,scheduledDate:string){
  const task=currentTask(accountId,taskId),step=task?.steps.find(item=>item.id===stepId);
  if(!task||!step)throw Error('任务尚未加载，请稍后重试。');
  if(task.status==='skipped'||step.skippedAt)throw Error('已跳过的步骤不能改期，请重新安排。');
  if(step.scheduledDate===scheduledDate)return;
  if(!step.scheduledDate)throw Error('这个步骤没有多日规划。');
  if(task.status==='cancelled'||task.status==='completed'||step.completedAt)throw Error('已结束的步骤不能改期。');
  if(!taskScheduleOptions(shanghaiToday(Date.now())).includes(scheduledDate))throw Error('请选择今天到下周同一天之间的日期。');
  await saveOperation(accountId,{action:'task_step_date',taskId,stepId,scheduledDate,eventId:crypto.randomUUID(),localAt:new Date().toISOString()});
}
