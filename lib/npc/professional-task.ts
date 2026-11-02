import { freezeProfessionalTaskStepTimer, freezeProfessionalTaskTimers } from './professional-task-timer';
import { freezeProfessionalTaskSessions, reconcileProfessionalTaskSessions } from './professional-task-session';
import { professionalTaskStepDate, professionalTaskStepDayEnded, professionalTaskStepPending, reconcileProfessionalTaskExpiry, reconcileProfessionalTasksExpiry } from './professional-task-expiry';

/** A professional task is persisted independently of the chat card that points to it. */
export type ProfessionalTaskCharacterId = 'zhou-chef' | 'chen-nian' | 'liu';
export type ProfessionalTaskStepCategory = 'preparation' | 'main' | 'accessory' | 'finishing';
export type ProfessionalTaskTraining = {
  target: string; sets: number; reps: string; restSeconds?: number;
  effort?: string; recommendation?: string;
  /** Optional version identity. The renderer still requires an exact compatible title. */
  exerciseId?: string;
};
export type ProfessionalTaskStepContent = {
  id?: string; title: string; details: string[]; instructions?: string[];
  notes?: string[]; completionCondition?: string; durationSeconds?: number;
  scheduledDate?: string; category?: ProfessionalTaskStepCategory;
  training?: ProfessionalTaskTraining;
};
export type ProfessionalTaskHint = {
  id: string; eventId: string; stepId: string; text: string; at: string; messageIds: string[];
};
export type ProfessionalTaskStep = {
  id: string; title: string; details: string[]; completedAt?: string;
  skippedAt?:string; skipReason?:'day-ended';
  instructions?: string[]; notes?: string[]; completionCondition?: string;
  durationSeconds?: number; timer?: ProfessionalTaskTimer;
  scheduledDate?: string; category?: ProfessionalTaskStepCategory; training?: ProfessionalTaskTraining;
  hints: ProfessionalTaskHint[];
};
export type ProfessionalTaskTimer = {
  status: 'running' | 'paused' | 'elapsed'; remainingMs: number;
  startedAt?: string; updatedAt: string;
  /** Missing kind is the historical one-shot operation timer. */
  kind?: 'rest'; completedCycles?: number;
};
export type ProfessionalTaskExecutionSession = {
  id: string; kind: 'training' | 'cooking';
  /** Actual first start date in Shanghai, independent of planned dates. */
  date: string; stepIds: string[]; planVersion: number;
  taskTitle: string; steps: { id: string; title: string; completedAt?: string;skippedAt?:string;skipReason?:'day-ended' }[];
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'skipped';
  skipReason?:'day-ended';
  /** First start is retained on resume; updatedAt anchors the current running segment. */
  startedAt: string; updatedAt: string; elapsedMs: number; finishedAt?: string;
};
export type ProfessionalTask = {
  id: string; characterId: ProfessionalTaskCharacterId; title: string; goalKey: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'skipped';
  skippedAt?:string;skipReason?:'day-ended';
  /** The real delegation day for undated work; save time stays in createdAt. */
  assignedDate?:string;
  createdAt: string; updatedAt: string; revision: number;
  sourceMessageId: string; cardMessageId: string; steps: ProfessionalTaskStep[];
  /** Extra chat appearances keep their own IDs without replacing the first card. */
  cardMessageIds?: string[];
  referenceTaskId?: string; referenceCardMessageId?: string;
  /** Current request and optional recent user context keep separate provenance. */
  contextMessageId?: string; delegationSourceMessageIds?: string[];
  /** Previous recipes survive a user-requested change of dish or method. */
  previousPlans?: { at: string; title: string; goalKey: string; steps: ProfessionalTaskStep[] }[];
  /** Only explicit starts create execution history; old tasks have no fabricated duration. */
  executionSessions?: ProfessionalTaskExecutionSession[];
};
export type ProfessionalTaskEvent = {
  id: string; taskId: string; revision: number; at: string;
  kind: 'step_completed'; completedStepId: string; nextStepId?: string;
  error?: string;
};
export type ProfessionalTaskSource = {
  id: string; text: string; at?: string;
  /** Verified by the server against the owner's actual source conversation. */
  secretaryDelegation?: { id: string; sourceConversationId: string; sourceMessageId: string; targetId: string; goal: string };
  /** Derived from a visible, delivered card in this account, never from model output. */
  taskReference?: { taskId: string; cardMessageId: string; goalKey: string };
  /** Server-verified selection of a visible clarification after this user's request. */
  taskClarification?: { questionMessageId: string; requestMessageId: string };
};
export type ProfessionalTaskOperation =
  | { decision: 'none' }
  | {
      decision: 'pause' | 'cancel' | 'resume'; taskId: string;
      sourceMessageId: string; evidence: string; confidence: number;
      scope: 'current_user'; polarity: 'affirmed'; basis: 'existing_task_change';
    }
  | {
      decision: 'create' | 'update'; basis: 'explicit_request' | 'execution_commitment' | 'accepted_plan' | 'existing_task_change';
      confidence: number; scope: 'current_user'; polarity: 'affirmed'; readiness: 'ready';
      sourceMessageId: string; evidence: string; planMessageId?: string; contextMessageId?: string;
      taskId?: string; title: string; goalKey: string; newInstance?: boolean;
      steps: ProfessionalTaskStepContent[];
    };

export class ProfessionalTaskError extends Error {
  constructor(message: string, public code = 'INVALID_TASK', public status = 400) {
    super(message); this.name = 'ProfessionalTaskError';
  }
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : '';
export const normalizeTaskGoal = (goal: string) => goal.toLocaleLowerCase().replace(/[\s，。！？、:：;；“”"'「」『』]/g, '');

/** Explicit bounded planning delegates a dated task, even without saying “任务”. */
export function taskSourceRequestsDatedExecution(text: string) {
  const s=text.trim();
  if (!s || taskCreationRefused(s) || /[?？]|(?:怎么|怎样|如何|为什么|是不是|要不要|能不能|可能|也许|想|希望|如果|假如|假设|比如|例如)|(?:吗|么)[。！!\s]*$|(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)|[“”"「」『』]/.test(s)) return false;
  return /^(?:(?:请|帮我|给我|替我|你来|那就|就|我准备|我决定|我打算|我要|我|安排|规划)\s*)*(?:明天|后天|今天|今晚|周[一二三四五六日天]|下周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号])(?:早上|上午|下午|晚上|中午)?\s*(?:去健身房)?(?:练|训练|做|煮|炒|烤|炖|蒸|煎)[^，。！？?\n]{1,40}[。！!\s]*$/.test(s);
}

export function taskSourceRequestsScheduledPlan(text: string) {
  const s=text.trim();
  if (taskSourceRequestsDatedExecution(s)) return true;
  if (!s || taskCreationRefused(s)
    || /(?:怎么|怎样|如何|为什么|是什么|如果|假如|假设|要是|比如|例如)|(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)|[“”"「」『』]/.test(s)) return false;
  const boundedPeriod=/(?:未来|接下来|今后|后面)\s*[一二三四五六七八九十两\d]+\s*(?:天|日|周)|(?:未来|接下来)?(?:一周|这周|本周|下周)|(?:明天|后天|\d{1,2}月\d{1,2}[日号])(?:起|开始|到|至)/;
  return boundedPeriod.test(s) && /(?:给我|帮我|替我|请你|你来|你帮我).{0,20}(?:规划|安排|计划|制定)|(?:规划|安排|制定).{0,25}(?:给我|发我|发给我)/.test(s);
}

/** Conservative transport guard; the main model still judges meaning in context. */
export function taskSourceAllowsCreation(text: string, basis: Exclude<ProfessionalTaskOperation, {decision:'none'}>['basis']) {
  const s = text.trim();
  if (!s || taskCreationRefused(s) || /(?:别|不要|不用|不必|无需).{0,5}(?:给我)?(?:建|创建|发|弄|做成|列成|安排).{0,5}任务|(?:不想|不打算|还没决定)(?:现在)?(?:做|煮|炒|烤)|(?:取消|撤掉|删掉).{0,5}任务/.test(s)) return false;
  // Quoted demands, other people's demands and hypotheticals are not the user's delegation.
  if (/^(?:如果|假如|假设|比如|例如)|(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)|[“"「『][^”"」』]*(?:任务|我要做)[^”"」』]*[”"」』]/.test(s)) return false;
  if (basis === 'explicit_request')
    return taskSourceRequestsScheduledPlan(s) || /(?:给我|帮我|替我|你来|请|把.{1,70})(?:.{0,12})(?:任务|清单)|我(?:想要|要|需要)(?:一个|一份|个|份)?[^，。！？?\n]{0,30}(?:任务|清单)|(?:发|交|开|建|创建|做成|列成|生成|安排|拆成).{0,8}(?:任务|清单)|(?:带我|带着我|陪我|跟着你).{0,12}(?:做|煮|炒|烤|练|训练|一步)|一步一步.{0,10}(?:带|教|做)|(?:帮我|替我|你帮我).{0,18}(?:安排|列|拆).{0,15}步骤/.test(s);
  if (basis === 'accepted_plan')
    return !/[?？]|(?:不|别|不要|只是|如果|假如)/.test(s) && /^(?:好|行|可以|嗯|就|那就|按|照|开始).{0,50}$/.test(s);
  // A wish, ingredient report or knowledge question is deliberately insufficient.
  if (/(?:怎么|怎样|如何|为什么|好吃吗|是什么|介绍|了解|只是问|随便问|有点想|想吃|改天|有空|以后|哪天)/.test(s)) return false;
  return taskSourceRequestsDatedExecution(s) || /(?:我|现在|今天|今晚|明天|周末|马上|这就).{0,15}(?:要|准备|决定|打算|就|开始|重新|再).{0,6}(?:做|煮|炒|烤|炸|炖|蒸|煎|练|执行)|(?:我|现在).{0,8}(?:已经|正在).{0,6}(?:做|煮|炒|烤|练|训练|开始)|我现在(?:也)?(?:做|煮|炒|烤|练|训练)/.test(s);
}

function taskEvidenceContext(source: ProfessionalTaskSource, evidence: string) {
  const start = source.text.indexOf(evidence), end = start + evidence.length;
  for (const quote of source.text.matchAll(/[“"「『][^”"」』]*[”"」』]/g))
    if (quote.index! < end && quote.index! + quote[0].length > start && /(?:我要|我准备|给我|任务|取消|暂停|继续|帮我)/.test(quote[0]))
      throw new ProfessionalTaskError('引用中的话不是当前用户委托','TASK_INTENT_REJECTED');
  const clauses = [...source.text.matchAll(/[^，,。！？!?；;\n]+[，,。！？!?；;\n]?/g)];
  const context = clauses.filter(row => row.index! < end && row.index! + row[0].length > start).map(row => row[0]).join('');
  const preceding = source.text.slice(0,start);
  if (/(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)/.test(context)
    && !/(?:但是|但我|而我|不过我|我现在|我今天|我今晚|我决定)/.test(context))
    throw new ProfessionalTaskError('转述别人的需求不是当前用户委托','TASK_INTENT_REJECTED');
  if (/^(?:如果|假如|假设|要是|比如)/.test(context.trim()) && !/(?:但是|但我|而我|不过我|我现在|我今天|我今晚|我决定)/.test(context))
    throw new ProfessionalTaskError('假设不是实际执行委托','TASK_INTENT_REJECTED');
  if (/(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)/.test(preceding)
    && !/(?:但是|但我|而我|不过我|我现在|我今天|我今晚|我决定)/.test(context))
    throw new ProfessionalTaskError('转述别人的需求不是当前用户委托','TASK_INTENT_REJECTED');
  if (/(?:如果|假如|假设|要是)/.test(preceding) && !/(?:但是|但我|而我|不过我|我现在|我今天|我今晚|我决定)/.test(context))
    throw new ProfessionalTaskError('假设不是实际执行委托','TASK_INTENT_REJECTED');
  return context || source.text;
}

/** A short adjacent correction changes interpretation, never the stored quotation. */
export function resolveTaskSource(sources: ProfessionalTaskSource[], sourceMessageId: string) {
  const index = sources.findIndex(row => row.id === sourceMessageId), source = sources[index];
  if (!source) return undefined;
  const previous = sources[index - 1];
  if (previous && (!previous.at || !source.at || (Date.parse(source.at) >= Date.parse(previous.at) && Date.parse(source.at) - Date.parse(previous.at) <= 60_000))
    && /^(?:任务|是任务|我是说任务)[。！!\s]*$/.test(source.text.trim())
    && /^我(?:想要|要|需要)(?:一个|一份|个|份)?人物[。！!\s]*$/.test(previous.text.trim()))
    return { text: previous.text.replace(/人物/, '任务'), sourceMessageIds: [previous.id, source.id] };
  return { text: source.text, sourceMessageIds: [source.id] };
}

function taskCreationRefused(text: string) {
  return /(?:不要|别|不必|不用|无需)(?:给我|帮我|发我|发给我|一个|一份)[^，,。！？!?；;\n]{0,40}(?:任务|清单)/.test(text)
    || /(?:不要|别|不必|不用|无需|不).{0,8}(?:创建|建立|建|发|安排|生成|做成|列成).{0,5}任务|(?:不要|不用|别).{0,5}任务|(?:先别|先不|不要|不用|别).{0,5}(?:创建|建立|生成|重新发|重发|再发)|(?:先不做|不做了|先不练|不练了|取消|暂停)|(?:只|直接).{0,8}(?:文字|文本)|(?:只是|只想|仅仅).{0,8}(?:问|了解|看看)|(?:已经|刚|早就).{0,12}(?:做完|做好|完成|吃完)|(?:昨天|前天).{0,12}(?:做过|做了)|(?:改天|有空|以后|哪天)|^(?:算了|不用了|不要了|别发了|不要发了)[。！!，,\s]*$/.test(text);
}

/** The card supplies a target; only a fresh request authorizes delivery or a new instance. */
export function taskSourceResendMode(text: string): 'same' | 'new' | undefined {
  const s = text.trim();
  if (!s || taskCreationRefused(s)
    || /(?:如果|假如|假设|要是|比如|例如|怎么|如何|为什么|什么意思|是什么)|(?:朋友|同事|妈妈|爸爸|别人|他|她).{0,8}(?:说|让我|要我)|[“”"「」『』]/.test(s)
    || /(?:不要|别|不用|不必|无需|先不|先别)[^，,。！？!?；;\n]{0,16}(?:发|开|建|做|给)/.test(s)) return undefined;
  const action = /(?:重新|再|重)(?:发|给我)|(?:重新|再|另)(?:开|建|做|来).{0,12}(?:任务|一份|一个|一次)|(?:给我|发我|发给我).{0,12}(?:一份新的|新的一份|新的任务|新任务)|(?:新的一份|一份新的).{0,12}(?:给我|发我|发给我)/;
  const requestClauses = s.split(/[，,。！？!?；;\n]/).filter(clause => {
    const request = clause.trim().replace(/^(?:(?:请|麻烦你|麻烦|你帮我|帮我|你|好[的吧]?|那就|那)\s*)+/, '');
    return action.test(request) && !/(?:发给我的|发我的|给我的).{0,20}(?:任务|那|这|一份)|^(?:上次|之前|刚才|昨天|前天).{0,12}(?:重新|再|重)发/.test(request)
      && /^(?:重新(?:发|给我|开|建|做)|重发|再(?:发|给我|开|建|做|来)|另(?:开|建)|(?:给我|发我|发给我).{0,12}(?:一份新的|新的一份|新的任务|新任务)|(?:新的一份|一份新的).{0,12}(?:给我|发我|发给我)|把.{0,60}(?:重新|再|重)(?:发|开|建|做)|(?:这(?:个|份)(?:任务|卡片)?|刚才那(?:个|份)(?:任务|卡片)?).{0,8}(?:重新|再|重)发)/.test(request);
  });
  if (!requestClauses.length) return undefined;
  return requestClauses.some(clause => /(?:一份新的|一个新的|一次新的|新的(?:一份|一个|一次|任务)|新一份|新任务|另开|另建|另外一份|另一份|另一个|重新开|重新建|重新做|再做一次|再开|再建|再来一份)|(?:发|给我).{0,3}新的(?:给我|发我|发给我|$)/.test(clause)) ? 'new' : 'same';
}

/** Delivery preference can continue execution, but cannot establish it by itself. */
export function taskSourceContinuesExecution(text: string) {
  const s = text.trim();
  if (taskCreationRefused(s) || /[?？]|(?:怎么|怎样|如何|为什么|如果|假如|假设|要是|比如|朋友|同事|别人|他说|她说)|[“”"「」『』]/.test(s)) return false;
  return /^(?:好[的吧]?[，,\s]*|那[，,\s]*|请|麻烦)?(?:给我|发我|发给我|帮我列|我要).{0,20}(?:全部|完整|全套|所有).{0,12}(?:流程|步骤|做法)/.test(s)
    || /^(?:请|麻烦)?把.{0,20}(?:全部|完整|全套|所有).{0,12}(?:流程|步骤|做法).{0,12}(?:发给我|给我|发我)/.test(s)
    || /^我(?:可以|能)?自己(?:看|照着做|看着做)[。！!\s]*$/.test(s);
}

/** A selection answers a condition; its verified original request supplies the delegation. */
export function taskSourceClarifiesDelegation(source: ProfessionalTaskSource, request: ProfessionalTaskSource) {
  const explicitRequest = taskSourceAllowsCreation(request.text, 'explicit_request')
    && request.text.split(/[，,。！？!?；;\n]/).some(clause => taskSourceAllowsCreation(clause, 'explicit_request')
      && !/(?:讲|介绍|解释|科普|比较|对比|分析).{0,40}(?:任务|训练|健身|做法|流程)|(?:任务|训练|健身|做法|流程).{0,16}(?:怎么|怎样|如何|为什么|是什么|什么意思)/.test(clause));
  return source.taskClarification?.requestMessageId === request.id
    && !!string(source.taskClarification.questionMessageId, 160)
    && !taskCreationRefused(source.text)
    && (explicitRequest || taskSourceAllowsCreation(request.text, 'execution_commitment') || taskSourceIsSecretaryRequest(request));
}

/** Only application-created, source-verified handoffs supply this metadata. */
export function taskSourceIsSecretaryRequest(source: ProfessionalTaskSource) {
  const delegation = source.secretaryDelegation;
  return !!delegation && delegation.sourceMessageId === source.id && !!delegation.id && !!delegation.goal
    && ['zhou-chef', 'chen-nian', 'liu'].includes(delegation.targetId)
    && !taskCreationRefused(source.text)
    && !/^(?:如果|假如|假设|比如|例如)|(?:朋友|同事|别人|他|她).{0,8}(?:说|让我|要我)/.test(source.text)
    && /(?:找|让|叫|通知|转|交给|安排|规划|制定|准备|计划|任务|教我|带我|我要|我想要|帮我)/.test(source.text);
}

export function taskSourceIsDatedPlan(source: ProfessionalTaskSource) {
  return taskSourceRequestsScheduledPlan(source.text) || taskSourceIsSecretaryRequest(source)
    && /下周|这周|本周|一周|未来|接下来|\d{4}-\d{2}-\d{2}/.test(source.text + source.secretaryDelegation!.goal);
}

function taskSourceRequestsFlow(text: string) {
  return taskSourceContinuesExecution(text) && /(?:全部|完整|全套|所有).{0,12}(?:流程|步骤|做法)/.test(text);
}

function taskSourceChangesGoal(text: string, goal: string) {
  for (const change of text.matchAll(/(改做|改成|换成|换一道|刚才说错了)([^，,。！？!?；;\n]*)/g)) {
    const before = text.slice(0, change.index).split(/[，,。！？!?；;\n]/).at(-1) || '';
    // Ingredient substitutions are not necessarily a change of dish. For a
    // goal replacement, check what follows the verb, not the old dish it names.
    const changesDish = /改做|换一道|刚才说错了/.test(change[1])
      || normalizeTaskGoal(before).endsWith(goal)
      || /^(?:那|那就|我|现在|我现在|还是|请)?\s*$/.test(before);
    if (changesDish && !normalizeTaskGoal(change[2]).includes(goal)) return true;
  }
  return false;
}

/** An absent/none proposal is compatible with older models; malformed creation fails closed. */
export function parseProfessionalTaskOperation(raw: unknown): ProfessionalTaskOperation {
  if (raw === undefined || raw === null || record(raw).decision === 'none') return { decision: 'none' };
  const p = record(raw);
  if (['pause', 'cancel', 'resume'].includes(String(p.decision))) {
    if (p.basis !== 'existing_task_change' || p.scope !== 'current_user' || p.polarity !== 'affirmed'
      || typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < .9 || p.confidence > 1
      || !string(p.taskId,160) || !string(p.sourceMessageId,160) || !string(p.evidence,4000))
      throw new ProfessionalTaskError('任务状态委托无效');
    return {decision:p.decision as 'pause'|'cancel'|'resume',taskId:String(p.taskId),sourceMessageId:String(p.sourceMessageId),evidence:String(p.evidence),confidence:p.confidence,scope:'current_user',polarity:'affirmed',basis:'existing_task_change'};
  }
  if (!['create', 'update'].includes(String(p.decision))
    || !['explicit_request', 'execution_commitment', 'accepted_plan', 'existing_task_change'].includes(String(p.basis))
    || p.scope !== 'current_user' || p.polarity !== 'affirmed' || p.readiness !== 'ready'
    || typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < .9 || p.confidence > 1)
    throw new ProfessionalTaskError('任务委托判断未通过', 'TASK_INTENT_REJECTED');
  const sourceMessageId = string(p.sourceMessageId, 160), evidence = string(p.evidence, 4000);
  const title = string(p.title, 100), goalKey = string(p.goalKey, 100);
  if (!sourceMessageId || !evidence || !title || !goalKey || !Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 20)
    throw new ProfessionalTaskError('任务目标或步骤不完整');
  const steps = p.steps.map((rawStep, index) => {
    const typeOf = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const invalidContent = (path: string, value: unknown, message = '任务步骤内容无效'): never => {
      // Include only schema coordinates and types in persisted diagnostics.
      // A recipe or private conversation must never enter error logs.
      throw new ProfessionalTaskError(`${message}：steps[${index}]${path}（类型${typeOf(value)}）`, 'TASK_STEP_CONTENT_INVALID');
    };
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) invalidContent('', rawStep);
    const step = record(rawStep), title = string(step.title, 100);
    const list = (key: 'details' | 'instructions' | 'notes', limit: number) => {
      const input=step[key];
      if (input === undefined || input === null) return undefined;
      // A single textual paragraph/list is a recoverable shape difference.
      // Optional blank scalar text carries no content; arrays remain strict.
      const entries=typeof input === 'string' ? input.split(/\r\n?|\n/).filter(line=>line.trim()) : input;
      if (!Array.isArray(entries) || entries.length > limit) invalidContent(`.${key}`, input);
      const values = (entries as unknown[]).map((value, itemIndex) => {
        const content=string(value,1200);
        if (!content) invalidContent(`.${key}[${itemIndex}]`,value);
        return content;
      });
      return values;
    };
    const legacyDetails = list('details', 37), instructions = list('instructions', 12), notes = list('notes', 12);
    const completionCondition = step.completionCondition === undefined || step.completionCondition === null ? undefined : string(step.completionCondition, 1200);
    if (completionCondition === '') invalidContent('.completionCondition',step.completionCondition,'任务完成标准无效');
    if (!title) invalidContent('.title',step.title,'任务步骤缺少可操作内容');
    if (!legacyDetails?.length && !instructions?.length) invalidContent('.instructions',step.instructions,'任务步骤缺少可操作内容');
    // Older review/adapters still consume details. Keep every original entry and
    // append structured content once; structured-only recipes remain readable.
    const details = [...new Set([...(legacyDetails || []), ...(instructions || []),
      ...(notes || []).map(note => `注意：${note}`), ...(completionCondition ? [`完成状态：${completionCondition}`] : [])])];
    if (step.durationSeconds !== undefined && step.durationSeconds !== null && (!Number.isSafeInteger(step.durationSeconds) || Number(step.durationSeconds) <= 0 || Number(step.durationSeconds) > 86_400))
      invalidContent('.durationSeconds',step.durationSeconds,'任务计时时长无效');
    const durationSeconds = Number(step.durationSeconds) >= 120 ? Number(step.durationSeconds) : undefined;
    if (step.scheduledDate !== undefined && step.scheduledDate !== null && !isProfessionalTaskDate(step.scheduledDate))
      invalidContent('.scheduledDate',step.scheduledDate,'任务日期无效');
    if (step.category !== undefined && step.category !== null && (typeof step.category!=='string' || !['preparation','main','accessory','finishing'].includes(step.category)))
      invalidContent('.category',step.category,'任务步骤分类无效');
    let training: ProfessionalTaskTraining | undefined;
    if (step.training !== undefined && step.training !== null) {
      const value = record(step.training);
      if (!string(value.target,160) || !Number.isSafeInteger(value.sets) || Number(value.sets)<1 || Number(value.sets)>30 || !string(value.reps,160))
        invalidContent('.training',step.training,'训练部位或组次无效');
      if (value.restSeconds !== undefined && (!Number.isSafeInteger(value.restSeconds) || Number(value.restSeconds)<0 || Number(value.restSeconds)>1800))
        invalidContent('.training.restSeconds',value.restSeconds,'组间休息无效');
      for (const key of ['effort','recommendation'] as const)
        if (value[key] !== undefined && !string(value[key],1200)) invalidContent(`.training.${key}`,value[key],'训练说明无效');
      if (value.exerciseId!==undefined && (typeof value.exerciseId!=='string'||!/^[a-z][a-z0-9_]{0,79}$/.test(value.exerciseId)))
        invalidContent('.training.exerciseId',value.exerciseId,'训练动作标识无效');
      training = {target:string(value.target,160),sets:Number(value.sets),reps:string(value.reps,160),
        ...(value.restSeconds !== undefined ? {restSeconds:Number(value.restSeconds)} : {}),
        ...(value.effort !== undefined ? {effort:string(value.effort,1200)} : {}),
        ...(value.recommendation !== undefined ? {recommendation:string(value.recommendation,1200)} : {}),
        ...(value.exerciseId !== undefined ? {exerciseId:value.exerciseId as string} : {})};
    }
    if (step.id !== undefined && step.id !== null && !string(step.id, 160)) invalidContent('.id',step.id,'任务步骤ID无效');
    return { title, details, ...(typeof step.id === 'string' ? { id: step.id } : {}),
      ...(instructions?.length ? {instructions} : {}), ...(notes?.length ? {notes} : {}),
      ...(completionCondition ? {completionCondition} : {}), ...(durationSeconds ? {durationSeconds} : {}),
      ...(step.scheduledDate ? {scheduledDate:step.scheduledDate as string} : {}), ...(step.category ? {category:step.category as ProfessionalTaskStepCategory} : {}), ...(training ? {training} : {}) };
  });
  if (JSON.stringify(steps).length > 30_000) throw new ProfessionalTaskError('任务内容过长');
  if (p.decision === 'update' && !string(p.taskId, 160)) throw new ProfessionalTaskError('更新任务缺少ID');
  if (p.decision === 'create' && p.basis === 'existing_task_change') throw new ProfessionalTaskError('已有任务修改不能创建新任务');
  if (p.newInstance !== undefined && typeof p.newInstance !== 'boolean') throw new ProfessionalTaskError('任务实例标记无效');
  if (p.contextMessageId !== undefined && !string(p.contextMessageId, 160)) throw new ProfessionalTaskError('任务上下文来源无效');
  if (p.basis === 'existing_task_change' && p.contextMessageId !== undefined)
    throw new ProfessionalTaskError('修改已有任务只使用本轮修改委托，不继承历史委托');
  return { decision: p.decision as 'create'|'update', basis: p.basis as Exclude<ProfessionalTaskOperation,{decision:'none'}>['basis'],
    confidence: p.confidence, scope: 'current_user', polarity: 'affirmed', readiness: 'ready', sourceMessageId, evidence, title, goalKey, steps,
    ...(typeof p.taskId === 'string' ? { taskId: p.taskId } : {}), ...(typeof p.planMessageId === 'string' ? { planMessageId: p.planMessageId } : {}),
    ...(typeof p.contextMessageId === 'string' ? { contextMessageId: p.contextMessageId } : {}), ...(p.newInstance === true ? {newInstance:true} : {}) };
}

export function assertTaskDelegation(op: Exclude<ProfessionalTaskOperation,{decision:'none'}>, sources: ProfessionalTaskSource[], plans: ProfessionalTaskSource[], contextSources: ProfessionalTaskSource[] = []) {
  const source = sources.find(row => row.id === op.sourceMessageId);
  if (!source || !source.text.includes(op.evidence))
    throw new ProfessionalTaskError('没有本轮真实用户的明确执行委托', 'TASK_INTENT_REJECTED');
  const resolved = resolveTaskSource(sources, source.id)!;
  const context = resolved.sourceMessageIds.length > 1 ? resolved.text : taskEvidenceContext(source,op.evidence);
  const resendMode = source.taskReference ? taskSourceResendMode(source.text) : undefined;
  if (resendMode && op.decision === 'update')
    throw new ProfessionalTaskError('重发任务使用创建或重显，不修改原任务', 'TASK_INTENT_REJECTED');
  if (op.decision === 'update' && op.basis === 'existing_task_change') {
    if (/(?:不要|别|不用|不必|无需)[^，,。！？!?；;\n]{0,40}(?:改|换|调整|修改|替换)/.test(context))
      throw new ProfessionalTaskError('用户否定了修改原任务','TASK_INTENT_REJECTED');
    return;
  }
  if (!('steps' in op)) return;
  // A positive quotation fragment cannot override an explicit refusal elsewhere in this input.
  if (taskCreationRefused(source.text))
    throw new ProfessionalTaskError('用户明确拒绝创建任务','TASK_INTENT_REJECTED');
  const laterSources=sources.slice(sources.indexOf(source)+1);
  if(laterSources.some(row=>taskCreationRefused(row.text)))
    throw new ProfessionalTaskError('后续用户输入已撤回执行委托','TASK_INTENT_REJECTED');
  if ([source, ...laterSources].some(row => taskSourceChangesGoal(row.text, normalizeTaskGoal(op.goalKey))))
    throw new ProfessionalTaskError('后续用户输入已改变当前执行目标', 'TASK_INTENT_REJECTED');
  const priorSources = [...contextSources, ...sources.slice(0, sources.indexOf(source))];
  const prior = priorSources.find(row => row.id === op.contextMessageId);
  if (op.contextMessageId && !prior) throw new ProfessionalTaskError('任务上下文来源不在有效近期对话中', 'TASK_INTENT_REJECTED');
  const goal = normalizeTaskGoal(op.goalKey);
  if (prior) {
    // A user ID is not enough: the original goal and every intervening input must agree.
    const priorContext = taskEvidenceContext(prior, prior.text);
    const intervening = priorSources.slice(priorSources.indexOf(prior) + 1);
    if (!(normalizeTaskGoal(priorContext).includes(goal) || taskSourceIsSecretaryRequest(prior) && normalizeTaskGoal(prior.secretaryDelegation!.goal).includes(goal)) || taskCreationRefused(prior.text)
      || /(?:如果|假如|假设|要是|比如|朋友|同事|别人)|[“”"「」『』]/.test(prior.text)
      || intervening.some(row => !resolved.sourceMessageIds.includes(row.id) && !taskSourceContinuesExecution(row.text) && !taskSourceClarifiesDelegation(row, prior)))
      throw new ProfessionalTaskError('此前目标已中断或不属于当前执行委托', 'TASK_INTENT_REJECTED');
    if (laterSources.some(row => !taskSourceContinuesExecution(row.text) && !taskSourceClarifiesDelegation(row, prior)))
      throw new ProfessionalTaskError('后续用户输入已改变当前执行目标', 'TASK_INTENT_REJECTED');
  }
  const continuedExecution = op.basis === 'execution_commitment' && prior
    && taskSourceAllowsCreation(prior.text, 'execution_commitment') && taskSourceContinuesExecution(context)
    && (taskSourceRequestsFlow(context) || priorSources.slice(priorSources.indexOf(prior) + 1).some(row => taskSourceRequestsFlow(row.text)));
  const referencedDelegation = resendMode && ['explicit_request', 'execution_commitment'].includes(op.basis)
    && normalizeTaskGoal(source.taskReference!.goalKey) === goal;
  const clarifiedDelegation = prior && ['explicit_request', 'execution_commitment'].includes(op.basis)
    && taskSourceClarifiesDelegation(source, prior);
  const secretaryDelegation = op.basis === 'explicit_request' && taskSourceIsSecretaryRequest(source);
  if (!taskSourceAllowsCreation(context, op.basis) && !continuedExecution && !referencedDelegation && !clarifiedDelegation && !secretaryDelegation)
    throw new ProfessionalTaskError('没有本轮真实用户的明确执行委托', 'TASK_INTENT_REJECTED');
  const plan = plans.slice(-3).find(row => row.id === op.planMessageId);
  if (op.basis === 'accepted_plan' && (!plan || !/(?:分.{1,6}步|先.{1,80}再|从.{1,12}开始|开始做|开始练|就做|先准备|第一步|带你.{0,8}(?:做|练)|一步步|(?:做|练).{1,15}吧)/.test(plan.text)))
    throw new ProfessionalTaskError('用户尚未接受可见的实际执行方案', 'TASK_INTENT_REJECTED');
  // The model must ground the goal in a source or the actually accepted plan.
  const sourceGoal = normalizeTaskGoal(source.text);
  if (/^(?:做饭|一顿饭|午饭|晚饭|早餐|做菜|任务|饭|吃饭|烹饪)$/.test(goal)) throw new ProfessionalTaskError('任务的具体目标尚未明确','TASK_INTENT_REJECTED');
  const acceptedGoal = plan ? normalizeTaskGoal(plan.text) : '';
  if (!goal || (!sourceGoal.includes(goal) && !acceptedGoal.includes(goal) && !prior && !referencedDelegation
    && !(secretaryDelegation && normalizeTaskGoal(source.secretaryDelegation!.goal).includes(goal))))
    throw new ProfessionalTaskError('任务目标没有真实来源', 'TASK_INTENT_REJECTED');
  if (op.newInstance && (resendMode === 'same' || (!referencedDelegation && !taskSourceIsDatedPlan(source) && !(prior && taskSourceIsDatedPlan(prior)) && !/(?:重新|再|另|新).{0,10}(?:开|建|创建|发|做).{0,10}(?:任务|一份|一个|一次)|(?:新的一份|另一个|再来一份).{0,12}任务|(?:给我|发我|发给我).{0,12}(?:一份新的|新的一份|新的任务|新任务)/.test(source.text))))
    throw new ProfessionalTaskError('没有创建新一次任务的明确委托', 'TASK_INTENT_REJECTED');
}

export function applyProfessionalTaskOperation(tasks: ProfessionalTask[], op: ProfessionalTaskOperation, sources: ProfessionalTaskSource[], plans: ProfessionalTaskSource[], now = Date.now(), contextSources: ProfessionalTaskSource[] = [], characterId: ProfessionalTaskCharacterId = 'zhou-chef') {
  if (tasks.some(task => task.characterId !== characterId)) throw new ProfessionalTaskError('任务不属于当前人物', 'TASK_INTENT_REJECTED');
  reconcileProfessionalTasksExpiry(tasks,now);
  if (op.decision === 'none') return null;
  const sourceMessageId = op.sourceMessageId;
  const source = sources.find(row => row.id === sourceMessageId), reference = source?.taskReference;
  const referencedTask = reference ? tasks.find(task => task.id === reference.taskId && task.characterId === characterId
    && (task.cardMessageId === reference.cardMessageId || task.cardMessageIds?.includes(reference.cardMessageId))
    && normalizeTaskGoal(task.goalKey) === normalizeTaskGoal(reference.goalKey)) : undefined;
  if (reference && !referencedTask) throw new ProfessionalTaskError('引用任务来源已失效', 'TASK_INTENT_REJECTED');
  const resendMode = reference ? taskSourceResendMode(source!.text) : undefined;
  if (reference && 'taskId' in op && op.taskId && op.taskId !== reference.taskId)
    throw new ProfessionalTaskError('任务操作不对应本轮引用的任务', 'TASK_INTENT_REJECTED');
  assertTaskDelegation(op, sources, plans, contextSources);
  const clarificationRequest = [...contextSources, ...sources].find(row => row.id === source?.taskClarification?.requestMessageId);
  const schedulingSource = clarificationRequest && taskSourceClarifiesDelegation(source!, clarificationRequest) ? clarificationRequest : source!;
  if (op.decision==='update' && taskSourceIsDatedPlan(schedulingSource)
    && !/(?:改|调整|修改|替换|更新).{0,25}(?:这个|这份|当前|之前|原来|上次|原有|已有|任务|计划)|(?:这个|这份|当前|之前|原来|上次|原有|已有).{0,25}(?:任务|计划).{0,25}(?:改|调整|修改|替换|更新)/.test(schedulingSource.text))
    throw new ProfessionalTaskError('未来规划应创建独立有日期的任务，不能修改未被指定的当前任务','TASK_PLAN_INSTANCE_REQUIRED');
  if ('steps' in op && op.decision === 'create' && resendMode === 'new'
    && normalizeTaskGoal(op.goalKey) === normalizeTaskGoal(reference!.goalKey)) op = {...op, newInstance:true};
  if ('contextMessageId' in op && op.contextMessageId) {
    const prior = [...contextSources, ...sources.slice(0, sources.findIndex(row => row.id === source!.id))].find(row => row.id === op.contextMessageId)!;
    if (tasks.some(task => normalizeTaskGoal(task.goalKey) === normalizeTaskGoal(op.goalKey)
      && ['completed', 'cancelled', 'paused', 'skipped'].includes(task.status) && Date.parse(task.updatedAt) >= Date.parse(prior.at || '1970-01-01')))
      throw new ProfessionalTaskError('此前任务已暂停或结束，不能用旧执行意图新建任务', 'TASK_INTENT_REJECTED');
  }
  if (!('steps' in op)) {
    const task = tasks.find(row => row.id === op.taskId);
    if (!task) throw new ProfessionalTaskError('任务不存在', 'TASK_NOT_FOUND',404);
    if(task.status==='skipped')throw new ProfessionalTaskError('该任务已按日跳过，请明确创建新的执行任务','TASK_SKIPPED',409);
    const source = sources.find(row => row.id === op.sourceMessageId)!;
    const context=taskEvidenceContext(source,op.evidence);
    if (/(?:不要|不用|别|不必).{0,5}(?:取消|暂停|停止|继续|恢复|撤销)/.test(context))
      throw new ProfessionalTaskError('用户否定了该任务状态操作','TASK_INTENT_REJECTED');
    if(op.decision==='resume' && /(?:等|晚点|以后|之后).{0,15}(?:继续|恢复|再开始)/.test(context))
      throw new ProfessionalTaskError('用户尚未要求现在恢复任务','TASK_INTENT_REJECTED');
    const pattern = op.decision === 'pause' ? /暂停|先不做|晚点|等.{0,20}再|先放|停一下/
      : op.decision === 'cancel' ? /取消|撤销|撤掉|不做了|不要做|删掉|结束/
      : /继续|恢复|接着|再开始/;
    if (!pattern.test(context)) throw new ProfessionalTaskError('没有改变任务状态的真实委托','TASK_INTENT_REJECTED');
    if (op.decision === 'resume' && (task.status === 'completed' || task.status === 'cancelled')) throw new ProfessionalTaskError('已结束的任务不能恢复，需明确新的执行');
    const status = op.decision === 'pause' ? 'paused' : op.decision === 'cancel' ? 'cancelled' : 'active';
    if (task.status !== status) {
      if (status !== 'active') {
        freezeProfessionalTaskTimers(task, now);
        freezeProfessionalTaskSessions(task, status === 'cancelled' ? 'cancelled' : 'paused', now);
      }
      task.status = status; task.updatedAt = new Date(now).toISOString(); task.revision++;
    }
    return {task,created:false,changed:true};
  }
  const datedPlan = taskSourceIsDatedPlan(schedulingSource) && op.steps.every(step=>!!step.scheduledDate);
  const existing = op.decision === 'update' ? tasks.find(task => task.id === op.taskId)
    : resendMode === 'same' && normalizeTaskGoal(op.goalKey) === normalizeTaskGoal(reference!.goalKey) ? referencedTask
    // A new future period is an independently delegated task. Source identity
    // keeps an exact replay idempotent without stealing today's same-goal work.
    : datedPlan ? tasks.find(task=>task.sourceMessageId===op.sourceMessageId)
    : !op.newInstance ? tasks.find(task => normalizeTaskGoal(task.goalKey) === normalizeTaskGoal(op.goalKey) && ['active','paused'].includes(task.status)) : undefined;
  if (op.decision === 'update' && !existing) throw new ProfessionalTaskError('更新的任务不存在', 'TASK_NOT_FOUND');
  if(existing&&op.decision==='update'&&existing.status==='skipped')
    throw new ProfessionalTaskError('已跳过的任务不能整单替换，请明确创建新的执行任务','TASK_SKIPPED',409);
  if (existing && op.basis === 'existing_task_change' && normalizeTaskGoal(existing.goalKey) !== normalizeTaskGoal(op.goalKey)
    && !normalizeTaskGoal(sources.find(source => source.id === op.sourceMessageId)?.text || '').includes(normalizeTaskGoal(op.goalKey)))
    throw new ProfessionalTaskError('修改任务不能换成未经委托的新目标');
  const at = new Date(now).toISOString();
  if (existing && op.decision === 'create') return {task:existing,created:false,changed:false,...(resendMode === 'same' ? {resent:true} : {})};
  if (existing) {
    const goalChanged=normalizeTaskGoal(existing.goalKey)!==normalizeTaskGoal(op.goalKey);
    const seen = new Set<string>();
    const steps = op.steps.map(proposed => {
      const original = proposed.id ? existing.steps.find(step => step.id === proposed.id)
        : !goalChanged ? existing.steps.find(step => normalizeTaskGoal(step.title) === normalizeTaskGoal(proposed.title)) : undefined;
      if (proposed.id && !original) throw new ProfessionalTaskError('更新包含未知步骤ID');
      const content = {title:proposed.title,details:proposed.details,
        ...(proposed.instructions ? {instructions:proposed.instructions} : {}), ...(proposed.notes ? {notes:proposed.notes} : {}),
        ...(proposed.completionCondition ? {completionCondition:proposed.completionCondition} : {}), ...(proposed.durationSeconds ? {durationSeconds:proposed.durationSeconds} : {}),
        ...((proposed.scheduledDate || original?.scheduledDate) ? {scheduledDate:proposed.scheduledDate || original!.scheduledDate} : {}),
        ...((proposed.category || original?.category) ? {category:proposed.category || original!.category} : {}),
        ...((proposed.training || (original?.title===proposed.title && original.training)) ? {training:proposed.training || original!.training} : {})};
      const changed = original && (goalChanged || original.title !== proposed.title || JSON.stringify(original.details) !== JSON.stringify(proposed.details)
        || JSON.stringify(original.instructions) !== JSON.stringify(proposed.instructions) || JSON.stringify(original.notes) !== JSON.stringify(proposed.notes)
        || original.completionCondition !== proposed.completionCondition || original.durationSeconds !== proposed.durationSeconds
        || original.scheduledDate !== content.scheduledDate || original.category !== content.category || JSON.stringify(original.training) !== JSON.stringify(content.training));
      if(original?.skippedAt&&(proposed.id!==original.id||changed))
        throw new ProfessionalTaskError('已跳过步骤的日期和内容不能修改，请创建新的执行步骤','TASK_SKIPPED',409);
      if(original?.completedAt&&professionalTaskStepDayEnded(existing,original,now)&&changed)
        throw new ProfessionalTaskError('已结束日期的真实完成记录不能修改','TASK_DAY_CLOSED',409);
      const step: ProfessionalTaskStep = original ? {id:original.id,...content,hints:changed ? [] : original.hints,
        ...(original.completedAt ? {completedAt:original.completedAt} : {}),
        ...(original.skippedAt ? {skippedAt:original.skippedAt,skipReason:original.skipReason} : {}), ...(!changed && original.timer ? {timer:original.timer} : {})}
        : {id:crypto.randomUUID(),...content,hints:[]};
      if (seen.has(step.id)) throw new ProfessionalTaskError('更新重复引用同一步骤');
      seen.add(step.id); return step;
    });
    // A model may amend the remaining recipe; it cannot silently erase a user's completed work.
    if (!goalChanged && existing.steps.some(step => step.completedAt && !seen.has(step.id))) throw new ProfessionalTaskError('更新不能删除已经完成的步骤');
    if(existing.steps.some(step=>step.skippedAt&&!seen.has(step.id)))throw new ProfessionalTaskError('更新不能删除已经跳过的步骤','TASK_SKIPPED',409);
    reconcileProfessionalTaskSessions(existing, now);
    freezeProfessionalTaskSessions(existing, 'cancelled', now);
    (existing.previousPlans ||= []).push({at,title:existing.title,goalKey:existing.goalKey,steps:structuredClone(existing.steps)});
    existing.title = op.title; existing.goalKey = op.goalKey; existing.steps = steps;
    existing.updatedAt = at; existing.revision++;
    if (existing.status === 'completed' && steps.some(step => !step.completedAt)) existing.status = 'active';
    reconcileProfessionalTaskExpiry(existing,now);
    return { task: existing, created: false, changed:true };
  }
  const delegationIds=[...resolveTaskSource(sources,op.sourceMessageId)!.sourceMessageIds,...(op.contextMessageId?[op.contextMessageId]:[]),...(clarificationRequest?[clarificationRequest.id]:[])];
  const delegationTimes=[...sources,...contextSources].filter(row=>delegationIds.includes(row.id)).map(row=>Date.parse(row.at||'')).filter(time=>Number.isFinite(time)&&time<=now);
  const assignedDate=professionalTaskToday(delegationTimes.length?Math.min(...delegationTimes):now);
  const task: ProfessionalTask = { id: crypto.randomUUID(), characterId, title: op.title, goalKey: op.goalKey,assignedDate,
    status: 'active', createdAt: at, updatedAt: at, revision: 1, sourceMessageId: op.sourceMessageId,
    cardMessageId: crypto.randomUUID(), steps: op.steps.map(({id: _id, ...step}) => ({...step, id: crypto.randomUUID(), hints: [] })) };
  task.delegationSourceMessageIds = [...resolveTaskSource(sources, op.sourceMessageId)!.sourceMessageIds, ...(op.contextMessageId ? [op.contextMessageId] : [])];
  if (reference && resendMode === 'new') { task.referenceTaskId = reference.taskId; task.referenceCardMessageId = reference.cardMessageId; }
  if (op.contextMessageId) task.contextMessageId = op.contextMessageId;
  tasks.push(task);reconcileProfessionalTaskExpiry(task,now);return { task, created: true, changed:true };
}

export function nextProfessionalTaskStep(task: ProfessionalTask) {
  return task.steps.filter(professionalTaskStepPending).sort((a,b)=>(professionalTaskStepDate(task,a)||'9999').localeCompare(professionalTaskStepDate(task,b)||'9999'))[0];
}
export function professionalTaskProgress(task: ProfessionalTask) {
  const completed = task.steps.filter(step => !!step.completedAt).length, total = task.steps.length;
  const skipped=task.steps.filter(step=>!step.completedAt&&!!step.skippedAt).length;
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 0,skipped,pending:total-completed-skipped };
}

export function mutateProfessionalTaskStep(task: ProfessionalTask, stepId: string, completed: boolean, expectedRevision: number, now = Date.now()) {
  reconcileProfessionalTaskExpiry(task,now);
  const step = task.steps.find(row => row.id === stepId);
  if (!step) throw new ProfessionalTaskError('步骤不存在', 'TASK_NOT_FOUND', 404);
  if(task.status==='skipped'||step.skippedAt)throw new ProfessionalTaskError('该任务或步骤已按日跳过，请明确创建新的执行任务','TASK_SKIPPED',409);
  if (expectedRevision !== task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试', 'TASK_REVISION_CONFLICT', 409);
  if (task.status === 'cancelled') throw new ProfessionalTaskError('任务已取消');
  if (!!step.completedAt === completed) return false;
  if(step.completedAt&&professionalTaskStepDayEnded(task,step,now))throw new ProfessionalTaskError('已结束日期的真实完成记录不能撤销','TASK_DAY_CLOSED',409);
  if (completed && task.status === 'paused') throw new ProfessionalTaskError('请先继续任务');
  if (completed) { freezeProfessionalTaskStepTimer(step, now); step.completedAt = new Date(now).toISOString(); } else delete step.completedAt;
  reconcileProfessionalTaskSessions(task, now);
  task.updatedAt = new Date(now).toISOString(); task.revision++;
  if (task.steps.every(row => row.completedAt)) { freezeProfessionalTaskTimers(task, now); task.status = 'completed'; }
  else if (task.status === 'completed') task.status = 'active';
  reconcileProfessionalTaskExpiry(task,now);
  return true;
}

/** Calendar dates are interpreted in Shanghai, independently of the host timezone. */
export function isProfessionalTaskDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
}
export function professionalTaskToday(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function professionalTaskDateOptions(now = Date.now()) {
  const today = professionalTaskToday(now), time = Date.parse(`${today}T00:00:00Z`);
  return Array.from({length:31}, (_,index) => new Date(time + index*86400000).toISOString().slice(0,10));
}
export function mutateProfessionalTaskStepDate(task: ProfessionalTask, stepId: string, scheduledDate: string, expectedRevision: number, now = Date.now()) {
  reconcileProfessionalTaskExpiry(task,now);
  const step = task.steps.find(row=>row.id===stepId);
  if (!step) throw new ProfessionalTaskError('步骤不存在', 'TASK_NOT_FOUND',404);
  if(task.status==='skipped'||step.skippedAt)throw new ProfessionalTaskError('已跳过的任务或步骤不能改期，请明确创建新的执行任务','TASK_SKIPPED',409);
  if(step.completedAt&&professionalTaskStepDayEnded(task,step,now))throw new ProfessionalTaskError('已结束日期的真实完成记录不能改期','TASK_DAY_CLOSED',409);
  if (expectedRevision !== task.revision) throw new ProfessionalTaskError('任务已更新，请同步后重试', 'TASK_REVISION_CONFLICT',409);
  if (!isProfessionalTaskDate(scheduledDate) || !professionalTaskDateOptions(now).includes(scheduledDate))
    throw new ProfessionalTaskError('请选择今天至下周同一天的日期', 'TASK_DATE_OUT_OF_RANGE');
  if (!step.scheduledDate) throw new ProfessionalTaskError('当下单次任务没有计划日期', 'TASK_DATE_NOT_SCHEDULED');
  if (task.status === 'cancelled') throw new ProfessionalTaskError('任务已取消');
  if (step.scheduledDate === scheduledDate) return false;
  step.scheduledDate = scheduledDate;
  task.updatedAt = new Date(now).toISOString(); task.revision++;
  return true;
}
