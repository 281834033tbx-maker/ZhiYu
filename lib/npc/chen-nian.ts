import {factualHistoryMessages} from './report-demo-history';
import {completePrivateSocialTurn} from './social-continuity';
import type { ChatMessage, Memory } from './contracts';
import { parseOutput } from './engine';
import { applyRelationshipValues, RELATIONSHIP_UNLOCKS } from './relationship-values';
import { shouldSaveMemory } from './expression-preferences';
import { applyProfessionalTaskOperation, parseProfessionalTaskOperation, type ProfessionalTask, type ProfessionalTaskEvent } from './professional-task';
import { assertProfessionalTaskCardOutput, professionalTaskDelegationEvidence } from './professional-task-chat';
import { deliveredMessages } from './delivery';

export const CHEN_POSITIVE_KEYS = [
  'familiarity', 'affection', 'trust', 'comfort',
  'understood', 'cooperation', 'attraction',
] as const;
export type ChenPositiveKey = (typeof CHEN_POSITIVE_KEYS)[number];
type ChenPositiveGrowth = Record<ChenPositiveKey, number>;
type ChenShareState = {
  enabled: boolean;
  quietUntil: number;
  unlockedAt: number;
  nextAt: number;
  shareCount: number;
  lastSentAt: number;
  lastSentDay: string;
  sentAssets: Array<'chenWorkdesk' | 'chenRainySelfie'>;
};

const emptyGrowth = (): ChenPositiveGrowth => ({
  familiarity: 0, affection: 0, trust: 0, comfort: 0,
  understood: 0, cooperation: 0, attraction: 0,
});
const emptyShareState = (): ChenShareState => ({
  enabled: true, quietUntil: 0,
  unlockedAt: 0, nextAt: 0, shareCount: 0, lastSentAt: 0,
  lastSentDay: '', sentAssets: [],
});

export type ChenState = {
  characterId: 'chen-nian'; revision: number; branch: string;
  messages: ChatMessage[]; memories: Memory[]; values: Record<string, number>;
  initialRelationship: 'strangers'; relationship: 'strangers' | 'lovers'; careerStage: 'A';
  userNickname: string;
  showerFollowUp: { dueAt: number; sourceTurnId: string; activity: string } | null;
  argumentPause: { sinceTurnId: string; sinceAt: string } | null;
  positiveGrowth: ChenPositiveGrowth;
  shareState: ChenShareState;
  proposals: { at: string; evidence: string; kind: string; reason: string; status: 'pending' | 'applied' }[];
  queue: string[]; pending: { id: string; since: number } | null;
  completed: string[]; inputRevision: number;
  typing: Record<string, { sequence: number; until: number }>;
  privateHistoryHiddenIds?: string[];
  professionalTasks: ProfessionalTask[]; taskEvents: ProfessionalTaskEvent[];
  taskMutations: {id:string;payload:string}[];
  error: string; retryAt: number;
};

export function createChen(): ChenState {
  return {
    characterId: 'chen-nian', revision: 0, branch: crypto.randomUUID(),
    messages: [], memories: [], values: { familiarity: 0, affection: 0, trust: 0, comfort: 0 }, initialRelationship: 'strangers', relationship: 'strangers', careerStage: 'A',
    userNickname: '', showerFollowUp: null, argumentPause: null,
    positiveGrowth: emptyGrowth(), shareState: emptyShareState(),
    proposals: [], queue: [], pending: null, completed: [], inputRevision: 0,
    typing: {}, error: '', retryAt: 0, professionalTasks: [], taskEvents: [], taskMutations: [],
  };
}

export const CHEN_SHOWER_FOLLOW_UP_MS = 30 * 60 * 1000;

export function normalizeChen(s: ChenState): ChenState {
  s.values ||= { familiarity: 0, affection: 0, trust: 0, comfort: 0 };
  s.relationship ||= 'strangers';
  s.userNickname ||= '';
  s.showerFollowUp ||= null;
  s.argumentPause ||= null;
  s.positiveGrowth = { ...emptyGrowth(), ...s.positiveGrowth };
  s.shareState = { ...emptyShareState(), ...s.shareState };
  s.professionalTasks ||= []; s.taskEvents ||= []; s.taskMutations ||= [];
  return s;
}

export const CHEN_SHARE_GROWTH_THRESHOLD = 30;
export const CHEN_SHARE_REQUIRED_KEYS = Math.ceil(CHEN_POSITIVE_KEYS.length / 2);
export const CHEN_SHARE_INTERVAL_MS = 36 * 60 * 60 * 1000;

export function chenSharingEligible(s: ChenState) {
  return Object.entries(RELATIONSHIP_UNLOCKS.dailyPhoto).every(([key, threshold]) => s.values[key] >= threshold);
}

export function setChenPositiveGrowth(
  s: ChenState,
  growth: Partial<ChenPositiveGrowth>,
  now = Date.now(),
) {
  let changed = false;
  for (const key of CHEN_POSITIVE_KEYS) {
    const incoming = growth[key];
    if (typeof incoming !== 'number' || !Number.isFinite(incoming)) continue;
    const value = Math.max(-100, Math.min(100, Math.round(incoming)));
    if (s.positiveGrowth[key] !== value) {
      s.positiveGrowth[key] = value;
      changed = true;
    }
  }
  for (const key of ['familiarity', 'affection', 'trust', 'comfort'] as const) {
    if (typeof growth[key] === 'number') s.values[key] = Math.max(0, Math.min(100, Math.round(growth[key]! * 2)));
  }
  if (
    s.relationship === 'strangers' &&
    chenSharingEligible(s) &&
    !s.shareState.unlockedAt
  ) {
    s.shareState.unlockedAt = now;
    s.shareState.nextAt = now;
    changed = true;
  }
  return changed;
}

function shenzhenDay(now: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function deliverChenLifeShare(s: ChenState, now = Date.now()) {
  if (
    !s.shareState.unlockedAt ||
    !s.shareState.enabled ||
    s.shareState.quietUntil > now ||
    s.shareState.nextAt > now ||
    s.argumentPause ||
    !chenSharingEligible(s) ||
    s.shareState.lastSentDay === shenzhenDay(now)
  ) return false;
  const available = (['chenWorkdesk', 'chenRainySelfie'] as const)
    .filter(assetId => !s.shareState.sentAssets.includes(assetId));
  const assetId = available[0];
  if (!assetId) return false;
  const text = assetId === 'chenWorkdesk'
    ? '搁工作室忙半天，桌子先有创业样了。'
    : '出来整口吃的。雨挺大，给我拍得跟逃难似的。';
  const turnId = `life-share-${s.shareState.shareCount + 1}`;
  const at = new Date(now).toISOString();
  s.messages.push(
    { id: crypto.randomUUID(), turnId, role: 'assistant', at, origin: 'proactive', part: { type: 'text', text } },
    { id: crypto.randomUUID(), turnId, role: 'assistant', at, origin: 'proactive', part: { type: 'photo', assetId } },
  );
  s.shareState.sentAssets.push(assetId);
  s.shareState.shareCount++;
  s.shareState.lastSentAt = now;
  s.shareState.lastSentDay = shenzhenDay(now);
  s.shareState.nextAt = now + CHEN_SHARE_INTERVAL_MS;
  return true;
}

function nicknameFrom(text: string) {
  return /(?:我叫|以后叫我|叫我)([\p{L}\p{N}_·]{1,12})/u.exec(text)?.[1] || '';
}

function awayActivityFrom(text: string) {
  if (/(?:洗完|洗好|刚洗|已经洗|吃完|忙完|回来了|弄完了)/.test(text)) return '';
  const match = /(?:我)?(?:先去|先|要去?|准备去?|得去|去)\s*(洗个澡|洗澡|冲个澡|冲澡|吃饭|做饭|运动|跑步|取快递|收拾一下|收拾|忙一会儿|忙一下)/.exec(text);
  if (!match) return '';
  if (/(?:洗|冲).*澡/.test(match[1])) return '洗澡';
  if (match[1].startsWith('忙')) return '忙';
  return match[1].replace('一下', '');
}

export function updateChenShowerFollowUp(
  s: ChenState,
  text: string,
  turnId: string,
  now = Date.now(),
) {
  const nickname = nicknameFrom(text);
  if (nickname) s.userNickname = nickname;
  if (/(?:别|不要|停止).*主动.*(?:找我|发消息|联系)|别再主动/.test(text))
    s.shareState.enabled = false;
  if (/(?:可以|恢复|继续).*主动.*(?:找我|发消息|联系)/.test(text))
    s.shareState.enabled = true;
  if (/我(?:现在|先|有点|在)?忙|先别打扰/.test(text))
    s.shareState.quietUntil = now + 2 * 60 * 60 * 1000;
  // Any later user message means the user is back and cancels the previous timer.
  if (s.showerFollowUp) s.showerFollowUp = null;
  if (s.argumentPause) return;
  const activity = awayActivityFrom(text);
  if (activity)
    s.showerFollowUp = {
      dueAt: now + CHEN_SHOWER_FOLLOW_UP_MS,
      sourceTurnId: turnId,
      activity,
    };
}

export function deliverChenShowerFollowUp(s: ChenState, now = Date.now()) {
  if (s.argumentPause || !s.showerFollowUp || s.showerFollowUp.dueAt > now) return false;
  const nickname = s.userNickname ? `${s.userNickname}，` : '';
  const { sourceTurnId, activity } = s.showerFollowUp;
  const activityLine = activity === '忙'
    ? `${nickname}你忙啥呢，怎么这么这么久啊`
    : `${nickname}你${activity}怎么要这么这么久啊`;
  const texts = s.relationship === 'lovers'
    ? [
        `${nickname}还没回来啊`,
        activityLine,
        '臭宝，臭宝',
        '[表情包｜一只小狗趴在门口，配字：望眼欲穿]',
      ]
    : [
        `${nickname}还没回来啊？`,
        '[表情包｜一只塑料袋扒着门框，配字：我寻思人呢]',
      ];
  const turnId = `away-follow-up-${sourceTurnId}`;
  for (const text of texts) {
    s.messages.push({
      id: crypto.randomUUID(),
      turnId,
      role: 'assistant',
      at: new Date(now).toISOString(),
      origin: 'proactive',
      part: { type: 'text', text },
    });
  }
  s.showerFollowUp = null;
  return true;
}

export function parseChen(raw: unknown, incoming: string) {
  const out = parseOutput(raw, incoming, 'chen-nian');
  if (out.parts.some(p =>
    !(['text', 'emoji', 'choice'].includes(p.type) ||
      (p.type === 'photo' && ['chenWorkdesk', 'chenRainySelfie'].includes(p.assetId)))
  )) throw Error('陈年只支持文字、表情和已授权生活照片');
  if (out.event && (Object.keys(out.event.deltas).some(key => !['familiarity', 'affection', 'trust', 'comfort'].includes(key)) || out.event.relationship || out.event.interaction))
    throw Error('陈年提议了未开放的隐藏值或关系变更');
  const task = parseProfessionalTaskOperation(raw && typeof raw === 'object' ? (raw as {task?:unknown}).task : undefined);
  return {...out,task};
}

export const chenTaskDelegationEvidence = professionalTaskDelegationEvidence;

export function applyChen(s: ChenState, out: ReturnType<typeof parseChen>, turnId: string, now = Date.now(), sourceTurnIds = s.queue, taskEvidence?: ReturnType<typeof chenTaskDelegationEvidence>) {
  completePrivateSocialTurn(s,out.socialResponse,out.parts,now,out.event);
  const at = new Date(now).toISOString();
  const evidence = taskEvidence || chenTaskDelegationEvidence(s, now, sourceTurnIds);
  assertProfessionalTaskCardOutput(s, out, evidence);
  const applied = applyProfessionalTaskOperation(s.professionalTasks, out.task, evidence.sources, evidence.plans, now, evidence.contextSources, 'chen-nian');
  if (out.event) applyRelationshipValues(s.values, out.event.deltas, out.event.kind, out.event.basis);
  if (s.relationship === 'strangers' && chenSharingEligible(s) && !s.shareState.unlockedAt) {
    s.shareState.unlockedAt = now; s.shareState.nextAt = s.shareState.unlockedAt;
  }
  const hidden = new Set(s.privateHistoryHiddenIds || []);
  const validIds = new Set(deliveredMessages(s.messages,now).filter(m=>!hidden.has(m.id)).map(m => m.id));
  for (const part of out.parts) {
    const { replyTo, ...content } = part;
    s.messages.push({ id: crypto.randomUUID(), turnId, role: 'assistant', at, part: content,
      ...(replyTo && validIds.has(replyTo) ? { replyTo } : {}) });
  }
  if (applied?.created) s.messages.push({id:applied.task.cardMessageId,turnId,role:'assistant',at,origin:'chat',part:{type:'professional_task',taskId:applied.task.id}});
  else if (applied?.resent) {
    const cardMessageId = crypto.randomUUID();
    (applied.task.cardMessageIds ||= []).push(cardMessageId);
    s.messages.push({id:cardMessageId,turnId,role:'assistant',at,origin:'chat',part:{type:'professional_task',taskId:applied.task.id}});
  }
  for (const memory of out.memories) {
    const message = [...factualHistoryMessages(s.messages)].reverse().find(m => m.role === 'user' && 'text' in m.part && m.part.text.includes(memory.evidence));
    if (message && shouldSaveMemory(s.memories, memory))
      s.memories.push({ ...memory, id: crypto.randomUUID(), messageId: message.id, status: 'model_proposed' });
  }
  if (out.action === 'end_conversation' && out.event?.kind === 'harm') {
    s.argumentPause = { sinceTurnId: turnId, sinceAt: at };
    s.showerFollowUp = null;
  } else if (s.argumentPause && out.action === 'reply') {
    s.argumentPause = null;
  }
  if (out.event) s.proposals.push({ at, evidence: out.event.evidence, kind: out.event.kind, reason: out.event.reason, status: out.event.basis === 'user_claim' ? 'applied' : 'pending' });
  return applied;
}
