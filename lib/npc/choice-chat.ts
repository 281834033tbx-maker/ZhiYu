/** A choice is a user reply affordance, never a task or an executable command. */
export type ChoicePart = {
  type: 'choice';
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
export const choiceChatProtocol = `【当前可点击选择聊天协议】
仅三位专业型NPC与Molly可以在messages中输出 {"type":"choice","text":"一句自然的选择问题","options":["选项一","选项二"]}。每条是单选问题，2至6个简短、不重复的选项，text最多160字符、每选项最多80字符。不添加selection、selected、任务ID、动作或指令；用户点击后程序记录选择并把该选项原文作为引用该问题的真实用户消息继续聊天。choice是专业型及Molly的独立聊天气泡，可与普通文字或已获明确执行委托的任务卡同轮出现，选择本身不创建任务。陪伴型徐小曼、夏夏、何嘉伟不输出choice、选项问卷或任务；自然文字提问仍可正常进行。
真正有几个清晰可选目标、习惯或下一步且需要用户决定时，用choice代替文字里列出编号让人手打；普通聊天、开放描述、必须解释的条件不硬塞选择，不重复已知答案。选项要符合本人性格、用户条件和实际能力，不能用选项承诺未开放的工具。Molly普通文字仍用字符串，choice用上述对象，保持最多两条及专属短回应边界。choice包含的问题和所有选项都接受原有专业、条件和人物复核，不能借选择格式绕过它们；复核编辑只能调整text的口吻并保留原选项，不能代选或改选项事实。后续用户自由打字同样有效，不强迫只能点击。此条扩展现行messages类型，不改变关系、记忆或任务委托规则。`;
