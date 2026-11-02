'use client';

import {useEffect, useState} from 'react';

export const CHAT_MUTE_CHANGED = 'zhiyu-chat-mute-changed';
export const chatMuteKey = (accountId: string) => `zhiyu-chat-mute-v1:${accountId}`;

export function readMutedChats(accountId: string): string[] {
  if (!accountId || typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(chatMuteKey(accountId));
    const value: unknown = raw === null
      ? JSON.parse(localStorage.getItem(`zhiyu-stitch-desktop-v2:${accountId}`) || '{}').muted
      : JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
  } catch {return [];}
}

export function writeMutedChats(accountId: string, ids: string[]) {
  const key = chatMuteKey(accountId);
  const value = JSON.stringify([...new Set(ids)].sort());
  if (localStorage.getItem(key) === value) return;
  localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent(CHAT_MUTE_CHANGED, {detail: {accountId}}));
}

export function notificationMessages<T extends {mine: boolean}>(messages: T[], muted: boolean): T[] {
  return muted ? messages.filter(message=>message.mine) : messages;
}

export function useChatMuted(accountId: string, characterId: string | null) {
  const [state, setState] = useState({accountId: '', characterId: '', muted: false});
  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active) return;
      const muted = !!characterId && readMutedChats(accountId).includes(characterId);
      setState(previous => previous.accountId === accountId && previous.characterId === characterId && previous.muted === muted
        ? previous : {accountId, characterId: characterId || '', muted});
    };
    queueMicrotask(sync);
    const onStorage = (event: StorageEvent) => {if (event.key === chatMuteKey(accountId)) sync();};
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHAT_MUTE_CHANGED, sync);
    return () => {active = false; window.removeEventListener('storage', onStorage); window.removeEventListener(CHAT_MUTE_CHANGED, sync);};
  }, [accountId, characterId]);
  return state.accountId === accountId && state.characterId === characterId ? state.muted : false;
}
