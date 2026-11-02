import type { GroupReminder } from '../../lib/npc/group-chat';

export function shanghaiDate(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function reminderOccurrence(reminder: GroupReminder, now: number): { key: string; at: number; due: boolean } | null {
  if (reminder.status !== 'active') return null;
  const date = shanghaiDate(now);
  if (date < reminder.startDate || date > reminder.endDate || reminder.lastOccurrence === date) return null;
  const at = Date.parse(`${date}T${reminder.time}:00+08:00`);
  if (now < at) return null;
  // An offline service records today's missed occurrence without replaying it.
  return { key: date, at, due: now - at <= 60_000 };
}

export function reminderStillCurrent(reminder: GroupReminder | undefined, occurrence: string, now: number): boolean {
  if (!reminder || reminder.status !== 'active' || shanghaiDate(now) !== occurrence) return false;
  const at = Date.parse(`${occurrence}T${reminder.time}:00+08:00`);
  return now >= at && now - at <= 5 * 60_000;
}

/** Match an exact stated time, refusing approximation and illustrative examples. */
export function explicitTimeMatches(text: string, time: string): boolean {
  if (/(?:比如|例如|举例|假设|假如|左右|大约|差不多)/.test(text)) return false;
  const [hour, minute] = time.split(':').map(Number);
  const numeric = [...text.matchAll(/(?:^|[^\d])(\d{1,2})[:：](\d{2})(?!\d)/g)];
  if (numeric.some(match => Number(match[1]) === hour && Number(match[2]) === minute)) return true;
  const chineseNumber = (value: string) => {
    if (/^\d+$/.test(value)) return Number(value);
    const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (value === '十') return 10;
    if (value.includes('十')) { const [tens, ones] = value.split('十'); return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0); }
    return digits[value];
  };
  for (const match of text.matchAll(/(早上|早晨|上午|中午|下午|晚上|晚间)(\d{1,2}|[零一二两三四五六七八九十]{1,3})点(?:(半)|(\d{1,2}|[零一二两三四五六七八九十]{1,3})分)?/g)) {
    let statedHour = chineseNumber(match[2]);
    if (['下午', '晚上', '晚间'].includes(match[1]) && statedHour < 12) statedHour += 12;
    if (['早上', '早晨', '上午'].includes(match[1]) && statedHour === 12) statedHour = 0;
    const statedMinute = match[3] ? 30 : match[4] ? chineseNumber(match[4]) : 0;
    if (statedHour === hour && statedMinute === minute) return true;
  }
  return false;
}

export function explicitConfirmation(text: string): boolean {
  return !/(?:不要|不确认|别|暂时|等一下|先不|再改|还没|不确定|是否|可以吗|可以么|可不可以|会不会|[?？])/.test(text)
    && /(?:确认|敲定|定下来|就按这个|就这样|按这个来|可以|同意|好的|记下来)/.test(text);
}

export function reminderSuppressed(text: string): boolean {
  return /(?:不要|别.{0,8}提醒|不.{0,5}提醒|暂时|先不|等一下|暂停|取消|以后再|晚点再|不确定|是否|可以吗|可以么|可不可以|会不会|[?？])/.test(text);
}
