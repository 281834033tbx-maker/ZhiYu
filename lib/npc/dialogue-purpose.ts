import { characterDirectory } from './character-directory';

/** User-confirmed conversation purpose, independent of profession and relationship. */
export type DialoguePurpose = 'companion' | 'professional';

// One role source for UI badges, private Skill routing and Molly selection.
export const dialoguePurposeByCharacter: Record<string, DialoguePurpose> = Object.fromEntries(
  characterDirectory.map(person => [person.id, person.role]),
);

export const dialogueSkillPaths = {
  companion: 'npc-skills/skills/zhiyu-dialogue',
  professional: 'npc-skills/skills/zhiyu-dialogue',
} as const satisfies Record<DialoguePurpose, string>;
