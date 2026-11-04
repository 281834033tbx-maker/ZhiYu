import {factualHistoryMessages} from './report-demo-history';
import {completePrivateSocialTurn} from './social-continuity';
import type { ChatMessage, Memory } from './contracts';
import type { ContactLife } from './contact-life';
import { labels } from './contracts';
import { parseOutput } from './engine';
import { applyRelationshipValues } from './relationship-values';
import { shouldSaveMemory } from './expression-preferences';
import { applyProfessionalTaskOperation, parseProfessionalTaskOperation, ProfessionalTaskError, professionalTaskToday, taskSourceIsDatedPlan, taskSourceClarifiesDelegation, type ProfessionalTask, type ProfessionalTaskEvent, type ProfessionalTaskSource } from './professional-task';
import { assertProfessionalTaskCardOutput, professionalTaskDelegationEvidence } from './professional-task-chat';
import type { SecretaryDelegationState } from './secretary-delegation';
import { deliveredMessages } from './delivery';
type NutritionRenewalQuestion = { id:string; source:ProfessionalTaskSource; questionMessageId:string; branch:string; at:string;
  answerMessageId?:string; decision?:'continue'|'adjust'|'decline' };
export type LiuState = SecretaryDelegationState & {
  contactLife?: ContactLife;
  characterId: 'liu'; revision: number; branch: string;
  messages: ChatMessage[]; memories: Memory[];
  values: Record<string, number | null>;
  emotionStartedAt: number; romanceClosed: boolean;
  relationship: 'strangers';
  proposals: { at: string; evidence: string; kind: string; reason: string; status: 'pending' }[];
  queue: string[]; pending: { id: string; since: number } | null;
  completed: string[]; inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  error: string; retryAt: number;
  professionalTasks: ProfessionalTask[]; taskEvents: ProfessionalTaskEvent[]; taskMutations: {id:string;payload:string}[];
  privateHistoryHiddenIds?: string[]; nutritionRenewalQuestions?: NutritionRenewalQuestion[];
};
export function createLiu(now = Date.now()): LiuState {
  return {
    characterId: 'liu', revision: 0, branch: crypto.randomUUID(),
    messages: [], memories: [], relationship: 'strangers', romanceClosed: false,
    values: Object.fromEntries([...Object.keys(labels), 'respect', 'sharedGrowth', 'heartbeat'].map(key => [key, 0])),
    emotionStartedAt: now, proposals: [], queue: [], pending: null, completed: [], inputRevision: 0,
    typing: {}, error: '', retryAt: 0, professionalTasks: [], taskEvents: [], taskMutations: [],
  };
}
export function parseLiu(raw: unknown, incoming: string) {
  const output = parseOutput(raw, incoming, 'liu');
  if (output.parts.some(p => p.type !== 'choice' && p.type !== 'text' && p.type !== 'emoji' && p.type !== 'generated_photo' && p.type !== 'voice'))
    throw Error('柳智敏尚无已接入的专属表情包素材');
  const task = parseProfessionalTaskOperation(raw && typeof raw === 'object' ? (raw as {task?:unknown}).task : undefined);
  return {...output, task};
}
/** A transport check for an actual answer, never the model's goal or old approval. */
export function nutritionRenewalAnswer(text: string): NutritionRenewalQuestion['decision'] {
  if (!text.trim() || /^(?:如果|假如|假设|比如)|怎么|怎样|如何|为什么|(?:朋友|同事|别人|他|她).{0,8}(?:说|让我|要我)/.test(text)) return;
  if (/(?:不用|不要|别|取消|先不)[^，,。！？!?\n]{0,10}(?:安排|计划|任务)|^(?:算了|不用了|不要了)[。！!\s]*$/.test(text)) return 'decline';
  const food=/菜|餐|食|饭|肉|鱼|蛋|奶|虾|豆|燕麦|面|水果|蔬|粥|米|鸡|牛|羊|方案|菜单/;
  if (/不好吃|吃腻|太难吃|太清淡|太油/.test(text) || food.test(text) && /换|替换|改成|调整|重新安排|重新搭配|不喜欢|不爱吃/.test(text)) return 'adjust';
  if (/(?:不要|别|不想|不用|不再|不按|别按)[^，,。！？!?\n]{0,8}(?:照旧|沿用|继续|上周|原来|之前)|不照旧|不继续/.test(text)) return 'decline';
  if (/[?？]|(?:吗|么)[。！!\s]*$/.test(text)) return;
  if (/照旧|照着上周|按上周|和上周一样|按原来|按之前|继续(?:上周|原来|之前|这份|原方案)|^(?:继续|不换|不用换)[。！!\s]*$/.test(text)) return 'continue';
}

function activeRenewalQuestion(s:LiuState, now:number) {
  const visible=deliveredMessages(s.messages,now).filter(message=>!s.privateHistoryHiddenIds?.includes(message.id));
  return [...(s.nutritionRenewalQuestions || [])].reverse().find(question=>question.branch===s.branch
    && now-Date.parse(question.at)<=48*3600_000 && Date.parse(question.at)<=now
    && visible.some(message=>message.id===question.questionMessageId && message.role==='assistant')
    && !s.professionalTasks.some(task=>task.sourceMessageId===question.source.id || task.delegationSourceMessageIds?.includes(question.source.id)));
}

export function liuTaskDelegationEvidence(s:LiuState, now=Date.now(), sourceTurnIds=s.queue) {
  const evidence=professionalTaskDelegationEvidence(s,now,sourceTurnIds), question=activeRenewalQuestion(s,now);
  if (!question || !evidence.sources.length || evidence.sources.some(source=>source.secretaryDelegation)) return evidence;
  const previousAnswer=question.answerMessageId && s.messages.find(message=>message.id===question.answerMessageId && message.role==='user' && 'text' in message.part);
  const approved=previousAnswer && 'text' in previousAnswer.part && ['continue','adjust'].includes(nutritionRenewalAnswer(previousAnswer.part.text) || '');
  const answers=evidence.sources.some(source=>['continue','adjust'].includes(nutritionRenewalAnswer(source.text) || ''));
  if (!answers && !approved) return evidence;
  if (!evidence.contextSources.some(source=>source.id===question.source.id)) evidence.contextSources.unshift(structuredClone(question.source));
  for (const source of [...evidence.contextSources,...evidence.sources]) if (source.id!==question.source.id && !source.secretaryDelegation
    && taskSourceClarifiesDelegation({...source,taskClarification:{questionMessageId:question.questionMessageId,requestMessageId:question.source.id}},question.source))
    source.taskClarification={questionMessageId:question.questionMessageId,requestMessageId:question.source.id};
  return evidence;
}

export function nextNutritionWeek(now = Date.now()) {
  const today = professionalTaskToday(now), time = Date.parse(`${today}T00:00:00Z`);
  const day = new Date(time).getUTCDay(), offset = day === 0 ? 1 : 8 - day;
  return Array.from({length:7}, (_,index) => new Date(time + (offset + index) * 86400000).toISOString().slice(0,10));
}

/** A queued Sunday request keeps its intended week when the answer arrives Monday. */
export function liuNutritionWeek(evidence:ReturnType<typeof liuTaskDelegationEvidence>, now=Date.now()) {
  const request=evidence.sources.find(source=>/下周/.test(source.text + (source.secretaryDelegation?.goal || '')))
    || evidence.contextSources.find(source=>source.id===evidence.sources[0]?.taskClarification?.requestMessageId)
    || evidence.contextSources.find(source=>/下周/.test(source.text + (source.secretaryDelegation?.goal || '')));
  const at=Date.parse(request?.at || '');
  return nextNutritionWeek(Number.isFinite(at)&&at<=now?at:now);
}

export function liuRenewalConfirmationRequired(s: LiuState, evidence: ReturnType<typeof liuTaskDelegationEvidence>, now = Date.now()) {
  const sources = [...evidence.contextSources, ...evidence.sources];
  const text = sources.map(source => source.text + (source.secretaryDelegation?.goal || '')).join('\n');
  const currentDecisions=evidence.sources.map(source=>nutritionRenewalAnswer(source.text));
  const question=activeRenewalQuestion(s,now);
  if (question && currentDecisions.includes('decline')) return true;
  if (!/下周/.test(text)) return false;
  if (currentDecisions.some(decision=>decision==='continue'||decision==='adjust') && !currentDecisions.includes('decline')) return false;
  const request=evidence.sources.find(source=>/下周/.test(source.text + (source.secretaryDelegation?.goal || '')))
    || sources.find(source=>source.id===evidence.sources[0]?.taskClarification?.requestMessageId);
  if (question && (!request || request.id===question.source.id) && !currentDecisions.includes('decline')) {
    const answer=s.messages.find(message=>message.id===question.answerMessageId && message.role==='user');
    if (answer && 'text' in answer.part && ['continue','adjust'].includes(nutritionRenewalAnswer(answer.part.text)||'')) return false;
  }
  const event = [...(s.secretaryDelegations || [])].reverse().find(event => event.id === s.activeSecretaryDelegationId
    || event.status === 'delivered' && !s.professionalTasks.some(task=>task.delegationSourceMessageIds?.includes(event.source.messageId)));
  const start = liuNutritionWeek(evidence,now)[0];
  return !!event?.previousPlan || (s.professionalTasks || []).some(task => task.characterId === 'liu' && task.status !== 'cancelled'
    && task.steps.some(step => !!step.scheduledDate && step.scheduledDate < start));
}

export function applyLiu(s: LiuState, out: ReturnType<typeof parseLiu>, turnId: string, now = Date.now(), sourceTurnIds = s.queue, taskEvidence?: ReturnType<typeof liuTaskDelegationEvidence>) {
  completePrivateSocialTurn(s,out.socialResponse,out.parts,now,out.event);
  const at = new Date(now).toISOString();
  s.professionalTasks ||= []; s.taskEvents ||= []; s.taskMutations ||= [];
  const evidence = taskEvidence || liuTaskDelegationEvidence(s, now, sourceTurnIds);
  const renewalRequired=liuRenewalConfirmationRequired(s,evidence,now), renewalQuestion=activeRenewalQuestion(s,now);
  if (out.task.decision === 'none' && [...evidence.sources, ...evidence.contextSources].some(taskSourceIsDatedPlan)) {
    const text=out.parts.filter(part=>'text' in part).map(part=>'text' in part?part.text:'').join('\n');
    if (/早餐|午餐|晚餐/.test(text) && (text.match(/周[一二三四五六日天]|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}[日号]/g)||[]).length>=2)
      throw new ProfessionalTaskError('明确委托的完整周饮食安排应交付任务卡', 'TASK_CARD_OMITTED');
  }
  if (out.task.decision !== 'none' && renewalRequired)
    throw new ProfessionalTaskError('续排下周前请先确认上周方案是否继续，并允许替换不喜欢的菜', 'NUTRITION_RENEWAL_CONFIRMATION_REQUIRED');
  if ('steps' in out.task) {
    if (out.task.steps.some(step => step.training || step.durationSeconds))
      throw new ProfessionalTaskError('营养任务不创建训练或做饭计时', 'NUTRITION_TASK_KIND_INVALID');
    const request = [...evidence.sources, ...evidence.contextSources].map(source=>source.text + (source.secretaryDelegation?.goal || '')).join('\n');
    if (/下周/.test(request)) {
      const dates = liuNutritionWeek(evidence,now);
      if (out.task.decision !== 'create' || out.task.steps.some(step=>!step.scheduledDate || !dates.includes(step.scheduledDate)))
        throw new ProfessionalTaskError('下周饮食须新建下自然周具体日期的任务，不修改旧计划', 'NUTRITION_WEEK_DATES_INVALID');
    }
  }
  assertProfessionalTaskCardOutput(s, out, evidence);
  const applied = applyProfessionalTaskOperation(s.professionalTasks, out.task, evidence.sources, evidence.plans, now, evidence.contextSources, 'liu');
  const before=s.messages.length;
  if (out.event) applyRelationshipValues(s.values, out.event.deltas, out.event.kind, out.event.basis);
  for (const part of out.parts) s.messages.push({ id: crypto.randomUUID(), turnId, role: 'assistant', at, part, replyTo:s.messages.some(m=>m.id===part.replyTo)?part.replyTo:undefined });
  if (applied?.created) s.messages.push({id:applied.task.cardMessageId,turnId,role:'assistant',at,origin:'chat',part:{type:'professional_task',taskId:applied.task.id}});
  else if (applied?.resent) {
    const cardMessageId = crypto.randomUUID(); (applied.task.cardMessageIds ||= []).push(cardMessageId);
    s.messages.push({id:cardMessageId,turnId,role:'assistant',at,origin:'chat',part:{type:'professional_task',taskId:applied.task.id}});
  }
  if (renewalQuestion) {
    const answer=evidence.sources.find(source=>!source.secretaryDelegation && nutritionRenewalAnswer(source.text));
    if (answer) {renewalQuestion.answerMessageId=answer.id;renewalQuestion.decision=nutritionRenewalAnswer(answer.text);}
  }
  if (renewalRequired && out.task.decision==='none') {
    const added=s.messages.slice(before), message=added.find(message=>'text' in message.part
      && /上周|原来|之前|原方案|照旧/.test(message.part.text) && /继续|沿用|照旧|换|不喜欢/.test(message.part.text)
      && /吗|呢|？|\?|要不要|是否/.test(message.part.text));
    const source=[...evidence.sources,...evidence.contextSources].find(source=>/下周/.test(source.text + (source.secretaryDelegation?.goal || '')));
    if (message && source && !s.nutritionRenewalQuestions?.some(question=>question.source.id===source.id && question.branch===s.branch))
      (s.nutritionRenewalQuestions ||= []).push({id:crypto.randomUUID(),source:structuredClone(source),questionMessageId:message.id,branch:s.branch,at});
  }
  for (const memory of out.memories) {
    const message = [...factualHistoryMessages(s.messages)].reverse().find(m => m.role === 'user' && 'text' in m.part && m.part.text.includes(memory.evidence));
    if (message && shouldSaveMemory(s.memories, memory))
      s.memories.push({ ...memory, id: crypto.randomUUID(), messageId: message.id, status: 'model_proposed' });
  }
  if (out.event) {
    const e = out.event;
    s.proposals.push({ at, evidence: e.evidence, kind: e.kind, reason: e.reason, status: 'pending' });
    // Event interpretation remains a proposal; no invented numeric weights or permanent lock from an unreviewed classification.
  }
  return applied;
}
