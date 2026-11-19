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
  /** Public attribution supplied by a future professional's persisted plan. */
  publisherName?:string; publisherAvatar?:string;
  amount:string; tip?:string; date:string; repeat?:'daily'; order:number;
  pinned?:boolean; status:TaskStatus; steps?:Step[];
  count?:{current:number; target:number; perTime:number; unit:'ml'|'步'|'次'};
  note?:string; missReason?:string; missText?:string; completedAt?:string; planId?:string;
  /** Imported snapshots keep their first append position independently of status. */
  appendOrder?:number;
  source?:{key:string;kind:'professional'|'group';id:string;createdAt:string;originalDate?:string;revision?:number};
  /** Explicitly authored records are user-maintained board data, not execution evidence. */
  manualRecord?:{id:string;name:string;importedAt:string};
}
export interface TaskPageState {
  view:TaskView; futureRange:7|30; historyFilter:'all'|'done'|'missed';
  /** Omitted means the actual Shanghai today; a selected date never changes the clock. */
  selectedDate?:string;
  categoryFilter?:string; activeTaskId?:string; activeExpanded:boolean;
  expandedTaskIds:string[]; expandedStepId?:string; weeklyReview:{time:string};
}
export interface TaskTimer {taskId:string; stepId:string; endsAt:number; pausedRemainingMs?:number}
/** Optional mock-source metadata. Live sources omit it; views then derive
 * their summaries and calendar entirely from the supplied task records. */
export interface DemoOverview {
  today:string; futureCount7:number; historyDone:number;
  categoryCounts:Record<TaskView,Record<string,number>>;
  calendar:{month:string;complete:number[];partial:number[];selected:number;completionRate:number;longestStreak:number;trainingCount:number};
}
export interface TaskBoardModel {
  version:1; today:string; tasks:Task[]; page:TaskPageState;
  /** Missing only in legacy snapshots, which migrate their original displayed plans once. */
  plans?:Plan[];
  rest?:TaskTimer; timers:Record<string,TaskTimer>; historyLoadedDays:number;
  demoOverview?:DemoOverview;
  /** Persisted opt-in cutoff; opening the board never imports historical tasks. */
  liveImport?:{since:string};
  /** Explicit account maintenance reset; never interpreted as a new demo. */
  contentResetAt?:number;
}
export type TaskBoardAction =
  | {type:'hydrate'; model:TaskBoardModel}
  | {type:'reset'; now?:number}
  | {type:'enable-live-import'; now:number}
  | {type:'import-tasks'; tasks:Task[]}
  /** Arrangement sections include retained historical sources without
   * resurrecting anything older than an explicit content-reset epoch. */
  | {type:'import-arrangement-records'; tasks:Task[]}
  | {type:'set-view'; view:TaskView}
  | {type:'set-selected-date'; date?:string}
  | {type:'import-manual-record'; record:ManualTaskRecord; now?:number}
  | {type:'upsert-plan'; plan:Plan}
  | {type:'delete-plan'; planId:string}
  | {type:'set-future-range'; range:7|30}
  | {type:'set-history-filter'; filter:'all'|'done'|'missed'}
  | {type:'set-category'; categoryId?:string}
  | {type:'toggle-task'; taskId:string}
  | {type:'toggle-active-expanded'}
  | {type:'expand-step'; stepId?:string}
  | {type:'pin'; taskId:string}
  | {type:'start'|'pause'|'finish'|'toggle-status'|'increment-count'|'complete-count'; taskId:string; now?:number}
  | {type:'toggle-step'; taskId:string; stepId:string; now?:number}
  | {type:'set-step-set'; taskId:string; stepId:string; index:number; now?:number}
  | {type:'start-timer'; taskId:string; stepId:string; now?:number}
  | {type:'pause-timer'|'resume-timer'; taskId:string; stepId:string; now?:number}
  | {type:'load-history'; throughDate?:string};

export interface ManualTaskRecord {
  version:1; name:string; recordId:string; selectedDate:string; tasks:Task[]; plans:Plan[];
}
