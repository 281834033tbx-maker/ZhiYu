/** Calendar values are always interpreted in Shanghai, independently of the host timezone. */
export const ARRANGEMENT_TIME_ZONE = 'Asia/Shanghai';
export type ArrangementRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly';
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday?: number;
  day?: number;
};
export type ParsedArrangementTime = {
  raw: string;
  date: string | null;
  time: string | null;
  /** Calendar deadline; date contains the same next occurrence for sorting. */
  deadline: string | null;
  recurrence: ArrangementRecurrence | null;
  display: string;
  explicitReminder: boolean;
  /** Only present when the user literally specifies an advance reminder interval. */
  reminderOffsetMinutes?: number;
  /** False for an explicitly supplied but impossible date/time. Empty time is valid. */
  valid: boolean;
};

const shanghaiParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: ARRANGEMENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DAY_MS = 86_400_000;
export function arrangementDateInShanghai(now: number = Date.now()): string {
  const parts = shanghaiParts.formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-');
}
export function isArrangementDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function shiftArrangementDate(date: string, days: number): string {
  if (!isArrangementDate(date) || !Number.isInteger(days)) throw new Error('Invalid arrangement calendar date');
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}
export function arrangementTimestamp(date: string, time: string = '00:00'): number {
  if (!isArrangementDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  return Date.parse(date + 'T' + time + ':00+08:00');
}
export function emptyArrangementTime(): ParsedArrangementTime {
  return {raw: '', date: null, time: null, deadline: null, recurrence: null, display: '', explicitReminder: false, valid: true};
}
const NUMBER = '(?:\\d+|[零〇一二两三四五六七八九十百]+)';
const WEEKDAY = '[一二三四五六日天1-7]';
export function arrangementChineseNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(text)) return NaN;
  const values: Record<string, number> = {'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
  if (text.includes('十')) {
    const [tens, units] = text.split('十');
    return (tens ? values[tens] : 1) * 10 + (units ? values[units] : 0);
  }
  return Array.from(text).reduce((n, c) => n * 10 + values[c], 0);
}
function weekday(text: string): number {
  return /[日天]/.test(text) ? 7 : arrangementChineseNumber(text);
}
function isoWeekday(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay() || 7;
}
function calendarDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isArrangementDate(value) ? value : null;
}
function monthlyOccurrence(year: number, month: number, day: number): string | null {
  // Monthly 31st means the last day in a shorter month, matching existing task month stepping.
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return calendarDate(year, month, Math.min(day, last));
}
function nextMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}
function shortDate(date: string, today: string): string {
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS);
  return days === 0 ? '今天' : days === 1 ? '明天' : days === 2 ? '后天' : `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

/** Parse literal user time phrases; callers must never pass a model-calculated ISO date. */
export function parseArrangementTime(text: string, now: number = Date.now()): ParsedArrangementTime {
  const result = emptyArrangementTime();
  const source = text.slice(0, 4_000);
  const today = arrangementDateInShanghai(now);
  let [year, month] = today.split('-').map(Number);
  const tokens: {index: number; value: string}[] = [];
  const keep = (match: RegExpMatchArray) => tokens.push({index: match.index ?? 0, value: match[0]});
  let dateLabel = '', period = '', rollover = false;

  const clock = source.match(new RegExp(`(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*(${NUMBER})(?:[:：](${NUMBER})|[点时](?:一刻|三刻|(${NUMBER})分?|(半))?)`));
  if (clock) {
    keep(clock);
    const hours = arrangementChineseNumber(clock[2]);
    const minuteText = clock[3] || clock[4];
    const minutes = minuteText ? arrangementChineseNumber(minuteText) : clock[5] ? 30 : clock[0].endsWith('三刻') ? 45 : clock[0].endsWith('一刻') ? 15 : 0;
    let hour = hours;
    period = clock[1] || '';
    if (/下午|傍晚|晚上|夜里/.test(period) && hour >= 1 && hour <= 11) hour += 12;
    if (/凌晨|早上|早晨|上午/.test(period) && hour === 12) hour = 0;
    if (/晚上|夜里/.test(period) && hour === 12) {hour = 0; rollover = true;}
    if (hour === 24 && minutes === 0) {hour = 0; rollover = true;}
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59 || (period && hours > 12)) result.valid = false;
    else result.time = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const monthly = source.match(new RegExp(`每(?:个)?月\\s*(${NUMBER})[号日]`));
  const weekly = source.match(new RegExp(`每(?:个)?(?:周|星期)(${WEEKDAY})`));
  const daily = source.match(/每天|每日/);
  const fullDate = source.match(new RegExp(`(?:(20\\d{2})年)?(${NUMBER})月(${NUMBER})[号日]`));
  const week = source.match(new RegExp(`(下下|下|本|这)?(?:周|星期)(${WEEKDAY})`));
  const relative = source.match(/大后天|后天|明天|明早|明晚|今天|今日|今晚|今早|今夜/);
  const dayOfMonth = source.match(new RegExp(`(下(?:个)?月|本月|这个月)?(${NUMBER})[号日]`));
  const weekend = source.match(/下周末|本周末|这周末|周末/);
  if (monthly) {
    keep(monthly);
    const day = arrangementChineseNumber(monthly[1]);
    result.recurrence = {frequency: 'monthly', day};
    result.date = monthlyOccurrence(year, month, day);
    if (result.date && (result.date < today || (result.time && arrangementTimestamp(result.date, result.time) <= now))) {
      [year, month] = nextMonth(year, month); result.date = monthlyOccurrence(year, month, day);
    }
    dateLabel = `每月${day}号`;
    if (!result.date) result.valid = false;
  } else if (weekly) {
    keep(weekly); const day = weekday(weekly[1]);
    result.recurrence = {frequency: 'weekly', weekday: day};
    result.date = shiftArrangementDate(today, (day - isoWeekday(today) + 7) % 7);
    if (result.time && arrangementTimestamp(result.date, result.time) <= now) result.date = shiftArrangementDate(result.date, 7);
    dateLabel = '每周' + '一二三四五六日'[day - 1];
  } else if (daily) {
    keep(daily); result.recurrence = {frequency: 'daily'}; result.date = today;
    if (result.time && arrangementTimestamp(today, result.time) <= now) result.date = shiftArrangementDate(today, 1);
    dateLabel = '每天';
  } else if (fullDate) {
    keep(fullDate); const statedYear = fullDate[1] ? Number(fullDate[1]) : year;
    const statedMonth = arrangementChineseNumber(fullDate[2]), day = arrangementChineseNumber(fullDate[3]);
    result.date = calendarDate(statedYear, statedMonth, day);
    if (!fullDate[1] && result.date && result.date < today) result.date = calendarDate(statedYear + 1, statedMonth, day);
    // Feb 29 without an explicit year means the next actual leap day.
    if (!fullDate[1] && !result.date && statedMonth === 2 && day === 29) {
      for (let offset = 1; offset <= 8; offset++) {result.date = calendarDate(year + offset, 2, 29); if (result.date) break;}
    }
    if (!result.date) result.valid = false;
    dateLabel = fullDate[0];
  } else if (week) {
    keep(week); const day = weekday(week[2]), prefix = week[1] || '';
    const monday = shiftArrangementDate(today, 1 - isoWeekday(today));
    result.date = shiftArrangementDate(monday, day - 1 + (prefix === '下下' ? 14 : prefix === '下' ? 7 : 0));
    if (!prefix && (result.date < today || (result.time && arrangementTimestamp(result.date, result.time) <= now))) result.date = shiftArrangementDate(result.date, 7);
    dateLabel = week[0].replace('星期', '周');
  } else if (relative) {
    keep(relative); const offset = relative[0] === '大后天' ? 3 : relative[0] === '后天' ? 2 : relative[0].startsWith('明') ? 1 : 0;
    result.date = shiftArrangementDate(today, offset); dateLabel = relative[0];
    if (!period && /晚|夜/.test(relative[0])) period = '晚上';
    if (result.time && !clock?.[1] && period === '晚上') {
      const [hour, minute] = result.time.split(':').map(Number);
      result.time = `${String(hour >= 1 && hour <= 11 ? hour + 12 : hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  } else if (dayOfMonth) {
    keep(dayOfMonth); const day = arrangementChineseNumber(dayOfMonth[2]);
    if (dayOfMonth[1]?.startsWith('下')) [year, month] = nextMonth(year, month);
    result.date = calendarDate(year, month, day);
    if (!dayOfMonth[1] && day >= 1 && day <= 31) {
      // A one-off bare "31号" seeks an actual 31st; only recurring monthly rules clamp.
      for (let offset = 0; offset < 13; offset++) {
        result.date = calendarDate(year, month, day);
        if (result.date && result.date >= today && !(result.time && arrangementTimestamp(result.date, result.time) <= now)) break;
        [year, month] = nextMonth(year, month);
      }
    }
    if (!result.date) result.valid = false;
    dateLabel = dayOfMonth[0];
  } else if (weekend) {
    keep(weekend);
    const monday = shiftArrangementDate(today, 1 - isoWeekday(today));
    result.date = shiftArrangementDate(monday, 5 + (weekend[0].startsWith('下') ? 7 : 0));
    if (result.date < today) result.date = shiftArrangementDate(result.date, 7);
    dateLabel = weekend[0];
  } else if (clock) {
    result.date = today;
    if (result.time && arrangementTimestamp(today, result.time) <= now) result.date = shiftArrangementDate(today, 1);
    dateLabel = shortDate(result.date, today);
  }
  if (rollover && result.date) result.date = shiftArrangementDate(result.date, 1);
  if (relative && dayOfMonth && !fullDate && !monthly && result.date && Number(result.date.slice(8)) !== arrangementChineseNumber(dayOfMonth[2])) result.valid = false;
  const deadline = /(?:之前|以前|截止|最晚|到期|届满|截至)/.test(source)
    || /(?:[号日天]|周[一二三四五六日天1-7]|[点分]|\d{2}[:：]\d{2})前/.test(source);
  if (deadline && result.date) result.deadline = result.date;
  const timePeriod = !result.time ? source.match(/凌晨|早上|上午|中午|下午|傍晚|晚上/) : null;
  if (timePeriod && result.date) {keep(timePeriod); if (!dateLabel.includes(timePeriod[0])) dateLabel += timePeriod[0];}
  if (result.date && deadline && !/到期|届满/.test(source)) dateLabel += result.time ? '' : '前';
  result.display = dateLabel + (result.time ? result.time + (deadline && !/到期|届满/.test(source) ? '前' : '') : '');
  result.explicitReminder = /提醒我|提醒一下|提醒下|通知我|叫我|别让我忘|别忘了提醒/.test(source) && !!result.date;
  const advance = source.match(new RegExp(`提前\\s*(半|${NUMBER})\\s*(分钟|小时|天)(?:[^。！？!?]{0,8})提醒`));
  if (advance && result.date) {
    const amount = advance[1] === '半' ? 0.5 : arrangementChineseNumber(advance[1]);
    const minutes = amount * (advance[2] === '天' ? 1440 : advance[2] === '小时' ? 60 : 1);
    if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 365 * 1440) {
      result.reminderOffsetMinutes = minutes; result.explicitReminder = true;
    } else result.valid = false;
  }
  result.raw = tokens.sort((a, b) => a.index - b.index).map(t => t.value).filter((value, index, all) => all.indexOf(value) === index).join(' ');
  return result;
}
