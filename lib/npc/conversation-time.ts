const timezone='Asia/Shanghai';
const calendar=new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
const clock=new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,weekday:'long'});
const millisecondsPerDay=86400000;

function localDay(date:Date) {
  const parts=Object.fromEntries(calendar.formatToParts(date).map(part=>[part.type,part.value]));
  return {number:Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day))/millisecondsPerDay,
    month:Number(parts.month),day:Number(parts.day)};
}

/** Conversation dates follow the current Shanghai Monday–Sunday calendar week,
 * never a rolling seven-day window or the computer's own timezone. */
export function formatConversationTime(value?:string,now:Date|number=Date.now()):{label:string;yesterday:boolean} {
  if(!value)return {label:'',yesterday:false};
  const date=new Date(value),current=new Date(now instanceof Date?now.getTime():now);
  if(Number.isNaN(date.getTime())||Number.isNaN(current.getTime()))return {label:'',yesterday:false};
  const day=localDay(date),today=localDay(current);
  const daysSinceMonday=(new Date(today.number*millisecondsPerDay).getUTCDay()+6)%7;
  const monday=today.number-daysSinceMonday;
  // A Sunday seen on Monday belongs to the previous week, even though it was yesterday.
  if(day.number<monday||day.number>=monday+7)return {label:`${day.month}月${day.day}日`,yesterday:false};
  const difference=today.number-day.number;
  if(difference===0)return {label:clock.format(date),yesterday:false};
  if(difference===1)return {label:`昨天 ${clock.format(date)}`,yesterday:true};
  return {label:weekday.format(date),yesterday:false};
}
