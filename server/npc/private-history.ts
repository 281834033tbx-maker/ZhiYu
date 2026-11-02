import type {ChatMessage} from '../../lib/npc/contracts';

type HistoryState = {
 messages:ChatMessage[];
 /** Display tombstones preserve the original records, memories and relationship. */
 privateHistoryHiddenIds?:string[];
 pending?:{id:string;since:number}|null;
 queue?:string[];
 inputRevision?:number;
 error?:string;
 retryAt?:number;
 typing?:Record<string,{sequence:number;until:number}>;
 life?:{queue:string[];inputRevision?:number;lastError:string;retryAt:number;typingClients?:Record<string,{sequence:number;until:number}>};
 showerFollowUp?:unknown;
};

export function privateHistoryMessages(state:{messages:ChatMessage[]}):ChatMessage[] {
 const hidden=(state as HistoryState).privateHistoryHiddenIds;
 if(!hidden?.length)return state.messages;
 const ids=new Set(hidden);
 return state.messages.filter(message=>!ids.has(message.id));
}

/** Clear presentation, cancel work originating before the clear, and retain all source data. */
export function clearPrivateHistory(state:{messages:ChatMessage[]}):void {
 const history=state as HistoryState;
 history.privateHistoryHiddenIds=[...new Set([...(history.privateHistoryHiddenIds||[]),...history.messages.map(message=>message.id)])];
 history.pending=null;
 if(history.queue)history.queue=[];
 if(typeof history.inputRevision==='number')history.inputRevision++;
 if(typeof history.error==='string')history.error='';
 if(typeof history.retryAt==='number')history.retryAt=0;
 for(const client of Object.values(history.typing||{}))client.until=0;
 if(history.life){
  history.life.queue=[];
  history.life.inputRevision=(history.life.inputRevision||0)+1;
  history.life.lastError='';history.life.retryAt=0;
  for(const client of Object.values(history.life.typingClients||{}))client.until=0;
 }
 // A follow-up scheduled from a now-cleared message must not reappear as a reply.
 if('showerFollowUp' in history)history.showerFollowUp=null;
}
