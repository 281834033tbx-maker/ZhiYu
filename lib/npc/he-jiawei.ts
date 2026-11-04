import {factualHistoryMessages} from './report-demo-history';
import {completePrivateSocialTurn} from './social-continuity';
import type { ChatMessage, Memory } from './contracts';
import { deliveredMessages } from './delivery';
import { parseOutput } from './engine';
import { shouldSaveMemory } from './expression-preferences';
import { applyRelationshipValues, CORE_RELATIONSHIP_KEYS, type CoreRelationshipValues } from './relationship-values';

/** Preserve an old local clock label without inventing its missing date. */
export type LegacyHeContent = { image?: string; audio?: string; audioDurationSeconds?: number; file?: string };
export type HeMessage = ChatMessage & { legacyTime?: string; chronologyUnknown?: boolean; legacyContent?: LegacyHeContent };

export type HeState = {
  characterId: 'he-jiawei'; revision: number; branch: string;
  messages: HeMessage[]; memories: Memory[]; values: CoreRelationshipValues;
  relationship: 'strangers'; romanceClosed: boolean;
  proposals: { at: string; evidence: string; kind: string; reason: string; status: 'pending' | 'applied' }[];
  queue: string[]; pending: { id: string; since: number } | null;
  completed: string[]; inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  error: string; retryAt: number;
};

export function createHe(): HeState {
  return {
    characterId: 'he-jiawei', revision: 0, branch: crypto.randomUUID(),
    messages: [], memories: [], values: { familiarity: 0, affection: 0, trust: 0, comfort: 0 },
    relationship: 'strangers', romanceClosed: false, proposals: [],
    queue: [], pending: null, completed: [], inputRevision: 0,
    typing: {}, error: '', retryAt: 0,
  };
}

export function parseHe(raw: unknown, incoming: string) {
  const out = parseOutput(raw, incoming, 'he-jiawei');
  if (out.parts.some(part => part.type !== 'text' && part.type !== 'emoji'))
    throw Error('何嘉伟当前只支持文字与内置小表情');
  if (out.event && (Object.keys(out.event.deltas).some(key => !(CORE_RELATIONSHIP_KEYS as readonly string[]).includes(key)) || out.event.relationship || out.event.interaction))
    throw Error('何嘉伟提议了未开放的隐藏值或关系变更');
  return out;
}

export function applyHe(s: HeState, out: ReturnType<typeof parseHe>, turnId: string, now = Date.now()) {
  completePrivateSocialTurn(s,out.socialResponse,out.parts,now,out.event);
  const at = new Date(now).toISOString();
  if (out.event) applyRelationshipValues(s.values, out.event.deltas, out.event.kind, out.event.basis);
  const validIds = new Set(deliveredMessages(s.messages, now).map(message => message.id));
  for (const part of out.parts) {
    const { replyTo, ...content } = part;
    s.messages.push({ id: crypto.randomUUID(), turnId, role: 'assistant', at, origin: 'chat', part: content,
      ...(replyTo && validIds.has(replyTo) ? { replyTo } : {}) });
  }
  for (const memory of out.memories) {
    const source = [...factualHistoryMessages(s.messages)].reverse().find(message => message.role === 'user' && 'text' in message.part && message.part.text.includes(memory.evidence));
    if (source && shouldSaveMemory(s.memories, memory))
      s.memories.push({ ...memory, id: crypto.randomUUID(), messageId: source.id, status: 'model_proposed' });
  }
  if (out.event) s.proposals.push({ at, evidence: out.event.evidence, kind: out.event.kind,
    reason: out.event.reason, status: out.event.basis === 'user_claim' ? 'applied' : 'pending' });
}

export type LegacyHeMessage = { id: string; text: string; time: string; at?: string; mine?: boolean; replyTo?: string } & LegacyHeContent;

/** Import is archival only: no model replay, memory extraction or relationship scoring. */
export function importHeHistory(s: HeState, incoming: LegacyHeMessage[], now = Date.now()) {
  let added = 0;
  for (const message of incoming) {
    const known = s.messages.find(existing => existing.id === message.id);
    if (known) continue;
    const dated = typeof message.at === 'string' && Number.isFinite(Date.parse(message.at));
    const legacyContent: LegacyHeContent = {
      ...(message.image ? { image: message.image } : {}),
      ...(message.audio ? { audio: message.audio } : {}),
      ...(message.audioDurationSeconds !== undefined ? { audioDurationSeconds: message.audioDurationSeconds } : {}),
      ...(message.file ? { file: message.file } : {}),
    };
    s.messages.push({
      id: message.id, turnId: `legacy:${message.id}`, role: 'user',
      at: dated ? message.at! : new Date(now).toISOString(),
      part: { type: 'text', text: message.text },
      ...(message.time ? { legacyTime: message.time } : {}),
      ...(!dated ? { chronologyUnknown: true } : {}),
      ...(Object.keys(legacyContent).length ? { legacyContent } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    s.completed.push(`legacy:${message.id}`);
    added++;
  }
  if (added) s.inputRevision++;
  return added;
}
