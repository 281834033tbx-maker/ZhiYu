import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {initBetaAnalytics,recordBetaEvent} from './beta-analytics-store';

type UsageMessage={id:string;turnId:string;role:string;origin?:string;deliverAt?:number;deliveryCancelled?:boolean};
let savepoint=0;
export const initBetaUsage=(db:DatabaseSync)=>initBetaAnalytics(db);
function atomic<T>(db:DatabaseSync,work:()=>T):T{
  const name=`beta_usage_${++savepoint}`;db.exec(`SAVEPOINT ${name}`);
  try{const result=work();db.exec(`RELEASE SAVEPOINT ${name}`);return result;}
  catch(error){db.exec(`ROLLBACK TO SAVEPOINT ${name}`);db.exec(`RELEASE SAVEPOINT ${name}`);throw error;}
}
const key=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,48);
const accountFor=(db:DatabaseSync,owner:string)=>db.prepare('SELECT id FROM zhiyu_accounts WHERE owner_id=?').get(owner) as {id:string}|undefined;
/** Called only inside the new ordinary-send branch, with visible history. It
 * commits the actual message and its content-free event in one transaction. */
export function persistBetaPrivateMessage(db:DatabaseSync,input:{ownerId:string;npcId:string;turnId:string;messages:UsageMessage[];at:number},persist:()=>void){
  return atomic(db,()=>{
    persist();const account=accountFor(db,input.ownerId);if(!account)return;
    const index=input.messages.findIndex(message=>message.role==='user'&&message.turnId===input.turnId);
    if(index<0||input.messages[index].origin==='call')return;
    recordBetaEvent(db,{accountId:account.id,eventId:`message-sent:${input.npcId}:${key(input.turnId)}`,type:'message_sent',npcId:input.npcId,at:input.at,meta:{context:'private'}});
    const prior=input.messages.slice(0,index).filter(message=>!message.deliveryCancelled&&(!message.deliverAt||message.deliverAt<=input.at)).at(-1);
    if(prior?.role==='assistant'&&prior.origin==='proactive')recordBetaEvent(db,{accountId:account.id,eventId:`proactive-reply:${input.npcId}:${key(prior.id)}`,type:'proactive_replied',npcId:input.npcId,at:input.at,meta:{context:'private'}});
  });
}
export function persistBetaGroupMessage(db:DatabaseSync,input:{ownerId:string;groupId:string;requestId:string;recipientIds:string[];at:number},persist:()=>void){
  return atomic(db,()=>{
    persist();const account=accountFor(db,input.ownerId);if(!account)return;
    recordBetaEvent(db,{accountId:account.id,eventId:`group-message:${key(input.groupId+':'+input.requestId)}`,type:'message_sent',at:input.at,meta:{context:'group',groupId:input.groupId,recipientIds:input.recipientIds}});
  });
}
export function initBetaVoiceUsage(db:DatabaseSync){
  initBetaAnalytics(db);
  db.exec(`CREATE TABLE IF NOT EXISTS zhiyu_beta_voice_calls(call_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,npc_id TEXT NOT NULL,ready_at INTEGER NOT NULL,ended_at INTEGER);`);
}
/** A request or placeholder call action never reaches this function. */
export function noteBetaVoiceReady(db:DatabaseSync,ownerId:string,callId:string,npcId:string,now=Date.now()){
  const account=accountFor(db,ownerId);if(!account)return;
  db.prepare('INSERT OR IGNORE INTO zhiyu_beta_voice_calls(call_id,account_id,npc_id,ready_at) VALUES(?,?,?,?)').run(callId,account.id,npcId,now);
}
/** No ready record means no connected call. Incomplete calls after a process
 * crash stay incomplete; no duration is estimated from an idle timeout. */
export function endBetaVoiceCall(db:DatabaseSync,ownerId:string,callId:string,now=Date.now()){
  return atomic(db,()=>{
    const account=accountFor(db,ownerId);if(!account)return;
    const call=db.prepare('SELECT ready_at,npc_id,ended_at FROM zhiyu_beta_voice_calls WHERE call_id=? AND account_id=?').get(callId,account.id) as {ready_at:number;npc_id:string;ended_at:number|null}|undefined;
    if(!call||call.ended_at!==null||now<call.ready_at)return;
    db.prepare('UPDATE zhiyu_beta_voice_calls SET ended_at=? WHERE call_id=? AND ended_at IS NULL').run(now,callId);
    recordBetaEvent(db,{accountId:account.id,eventId:`voice-call:${key(callId)}`,type:'voice_call',npcId:call.npc_id,at:now,value:(now-call.ready_at)/1000,meta:{context:'private'}});
  });
}
