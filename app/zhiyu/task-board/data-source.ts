
import {accountStorage,flushAccountStorage} from '../account-storage';
import {queueReadonlyBoardSnapshot} from './readonly-sync';
import {createEmptyTaskBoard} from './reducer';
import {DEMO_METRICS,plans as legacyPlans} from './config';
import {boardShanghaiToday,parseBoardPlan} from './manual-task-record';
import type {DemoOverview,Task,TaskBoardModel} from './types';
import {contentResetStorageKey,validContentResetAt} from '../../../lib/npc/content-reset';

export const taskBoardStorageKey=(accountId:string)=>`zhiyu-task-board-demo-v1:${accountId}`;
const boardToday=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function createClearedTaskBoard(at:number,now=Date.now()):TaskBoardModel{
 return {...createEmptyTaskBoard(boardToday(now)),contentResetAt:at,liveImport:{since:new Date(at).toISOString()}};
}
export function taskBoardFallback(accountId:string,now=Date.now()):TaskBoardModel{
 if(typeof window!=='undefined'&&accountId)try{const at=Number(accountStorage(accountId).getItem(contentResetStorageKey(accountId)));if(validContentResetAt(at))return createClearedTaskBoard(at,now);}catch{/* AuthGate prevents an unfinished reset from mounting the board. */}
 return createEmptyTaskBoard(boardToday(now));
}
const statuses=new Set(['todo','in_progress','paused','done','ended','missed']);
const validDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
function validSource(source:unknown):source is NonNullable<Task['source']> {
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  const value=source as NonNullable<Task['source']>;
  return typeof value.key==='string'&&!!value.key&&value.key.length<=4096&&['professional','group'].includes(value.kind)
    &&typeof value.id==='string'&&!!value.id&&value.id.length<=2048&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))
    &&(value.originalDate===undefined||validDate(value.originalDate))&&(value.revision===undefined||Number.isSafeInteger(value.revision)&&value.revision>=0);
}
function validTask(task:unknown):task is Task {
  if(!task||typeof task!=='object')return false;
  const value=task as Task;
  return typeof value.id==='string'&&typeof value.title==='string'&&validDate(value.date)
    &&typeof value.categoryId==='string'&&typeof value.npcId==='string'&&typeof value.amount==='string'
    &&['steps','single','count'].includes(value.type)&&statuses.has(value.status)&&Number.isFinite(value.order)
    &&(value.appendOrder===undefined||Number.isSafeInteger(value.appendOrder)&&value.appendOrder>=0)
    &&(value.source===undefined||validSource(value.source))
    &&(value.manualRecord===undefined||!value.source&&value.appendOrder===undefined&&typeof value.manualRecord.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value.manualRecord.id)&&typeof value.manualRecord.name==='string'&&!!value.manualRecord.name.trim()&&value.manualRecord.name.length<=160&&Number.isFinite(Date.parse(value.manualRecord.importedAt)))
    &&(!value.steps||Array.isArray(value.steps)&&value.steps.every(step=>typeof step.id==='string'&&typeof step.name==='string'&&typeof step.detail==='string'&&typeof step.done==='boolean'&&(!step.sets||Number.isInteger(step.sets.total)&&step.sets.total>0&&step.sets.total<=30&&Number.isInteger(step.sets.done)&&step.sets.done>=0&&step.sets.done<=step.sets.total)))
    &&(!value.count||Number.isFinite(value.count.current)&&value.count.current>=0&&Number.isFinite(value.count.target)&&value.count.target>0&&Number.isFinite(value.count.perTime)&&value.count.perTime>0&&['ml','步','次'].includes(value.count.unit));
}
export function validTaskBoardModel(value:unknown):value is TaskBoardModel {
  if(!value||typeof value!=='object')return false;
  const model=value as TaskBoardModel,page=model.page;
  const cleared=validContentResetAt(model.contentResetAt);
  const validPlan=(plan:unknown)=>{try{parseBoardPlan(plan);return true;}catch{return false;}};
  const validTimer=(timer:unknown)=>{if(!timer||typeof timer!=='object'||Array.isArray(timer))return false;const value=timer as TaskBoardModel['rest'];return !!value&&Number.isFinite(value.endsAt)&&typeof value.taskId==='string'&&typeof value.stepId==='string'&&(value.pausedRemainingMs===undefined||Number.isFinite(value.pausedRemainingMs)&&value.pausedRemainingMs>=0);};
  return model.version===1&&validDate(model.today)&&(!cleared||model.demoOverview===undefined)&&Array.isArray(model.tasks)&&model.tasks.length<10000&&model.tasks.every(validTask)
    &&new Set(model.tasks.map(task=>task.id)).size===model.tasks.length&&!!page&&['today','future','history'].includes(page.view)
    &&(model.liveImport===undefined||!!model.liveImport&&typeof model.liveImport.since==='string'&&Number.isFinite(Date.parse(model.liveImport.since)))
    &&[7,30].includes(page.futureRange)&&['all','done','missed'].includes(page.historyFilter)&&Array.isArray(page.expandedTaskIds)&&page.expandedTaskIds.every(id=>typeof id==='string')
    &&typeof page.activeExpanded==='boolean'&&typeof page.weeklyReview?.time==='string'&&Number.isInteger(model.historyLoadedDays)&&model.historyLoadedDays>=0&&model.historyLoadedDays<=365
    &&(page.selectedDate===undefined||validDate(page.selectedDate))
    &&(model.plans===undefined||Array.isArray(model.plans)&&model.plans.length<=100&&model.plans.every(validPlan)&&new Set(model.plans.map(plan=>plan.id)).size===model.plans.length)
    &&!!model.timers&&typeof model.timers==='object'&&!Array.isArray(model.timers)&&Object.values(model.timers).every(validTimer)
    &&(!model.rest||validTimer(model.rest));
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
/** Preserve legacy records and plans, but derive the actual date from the clock.
 * The old displayed date remains an explicit selection rather than a fake today. */
export function migrateTaskBoardModel(model:TaskBoardModel,now=Date.now()):TaskBoardModel {
  const today=boardShanghaiToday(now),legacy=model.plans===undefined&&!validContentResetAt(model.contentResetAt)&&model.today==='2026-11-01';
  return {...model,today,plans:model.plans||(legacy?structuredClone(legacyPlans):[]),
    ...(validContentResetAt(model.contentResetAt)?{}:{demoOverview:model.demoOverview||(legacy?DEMO_METRICS:undefined)}),
    page:{...model.page,...(model.page.selectedDate===undefined&&legacy&&model.today!==today?{selectedDate:model.today}:{})}};
}
/** Account-scoped board persistence; never mutates the professional-task stores. */
export const mockTaskBoardSource:TaskBoardDataSource={
  async load(accountId,now=Date.now()) {
    if(typeof window==='undefined'||!accountId)return createEmptyTaskBoard(boardToday(now));
    try {
      const saved=accountStorage(accountId).getItem(taskBoardStorageKey(accountId));
      const resetAt=Number(accountStorage(accountId).getItem(contentResetStorageKey(accountId)));
      if(saved) {const value:unknown=JSON.parse(saved);if(validTaskBoardModel(value)){
        if(validContentResetAt(resetAt)&&value.contentResetAt!==resetAt)return createClearedTaskBoard(resetAt,now);
        return migrateTaskBoardModel(validContentResetAt(value.contentResetAt)?value:{...value,demoOverview:validDemoOverview(value.demoOverview)?value.demoOverview:undefined},now);
      }}
    } catch { /* A broken demo snapshot never prevents opening the task page. */ }
    return taskBoardFallback(accountId,now);
  },
  async save(accountId,model) {
    if(typeof window!=='undefined'&&accountId){
      // Empty non-demo boards are legitimate; zero historical records stay zero.
      const normalized={...model,today:boardShanghaiToday(),plans:model.plans||[]};
      accountStorage(accountId).setItem(taskBoardStorageKey(accountId),JSON.stringify(normalized));
      await flushAccountStorage(accountId);
      queueReadonlyBoardSnapshot(accountId,normalized.tasks);
    }
  },
};
