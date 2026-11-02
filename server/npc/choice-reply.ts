import {allowsCharacterChoice} from '../../lib/npc/character-output-policy';
import type { ChatMessage } from '../../lib/npc/contracts';
import { privateHistoryMessages } from './private-history';

export class ChoiceReplyError extends Error {
  constructor(readonly status: number, message: string) {super(message); this.name = 'ChoiceReplyError';}
}

/** Validate against this account's visible history; commit only with the new input's save. */
export function prepareChoiceReply(state: {characterId?: string; messages: ChatMessage[]; completed: string[]}, body: Record<string, unknown>, now = Date.now(), characterId = state.characterId) {
  if (body.choice === undefined) return null;
  if (characterId && !allowsCharacterChoice(characterId))
    throw new ChoiceReplyError(403, '陪伴型人物不提供选择式对话，请直接发消息。');
  const input = body.choice as Record<string, unknown>;
  if (body.action !== 'send' || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['messageId', 'index'].includes(key))
    || typeof input.messageId !== 'string' || !input.messageId || input.messageId.length > 160
    || !Number.isInteger(input.index) || typeof body.turnId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.turnId)
    || ['imageId', 'audioId', 'assetId', 'fileId', 'file', 'image', 'audio'].some(key => body[key] !== undefined))
    throw new ChoiceReplyError(400, '无效选择');
  const target = privateHistoryMessages(state).find(message => message.id === input.messageId);
  if (!target || target.role !== 'assistant' || target.part.type !== 'choice' || (target.deliverAt || 0) > now)
    throw new ChoiceReplyError(400, '选择消息不存在于当前已送达对话');
  const part = target.part, index = input.index as number;
  if (index < 0 || index >= part.options.length) throw new ChoiceReplyError(400, '选项不存在');
  const text = part.options[index];
  if (body.replyTo !== undefined && body.replyTo !== target.id)
    throw new ChoiceReplyError(400, '选择引用与问题不一致');
  // Client text is never authoritative. No arbitrary text may ride a valid selection.
  if (body.text !== undefined && body.text !== text) throw new ChoiceReplyError(400, '选择文字与选项不一致');
  const prior = state.messages.find(message => message.role === 'user' && message.turnId === body.turnId);
  if (part.selection || prior || state.completed.includes(body.turnId)) {
    if (!part.selection || part.selection.turnId !== body.turnId || part.selection.index !== index || !prior
      || !('text' in prior.part) || prior.part.text !== text || prior.replyTo !== target.id)
      throw new ChoiceReplyError(409, '这个问题已经选择过，或消息编号与现有记录冲突');
    body.text = text; body.replyTo = target.id;
    return {duplicate: true, commit: () => {}};
  }
  body.text = text; body.replyTo = target.id;
  return {duplicate: false, commit: () => {part.selection = {index, turnId: body.turnId as string, at: new Date(now).toISOString()};}};
}
