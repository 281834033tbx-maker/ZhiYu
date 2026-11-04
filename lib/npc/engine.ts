import {factualHistoryMessages} from './report-demo-history';
import {parseSocialResponse,completePrivateSocialTurn} from './social-continuity';
import {parseChoicePart} from './choice-chat';
import {assertCharacterDialogueOutput} from './character-output-policy';
import {
  assets,
  labels,
  type Part,
  type EventProposal,
  type NpcState,
  type ValueKey,
} from './contracts';
import { applyRelationshipValues } from './relationship-values';
import { parseExpressionPreference, shouldSaveMemory } from './expression-preferences';

// Transport guards, not personality quotas. Over-limit replies fail instead of losing content.
export const MAX_REPLY_MESSAGES = 30;
export const MAX_REPLY_TEXT_CHARS = 24_000;

export const createState = (mode: 'normal' | 'test'): NpcState => {
  const values = {
    familiarity: 0,
    affection: 15,
    trust: 10,
    comfort: 45,
    understood: 0,
    cooperation: 10,
    attraction: 0,
    love: 0,
    openness: 80,
    recognition: 10,
    safety: 40,
    mood: 70,
    energy: 60,
    sharing: 65,
    exclusivity: 10,
    jealousy: 0,
    dissatisfaction: 0,
    stress: 25,
    busy: 20,
  };
  if (mode === 'test')
    for (const k of Object.keys(values).slice(0, 14))
      values[k as ValueKey] = 80;
  return {
    characterId: 'xia-xia',
    mode,
    branch: crypto.randomUUID(),
    revision: 0,
    values,
    wealth: null,
    relationship: mode === 'test' ? 'lovers' : 'strangers',
    paused: false,
    cooldownUntil: 0,
    interaction: 'ready',
    config: {
      scoring: 'review',
      cooldownHours: 3,
      provenance: 'assistant_proposed',
    },
    messages: [],
    memories: [],
    audits: [],
    impressions: [],
    completed: [],
    pending: null,
  };
};
function object(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== 'object' || Array.isArray(x))
    throw new Error('模型返回格式不正确');
  return x as Record<string, unknown>;
}
function short(x: unknown, max = 600): string {
  return typeof x === 'string' ? x.trim().slice(0, max) : '';
}
export function validatePart(input: unknown): Part {
  const p = object(input);
  if (p.type === 'choice') return parseChoicePart(input);
  if ((p.type === 'text' || p.type === 'emoji') && typeof p.text === 'string' && p.text.length > MAX_REPLY_TEXT_CHARS)
    throw new Error('模型消息文本超出传输上限，未截断或发送部分内容');
  if(p.type==='voice'&&typeof p.text==='string'&&p.text.trim()&&p.text.length<=600)return {type:'voice',text:p.text.trim(),status:'pending',synthetic:true,...(typeof p.replyTo==='string'?{replyTo:p.replyTo}:{})};
  if(p.type==='generate_photo' && typeof p.prompt==='string' && p.prompt.trim() && p.prompt.length<=1800) {
    return {type:'generated_photo',jobId:crypto.randomUUID(),prompt:p.prompt.trim(),caption:short(p.caption,200),withCharacter:p.withCharacter===true,status:'pending',attempts:0,...(typeof p.replyTo==='string'?{replyTo:p.replyTo}:{})};
  }
  if (
    (p.type === 'text' || p.type === 'emoji') &&
    typeof p.text === 'string' &&
    p.text.trim() &&
    p.text.length <= MAX_REPLY_TEXT_CHARS
  )
    return { type: p.type, text: p.text.trim(), ...(typeof p.replyTo==='string'?{replyTo:p.replyTo}:{}) };
  if (
    (p.type === 'photo' || p.type === 'sticker') &&
    typeof p.assetId === 'string' &&
    Object.hasOwn(assets, p.assetId) &&
    assets[p.assetId as keyof typeof assets].kind === p.type
  )
    return { type: p.type, assetId: p.assetId as keyof typeof assets, ...(typeof p.replyTo==='string'?{replyTo:p.replyTo}:{}) };
  throw new Error('不支持的消息或素材');
}
export function parseOutput(input: unknown, userText: string, characterId = 'xia-xia') {
  assertCharacterDialogueOutput(characterId, input);
  const p = object(input);
  if (!['reply', 'silent', 'end_conversation'].includes(String(p.action)))
    throw new Error('缺少有效回复动作');
  if (!Array.isArray(p.messages) || p.messages.length > MAX_REPLY_MESSAGES)
    throw new Error('模型消息数量无效');
  const parts = p.messages.map(validatePart);
  const textChars = parts.reduce((total, part) => total + ('text' in part ? part.text.length + (part.type === 'choice' ? part.options.join('').length : 0) : 0), 0);
  if (textChars > MAX_REPLY_TEXT_CHARS)
    throw new Error('模型回复文本超出传输上限，未截断或发送部分内容');
  if(parts.filter(part=>part.type==='voice').length>1)throw Error('每轮最多一条语音');
  if(parts.filter(part=>part.type==='generated_photo').length>1)throw Error('每轮最多生成一张照片');
  if (
    (p.action === 'reply' && !parts.length) ||
    (p.action === 'silent' && parts.length)
  )
    throw new Error('动作和消息不一致');
  let event: EventProposal | undefined;
  if (p.event) {
    const e = object(p.event),
      evidence = short(e.evidence),
      reason = short(e.reason);
    // Evidence must be a real quotation from THIS turn. Model judgments remain proposals.
    if (
      evidence &&
      userText.includes(evidence) &&
      reason &&
      ['ordinary', 'betrayal', 'harm', 'repair', 'fatigue'].includes(
        String(e.kind),
      ) &&
      ['user_claim', 'hypothesis'].includes(String(e.basis))
    ) {
      const deltas: Partial<Record<ValueKey, number>> = {};
      for (const [key, value] of Object.entries(object(e.deltas || {}))) {
        if (
          !Object.hasOwn(labels, key) ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          Math.abs(value) > 100
        )
          throw new Error('模型提出了无效数值');
        deltas[key as ValueKey] = value;
      }
      event = {
        kind: e.kind as EventProposal['kind'],
        basis: e.basis as EventProposal['basis'],
        evidence,
        reason,
        deltas,
        ...(['crisis', 'repairing', 'broken_up'].includes(
          String(e.relationship),
        )
          ? { relationship: e.relationship as EventProposal['relationship'] }
          : {}),
        ...(e.interaction === 'cooldown'
          ? { interaction: 'cooldown' as const }
          : {}),
        impression: short(e.impression, 160),
      };
    }
  }
  const memories = (Array.isArray(p.memories) ? p.memories : [])
    .slice(0, 4)
    .flatMap((raw) => {
      const m = object(raw),
        evidence = short(m.evidence),
        text = short(m.text, 300);
      const preference = parseExpressionPreference(m.preference, String(m.kind), evidence);
      return evidence &&
        userText.includes(evidence) &&
        text &&
        ['user_claim', 'hypothesis', 'character_inference'].includes(
          String(m.kind),
        )
        ? [
            {
              text,
              evidence,
              kind: m.kind as
                | 'user_claim'
                | 'hypothesis'
                | 'character_inference',
              ...(preference ? { preference } : {}),
            },
          ]
        : [];
    });
  const socialResponse=parseSocialResponse(p.socialResponse);
  return { parts, event, memories, action: p.action, ...(socialResponse?{socialResponse}:{}) };
}
export function applyProposal(
  state: NpcState,
  event: EventProposal,
  scoring: 'draft-a' | 'draft-b',
) {
  // The two conflicting Q29 options are explicit developer choices, never production defaults.
  if (event.basis === 'hypothesis') return;
  const cap =
    scoring === 'draft-b' && ['betrayal', 'harm'].includes(event.kind)
      ? 70
      : 15;
  for (const [key, delta] of Object.entries(event.deltas)) {
    const k = key as ValueKey;
    state.values[k] = Math.max(
      0,
      Math.min(100, state.values[k] + Math.max(-cap, Math.min(cap, delta!))),
    );
  }
}
export function finishTurn(
  state: NpcState,
  turnId: string,
  userText: string,
  output: ReturnType<typeof parseOutput>,
  time = Date.now(),
  recordUser = true,
) {
  if (state.completed.includes(turnId)) return;
  completePrivateSocialTurn(state,output.socialResponse,output.parts,time,output.event);
  const at = new Date(time).toISOString(),
    before = { ...state.values };
  const user = {
    id: crypto.randomUUID(),
    turnId,
    role: 'user' as const,
    at,
    part: { type: 'text' as const, text: userText },
  };
  state.messages.push(
    ...(recordUser ? [user] : []),
    ...output.parts.map((part) => ({
      id: crypto.randomUUID(),
      turnId,
      role: 'assistant' as const,
      at,
      part,
      replyTo: state.messages.some(m=>m.id===part.replyTo)?part.replyTo:undefined,
    })),
  );
  const e = output.event;
  if (e) {
    // A model classification never makes a hypothesis a fact. Relationship decisions are event-based.
    if (e.basis !== 'hypothesis') {
      if (
        state.relationship !== 'strangers' &&
        state.relationship !== 'broken_up'
      ) {
        if (['betrayal', 'harm'].includes(e.kind))
          state.relationship = 'crisis';
        if (
          e.relationship === 'broken_up' &&
          ['betrayal', 'harm'].includes(e.kind) &&
          output.parts.some(
            (p) => p.type === 'text' && /分手|结束这段关系/.test(p.text),
          )
        )
          state.relationship = 'broken_up';
        if (
          e.relationship === 'repairing' &&
          e.kind === 'repair' &&
          state.relationship === 'crisis'
        )
          state.relationship = 'repairing';
      }
      if (state.mode === 'test' && state.config.scoring !== 'review')
        applyProposal(state, e, state.config.scoring);
      if (state.mode === 'normal')
        applyRelationshipValues(state.values, e.deltas, e.kind, e.basis);
      if (
        e.interaction === 'cooldown' &&
        output.action === 'end_conversation'
      ) {
        state.interaction = 'cooldown';
        state.cooldownUntil = time + state.config.cooldownHours * 3600000;
      }
      if (e.impression)
        state.impressions.push({
          text: e.impression,
          evidence: e.evidence,
          confidence: 'model_proposed',
          at,
        });
    }
    state.audits.push({
      id: crypto.randomUUID(),
      at,
      before,
      after: { ...state.values },
      reason: e.reason,
      source:
        state.mode === 'normal'
          ? 'evidence-scoring-v1'
          : 'model_proposed / ' + state.config.scoring,
      proposal: e,
      review:
        state.mode === 'normal' && e.basis === 'user_claim'
          ? 'applied'
          :
        state.mode === 'test' &&
        state.config.scoring !== 'review' &&
        e.basis !== 'hypothesis'
          ? 'applied'
          : 'pending',
    });
  } else
    state.audits.push({
      id: crypto.randomUUID(),
      at,
      before,
      after: { ...state.values },
      reason: '无可验证的事件提案，保持数值',
      source: 'program',
    });
  for (const m of output.memories) {
    const source = recordUser ? user : [...state.messages].reverse().find(message => message.role === 'user' && 'text' in message.part && message.part.text.includes(m.evidence));
    if (source && !factualHistoryMessages(state.messages).some(message => message.id === source.id)) continue;
    if (
      shouldSaveMemory(state.memories, m)
    )
      state.memories.push({
        ...m,
        id: crypto.randomUUID(),
        messageId: source?.id || user.id,
        status: 'model_proposed',
      });
  }
  state.completed.push(turnId);
  state.pending = null;
}
export function control(
  state: NpcState,
  body: Record<string, unknown>,
): NpcState {
  const before = { ...state.values };
  if (body.action === 'reset')
    return { ...createState('test'), revision: state.revision };
  if (body.action === 'pause') state.paused = true;
  else if (body.action === 'resume') state.paused = false;
  else if (body.action === 'values') {
    for (const [key, val] of Object.entries(object(body.values))) {
      if (
        !Object.hasOwn(labels, key) ||
        typeof val !== 'number' ||
        !Number.isFinite(val) ||
        val < 0 ||
        val > 100
      )
        throw new Error('数值必须为 0–100');
      state.values[key as ValueKey] = val;
    }
  } else if (body.action === 'config') {
    if (!['review', 'draft-a', 'draft-b'].includes(String(body.scoring)))
      throw new Error('未知计分版本');
    if (
      typeof body.cooldownHours !== 'number' ||
      body.cooldownHours < 0.01 ||
      body.cooldownHours > 72
    )
      throw new Error('冷却草案须为 0.01–72 小时');
    state.config.scoring = body.scoring as NpcState['config']['scoring'];
    state.config.cooldownHours = body.cooldownHours;
  } else if (body.action === 'review') {
    const audit = state.audits.find(
      (a) => a.id === body.id && a.review === 'pending',
    );
    if (
      !audit?.proposal ||
      !['draft-a', 'draft-b', 'reject'].includes(String(body.choice))
    )
      throw new Error('提案不存在或已处理');
    if (body.choice !== 'reject')
      applyProposal(
        state,
        audit.proposal,
        body.choice as 'draft-a' | 'draft-b',
      );
    audit.review = body.choice === 'reject' ? 'rejected' : 'applied';
  } else throw new Error('未知调试操作');
  state.pending = null;
  state.audits.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    reason: `开发者操作：${String(body.action)}${typeof body.choice === 'string' ? ' / ' + body.choice : ''}`,
    before,
    after: { ...state.values },
    source: 'operator_override',
  });
  return state;
}
