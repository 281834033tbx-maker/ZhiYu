import type {GroupChat,GroupReminder} from '../../../lib/npc/group-chat';
import type {ProfessionalTask,ProfessionalTaskStep} from '../../../lib/npc/professional-task';
import type {Step,Task,TaskStatus} from './types';

const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const validTime=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const lines=(values:(string|undefined)[])=>values.filter((value):value is string=>typeof value==='string'&&!!value.trim());
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
function dateOf(at:string) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.parse(at));
  const part=(type:string)=>parts.find(value=>value.type===type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Small browser-safe identifiers are only UI references. The complete source
 * key remains the deduplication identity, even if two hashes ever collide. */
function identifier(kind:string,key:string) {
  let first=0x811c9dc5,second=0x9e3779b9;
  for(let index=0;index<key.length;index++) {
    const code=key.charCodeAt(index);
    first=Math.imul(first^code,0x01000193);
    second=Math.imul(second^code,0x85ebca6b);
  }
  return `live-${kind}-${(first>>>0).toString(36)}-${(second>>>0).toString(36)}-${key.length.toString(36)}`;
}
function projectStep(step:ProfessionalTaskStep,key:string):Step {
  const training=step.training;
  const prescribedSets=training&&Number.isInteger(training.sets)&&training.sets>0&&training.sets<=30?training.sets:undefined;
  const duration=positive(step.durationSeconds)?step.durationSeconds:undefined;
  const done=!!step.completedAt;
  const detail=lines([
    ...(step.details||[]),...(step.instructions||[]),
    training?.target?`训练部位：${training.target}`:undefined,
    training?`训练安排：${training.sets} 组 × ${training.reps}`:undefined,
    training?.restSeconds!==undefined?`组间休息：${training.restSeconds} 秒`:undefined,
    step.scheduledDate?`原计划日期：${step.scheduledDate}`:undefined,
    step.completionCondition?`完成标准：${step.completionCondition}`:undefined,
  ]).join('\n');
  const tips=lines([...(step.notes||[]),training?.effort,training?.recommendation,...(step.hints||[]).map(hint=>hint.text)]);
  return {id:identifier('step',`${key}:${step.id}`),name:step.title,detail,done,
    ...(step.skippedAt?{skipped:true}:{}),...(tips.length?{tips}:{}),
    ...(prescribedSets?{sets:{total:prescribedSets,done:done?prescribedSets:0}}:{}),
    ...(training?.restSeconds!==undefined?{restSeconds:training.restSeconds}:{}),
    ...(duration?{timerSeconds:duration,durationText:`${duration} 秒`}:{})};
}
const professionalStatus:Record<ProfessionalTask['status'],TaskStatus>={active:'todo',paused:'paused',completed:'done',cancelled:'ended',skipped:'missed'};
function projectProfessional(task:ProfessionalTask):Task|undefined {
  if(!task.id||!['chen-nian','zhou-chef','liu'].includes(task.characterId)||!validTime(task.createdAt)||!Array.isArray(task.steps)||!professionalStatus[task.status])return;
  const key=`professional:${task.characterId}:${task.id}`;
  const dates=task.steps.map(step=>step.scheduledDate).filter(validDate).sort();
  const originalDate=dates[0]||(validDate(task.assignedDate)?task.assignedDate:dateOf(task.createdAt));
  const steps=task.steps.map(step=>projectStep(step,key));
  const completedTimes=task.steps.map(step=>step.completedAt).filter(validTime).sort();
  return {id:identifier('professional',key),title:task.title,
    categoryId:task.characterId==='chen-nian'?'fitness':task.characterId==='liu'?'nutrition':'cooking',npcId:task.characterId,
    type:steps.length?'steps':'single',amount:steps.length?`${steps.length} 个步骤`:'',date:originalDate,order:0,
    status:professionalStatus[task.status],...(steps.length?{steps}:{}),
    ...(task.status==='completed'&&completedTimes.length?{completedAt:completedTimes.at(-1)}:{}),
    source:{key,kind:'professional',id:task.id,createdAt:task.createdAt,originalDate,...(Number.isSafeInteger(task.revision)&&task.revision>=0?{revision:task.revision}:{})}};
}
const meals=['breakfast','lunch','dinner'] as const;
const mealNames={breakfast:'早餐',lunch:'午餐',dinner:'晚餐'};
const clockTime=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function confirmationTime(group:GroupChat,messageId?:string) {
  if(!messageId)return;
  const at=group.messages.find(message=>message.id===messageId)?.at;
  // Both a real user confirmation and an application confirmation event can
  // be the server-saved pointer. Their prose and event labels are irrelevant.
  return validTime(at)?at:undefined;
}
function confirmedReminders(group:GroupChat):{reminder:GroupReminder;createdAt:string}[] {
  return (group.reminders||[]).flatMap(reminder=>{
    const createdAt=confirmationTime(group,reminder.confirmationMessageId);
    return reminder.status==='active'&&createdAt&&meals.includes(reminder.meal)&&clockTime(reminder.time)&&reminder.timezone==='Asia/Shanghai'
      &&validDate(reminder.startDate)&&validDate(reminder.endDate)&&reminder.startDate<=reminder.endDate?[{reminder,createdAt}]:[];
  });
}
const groupNpc=(group:GroupChat)=>group.members.some(member=>member.id==='liu')?'liu':group.members.some(member=>member.id==='zhou-chef')?'zhou-chef':'molly';
function projectPlan(group:GroupChat,reminders:ReturnType<typeof confirmedReminders>):Task[] {
  const plan=group.plan;
  if(group.leftAt||plan?.status!=='confirmed'||!plan.id)return [];
  // Only persisted confirmation or actual creation timestamps establish a
  // plan's age. Group chat updatedAt is never a new-task signal.
  const createdAt=validTime(plan.confirmedAt)?plan.confirmedAt:confirmationTime(group,plan.confirmationMessageId)
    ||(validTime(plan.createdAt)?plan.createdAt:undefined);
  if(!createdAt)return [];
  const npcId=groupNpc(group);
  return plan.days.flatMap(day=>!validDate(day.date)?[]:meals.flatMap(meal=>{
    const menu=day[meal]?.trim();
    if(!menu)return [];
    const key=`group-plan:${group.id}:${plan.id}:${day.date}:${meal}`;
    const matching=reminders.filter(({reminder})=>reminder.meal===meal&&reminder.startDate<=day.date&&reminder.endDate>=day.date);
    const detail=lines([menu,day.label,`原计划日期：${day.date}`,...matching.map(({reminder})=>`已确认提醒：${reminder.time}（上海时间）`)]).join('\n');
    return [{id:identifier('group',key),title:`${mealNames[meal]}：${menu}`.slice(0,160),categoryId:'nutrition',npcId,type:'steps' as const,
      amount:day.label||mealNames[meal],date:day.date,order:0,status:'todo' as const,
      steps:[{id:identifier('step',key),name:mealNames[meal],detail,done:false}],
      note:`群计划：${group.name}`,source:{key,kind:'group' as const,id:plan.id,createdAt,originalDate:day.date}}];
  }));
}
function projectGroup(group:GroupChat,since?:string):Task[] {
  if(group.leftAt)return [];
  const reminders=confirmedReminders(group),planRows=projectPlan(group,reminders),cutoff=Date.parse(since||'');
  // An old plan excluded by the board's cutoff cannot swallow a newly
  // confirmed reminder. The reducer independently enforces the same cutoff.
  const coveringRows=planRows.filter(task=>!Number.isFinite(cutoff)||Date.parse(task.source!.createdAt)>=cutoff);
  const reminderRows=reminders.flatMap(({reminder,createdAt})=>{
    const represented=coveringRows.some(task=>{
      const date=task.source!.originalDate!;
      return reminder.startDate<=date&&reminder.endDate>=date
        &&task.source!.key===`group-plan:${group.id}:${group.plan!.id}:${date}:${reminder.meal}`;
    });
    if(represented)return [];
    const key=`group-reminder:${group.id}:${reminder.id}`;
    return [{id:identifier('group',key),title:`${mealNames[reminder.meal]}提醒`,categoryId:'nutrition',npcId:groupNpc(group),
      type:'single' as const,amount:`${reminder.time}（上海时间）`,date:reminder.startDate,order:0,status:'todo' as const,
      note:lines([`提醒时间：${reminder.time}（上海时间）`,`日期范围：${reminder.startDate} 至 ${reminder.endDate}`,`来自群聊：${group.name}`,group.goal]).join('\n'),
      source:{key,kind:'group' as const,id:reminder.id,createdAt,originalDate:reminder.startDate}}];
  });
  return [...planRows,...reminderRows];
}

/** Projects persisted tasks, confirmed plans, and active reminders with a
 * server-saved confirmation pointer. Message text, candidate plans and
 * navigation cards cannot create tasks. The optional cutoff is used solely
 * to avoid deduplicating a new reminder against an excluded old plan. */
export function projectLiveBoardTasks(professional:readonly ProfessionalTask[],groups:readonly GroupChat[],since?:string):Task[] {
  const tasks=[...professional.map(projectProfessional).filter((task):task is Task=>!!task),...groups.flatMap(group=>projectGroup(group,since))];
  const known=new Set<string>();
  return tasks.filter(task=>{const key=task.source!.key;if(known.has(key))return false;known.add(key);return true;})
    // Stable sort preserves the plan's breakfast/lunch/dinner order when its
    // rows share the same confirmation timestamp.
    .sort((a,b)=>Date.parse(a.source!.createdAt)-Date.parse(b.source!.createdAt));
}
