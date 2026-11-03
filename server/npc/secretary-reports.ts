import type {SecretaryTaskSnapshot} from './secretary-tasks';
import type {ChatMessage} from '../../lib/npc/contracts';
import type {SecretaryReport,ReportAgendaItem,ReportMeasurement,ReportTeamMessage} from '../../lib/npc/experience';
import {getCharacter} from '../../lib/npc/character-directory';
import {statusFromState} from '../../lib/npc/character-status';
import {professionalTaskStepDate} from '../../lib/npc/professional-task-expiry';
import {taskItemsForDate,shiftTaskDate,shanghaiToday,validTaskDate} from '../../lib/npc/task-items';

export type ReportConversation={characterId:string;state:{messages:ChatMessage[];interaction?:string;cooldownUntil?:number;values?:Record<string,number|null>}};
export type ReportInputs={snapshot:SecretaryTaskSnapshot;completions:Record<string,true>;measurements?:ReportMeasurement[];conversations?:ReportConversation[];now:number};
type Occurrence=ReportAgendaItem&{kind:'training'|'nutrition'|'cooking'};
export function reportRange(kind:SecretaryReport['kind'],now:number):{startDate:string;endDate:string} {
 const day=shanghaiToday(now),date=new Date(day+'T00:00:00Z');
 if(kind==='morning')return {startDate:day,endDate:day};
 if(kind==='weekly'){const weekday=date.getUTCDay()||7;return {startDate:shiftTaskDate(day,1-weekday),endDate:day};}
 date.setUTCDate(0);const endDate=date.toISOString().slice(0,10);date.setUTCDate(1);return {startDate:date.toISOString().slice(0,10),endDate};
}
function dates(start:string,end:string){const count=Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1;return Array.from({length:Math.max(0,Math.min(370,count))},(_,i)=>shiftTaskDate(start,i));}
export function reportOccurrences(input:ReportInputs,startDate:string,endDate:string):Occurrence[] {
 const rows:Occurrence[]=[];
 for(const task of input.snapshot.professionalTasks){
  if(task.status==='cancelled')continue;
  const grouped=new Map<string,typeof task.steps>();
  for(const step of task.steps){const date=professionalTaskStepDate(task,step);if(!date||date<startDate||date>endDate)continue;grouped.set(date,[...(grouped.get(date)||[]),step]);}
  for(const [date,steps] of grouped){const person=getCharacter(task.characterId);rows.push({id:`professional:${task.characterId}:${task.id}:${date}`,date,title:task.title,source:person?.name||'',characterId:task.characterId,completed:steps.length>0&&steps.every(s=>!!s.completedAt),kind:task.characterId==='chen-nian'?'training':task.characterId==='liu'?'nutrition':'cooking'});}
 }
 for(const date of dates(startDate,endDate))for(const item of taskItemsForDate(input.snapshot.groups,date)){
  // Unconfirmed drafts and paused proposals are not assigned work.
  const group=input.snapshot.groups.find(g=>g.id===item.groupId);
  if(!item.canComplete||group?.leftAt)continue;
  const kind=item.category==='fitness'?'training':item.category==='diet'?'nutrition':item.category==='cooking'?'cooking':undefined;
  if(!kind)continue;
  rows.push({id:`group:${item.id}`,date,title:item.title,time:item.time,source:item.groupName,groupId:item.groupId,completed:!!input.completions[item.id],kind});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'99:99').localeCompare(b.time||'99:99'));
}
function metric(rows:Occurrence[]){return {planned:rows.length,completed:rows.filter(row=>row.completed).length,missedDates:[...new Set(rows.filter(row=>!row.completed).map(row=>row.date))]};}
function dayMetric(rows:Occurrence[]){const days=[...new Set(rows.map(row=>row.date))];return {planned:days.length,completed:days.filter(day=>rows.filter(row=>row.date===day).every(row=>row.completed)).length,missedDates:days.filter(day=>rows.some(row=>row.date===day&&!row.completed))};}
const average=(values:number[])=>values.length?Number((values.reduce((n,v)=>n+v,0)/values.length).toFixed(2)):null;
function meanWeight(records:ReportMeasurement[],start:string,end:string){
 const days=new Map<string,number[]>();for(const row of records)if(row.date>=start&&row.date<=end&&Number.isFinite(row.weightKg))days.set(row.date,[...(days.get(row.date)||[]),row.weightKg!]);
 return average([...days.values()].map(values=>average(values)!));
}
export function reportParticipants(input:ReportInputs,startDate:string,endDate:string):{characterId:string;cold:boolean}[] {
 const start=Date.parse(startDate+'T00:00:00+08:00'),end=Date.parse(shiftTaskDate(endDate,1)+'T00:00:00+08:00');
 const ids=new Set(input.snapshot.professionalTasks.filter(task=>Date.parse(task.createdAt)>=start&&Date.parse(task.createdAt)<end).map(task=>task.characterId as string));
 for(const group of input.snapshot.groups){if(group.leftAt||group.plan?.status!=='confirmed')continue;const at=Date.parse(group.plan.confirmedAt||'');if(at>=start&&at<end)for(const member of group.members)if(getCharacter(member.id)?.role==='professional')ids.add(member.id);}
 for(const conversation of input.conversations||[])if(getCharacter(conversation.characterId)?.role==='companion'&&conversation.state.messages.some(message=>message.role==='user'&&!message.chronologyUnknown&&Date.parse(message.at)>=start&&Date.parse(message.at)<end))ids.add(conversation.characterId);
 return [...ids].map(characterId=>({characterId,state:input.conversations?.find(c=>c.characterId===characterId)?.state}))
  .filter(row=>statusFromState(row.characterId,row.state||{},input.now).kind!=='silent')
  .sort((a,b)=>Number(getCharacter(a.characterId)?.role!=='professional')-Number(getCharacter(b.characterId)?.role!=='professional'))
  .map(row=>({characterId:row.characterId,cold:(row.state?.values?.affection??1)<0}));
}
export function defaultReportTeam(report:SecretaryReport,participants:ReturnType<typeof reportParticipants>):ReportTeamMessage[] {
 return participants.flatMap(({characterId,cold})=>{const person=getCharacter(characterId);if(!person)return [];
  const data=characterId==='chen-nian'?report.training:characterId==='liu'?report.nutrition:report.cooking;
  const text=person.role==='professional'?(data.planned===0?'这段时间还没有执行记录，下次按确认好的安排来。':cold?`这次完成${data.completed}/${data.planned}。`:`这次完成${data.completed}/${data.planned}。下次先和我确认安排，再按实际情况调整。`):({'xia-xia':'这周聊过的事，慢慢来就好','yuan-xiaoman':'这周先写到这，下周再接着聊','he-jiawei':'这一段告一段落，下周照自己的节奏来'}[characterId]||'下次接着聊');
  return [{characterId,name:person.name,avatar:person.avatar,text,quoteId:`${report.id}:team:${characterId}`}];});
}
/** All arithmetic is deterministic; no model response is allowed to alter these fields. */
export function buildSecretaryReport(kind:SecretaryReport['kind'],input:ReportInputs):SecretaryReport {
 const {startDate,endDate}=reportRange(kind,input.now),rows=reportOccurrences(input,startDate,endDate),records=(input.measurements||[]).filter(row=>validTaskDate(row.date));
 const training=metric(rows.filter(r=>r.kind==='training')),nutrition=dayMetric(rows.filter(r=>r.kind==='nutrition')),cooking=metric(rows.filter(r=>r.kind==='cooking'));
 const totals=[training,nutrition,cooking],planned=totals.reduce((n,m)=>n+m.planned,0),completed=totals.reduce((n,m)=>n+m.completed,0);
 const periodRecords=records.filter(r=>r.date>=startDate&&r.date<=endDate).sort((a,b)=>a.date.localeCompare(b.date));
 const weeklyWeights=[];for(let start=startDate;start<=endDate;start=shiftTaskDate(start,7))weeklyWeights.push({startDate:start,weightKg:meanWeight(records,start,[shiftTaskDate(start,6),endDate].sort()[0])});
 const label=kind==='morning'?`${Number(startDate.slice(5,7))}月${Number(startDate.slice(8))}日`:(kind==='monthly'?`${Number(startDate.slice(5,7))}月月报`:'本周周报');
 const report:SecretaryReport={id:`${kind}:${startDate}:${endDate}`,kind,title:label,createdAt:new Date(input.now).toISOString(),startDate,endDate,
  agenda:kind==='morning'?rows.map(({kind:_kind,...row})=>row):[],decisions:[],completionPercent:planned?Math.round(completed/planned*100):null,
  training,nutrition,cooking,packedMeals:rows.some(row=>row.title.includes('带饭'))?metric(rows.filter(row=>row.title.includes('带饭'))):null,weightKg:meanWeight(records,startDate,endDate),previousWeightKg:meanWeight(records,shiftTaskDate(startDate,-7),shiftTaskDate(startDate,-1)),
  waistCm:periodRecords.filter(r=>typeof r.waistCm==='number').at(-1)?.waistCm??null,previousWaistCm:records.filter(r=>r.date>=shiftTaskDate(startDate,-7)&&r.date<startDate&&typeof r.waistCm==='number').sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.waistCm??null,weeklyWeights,feelings:{sleep:periodRecords.filter(r=>r.sleep).at(-1)?.sleep??null,energy:periodRecords.filter(r=>r.energy).at(-1)?.energy??null,soreness:periodRecords.filter(r=>r.soreness).at(-1)?.soreness??null},
  adjustments:[],milestones:[],nextFocus:[],team:[],partial:input.snapshot.readErrors>0};
 if(kind==='weekly'){const thursday=new Date(startDate+'T00:00:00Z');thursday.setUTCDate(thursday.getUTCDate()+3);const firstMonday=new Date(Date.UTC(thursday.getUTCFullYear(),0,4));firstMonday.setUTCDate(firstMonday.getUTCDate()-((firstMonday.getUTCDay()+6)%7));report.weekNumber=1+Math.floor((Date.parse(startDate)-firstMonday.getTime())/(7*86400000));report.title=`第${report.weekNumber}周周报`;}
 if(kind!=='morning'){
  report.team=defaultReportTeam(report,reportParticipants(input,startDate,endDate));
  report.nextFocus=[...new Set(input.snapshot.professionalTasks.filter(task=>!['cancelled','completed','skipped'].includes(task.status)&&task.steps.some(step=>{const date=professionalTaskStepDate(task,step);return !!date&&date>endDate&&date<=shiftTaskDate(endDate,7);})).map(task=>task.title))];
  report.milestones=[...(training.completed?[`完成${training.completed}次训练`]:[]),...(cooking.completed?[`完成${cooking.completed}次做饭`]:[])];
 }
 return report;
}
