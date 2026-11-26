'use client';

import type {Part} from '../../lib/npc/contracts';

export type ChoicePart = Extract<Part, {type: 'choice'}>;

export type ChoiceChatProps = {
  part: ChoicePart;
  characterId?: string;
  onChoose?: (index: number) => void;
  pendingIndex?: number;
  disabled?: boolean;
  error?: string;
};

/** Historical choice messages stay readable. New clicks are no longer offered. */
export default function ChoiceChat({part}: ChoiceChatProps) {
  const chosen = part.selection ? part.options[part.selection.index] : '';
  return <div className="xx-bubble">{part.text}{chosen ? `\n${chosen}` : ''}</div>;
}
