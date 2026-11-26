/** A choice is a user reply affordance, never a task or an executable command. */
export type ChoicePart = {
  type: 'choice';
  /** Server-owned mock selection; excluded from real conversation generation. */
  reportDemoChoice?: {messageId:string;pendingId:string};
  text: string;
  options: string[];
  /** Server-owned: written atomically with the corresponding user reply. */
  selection?: { index: number; turnId: string; at: string };
};

export function parseChoicePart(value: unknown): ChoicePart & {replyTo?: string} {
  const part = value as Record<string, unknown>;
  if (!part || typeof part !== 'object' || Array.isArray(part) || part.type !== 'choice'
    || Object.keys(part).some(key => !['type', 'text', 'options', 'replyTo'].includes(key))
    || typeof part.text !== 'string' || !part.text.trim() || part.text.length > 160
    || !Array.isArray(part.options) || part.options.length < 2 || part.options.length > 6
    || part.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 80)
    || new Set(part.options.map(option => (option as string).trim())).size !== part.options.length
    || (part.replyTo !== undefined && (typeof part.replyTo !== 'string' || !part.replyTo.trim() || part.replyTo.length > 160)))
    throw new Error('选择消息格式无效：需一个短问题及 2 至 6 个不重复选项，不能预设用户选择');
  return {type: 'choice', text: part.text.trim(), options: part.options.map(option => (option as string).trim()),
    ...(typeof part.replyTo === 'string' ? {replyTo: part.replyTo} : {})};
}

export function choicePlainText(part: ChoicePart): string {
  return [part.text, ...part.options.map((option, index) => `${index + 1}. ${option}`)].join('\n');
}

export const choiceText = choicePlainText;

/** Shared runtime protocol, appended after historical role-specific capability limits. */
export const choiceChatProtocol = `【选择对话已关闭】
不要输出type=choice、options、selection，也不要发可点击的单选、多选、A/B或编号菜单，不要让用户回复数字或字母来代替说话。需要用户决定时用一句普通问话，由用户自己打字。已保存的历史选择只读保留，不能再代用户点选。此条不改变关系、记忆或任务委托。`;
