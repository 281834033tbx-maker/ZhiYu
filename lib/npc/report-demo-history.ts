import type {ChatMessage} from './contracts';

export function isScheduledReportMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const id = (message as {secretaryEvent?: {id?: unknown}}).secretaryEvent?.id;
  return typeof id === 'string' && id.startsWith('scheduled-report:v1:');
}

export function isReportCardMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const type = (message as {part?: {type?: unknown}}).part?.type;
  return type === 'daily_brief' || type === 'weekly_report' || type === 'secretary_report';
}

/** Demonstration messages stay visible in chat, but are not user facts. */
export function isReportDemoMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const value = message as {part?: {type?: unknown}; secretaryEvent?: {id?: unknown}};
  return !isScheduledReportMessage(message) && (value.part?.type === 'daily_brief' || value.part?.type === 'weekly_report'
    || typeof value.secretaryEvent?.id === 'string' && value.secretaryEvent.id.startsWith('report-demo:'));
}

/** Summaries and their copied quotations are derived presentation, including
 * genuine scheduled snapshots; they are never fresh measurement evidence. */
export function isReportDerivedMessage(message: unknown): boolean {
  return isReportDemoMessage(message) || isReportCardMessage(message) || isScheduledReportMessage(message);
}

/** Model input only: never use this helper for the public chat projection. */
export function modelHistoryMessages<T>(messages: readonly T[]): T[] {
  return messages.filter(message => !isReportDerivedMessage(message));
}

/** Discussion of a report is not a new health/expense record. A separate,
 * directly sourced user statement can still pass the normal evidence checks. */
export function factualHistoryMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const derivedIds = new Set(messages.filter(isReportDerivedMessage).map(message => message.id));
  return modelHistoryMessages(messages).filter(message => !message.replyTo || !derivedIds.has(message.replyTo));
}
