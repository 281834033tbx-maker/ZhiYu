import type { ExpressionPreference, Memory } from './contracts';

const keyOf = (p: ExpressionPreference) => `${p.category}:${p.target.normalize('NFC')}`;

// Metadata needs an explicit named target in the quoted user evidence. Ambiguous
// references to a previous image are left for clarification, never invented IDs.
export function parseExpressionPreference(raw: unknown, kind: string, evidence: string): ExpressionPreference | undefined {
  if (kind !== 'user_claim' || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const p = raw as Record<string, unknown>;
  if (!['wording', 'sticker'].includes(String(p.category)) || !['avoid', 'allow'].includes(String(p.action))) return;
  if (typeof p.target !== 'string' || !p.target.trim() || p.target.trim().length > 120) return;
  const target = p.target.trim();
  if (!evidence.includes(target) || /^(?:[这那](?:个|张|句)?(?:表情包|图片|句话|图|话)?|它|表情包|图片|生活|任何生活|全部|所有)$/.test(target)) return;
  // The model must quote this target's short preference clause, not a paragraph
  // containing other targets or a contrast. Ambiguous metadata is not promoted.
  const clause = evidence.trim().replace(/[，,。;；!?！？\s]+$/, '');
  const outsideTarget = clause.replace(target, '');
  if (/[，,。;；!?！？\n]|但是|不过|然而|而且|另外|同时|但/.test(outsideTarget)) return;
  // A request to change the role's life/personality is not a material preference.
  // Explicitly naming a wording or quote can still refer to such words literally.
  if (/分享.*生活|生活.*分享|人格|性格|人设/.test(target) && (p.category === 'sticker' || !/这句话|这句|用词|措辞|说法|[“”"「」『』]/.test(evidence))) return;
  const allow = /不(?:再)?(?:讨厌|反感)|不介意|可以(?:再|继续)?(?:说|用|发|叫)|(?:取消|解除).*(?:限制|禁用)|恢复/.test(evidence);
  const avoid = /讨厌|不喜欢|不爱|反感|别(?:再)?(?:说|用|发|叫)|不要(?:再)?(?:说|用|发|叫)|不想(?:再)?听|停用|避免/.test(evidence);
  const negatedPermission = /(?:不可以|不能|不要|不准|不许|别|不)\s*(?:再|继续)?\s*(?:允许|恢复|解除|取消|使用|用|说|发|叫)/.test(outsideTarget);
  if (p.action === 'allow' ? !allow || negatedPermission : !avoid || allow) return;
  return { category: p.category as ExpressionPreference['category'], target, action: p.action as ExpressionPreference['action'] };
}

type Candidate = Pick<Memory, 'text' | 'kind'> & { preference?: ExpressionPreference };
export function shouldSaveMemory(memories: Memory[], candidate: Candidate): boolean {
  if (candidate.preference) {
    const key = keyOf(candidate.preference);
    const latest = [...memories].reverse().find(m => m.preference && keyOf(m.preference) === key);
    // A new reversal must be appended even if an older identical text exists.
    return latest?.preference?.action !== candidate.preference.action;
  }
  return !memories.some(m => !m.preference && m.text === candidate.text && m.kind === candidate.kind);
}

export function currentExpressionPreferences(memories: Memory[], messages: { id: string; role: string; part: unknown }[]) {
  const sourceMessages = new Map(messages.filter(m => m.role === 'user').map(m => [m.id, m]));
  const current = new Map<string, { preference: ExpressionPreference; evidence: string; messageId: string }>();
  for (const m of memories) {
    const source = sourceMessages.get(m.messageId);
    if (!source?.part || typeof source.part !== 'object' || !('text' in source.part) || typeof source.part.text !== 'string' || !source.part.text.includes(m.evidence)) continue;
    const preference = parseExpressionPreference(m.preference, m.kind, m.evidence);
    if (preference) current.set(keyOf(preference), { preference, evidence: m.evidence, messageId: m.messageId });
  }
  return [...current.values()];
}

export const EXPRESSION_PREFERENCE_OUTPUT = `具体用语/某个图片表情的明确偏好可在user_claim记忆上附加preference:{category:"wording|sticker",target:"原话明确提及的具体原句或素材名",action:"avoid|allow"}。target必须在本轮evidence中逐字出现；evidence只引用本目标偏好判断的一段短连续原话，不用包含其他目标或转折的整段消息。avoid用于明确不喜欢/不用，allow只用于明确撤回对应限制，否定的允许/恢复不能撤回。模糊“这个表情包”未能核对具体目标时先理解或问清，不编造素材ID；不把不分享任何生活、换人格等宽泛角色要求标成具体素材偏好，也不能换category绕过。用户表达沟通偏好与更改程序配置不同，可以记录前者；普通记忆无此字段。`;

export function expressionPreferenceContext(state: { memories: Memory[]; messages: { id: string; role: string; part: unknown }[] }) {
  return `【本用户本人物本分支的具体表达偏好；同目标最新表达覆盖旧表达】${JSON.stringify(currentExpressionPreferences(state.memories, state.messages))}
以上只从本分支有原话证据的记录提取，不因普通记忆的80条窗口丢失。不喜欢某句或图片时换表达；allow表示限制已撤回，不强制重新使用。不能从示例或其他用户/NPC推导偏好，不把宽泛边界伪装为措辞偏好。按共同Skill理解情绪和范围，保留人物自身性格。
${EXPRESSION_PREFERENCE_OUTPUT}`;
}
