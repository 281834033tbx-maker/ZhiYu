import {createInitialTaskBoard} from './reducer';
import {DEMO_METRICS} from './config';
import type {DemoOverview,Task,TaskBoardModel} from './types';

const keyFor=(accountId:string)=>`zhiyu-task-board-demo-v1:${accountId}`;
const statuses=new Set(['todo','in_progress','paused','done','ended','missed']);
function validTask(task:unknown):task is Task {
  if(!task||typeof task!=='object')return false;
  const value=task as Task;
  return typeof value.id==='string'&&typeof value.title==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    &&typeof value.categoryId==='string'&&typeof value.npcId==='string'&&typeof value.amount==='string'
    &&['steps','single','count'].includes(value.type)&&statuses.has(value.status)&&Number.isFinite(value.order)
    &&(!value.steps||Array.isArray(value.steps)&&value.steps.every(step=>typeof step.id==='string'&&typeof step.name==='string'&&typeof step.detail==='string'&&typeof step.done==='boolean'&&(!step.sets||Number.isInteger(step.sets.total)&&step.sets.total>0&&step.sets.total<=30&&Number.isInteger(step.sets.done)&&step.sets.done>=0&&step.sets.done<=step.sets.total)))
    &&(!value.count||Number.isFinite(value.count.current)&&value.count.current>=0&&Number.isFinite(value.count.target)&&value.count.target>0&&Number.isFinite(value.count.perTime)&&value.count.perTime>0&&['ml','步','次'].includes(value.count.unit));
}
function validModel(value:unknown):value is TaskBoardModel {
  if(!value||typeof value!=='object')return false;
  const model=value as TaskBoardModel,page=model.page;
  return model.version===1&&model.today==='2026-11-01'&&Array.isArray(model.tasks)&&model.tasks.length<10000&&model.tasks.every(validTask)
    &&new Set(model.tasks.map(task=>task.id)).size===model.tasks.length&&!!page&&['today','future','history'].includes(page.view)
    &&[7,30].includes(page.futureRange)&&['all','done','missed'].includes(page.historyFilter)&&Array.isArray(page.expandedTaskIds)&&page.expandedTaskIds.every(id=>typeof id==='string')
    &&typeof page.activeExpanded==='boolean'&&typeof page.weeklyReview?.time==='string'&&Number.isInteger(model.historyLoadedDays)&&model.historyLoadedDays>=3&&model.historyLoadedDays<=365
    &&!!model.timers&&typeof model.timers==='object'&&Object.values(model.timers).every(timer=>Number.isFinite(timer.endsAt)&&typeof timer.taskId==='string'&&typeof timer.stepId==='string')
    &&(!model.rest||Number.isFinite(model.rest.endsAt)&&typeof model.rest.taskId==='string'&&typeof model.rest.stepId==='string');
}
function validDemoOverview(value:unknown):value is DemoOverview {
  if(!value||typeof value!=='object')return false;
  const overview=value as DemoOverview,calendar=overview.calendar;
  return typeof overview.today==='string'&&Number.isFinite(overview.futureCount7)&&Number.isFinite(overview.historyDone)
    &&!!overview.categoryCounts&&['today','future','history'].every(view=>{
      const counts=overview.categoryCounts[view as keyof DemoOverview['categoryCounts']];
      return !!counts&&typeof counts==='object'&&Object.values(counts).every(number=>Number.isFinite(number)&&number>=0);
    })&&!!calendar&&/^\d{4}-\d{2}$/.test(calendar.month)&&Array.isArray(calendar.complete)&&Array.isArray(calendar.partial)
    &&[...calendar.complete,...calendar.partial].every(day=>Number.isInteger(day)&&day>=1&&day<=31)
    &&Number.isInteger(calendar.selected)&&calendar.selected>=1&&calendar.selected<=31
    &&Number.isFinite(calendar.completionRate)&&Number.isFinite(calendar.longestStreak)&&Number.isFinite(calendar.trainingCount);
}
export interface TaskBoardDataSource {
  load:(accountId:string,now?:number)=>Promise<TaskBoardModel>;
  save:(accountId:string,model:TaskBoardModel)=>Promise<void>;
}
/** This is the only persistence boundary of the demo. Replace this provider
 * for live tasks; it never touches the existing professional-task stores. */
export const mockTaskBoardSource:TaskBoardDataSource={
  async load(accountId,now=Date.now()) {
    if(typeof window==='undefined'||!accountId)return createInitialTaskBoard(now);
    try {
      const saved=localStorage.getItem(keyFor(accountId));
      if(saved) {const value:unknown=JSON.parse(saved);if(validModel(value))return {...value,demoOverview:validDemoOverview(value.demoOverview)?value.demoOverview:DEMO_METRICS};}
    } catch { /* A broken demo snapshot never prevents opening the task page. */ }
    return createInitialTaskBoard(now);
  },
  async save(accountId,model) {
    if(typeof window!=='undefined'&&accountId)localStorage.setItem(keyFor(accountId),JSON.stringify(model));
  },
};
