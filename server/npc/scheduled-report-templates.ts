import type {ReportCity, ReportWeather} from '../../lib/npc/experience';
import type {DailyBrief, ReportBlock, ReportRow, ScheduleItem, WeeklyReport} from '../../lib/npc/molly-reports';
import {sortBriefSchedule} from '../../lib/npc/molly-reports';
import {briefOpeners, reportOpeners, weeklyBlocks, weeklyHeadlines, weeklyItems} from '../../lib/npc/molly-report-config';
import {professionalTaskStepDate} from '../../lib/npc/professional-task-expiry';
import {shanghaiToday, shiftTaskDate, validTaskDate} from '../../lib/npc/task-items';
import {buildSecretaryReport, reportOccurrences, type ReportInputs} from './secretary-reports';

/** Pure mapping of an already owner-validated snapshot. No demo fixtures,
 * database, provider, model, clock tick or task mutation is accessed here. */
function validateSnapshot(input: ReportInputs) {
  if (!Number.isFinite(input.now)) throw Error('报告时间无效');
  if (input.snapshot.readErrors) throw Error('部分任务记录暂时无法读取');
}
function validateDay(date: string, now: number) {
  if (!validTaskDate(date) || date > shanghaiToday(now)) throw Error('报告日期无效');
}

export function buildScheduledDailyBrief(input: ReportInputs, options: {date: string; city?: ReportCity; weather?: ReportWeather}): DailyBrief {
  validateSnapshot(input); validateDay(options.date, input.now);
  const {date, city, weather} = options;
  const schedule: ScheduleItem[] = reportOccurrences(input, date, date).flatMap(row => {
    const task = row.characterId ? input.snapshot.professionalTasks.find(task => row.id === `professional:${task.characterId}:${task.id}:${date}`) : undefined;
    if (task && (['paused', 'cancelled', 'skipped'].includes(task.status)
      || task.steps.filter(step => professionalTaskStepDate(task, step) === date).every(step => !!step.skippedAt))) return [];
    const ownerId = row.characterId || (row.kind === 'training' ? 'chen-nian' : row.kind === 'nutrition' ? 'liu' : 'zhou-chef');
    return [{id: row.id, date, time: row.time || '全天', text: `${row.title}${row.completed ? '（已完成）' : ''}`,
      category: row.kind === 'training' ? 'training' : row.kind === 'nutrition' ? 'meal' : 'other', ownerId,
      ...(row.source ? {sub: {kind: 'reason' as const, text: `来源：${row.source}`}} : {})}];
  });
  const validWeather = city && weather && Number.isFinite(weather.min) && Number.isFinite(weather.max) && weather.min <= weather.max && weather.text.trim();
  return {date, opener: schedule.length
    ? {category: 'normal', text: briefOpeners.categories.normal.find(text => text === '今天的安排') || '今天的安排'}
    : {category: 'empty', text: briefOpeners.categories.empty.find(text => text === '早') || '早'},
    header: {city: city?.name || '城市未设置', ...(validWeather ? {weather: {low: weather.min, high: weather.max, text: weather.text,
      ...(weather.summary && weather.summary !== weather.text ? {tip: weather.summary} : {})}} : {})},
    pending: [], schedule: sortBriefSchedule(schedule, date), shopping: [], bills: [], progress: [], upcoming: [], interests: []};
}

const number = (value: number) => String(Number(value.toFixed(2)));
function difference(value: number, previous: number | null | undefined, unit: string): string {
  if (previous == null) return '上期暂无记录';
  const delta = Number((value - previous).toFixed(2));
  return delta === 0 ? '与上期持平' : `比上期 ${delta < 0 ? '−' : '+'}${number(Math.abs(delta))}${unit}`;
}
function label(section: 'body' | 'training' | 'diet', key: string, fallback: string) {
  return weeklyItems[section].find(item => item.key === key)?.label || fallback;
}
function block(id: string, rows: ReportRow[]): ReportBlock | undefined {
  const config = weeklyBlocks.find(item => item.id === id);
  if (!config || !rows.length) return;
  return {id, name: config.name, ownerIds: [...config.ownerIds], rows: config.maxRows == null ? rows : rows.slice(0, config.maxRows)};
}

export function buildScheduledWeeklyReport(input: ReportInputs, range: {startDate: string; endDate: string}): WeeklyReport {
  validateSnapshot(input); validateDay(range.startDate, input.now); validateDay(range.endDate, input.now);
  if (shiftTaskDate(range.startDate, 6) !== range.endDate) throw Error('周报需要连续七天的范围');
  const computed = buildSecretaryReport('weekly', input, range), body: ReportRow[] = [];
  if (computed.weightKg !== null) body.push({itemKey: 'weight', label: label('body', 'weight', '体重（周平均）'), value: `${number(computed.weightKg)}kg`, note: difference(computed.weightKg, computed.previousWeightKg, 'kg')});
  if (computed.waistCm !== null) body.push({itemKey: 'waist', label: label('body', 'waist', '腰围'), value: `${number(computed.waistCm)}cm`, note: difference(computed.waistCm, computed.previousWaistCm, 'cm')});
  for (const [key, text] of Object.entries(computed.feelings)) if (text) body.push({itemKey: key, label: {sleep: '睡眠自述', energy: '精力自述', soreness: '酸痛自述'}[key] || key, value: text, note: '本期最后一次明确记录'});
  const blocks = [block('body', body),
    block('training', computed.training.planned ? [{itemKey: 'completion', label: label('training', 'completion', '完成'), value: `${computed.training.completed}/${computed.training.planned}次`, note: '按已保存训练任务统计'}] : []),
    block('diet', computed.nutrition.planned ? [{itemKey: 'plan', label: label('diet', 'plan', '按计划'), value: `${computed.nutrition.completed}/${computed.nutrition.planned}天`, note: '仅统计已有饮食任务的日期'}] : []),
    block('cooking', computed.cooking.planned ? [{itemKey: 'learn', label: '做菜记录', value: `${computed.cooking.completed}/${computed.cooking.planned}次`, note: '按已保存做菜任务统计'}] : []),
  ].filter((item): item is ReportBlock => !!item);
  const complete = [['训练', computed.training], ['饮食', computed.nutrition], ['做菜', computed.cooking]] as const;
  const finished = complete.find(([, metric]) => metric.planned > 0 && metric.completed === metric.planned);
  const headlineTemplate = weeklyHeadlines.find(item => item.condition === '某领域本周计划全部完成')?.template;
  const headline = finished && headlineTemplate ? headlineTemplate.replace('{领域}', finished[0]) : blocks.length ? '本周记录已整理' : '本周暂无可汇总的记录';
  // Only a source-authored report comment can become a quotable NPC comment.
  // Ordinary chat snippets and computed statistics are not invented evaluations.
  return {range: {from: range.startDate, to: range.endDate}, opener: {category: 'normal', text: reportOpeners.categories.normal.find(text => text === '周报整理好了') || '周报整理好了'}, headline, blocks, comments: []};
}
