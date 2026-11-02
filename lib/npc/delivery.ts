import type {ChatMessage} from './contracts';
// These are presentation pacing choices, not character relationship rules.
export const deliveryTiming={quietMs:3000,firstMinimumMs:5000,minGapMs:2200,maxGapMs:5000};
export function scheduleDelivery(messages:ChatMessage[],from:number,startedAt:number,now=Date.now()) {
 let next=Math.max(now,startedAt+deliveryTiming.firstMinimumMs);
 for(const message of messages.slice(from)){
  if(message.role!=='assistant')continue;
  message.deliverAt=next;
  message.at=new Date(next).toISOString();
  const length='text' in message.part?message.part.text.length:16;
  next+=Math.min(deliveryTiming.maxGapMs,Math.max(deliveryTiming.minGapMs,1200+length*90));
 }
}
export function deliveredMessages(messages:ChatMessage[],now=Date.now()) {
 return messages.filter(m=>!m.deliverAt||m.deliverAt<=now).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
export function deliveryView(messages:ChatMessage[],pending:{since:number}|null,now=Date.now()) {
 const future=messages.filter(m=>(m.deliverAt||0)>now);
 const preparing=!!pending&&now-pending.since<180000;
 return {messages:deliveredMessages(messages,now),pending:preparing||future.length>0,
  typingAfter:preparing?pending!.since+deliveryTiming.quietMs:future.length?Math.max(0,future[0].deliverAt!-1800):undefined};
}
