import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDialogueSkill, resolveDialogueIdentity, type DialogueCharacterId, type LoadedDialogueSkill } from './dialogue-skill';

export type StyleCard = { id: string; scope: string; summary: string; content: string };

const aliases: Record<DialogueCharacterId, readonly string[]> = {
  'yuan-xiaoman': ['徐小曼', '许晓曼', '袁小满', '小满'],
  'xia-xia': ['唐佳怡', '夏夏', '我不是龙虾'],
  liu: ['柳智敏'],
  'chen-nian': ['陈年'],
  'he-jiawei': ['何嘉伟'],
  'zhou-chef': ['赵一帆', '周师傅'],
};
const formerCharacters = ['沈知遥', '许小满', '黄宗泽', '霍廷泽', 'Molly'];
const allNames = [...Object.values(aliases).flat(), ...formerCharacters];
const canonicalId = (id: string) => id === 'liu-zhimin' ? 'liu' : id;

// These blocks come from the already frozen runtime rules, rather than a
// second file read. Professional retrieval cannot resurrect old social
// samples, inferred character traits, or unreviewed example candidates.
function compiledBlock(rules: string, header: string): string {
  const lines = rules.split('\n');
  const start = lines.findIndex(line => line.trim() === header);
  if (start < 0) throw new Error('专业表达检索缺少已加载规则块：' + header);
  let end = start + 1;
  while (end < lines.length && !/^【[^】]+】/.test(lines[end])) end++;
  const block = lines.slice(start, end).join('\n').trim();
  if (!lines.slice(start + 1, end).join('\n').trim()) throw new Error('专业表达检索规则块为空：' + header);
  return block;
}

function professionalCatalog(skill: LoadedDialogueSkill): StyleCard[] {
  const scope = '专业型；同轮已加载的共用表达与本人物配置；示例不是当前事实';
  return [
    { id: 'EXPR-rhythm', scope, summary: '按语义与气口分条，保留完整必要步骤，不机械压短。', content: compiledBlock(skill.rules, '【短消息与气口分条】') },
    { id: 'EXPR-reactions', scope, summary: '合适的问号和省略号可独立回应，真实求助保留必要信息。', content: compiledBlock(skill.rules, '【独立即时符号反应】') },
    { id: 'PERSONAL-' + skill.metadata.characterId, scope: scope + '；稳定ID=' + skill.metadata.characterId, summary: '只按本人物已确认的方向和表达分寸回应，不复制其他人的陪伴口吻。', content: compiledBlock(skill.rules, '【当前人物配置；只属于此稳定身份】') },
  ];
}

/** Molly retains its separate catalog in codex.ts. */
export function ordinaryStyleCatalog(root: string, prompt: string, loaded?: LoadedDialogueSkill): StyleCard[] {
  const skill = loaded || loadDialogueSkill(root, prompt);
  if (!skill) throw new Error('Molly 必须使用自己的示例检索目录');
  resolveDialogueIdentity(prompt, skill.metadata.characterId);
  if (skill.metadata.dialoguePurpose === 'professional') return professionalCatalog(skill);
  if (skill.metadata.dialoguePurpose !== 'companion') throw new Error('NPC 表达检索缺少有效的对话用途');

  const id = skill.metadata.characterId;
  const ownNames = aliases[id];
  const read = (file: string) => readFileSync(join(root, 'npc-skills/references', file), 'utf8');
  const cards: StyleCard[] = read('common-rules.md')
    .split(/(?=^## G\d+ |^### G18|^### 未知回应)/m)
    .filter(section => /^## G\d+ /.test(section) && !/^## G(?:10|16|17|18) /.test(section))
    .map(section => ({
      id: section.match(/^## (G\d+)/)![1], scope: '陪伴型共用；内部角色示例只在其原范围使用',
      summary: section.split('\n').filter(Boolean).slice(0, 2).join('\n').slice(0, 450), content: section.slice(0, 3500),
    }));
  const examples = JSON.parse(read('accepted-examples.json')).examples as {
    id: string; character?: string; status: string; scope: string; [key: string]: unknown;
  }[];
  for (const example of examples) {
    if (!['user_endorsed_fragment', 'user_suggested'].includes(example.status)) continue;
    if (example.character && canonicalId(example.character) !== id) continue;
    // "许小满" contains "小满" as text, but is an older separate role.
    if (formerCharacters.some(name => String(example.scope).includes(name))) continue;
    const mentioned = allNames.filter(name => String(example.scope).includes(name));
    if (mentioned.length && !mentioned.some(name => ownNames.includes(name))) continue;
    cards.push({ id: example.id, scope: example.scope, summary: example.scope + '；' + example.status, content: JSON.stringify(example) });
  }
  for (const section of read('corrections.md').split(/(?=^## C\d+ )/m)) {
    const match = section.match(/^## (C(?:39|4[3-6]|49)) /);
    if (!match) continue;
    cards.push({ id: match[1], scope: '陪伴型共同纠偏；反例不得模仿', summary: section.split('\n').filter(Boolean).slice(0, 3).join('\n').slice(0, 400), content: section.slice(0, 2800) });
  }
  cards.push({ id: 'TRIAL-clarify', scope: '本次程序实验，普通聊天；非已归档Skill规则', summary: '含义、指代或错字不确定时，只确认最关键的意思，等待回答；不沿猜测继续介绍或强加反问。', content: '在语境不能确定关键含义时，可提出一个简短确认并停下。猜测不是已确认事实，不能接着说知道啊、展开百科介绍或追加二选一。已有上下文明示含义则直接接话，不重复确认。真实紧急求助不可因此延误。用户认可的本场景示意：鸡胗那个胗？仅当确有食物语境支持时使用；不把这句话作为通用台词。' });
  cards.push({ id: 'TRIAL-casual', scope: '日常私聊，人物口吻各自保留', summary: '日常私聊按角色及有效交往自然接话，不默认清单或总结；夏夏与小满熟悉闲聊保留细节和顺势续话，不机械压短。', content: '日常聊天按当前人物和有效关系自然接话，必要内容完整提供；不固定气泡数，不机械压短。只学本轮表达原则，不复制案例的事件或人格。' });
  return cards;
}
