import {getCharacter} from './character-directory';

// Application-owned IDs and directory roles, never a model's role/name claim.
const companionIds = new Set(['yuan-xiaoman', 'xia-xia', 'he-jiawei']);
export function allowsCharacterChoice(characterId: string): boolean {
  return !(companionIds.has(characterId) && getCharacter(characterId)?.role === 'companion');
}

export const characterDialogueOutputRules = `【陪伴人物对话输出硬边界；2026-10-21用户要求】
仅徐小曼yuan-xiaoman、夏夏xia-xia、何嘉伟he-jiawei适用：只进行自然聊天，不给用户派发任务、任务邀请、任务卡、打卡作业或选择类对话；不把生活建议、旅行商量或写作讨论转成需执行和追踪的任务。不输出choice、choices、options、selection、professional_task、task、tasks或任何任务操作提案；历史曾有这些内容、用户索要、职位和好感都不授予该能力。用户要正式任务时自然说明自己的分工，可提及相应专业人物，但不能代建、代转交、代启动或声称已安排。
不把普通聊天变成A/B、编号菜单、点击/提交/回复数字选项，也不用纯文字冒充选择按钮。自然问句、讨论想法、日常建议和小说写作指导可以正常进行；“你今天想看电影还是散步”或编号解释本身不是违规，不因某个词或数字机械拒聊。建议由用户自行决定，不要求完成、打卡、汇报，也不作创建、保存、派发任务或到点提醒的承诺。
私聊成品复核必须另返回companionOutputCheck={verdict:"pass|redraft",issues:[]}，检查草稿和全部拟编辑后文字，判断是否正在面向真实用户派发、催交、追踪事项或组织选项流程；不能仅检索“任务”字眼，写三百字并明天回报也属于派发。只有自然建议、自愿讨论、普通问句、小说人物台词和写作范例不因此变成给用户布置任务，不能因为出现小说/剧情字眼就豁免整条消息中对用户的实际派发。pass必须空issues；发现问题须redraft并列具体问题，不通过删掉结构字段、保留“已给你建好”或把选择框改成文字菜单蒙混过关。群复核仅在本轮实际有陪伴人物说话时，按实际sender和拟编辑后的全部本人文字返回同一总体companionOutputCheck；沉默人物无需检查，群的其余协议保持。其他专业人物和Molly保持各自现有权限。`;

export class CharacterDialogueOutputError extends Error {
  readonly code = 'COMPANION_DIALOGUE_OUTPUT_FORBIDDEN';
  constructor(readonly issues: string[]) {
    super('陪伴人物不能发送任务或选择类对话；本轮草稿未发送');
    this.name = 'CharacterDialogueOutputError';
  }
}

const structuredKeys = new Set(['choice', 'choices', 'options', 'selection', 'professional_task', 'professionalTask',
  'task', 'tasks', 'taskProposal', 'taskProposals', 'taskDraft', 'planDraft', 'reminderProposals', 'reminderControls', 'actions']);
const forbiddenTypes = new Set(['choice', 'professional_task', 'task', 'task_card', 'create_task', 'update_task']);

/** Same-call semantic review, required only when companions actually speak. */
export function assertCompanionDialogueReview(raw: unknown): void {
  const check = (raw as {companionOutputCheck?: {verdict?: unknown; issues?: unknown}} | null)?.companionOutputCheck;
  if (!check || typeof check !== 'object' || Array.isArray(check)
    || Object.keys(check).some(key => !['verdict', 'issues'].includes(key))
    || !['pass', 'redraft'].includes(String(check.verdict)) || !Array.isArray(check.issues)
    || check.issues.length > 12 || check.issues.some(issue => typeof issue !== 'string' || !issue.trim() || issue.length > 1200)
    || (check.verdict === 'pass') !== (check.issues.length === 0))
    throw new CharacterDialogueOutputError(['陪伴成品缺少有效的同次语义复核结论']);
  if (check.verdict === 'redraft') throw new CharacterDialogueOutputError(check.issues as string[]);
}

function speechOutsideFictionExamples(text: string): string {
  // Exempt only a local speech span introduced by an unmistakable fictional
  // actor. The presence of “小说/剧情” elsewhere never exempts the whole reply.
  // Stop an unquoted span at its first sentence boundary, leaving any ensuing
  // real instruction to the user available to the normal checks and review.
  const speaker = '(?:男主(?:角)?|女主(?:角)?|主角|反派|配角|小说人物|故事人物)';
  const attribution = speaker + '(?:对[^，,。！？\\n：:]{1,12})?(?:说|道|问)(?:[，,：:]\\s*)?';
  return text
    .replace(new RegExp(attribution + '[“「『"](?:[^”」』"\\n]|\\n(?=[^\\n])){1,500}[”」』"]', 'gu'), '〔小说台词〕')
    .replace(new RegExp(attribution + '[^。！？\\n]{1,240}(?:[。！？]|$)', 'gu'), segment => {
      const returnsToUser = segment.search(/[，,；;]\s*(?:说回你|轮到你|你也|而你|对你|现在你|今晚你|明天你)/u);
      return '〔小说台词〕' + (returnsToUser >= 0 ? segment.slice(returnsToUser) : '');
    });
}

function textIssues(text: string): string[] {
  // These guards target an actual workflow/commitment. A numbered explanation,
  // fictional character's assignment, or ordinary “还是” question remains chat.
  const issues: string[] = [];
  const normalized = speechOutsideFictionExamples(text.replace(/[\u200b-\u200d\ufeff]/g, ''));
  if (/(?:回复|输入|发送|提交|点击|点选|勾选|选择按钮).{0,18}(?:选项|编号|序号|[A-FＡ-Ｆa-fａ-ｆ1-9１-９](?:\s*[/、,，或和]\s*[A-FＡ-Ｆa-fａ-ｆ1-9１-９])|确认选择)|(?:选项|选择卡|选择框|选择按钮).{0,12}(?:点击|提交|点选|勾选)/u.test(normalized))
    issues.push('以文字要求点击、提交或回复选项');
  const replyCodes = [...normalized.matchAll(/(?:回复|输入|发送)\s*[“"'‘]?\s*([A-FＡ-Ｆa-fａ-ｆ1-9１-９])(?=$|[\s，,。.;；:：、“"'’”])/gu)].map(match => match[1]);
  if (new Set(replyCodes).size >= 2) issues.push('以回复代码代替选项按钮');
  const menuItems = normalized.match(/(?:^|\n|[；;])\s*(?:[A-FＡ-Ｆa-fａ-ｆ][.．、:：)）]|[1-9１-９][.．、)）])\s*\S/g) || [];
  if (menuItems.length >= 2 && /(?:选一个|选一项|选哪[个项]|选择一[个项]|选好了|选完|任选|二选一|多选|单选|从下面选|挑一个|(?:更)?(?:倾向|想|喜欢).{0,4}(?:哪种|哪个|哪项))/u.test(normalized))
    issues.push('把自然聊天改为选项菜单');
  if (/(?:我(?:会|来|已经|已|可以|马上|现在|这就|先)?(?:帮你|给你|替你)|(?:已|已经)(?:帮你|给你)?).{0,14}(?:创建|新建|派发|下发|生成|保存|建好|建个|建一|添加|录入|发布|安排).{0,12}(?:任务|任务卡|打卡|执行计划)|(?:^|[。！？\n])\s*(?:任务|任务卡).{0,12}(?:已创建|已生成|已保存|建好了|安排好了|发给你了)|(?:要不要|是否|需不需要|需要不需要|需要我|我可以).{0,12}(?:给你|帮你|替你).{0,10}(?:建|安排|创建|生成).{0,8}(?:任务|打卡)/u.test(normalized))
    issues.push('提出或承诺创建、保存、派发任务');
  if (/(?:给你(?:一个|个|一项|项)?小?|(?:你的|今天的|今日的|本次|这次|明天的)小?)(?:任务|作业|打卡要求)(?:是(?!什么|不是|否)|为(?!什么)|[:：])|(?:给你(?:一个|个|一项|项)小?任务)[，,。]|(?:完成|做完|执行完).{0,20}(?:记得|必须|再来|之后|以后|后).{0,12}(?:打卡|汇报|提交|回复我)|(?:我会|我来|我到时候|我已经).{0,12}(?:提醒你|给你发提醒)/u.test(normalized))
    issues.push('向用户布置完成回报流程或承诺主动提醒');
  const assignsAction = /(?:今晚|明天|现在|接下来|今天)(?:你)?(?:先|要|就|需要)?(?:写|做|练|读|跑|完成|记录|列出)|(?:你先|先)(?:写|做|练|读|跑|完成|记录|列出)/u.test(normalized);
  const requestsReport = /(?:把|将)?(?:完成情况|执行情况|进度|成果|作业|结果).{0,12}(?:告诉我|发给我|报给我|汇报|提交|打卡)|(?:做完|写完|练完|完成后).{0,12}(?:告诉我|回复我|来找我|发给我)/u.test(normalized);
  if (assignsAction && requestsReport) issues.push('布置具体行动后要求向本人回报完成情况');
  return issues;
}

/** Reject before parsing can silently discard unknown fields, and after edits. */
export function assertCharacterDialogueOutput(characterId: string, raw: unknown): void {
  if (allowsCharacterChoice(characterId) || !raw || typeof raw !== 'object') return;
  const issues: string[] = [];
  const visit = (value: unknown, path: string, inMessage = false) => {
    if (typeof value === 'string') { if (inMessage) issues.push(...textIssues(value)); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((part, index) => visit(part, `${path}[${index}]`, inMessage)); return; }
    const row = value as Record<string, unknown>;
    if (forbiddenTypes.has(String(row.type)) || forbiddenTypes.has(String(row.action)) || forbiddenTypes.has(String(row.intent)))
      issues.push(`${path}含禁止的任务或选择协议`);
    for (const [key, child] of Object.entries(row)) {
      if (structuredKeys.has(key) && child !== undefined && child !== null) issues.push(`${path}.${key}不属于陪伴输出`);
      // Evidence/memories are data, not character speech. Nested message fields
      // are still checked so a text type cannot conceal options or task JSON.
      if (key === 'messages' || key === 'parts') visit(child, `${path}.${key}`, true);
      else if (inMessage && ['text', 'caption'].includes(key) && typeof child === 'string') issues.push(...textIssues(child));
      else if (inMessage && child && typeof child === 'object') visit(child, `${path}.${key}`, false);
    }
  };
  visit(raw, 'reply');
  if (issues.length) throw new CharacterDialogueOutputError([...new Set(issues)]);
}
