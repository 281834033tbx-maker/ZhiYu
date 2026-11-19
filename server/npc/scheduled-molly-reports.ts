import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage,Part} from '../../lib/npc/contracts';
import type {SecretarySettings} from '../../lib/npc/experience';
import {createMolly} from '../../lib/npc/molly';
import {createChen} from '../../lib/npc/chen-nian';
import {createLiu} from '../../lib/npc/liu';
import {createChef} from '../../lib/npc/zhou-chef';
import {createHe} from '../../lib/npc/he-jiawei';
import {createYuan} from '../../lib/npc/yuan-xiaoman';
import {createState} from '../../lib/npc/engine';
import {scheduleDelivery} from '../../lib/npc/delivery';
import {shanghaiToday,shiftTaskDate} from '../../lib/npc/task-items';
import {reportDate} from '../../lib/npc/molly-reports';
import type {ReportInputs} from './secretary-reports';
import type {WeatherProvider} from './weather-provider';
import {buildScheduledDailyBrief,buildScheduledWeeklyReport} from './scheduled-report-templates';
import {ArrangementStore} from './arrangements-store';
import {addArrangementsToBrief} from './arrangement-brief';

export type ScheduledReportSettings=SecretarySettings&{dailyEffectiveSince:number;weeklyEffectiveSince:number};
export type ScheduledReportKind='daily'|'weekly';
type Occurrence={kind:ScheduledReportKind;period:string;date:string;startDate:string;endDate:string;due:number};
type State={messages:ChatMessage[];revision?:number;pending?:unknown;queue?:string[]};
type Dependencies={now:()=>number;settings:(owner:string)=>ScheduledReportSettings;inputs:(owner:string)=>ReportInputs;weather:WeatherProvider};
const bindings=[['sessions','xia-xia:normal','xia-xia'],['yuan_sessions','yuan-xiaoman','yuan-xiaoman'],['he_sessions','he-jiawei','he-jiawei'],['chen_sessions','chen-nian','chen-nian'],['liu_sessions','liu','liu'],['zhou_chef_sessions','zhou-chef','zhou-chef'],['molly_sessions','molly-system-secretary','molly']] as const;
const factories:Record<string,()=>State>={'xia-xia':()=>createState('normal'),'yuan-xiaoman':()=>createYuan(),'he-jiawei':createHe,'chen-nian':createChen,'liu':createLiu,'zhou-chef':createChef,'molly':createMolly};
const OWNER=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const validTime=(value:unknown):value is string=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
const weekday=(date:string)=>new Date(`${date}T00:00:00Z`).getUTCDay();
const eventId=(item:Occurrence)=>`scheduled-report:v1:${item.kind}:${item.period}`;
const sameOccurrence=(a:Occurrence|undefined,b:Occurrence)=>!!a&&a.kind===b.kind&&a.period===b.period&&a.due===b.due&&a.endDate===b.endDate;

/** Only the current daily or most recently due weekly occurrence is considered. */
export function scheduledReportOccurrence(kind:ScheduledReportKind,settings:ScheduledReportSettings,now:number):Occurrence|undefined {
 if(!Number.isFinite(now))return;
 const today=shanghaiToday(now),time=kind==='daily'?settings.time:settings.weeklyTime??'21:30';
 if(!(kind==='daily'?settings.enabled:settings.weeklyEnabled??true)||!validTime(time))return;
 let date=today;
 if(kind==='weekly'){
  const day=settings.weeklyDay??0;if(!Number.isInteger(day)||day<0||day>6)return;
  date=shiftTaskDate(today,-((weekday(today)-day+7)%7));
  if(Date.parse(`${date}T${time}:00+08:00`)>now)date=shiftTaskDate(date,-7);
 }
 const due=Date.parse(`${date}T${time}:00+08:00`),since=kind==='daily'?settings.dailyEffectiveSince:settings.weeklyEffectiveSince;
 if(now<due||!Number.isFinite(since)||due<since)return;
 // A weekday/time edit cannot emit a second weekly card in the same natural week.
 const period=kind==='daily'?date:shiftTaskDate(date,-((weekday(date)+6)%7));
 return {kind,period,date,startDate:kind==='daily'?date:shiftTaskDate(date,-6),endDate:date,due};
}

/** Owner-scoped durable production cards; demos retain their independent ledger. */
export class ScheduledMollyReports {
 private active=new Set<string>();
 private retryAt=new Map<string,number>();
 private stopped=false;
 constructor(private db:DatabaseSync,private deps:Dependencies){
  db.exec('CREATE TABLE IF NOT EXISTS npc_molly_scheduled_reports(owner TEXT NOT NULL,kind TEXT NOT NULL,period TEXT NOT NULL,due_at INTEGER NOT NULL,message_id TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY(owner,kind,period));');
 }
 stop(){this.stopped=true;}
 private checkOwner(owner:string){if(!OWNER.test(owner))throw Error('请先登录智域');}
 private load(owner:string,characterId='molly'){
  const binding=bindings.find(row=>row[2]===characterId);if(!binding)throw Error('智友不存在');
  const [table,suffix]=binding,key=`${owner}:${suffix}`;
  this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,${table==='sessions'?'revision INTEGER NOT NULL,':''}data TEXT NOT NULL)`);
  const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;
  const state=row?JSON.parse(row.data) as State:factories[characterId]();
  if(!Array.isArray(state.messages))throw Error('聊天记录暂时无法读取');
  return {table,key,state};
 }
 private save(row:ReturnType<ScheduledMollyReports['load']>){
  row.state.revision=(row.state.revision||0)+1;
  if(row.table==='sessions')this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(row.key,row.state.revision,JSON.stringify(row.state));
  else this.db.prepare(`INSERT OR REPLACE INTO ${row.table} VALUES(?,?)`).run(row.key,JSON.stringify(row.state));
 }
 private available(state:State){return !state.pending&&!state.queue?.length&&!state.messages.some(message=>(message.deliverAt||0)>this.deps.now());}
 private sent(owner:string,item:Occurrence){return !!this.db.prepare('SELECT 1 FROM npc_molly_scheduled_reports WHERE owner=? AND kind=? AND period=?').get(owner,item.kind,item.period);}
 async scan(owner:string,kind:ScheduledReportKind):Promise<boolean>{
  this.checkOwner(owner);if(this.stopped)return false;
  const occurrence=scheduledReportOccurrence(kind,this.deps.settings(owner),this.deps.now());if(!occurrence||this.sent(owner,occurrence))return false;
  const key=`${owner}:${kind}:${occurrence.period}`;
  if(this.active.has(key)||(this.retryAt.get(key)||0)>this.deps.now())return false;
  this.active.add(key);
  try{
   if(!this.available(this.load(owner).state))return false;
   const settings=this.deps.settings(owner);
   let weather;
   if(kind==='daily'&&settings.city)try{weather=await this.deps.weather.forecast(settings.city,occurrence.date);}catch{/* Missing live weather never invents a forecast or blocks the report. */}
   if(this.stopped)return false;
   const currentSettings=this.deps.settings(owner);
   if(!sameOccurrence(scheduledReportOccurrence(kind,currentSettings,this.deps.now()),occurrence))return false;
   if(JSON.stringify(currentSettings.city)!==JSON.stringify(settings.city))weather=undefined;
   // Re-read facts after asynchronous providers and re-read Molly again inside the
   // commit. Neither another window nor an in-flight reply may be overwritten.
   const input=this.deps.inputs(owner);if(input.snapshot.readErrors)throw Error('任务记录暂时无法读取');
   const arrangements=new ArrangementStore(this.db,this.deps.now);
   const value=kind==='daily'?addArrangementsToBrief(buildScheduledDailyBrief(input,{date:occurrence.date,city:currentSettings.city,weather}),arrangements,owner):buildScheduledWeeklyReport(input,occurrence);
   if(this.stopped)return false;
   this.db.exec('BEGIN IMMEDIATE');
   try{
    const current=scheduledReportOccurrence(kind,this.deps.settings(owner),this.deps.now()),row=this.load(owner);
    if(!sameOccurrence(current,occurrence)||this.sent(owner,occurrence)||!this.available(row.state)){this.db.exec('ROLLBACK');return false;}
    const event=eventId(occurrence),from=row.state.messages.length,now=this.deps.now(),part:Part=kind==='daily'?{type:'daily_brief',brief:value as ReturnType<typeof buildScheduledDailyBrief>,text:'今日简报'}:{type:'weekly_report',report:value as ReturnType<typeof buildScheduledWeeklyReport>,text:'本周汇报'};
    const cardId=randomUUID(),message=(id:string,part:Part):ChatMessage=>({id,turnId:event,role:'assistant',at:new Date(now).toISOString(),origin:'proactive',part,secretaryEvent:{id:event,kind:kind==='daily'?'morning':'weekly'}});
    row.state.messages.push(message(randomUUID(),{type:'text',text:value.opener.text}),message(cardId,part));
    scheduleDelivery(row.state.messages,from,now,now,{characterId:'molly'});
    this.save(row);
    this.db.prepare('INSERT INTO npc_molly_scheduled_reports VALUES(?,?,?,?,?,?)').run(owner,kind,occurrence.period,occurrence.due,cardId,now);
    if(kind==='daily')arrangements.markBriefDelivered(owner,occurrence.date);
    this.db.exec('COMMIT');this.retryAt.delete(key);return true;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }catch(error){this.retryAt.set(key,this.deps.now()+30000);throw error;}
  finally{this.active.delete(key);}
 }
 ownsCard(owner:string,messageId:unknown){
  this.checkOwner(owner);return typeof messageId==='string'&&!!this.db.prepare('SELECT 1 FROM npc_molly_scheduled_reports WHERE owner=? AND message_id=?').get(owner,messageId);
 }
 action(owner:string,input:Record<string,unknown>){
  this.checkOwner(owner);
  if(this.stopped||!Object.keys(input).every(key=>['action','messageId','itemId','decision','groupIndex','index','checked'].includes(key))||typeof input.itemId!=='string'||!this.ownsCard(owner,input.messageId)||!['bill-toggle','shopping-check'].includes(String(input.decision)))throw Error('简报操作无效');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const row=this.load(owner),source=row.state.messages.find(message=>message.id===input.messageId&&message.secretaryEvent?.id.startsWith('scheduled-report:v1:'));
   if(source?.part.type!=='daily_brief')throw Error('这条简报不可修改');
   const brief=source.part.brief;
   if(input.decision==='bill-toggle'){
    const bill=brief.bills.find(item=>item.id===input.itemId);if(!bill||input.checked!==undefined&&typeof input.checked!=='boolean')throw Error('费用状态无效');
    bill.paid=input.checked===undefined?!bill.paid:input.checked;
   }else{
    const list=brief.shopping.find(item=>item.id===input.itemId);
    if(!list||!Number.isInteger(input.groupIndex)||!Number.isInteger(input.index)||typeof input.checked!=='boolean')throw Error('清单项目无效');
    const item=list.groups[Number(input.groupIndex)]?.items[Number(input.index)];if(!item)throw Error('清单项目不存在');
    item.checked=input.checked;list.done=list.groups.every(group=>group.items.every(entry=>entry.checked));
   }
   this.save(row);this.db.exec('COMMIT');return {brief};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 quote(owner:string,input:Record<string,unknown>){
  this.checkOwner(owner);
  if(this.stopped||!Object.keys(input).every(key=>['action','messageId','kind','itemId'].includes(key))||typeof input.messageId!=='string'||typeof input.itemId!=='string'||input.itemId.length>400||!this.ownsCard(owner,input.messageId))throw Error('引用无效');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const sourceRow=this.load(owner),source=sourceRow.state.messages.find(message=>message.id===input.messageId&&message.secretaryEvent?.id.startsWith('scheduled-report:v1:'));
   let characterId:string,text:string;
   if(source?.part.type==='daily_brief'&&input.kind==='schedule'){
    const item=source.part.brief.schedule.find(row=>row.id===input.itemId);if(!item)throw Error('日程不存在');
    characterId=item.ownerId;text=[reportDate(item.date||source.part.brief.date,source.part.brief.date),item.time,item.text,item.sub?.text].filter(Boolean).join(' · ');
   }else if(source?.part.type==='weekly_report'&&input.kind==='comment'){
    const item=source.part.report.comments.find(row=>row.npcId===input.itemId);if(!item)throw Error('评语不存在');
    characterId=item.npcId;text=item.text;
   }else throw Error('引用类型无效');
   const target=characterId==='molly'?sourceRow:this.load(owner,characterId),event=`scheduled-report:v1:quote:${source.id}:${input.kind}:${input.itemId}`;
   const previous=target.state.messages.find(message=>message.secretaryEvent?.id===event);
   if(previous){this.db.exec('COMMIT');return {characterId,messageId:previous.id,text};}
   if(!this.available(target.state))throw Error('对话正在回复，请稍后再试');
   const id=randomUUID();target.state.messages.push({id,turnId:event,role:'assistant',at:new Date(this.deps.now()).toISOString(),origin:'proactive',part:{type:'text',text},secretaryEvent:{id:event,kind:source.part.type==='weekly_report'?'weekly':'morning'}});this.save(target);
   this.db.exec('COMMIT');return {characterId,messageId:id,text};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
