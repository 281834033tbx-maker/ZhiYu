export type TaskType = 'steps' | 'single' | 'count';
export type TaskStatus = 'todo' | 'in_progress' | 'paused' | 'done' | 'ended' | 'missed';
export type TaskView = 'today' | 'future' | 'history';
export interface CategoryGroup {id:string; name:string; order:number}
export interface Category {id:string; name:string; groupId:string; color:string; icon:string; verb?:string}
export interface Npc {id:string; name:string; avatar:string; initial?:string; background?:string; color?:string}
export interface Plan {id:string; name:string; color:string; progress:number; progressText:string}
export interface Step {
  id:string; name:string; detail:string; restSeconds?:number; durationText?:string;
  sets?:{total:number; done:number; weight?:string}; tips?:string[]; image?:string;
  timerSeconds?:number; done:boolean; skipped?:boolean; actual?:string;
}
export interface Task {
  id:string; title:string; categoryId:string; npcId:string; type:TaskType;
  amount:string; tip?:string; date:string; repeat?:'daily'; order:number;
  pinned?:boolean; status:TaskStatus; steps?:Step[];
  count?:{current:number; target:number; perTime:number; unit:'ml'|'步'|'次'};
  note?:string; missReason?:string; missText?:string; completedAt?:string; planId?:string;
}
export interface TaskPageState {
  view:TaskView; futureRange:7|30; historyFilter:'all'|'done'|'missed';
  categoryFilter?:string; activeTaskId?:string; activeExpanded:boolean;
  expandedTaskIds:string[]; expandedStepId?:string; weeklyReview:{time:string};
}
export interface TaskTimer {taskId:string; stepId:string; endsAt:number}
/** Optional mock-source metadata. Live sources omit it; views then derive
 * their summaries and calendar entirely from the supplied task records. */
export interface DemoOverview {
  today:string; futureCount7:number; historyDone:number;
  categoryCounts:Record<TaskView,Record<string,number>>;
  calendar:{month:string;complete:number[];partial:number[];selected:number;completionRate:number;longestStreak:number;trainingCount:number};
}
export interface TaskBoardModel {
  version:1; today:string; tasks:Task[]; page:TaskPageState;
  rest?:TaskTimer; timers:Record<string,TaskTimer>; historyLoadedDays:number;
  demoOverview?:DemoOverview;
}
export type TaskBoardAction =
  | {type:'hydrate'; model:TaskBoardModel}
  | {type:'reset'; now?:number}
  | {type:'set-view'; view:TaskView}
  | {type:'set-future-range'; range:7|30}
  | {type:'set-history-filter'; filter:'all'|'done'|'missed'}
  | {type:'set-category'; categoryId?:string}
  | {type:'toggle-task'; taskId:string}
  | {type:'toggle-active-expanded'}
  | {type:'expand-step'; stepId?:string}
  | {type:'pin'; taskId:string}
  | {type:'start'|'finish'|'toggle-status'|'increment-count'|'complete-count'; taskId:string; now?:number}
  | {type:'toggle-step'; taskId:string; stepId:string; now?:number}
  | {type:'set-step-set'; taskId:string; stepId:string; index:number; now?:number}
  | {type:'start-timer'; taskId:string; stepId:string; now?:number}
  | {type:'load-history'; throughDate?:string};
