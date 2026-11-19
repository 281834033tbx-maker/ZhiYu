import type {ChatMessage} from '../../lib/npc/contracts';
import {isReportDemoMessage, isReportDerivedMessage} from '../../lib/npc/report-demo-history';
import {deliveredMessages} from '../../lib/npc/delivery';

/** Preserve explicit quoting without presenting fixed samples as user history. */
export function reportDemoContext(messages: ChatMessage[], now = Date.now()): string {
  const visible = deliveredMessages(messages, now);
  const demos = new Map(visible.filter(isReportDemoMessage).map(message => [message.id, message]));
  const quoted = visible.slice(-100).filter(message => message.role === 'user' && message.replyTo && demos.has(message.replyTo))
    .map(message => ({userMessageId: message.id, replyTo: message.replyTo, demo: true, sample: demos.get(message.replyTo!)!.part}));
  const reports = new Map(visible.filter(message => isReportDerivedMessage(message) && !isReportDemoMessage(message)).map(message => [message.id, message]));
  const snapshots = visible.slice(-100).filter(message => message.role === 'user' && message.replyTo && reports.has(message.replyTo))
    .map(message => ({userMessageId: message.id, replyTo: message.replyTo, demo: false, snapshot: reports.get(message.replyTo!)!.part}));
  return [quoted.length ? `【用户正在引用固定演示样例，不是用户真实记录】${JSON.stringify(quoted)}\n这些是界面演示数据。只用于理解用户针对样例的问题，不能作为用户的体重、家人、日程、费用、行为、关系或计划事实，不据此写入记忆或推导任务。用户明确提出新的真实委托时，仍须按原有来源及确认规则单独核实。` : '',
    snapshots.length ? `【用户正在引用真实报告快照】${JSON.stringify(snapshots)}\n这些是系统根据已保存记录生成的简报、周报或其引用原文，是某一时点的汇总，不是新增测量、行为或委托。可以解释已有数字和来源，不把报告或转述再次写成用户事实、记忆或新任务。用户本轮明确更正数据或提出新委托，仍须按原有直接来源及确认规则分别核实；不要把缺失项补成事实。` : '',
  ].filter(Boolean).join('\n');
}
