import type {DailyBrief} from '../../lib/npc/molly-reports';
import {sortBriefSchedule} from '../../lib/npc/molly-reports';
import {arrangementCountdownStart} from '../../lib/npc/arrangement-sections';
import type {ArrangementStore} from './arrangements-store';

/** Append actual owner records to the established template. */
export function addArrangementsToBrief(brief:DailyBrief,store:ArrangementStore,owner:string):DailyBrief {
 const result=structuredClone(brief),snapshot=store.briefItems(owner,brief.date);
 for(const item of snapshot.items){
  const id=`arrangement:${item.id}`;
  if(item.section==='payment'){
   if(!result.bills.some(row=>row.id===id))result.bills.push({id,type:item.details.payment?.name||'缴费',name:item.title,action:'到期',dueDate:item.time.date||brief.date,button:'缴费',paid:false});
  }else if(item.section==='procedure'){
   result.progress.push({id,name:item.title,steps:item.details.steps?.map(step=>step.title)||[],done:item.details.steps?.filter(step=>step.done).length||0});
  }else if(item.section==='countdown'){
   const date=item.time.date||brief.date,kind=item.details.countdownKind||'other';
   if(!result.upcoming.some(row=>row.id===id))result.upcoming.push({id,text:item.title,date,kind,showFrom:arrangementCountdownStart(date,kind)});
  }else if(!result.schedule.some(row=>row.id===id)){
   result.schedule.push({id,date:brief.date,time:item.time.time||'全天',category:item.section==='purchase'?'shopping':'other',text:item.title,ownerId:'molly',...(snapshot.deferred.some(row=>row.item.id===item.id)?{sub:{kind:'reason' as const,text:'上次未推送的提醒，合并到今日简报'}}:{})});
  }
 }
 result.schedule=sortBriefSchedule(result.schedule,brief.date);return result;
}
