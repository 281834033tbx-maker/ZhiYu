const minute=60000,hour=60*minute,day=24*hour;
const calendar=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'});

/** Public server timestamps are milliseconds; local posts use an ISO instant.
 * Reject ambiguous/invalid strings rather than inventing a posting clock. */
export function momentTimestamp(value:unknown):string|undefined {
  if(typeof value==='string'){
    const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
    if(!match)return;
    const year=Number(match[1]),month=Number(match[2]),date=Number(match[3]);
    if(month<1||month>12||date<1||date>new Date(Date.UTC(year,month,0)).getUTCDate())return;
  }else if(typeof value!=='number'||!Number.isFinite(value))return;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return;
  return date.toISOString();
}

/** Relative labels use elapsed hours, not a calendar-day boundary. */
export function formatMomentTime(value:unknown,now:Date|number=Date.now()):string {
  const instant=momentTimestamp(value),current=now instanceof Date?now.getTime():now;
  if(!instant||!Number.isFinite(current))return '';
  const date=new Date(instant),elapsed=current-date.getTime();
  if(elapsed>=0&&elapsed<minute)return '刚刚';
  if(elapsed>=minute&&elapsed<hour)return `${Math.floor(elapsed/minute)}分钟前`;
  if(elapsed>=hour&&elapsed<day)return `${Math.floor(elapsed/hour)}小时前`;
  // A future timestamp is shown only as its literal Shanghai calendar date;
  // it must never become a fabricated "just now" or negative elapsed label.
  const parts=Object.fromEntries(calendar.formatToParts(date).map(part=>[part.type,part.value]));
  return `${Number(parts.month)}月${Number(parts.day)}日`;
}
