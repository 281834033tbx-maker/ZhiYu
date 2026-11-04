import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage,Part} from '../../lib/npc/contracts';
import {createMolly} from '../../lib/npc/molly';
import {createChen} from '../../lib/npc/chen-nian';
import {createLiu} from '../../lib/npc/liu';
import {createChef} from '../../lib/npc/zhou-chef';
import {createHe} from '../../lib/npc/he-jiawei';
import {createYuan} from '../../lib/npc/yuan-xiaoman';
import {createState} from '../../lib/npc/engine';
import {createDailyBriefDemo,createWeeklyReportDemo} from '../../lib/npc/report-config/demo';
import {sortBriefSchedule,type DailyBrief,type ScheduleChange,type ReportDemoAction,type ReportDemoQuote} from '../../lib/npc/molly-reports';

type State={messages:ChatMessage[];revision?:number;pending?:unknown;queue?:string[]};
const bindings=[['sessions','xia-xia:normal','xia-xia'],['yuan_sessions','yuan-xiaoman','yuan-xiaoman'],['he_sessions','he-jiawei','he-jiawei'],['chen_sessions','chen-nian','chen-nian'],['liu_sessions','liu','liu'],['zhou_chef_sessions','zhou-chef','zhou-chef'],['molly_sessions','molly-system-secretary','molly']] as const;
const factories:Record<string,()=>State>={'xia-xia':()=>createState('normal'),'yuan-xiaoman':()=>createYuan(),'he-jiawei':createHe,'chen-nian':createChen,'liu':createLiu,'zhou-chef':createChef,'molly':createMolly};
const isId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160;
/** A separate demo occurrence ledger; never reads real goals, purchases or measurements. */
export class MollyReportDemos {
 constructor(private db:DatabaseSync,private now:()=>number){
  db.exec('CREATE TABLE IF NOT EXISTS npc_molly_report_demos(owner TEXT NOT NULL,kind TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(owner,kind));');
 }
 private load(owner:string,characterId='molly'){
  const binding=bindings.find(row=>row[2]===characterId);if(!binding)throw Error('智友不存在');
  const [table,suffix]=binding,key=`${owner}:${suffix}`;
  this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,${table==='sessions'?'revision INTEGER NOT NULL,':''}data TEXT NOT NULL)`);
  const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key) as {data:string}|undefined;
  return {table,key,state:row?JSON.parse(row.data) as State:factories[characterId]()};
 }
 private save(row:ReturnType<MollyReportDemos['load']>){
  row.state.revision=(row.state.revision||0)+1;
  if(row.table==='sessions')this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(row.key,row.state.revision,JSON.stringify(row.state));
  else this.db.prepare(`INSERT OR REPLACE INTO ${row.table} VALUES(?,?)`).run(row.key,JSON.stringify(row.state));
 }
 private available(state:State){if(state.pending||state.queue?.length)throw Error('Molly 正在回复，请稍后再试');}
 private message(part:Part,event:string,kind:'morning'|'weekly'):ChatMessage{return {id:randomUUID(),turnId:event,role:'assistant',at:new Date(this.now()).toISOString(),origin:'proactive',part,secretaryEvent:{id:event,kind}};}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 private append(owner:string,kind:'daily'|'weekly',regenerate=false){
  if(!regenerate&&this.db.prepare('SELECT 1 FROM npc_molly_report_demos WHERE owner=? AND kind=?').get(owner,kind))return undefined;
  const row=this.load(owner);this.available(row.state);
  const value=kind==='daily'?createDailyBriefDemo():createWeeklyReportDemo(),event=`report-demo:${kind}:${randomUUID()}`,eventKind=kind==='daily'?'morning':'weekly';
  const card=this.message(kind==='daily'?{type:'daily_brief',brief:value as DailyBrief,text:'演示简报'}:{type:'weekly_report',report:value as ReturnType<typeof createWeeklyReportDemo>,text:'演示周报'},event,eventKind);
  row.state.messages.push(this.message({type:'text',text:value.opener.text},event,eventKind),card);this.save(row);
  this.db.prepare('INSERT OR REPLACE INTO npc_molly_report_demos VALUES(?,?,?)').run(owner,kind,card.id);return card.id;
 }
 ensure(owner:string){return this.transaction(()=>({dailyMessageId:this.append(owner,'daily'),weeklyMessageId:this.append(owner,'weekly')}));}
 regenerate(owner:string,kind:unknown){if(kind!=='daily'&&kind!=='weekly')throw Error('演示类型无效');return this.transaction(()=>({messageId:this.append(owner,kind,true)}));}
 private card(state:State,id:unknown){if(!isId(id))throw Error('简报无效');const message=state.messages.find(item=>item.id===id&&item.secretaryEvent?.id.startsWith('report-demo:'));if(!message)throw Error('简报不存在');return message;}
 private apply(brief:DailyBrief,change:ScheduleChange){
  if(change.kind==='remove'){brief.schedule=brief.schedule.filter(item=>item.id!==change.scheduleId);return;}
  if(!change.item)throw Error('演示改动无效');const index=brief.schedule.findIndex(item=>item.id===(change.scheduleId||change.item!.id)),item=structuredClone(change.item);
  // The initial mock omits the two proposed rows: confirmation makes either
  // proposed change visible while leaving the nine original mock rows intact.
  if(index<0)brief.schedule.push(item);else brief.schedule[index]=item;
  brief.schedule=sortBriefSchedule(brief.schedule,brief.date);
 }
 action(owner:string,input:Record<string,unknown>){
  if(!Object.keys(input).every(key=>['action','messageId','itemId','decision','optionIndex','groupIndex','index','checked'].includes(key))||!isId(input.itemId)||!['confirm','dismiss','choose','select','bill-toggle','shopping-check'].includes(String(input.decision)))throw Error('演示操作无效');
  return this.transaction(()=>{
   const row=this.load(owner);this.available(row.state);let source=this.card(row.state,input.messageId),choice:ChatMessage|undefined;
   if(source.part.type==='choice'&&source.part.reportDemoChoice){
    choice=source;
    if(input.decision!=='select'||input.itemId!==source.part.reportDemoChoice.pendingId||!Number.isInteger(input.optionIndex)||Number(input.optionIndex)<0||Number(input.optionIndex)>=source.part.options.length)throw Error('选择无效');
    if(source.part.selection&&source.part.selection.index!==input.optionIndex)throw Error('已经选过了');
    source=this.card(row.state,source.part.reportDemoChoice.messageId);
   }
   if(source.part.type!=='daily_brief')throw Error('只可修改演示简报');const brief=source.part.brief,action=input as unknown as ReportDemoAction;let notice:string|undefined;
   if(action.decision==='bill-toggle'){
    const bill=brief.bills.find(item=>item.id===action.itemId);if(!bill)throw Error('费用不存在');
    if(action.checked!==undefined&&typeof action.checked!=='boolean')throw Error('状态无效');bill.paid=action.checked??!bill.paid;
   }else if(action.decision==='shopping-check'){
    const list=brief.shopping.find(item=>item.id===action.itemId);
    if(!list||!Number.isInteger(action.groupIndex)||!Number.isInteger(action.index)||typeof action.checked!=='boolean')throw Error('清单项目无效');
    const item=list.groups[action.groupIndex!]?.items[action.index!];if(!item)throw Error('清单项目不存在');item.checked=action.checked;list.done=list.groups.every(group=>group.items.every(entry=>entry.checked));
   }else{
    const pending=brief.pending.find(item=>item.id===action.itemId);
    if(!pending){if(choice)return {brief,choiceMessageId:choice.id};if(action.decision==='confirm'||action.decision==='dismiss')return {brief};throw Error('待定项目不存在');}
    if(action.decision==='choose'){
     if(pending.kind!=='choose'||!pending.choices||pending.choices.length<2||pending.choices.length>6)throw Error('这项无需选择');
     const existing=row.state.messages.find(item=>item.part.type==='choice'&&item.part.reportDemoChoice?.messageId===source.id&&item.part.reportDemoChoice.pendingId===pending.id);
     if(existing)return {brief,choiceMessageId:existing.id};
     const created=this.message({type:'choice',text:pending.text,options:pending.choices.map(item=>item.text),reportDemoChoice:{messageId:source.id,pendingId:pending.id}},`report-demo:choice:${source.id}:${pending.id}`,'morning');
     row.state.messages.push(created);this.save(row);return {brief,choiceMessageId:created.id};
    }
    if(action.decision==='select'){
     if(!choice||choice.part.type!=='choice'||choice.part.reportDemoChoice?.pendingId!==pending.id||pending.kind!=='choose'||!Number.isInteger(action.optionIndex)||action.optionIndex!<0||!pending.choices?.[action.optionIndex!])throw Error('选择无效');
     if(choice.part.selection&&choice.part.selection.index!==action.optionIndex)throw Error('已经选过了');
     this.apply(brief,pending.choices[action.optionIndex!].apply);choice.part.selection={index:action.optionIndex!,turnId:choice.turnId,at:new Date(this.now()).toISOString()};
    }else if(action.decision==='confirm'){if(pending.kind!=='change')throw Error('请先选择');this.apply(brief,pending.apply);notice=pending.id==='move-legs'?'腿部训练已挪到明天':`${pending.text} 已确认`;}
    else if(action.decision!=='dismiss')throw Error('操作无效');
    brief.pending=brief.pending.filter(item=>item.id!==pending.id);
   }
   this.save(row);return {brief,...(notice?{notice}:{}),...(choice?{choiceMessageId:choice.id}:{})};
  });
 }
 quote(owner:string,input:Record<string,unknown>){
  if(!Object.keys(input).every(key=>['action','messageId','kind','itemId'].includes(key))||!isId(input.itemId))throw Error('引用无效');
  return this.transaction(()=>{
   const sourceRow=this.load(owner),source=this.card(sourceRow.state,input.messageId);let characterId:string,text:string;
   if(input.kind==='schedule'&&source.part.type==='daily_brief'){
    const item=source.part.brief.schedule.find(row=>row.id===input.itemId);if(!item)throw Error('日程不存在');characterId=item.ownerId;text=[item.time,item.date&&item.date>source.part.brief.date?'明天':'',item.text,item.sub?.text].filter(Boolean).join(' · ');
   }else if(input.kind==='comment'&&source.part.type==='weekly_report'){
    const comment=source.part.report.comments.find(row=>row.npcId===input.itemId);if(!comment)throw Error('评语不存在');characterId=comment.npcId;text=comment.text;
   }else throw Error('引用类型无效');
   const row=characterId==='molly'?sourceRow:this.load(owner,characterId),event=`report-demo:quote:${source.id}:${String(input.kind)}:${String(input.itemId)}`;
   const prior=row.state.messages.find(message=>message.secretaryEvent?.id===event);if(prior)return {characterId,messageId:prior.id,text};
   this.available(row.state);const message=this.message({type:'text',text},event,source.part.type==='weekly_report'?'weekly':'morning');row.state.messages.push(message);this.save(row);return {characterId,messageId:message.id,text};
  });
 }
}
export type {ReportDemoQuote};
