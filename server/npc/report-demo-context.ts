import type {ChatMessage} from '../../lib/npc/contracts';
import {isReportDemoMessage} from '../../lib/npc/report-demo-history';
import {deliveredMessages} from '../../lib/npc/delivery';

/** Preserve explicit quoting without presenting fixed samples as user history. */
export function reportDemoContext(messages: ChatMessage[], now = Date.now()): string {
  const visible = deliveredMessages(messages, now);
  const demos = new Map(visible.filter(isReportDemoMessage).map(message => [message.id, message]));
  const quoted = visible.slice(-100).filter(message => message.role === 'user' && message.replyTo && demos.has(message.replyTo))
    .map(message => ({userMessageId: message.id, replyTo: message.replyTo, demo: true, sample: demos.get(message.replyTo!)!.part}));
  if (!quoted.length) return '';
  return `【用户正在引用固定演示样例，不是用户真实记录】${JSON.stringify(quoted)}\n这些是界面演示数据。只用于理解用户针对样例的问题，不能作为用户的体重、家人、日程、费用、行为、关系或计划事实，不据此写入记忆或推导任务。用户明确提出新的真实委托时，仍须按原有来源及确认规则单独核实。`;
}
