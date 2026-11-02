import { ProfessionalTaskError, type ProfessionalTask, type ProfessionalTaskStep } from './professional-task';
import { reconcileProfessionalTaskExpiry } from './professional-task-expiry';

export type ProfessionalTaskTimerOperation = 'start' | 'pause' | 'resume';
export type ProfessionalTaskTimerView = {
  status: 'idle' | 'running' | 'paused' | 'elapsed'; remainingSeconds: number;
  /** Fraction of the configured duration that has passed, in [0, 1]. */
  progress: number; showTimer: boolean;
  kind?: 'rest'; completedCycles?: number; maxCycles?: number; canRestart?: boolean;
};

const cleanLine = (value: string) => value.trim().replace(/^(?:[•·●]|[-*]\s)\s*/, '').trim();
const unique = (values: string[]) => [...new Set(values.map(cleanLine).filter(Boolean))];
const notePrefix = /^(?:注意事项|注意|提醒|小心|要点)\s*[：:]\s*/;
// These are explicit caution forms in old recipes, not a general classifier.
const legacyCautionStart = /^(?:先不额外|切勿|避免|注意(?:事项)?)/;
const completionPrefix = /^(?:完成状态|完成标准|完成判断|完成条件|完成标志|判断标准)\s*[：:]\s*/;
const actionPrefix = /^(?:必须操作|具体操作|操作步骤|操作|做法)\s*[：:]\s*/;
const legacyActionStart = /^(?:放|入锅|下锅|开盖|搅|拌|翻|倒|捞|盛|装|切|洗|沥|擦|关|取|加|再|然后|接着|先|最后)/;
const stripPrefix = (line:string,prefix:RegExp) => {
  let content=line;
  while (prefix.test(content)) content=content.replace(prefix,'');
  return content;
};

/** Display old recipes without inventing a semantic classification or losing text. */
export function professionalTaskStepContent(step: ProfessionalTaskStep) {
  const instructions = unique((step.instructions || []).flatMap(value => value.split('\n'))).map(line => stripPrefix(line,actionPrefix));
  const structuredInstructions = instructions.length > 0;
  const notes = unique((step.notes || []).flatMap(value => value.split('\n'))).map(line => stripPrefix(line,notePrefix));
  const completions = step.completionCondition ? unique(step.completionCondition.split('\n')).map(line=>stripPrefix(line,completionPrefix)) : [];
  for (const raw of step.details || []) for (const line of raw.split('\n').map(cleanLine).filter(Boolean)) {
    if (notePrefix.test(line)) notes.push(stripPrefix(line,notePrefix));
    else if (completionPrefix.test(line)) {
      const content=stripPrefix(line,completionPrefix);
      // Structured completion text is authoritative and appears again in the
      // compatibility details; never reinterpret its second sentence as action.
      if (completions.includes(content)) continue;
      const sentences=/^([^。！？!?]*[。！？!?])\s*([\s\S]+)$/.exec(content);
      const tail=sentences?.[2].trim();
      if (sentences && tail && (legacyActionStart.test(tail) || legacyCautionStart.test(tail))) {
        completions.push(sentences[1]);
        if (legacyCautionStart.test(tail)) notes.push(tail);
        else if (!structuredInstructions) instructions.push(tail);
      } else completions.push(content);
    }
    else if (!structuredInstructions && legacyCautionStart.test(line)) notes.push(line);
    else {
      const content = stripPrefix(line,actionPrefix);
      if (!structuredInstructions && !notes.includes(content) && !completions.includes(content)) instructions.push(content);
    }
  }
  const completionCondition = unique(completions).join('\n');
  return {instructions:unique(instructions),notes:unique(notes),...(completionCondition ? {completionCondition} : {})};
}

const oneShotDurationMs = (step: ProfessionalTaskStep) => Number.isSafeInteger(step.durationSeconds)
  && Number(step.durationSeconds) >= 120 && Number(step.durationSeconds) <= 86_400 ? Number(step.durationSeconds) * 1000 : 0;
const restTimer = (step: ProfessionalTaskStep) => {
  // A persisted historical timer retains its original duration and meaning.
  // New training timers derive rest directly, never rewriting action duration.
  if (step.timer && step.timer.kind !== 'rest') return false;
  return Number.isSafeInteger(step.training?.sets) && Number(step.training?.sets) > 1
    && Number.isSafeInteger(step.training?.restSeconds) && Number(step.training?.restSeconds) > 0
    && Number(step.training?.restSeconds) <= 1800;
};
const durationMs = (step: ProfessionalTaskStep) => restTimer(step) ? Number(step.training!.restSeconds) * 1000 : oneShotDurationMs(step);
const timerRemainingMs = (step: ProfessionalTaskStep, now: number) => {
  const duration = durationMs(step), timer = step.timer;
  if (!timer) return duration;
  const saved = Number.isFinite(timer.remainingMs) ? Math.min(duration, Math.max(0, timer.remainingMs)) : duration;
  if (timer.status === 'elapsed') return 0;
  const start = Date.parse(timer.startedAt || '');
  // Tick cadence, window visibility, refresh and restart cannot extend a timer.
  return timer.status === 'running' && Number.isFinite(start) ? Math.max(0, saved - Math.max(0, now - start)) : saved;
};
const restCycleState = (step: ProfessionalTaskStep, now: number) => {
  const maxCycles = Number(step.training!.sets) - 1;
  const saved = Number.isSafeInteger(step.timer?.completedCycles) ? Number(step.timer!.completedCycles) : 0;
  // Expiry is calculated from the anchor on reads, so refresh/background time
  // counts this cycle exactly once without requiring a ticking server write.
  const expired = !!step.timer && step.timer.status !== 'elapsed' && timerRemainingMs(step, now) <= 0;
  const completedCycles = Math.min(maxCycles, Math.max(0, saved) + Number(expired));
  return {kind:'rest' as const,completedCycles,maxCycles,canRestart:!!step.timer && timerRemainingMs(step, now) <= 0 && completedCycles < maxCycles};
};

export function professionalTaskTimerView(step: ProfessionalTaskStep, now = Date.now()): ProfessionalTaskTimerView {
  const skippedAt=Date.parse(step.skippedAt||'');
  if(Number.isFinite(skippedAt))now=Math.min(now,skippedAt);
  const duration = durationMs(step);
  if (!duration) return {status:'idle',remainingSeconds:0,progress:0,showTimer:false};
  const remaining = timerRemainingMs(step, now);
  const status = !step.timer ? 'idle' : remaining <= 0 ? 'elapsed' : step.timer.status;
  return {status,remainingSeconds:Math.ceil(remaining / 1000),progress:Math.min(1,Math.max(0,1 - remaining / duration)),showTimer:true,
    ...(restTimer(step) ? {...restCycleState(step,now),...(step.skippedAt?{canRestart:false}:{})} : {})};
}

/** Task pause/end and completion freeze elapsed wall time; undo never auto-starts. */
export function freezeProfessionalTaskStepTimer(step: ProfessionalTaskStep, now = Date.now()) {
  if (step.timer?.status !== 'running') return false;
  const remainingMs = timerRemainingMs(step, now);
  const cycles=restTimer(step) ? restCycleState(step,now) : undefined;
  step.timer = {status:remainingMs > 0 ? 'paused' : 'elapsed',remainingMs,updatedAt:new Date(now).toISOString(),
    ...(cycles ? {kind:cycles.kind,completedCycles:cycles.completedCycles} : {})};
  return true;
}
export function freezeProfessionalTaskTimers(task: ProfessionalTask, now = Date.now()) {
  let changed = false;
  for (const step of task.steps) if (freezeProfessionalTaskStepTimer(step, now)) changed = true;
  return changed;
}

/** Timers are user operations. They never complete a step or generate chat/memory. */
export function mutateProfessionalTaskTimer(task: ProfessionalTask, stepId: string, operation: ProfessionalTaskTimerOperation, expectedRevision: number, now = Date.now()) {
  reconcileProfessionalTaskExpiry(task,now);
  const step = task.steps.find(candidate => candidate.id === stepId);
  if (!step) throw new ProfessionalTaskError('步骤不存在','TASK_NOT_FOUND',404);
  if(task.status==='skipped'||step.skippedAt)throw new ProfessionalTaskError('已跳过的任务或步骤不能继续计时','TASK_SKIPPED',409);
  if (expectedRevision !== task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试','TASK_REVISION_CONFLICT',409);
  if (!durationMs(step)) throw new ProfessionalTaskError('此步骤不需要计时','TASK_TIMER_UNAVAILABLE');
  if (task.status === 'cancelled' || task.status === 'completed' || step.completedAt)
    throw new ProfessionalTaskError('已结束的步骤不能开始计时','TASK_TIMER_ENDED');
  if (operation !== 'pause' && task.status !== 'active') throw new ProfessionalTaskError('请先继续任务','TASK_TIMER_PAUSED');
  let changed = false;
  const at = new Date(now).toISOString();
  const cycles=restTimer(step) ? restCycleState(step,now) : undefined;
  if (operation === 'start') {
    // A new rest cycle is a fresh user click after expiry, bounded by sets - 1.
    // Retrying a running/paused timer never resets it, and pots remain one-shot.
    if (cycles && step.timer && timerRemainingMs(step,now)<=0 && cycles.completedCycles>=cycles.maxCycles)
      throw new ProfessionalTaskError('本动作的组间休息已全部完成','TASK_TIMER_EXHAUSTED');
    if (!step.timer || cycles?.canRestart) {
      step.timer={status:'running',remainingMs:durationMs(step),startedAt:at,updatedAt:at,
        ...(cycles ? {kind:cycles.kind,completedCycles:cycles.completedCycles} : {})};changed=true;
    }
  } else if (operation === 'pause') changed = freezeProfessionalTaskStepTimer(step, now);
  else if (operation === 'resume') {
    if (step.timer?.status === 'paused') {
      const remainingMs=timerRemainingMs(step,now);
      step.timer={status:remainingMs > 0 ? 'running' : 'elapsed',remainingMs,...(remainingMs > 0 ? {startedAt:at} : {}),updatedAt:at,
        ...(cycles ? {kind:cycles.kind,completedCycles:cycles.completedCycles} : {})};changed=true;
    }
  } else throw new ProfessionalTaskError('无效计时操作');
  if (changed) {task.updatedAt=at;task.revision++;}
  return changed;
}
