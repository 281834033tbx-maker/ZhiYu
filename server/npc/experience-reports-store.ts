import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ChatMessage} from '../../lib/npc/contracts';
import {createMolly} from '../../lib/npc/molly';
import {getCharacter} from '../../lib/npc/character-directory';
import {statusFromState} from '../../lib/npc/character-status';
import {scheduleDelivery} from '../../lib/npc/delivery';
import type {ReportCity,ReportMeasurement,SecretaryReport,SecretarySettings} from '../../lib/npc/experience';
import {shanghaiToday} from '../../lib/npc/task-items';
import {readSecretaryTasks,readSecretaryCompletions,existingTables,taskReminderCards} from './secretary-tasks';
import {buildSecretaryReport,reportRange,type ReportConversation,type ReportInputs} from './secretary-reports';
import {createWeatherProvider,parseReportCity,type WeatherProvider} from './weather-provider';
import {privateHistoryMessages} from './private-history';
import type {DialogueCharacterId} from './dialogue-skill';
import {TaskMemoryStore} from './group-task-memory';
import {generate,codexAvailable} from './codex';

export type ReportStoreDependencies={weather?:WeatherProvider;writeTeam?:(characterId:string,prompt:string,requestId:string)=>Promise<unknown>;teamAvailable?:()=>boolean};
const conversations=[['sessions','xia-xia:normal','xia-xia'],['yuan_sessions','yuan-xiaoman','yuan-xiaoman'],['he_sessions','he-jiawei','he-jiawei'],['chen_sessions','chen-nian','chen-nian'],['liu_sessions','liu','liu'],['zhou_chef_sessions','zhou-chef','zhou-chef'],['molly_sessions','molly-system-secretary','molly']] as const;
type State={messages:ChatMessage[];revision?:number;interaction?:string;cooldownUntil?:number;pending?:unknown;queue?:string[];values?:Record<string,number|null>};
export class ExperienceReportsStore {
 private weather:WeatherProvider;
 private active=new Set<string>();
 private stopped=false;
 constructor(private db:DatabaseSync,private root:string,private clock:()=>number,private deps:ReportStoreDependencies={}){
  this.weather=deps.weather||createWeatherProvider();
  db.exec(`CREATE TABLE IF NOT EXISTS npc_experience_reports(owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));
   CREATE TABLE IF NOT EXISTS npc_experience_usage(owner TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS npc_experience_city_prompt(owner TEXT PRIMARY KEY,at INTEGER NOT NULL);`);
 }
 stop(){this.stopped=true;}
 private load(owner:string,id:string):{table:string;key:string;state:State}|undefined {
  const binding=conversations.find(row=>row[2]===id),tables=existingTables(this.db);if(!binding||!tables.has(binding[0]))return;
  const key=`${owner}:${binding[1]}`,row=this.db.prepare(`SELECT data FROM ${binding[0]} WHERE id=?`).get(key) as {data:string}|undefined;
  if(!row)return;const state=JSON.parse(row.data) as State;if(!Array.isArray(state.messages))return;return {table:binding[0],key,state};
 }
 private save(row:{table:string;key:string;state:State}){
  row.state.revision=(row.state.revision||0)+1;
  if(row.table==='sessions')this.db.prepare('UPDATE sessions SET data=?,revision=? WHERE id=?').run(JSON.stringify(row.state),row.state.revision,row.key);
  else this.db.prepare(`UPDATE ${row.table} SET data=? WHERE id=?`).run(JSON.stringify(row.state),row.key);
 }
 private appendMolly(owner:string,eventId:string,parts:ChatMessage['part'][],kind:NonNullable<ChatMessage['secretaryEvent']>['kind']) {
  const saved=this.load(owner,'molly'),state=saved?.state||createMolly(),key=`${owner}:molly-system-secretary`;
  if(state.messages.some(message=>message.secretaryEvent?.id===eventId))return false;
  const now=this.clock(),from=state.messages.length;
  for(const part of parts)state.messages.push({id:randomUUID(),turnId:eventId,role:'assistant',at:new Date(now).toISOString(),origin:'proactive',part,secretaryEvent:{id:eventId,kind}});
  scheduleDelivery(state.messages,from,now,now,{characterId:'molly'});state.revision=(state.revision||0)+1;
  this.db.prepare('INSERT OR REPLACE INTO molly_sessions VALUES(?,?)').run(key,JSON.stringify(state));return true;
 }
 requestCity(owner:string){
  if(this.db.prepare('SELECT 1 FROM npc_experience_city_prompt WHERE owner=?').get(owner))return false;
  this.db.exec('BEGIN IMMEDIATE');try{
   if(this.db.prepare('SELECT 1 FROM npc_experience_city_prompt WHERE owner=?').get(owner)){this.db.exec('ROLLBACK');return false;}
   this.appendMolly(owner,'city-request:v1',[{type:'city_request',text:'以后每天早上我给你发早报。你在哪个城市？'}],'city-request');
   this.db.prepare('INSERT INTO npc_experience_city_prompt VALUES(?,?)').run(owner,this.clock());this.db.exec('COMMIT');return true;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 async locate(query:unknown,source:unknown):Promise<ReportCity|undefined> {
  if(source==='ip')return this.weather.ipCity();
  if(typeof query!=='string'||!query.trim()||query.length>100||!['manual','geolocation'].includes(String(source)))return;
  const city=await this.weather.lookup(query.trim(),source as ReportCity['source']);
  return city|| (source==='manual'?parseReportCity({name:query,source:'manual'}):undefined);
 }
 private inputs(owner:string):ReportInputs {
  const now=this.clock(),snapshot=readSecretaryTasks(this.db,owner,now),convs:ReportConversation[]=[];
  for(const [, ,id] of conversations){const row=this.load(owner,id);if(row)convs.push({characterId:id,state:{...row.state,messages:privateHistoryMessages(row.state)}});}
  const measurements:ReportMeasurement[]=[];
  new TaskMemoryStore(this.db).collect(owner);
  // Consume already source-validated, dated measurement events; never reinterpret
  // a model summary, an undated imported number or a screenshot as a weigh-in.
  if(existingTables(this.db).has('npc_group_task_memory_events')){
   const rows=this.db.prepare('SELECT source_character,message_id,at,operations FROM npc_group_task_memory_events WHERE owner=? AND at IS NOT NULL ORDER BY at_ms,seq').all(owner) as {source_character:string;message_id:string;at:string;operations:string}[];
   for(const row of rows)try{for(const operation of JSON.parse(row.operations) as {action:string;key?:string;fact?:{key:string;value:unknown}}[]){
    const fields:Record<string,keyof ReportMeasurement>={weight:'weightKg',waist:'waistCm',sleep:'sleep',energy:'energy',soreness:'soreness'};
    if(operation.action==='remove'&&operation.key&&fields[operation.key]){for(const entry of measurements)delete entry[fields[operation.key]];continue;}
    const fact=operation.fact;
    if(operation.action==='set'&&fact&&fields[fact.key]&&Number.isFinite(Date.parse(row.at))){
      const numeric=['weight','waist'].includes(fact.key);if(numeric?typeof fact.value!=='number':typeof fact.value!=='string')continue;
      measurements.push({date:shanghaiToday(Date.parse(row.at)),sourceMessageId:row.message_id,sourceCharacterId:row.source_character,[fields[fact.key]]:fact.value});
    }
   }}catch{/* Partial malformed metric rows are not repaired with invented values. */}
  }
  return {snapshot,completions:readSecretaryCompletions(this.db,owner),measurements,conversations:convs,now};
 }
 private async team(report:SecretaryReport){
  if(!(this.deps.teamAvailable||codexAvailable)())return;
  for(const row of report.team){
   if(this.stopped)return;
   const person=getCharacter(row.characterId);if(!person)continue;
   const data=row.characterId==='chen-nian'?report.training:row.characterId==='liu'?report.nutrition:report.cooking;
   const prompt=`你是${person.name}，稳定人物ID：${person.id}。\n这是已计算的${report.kind==='weekly'?'周报':'月报'}，写团队中属于你的一句话。你只是给Molly提供原句，不给用户私聊新增任务，不调用工具。\n时间范围${report.startDate}至${report.endDate}。${person.role==='professional'?`你布置的任务记录：${JSON.stringify(data)}。写情况和下一阶段一个保守具体调整；没有测量就不推断健康变化。`:'本期你与用户有过真实聊天。只写朋友式的一句话，不打分，不安排任务，不声称任何未给出的聊天细节。'}\n已由你当前状态决定的参考长度：${row.text.length}字以内。只返回JSON {"action":"reply","messages":[{"type":"text","text":"一句话"}],"event":null,"memories":[]}。`;
   try{const result=await (this.deps.writeTeam||((id,text,requestId)=>generate(this.root,text,{characterId:id as DialogueCharacterId,requestId})))(row.characterId,prompt,row.quoteId) as {messages?:{type?:string;text?:string}[]};
    const text=result?.messages?.length===1&&result.messages[0].type==='text'?result.messages[0].text:undefined;
    if(typeof text==='string'&&text.trim()&&Array.from(text).length<=180&&!/npc-skills|user_required|Codex|DeepSeek|\bNPC\b|prompt|Skill|\.json|\.md|生成中|模型/u.test(text))row.text=text.trim();
   }catch{/* A failed comment cannot erase a report or alter its calculated totals. */}
  }
 }
 async publish(owner:string,kind:SecretaryReport['kind'],settings:SecretarySettings,effectiveSince:number):Promise<boolean>{
  const now=this.clock(),date=shanghaiToday(now),local=new Date(now+8*3600000);
  if(kind==='morning'&&!settings.enabled)return false;
  if(kind==='weekly'&&local.getUTCDay()!==0||kind==='monthly'&&local.getUTCDate()!==1)return false;
  const time=kind==='morning'?settings.time:kind==='weekly'?'20:00':'09:00',due=Date.parse(`${date}T${time}:00+08:00`);
  if(now<due||due<effectiveSince)return false;
  const range=reportRange(kind,now),reportId=`${kind}:${range.startDate}:${range.endDate}`,key=`${owner}:${reportId}`;
  // A clock tick checks its durable occurrence before scanning any histories.
  // Published reports and a pending city question must not reread all chats each second.
  if(this.active.has(key)||this.db.prepare('SELECT 1 FROM npc_experience_reports WHERE owner=? AND id=?').get(owner,reportId))return false;
  if(kind==='morning'&&this.db.prepare('SELECT 1 FROM npc_secretary_occurrences WHERE owner=? AND date=?').get(owner,date))return false;
  if(kind==='morning'&&!settings.city){this.requestCity(owner);return false;}
  const input=this.inputs(owner);if(input.snapshot.readErrors)return false;
  const report=buildSecretaryReport(kind,input);
  this.active.add(key);
  try{
   if(kind==='morning'&&settings.city){report.city=settings.city;report.weather=await this.weather.forecast(settings.city,date);
    for(const conversation of input.conversations||[])if(getCharacter(conversation.characterId)?.role==='professional')for(const message of conversation.state.messages){if(message.role==='assistant'&&message.part.type==='choice'&&!message.part.selection&&(message.deliverAt||0)<=now)report.decisions.push({id:message.id,characterId:conversation.characterId,messageId:message.id,text:message.part.text,options:[...message.part.options]});}
   }else await this.team(report);
   if(this.stopped)return false;
   this.db.exec('BEGIN IMMEDIATE');try{
    if(this.db.prepare('SELECT 1 FROM npc_experience_reports WHERE owner=? AND id=?').get(owner,report.id)){this.db.exec('ROLLBACK');return false;}
    const intro=kind==='morning'?'早。今天的安排':kind==='weekly'?'本周周报整理好了':`${Number(report.startDate.slice(5,7))} 月的月报`;
    this.appendMolly(owner,`report:${report.id}`,[{type:'text',text:intro},{type:'secretary_report',report,text:report.title}],kind==='morning'?'morning':kind);
    if(kind==='morning'){taskReminderCards(this.db,owner,input.snapshot,date,now);this.db.prepare('INSERT OR IGNORE INTO npc_secretary_occurrences VALUES(?,?,?)').run(owner,date,new Date(now).toISOString());}
    this.db.prepare('INSERT INTO npc_experience_reports VALUES(?,?,?)').run(owner,report.id,JSON.stringify(report));
    this.db.exec('COMMIT');return true;
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }finally{this.active.delete(key);}
 }
 reportQuote(owner:string,reportId:unknown,characterId:unknown){
  if(typeof reportId!=='string'||reportId.length>160||typeof characterId!=='string'||!getCharacter(characterId))throw Error('报告引用无效');
  const stored=this.db.prepare('SELECT data FROM npc_experience_reports WHERE owner=? AND id=?').get(owner,reportId) as {data:string}|undefined;
  const report=stored?JSON.parse(stored.data) as SecretaryReport:undefined,quote=report?.team.find(row=>row.characterId===characterId);
  const target=this.load(owner,characterId);if(!quote||!target)throw Error('这条话暂时无法引用');
  const existing=target.state.messages.find(message=>message.secretaryEvent?.id===quote.quoteId);
  if(existing)return {messageId:existing.id,text:quote.text};
  if(target.state.pending||target.state.queue?.length)throw Error('对话正在回复，请稍后再试');
  const id=randomUUID();target.state.messages.push({id,turnId:quote.quoteId,role:'assistant',at:new Date(this.clock()).toISOString(),origin:'proactive',part:{type:'text',text:quote.text},secretaryEvent:{id:quote.quoteId,kind:report!.kind==='monthly'?'monthly':'weekly'}});
  this.save(target);return {messageId:id,text:quote.text};
 }
 usage(owner:string,value:{currentNpc:string;visible:boolean;busy?:boolean;clientId:string}){
  if(!conversations.some(row=>row[2]===value.currentNpc)||typeof value.visible!=='boolean'||typeof value.clientId!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(value.clientId)||value.busy!==undefined&&typeof value.busy!=='boolean')throw Error('使用状态无效');
  const now=this.clock(),row=this.db.prepare('SELECT data FROM npc_experience_usage WHERE owner=?').get(owner) as {data:string}|undefined;
  type Usage={lastAt:number;activeMs:number;notified:number;visible:boolean;clients?:Record<string,{at:number;visible:boolean}>};
  const prior:Usage=row?JSON.parse(row.data):{lastAt:now,activeMs:0,notified:0,visible:false};
  // Multiple windows share one owner clock: overlapping heartbeats add wall time once.
  const gap=Math.max(0,now-prior.lastAt),continuous=gap<=120000;
  const clients=prior.clients||{};clients[value.clientId]={at:now,visible:value.visible};
  prior.clients=Object.fromEntries(Object.entries(clients).filter(([,client])=>now-client.at<=120000));
  const visible=Object.values(prior.clients).some(client=>client.visible);
  if(!continuous){prior.activeMs=0;prior.notified=0;}
  else if(prior.visible&&visible)prior.activeMs+=gap;
  if(!visible){prior.activeMs=0;prior.notified=0;}
  prior.lastAt=now;prior.visible=visible;
  let sent=false;const boundary=Math.floor(prior.activeMs/(2*3600000));
  if(value.visible&&!value.busy&&boundary>prior.notified){const target=this.load(owner,value.currentNpc);if(target&&!target.state.pending&&!target.state.queue?.length&&!target.state.messages.some(message=>(message.deliverAt||0)>now)&&statusFromState(value.currentNpc,target.state,now).kind!=='silent'){
   const lines:Record<string,string>={'xia-xia':'聊了两个多小时了诶，起来走走？','yuan-xiaoman':'都聊两个多小时了，眼睛歇一会儿吧','he-jiawei':'两个小时了，起来活动一下，回来再聊','chen-nian':'两个多小时了，起来活动活动肩颈','liu':'聊了两个小时了，起来走走，喝口水','zhou-chef':'两个多小时了，起来伸个懒腰再聊','molly':'连续两小时了，休息一下'};
   const eventId=`usage:${Math.floor(now-prior.activeMs)}:${boundary}`;
   target.state.messages.push({id:randomUUID(),turnId:eventId,role:'assistant',at:new Date(now).toISOString(),origin:'proactive',part:{type:'text',text:lines[value.currentNpc]},secretaryEvent:{id:eventId,kind:'usage'}});this.save(target);prior.notified=boundary;sent=true;
  }}
  this.db.prepare('INSERT OR REPLACE INTO npc_experience_usage VALUES(?,?)').run(owner,JSON.stringify(prior));return {sent,activeMs:prior.activeMs};
 }
}
