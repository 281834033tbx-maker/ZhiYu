import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage,NpcState} from '../../lib/npc/contracts';
import {contactDecision,contactSchedule,ensureContact,completeContactTurn,type ContactHost} from '../../lib/npc/contact-life';
import {statusFromState} from '../../lib/npc/character-status';
import {ensureLife} from '../../lib/npc/life';
import {isDialogueCrisisInput} from '../../lib/npc/dialogue-output-guard';
import {shanghaiToday} from '../../lib/npc/task-items';
import {arrangementTimestamp,shiftArrangementDate} from '../../lib/npc/arrangement-time';
import {ArrangementStore} from './arrangements-store';
import {DialoguePreferencesStore,preferenceNpcId,type DialoguePreferenceNpcId} from './dialogue-preferences';
import type {ReadonlyArrangementItem} from './arrangement-readonly';

const bindings={molly:['molly_sessions','molly-system-secretary'],'he-jiawei':['he_sessions','he-jiawei'],'chen-nian':['chen_sessions','chen-nian'],liu:['liu_sessions','liu'],'zhou-chef':['zhou_chef_sessions','zhou-chef'],'yuan-xiaoman':['yuan_sessions','yuan-xiaoman'],'xia-xia':['sessions','xia-xia:normal']} as const;
type Host=ContactHost&{revision?:number;pending?:unknown;queue?:string[];paused?:boolean;cooldownUntil?:number;interaction?:string;emotionTier?:string;life?:NpcState['life'];proactive?:{sentAt:number[];nextAt:number};typing?:Record<string,{until:number}>};
type Dependencies={now?:()=>number;generate?:(npcId:DialoguePreferenceNpcId,item:ReadonlyArrangementItem,fallback:string)=>Promise<string>;forwardMolly?:boolean};
const exists=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
function load(db:DatabaseSync,owner:string,npc:DialoguePreferenceNpcId){const [table,suffix]=bindings[npc];if(!exists(db,table))return null;const key=`${owner}:${suffix}`,row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;return row?{table,key,raw:row.data,state:JSON.parse(row.data) as Host}:null;}
function normal(state:Host,now:number,npc:DialoguePreferenceNpcId){const latest=state.messages.findLast(m=>m.role==='user'),text=latest&&('text'in latest.part?latest.part.text:'transcript'in latest.part&&typeof latest.part.transcript==='string'?latest.part.transcript:'');return !isDialogueCrisisInput(text||'')&&!state.paused&&statusFromState(npc,state,now).kind!=='silent'&&state.interaction!=='cooldown'&&!(state.cooldownUntil&&state.cooldownUntil>now)&&(state.values?.affection??1)>=0&&(state.values?.anger??0)<20&&!['cold','silent','冷淡','静默'].includes(state.emotionTier||'')&&!(state.contactLife?.quietUntil&&state.contactLife.quietUntil>now)&&!(state.contactLife?.busyUntil&&state.contactLife.busyUntil>now)&&!(state.contactLife?.sleepingUntil&&state.contactLife.sleepingUntil>now)&&!(state.life?.quietUntil&&state.life.quietUntil>now)&&!(state.life?.playerSleepingUntil&&state.life.playerSleepingUntil>now)&&(npc==='molly'||!contactSchedule(state,now).sleeping)&&!state.pending&&!state.queue?.length&&!state.life?.queue?.length&&!state.messages.some(m=>(m.deliverAt||0)>now)&&!Object.values(state.typing||{}).some(v=>v.until>now)&&!Object.values(state.life?.typingClients||{}).some(v=>v.until>now);}
function save(db:DatabaseSync,row:NonNullable<ReturnType<typeof load>>){row.state.revision=(row.state.revision||0)+1;if(row.table==='sessions')db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(row.state.revision,JSON.stringify(row.state),row.key);else db.prepare(`UPDATE ${row.table} SET data=? WHERE id=?`).run(JSON.stringify(row.state),row.key);}
function recordCount(state:Host,npc:DialoguePreferenceNpcId,now:number,message:ChatMessage,kind:NonNullable<ReturnType<typeof contactDecision>['kind']>){completeContactTurn(state,now,kind,[message]);if(npc==='xia-xia'||state.life){const life=ensureLife(state as NpcState,now),today=shanghaiToday(now);if(life.proactiveDay!==today){life.proactiveDay=today;life.proactiveAttempts=0;}life.proactiveAttempts++;life.nextProactiveAt=state.contactLife!.nextAt;}
 if(state.proactive){state.proactive.sentAt=state.contactLife!.sentAt;state.proactive.nextAt=state.contactLife!.nextAt;}}
function reserveMollyBudget(db:DatabaseSync,owner:string,eventId:string,item:ReadonlyArrangementItem,text:string,now:number){new ArrangementStore(db);const today=shanghaiToday(now),start=arrangementTimestamp(today),end=arrangementTimestamp(shiftArrangementDate(today,1)),rawId=item.id.startsWith('arrangement:')?item.id.slice('arrangement:'.length):item.id;
 if(db.prepare("SELECT 1 FROM npc_arrangement_reminders WHERE owner=? AND item_id IN (?,?) AND status IN ('pending','delivered') AND due_at>=? AND due_at<?").get(owner,item.id,rawId,start,end))return false;
 if(db.prepare('SELECT 1 FROM npc_dialogue_supervision_sent WHERE owner=? AND npc_id=? AND item_id=? AND date=?').get(owner,'molly',item.id,today))return false;
 const used=(db.prepare("SELECT COUNT(*) n FROM npc_arrangement_reminders WHERE owner=? AND explicit=0 AND status IN ('pending','delivered') AND due_at>=? AND due_at<?").get(owner,start,end) as {n:number}).n;
 if(db.prepare('SELECT 1 FROM npc_arrangement_reminders WHERE owner=? AND id=?').get(owner,eventId))return false;if(used>=5)return false;
 db.prepare('INSERT INTO npc_arrangement_reminders VALUES(?,?,?,?,?,?,?,?,?,?)').run(eventId,owner,item.id,'inactive','supervision:'+today,now,0,'delivered',null,text);return true;
}

/** Runs only after explicit opt-in. Uses the existing ContactLife decision,
 * counters and cooldown rather than introducing a parallel unbounded quota. */
export async function deliverSupervision(db:DatabaseSync,preferences:DialoguePreferencesStore,owner:string,npcId:string,deps:Dependencies={}){
 const npc=preferenceNpcId(npcId),clock=deps.now||Date.now,store=preferences.using(db),now=clock(),item=store.supervisionCandidates(owner,npc)[0];if(!item)return false;
 const original=load(db,owner,npc);if(!original||!normal(original.state,now,npc))return false;original.state.characterId||=npc==='molly'?'molly-system-secretary':npc;original.state.values||={};
 if(npc!=='molly'&&!original.state.contactLife){ensureContact(original.state,now);save(db,original);return false;}
 const kind=npc==='molly'?null:contactDecision(original.state,now).kind;if(npc!=='molly'&&!kind)return false;
 const fallback=store.supervisionText(npc,item,store.effectiveAddress(owner,npc).name),generated=deps.generate?await deps.generate(npc,item,fallback):fallback;
 if(!generated.trim()||generated.length>400)return false;
 return store.atomic(()=>{
  const fresh=load(db,owner,npc),at=clock();if(!fresh||fresh.raw!==original.raw||!normal(fresh.state,at,npc)||!store.supervisionCandidates(owner,npc).some(v=>v.id===item.id))return false;
  fresh.state.characterId||=npc==='molly'?'molly-system-secretary':npc;fresh.state.values||={};if(npc!=='molly'&&contactDecision(fresh.state,at).kind!==kind)return false;
  const eventId=`supervision:${npc}:${item.id}:${shanghaiToday(at)}`,message:ChatMessage={id:eventId,turnId:eventId,role:'assistant',at:new Date(at).toISOString(),origin:'proactive',part:{type:'text',text:generated}};
  if(fresh.state.messages.some(m=>m.id===eventId))return false;
  if(npc==='molly'&&!reserveMollyBudget(db,owner,eventId,item,generated,at))return false;
  fresh.state.messages.push(message);if(kind)recordCount(fresh.state,npc,at,message,kind);save(db,fresh);store.markSupervisionDelivered(owner,npc,item.id,eventId);
  if(npc==='yuan-xiaoman'&&deps.forwardMolly!==false){const molly=load(db,owner,'molly');if(molly&&normal(molly.state,at,'molly')){const forwardId=eventId+':molly',body=`${item.title}，还没完成`;if(reserveMollyBudget(db,owner,forwardId,item,body,at)){
   molly.state.messages.push({id:forwardId,turnId:forwardId,role:'assistant',at:new Date(at).toISOString(),origin:'proactive',part:{type:'text',text:body}});save(db,molly);store.markSupervisionDelivered(owner,'molly',item.id,forwardId);
  }}}
  return true;
 });
}

export async function scanSupervision(db:DatabaseSync,store:DialoguePreferencesStore,deps:Dependencies={}){const rows=db.prepare('SELECT owner,npc_id FROM npc_dialogue_supervision').all() as {owner:string;npc_id:string}[];let sent=0;for(const row of rows)try{if(await deliverSupervision(db,store,row.owner,row.npc_id,deps))sent++;}catch{/* A failed owner stays retryable without blocking another owner. */}return sent;}
