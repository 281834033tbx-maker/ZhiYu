import type { ChatMessage } from '../../lib/npc/contracts';
import { ProfessionalTaskError, mutateProfessionalTaskStep, mutateProfessionalTaskStepDate, nextProfessionalTaskStep, type ProfessionalTask, type ProfessionalTaskEvent } from '../../lib/npc/professional-task';
import { freezeProfessionalTaskTimers, mutateProfessionalTaskTimer } from '../../lib/npc/professional-task-timer';
import { completeProfessionalTaskSession, freezeProfessionalTaskSessions, mutateProfessionalTaskSession, reconcileProfessionalTaskSessions } from '../../lib/npc/professional-task-session';
import { reconcileProfessionalTaskExpiry } from '../../lib/npc/professional-task-expiry';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type ProfessionalTaskMutationState = {
  characterId: ProfessionalTask['characterId']; professionalTasks: ProfessionalTask[]; taskEvents: ProfessionalTaskEvent[];
  taskMutations: {id:string;payload:string}[]; messages: ChatMessage[];
  privateHistoryHiddenIds?: string[]; inputRevision: number; error: string; retryAt: number;
};
export const isProfessionalTaskMutation = (action: unknown) => ['task_step','task_status','task_timer','task_step_date','task_session_start','task_session_complete'].includes(String(action));
/** Archived/debug branches share tables, but only the live account suffix is a daily task source. */
export function isCanonicalProfessionalTaskSessionId(id:string,characterId:ProfessionalTask['characterId']):boolean {
  const suffix=':'+characterId;
  return id.endsWith(suffix)&&UUID.test(id.slice(0,-suffix.length));
}

/** Synchronous load boundary shared by private APIs and the secretary clock.
 * Keep the source messages/queue, but invalidate drafts and unsent progress
 * hints whenever a task day has ended. Callers persist once when true. */
export function reconcileProfessionalTaskState(state: {
  professionalTasks?:ProfessionalTask[]; taskEvents?:ProfessionalTaskEvent[]; messages?:ChatMessage[];
  privateHistoryHiddenIds?:string[]; inputRevision?:number;
},now=Date.now()):boolean {
  const changedIds=new Set((state.professionalTasks||[]).filter(task=>reconcileProfessionalTaskExpiry(task,now)).map(task=>task.id));
  if(!changedIds.size)return false;
  if(state.taskEvents)state.taskEvents=state.taskEvents.filter(event=>!changedIds.has(event.taskId));
  const stale=(state.messages||[]).filter(message=>message.professionalTaskHint&&changedIds.has(message.professionalTaskHint.taskId)
    &&(message.deliverAt||0)>now).map(message=>message.id);
  if(stale.length){
    state.privateHistoryHiddenIds=[...new Set([...(state.privateHistoryHiddenIds||[]),...stale])];
    const hidden=new Set(stale);
    for(const task of state.professionalTasks||[])for(const step of task.steps)
      step.hints=(step.hints||[]).filter(hint=>!hint.messageIds.some(id=>hidden.has(id)));
  }
  state.inputRevision=(state.inputRevision||0)+1;
  return true;
}

/** Preserve originals, but a pending obsolete progress hint must never become visible. */
export function invalidateProfessionalTaskHints(state: ProfessionalTaskMutationState, taskId: string, now = Date.now()) {
  state.taskEvents = state.taskEvents.filter(event=>event.taskId!==taskId);
  const stale = state.messages.filter(message=>message.professionalTaskHint?.taskId===taskId && (message.deliverAt || 0)>now).map(message=>message.id);
  if (stale.length) state.privateHistoryHiddenIds = [...new Set([...(state.privateHistoryHiddenIds || []),...stale])];
  const cancelled = new Set(stale);
  for (const task of state.professionalTasks) for (const step of task.steps)
    step.hints = step.hints.filter(hint=>!hint.messageIds.some(messageId=>cancelled.has(messageId)));
}

/** Shared, synchronous account-local mutation; caller commits once after validation. */
export function applyProfessionalTaskMutation(state: ProfessionalTaskMutationState, body: Record<string,unknown>, now = Date.now()) {
  reconcileProfessionalTaskState(state,now);
  if (!isProfessionalTaskMutation(body.action) || typeof body.taskId!=='string' || typeof body.eventId!=='string' || !UUID.test(body.eventId)
    || !Number.isSafeInteger(body.expectedRevision)) throw new ProfessionalTaskError('无效任务操作');
  const payload = JSON.stringify([body.action,body.taskId,body.stepId??null,body.completed??null,body.status??null,body.expectedRevision,
    ...(body.action==='task_timer' ? [body.operation??null] : body.action==='task_step_date' ? [body.scheduledDate??null] : body.action==='task_session_complete' ? [body.expectedSessionId??null] : [])]);
  const existing = state.taskMutations.find(event=>event.id===body.eventId);
  if (existing) {
    if (existing.payload!==payload) throw new ProfessionalTaskError('任务事件ID冲突','TASK_EVENT_CONFLICT',409);
    return {changed:false,generate:false};
  }
  const task=state.professionalTasks.find(task=>task.id===body.taskId);
  if (!task || task.characterId!==state.characterId) throw new ProfessionalTaskError('任务不存在','TASK_NOT_FOUND',404);
  if(task.status==='skipped'||task.skippedAt||typeof body.stepId==='string'&&task.steps.some(step=>step.id===body.stepId&&step.skippedAt))
    throw new ProfessionalTaskError('这项任务已跳过，请安排新的任务','TASK_SKIPPED',409);
  let changed=false;
  if (body.action==='task_session_start') {
    if (body.stepId!==undefined) throw new ProfessionalTaskError('整次任务计时不接受步骤');
    changed=mutateProfessionalTaskSession(task,'start',Number(body.expectedRevision),now);
  } else if (body.action==='task_session_complete') {
    if (body.stepId!==undefined || typeof body.expectedSessionId!=='string' || !body.expectedSessionId)
      throw new ProfessionalTaskError('无效本次做饭确认');
    changed=completeProfessionalTaskSession(task,body.expectedSessionId,Number(body.expectedRevision),now);
  } else if (body.action==='task_timer') {
    if (typeof body.stepId!=='string' || !['start','pause','resume'].includes(String(body.operation))) throw new ProfessionalTaskError('无效计时操作');
    changed=mutateProfessionalTaskTimer(task,body.stepId,body.operation as 'start'|'pause'|'resume',Number(body.expectedRevision),now);
  } else if (body.action==='task_step_date') {
    if (typeof body.stepId!=='string' || typeof body.scheduledDate!=='string') throw new ProfessionalTaskError('无效任务日期');
    changed=mutateProfessionalTaskStepDate(task,body.stepId,body.scheduledDate,Number(body.expectedRevision),now);
  } else if (body.action==='task_step') {
    if (typeof body.stepId!=='string' || typeof body.completed!=='boolean') throw new ProfessionalTaskError('无效步骤操作');
    changed=mutateProfessionalTaskStep(task,body.stepId,body.completed,Number(body.expectedRevision),now);
  } else {
    if (Number(body.expectedRevision)!==task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试','TASK_REVISION_CONFLICT',409);
    if (!['active','paused','completed','cancelled'].includes(String(body.status))) throw new ProfessionalTaskError('无效任务状态');
    if (body.status==='completed' && task.steps.some(step=>!step.completedAt)) throw new ProfessionalTaskError('尚有步骤未完成');
    if (body.status==='active' && task.steps.every(step=>step.completedAt)) throw new ProfessionalTaskError('任务已完成');
    if (task.status==='cancelled' && body.status!=='cancelled') throw new ProfessionalTaskError('任务已取消，请明确创建新的执行任务');
    if (body.status!==task.status) {
      if (body.status!=='active') freezeProfessionalTaskTimers(task,now);
      if (body.status==='paused' || body.status==='cancelled') freezeProfessionalTaskSessions(task,body.status,now);
      task.status=body.status as typeof task.status; task.revision++; task.updatedAt=new Date(now).toISOString();changed=true;
      if (body.status==='completed') reconcileProfessionalTaskSessions(task,now);
    }
  }
  state.taskMutations.push({id:body.eventId,payload});
  if (changed && body.action!=='task_timer' && body.action!=='task_session_start') {
    invalidateProfessionalTaskHints(state,task.id,now);state.inputRevision++;
    state.error='';state.retryAt=0;
    if (body.action==='task_step' && body.completed===true) {
      const next=nextProfessionalTaskStep(task);
      state.taskEvents.push({id:body.eventId,taskId:task.id,revision:task.revision,at:new Date(now).toISOString(),kind:'step_completed',completedStepId:String(body.stepId),...(next?{nextStepId:next.id}:{})});
      state.error='';state.retryAt=0;
    }
  }
  return {changed,generate:changed && body.action!=='task_timer' && body.action!=='task_step_date' && body.action!=='task_session_start' && body.action!=='task_session_complete'};
}
