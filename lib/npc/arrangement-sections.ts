import billCatalog from './report-config/bill-catalog.json';
import dailyTemplates from './report-config/daily-templates.json';
import {arrangementDateInShanghai, isArrangementDate, shiftArrangementDate, type ParsedArrangementTime} from './arrangement-time';

/** The only section catalogue. IDs from storage, recognition and UI are validated here. */
export const ARRANGEMENT_SECTIONS = [
  {id: 'schedule', name: '日程', description: '有具体时间点的事'},
  {id: 'todo', name: '待办', description: '有截止日期或没有日期的待做事'},
  {id: 'plan', name: '计划', description: '专业智友给出的长期方案'},
  {id: 'purchase', name: '采购', description: '要买的东西'},
  {id: 'payment', name: '缴费', description: '费用、还款和续费'},
  {id: 'procedure', name: '办理', description: '分步骤办理的事情'},
  {id: 'countdown', name: '倒计时', description: '重要日期与到期日'},
] as const;
export const arrangementSections = ARRANGEMENT_SECTIONS;
export type ArrangementSectionId = typeof ARRANGEMENT_SECTIONS[number]['id'];
export const ARRANGEMENT_SECTION_IDS = ARRANGEMENT_SECTIONS.map(section => section.id) as readonly ArrangementSectionId[];
export function isArrangementSectionId(value: unknown): value is ArrangementSectionId {
  return typeof value === 'string' && ARRANGEMENT_SECTION_IDS.includes(value as ArrangementSectionId);
}
export function arrangementSectionName(id: ArrangementSectionId): string {
  return ARRANGEMENT_SECTIONS.find(section => section.id === id)!.name;
}
/** Every professional category, including one introduced by a future expert, remains a plan. */
export function arrangementSectionForTask(category: string): ArrangementSectionId {
  return category === 'shopping' ? 'purchase' : 'plan';
}
// Re-export the actual existing tables; neither recognition nor reminders duplicate their contents.
export const arrangementPaymentCatalog = billCatalog;
export const arrangementProcedureTemplates: Readonly<Record<string, readonly string[]>> = dailyTemplates.progressSteps;
export const arrangementCountdownLead = dailyTemplates.upcomingLead;
export type ArrangementCountdownKind = keyof typeof arrangementCountdownLead;
/** One calendar boundary shared by the reminder and every daily brief. */
export function arrangementCountdownStart(date: string, kind: ArrangementCountdownKind = 'other'): string {
  if (!isArrangementDate(date)) throw new Error('倒计时日期无效');
  const lead = arrangementCountdownLead[Object.hasOwn(arrangementCountdownLead, kind) ? kind : 'other'];
  if ('days' in lead) return shiftArrangementDate(date, -lead.days);
  const [year, month, day] = date.split('-').map(Number);
  const index = year * 12 + month - 1 - lead.months;
  const targetYear = Math.floor(index / 12), targetMonth = ((index % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export type ArrangementCardSubtitleOptions = {
  time?: ParsedArrangementTime;
  publisherName?: string;
  itemCount?: number;
  completedSteps?: number;
  totalSteps?: number;
  now?: number;
};
export function arrangementCardSubtitle(section: ArrangementSectionId, options: ArrangementCardSubtitleOptions = {}): string {
  const name = arrangementSectionName(section);
  let detail = options.time?.display || '';
  if (section === 'schedule') detail = detail.replace(/(\S)(\d{2}:\d{2})/u, '$1 $2');
  if (section === 'plan') detail = options.publisherName || '';
  if (section === 'purchase' && typeof options.itemCount === 'number') detail = `${Math.max(0, Math.floor(options.itemCount))}样`;
  if (section === 'procedure' && typeof options.totalSteps === 'number') {
    const total = Math.max(0, Math.min(5, Math.floor(options.totalSteps)));
    detail = `${Math.min(total, Math.max(0, Math.floor(options.completedSteps || 0)))}/${total} 步`;
  }
  if (section === 'payment' && detail && !/到期/.test(detail)) detail += '到期';
  if (section === 'countdown' && options.time?.date) {
    const today = arrangementDateInShanghai(options.now ?? Date.now());
    const days = Math.round((Date.parse(options.time.date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000);
    detail = days > 0 ? `${days}天后` : days === 0 ? '今天' : `${-days}天前`;
  }
  return detail ? `${name} · ${detail}` : name;
}
