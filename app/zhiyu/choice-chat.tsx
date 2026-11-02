'use client';

import type {Part} from '../../lib/npc/contracts';
import './choice-chat.css';
import {allowsCharacterChoice} from '../../lib/npc/character-output-policy';
import {choicePlainText} from '../../lib/npc/choice-chat';

export type ChoicePart = Extract<Part, {type: 'choice'}>;

export type ChoiceChatProps = {
  part: ChoicePart;
  characterId?: string;
  onChoose?: (index: number) => void;
  pendingIndex?: number;
  disabled?: boolean;
  error?: string;
};

/** An ordinary NPC bubble containing one answer to send, rather than task controls. */
export default function ChoiceChat({part, characterId, onChoose, pendingIndex, disabled, error}: ChoiceChatProps) {
  if (characterId && !allowsCharacterChoice(characterId))
    return <div className="xx-bubble">{choicePlainText(part)}</div>;
  const busy = pendingIndex !== undefined;
  const answered = part.selection !== undefined;
  return <div className="xx-bubble zy-choice-chat" aria-busy={busy || undefined}>
    {part.text && <div className="zy-choice-question">{part.text}</div>}
    <fieldset className="zy-choice-options" aria-label={part.text || '选择回答'}>
      {part.options.map((option, index) => <button
        key={index}
        type="button"
        className="zy-choice-option"
        aria-pressed={part.selection?.index === index}
        disabled={disabled || busy || answered || !onChoose}
        data-pending={pendingIndex === index || undefined}
        onClick={() => onChoose?.(index)}
      >
        <span className="zy-choice-number" aria-hidden="true">{index + 1}</span>
        <span className="zy-choice-label">{option}</span>
      </button>)}
    </fieldset>
    {busy && <output className="zy-choice-status">发送中…</output>}
    {error && <span className="zy-choice-status" role="alert">{error}</span>}
  </div>;
}
