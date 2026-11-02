import {createHistoryDay,createMockTaskBoard,shiftMockDate} from './mock';
import type {Task,TaskBoardAction,TaskBoardModel,TaskTimer} from './types';

export const HISTORY_MOCK_LIMIT_DAYS=365;
export const createInitialTaskBoard=(now=Date.now()):TaskBoardModel=>createMockTaskBoard(now);
export function createEmptyTaskBoard(today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())):TaskBoardModel {
  return {version:1,today,tasks:[],page:{view:'today',futureRange:7,historyFilter:'all',activeExpanded:false,expandedTaskIds:[],weeklyReview:{time:''}},timers:{},historyLoadedDays:0};
}
export const shiftBoardDate=shiftMockDate;
export const isTaskFinished=(task:Task)=>task.status==='done'||task.status==='ended';
export function taskStepProgress(task:Task) {
  const total=task.steps?.length||0,done=task.steps?.filter(step=>step.done).length||0;
  return {done,total,current:Math.max(0,task.steps?.findIndex(step=>!step.done)??0),percent:total?Math.round(done/total*100):0};
}
export function taskProgress(task:Task) {
  if(task.type==='count'&&task.count) {
    const done=task.count.current,total=task.count.target;
    return {done,total,percent:total?Math.min(100,Math.round(done/total*100)):0};
  }
  if(task.type==='steps')return taskStepProgress(task);
  return {done:isTaskFinished(task)?1:0,total:1,percent:isTaskFinished(task)?100:0};
}
export function taskMatchesQuery(task:Task,query:string) {
  const normalized=query.trim().toLocaleLowerCase();
  if(!normalized)return true;
  return [task.title,task.amount,task.tip,task.note,...(task.steps||[]).flatMap(step=>[step.name,step.detail,step.actual,...(step.tips||[])])].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized);
}
const timestamp=(now?:number)=>new Date(now??Date.now()).toISOString();
const removeTaskTimers=(model:TaskBoardModel,id:string)=>Object.fromEntries(Object.entries(model.timers).filter(([,timer])=>timer.taskId!==id));
const remainingRest=(model:TaskBoardModel,id:string)=>model.rest?.taskId===id?undefined:model.rest;
function replaceTask(model:TaskBoardModel,id:string,change:(task:Task)=>Task):TaskBoardModel {
  return {...model,tasks:model.tasks.map(task=>task.id===id?change(task):task)};
}
function finish(model:TaskBoardModel,task:Task,now?:number) {
  const status=task.type==='steps'&&!task.steps?.every(step=>step.done)?'ended':'done';
  return {...replaceTask(model,task.id,current=>({...current,status,completedAt:timestamp(now)})),rest:remainingRest(model,task.id),timers:removeTaskTimers(model,task.id)};
}
function toggleFinished(model:TaskBoardModel,task:Task,now?:number):TaskBoardModel {
  if(isTaskFinished(task)) {
    const history=task.date<model.today;
    const recorded=history&&task.missText?Number(task.missText.match(/\d+/)?.[0]):NaN;
    return {...replaceTask(model,task.id,current=>({...current,status:history?'missed':current.type==='steps'&&current.steps?.some(step=>step.done)?'paused':'todo',completedAt:undefined,...(current.count?{count:{...current.count,current:Math.max(0,Number.isFinite(recorded)?Math.min(current.count.target-current.count.perTime,recorded):current.count.target-current.count.perTime)}}:{})})),rest:remainingRest(model,task.id),timers:removeTaskTimers(model,task.id),page:{...model.page,activeTaskId:model.page.activeTaskId===task.id?undefined:model.page.activeTaskId}};
  }
  if(task.date<model.today) {
    return replaceTask(model,task.id,current=>({...current,status:'done',completedAt:timestamp(now),count:current.count?{...current.count,current:current.count.target}:undefined}));
  }
  return task.type==='steps'?finish(model,task,now):replaceTask(model,task.id,current=>({...current,status:'done',completedAt:timestamp(now)}));
}
function updateStep(model:TaskBoardModel,task:Task,stepId:string,change:(step:NonNullable<Task['steps']>[number])=>NonNullable<Task['steps']>[number],now?:number) {
  if(task.date!==model.today||isTaskFinished(task))return model;
  const before=task.steps?.find(step=>step.id===stepId);
  if(!before)return model;
  const after=change(before);
  const nextTask={...task,steps:task.steps!.map(step=>step.id===stepId?after:step)};
  let rest=model.rest;
  if(model.page.activeTaskId===task.id&&task.status==='in_progress') {
    const nextStep=nextTask.steps.find(step=>!step.done);
    const progressed=Number(after.done)>Number(before.done)||(after.sets?.done||0)>(before.sets?.done||0);
    if(progressed&&nextStep?.restSeconds) rest={taskId:task.id,stepId:nextStep.id,endsAt:(now??Date.now())+nextStep.restSeconds*1000};
    else if(!nextStep||!progressed)rest=undefined;
  }
  const timers=after.done?Object.fromEntries(Object.entries(model.timers).filter(([key])=>key!==`${task.id}:${stepId}`)):model.timers;
  return {...replaceTask(model,task.id,()=>nextTask),rest,timers};
}
export function taskBoardReducer(model:TaskBoardModel,action:TaskBoardAction):TaskBoardModel {
  switch(action.type) {
    case 'hydrate': return action.model;
    case 'reset': return createInitialTaskBoard(action.now);
    case 'set-view':return {...model,page:{...model.page,view:action.view,categoryFilter:undefined,expandedStepId:undefined}};
    case 'set-future-range':return {...model,page:{...model.page,futureRange:action.range}};
    case 'set-history-filter':return {...model,page:{...model.page,historyFilter:action.filter}};
    case 'set-category':return {...model,page:{...model.page,categoryFilter:model.page.categoryFilter===action.categoryId?undefined:action.categoryId}};
    case 'toggle-task':return {...model,page:{...model.page,expandedTaskIds:model.page.expandedTaskIds.includes(action.taskId)?model.page.expandedTaskIds.filter(id=>id!==action.taskId):[...model.page.expandedTaskIds,action.taskId]}};
    case 'toggle-active-expanded':return {...model,page:{...model.page,activeExpanded:!model.page.activeExpanded}};
    case 'expand-step':return {...model,page:{...model.page,expandedStepId:model.page.expandedStepId===action.stepId?undefined:action.stepId}};
    case 'load-history': {
      if(!model.demoOverview)return model;
      const requested=action.throughDate?Math.ceil((Date.parse(`${model.today}T00:00:00Z`)-Date.parse(`${action.throughDate}T00:00:00Z`))/86400000):model.historyLoadedDays+7;
      const target=Math.max(model.historyLoadedDays,Math.min(HISTORY_MOCK_LIMIT_DAYS,Number.isFinite(requested)?requested:model.historyLoadedDays+7));
      if(target===model.historyLoadedDays)return model;
      const added=Array.from({length:target-model.historyLoadedDays},(_,index)=>createHistoryDay(shiftBoardDate(model.today,-model.historyLoadedDays-index-1))).flat();
      const ids=new Set(model.tasks.map(task=>task.id));
      return {...model,historyLoadedDays:target,tasks:[...model.tasks,...added.filter(task=>!ids.has(task.id))]};
    }
  }
  const task=model.tasks.find(item=>item.id===action.taskId);
  if(!task)return model;
  switch(action.type) {
    case 'pin':return replaceTask(model,task.id,current=>({...current,pinned:!current.pinned}));
    case 'start': {
      if(task.type!=='steps'||task.date!==model.today||isTaskFinished(task))return model;
      const oldId=model.page.activeTaskId;
      const tasks=model.tasks.map(current=>current.id===task.id?{...current,status:'in_progress' as const}:current.id===oldId&&current.status==='in_progress'?{...current,status:'paused' as const}:current);
      const first=task.steps?.find(step=>!step.done);
      const rest:TaskTimer|undefined=first?.restSeconds&&((first.sets?.done||0)>0)?{taskId:task.id,stepId:first.id,endsAt:(action.now??Date.now())+first.restSeconds*1000}:undefined;
      return {...model,tasks,rest,page:{...model.page,activeTaskId:task.id,activeExpanded:false,expandedStepId:undefined}};
    }
    case 'finish':return task.date===model.today&&!isTaskFinished(task)?finish(model,task,action.now):model;
    case 'toggle-status': {
      if(task.date>model.today)return model;
      if(task.type==='count'&&!isTaskFinished(task)&&task.date===model.today)return taskBoardReducer(model,{type:'increment-count',taskId:task.id,now:action.now});
      return toggleFinished(model,task,action.now);
    }
    case 'increment-count':
    case 'complete-count': {
      if(task.type!=='count'||!task.count||task.date!==model.today||isTaskFinished(task))return model;
      const current=action.type==='complete-count'?task.count.target:Math.min(task.count.target,task.count.current+task.count.perTime);
      const done=current>=task.count.target;
      return replaceTask(model,task.id,value=>({...value,count:{...value.count!,current},status:done?'done':'todo',completedAt:done?timestamp(action.now):undefined}));
    }
    case 'toggle-step':return updateStep(model,task,action.stepId,step=>({...step,done:!step.done,sets:step.sets?{...step.sets,done:step.done?0:step.sets.total}:undefined}),action.now);
    case 'set-step-set':return updateStep(model,task,action.stepId,step=>{
      if(!step.sets)return step;
      const index=Math.max(0,Math.min(step.sets.total-1,Math.trunc(action.index)));
      const done=index<step.sets.done?index:index+1;
      return {...step,sets:{...step.sets,done},done:done===step.sets.total};
    },action.now);
    case 'start-timer': {
      const step=task.steps?.find(item=>item.id===action.stepId);
      if(task.date!==model.today||isTaskFinished(task)||!step?.timerSeconds)return model;
      const key=`${task.id}:${step.id}`;
      return {...model,timers:{...model.timers,[key]:{taskId:task.id,stepId:step.id,endsAt:(action.now??Date.now())+step.timerSeconds*1000}}};
    }
  }
}

export function futureOverview(model:TaskBoardModel) {
  const end=shiftBoardDate(model.today,model.page.futureRange);
  if(!model.demoOverview)return model.tasks.filter(task=>task.date>model.today&&task.date<=end).length;
  const extras=model.tasks.filter(task=>task.date>shiftBoardDate(model.today,7)&&task.date<=end);
  return model.demoOverview.futureCount7+(model.page.futureRange===30?extras.length:0);
}
export function historyCompletionDelta(model:TaskBoardModel,categoryId?:string) {
  if(!model.demoOverview)return 0;
  const month=model.demoOverview.calendar.month;
  let delta=0;
  for(const task of model.tasks)if(task.date.startsWith(`${month}-`)&&(!categoryId||task.categoryId===categoryId)) {
    const baseline=createHistoryDay(task.date).find(item=>item.id===task.id);
    if(baseline)delta+=Number(isTaskFinished(task))-Number(isTaskFinished(baseline));
  }
  return delta;
}
export function historyOverview(model:TaskBoardModel,month=model.demoOverview?.calendar.month||model.today.slice(0,7)) {
  if(model.demoOverview&&month===model.demoOverview.calendar.month)return Math.max(0,model.demoOverview.historyDone+historyCompletionDelta(model));
  return model.tasks.filter(task=>task.date<model.today&&task.date.startsWith(`${month}-`)&&isTaskFinished(task)).length;
}
export function categoryOverview(model:TaskBoardModel,categoryId:string,historyMonth?:string) {
  if(model.page.view==='today')return model.tasks.filter(task=>task.date===model.today&&task.categoryId===categoryId).length;
  if(model.page.view==='history') {
    const month=historyMonth||model.demoOverview?.calendar.month||model.today.slice(0,7);
    if(model.demoOverview&&month===model.demoOverview.calendar.month)return Math.max(0,(model.demoOverview.categoryCounts.history[categoryId]||0)+historyCompletionDelta(model,categoryId));
    return model.tasks.filter(task=>task.date<model.today&&task.date.startsWith(`${month}-`)&&task.categoryId===categoryId&&isTaskFinished(task)).length;
  }
  if(!model.demoOverview) {
    return model.tasks.filter(task=>task.date>model.today&&task.date<=shiftBoardDate(model.today,model.page.futureRange)&&task.categoryId===categoryId).length;
  }
  const extra=model.page.futureRange===30?model.tasks.filter(task=>task.categoryId===categoryId&&task.date>shiftBoardDate(model.today,7)&&task.date<=shiftBoardDate(model.today,30)).length:0;
  return (model.demoOverview.categoryCounts.future[categoryId]||0)+extra;
}
export function todayTasks(model:TaskBoardModel) {return model.tasks.filter(task=>task.date===model.today);}
export function todayProgress(model:TaskBoardModel) {
  const tasks=todayTasks(model),done=tasks.filter(isTaskFinished).length,total=tasks.length;
  return {done,total,pending:total-done};
}
