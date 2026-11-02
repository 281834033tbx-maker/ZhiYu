import type { ProfessionalTask, ProfessionalTaskStep } from './professional-task';
import { freezeProfessionalTaskStepTimer } from './professional-task-timer';
import { skipProfessionalTaskSession } from './professional-task-session';

export const PROFESSIONAL_TASK_EXPIRY_VERSION='task-auto-skip-20261018-v1';
const dateValid=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const professionalTaskStepResolved=(step:ProfessionalTaskStep)=>!!step.completedAt||!!step.skippedAt;
export const professionalTaskStepPending=(step:ProfessionalTaskStep)=>!professionalTaskStepResolved(step);

/** Undated work belongs to its verified delegation day (legacy: creation day).
 * A response saved after midnight must not invent a fresh next-day task. */
export function professionalTaskStepDate(task:ProfessionalTask,step:ProfessionalTaskStep):string|undefined {
  if(step.scheduledDate!==undefined)return dateValid(step.scheduledDate)?step.scheduledDate:undefined;
  if(dateValid(task.assignedDate))return task.assignedDate;
  const created=Date.parse(task.createdAt);if(!Number.isFinite(created))return;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(created);
}
export function professionalTaskStepDayEnded(task:ProfessionalTask,step:ProfessionalTaskStep,now=Date.now()):boolean {
  const date=professionalTaskStepDate(task,step);
  return !!date&&Number.isFinite(now)&&now>=Date.parse(date+'T00:00:00+08:00')+86400000;
}

/** Mutates only lifecycle facts. Offline recovery records the original Shanghai
 * midnight, never inventing work, completed steps or an execution session. */
export function reconcileProfessionalTaskExpiry(task:ProfessionalTask,now=Date.now()):boolean {
  if(!Number.isFinite(now)||!Array.isArray(task.steps)||!task.steps.length||['cancelled','completed','skipped'].includes(task.status))return false;
  let changed=false;
  const expired=new Map<string,number>();
  for(const step of task.steps){
    if(!professionalTaskStepPending(step))continue;
    const date=professionalTaskStepDate(task,step);if(!date)continue;
    const boundary=Date.parse(date+'T00:00:00+08:00')+86400000;
    if(now<boundary)continue;
    freezeProfessionalTaskStepTimer(step,boundary);
    step.skippedAt=new Date(boundary).toISOString();step.skipReason='day-ended';expired.set(step.id,boundary);changed=true;
  }
  for(const session of task.executionSessions||[]){
    // Previous plan snapshots are immutable history, even if a later plan
    // reused a step ID that has just expired in the current plan.
    if(session.planVersion!==(task.previousPlans?.length||0))continue;
    const boundaries=session.stepIds.flatMap(id=>expired.has(id)?[expired.get(id)!]:[]);
    // A running session belongs to its actual start day even if one bound
    // step was rescheduled while it was open. That must not run for days.
    const ownBoundary=dateValid(session.date)?Date.parse(session.date+'T00:00:00+08:00')+86400000:undefined;
    if(ownBoundary!==undefined&&now>=ownBoundary)boundaries.push(ownBoundary);
    if(!boundaries.length)continue;
    for(const snapshot of session.steps){
      const step=task.steps.find(candidate=>candidate.id===snapshot.id);
      if(step?.skippedAt){snapshot.skippedAt=step.skippedAt;snapshot.skipReason='day-ended';}
    }
    const cutoff=Math.min(...boundaries);
    if(skipProfessionalTaskSession(session,cutoff)){
      for(const id of session.stepIds){const step=task.steps.find(candidate=>candidate.id===id);if(step)freezeProfessionalTaskStepTimer(step,cutoff);}
      changed=true;
    }
  }
  if(task.steps.every(professionalTaskStepResolved)){
    const skipped=task.steps.filter(step=>!!step.skippedAt);
    task.status=skipped.length?'skipped':'completed';
    if(skipped.length){task.skippedAt=skipped.map(step=>step.skippedAt!).sort().at(-1);task.skipReason='day-ended';}
    changed=true;
  }
  if(changed){task.updatedAt=new Date(now).toISOString();task.revision=(task.revision||0)+1;}
  return changed;
}
export function reconcileProfessionalTasksExpiry(tasks:ProfessionalTask[],now=Date.now()):boolean {
  let changed=false;for(const task of tasks)if(reconcileProfessionalTaskExpiry(task,now))changed=true;return changed;
}
/** Calendar/card projections may reconcile a clone without writing a source. */
export function projectProfessionalTaskExpiry(task:ProfessionalTask,now=Date.now()):ProfessionalTask {
  const projected=structuredClone(task);reconcileProfessionalTaskExpiry(projected,now);return projected;
}
