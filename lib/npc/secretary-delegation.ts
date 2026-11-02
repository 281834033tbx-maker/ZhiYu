import type { ProfessionalTaskSource } from './professional-task';

/** A cross-chat authorization is an event with its real source, never a user bubble. */
export type SecretaryDelegationEvent = {
  id: string; targetId: string; goal: string; createdAt: string;
  source: { conversationId: string; messageId: string; text: string; at: string };
  mode: 'request' | 'weekly-renewal'; planMode?: 'new' | 'continue-plan' | 'confirm-plan';
  status: 'pending' | 'delivered'; messageIds: string[]; taskIds: string[];
  branch: string; deliveredAt?: string;
  previousPlan?: { id: string; title: string; steps: {title:string;scheduledDate?:string;instructions?:string[];details?:string[]}[] };
};
export type SecretaryDelegationState = {
  secretaryDelegations?: SecretaryDelegationEvent[];
  /** In-memory generation snapshot only; callers never persist this selector. */
  activeSecretaryDelegationId?: string;
};
export const SECRETARY_DELEGATION_INPUT_MARKER = '【应用核实的本轮秘书委托JSON】';

export function secretaryDelegationInputFromPrompt(prompt: string) {
  const line = prompt.split('\n').filter(line=>line.startsWith(SECRETARY_DELEGATION_INPUT_MARKER)).at(-1);
  if (!line) return null;
  try {
    const event = JSON.parse(line.slice(SECRETARY_DELEGATION_INPUT_MARKER.length)) as SecretaryDelegationEvent;
    if (!event || typeof event.id !== 'string' || typeof event.targetId !== 'string' || typeof event.goal !== 'string'
      || event.source?.conversationId !== 'molly-system-secretary' || typeof event.source.messageId !== 'string'
      || typeof event.source.text !== 'string' || !Number.isFinite(Date.parse(event.source.at))) return null;
    return {text:event.source.text,goal:event.goal,sourceMessageId:event.source.messageId,targetId:event.targetId,delegationId:event.id};
  } catch {return null;}
}

export function secretaryTaskSource(event: SecretaryDelegationEvent): ProfessionalTaskSource {
  return { id: event.source.messageId, text: event.source.text, at: event.source.at,
    secretaryDelegation: { id: event.id, sourceConversationId: event.source.conversationId,
      sourceMessageId: event.source.messageId, targetId: event.targetId, goal: event.goal } };
}

export function secretaryDelegationContext(input: object) {
  const state = input as SecretaryDelegationState;
  const events = (state.secretaryDelegations || []).filter(event => event.status === 'delivered'
    || event.id === state.activeSecretaryDelegationId).slice(-8);
  return events.length ? '\n【有来源的秘书转交事件；不是用户在本会话发言】' + JSON.stringify(events)
    + '\nMolly已得到用户委托，把上述目标转给本人。已知条件直接承接，只问真正影响执行的未知条件；不再让用户复述目标、索要联系人或重新授权。保持本人语气，不能冒称用户已经在此发言，也不能把转交本身记作关系变化。只承接本人的职责，不自动建群或代替其他专业人物。'
    : '';
}
