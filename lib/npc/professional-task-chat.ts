import type { ChatMessage } from './contracts';
import { deliveredMessages } from './delivery';
import { normalizeTaskGoal, ProfessionalTaskError, resolveTaskSource, taskSourceAllowsCreation, taskSourceClarifiesDelegation, taskSourceContinuesExecution, taskSourceIsDatedPlan, taskSourceResendMode, type ProfessionalTask, type ProfessionalTaskCharacterId, type ProfessionalTaskOperation, type ProfessionalTaskSource } from './professional-task';
import { secretaryTaskSource, type SecretaryDelegationState } from './secretary-delegation';
export type ProfessionalTaskChatState = SecretaryDelegationState & {
  characterId: ProfessionalTaskCharacterId; messages: ChatMessage[]; queue: string[];
  privateHistoryHiddenIds?: string[]; professionalTasks: ProfessionalTask[]; branch?: string;
};
/** The model and application share this bounded, visible evidence window. */
export function professionalTaskDelegationEvidence(state: ProfessionalTaskChatState, now = Date.now(), sourceTurnIds = state.queue) {
  const hidden = new Set(state.privateHistoryHiddenIds || []);
  const visible = deliveredMessages(state.messages, now);
  const current = visible.filter(message => message.role === 'user' && sourceTurnIds.includes(message.turnId) && !hidden.has(message.id));
  const toSource = (message: ChatMessage): ProfessionalTaskSource => ({ id: message.id, text: 'text' in message.part ? message.part.text : '', at: message.at });
  const sources = current.map(message => {
    const source = toSource(message), original = visible.find(row => row.id === message.replyTo);
    if (original && !hidden.has(original.id) && original.role === 'assistant' && original.part.type === 'professional_task'
      && !original.turnId.startsWith('legacy:') && !original.chronologyUnknown && !original.legacyContent
      && Number.isFinite(Date.parse(original.at)) && Date.parse(original.at) <= Date.parse(message.at)) {
      const taskId = original.part.taskId;
      const task = state.professionalTasks?.find(task => task.id === taskId && task.characterId === state.characterId
        && (task.cardMessageId === original.id || task.cardMessageIds?.includes(original.id)));
      if (task) source.taskReference = {taskId:task.id,cardMessageId:original.id,goalKey:task.goalKey};
    }
    return source;
  });
  const firstCurrent = visible.findIndex(message => message.id === current[0]?.id);
  const priorUser = firstCurrent >= 0 ? visible.slice(0, firstCurrent).findLastIndex(message => message.role === 'user') : -1;
  const plans = (firstCurrent >= 0 ? visible.slice(priorUser + 1, firstCurrent) : [])
    .filter(message => message.role === 'assistant' && message.part.type !== 'choice' && 'text' in message.part && !hidden.has(message.id)).map(toSource);
  const contextSources: ProfessionalTaskSource[] = [];
  const day = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
  // A queued request keeps its own recency window while generation or explicit
  // retry is waiting; elapsed model time must not rewrite its original meaning.
  const requestAt = current[0] ? Date.parse(current[0].at) : now;
  const evidenceAt = Number.isFinite(requestAt) && requestAt <= now ? requestAt : now;
  // A cleared or unavailable message is a boundary, not a gap to skip over.
  for (let i = firstCurrent - 1; i >= 0 && contextSources.length < 4; i--) {
    const message = visible[i], time = Date.parse(message.at);
    if (hidden.has(message.id)) break;
    if (message.role !== 'user') continue;
    if (message.turnId.startsWith('legacy:') || message.chronologyUnknown || !Number.isFinite(time)
      || time > evidenceAt || evidenceAt - time > 30 * 60_000 || day(time) !== day(evidenceAt)
      || day(evidenceAt) !== day(now) || !('text' in message.part)) break;
    contextSources.unshift(toSource(message));
  }
  const delegation = [...(state.secretaryDelegations || [])].reverse().find(event => event.targetId === state.characterId
    && (!state.branch || event.branch === state.branch)
    && (event.id === state.activeSecretaryDelegationId || event.status === 'delivered')
    && !state.professionalTasks.some(task => task.sourceMessageId === event.source.messageId || task.delegationSourceMessageIds?.includes(event.source.messageId)));
  if (delegation) {
    if (delegation.id === state.activeSecretaryDelegationId && !current.length) sources.push(secretaryTaskSource(delegation));
    else if (current.length && delegation.deliveredAt) {
      const time = Date.parse(delegation.deliveredAt), requestAt = Date.parse(current[0].at);
      const since = visible.filter(message => Date.parse(message.at) >= time && !hidden.has(message.id));
      const responses = since.filter(message => message.role === 'user');
      const interrupted = responses.length > 8 || responses.some(message => 'text' in message.part && /换个话题|不聊这个|先聊别的|先不安排|不用安排|取消计划|算了/.test(message.part.text));
      const question = since.filter(message => message.role === 'assistant').at(-1);
      if (!interrupted && question && Number.isFinite(time) && requestAt >= time && requestAt - time <= 48 * 3600_000) {
        const original = secretaryTaskSource(delegation);
        contextSources.unshift(original);
        for (const source of [...contextSources, ...sources]) if (source.id !== original.id && !source.secretaryDelegation)
          source.taskClarification = {questionMessageId: question.id, requestMessageId: original.id};
      }
    }
  }
  const boundedSources = [...contextSources, ...sources];
  const sourceById = new Map(boundedSources.map(source => [source.id, source]));
  for (const source of boundedSources) {
    const messageIndex = visible.findIndex(message => message.id === source.id), message = visible[messageIndex];
    const questionIndex = visible.findIndex(row => row.id === message?.replyTo), question = visible[questionIndex];
    if (!message || message.part.type !== 'text' || !question || questionIndex >= messageIndex || hidden.has(question.id)
      || question.role !== 'assistant' || question.part.type !== 'choice'
      || question.turnId.startsWith('legacy:') || question.chronologyUnknown || question.legacyContent
      || !Number.isFinite(Date.parse(question.at)) || Date.parse(question.at) > Date.parse(message.at)) continue;
    const selection = question.part.selection;
    if (!selection || selection.turnId !== message.turnId || !Number.isSafeInteger(selection.index)
      || selection.index < 0 || question.part.options[selection.index] !== source.text
      || !Number.isFinite(Date.parse(selection.at)) || Date.parse(selection.at) < Date.parse(question.at)
      || Date.parse(selection.at) > Date.parse(message.at) || Date.parse(selection.at) > now
      || visible.slice(questionIndex + 1, messageIndex).some(row => row.role === 'user' || hidden.has(row.id))) continue;
    const previous = visible.slice(0, questionIndex).findLast(row => row.role === 'user');
    const previousSource = previous && sourceById.get(previous.id);
    if (!previousSource) continue;
    const request = previousSource.taskClarification
      ? sourceById.get(previousSource.taskClarification.requestMessageId)
      : previousSource;
    if (!request || (previousSource !== request && !taskSourceClarifiesDelegation(previousSource, request))
      || !taskSourceAllowsCreation(request.text, 'explicit_request') && !taskSourceAllowsCreation(request.text, 'execution_commitment')) continue;
    // A saved task consumes its original delegation in every lifecycle state.
    // A later choice answer cannot turn that request into another authorization.
    if (state.professionalTasks.some(task => task.sourceMessageId === request.id
      || task.contextMessageId === request.id || task.delegationSourceMessageIds?.includes(request.id))) continue;
    const taskClarification = {questionMessageId: question.id, requestMessageId: request.id};
    if (taskSourceClarifiesDelegation({...source, taskClarification}, request)) source.taskClarification = taskClarification;
  }
  return { sources, plans, contextSources,
    currentInterpretations: sources.map(source => ({ sourceMessageId: source.id, ...resolveTaskSource(sources, source.id)! })) };
}

export function assertProfessionalTaskCardOutput(state: ProfessionalTaskChatState, out: {task:ProfessionalTaskOperation;parts:ChatMessage['part'][]}, evidence:ReturnType<typeof professionalTaskDelegationEvidence>) {
  const {sources,contextSources,currentInterpretations}=evidence;
  const clarificationRequests = sources.flatMap(source => {
    const request = [...contextSources, ...sources].find(row => row.id === source.taskClarification?.requestMessageId);
    return request && taskSourceClarifiesDelegation(source, request) ? [request] : [];
  });
  const datedPlan = [...sources, ...clarificationRequests].some(taskSourceIsDatedPlan);
  if (datedPlan && 'steps' in out.task && out.task.steps.some(step=>!step.scheduledDate))
    throw new ProfessionalTaskError('未来多日规划的每个执行步骤都需要具体日期','TASK_PLAN_DATES_OMITTED');
  if (out.task.decision === 'none' && sources.length) {
    const text = out.parts.filter(part => 'text' in part).map(part => 'text' in part ? part.text : '').join('\n');
    if (sources.some(source => source.taskReference && taskSourceResendMode(source.text))
      && !sources.some(source => /(?:不要|不用|别).{0,8}(?:发|任务)|不用了|不要了|算了|(?:只|直接).{0,8}(?:文字|文本)|暂停|取消/.test(source.text)))
      throw new ProfessionalTaskError('明确引用任务的重发请求应提供任务卡', 'TASK_CARD_OMITTED');
    const direct = currentInterpretations.some(source => taskSourceAllowsCreation(source.text, 'explicit_request') || taskSourceAllowsCreation(source.text, 'execution_commitment'));
    const anchorIndex = contextSources.findLastIndex(source => taskSourceAllowsCreation(source.text, 'execution_commitment'));
    const continued = anchorIndex >= 0 && [...contextSources.slice(anchorIndex + 1), ...sources].every(source => taskSourceContinuesExecution(source.text));
    const clarified = clarificationRequests.length > 0;
    const refused = sources.some(source => /(?:不要|不用|别).{0,12}任务|(?:只|直接).{0,8}(?:文字|文本)|先不做|不做了|暂停|取消/.test(source.text));
    // This guards omission when a full execution recipe was already generated;
    // a necessary short clarification may still legitimately have task=none.
    const fullProcedure = /(?:第一步|第1步|总共\s*[一二三四五六七八九十\d]+\s*步)/.test(text)
      || /(?:^|\n)\s*1\s*[.、）)]/.test(text) && /(?:^|\n)\s*2\s*[.、）)]/.test(text)
      || /先.{2,120}(?:再|接着).{2,120}最后/.test(text)
      || datedPlan && (text.match(/(?:\d{1,2}月\d{1,2}[日号]|第[一二三四五六七八九十\d]+天)/g) || []).length >= 2 && /(?:训练|练|组|次|动作)/.test(text);
    if (!refused && (direct || continued || clarified) && fullProcedure
      && (datedPlan || !(state.professionalTasks || []).some(task => ['active', 'paused'].includes(task.status) && normalizeTaskGoal(text).includes(normalizeTaskGoal(task.goalKey)))))
      throw new ProfessionalTaskError('明确执行目标的完整流程应放进任务卡，不能仅发送文字步骤', 'TASK_CARD_OMITTED');
    if (!/(?:没有|未|不能|不会|不).{0,8}(?:创建|保存|生成|发出|建|发)/.test(text)
      && /(?:已经|已|给你|帮你).{0,8}(?:创建|保存|生成|建好|发|发布).{0,8}(?:任务|任务卡)/.test(text))
      throw new ProfessionalTaskError('任务未保存，回复不能声称已经创建任务', 'TASK_CARD_OMITTED');
  }
}
