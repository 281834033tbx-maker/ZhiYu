import type {GroupChat,GroupMessage} from './group-chat';

// Public release: preserve source-filtering contracts without shipping a
// private authored maintenance manuscript or a record creation pathway.
export const FRIDAY_DINNER_DEMO_SCENARIO='friday-dinner-v1' as const;
export const FRIDAY_DINNER_DEMO_REQUEST='demo:friday-dinner-v1';
type AuthoredLine={senderId:string;senderName:string;time:string;text:string};
export const FRIDAY_DINNER_DEMO_MESSAGES:readonly AuthoredLine[]=[];

export function splitFridayDinnerMessage(message:GroupMessage):GroupMessage[] {
  return [message];
}
export function splitFridayDinnerHistory(messages:readonly GroupMessage[],hiddenBefore?:number):{messages:GroupMessage[];hiddenBefore?:number} {
  return {messages:[...messages],...(hiddenBefore===undefined?{}:{hiddenBefore})};
}
export function authoredDinnerDate(now:number):string {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(item=>item.type===type)!.value;
  let date=`${part('year')}-${part('month')}-${part('day')}`;
  if(now<Date.parse(`${date}T16:02:10+08:00`))date=new Date(Date.parse(`${date}T00:00:00Z`)-86_400_000).toISOString().slice(0,10);
  return date;
}
export function createFridayDinnerRecord(_input:{id:string;createdAt:string;selfAvatar?:string;now?:number}):GroupChat {
  throw new Error('当前版本不支持导入历史记录');
}
export const createFridayDinnerDemo=createFridayDinnerRecord;

export function isAuthoredGroupMessage(group:GroupChat,message:GroupMessage):boolean {
  return !!message.authoredRecord||!!group.authoredRecord?.messageIds.includes(message.id)||!!group.cutOpeningRecord?.messageIds.includes(message.id);
}
/** Keep private authorship out of normal AI evidence even if compatible
 * account data later contains an authored record marker. */
export function groupForOrdinaryDialogue(group:GroupChat):GroupChat {
  if(!group.authoredRecord&&!group.cutOpeningRecord&&!group.messages.some(message=>message.authoredRecord))return group;
  const excluded=new Set([...group.messages.filter(message=>isAuthoredGroupMessage(group,message)).map(message=>message.id),...(group.authoredRecord?.messageIds||[]),...(group.cutOpeningRecord?.messageIds||[])]);
  return {...group,messages:group.messages.filter(message=>!excluded.has(message.id)).map(message=>{
    if(!message.quote||!excluded.has(message.quote.id))return message;
    const {quote:_quote,replyTo:_replyTo,...plain}=message;
    return plain;
  })};
}
