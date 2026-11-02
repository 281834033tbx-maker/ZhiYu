import type {ProfessionalTask, ProfessionalTaskCharacterId, ProfessionalTaskStep, ProfessionalTaskTraining} from './professional-task';
import {professionalTaskSessionKind} from './professional-task-session';
import {professionalTaskStepDate, projectProfessionalTaskExpiry} from './professional-task-expiry';

export type TaskCalendarStep = {
  id: string; title: string; completed: boolean; completedAt?: string; skipped?: boolean; skippedAt?: string; scheduledDate?: string;
  details: string[]; instructions?: string[]; notes?: string[]; completionCondition?: string;
  durationSeconds?: number; training?: ProfessionalTaskTraining;
};
export type TaskCalendarEntry = {
  taskId: string; characterId: ProfessionalTaskCharacterId; title: string;
  status: ProfessionalTask['status']; revision: number; scheduled: boolean;
  stepIds: string[]; completedStepIds: string[]; completedDates: string[];
  steps: TaskCalendarStep[];
  completed: number; skipped: number; total: number; percent: number;
  entryId?: string;
  timingKind?: 'training' | 'cooking';
  execution?: {kind: 'training' | 'cooking'; status: 'running' | 'paused' | 'completed' | 'cancelled' | 'skipped'; elapsedMs: number};
};
export type TaskCalendarDay = {
  date: string; entries: TaskCalendarEntry[]; completed: number; skipped: number; total: number; percent: number;
};
export type TaskCalendarProjection = {
  today: string; firstDate: string; firstMonth: string; lastMonth: string; months: string[];
  startSource: 'usage-record' | 'account-created' | 'task-record' | 'unknown';
  /** Current saved progress grouped by its latest plan date; never a past-day state reconstruction. */
  snapshotOnly: true; days: TaskCalendarDay[];
};
type Timestamp = string | number | null | undefined;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthPattern = /^\d{4}-\d{2}$/;
const dayMillis = 86_400_000;

export function isTaskCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function timestamp(value: Timestamp): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Imported undated clock labels and date-only strings are not timestamps.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)
    || !isTaskCalendarDate(value.slice(0, 10)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function shanghaiDate(time: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(time);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

const percent = (completed: number, total: number) => total
  ? completed === total ? 100 : Math.min(99, Math.round(completed / total * 100)) : 0;

/** Natural month cells run Monday to Sunday; cross-year arithmetic uses UTC. */
export function taskCalendarMonthCells(month: string): (string | null)[] {
  if (!monthPattern.test(month) || !isTaskCalendarDate(`${month}-01`)) return [];
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
  const count = Math.round((next.getTime() - first.getTime()) / dayMillis);
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({length}, (_, index) => index < offset || index >= offset + count
    ? null : new Date(first.getTime() + (index - offset) * dayMillis).toISOString().slice(0, 10));
}

/**
 * Pure history projection. Dated steps belong to the latest saved scheduledDate;
 * unscheduled steps stay on the task's creation day, even after a later completion.
 * completedDates retains actual completion days without duplicating assignments.
 * Undo and rescheduling change this snapshot: current storage has no dated undo log.
 * firstUsageAt must already be an account-owned, reliable record supplied by the caller.
 */
export function projectTaskCalendar({tasks, now, characterId, accountCreatedAt, firstUsageAt}: {
  tasks: readonly ProfessionalTask[]; now: number; characterId?: ProfessionalTaskCharacterId;
  accountCreatedAt?: Timestamp; firstUsageAt?: Timestamp;
}): TaskCalendarProjection {
  if (!Number.isFinite(now)) throw new RangeError('日历当前时间无效');
  const today = shanghaiDate(now);
  const candidates: {time: number; source: TaskCalendarProjection['startSource']}[] = [];
  const remember = (value: Timestamp, source: TaskCalendarProjection['startSource']) => {
    const time = timestamp(value);
    if (time !== null && time <= now) candidates.push({time, source});
  };
  remember(firstUsageAt, 'usage-record'); remember(accountCreatedAt, 'account-created');
  // Scope filters the visible NPC records, not the account's period of software use.
  for (const task of tasks) {
    remember(task.createdAt, 'task-record');
    for (const step of task.steps) {
      const date=professionalTaskStepDate(task,step);
      if (date) remember(`${date}T00:00:00+08:00`,'task-record');
    }
  }
  candidates.sort((a, b) => a.time - b.time);
  const first = candidates[0];
  const firstDate = first ? shanghaiDate(first.time) : today;
  const firstMonth = firstDate.slice(0, 7), lastMonth = today.slice(0, 7);
  const months: string[] = [];
  const monthCursor = new Date(`${firstMonth}-01T00:00:00Z`);
  for (let month = monthCursor.toISOString().slice(0, 7); month <= lastMonth; month = monthCursor.toISOString().slice(0, 7)) {
    months.push(month); monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }
  const days = new Map<string, TaskCalendarDay>();
  for (const source of tasks) {
    const task = projectProfessionalTaskExpiry(source, now);
    if (characterId && task.characterId !== characterId) continue;
    const createdTime = timestamp(task.createdAt);
    if (createdTime === null || createdTime > now) continue;
    const createdDate = shanghaiDate(createdTime);
    const assigned = new Map<string, TaskCalendarEntry>();
    const sessions = (task.executionSessions || []).filter(session => isTaskCalendarDate(session.date)
      && session.date <= today && session.date.slice(0, 7) >= firstMonth);
    const sessionSteps = new Set(sessions.filter(session => session.planVersion === (task.previousPlans?.length || 0)).flatMap(session => session.stepIds));
    for (const step of task.steps.filter(step => !sessionSteps.has(step.id))) {
      const scheduled = isTaskCalendarDate(step.scheduledDate);
      const date = professionalTaskStepDate(task, step) || createdDate;
      // This page covers account-use months through today, including earlier days
      // in the initial natural month, but never shows future tasks as history.
      if (date > today || date.slice(0, 7) < firstMonth) continue;
      let entry = assigned.get(date);
      if (!entry) {
        entry = {taskId: task.id, characterId: task.characterId, title: task.title, status: task.status,
          revision: task.revision, scheduled, steps: [], stepIds: [], completedStepIds: [], completedDates: [], completed: 0, skipped: 0, total: 0, percent: 0,
          ...(professionalTaskSessionKind(task) ? {timingKind: professionalTaskSessionKind(task)!} : {})};
        assigned.set(date, entry);
      }
      entry.scheduled ||= scheduled;
      entry.stepIds.push(step.id); entry.total++;
      const completedTime = timestamp(step.completedAt);
      const completed = completedTime !== null && completedTime <= now;
      const skippedTime = timestamp(step.skippedAt), skipped = !completed && skippedTime !== null && skippedTime <= now;
      if (skipped) entry.skipped++;
      entry.steps.push({id: step.id, title: step.title, completed, details: [...step.details],
        ...(completed ? {completedAt: step.completedAt} : {}), ...(skipped ? {skipped:true, skippedAt:step.skippedAt} : {}), ...(scheduled ? {scheduledDate: step.scheduledDate} : {}),
        ...(step.instructions ? {instructions: [...step.instructions]} : {}), ...(step.notes ? {notes: [...step.notes]} : {}),
        ...(step.completionCondition ? {completionCondition: step.completionCondition} : {}),
        ...(step.durationSeconds ? {durationSeconds: step.durationSeconds} : {}), ...(step.training ? {training: {...step.training}} : {})});
      if (completed) {
        entry.completedStepIds.push(step.id); entry.completed++;
        entry.completedDates.push(shanghaiDate(completedTime));
      }
    }
    // Each execution belongs to its actual start day. Weekly plans therefore
    // keep separate durations instead of repeating one total on every date.
    for (const session of sessions) {
      const currentPlan = session.planVersion === (task.previousPlans?.length || 0);
      const steps = session.steps.map((saved): ProfessionalTaskStep => currentPlan
        ? task.steps.find(step => step.id === saved.id) || {...saved, details: [], hints: []}
        : {...saved, details: [], hints: []});
      if (!steps.length) continue;
      const entry: TaskCalendarEntry = {taskId: task.id, entryId: `${task.id}:${session.id}`, characterId: task.characterId,
        title: session.taskTitle, status: session.status === 'running' ? 'active' : session.status,
        revision: task.revision, scheduled: steps.some(step => !!step.scheduledDate), steps: [], stepIds: [],
        completedStepIds: [], completedDates: [], completed: 0, skipped: 0, total: steps.length, percent: 0,
        timingKind: session.kind, execution: {kind: session.kind, status: session.status, elapsedMs: session.elapsedMs}};
      for (const step of steps) {
        const completedTime = timestamp(step.completedAt), completed = completedTime !== null && completedTime <= now;
        const skippedTime = timestamp(step.skippedAt), skipped = !completed && skippedTime !== null && skippedTime <= now;
        if (skipped) entry.skipped++;
        entry.stepIds.push(step.id);
        entry.steps.push({id: step.id, title: step.title, completed, details: [...(step.details || [])],
          ...(completed ? {completedAt: step.completedAt} : {}), ...(skipped ? {skipped:true, skippedAt:step.skippedAt} : {}), ...(step.scheduledDate ? {scheduledDate: step.scheduledDate} : {}),
          ...(step.training ? {training: {...step.training}} : {})});
        if (completed) {entry.completed++; entry.completedStepIds.push(step.id); entry.completedDates.push(shanghaiDate(completedTime));}
      }
      if (entry.skipped > 0 && entry.completed + entry.skipped === entry.total) entry.status = 'skipped';
      entry.percent = percent(entry.completed, entry.total);
      entry.completedDates = [...new Set(entry.completedDates)].sort();
      const day = days.get(session.date) || {date: session.date, entries: [], completed: 0, skipped: 0, total: 0, percent: 0};
      day.entries.push(entry); day.completed += entry.completed; day.skipped += entry.skipped; day.total += entry.total; days.set(session.date, day);
    }
    for (const [date, entry] of assigned) {
      if (entry.skipped > 0 && entry.completed + entry.skipped === entry.total) entry.status = 'skipped';
      entry.percent = percent(entry.completed, entry.total);
      entry.completedDates = [...new Set(entry.completedDates)].sort();
      let day = days.get(date);
      if (!day) {day = {date, entries: [], completed: 0, skipped: 0, total: 0, percent: 0}; days.set(date, day);}
      day.entries.push(entry); day.completed += entry.completed; day.skipped += entry.skipped; day.total += entry.total;
    }
  }
  const sortedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sortedDays) {
    day.percent = percent(day.completed, day.total);
    day.entries.sort((a, b) => a.characterId.localeCompare(b.characterId) || a.title.localeCompare(b.title) || a.taskId.localeCompare(b.taskId));
  }
  return {today, firstDate, firstMonth, lastMonth, months, startSource: first?.source || 'unknown', snapshotOnly: true, days: sortedDays};
}
