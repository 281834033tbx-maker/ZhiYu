import { ProfessionalTaskError, professionalTaskToday, nextProfessionalTaskStep, type ProfessionalTask, type ProfessionalTaskExecutionSession, type ProfessionalTaskStep } from './professional-task';
import { freezeProfessionalTaskStepTimer } from './professional-task-timer';
import { professionalTaskStepDate, professionalTaskStepPending, projectProfessionalTaskExpiry, reconcileProfessionalTaskExpiry } from './professional-task-expiry';

export const PROFESSIONAL_TASK_SESSION_VERSION = 'task-session-v1';
export const PROFESSIONAL_TASK_SESSION_COMPLETE_VERSION = 'cooking-session-complete-v1';
export type ProfessionalTaskSessionOperation = 'start' | 'pause';
export type ProfessionalTaskSessionKind = ProfessionalTaskExecutionSession['kind'];
export type ProfessionalTaskSessionView = {
  kind: ProfessionalTaskSessionKind; label: '训练时长' | '做饭时长';
  startLabel: '开始训练' | '开始做饭';
  status: 'idle' | ProfessionalTaskExecutionSession['status'];
  canStart: boolean; displayText: string; reason?: string;
  /** Frozen values only. A running session never exposes a live numeric display. */
  elapsedMs?: number; session?: ProfessionalTaskExecutionSession;
};

const planVersion = (task: ProfessionalTask) => task.previousPlans?.length || 0;
const currentSessions = (task: ProfessionalTask) => (task.executionSessions || []).filter(session => session.planVersion === planVersion(task));
const openSession = (task: ProfessionalTask) => currentSessions(task).findLast(session => session.status === 'running' || session.status === 'paused');
const stepText = (step: ProfessionalTaskStep) => [step.title, ...(step.instructions || []), ...(step.details || [])].join('\n');
const nutritionOrErrands = /饮食|营养|早餐|午餐|晚餐|食谱|补剂|蛋白|吃饭|护肤|购物|采购|饮水|喝水|食材清单/;
const physicalExercise = /卧推|深蹲|硬拉|俯卧撑|引体向上|高位下拉|划船|夹胸|推胸|侧平举|肩推|弯举|臂屈伸|卷腹|平板支撑|跑步|慢跑|快走|骑行|开合跳|热身|拉伸|力量训练|有氧训练|健身训练/;
const trainingHeadline = /训练|健身|练胸|练背|练腿|练肩|练臂|练腹|增肌计划/;
const cookingAction = /下锅|入锅|开火|关火|翻炒|炒至|煮至|蒸至|煎至|炸至|烤至|炖至|焖至|烹饪|做饭|做菜|备料|调味|调好料汁|摆盘|盛出|(?:^|[\n。；;])\s*(?:先|再|然后|接着|将|把)?[^\n。；;]{0,12}(?:炒|煮|蒸|煎|炸|烤|炖|焖|切|洗|搅拌)/;
const cookingHeadline = /烹饪|做饭|做菜|煮饭|炒菜|做早餐|做午餐|做晚餐/;
const heatAction = /下锅|入锅|开火|翻炒|炒至|煮至|蒸至|煎至|炸至|烤至|炖至|焖至/;
const shoppingAction = /^(?:购买|采购|买|选购|挑选|去超市|确认库存|列.{0,6}清单)/;

/** Duration metadata alone never promotes historical nutrition or errands to training. */
export function professionalTaskSessionKind(task: ProfessionalTask): ProfessionalTaskSessionKind | undefined {
  if (task.characterId === 'chen-nian') {
    if (task.steps.some(step => !!step.training)) return 'training';
    const headline = `${task.title}\n${task.goalKey}`;
    if (nutritionOrErrands.test(headline)) return undefined;
    return trainingHeadline.test(headline) || task.steps.some(step => physicalExercise.test(stepText(step))) ? 'training' : undefined;
  }
  if (task.characterId === 'zhou-chef') {
    const headline = `${task.title}\n${task.goalKey}`;
    const cookingSteps = task.steps.filter(step => !shoppingAction.test(step.title.trim()));
    if (/清洁|打扫|收纳|整理厨房|洗碗/.test(headline)) return undefined;
    if (/购物|采购|食材清单/.test(headline) && !cookingHeadline.test(headline)
      && !cookingSteps.some(step => heatAction.test(stepText(step)))) return undefined;
    if (cookingSteps.some(step => cookingAction.test(stepText(step)))) return 'cooking';
    if (nutritionOrErrands.test(headline) && !cookingHeadline.test(headline)) return undefined;
    return cookingHeadline.test(headline) ? 'cooking' : undefined;
  }
  return undefined;
}

/** A started session keeps its original step IDs even when those steps are rescheduled. */
export function professionalTaskSessionScope(task: ProfessionalTask, now = Date.now()): ProfessionalTaskStep[] {
  task=projectProfessionalTaskExpiry(task,now);
  const session = openSession(task);
  if (session) return session.stepIds.flatMap(id => task.steps.filter(step => step.id === id&&!step.skippedAt));
  const next = nextProfessionalTaskStep(task);
  if (!next) return [];
  const date=professionalTaskStepDate(task,next);
  return task.steps.filter(step=>!step.skippedAt&&professionalTaskStepDate(task,step)===date);
}

const savedElapsed = (session: ProfessionalTaskExecutionSession) => Number.isFinite(session.elapsedMs) ? Math.max(0, session.elapsedMs) : 0;
/** Pure wall-time calculation used only at mutations, never a ticking persistence write. */
export function professionalTaskSessionElapsedMs(session: ProfessionalTaskExecutionSession, now = Date.now()) {
  const anchor = Date.parse(session.updatedAt);
  return savedElapsed(session) + (session.status === 'running' && Number.isFinite(anchor) && Number.isFinite(now) ? Math.max(0, now - anchor) : 0);
}
const atTime = (now: number) => {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new ProfessionalTaskError('任务执行时间无效', 'TASK_SESSION_TIME_INVALID');
  return new Date(now).toISOString();
};
const due = (task: ProfessionalTask, scope: ProfessionalTaskStep[], now: number) => !!openSession(task)
  || !scope.find(professionalTaskStepPending)?.scheduledDate
  || scope.find(professionalTaskStepPending)!.scheduledDate! <= professionalTaskToday(now);

export function professionalTaskSessionView(task: ProfessionalTask, now = Date.now()): ProfessionalTaskSessionView | undefined {
  task=projectProfessionalTaskExpiry(task,now);
  const kind = professionalTaskSessionKind(task);
  if (!kind) return undefined;
  const scope = professionalTaskSessionScope(task, now), active = openSession(task);
  const scopeIds=new Set(scope.map(step=>step.id));
  const session = active || currentSessions(task).filter(item=>scopeIds.size?item.stepIds.some(id=>scopeIds.has(id)):['completed','skipped','cancelled'].includes(task.status)).at(-1);
  const status = session?.status || 'idle';
  const hasWork = scope.some(professionalTaskStepPending), isDue = due(task, scope, now);
  const reason = task.status === 'skipped' ? '任务已按日跳过' : task.status === 'cancelled' ? '任务已取消' : task.status === 'paused' ? '请先继续任务'
    : !hasWork ? '任务已完成' : !isDue ? (kind === 'training' ? '尚未到训练日' : '尚未到做饭日') : undefined;
  return {kind, label: kind === 'training' ? '训练时长' : '做饭时长', startLabel: kind === 'training' ? '开始训练' : '开始做饭',
    status, canStart: task.status === 'active' && hasWork && isDue && status !== 'running',
    displayText: status === 'skipped' ? '已跳过' : status === 'running' ? (kind === 'training' ? '训练中' : '做饭中') : status === 'idle' ? '未记录' : '',
    ...(reason ? {reason} : {}), ...(session ? {session} : {}), ...(session && session.status !== 'running' ? {elapsedMs:savedElapsed(session)} : {})};
}

function changeStatus(session: ProfessionalTaskExecutionSession, status: 'paused' | 'completed' | 'cancelled' | 'skipped', now: number) {
  if (session.status === status) return false;
  session.elapsedMs = professionalTaskSessionElapsedMs(session, now);
  session.status = status; session.updatedAt = atTime(now);
  if (status === 'paused') delete session.finishedAt;
  else session.finishedAt = session.updatedAt;
  return true;
}

/** A day boundary ends only an actually started session, without completing it. */
export function skipProfessionalTaskSession(session:ProfessionalTaskExecutionSession,now:number):boolean {
  if(!['running','paused'].includes(session.status))return false;
  const changed=changeStatus(session,'skipped',now);session.skipReason='day-ended';return changed;
}

/** Freeze helpers are part of another task mutation and never increment its revision. */
export function freezeProfessionalTaskSessions(task: ProfessionalTask, status: 'paused' | 'cancelled', now = Date.now()) {
  let changed = false;
  for (const session of task.executionSessions || []) {
    if (session.status === 'running' || (status === 'cancelled' && session.status === 'paused'))
      changed = changeStatus(session, status, now) || changed;
  }
  return changed;
}

/** Complete only this session's bound group. Undo retains elapsed time and requires a click. */
export function reconcileProfessionalTaskSessions(task: ProfessionalTask, now = Date.now()) {
  let changed = false;
  for (const session of currentSessions(task)) {
    if (session.status === 'cancelled'||session.status==='skipped') continue;
    const scoped = session.stepIds.map(id => task.steps.find(step => step.id === id));
    for (const snapshot of session.steps) {
      const step = task.steps.find(row => row.id === snapshot.id);
      if (!step || snapshot.completedAt === step.completedAt) continue;
      if (step.completedAt) snapshot.completedAt = step.completedAt;
      else delete snapshot.completedAt;
      changed = true;
    }
    if (scoped.some(step => !step)) {
      if (session.status === 'running' || session.status === 'paused') changed = changeStatus(session, 'cancelled', now) || changed;
      continue;
    }
    if (scoped.length && scoped.every(step => !!step!.completedAt)) {
      if (session.status === 'running' || session.status === 'paused') changed = changeStatus(session, 'completed', now) || changed;
    } else if (session.status === 'completed') changed = changeStatus(session, 'paused', now) || changed;
  }
  return changed;
}

/** Explicit starts are idempotent. Task resume alone never restarts this session. */
export function mutateProfessionalTaskSession(task: ProfessionalTask, operation: ProfessionalTaskSessionOperation, expectedRevision: number, now = Date.now()) {
  reconcileProfessionalTaskExpiry(task,now);
  if(task.status==='skipped')throw new ProfessionalTaskError('该任务已按日跳过，请明确创建新的执行任务','TASK_SKIPPED',409);
  if (expectedRevision !== task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试', 'TASK_REVISION_CONFLICT', 409);
  if (operation !== 'start' && operation !== 'pause') throw new ProfessionalTaskError('无效执行计时操作', 'TASK_SESSION_OPERATION_INVALID');
  const at = atTime(now);
  let changed = false;
  if (operation === 'pause') changed = freezeProfessionalTaskSessions(task, 'paused', now);
  else {
    const kind = professionalTaskSessionKind(task);
    if (!kind) throw new ProfessionalTaskError('此任务不记录训练或做饭时长', 'TASK_SESSION_UNAVAILABLE');
    if (task.status === 'cancelled' || task.status === 'completed') throw new ProfessionalTaskError('任务已结束', 'TASK_SESSION_ENDED');
    if (task.status !== 'active') throw new ProfessionalTaskError('请先继续任务', 'TASK_SESSION_PAUSED');
    const session = openSession(task), scope = professionalTaskSessionScope(task, now);
    if (!scope.some(professionalTaskStepPending)) throw new ProfessionalTaskError('本次任务步骤已完成', 'TASK_SESSION_ENDED');
    if (!due(task, scope, now)) throw new ProfessionalTaskError(kind === 'training' ? '尚未到训练日' : '尚未到做饭日', 'TASK_SESSION_NOT_DUE');
    if (session?.status === 'running') return false;
    if (session?.status === 'paused') {
      session.status = 'running'; session.updatedAt = at; delete session.finishedAt; changed = true;
    } else {
      (task.executionSessions ||= []).push({id:crypto.randomUUID(), kind, date:professionalTaskToday(now), stepIds:scope.map(step => step.id),
        planVersion:planVersion(task), taskTitle:task.title, steps:scope.map(step => ({id:step.id,title:step.title,...(step.completedAt ? {completedAt:step.completedAt} : {})})),
        status:'running', startedAt:at, updatedAt:at, elapsedMs:0});
      changed = true;
    }
  }
  if (changed) {task.updatedAt = at; task.revision++;}
  return changed;
}

/** A confirmed cooking finish affects only the session captured when its dialog opened. */
export function completeProfessionalTaskSession(task: ProfessionalTask, expectedSessionId: string, expectedRevision: number, now = Date.now()) {
  reconcileProfessionalTaskExpiry(task,now);
  if(task.status==='skipped'||task.executionSessions?.some(session=>session.id===expectedSessionId&&session.status==='skipped'))
    throw new ProfessionalTaskError('本次任务已按日跳过，不能继续或补记完成','TASK_SKIPPED',409);
  if (expectedRevision !== task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试', 'TASK_REVISION_CONFLICT', 409);
  const at = atTime(now);
  if (professionalTaskSessionKind(task) !== 'cooking') throw new ProfessionalTaskError('此任务不支持一次完成做饭步骤', 'TASK_SESSION_COMPLETE_UNAVAILABLE');
  if (task.status === 'cancelled' || task.status === 'completed') throw new ProfessionalTaskError('任务已结束', 'TASK_SESSION_ENDED');
  if (task.status !== 'active') throw new ProfessionalTaskError('请先继续任务', 'TASK_SESSION_PAUSED');
  const session = openSession(task);
  if (!expectedSessionId || !session || session.id !== expectedSessionId)
    throw new ProfessionalTaskError('本次做饭已变化，请重新打开确认', 'TASK_SESSION_CONFLICT', 409);
  if (session.kind !== 'cooking') throw new ProfessionalTaskError('此任务不支持一次完成做饭步骤', 'TASK_SESSION_COMPLETE_UNAVAILABLE');
  if (session.status !== 'running') throw new ProfessionalTaskError('请先继续做饭', 'TASK_SESSION_PAUSED');
  const steps = session.stepIds.map(id => task.steps.find(step => step.id === id));
  if (!steps.length || new Set(session.stepIds).size !== session.stepIds.length || steps.some(step => !step||!!step.skippedAt))
    throw new ProfessionalTaskError('本次做饭步骤已变化，请同步后重试', 'TASK_SESSION_CONFLICT', 409);
  // Finish validation before changing any timestamp, timer or session snapshot.
  for (const step of steps) {
    step!.completedAt ||= at;
    freezeProfessionalTaskStepTimer(step!, now);
  }
  reconcileProfessionalTaskSessions(task, now);
  task.status = task.steps.every(step => !!step.completedAt) ? 'completed' : 'active';
  task.updatedAt = at; task.revision++;
  reconcileProfessionalTaskExpiry(task,now);
  return true;
}
