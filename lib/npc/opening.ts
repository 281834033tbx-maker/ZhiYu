import molly from '../../npc-skills/skills/zhiyu-dialogue/npcs/molly/opening.json';
import yuan from '../../npc-skills/skills/zhiyu-dialogue/npcs/yuan-xiaoman/opening.json';
import xia from '../../npc-skills/skills/zhiyu-dialogue/npcs/xia-xia/opening.json';
import he from '../../npc-skills/skills/zhiyu-dialogue/npcs/he-jiawei/opening.json';
import chen from '../../npc-skills/skills/zhiyu-dialogue/npcs/chen-nian/opening.json';
import liu from '../../npc-skills/skills/zhiyu-dialogue/npcs/liu/opening.json';
import chef from '../../npc-skills/skills/zhiyu-dialogue/npcs/zhou-chef/opening.json';

export const OPENING_CHARACTER_IDS = ['molly', 'yuan-xiaoman', 'xia-xia', 'he-jiawei', 'chen-nian', 'liu', 'zhou-chef'] as const;
export type OpeningCharacterId = typeof OPENING_CHARACTER_IDS[number];
export type OpeningMessage = string | {readonly type: 'team_card'; readonly version: 1};
export type OpeningDefinition = {readonly version: number; readonly messages: readonly OpeningMessage[]};
export function openingCharacterId(id: string): OpeningCharacterId | null {
  if (id === 'molly-system-secretary') return 'molly';
  return OPENING_CHARACTER_IDS.includes(id as OpeningCharacterId) ? id as OpeningCharacterId : null;
}
const sources = {molly, 'yuan-xiaoman': yuan, 'xia-xia': xia, 'he-jiawei': he, 'chen-nian': chen, liu, 'zhou-chef': chef};
function definition(id: OpeningCharacterId): OpeningDefinition {
  const source = sources[id];
  if (source.version !== (id === 'molly' ? 2 : 1) || !Array.isArray(source.messages) || !source.messages.length) throw Error('开场白配置无效');
  const messages = source.messages.map((message): OpeningMessage => {
    if (typeof message === 'string' && message.trim()) return message;
    if (id === 'molly' && typeof message === 'object' && message.type === 'team_card' && message.version === 1) return Object.freeze({type: 'team_card', version: 1});
    throw Error('开场白气泡配置无效');
  });
  return Object.freeze({version: source.version, messages: Object.freeze(messages)});
}
const definitions = Object.fromEntries(OPENING_CHARACTER_IDS.map(id => [id, definition(id)])) as Record<OpeningCharacterId, OpeningDefinition>;
/** Literal host-owned copy. No persona/address substitution or output guard. */
export function openingFor(id: string): OpeningDefinition {
  const canonical = openingCharacterId(id);
  if (!canonical) throw Error('开场人物不存在');
  return definitions[canonical];
}
export const openingMessagesFor = (id: string): readonly OpeningMessage[] => openingFor(id).messages;
