import {completePrivateSocialTurn} from './social-continuity';
import type { YuanProactive } from './yuan-proactive';
import type { ContactLife } from './contact-life';
import type { ChatMessage, Memory } from './contracts';
import { parseOutput } from './engine';
import { applyRelationshipValues } from './relationship-values';
import { shouldSaveMemory } from './expression-preferences';
export type YuanState = {
  characterId: 'yuan-xiaoman'; revision: number; branch: string;
  messages: ChatMessage[]; memories: Memory[];
  values: Record<string, number | null>;
  emotionStartedAt: number; romanceClosed: boolean;
  relationship: 'strangers';
  proposals: { at: string; evidence: string; kind: string; reason: string; status: 'pending' }[];
  queue: string[]; pending: { id: string; since: number } | null;
  completed: string[]; inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  error: string; retryAt: number;
  proactive?: YuanProactive;
  contactLife?: ContactLife;
};
export function createYuan(now = Date.now()): YuanState {
  return {
    characterId: 'yuan-xiaoman', revision: 0, branch: crypto.randomUUID(),
    messages: [], memories: [], relationship: 'strangers', romanceClosed: false,
    values: { familiarity: 10, affection: 5, trust: 0, comfort: 15, understood: 5, cooperation: 0, attraction: 0,
      safety: null, respect: null, sharedGrowth: null, heartbeat: null },
    emotionStartedAt: now, proposals: [], queue: [], pending: null, completed: [], inputRevision: 0,
    typing: {}, error: '', retryAt: 0,
  };
}
// Linear interpolation is an implementation choice for the confirmed 24-hour recovery.
// This only decays the initial career anxiety, never trust/respect/safety or later hurt.
export function yuanEmotion(s: YuanState, now = Date.now()) {
  return Math.min(0, -2 + 2 * Math.max(0, now - s.emotionStartedAt) / 86400000);
}
export function parseYuan(raw: unknown, incoming: string) {
  const output = parseOutput(raw, incoming, 'yuan-xiaoman');
  if (output.parts.some(p => p.type !== 'text' && p.type !== 'emoji' && p.type !== 'generated_photo' && p.type !== 'voice'))
    throw Error('袁小满尚无已接入的表情包素材');
  return output;
}
export function applyYuan(s: YuanState, out: ReturnType<typeof parseYuan>, turnId: string) {
  completePrivateSocialTurn(s,out.socialResponse,out.parts,Date.now(),out.event);
  const at = new Date().toISOString();
  if (out.event) applyRelationshipValues(s.values, out.event.deltas, out.event.kind, out.event.basis);
  for (const part of out.parts) s.messages.push({ id: crypto.randomUUID(), turnId, role: 'assistant', at, part, replyTo:s.messages.some(m=>m.id===part.replyTo)?part.replyTo:undefined });
  for (const memory of out.memories) {
    const message = [...s.messages].reverse().find(m => m.role === 'user' && 'text' in m.part && m.part.text.includes(memory.evidence));
    if (message && shouldSaveMemory(s.memories, memory))
      s.memories.push({ ...memory, id: crypto.randomUUID(), messageId: message.id, status: 'model_proposed' });
  }
  if (out.event) {
    const e = out.event;
    s.proposals.push({ at, evidence: e.evidence, kind: e.kind, reason: e.reason, status: 'pending' });
    // Event interpretation remains a proposal; no invented numeric weights or permanent lock from an unreviewed classification.
  }
}
