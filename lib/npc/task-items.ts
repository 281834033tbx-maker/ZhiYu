import type {GroupChat, GroupPlanDay, GroupReminder} from './group-chat';
import {professionalTaskProgress, type ProfessionalTask} from './professional-task';
import {professionalTaskStepDate} from './professional-task-expiry';

export type TaskCategory = 'cooking' | 'fitness' | 'diet' | 'skin' | 'shopping' | 'recovery' | 'review';

/** A view of existing dated group data; completion belongs to the task UI. */
export type TaskItem = {
  id: string;
  date: string;
  category: TaskCategory;
  title: string;
  time?: string;
  details: string[];
  groupId: string;
  groupName: string;
  statusLabel?: string;
  /** Draft plans and unconfirmed/paused standalone reminders remain read-only. */
  canComplete: boolean;
};

export function shanghaiToday(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function validTaskDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calendar arithmetic stays independent of the execution host's timezone. */
export function shiftTaskDate(date: string, offset: number): string {
  if (!validTaskDate(date) || !Number.isInteger(offset)) return '';
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

/** One natural month ahead, clamped at month-end (Jan 31 → Feb 28/29). */
export function nextTaskMonth(date: string): string {
  if (!validTaskDate(date)) return '';
  const value = new Date(`${date}T00:00:00Z`), day = value.getUTCDate();
  value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + 1);
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, last)); return value.toISOString().slice(0, 10);
}

/** Inclusive: all actual history through one natural month after today. */
export function taskDateOptions(today: string, earliest = today): string[] {
  if (!validTaskDate(today)) return [];
  const first = validTaskDate(earliest) && earliest < today ? earliest : today;
  const last = nextTaskMonth(today), count = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
  return Array.from({length: count}, (_, index) => shiftTaskDate(first, index));
}

/** A full upcoming natural week remains editable, even when requested late this week. */
export function taskScheduleOptions(today: string): string[] {
  return validTaskDate(today) ? Array.from({length: 31}, (_, index) => shiftTaskDate(today, index)) : [];
}

export function professionalTaskCategory(task: ProfessionalTask): TaskCategory {
  return task.characterId === 'chen-nian' ? 'fitness' : task.characterId === 'liu' ? 'diet' : 'cooking';
}
export function professionalTaskCharacterName(task: ProfessionalTask): string {
  return task.characterId === 'chen-nian' ? '陈年' : task.characterId === 'liu' ? '柳智敏' : '赵一帆';
}

/** Source dates determine history; a UI window must never erase older records. */
export function taskCalendarRange(groups: readonly GroupChat[], tasks: readonly ProfessionalTask[], today: string): {dates: string[]; markedDates: Set<string>} {
  if (!validTaskDate(today)) return {dates: [], markedDates: new Set()};
  const sourceDates: string[] = [];
  const remember = (value: unknown) => { if (validTaskDate(value)) sourceDates.push(value); };
  for (const group of groups) {
    if (group.leftAt) continue;
    for (const day of group.plan?.days || []) if (day.breakfast?.trim() || day.lunch?.trim() || day.dinner?.trim()) remember(day.date);
    for (const reminder of group.reminders || []) if (reminder.status !== 'cancelled' && reminder.timezone === 'Asia/Shanghai' && validTaskDate(reminder.startDate) && validTaskDate(reminder.endDate)) remember(reminder.startDate);
  }
  for (const task of tasks) {
    const created = Date.parse(task.createdAt); if (Number.isFinite(created)) remember(shanghaiToday(created));
    for (const step of task.steps) { remember(professionalTaskStepDate(task, step)); const completed = Date.parse(step.completedAt || ''); if (Number.isFinite(completed)) remember(shanghaiToday(completed)); }
  }
  const earliest = sourceDates.reduce((first, date) => date < first ? date : first, today);
  const dates = taskDateOptions(today, earliest), markedDates = new Set<string>();
  for (const date of dates) if (taskItemsForDate([...groups], date).length || professionalTasksForDate(tasks, date, today).length) markedDates.add(date);
  return {dates, markedDates};
}

export function taskDateLabel(date: string, today: string): string {
  if (!validTaskDate(date)) return '';
  if (date === today) return '今天';
  if (date === shiftTaskDate(today, 1)) return '明天';
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}号`;
}

/** Tasks stay on their assigned days; unfinished history never carries into today. */
export function professionalTasksForDate(tasks:readonly ProfessionalTask[],date:string,today:string):ProfessionalTask[]{
  if(!validTaskDate(date)||!validTaskDate(today))return [];
  return tasks.filter(task=>{
    const createdAt=Date.parse(task.createdAt);if(!Number.isFinite(createdAt))return false;
    const created=shanghaiToday(createdAt);
    const scheduled=task.steps.map(step=>step.scheduledDate).filter(validTaskDate);
    if(scheduled.length)return task.steps.some(step=>professionalTaskStepDate(task,step)===date);
    if(['active','paused','skipped'].includes(task.status))return task.steps.some(step=>professionalTaskStepDate(task,step)===date)||(task.steps.length===0&&created===date);
    const updatedAt=Date.parse(task.updatedAt),fallback=Number.isFinite(updatedAt)?updatedAt:createdAt;
    const finished=task.status==='completed'?Math.max(fallback,...task.steps.map(step=>{const at=Date.parse(step.completedAt||'');return Number.isFinite(at)?at:fallback;})):fallback;
    // A later delivered hint updates the record but does not move completed work to another day.
    const validCompletionTimes=task.steps.map(step=>Date.parse(step.completedAt||'')).filter(Number.isFinite);
    const completionDay=task.status==='completed'&&validCompletionTimes.length===task.steps.length&&validCompletionTimes.length?Math.max(...validCompletionTimes):finished;
    return task.steps.some(step=>professionalTaskStepDate(task,step)===date)||shanghaiToday(completionDay)===date;
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

/** The previous public helper remains available for existing callers and checks. */
export function groupTasksForToday(groups: GroupChat[], today: string): {
  group: GroupChat; days: GroupPlanDay[]; reminders: GroupReminder[];
}[] {
  if (!validTaskDate(today)) return [];
  return groups.filter(group => !group.leftAt).map(group => ({
    group,
    days: group.plan?.days.filter(day => day.date === today) || [],
    reminders: (group.reminders || []).filter(reminder => reminder.status !== 'cancelled'
      && reminder.timezone === 'Asia/Shanghai' && validTaskDate(reminder.startDate) && validTaskDate(reminder.endDate)
      && reminder.startDate <= today && reminder.endDate >= today)
      .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id)),
  })).filter(item => item.days.length || item.reminders.length);
}

const meals = ['breakfast', 'lunch', 'dinner'] as const;
const mealNames = {breakfast: '早餐', lunch: '午餐', dinner: '晚餐'};
const reminderStatuses = {active: '已启用', proposed: '待确认', paused: '已暂停', cancelled: '已取消'};
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const distinct = (values: string[]) => [...new Set(values)];

function contentFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}

/**
 * Only the existing dated meal plan and reminder structures create task rows.
 * A meal's plan and reminders share one row, while all original statuses and
 * reminder times remain in its details. Shopping has no per-day date in the
 * current model, so it is not repeated across the calendar task view.
 */
export function taskItemsForDate(groups: GroupChat[], date: string): TaskItem[] {
  return groupTasksForToday(groups, date).flatMap(({group, days, reminders}) => meals.flatMap(meal => {
    const menus = distinct(days.map(day => day[meal]?.trim()).filter((text): text is string => !!text));
    const mealReminders = reminders.filter(reminder => reminder.meal === meal);
    if (!menus.length && !mealReminders.length) return [];
    const timedReminder = mealReminders.find(reminder => reminder.status === 'active' && validTime(reminder.time))
      || mealReminders.find(reminder => validTime(reminder.time));

    const details = [...menus];
    const statusParts: string[] = [];
    if (menus.length) {
      const planStatus = group.plan?.status === 'draft' ? '待确认' : '已确认';
      const labels = distinct(days.map(day => day.label?.trim()).filter((text): text is string => !!text));
      if (labels.length) details.push(`饮食安排：${labels.join('；')}`);
      details.push(`饮食计划${planStatus}`);
      statusParts.push(`计划${planStatus}`);
    }
    for (const reminder of mealReminders) {
      const timeText = validTime(reminder.time) ? reminder.time : '时间待定';
      details.push(`${mealNames[meal]}提醒：${timeText} · ${reminderStatuses[reminder.status]}（${reminder.startDate}至${reminder.endDate}，上海时间）`);
    }
    if (mealReminders.length) {
      const statuses = distinct(mealReminders.map(reminder => reminderStatuses[reminder.status]));
      const primaryStatus = timedReminder && reminderStatuses[timedReminder.status];
      const otherStatuses = statuses.filter(status => status !== primaryStatus);
      statusParts.push(primaryStatus ? `提醒${primaryStatus}${otherStatuses.length ? ` · 另有${otherStatuses.join('／')}` : ''}`
        : `提醒${statuses.join('／')}`);
    }

    // Reordering groups/reminders and status-only changes keep the row identity.
    // Changed menu/time/date ranges invalidate an old completion. Chat activity,
    // group renaming and a reminder being delivered do not change the task ID.
    const sourceId = menus.length ? `plan:${group.plan!.id}`
      : `reminders:${mealReminders.map(reminder => reminder.id).sort().join(',')}`;
    const version = contentFingerprint({
      menus,
      labels: distinct(days.map(day => day.label?.trim()).filter((text): text is string => !!text)),
      reminders: mealReminders.map(reminder => ({
        id: reminder.id, time: reminder.time, startDate: reminder.startDate, endDate: reminder.endDate,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    });
    const time = timedReminder?.time;
    return [{
      id: [group.id, sourceId, date, meal, version].map(encodeURIComponent).join(':'),
      date,
      category: 'diet' as const,
      title: menus.length ? mealNames[meal] : `${mealNames[meal]}提醒`,
      ...(time ? {time} : {}),
      details,
      groupId: group.id,
      groupName: group.name,
      statusLabel: statusParts.join(' · '),
      canComplete: menus.length ? group.plan?.status === 'confirmed'
        : mealReminders.some(reminder => reminder.status === 'active'),
    }];
  }));
}

/** Past, actionable group rows expire without erasing their completion history. */
export function isTaskItemSkipped(item: Pick<TaskItem, 'id' | 'date' | 'canComplete'>, completions: Readonly<Record<string, boolean>>, today: string): boolean {
  return validTaskDate(today) && validTaskDate(item.date) && item.date < today && item.canComplete && !completions[item.id];
}

export function taskItemState(item: Pick<TaskItem, 'id' | 'date' | 'canComplete'>, completions: Readonly<Record<string, boolean>>, today: string): 'completed' | 'skipped' | 'pending' | 'inactive' {
  if (completions[item.id]) return 'completed';
  if (isTaskItemSkipped(item, completions, today)) return 'skipped';
  return item.canComplete ? 'pending' : 'inactive';
}

/** A multi-day task's date row must not borrow tomorrow's pending steps. */
export function professionalTaskProgressForDate(task: ProfessionalTask, date: string) {
  const steps = task.steps.filter(step => professionalTaskStepDate(task, step) === date);
  const progress = professionalTaskProgress({...task, steps});
  const status: ProfessionalTask['status'] = ['paused', 'cancelled'].includes(task.status) ? task.status
    : progress.pending > 0 ? 'active' : progress.skipped > 0 ? 'skipped' : progress.total > 0 ? 'completed' : task.status;
  return {...progress, status};
}
