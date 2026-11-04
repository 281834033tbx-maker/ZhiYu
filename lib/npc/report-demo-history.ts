import type {ChatMessage} from './contracts';

/** Demonstration messages stay visible in chat, but are not user facts. */
export function isReportDemoMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const value = message as {part?: {type?: unknown}; secretaryEvent?: {id?: unknown}};
  return value.part?.type === 'daily_brief' || value.part?.type === 'weekly_report'
    || typeof value.secretaryEvent?.id === 'string' && value.secretaryEvent.id.startsWith('report-demo:');
}

/** Model input only: never use this helper for the public chat projection. */
export function modelHistoryMessages<T>(messages: readonly T[]): T[] {
  return messages.filter(message => !isReportDemoMessage(message));
}

/** A reply to a sample is discussion of that sample, not a health/expense record. */
export function factualHistoryMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const demoIds = new Set(messages.filter(isReportDemoMessage).map(message => message.id));
  return modelHistoryMessages(messages).filter(message => !message.replyTo || !demoIds.has(message.replyTo));
}
