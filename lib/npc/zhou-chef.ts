import {completePrivateSocialTurn} from './social-continuity';
import type { ChatMessage, Memory } from './contracts';
import { deliveredMessages } from './delivery';
import { parseOutput } from './engine';
import { shouldSaveMemory } from './expression-preferences';
import { applyRelationshipValues, CORE_RELATIONSHIP_KEYS, type CoreRelationshipValues } from './relationship-values';
import { applyProfessionalTaskOperation, parseProfessionalTaskOperation, type ProfessionalTask, type ProfessionalTaskEvent } from './professional-task';
import { assertProfessionalTaskCardOutput, professionalTaskDelegationEvidence } from './professional-task-chat';

export type ChefMessage = ChatMessage;
export type LegacyChefMessage = {
  id: string; text: string; time: string; at?: string; mine?: boolean; replyTo?: string;
  image?: string; audio?: string; audioDurationSeconds?: number; file?: string;
};
export type ChefState = {
  characterId: 'zhou-chef'; revision: number; branch: string;
  messages: ChefMessage[]; memories: Memory[]; values: CoreRelationshipValues;
  relationship: 'strangers'; romanceClosed: boolean;
  proposals: { at: string; evidence: string; kind: string; reason: string; status: 'pending' | 'applied' }[];
  queue: string[]; pending: { id: string; since: number } | null;
  completed: string[]; inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  privateHistoryHiddenIds?: string[];
  professionalTasks: ProfessionalTask[];
  taskEvents: ProfessionalTaskEvent[];
  taskMutations: { id: string; payload: string }[];
  taskMemorySyncError?: string;
  error: string; retryAt: number;
};

export function createChef(): ChefState {
  return {
    characterId: 'zhou-chef', revision: 0, branch: crypto.randomUUID(),
    messages: [], memories: [], values: { familiarity: 0, affection: 0, trust: 0, comfort: 0 },
    relationship: 'strangers', romanceClosed: false, proposals: [], queue: [], pending: null,
    completed: [], inputRevision: 0, typing: {}, error: '', retryAt: 0,
    professionalTasks: [], taskEvents: [], taskMutations: [],
  };
}

export function parseChef(raw: unknown, incoming: string) {
  const out = parseOutput(raw, incoming, 'zhou-chef');
  if (out.parts.some(part => part.type !== 'choice' && part.type !== 'text' && part.type !== 'emoji'))
    throw Error('赵一帆当前只支持文字与内置小表情');
  if (out.event && (Object.keys(out.event.deltas).some(key => !(CORE_RELATIONSHIP_KEYS as readonly string[]).includes(key)) || out.event.relationship || out.event.interaction))
    throw Error('赵一帆提议了未开放的隐藏值或关系变更');
  const task = parseProfessionalTaskOperation(raw && typeof raw === 'object' ? (raw as {task?:unknown}).task : undefined);
  return { ...out, task };
}

/** Compatibility export; shared evidence uses the current character's own tasks. */
export const chefTaskDelegationEvidence = professionalTaskDelegationEvidence;

export function applyChef(state: ChefState, out: ReturnType<typeof parseChef>, turnId: string, now = Date.now(), sourceTurnIds = state.queue, taskEvidence?: ReturnType<typeof chefTaskDelegationEvidence>) {
  completePrivateSocialTurn(state,out.socialResponse,out.parts,now,out.event);
  const at = new Date(now).toISOString();
  // Validate and apply a task before any chat content, memory or score becomes visible.
  const hidden = new Set(state.privateHistoryHiddenIds || []);
  const { sources, plans, contextSources, currentInterpretations } = taskEvidence || chefTaskDelegationEvidence(state, now, sourceTurnIds);
  assertProfessionalTaskCardOutput(state, out, {sources,plans,contextSources,currentInterpretations});
  const applied = applyProfessionalTaskOperation(state.professionalTasks ||= [], out.task, sources, plans, now, contextSources);
  if (out.event) applyRelationshipValues(state.values, out.event.deltas, out.event.kind, out.event.basis);
  const validIds = new Set(deliveredMessages(state.messages, now).filter(message => !hidden.has(message.id)).map(message => message.id));
  for (const part of out.parts) {
    const { replyTo, ...content } = part;
    state.messages.push({ id: crypto.randomUUID(), turnId, role: 'assistant', at, origin: 'chat', part: content,
      ...(replyTo && validIds.has(replyTo) ? { replyTo } : {}) });
  }
  if (applied?.created) state.messages.push({ id: applied.task.cardMessageId, turnId, role: 'assistant', at,
    origin: 'chat', part: { type: 'professional_task', taskId: applied.task.id } });
  else if (applied?.resent) {
    const cardMessageId = crypto.randomUUID();
    (applied.task.cardMessageIds ||= []).push(cardMessageId);
    state.messages.push({id:cardMessageId,turnId,role:'assistant',at,origin:'chat',part:{type:'professional_task',taskId:applied.task.id}});
  }
  // Only the input that produced this answer can support a newly stored memory.
  for (const memory of out.memories) {
    const source = [...sources].reverse().find(message => message.text.includes(memory.evidence));
    if (source && shouldSaveMemory(state.memories, memory))
      state.memories.push({ ...memory, id: crypto.randomUUID(), messageId: source.id, status: 'model_proposed' });
  }
  if (out.event) state.proposals.push({ at, evidence: out.event.evidence, kind: out.event.kind,
    reason: out.event.reason, status: out.event.basis === 'user_claim' ? 'applied' : 'pending' });
  return applied;
}

/** Archival migration only; never enqueue, replay, score or infer facts from old messages. */
export function importChefHistory(state: ChefState, incoming: LegacyChefMessage[], now = Date.now()) {
  let added = 0;
  for (const message of incoming) {
    if (state.messages.some(existing => existing.id === message.id)) continue;
    const dated = typeof message.at === 'string' && Number.isFinite(Date.parse(message.at));
    const legacyContent = {
      ...(message.image ? { image: message.image } : {}),
      ...(message.audio ? { audio: message.audio } : {}),
      ...(message.audioDurationSeconds !== undefined ? { audioDurationSeconds: message.audioDurationSeconds } : {}),
      ...(message.file ? { file: message.file } : {}),
    };
    state.messages.push({ id: message.id, turnId: `legacy:${message.id}`, role: 'user',
      at: dated ? message.at! : new Date(now).toISOString(), part: { type: 'text', text: message.text },
      ...(message.time ? { legacyTime: message.time } : {}), ...(!dated ? { chronologyUnknown: true } : {}),
      ...(Object.keys(legacyContent).length ? { legacyContent } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}) });
    state.completed.push(`legacy:${message.id}`);
    added++;
  }
  if (added) state.inputRevision++;
  return added;
}
