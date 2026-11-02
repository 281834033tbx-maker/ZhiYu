'use client';

import {useCallback, useSyncExternalStore} from 'react';

type HiddenMessages = Readonly<Record<string, readonly string[]>>;
const empty: HiddenMessages = Object.freeze({});
const changeEvent = 'zhiyu-message-visibility-changed';
const snapshots = new Map<string, {raw: string | null; value: HiddenMessages}>();

export function hiddenMessagesKey(accountId: string) {
  return `zhiyu-hidden-messages-v1:${encodeURIComponent(accountId)}`;
}

function readHiddenMessages(accountId: string): HiddenMessages {
  if (!accountId || typeof window === 'undefined') return empty;
  let raw: string | null;
  try {raw = localStorage.getItem(hiddenMessagesKey(accountId));} catch {return empty;}
  const cached = snapshots.get(accountId);
  if (cached?.raw === raw) return cached.value;
  let value: HiddenMessages = empty;
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      value = Object.fromEntries(Object.entries(parsed).filter(([, ids]) => Array.isArray(ids))
        .map(([threadId, ids]) => [threadId, [...new Set((ids as unknown[]).filter((id): id is string => typeof id === 'string'))]]));
    }
  } catch { /* A malformed preference must not hide server messages. */ }
  snapshots.set(accountId, {raw, value});
  return value;
}

export function isMessageHidden(accountId: string, threadId: string, messageId: string) {
  return readHiddenMessages(accountId)[threadId]?.includes(messageId) || false;
}

export function hideMessage(accountId: string, threadId: string, messageId: string) {
  if (!accountId || !threadId || !messageId) throw new Error('消息尚未加载，请稍后再试。');
  const previous = readHiddenMessages(accountId);
  if (previous[threadId]?.includes(messageId)) return;
  const next = {...previous, [threadId]: [...(previous[threadId] || []), messageId]};
  // Only a display preference is written. Original messages and NPC memory stay intact.
  try {localStorage.setItem(hiddenMessagesKey(accountId), JSON.stringify(next));}
  catch {throw new Error('删除未保存，本机存储不可用，请稍后再试。');}
  window.dispatchEvent(new CustomEvent(changeEvent, {detail: {accountId}}));
}

export function useMessageVisibility(accountId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{accountId?: string}>).detail?.accountId === accountId) listener();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === hiddenMessagesKey(accountId) || event.key === null) listener();
    };
    window.addEventListener(changeEvent, changed);
    window.addEventListener('storage', storage);
    return () => {window.removeEventListener(changeEvent, changed); window.removeEventListener('storage', storage);};
  }, [accountId]);
  const getSnapshot = useCallback(() => readHiddenMessages(accountId), [accountId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
