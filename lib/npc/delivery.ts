import type {GroupMessage} from './group-chat';
import type {ChatMessage} from './contracts';
import {getCharacter} from './character-directory';
// Presentation pacing only; relationship and model availability never alter it.
export const deliveryTiming={quietMs:1000,firstMinimumMs:500,minGapMs:300,maxGapMs:800};
export type DeliveryOptions={characterId?:string;typingSpeed?:number;rng?:()=>number};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const initialDelay=(startedAt:number)=>500+(Math.abs(Math.trunc(startedAt)*9301+49297)%1001);
export function typingDuration(text:string,typingSpeed=1):number {
 const letters=Array.from(text.replace(/\s/gu,''));
 const short=letters.length<=2||/^[\p{Extended_Pictographic}\uFE0F\u200D\p{Emoji_Modifier}]+$/u.test(text.trim());
 const base=short?600:clamp(800+letters.length*120,1000,4000);
 return Math.round(base*clamp(typingSpeed,.5,2));
}
export function scheduleDelivery(messages:ChatMessage[],from:number,startedAt:number,now=Date.now(),options:DeliveryOptions={}) {
 const rng=options.rng||Math.random,speed=options.typingSpeed??getCharacter(options.characterId||'')?.typingSpeed??1;
 let next=Math.max(now,startedAt+initialDelay(startedAt));
 for(const message of messages.slice(from)){
  if(message.role!=='assistant')continue;
  const text='text' in message.part?message.part.text:'';
  message.typingAt=next;
  message.deliverAt=next+typingDuration(text||'照片内容',speed);
  message.at=new Date(message.deliverAt).toISOString();
  next=message.deliverAt+Math.round(deliveryTiming.minGapMs+clamp(rng(),0,1)*(deliveryTiming.maxGapMs-deliveryTiming.minGapMs));
 }
}
export function deliveredMessages(messages:ChatMessage[],now=Date.now()) {
 return messages.filter(m=>!m.deliverAt||m.deliverAt<=now).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
export function deliveryView(messages:ChatMessage[],pending:{since:number}|null,now=Date.now()) {
 const future=messages.filter(m=>(m.deliverAt||0)>now).sort((a,b)=>a.deliverAt!-b.deliverAt!);
 const preparing=!!pending&&now-pending.since<180000;
 const next=future[0];
 return {messages:deliveredMessages(messages,now),pending:preparing||future.length>0,
  typingAfter:preparing?pending!.since+initialDelay(pending!.since):next?(next.typingAt??Math.max(0,next.deliverAt!-1000)):undefined,
  typingUntil:preparing?undefined:next?.deliverAt};
}

/** A group still has one visible typist; every speaker gets their own speed. */
export function scheduleGroupDelivery(messages:GroupMessage[],from:number,startedAt:number,now=Date.now(),rng:()=>number=Math.random) {
 let next=Math.max(now,startedAt+initialDelay(startedAt));
 for(const message of messages.slice(from)){
  if(message.senderId==='user'||message.type==='event')continue;
  message.typingAt=next;
  message.deliverAt=next+typingDuration(message.text||'照片内容',getCharacter(message.senderId)?.typingSpeed??1);
  message.at=new Date(message.deliverAt).toISOString();
  next=message.deliverAt+Math.round(deliveryTiming.minGapMs+clamp(rng(),0,1)*(deliveryTiming.maxGapMs-deliveryTiming.minGapMs));
 }
}

/** Anchor the initial indicator to the actual queued user message, including
 * the brief interval before a worker has marked the model request pending. */
export function presentationPending(state:{messages:ChatMessage[];pending?:{since:number}|null;queue?:string[];error?:string;life?:{queue:string[];lastError?:string}},now=Date.now()):{since:number}|null {
 const queue=state.queue||state.life?.queue||[],failed=state.error||state.life?.lastError;
 if(!state.pending&&(!queue.length||failed))return null;
 const times=state.messages.filter(message=>message.role==='user'&&queue.includes(message.turnId)&&!message.chronologyUnknown).map(message=>Date.parse(message.at)).filter(at=>Number.isFinite(at)&&at<=now);
 const since=times.length?Math.min(...times,state.pending?.since??Infinity):state.pending?.since;
 return since===undefined?null:{since};
}
