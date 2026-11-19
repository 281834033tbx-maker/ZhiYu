import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {arrangementPaymentCatalog,arrangementProcedureTemplates,arrangementCountdownStart,isArrangementSectionId} from '../../lib/npc/arrangement-sections';
import type {ArrangementSectionId} from '../../lib/npc/arrangement-sections';
import {arrangementDateInShanghai,arrangementTimestamp,shiftArrangementDate} from '../../lib/npc/arrangement-time';
import type {ParsedArrangementTime} from '../../lib/npc/arrangement-time';
import type {ArrangementRecognition} from '../../lib/npc/arrangement-intent';
import type {ArrangementCreateResult,ArrangementDetails,ArrangementItem,ArrangementPreference,ArrangementReminder,ArrangementSource} from '../../lib/npc/arrangement-types';

const day=86400000;
type ItemRow={id:string;owner:string;data:string;created_at:number;updated_at:number;status:string;title_key:string;date_key:string;source_id:string};
type ReminderRow={id:string;owner:string;item_id:string;kind:ArrangementReminder['kind'];occurrence:string;due_at:number;explicit:number;status:ArrangementReminder['status'];brief_date:string|null;text:string};
const normalized=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function ownerKey(owner:string){if(typeof owner!=='string'||!owner.trim()||owner.length>128)throw Error('缺少账号');return owner;}
function requireSection(section:unknown):asserts section is ArrangementSectionId{if(!isArrangementSectionId(section))throw Error('安排板块无效');}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('安排内容无效');return value.trim();}
function validDate(s:unknown){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(arrangementTimestamp(s));}
function validateTime(t:ParsedArrangementTime){
 if(!t||t.valid!==true||[t.date,t.deadline].some(v=>v!==null&&!validDate(v))||(t.time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)))throw Error('安排时间无效');
 if(t.reminderOffsetMinutes!==undefined&&(!Number.isFinite(t.reminderOffsetMinutes)||t.reminderOffsetMinutes<0||t.reminderOffsetMinutes>365*24*60))throw Error('提醒提前量无效');
 if(t.recurrence){const r=t.recurrence;if(!['daily','weekly','monthly'].includes(r.frequency)||(r.frequency==='weekly'&&(!Number.isInteger(r.weekday)||r.weekday!<1||r.weekday!>7))||(r.frequency==='monthly'&&(!Number.isInteger(r.day)||r.day!<1||r.day!>31)))throw Error('重复安排无效');}
}
export function arrangementPreferenceCategory(section:ArrangementSectionId,value:string){
 if(section==='purchase')return /买菜|食材|蔬菜|水果|肉|鸡蛋|牛奶|杂粮|米面/.test(value)?'grocery':'other';
 if(section==='payment'){const bill=paymentFor(value);return bill?.name||'other';}
 if(section==='procedure')return procedureTemplate(value)||'other';
 if(section==='countdown')return countdownKind(value);
 return 'all';
}
function paymentFor(value:string){return arrangementPaymentCatalog.find(v=>v.name!=='其他'&&v.name.split(/[/（\s]/u).some(part=>part.length>1&&value.includes(part)))||arrangementPaymentCatalog.find(v=>v.name==='其他');}
function procedureTemplate(value:string){
 const exact=Object.keys(arrangementProcedureTemplates).find(k=>value.includes(k));if(exact)return exact;
 const key=/护照|出入境/.test(value)?'办护照':/(?:猫|狗|宠物).*?(?:疫苗|打针)|(?:疫苗|打针).*?(?:猫|狗|宠物)/.test(value)?'宠物疫苗':/年检|验车|车检/.test(value)?'车年检':/体检/.test(value)?'体检':/搬家/.test(value)?'搬家':/保洁/.test(value)?'找保洁':undefined;
 return key&&Object.hasOwn(arrangementProcedureTemplates,key)?key:undefined;
}
function countdownKind(value:string):NonNullable<ArrangementDetails['countdownKind']>{return /生日/.test(value)?'birthday':/纪念|周年/.test(value)?'anniversary':/车检|年检|车险/.test(value)?'vehicle':/护照|签证|证件|身份证/.test(value)?'document':/考试|出发|出行|旅行|演出|航班/.test(value)?'event':'other';}
function detailsFor(section:ArrangementSectionId,value:string):ArrangementDetails{
 if(section==='payment'){const p=paymentFor(value);return p?{payment:{name:p.name,remindBeforeDays:p.remindBeforeDays,destination:p.destination,button:p.button,link:p.link}}:{};}
 if(section==='procedure'){const key=procedureTemplate(value);const steps=key?arrangementProcedureTemplates[key]:undefined;return steps?{steps:steps.slice(0,5).map(title=>({title,done:false}))}:{};}
 if(section==='countdown')return {countdownKind:countdownKind(value)};
 if(section==='purchase'){const items=value.replace(/^(?:记得|帮我|我要|我想|我|买|采购|购买)+/u,'').split(/[、，,和与]/u).map(v=>v.trim()).filter(Boolean);return {items:items.slice(0,50)};}
 return {};
}
export class ArrangementSuppressedError extends Error{constructor(){super('这类安排已设置为不用记');this.name='ArrangementSuppressedError';}}

/** Adds its own tables only. Legacy professional tasks are projected by the UI,
 * never copied, reclassified in-place or deleted here. */
export class ArrangementStore{
 private transactionSequence=0;
 private connections=new WeakMap<DatabaseSync,ArrangementStore>();
 constructor(readonly db:DatabaseSync,private now:()=>number=Date.now,private uuid:()=>string=randomUUID){
  db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS npc_arrangements(id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,status TEXT NOT NULL,title_key TEXT NOT NULL,date_key TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(owner,id));
   CREATE INDEX IF NOT EXISTS npc_arrangement_dedup ON npc_arrangements(owner,title_key,date_key,created_at);
   CREATE UNIQUE INDEX IF NOT EXISTS npc_arrangement_source ON npc_arrangements(owner,source_id);
   CREATE TABLE IF NOT EXISTS npc_arrangement_preferences(owner TEXT NOT NULL,section TEXT NOT NULL,category TEXT NOT NULL,enabled INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,section,category));
   CREATE TABLE IF NOT EXISTS npc_arrangement_reminders(id TEXT NOT NULL,owner TEXT NOT NULL,item_id TEXT NOT NULL,kind TEXT NOT NULL,occurrence TEXT NOT NULL,due_at INTEGER NOT NULL,explicit INTEGER NOT NULL,status TEXT NOT NULL,brief_date TEXT,text TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,item_id,kind,occurrence));`);
 }
 private transaction<T>(fn:()=>T):T{const savepoint=`arrangement_${++this.transactionSequence}`;this.db.exec(`SAVEPOINT ${savepoint}`);try{const result=fn();this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);return result;}catch(e){try{this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}catch{/* The failed operation may have rolled itself back. */}throw e;}}
 /** A host can atomically persist its source message and Molly receipt together.
  * A top-level savepoint commits on release; nested ones join the host commit. */
 atomic<T>(fn:()=>T):T{return this.transaction(fn);}
 /** Conversation hosts own separate SQLite connections. Bind before entering
  * their transaction so arrangements and their receipt commit together. */
 using(db:DatabaseSync):ArrangementStore{if(db===this.db)return this;let store=this.connections.get(db);if(!store){store=new ArrangementStore(db,this.now,this.uuid);this.connections.set(db,store);}return store;}
 private decode(row:ItemRow|undefined):ArrangementItem|null{return row?JSON.parse(row.data) as ArrangementItem:null;}
 get(owner:string,id:string){return this.decode(this.db.prepare('SELECT * FROM npc_arrangements WHERE owner=? AND id=?').get(ownerKey(owner),id) as ItemRow|undefined);}
 list(owner:string,status:'active'|'all'='active'){return (this.db.prepare(`SELECT * FROM npc_arrangements WHERE owner=? AND ${status==='all'?"status IN ('active','completed')":"status='active'"} ORDER BY created_at,id`).all(ownerKey(owner)) as ItemRow[]).map(row=>this.decode(row)!);}
 owners(){return (this.db.prepare("SELECT DISTINCT owner FROM npc_arrangements WHERE status='active'").all() as {owner:string}[]).map(r=>r.owner);}
 preferences(owner:string):ArrangementPreference[]{return (this.db.prepare('SELECT section,category,enabled,updated_at FROM npc_arrangement_preferences WHERE owner=?').all(ownerKey(owner)) as {section:ArrangementSectionId;category:string;enabled:number;updated_at:number}[]).map(v=>({section:v.section,category:v.category,enabled:!!v.enabled,updatedAt:v.updated_at}));}
 shouldOffer(owner:string,recognition:ArrangementRecognition){
  if(!recognition.isArrangement||recognition.level==='ignore'||!recognition.section||recognition.section==='plan'||!recognition.time?.valid)return false;
  const category=arrangementPreferenceCategory(recognition.section,recognition.sourceText||recognition.title);
  return !this.preferences(owner).some(p=>p.section===recognition.section&&!p.enabled&&(p.category==='all'||p.category===category));
 }
 setPreference(owner:string,input:{section:ArrangementSectionId;category?:string;enabled:boolean}){
  requireSection(input.section);if(typeof input.enabled!=='boolean')throw Error('偏好无效');const category=input.category?.trim()||'all';if(category.length>80)throw Error('偏好过长');
  return this.transaction(()=>{const updatedAt=this.now();this.db.prepare('INSERT INTO npc_arrangement_preferences VALUES(?,?,?,?,?) ON CONFLICT(owner,section,category) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at').run(ownerKey(owner),input.section,category,input.enabled?1:0,updatedAt);return {section:input.section,category,enabled:input.enabled,updatedAt};});
 }
 create(owner:string,recognition:ArrangementRecognition,source:ArrangementSource):ArrangementCreateResult{
  ownerKey(owner);requireSection(recognition.section);validateTime(recognition.time);
  if(!recognition.isArrangement||recognition.level==='ignore')throw Error('本轮没有可保存的安排');
  if(recognition.section==='plan'&&!source.professionalPlan)throw Error('专业计划需要由专业智友安排');
  text(recognition.title,100);text(source.sourceId,200);text(source.sourceNpcId,80);
  if(recognition.section!=='plan'&&!this.shouldOffer(owner,recognition))throw new ArrangementSuppressedError();
  const title=Array.from(recognition.title.trim()).slice(0,10).join(''),titleKey=normalized(title),dateKey=recognition.time.date||recognition.time.deadline||'';
  return this.transaction(()=>{
   const at=this.now();
   const previous=this.db.prepare("SELECT * FROM npc_arrangements WHERE owner=? AND (source_id=? OR (status IN ('active','completed') AND title_key=? AND date_key=? AND created_at>=?)) ORDER BY created_at DESC LIMIT 1").get(owner,source.sourceId,titleKey,dateKey,at-7*day) as ItemRow|undefined;
   if(previous)return {status:'duplicate',item:this.decode(previous)!};
   const section=recognition.section as ArrangementSectionId,body=recognition.sourceText||recognition.title;
   const item:ArrangementItem={id:this.uuid(),section,title,time:structuredClone(recognition.time),sourceText:body,sourceId:source.sourceId,sourceNpcId:source.sourceNpcId,...(source.sourceChatId?{sourceChatId:source.sourceChatId}:{}),createdAt:at,updatedAt:at,status:'active',details:detailsFor(section,body),preferenceKey:arrangementPreferenceCategory(section,body)};
   this.db.prepare('INSERT INTO npc_arrangements VALUES(?,?,?,?,?,?,?,?,?)').run(item.id,owner,JSON.stringify(item),at,at,'active',titleKey,dateKey,source.sourceId);
   return {status:'created',item};
  });
 }
 private write(owner:string,item:ArrangementItem){this.db.prepare('UPDATE npc_arrangements SET data=?,updated_at=?,status=?,title_key=?,date_key=? WHERE owner=? AND id=?').run(JSON.stringify(item),item.updatedAt,item.status,normalized(item.title),item.time.date||item.time.deadline||'',owner,item.id);}
 revoke(owner:string,id:string){return this.changeStatus(owner,id,'revoked');}
 complete(owner:string,id:string){return this.changeStatus(owner,id,'completed');}
 private changeStatus(owner:string,id:string,status:'revoked'|'completed'){return this.transaction(()=>{const item=this.get(owner,id);if(!item)return null;if(item.status===status)return item;item.status=status;item.updatedAt=this.now();this.write(owner,item);this.db.prepare("DELETE FROM npc_arrangement_reminders WHERE owner=? AND item_id=? AND status!='delivered'").run(owner,id);return item;});}
 move(owner:string,id:string,section:ArrangementSectionId){requireSection(section);if(section==='plan')throw Error('专业计划由专业智友创建');return this.transaction(()=>{const item=this.get(owner,id);if(!item||item.status!=='active')return null;item.section=section;item.details=detailsFor(section,item.sourceText);item.preferenceKey=arrangementPreferenceCategory(section,item.sourceText);item.updatedAt=this.now();this.write(owner,item);this.db.prepare("DELETE FROM npc_arrangement_reminders WHERE owner=? AND item_id=? AND status!='delivered'").run(owner,id);return item;});}
 updateStep(owner:string,id:string,index:number,change:{done?:boolean;date?:string|null}){
  return this.transaction(()=>{const item=this.get(owner,id);if(!item||item.status!=='active'||!item.details.steps?.[index])return null;const step=item.details.steps[index];if(change.done!==undefined)step.done=!!change.done;if(change.date!==undefined){if(change.date!==null&&!validDate(change.date))throw Error('步骤日期无效');if(change.date)step.date=change.date;else delete step.date;}item.updatedAt=this.now();this.write(owner,item);this.db.prepare("DELETE FROM npc_arrangement_reminders WHERE owner=? AND item_id=? AND status!='delivered'").run(owner,id);return item;});
 }
 private occurrenceDates(item:ArrangementItem,at:number){
  const base=item.time.date||item.time.deadline;if(!base)return [];
  if(!item.time.recurrence)return [base];
  const today=arrangementDateInShanghai(at),r=item.time.recurrence,result:string[]=[];
  // Only current/future occurrences enter reminders. Retaining the recurrence
  // rule leaves future months intact instead of silently treating it as one-off.
  for(let i=0;i<=100;i++){const d=shiftArrangementDate(today,i);if(d<base)continue;const weekday=new Date(d+'T00:00:00Z').getUTCDay()||7;
   const [year,month]=d.split('-').map(Number),last=new Date(Date.UTC(year,month,0)).getUTCDate();
   if(r.frequency==='daily'||(r.frequency==='weekly'&&weekday===r.weekday)||(r.frequency==='monthly'&&Number(d.slice(-2))===Math.min(r.day!,last)))result.push(d);
  }return result;
 }
 private defaultReminder(item:ArrangementItem,date:string|null):{kind:ArrangementReminder['kind'];at:number;occurrence:string;explicit:boolean;text:string}|null{
  const t=item.time,title=item.title;
  if(t.explicitReminder&&date&&t.time)return {kind:'explicit',at:arrangementTimestamp(date,t.time)-(t.reminderOffsetMinutes||0)*60000,occurrence:date,explicit:true,text:`${title} 提醒时间到了`};
  if(item.section==='plan'||item.section==='purchase')return null;
  if(item.section==='schedule'&&date&&t.time)return {kind:'schedule',at:arrangementTimestamp(date,t.time)-3600000,occurrence:date,explicit:false,text:`${title} 今天${t.time}`};
  if(item.section==='todo'&&t.deadline&&date)return {kind:'deadline',at:arrangementTimestamp(shiftArrangementDate(date,-1),'20:00'),occurrence:date,explicit:false,text:`${title} ${date}截止`};
  if(item.section==='todo'&&!date)return {kind:'inactive',at:item.updatedAt+3*day,occurrence:'inactive',explicit:false,text:`${title} 办了没`};
  if(item.section==='procedure'){
   const step=item.details.steps?.find(v=>!v.done);
   if(step?.date)return t.time?{kind:'procedure',at:arrangementTimestamp(step.date,t.time)-3600000,occurrence:`step:${step.title}:${step.date}`,explicit:false,text:`${title} 今天${t.time}${step.title}`}:null;
   return {kind:'inactive',at:item.updatedAt+3*day,occurrence:'inactive',explicit:false,text:`${title} 办了没`};
  }
  if(item.section==='payment'&&date)return {kind:'payment',at:arrangementTimestamp(shiftArrangementDate(date,-(item.details.payment?.remindBeforeDays??3)),'09:00'),occurrence:date,explicit:false,text:`${title} ${date}到期`};
  if(item.section==='countdown'&&date){const start=arrangementCountdownStart(date,item.details.countdownKind||'other');
   return {kind:'countdown',at:arrangementTimestamp(start,'09:00'),occurrence:date,explicit:false,text:`${title} ${date}`};
  }return null;
 }
 /** Reservation is persisted before delivery. Hosts append messages with this
  * stable id and only then acknowledge; a retry returns the same pending row. */
 tick(owner:string):ArrangementReminder[]{
  ownerKey(owner);const at=this.now(),today=arrangementDateInShanghai(at);
  return this.transaction(()=>{
   let used=(this.db.prepare("SELECT COUNT(*) n FROM npc_arrangement_reminders WHERE owner=? AND explicit=0 AND status IN ('pending','delivered') AND due_at>=? AND due_at<?").get(owner,arrangementTimestamp(today),arrangementTimestamp(shiftArrangementDate(today,1))) as {n:number}).n;
   // If delivery was offline overnight, reserve old pending rows against today's
   // allowance too; retries may not leak yesterday's five on top of today's five.
   for(const pending of this.db.prepare("SELECT id FROM npc_arrangement_reminders WHERE owner=? AND explicit=0 AND status='pending' AND due_at<? ORDER BY due_at,id").all(owner,arrangementTimestamp(today)) as {id:string}[]){const deferred=used>=5;if(!deferred)used++;this.db.prepare('UPDATE npc_arrangement_reminders SET due_at=?,status=?,brief_date=? WHERE owner=? AND id=?').run(at,deferred?'deferred':'pending',deferred?shiftArrangementDate(today,1):null,owner,pending.id);}
   for(const item of this.list(owner)){
    const dates:Array<string|null>=this.occurrenceDates(item,at);if(!dates.length&&(item.section==='todo'||item.section==='procedure'))dates.push(null);
    for(const date of dates){
     const candidate=this.defaultReminder(item,date);if(!candidate||candidate.at>at||(date&&date<today))continue;
     if(this.db.prepare('SELECT 1 FROM npc_arrangement_reminders WHERE owner=? AND item_id=? AND kind=? AND occurrence=?').get(owner,item.id,candidate.kind,candidate.occurrence))continue;
     const deferred=!candidate.explicit&&used>=5;if(!candidate.explicit&&!deferred)used++;
     this.db.prepare('INSERT INTO npc_arrangement_reminders VALUES(?,?,?,?,?,?,?,?,?,?)').run(this.uuid(),owner,item.id,candidate.kind,candidate.occurrence,at,candidate.explicit?1:0,deferred?'deferred':'pending',deferred?shiftArrangementDate(today,1):null,candidate.text);
    }
   }
   return this.pendingReminders(owner);
  });
 }
 reminders(owner:string){return this.tick(owner);}
 private reminder(row:ReminderRow):ArrangementReminder|null{const item=this.get(row.owner,row.item_id);return item&&item.status==='active'?{id:row.id,item,kind:row.kind,occurrence:row.occurrence,dueAt:row.due_at,explicit:!!row.explicit,status:row.status,briefDate:row.brief_date,text:row.text}:null;}
 pendingReminders(owner:string){return (this.db.prepare("SELECT * FROM npc_arrangement_reminders WHERE owner=? AND status='pending' ORDER BY due_at,id").all(ownerKey(owner)) as ReminderRow[]).flatMap(r=>{const v=this.reminder(r);return v?[v]:[];});}
 markReminderDelivered(owner:string,id:string){return this.transaction(()=>this.db.prepare("UPDATE npc_arrangement_reminders SET status='delivered' WHERE owner=? AND id=? AND status='pending'").run(ownerKey(owner),id).changes>0);}
 briefItems(owner:string,date:string){
  if(!validDate(date))throw Error('简报日期无效');const rows=this.db.prepare("SELECT * FROM npc_arrangement_reminders WHERE owner=? AND status='deferred' AND brief_date=?").all(ownerKey(owner),date) as ReminderRow[];
  const deferred=rows.flatMap(r=>{const v=this.reminder(r);return v?[v]:[];}),ids=new Set(deferred.map(r=>r.item.id));
  const active=this.list(owner),projected=new Map<string,ArrangementItem>();
  for(const item of active){
   const occurrences=this.occurrenceDates(item,arrangementTimestamp(date));
   if(item.section==='countdown'){
    const occurrence=occurrences.find(d=>arrangementCountdownStart(d,item.details.countdownKind||'other')<=date&&date<=d);
    if(occurrence){ids.add(item.id);projected.set(item.id,occurrence===item.time.date?item:{...item,time:{...item.time,date:occurrence,...(item.time.deadline?{deadline:occurrence}:{})}});}
   }else if((occurrences.includes(date)&&(item.section==='schedule'||item.section==='todo'||item.section==='payment'))||(item.section==='procedure'&&item.details.steps?.find(s=>!s.done)?.date===date))ids.add(item.id);
  }
  return {items:active.filter(item=>ids.has(item.id)).map(item=>projected.get(item.id)||item),deferred};
 }
 markBriefDelivered(owner:string,date:string){return this.transaction(()=>this.db.prepare("UPDATE npc_arrangement_reminders SET status='delivered' WHERE owner=? AND status='deferred' AND brief_date=?").run(ownerKey(owner),date).changes);}
}
