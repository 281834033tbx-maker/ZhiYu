import { loadDialogueSkill, resolveDialogueIdentity, type LoadedDialogueSkill } from './dialogue-skill';

export type StyleCard = { id: string; scope: string; summary: string; content: string };

/** Retrieval uses the exact persona/example snapshot already compiled for this
 * request. It never reopens archived expression rules or another NPC's cases. */
export function ordinaryStyleCatalog(root: string, prompt: string, loaded?: LoadedDialogueSkill): StyleCard[] {
  const skill = loaded || loadDialogueSkill(root, prompt);
  if (!skill) throw new Error('Molly 必须使用自己的示例检索目录');
  resolveDialogueIdentity(prompt, skill.metadata.characterId);
  if (!['professional','companion'].includes(skill.metadata.dialoguePurpose))
    throw new Error('NPC 表达检索缺少有效的对话用途');
  const id=skill.metadata.characterId;
  const scope=`${skill.profile.mode}；稳定ID=${id}；只属于本人，案例不是已发生事实`;
  return [
    {id:`PERSONAL-${id}`,scope,summary:`${skill.profile.name}的当前人物配置与表达风格`,
      content:JSON.stringify({profile:skill.profile,style:skill.style})},
    ...skill.examples.map((example,index)=>{
      const item=example&&typeof example==='object'&&!Array.isArray(example)?example as Record<string,unknown>:{};
      const scene=typeof item.scene==='string'?item.scene:'本人表达案例';
      const status=typeof item.status==='string'?item.status:'';
      return {id:`${id}-SCENE-${index+1}`,scope:scope+(status?`；来源状态=${status}`:''),
        summary:scene+(status?`；${status}（未确认内容不能提升为已验收规则）`:''),
        content:JSON.stringify(example)};
    }),
  ];
}
