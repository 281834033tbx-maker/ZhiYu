import type { Message } from './data';

// Zhao's old storage key remains readable; Zhou starts with a separate identity and history.
export const localCharacterIds = ['zhao-yifan', 'zhou-chef'] as const;

export function localCharacterChatKey(accountId: string, personId: string) {
  return `zhiyu-local-character-chat:v1:${accountId}:${personId}`;
}

export function readLocalCharacterChat(accountId: string, personId: string): Message[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(localCharacterChatKey(accountId, personId)) || '[]');
    return Array.isArray(value) ? value.filter((item): item is Message =>
      !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.mine === 'boolean') : [];
  } catch { return []; }
}

export function appendLocalCharacterMessage(accountId: string, personId: string, message: Message): Message[] {
  const next = [...readLocalCharacterChat(accountId, personId), message];
  localStorage.setItem(localCharacterChatKey(accountId, personId), JSON.stringify(next));
  return next;
}
