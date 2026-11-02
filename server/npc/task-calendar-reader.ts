import type {DatabaseSync} from 'node:sqlite';
import type {ProfessionalTask} from '../../lib/npc/professional-task';
import {isTaskCalendarDate, projectTaskCalendar} from '../../lib/npc/task-calendar';

export const TASK_CALENDAR_CHARACTERS = new Set(['molly', 'chen-nian', 'zhou-chef', 'he-jiawei', 'yuan-xiaoman', 'liu', 'xia-xia', 'zhao-yifan']);
const sources = [
  ['sessions', 'xia-xia:normal'], ['molly_sessions', 'molly-system-secretary'],
  ['yuan_sessions', 'yuan-xiaoman'], ['liu_sessions', 'liu'],
  ['chen_sessions', 'chen-nian'], ['he_sessions', 'he-jiawei'], ['zhou_chef_sessions', 'zhou-chef'],
] as const;
type SavedState = {messages?: {role?: string; at?: string; chronologyUnknown?: boolean}[]; professionalTasks?: ProfessionalTask[]};

/** Reads existing rows only. No NPC load/normalization path, migrations or save is invoked. */
export function readTaskCalendar(db: DatabaseSync, account: {owner_id: string; created_at?: number}, characterId: string, now = Date.now()) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[]).map(row => row.name));
  const tasks: ProfessionalTask[] = [];
  let firstUsageAt: number | undefined;
  const remember = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !isTaskCalendarDate(value.slice(0, 10)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return;
    const time = Date.parse(value);
    if (Number.isFinite(time) && time <= now && (firstUsageAt === undefined || time < firstUsageAt)) firstUsageAt = time;
  };
  for (const [table, suffix] of sources) {
    if (!tables.has(table)) continue;
    // Table identifiers are fixed constants. Identity always comes from the signed-in account.
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(`${account.owner_id}:${suffix}`) as {data: string} | undefined;
    if (!row) continue;
    const state = JSON.parse(row.data) as SavedState;
    for (const message of state.messages || []) if (message.role === 'user' && !message.chronologyUnknown) remember(message.at);
    for (const task of state.professionalTasks || []) {
      if (!['chen-nian', 'zhou-chef', 'liu'].includes(task.characterId) || !Array.isArray(task.steps)) continue;
      tasks.push({...task, steps: task.steps.map(step => ({...step, details: Array.isArray(step.details) ? step.details : []}))});
    }
  }
  if (tables.has('npc_group_chats')) {
    const rows = db.prepare('SELECT created_at FROM npc_group_chats WHERE owner=?').all(account.owner_id) as {created_at: string}[];
    for (const row of rows) remember(row.created_at);
  }
  const projection = projectTaskCalendar({tasks, now, accountCreatedAt: account.created_at, firstUsageAt});
  return {...projection, days: projection.days.map(day => {
    const entries = day.entries.filter(entry => entry.characterId === characterId);
    const completed = entries.reduce((sum, entry) => sum + entry.completed, 0);
    const skipped = entries.reduce((sum, entry) => sum + entry.skipped, 0);
    const total = entries.reduce((sum, entry) => sum + entry.total, 0);
    return {...day, entries, completed, skipped, total, percent: total ? completed === total ? 100 : Math.min(99, Math.round(completed / total * 100)) : 0};
  }).filter(day => day.total > 0)};
}
