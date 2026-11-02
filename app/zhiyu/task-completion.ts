'use client';
import {useCallback, useSyncExternalStore} from 'react';
export type TaskCompletions = Readonly<Record<string, true>>;
export const TASK_COMPLETION_CHANGED = 'zhiyu-task-completion-changed';
const empty: TaskCompletions = Object.freeze({});
const snapshots = new Map<string, {raw: string | null; value: TaskCompletions}>();
export function taskCompletionKey(accountId: string) {return `zhiyu-task-completion-v1:${encodeURIComponent(accountId)}`;}
export function readTaskCompletions(accountId: string): TaskCompletions {
  if (!accountId || typeof window === 'undefined') return empty;
  let raw: string | null;
  try {raw = localStorage.getItem(taskCompletionKey(accountId));} catch {return empty;}
  const cached = snapshots.get(accountId);
  if (cached?.raw === raw) return cached.value;
  let value = empty;
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = Object.freeze(Object.fromEntries(Object.entries(parsed).filter(([id, completed]) => id && completed === true)));
  } catch { /* Invalid preferences cannot mark a task complete. */ }
  snapshots.set(accountId, {raw, value});
  return value;
}
export function setTaskComplete(accountId: string, taskId: string, completed: boolean) {
  if (!accountId || !taskId || typeof window === 'undefined') throw new Error('任务尚未加载，请稍后重试。');
  const previous = readTaskCompletions(accountId);
  if (!!previous[taskId] === completed) return;
  const next = {...previous};
  if (completed) next[taskId] = true; else delete next[taskId];
  try {localStorage.setItem(taskCompletionKey(accountId), JSON.stringify(next));}
  catch {throw new Error('完成状态未保存，请稍后重试。');}
  window.dispatchEvent(new CustomEvent(TASK_COMPLETION_CHANGED, {detail: {accountId}}));
}
/** Update only task IDs validated by the current account's task projection. */
export function mergeTaskCompletions(accountId:string,remote:Record<string,true>,taskIds:readonly string[],pending:Record<string,boolean>={}){
  if(!accountId||typeof window==='undefined')return;
  const previous=readTaskCompletions(accountId),next={...previous};
  for(const id of taskIds){const completed=id in pending?pending[id]:remote[id]===true;if(completed)next[id]=true;else delete next[id];}
  if(JSON.stringify(previous)===JSON.stringify(next))return;
  try{localStorage.setItem(taskCompletionKey(accountId),JSON.stringify(next));}catch{throw Error('完成状态未保存到本机，请稍后重试。');}
  window.dispatchEvent(new CustomEvent(TASK_COMPLETION_CHANGED,{detail:{accountId}}));
}
export function useTaskCompletions(accountId: string) {
  const subscribe = useCallback((listener: () => void) => {
    const changed = (event: Event) => {if ((event as CustomEvent<{accountId?: string}>).detail?.accountId === accountId) listener();};
    const storage = (event: StorageEvent) => {if (event.key === taskCompletionKey(accountId) || event.key === null) listener();};
    window.addEventListener(TASK_COMPLETION_CHANGED, changed); window.addEventListener('storage', storage);
    return () => {window.removeEventListener(TASK_COMPLETION_CHANGED, changed); window.removeEventListener('storage', storage);};
  }, [accountId]);
  const getSnapshot = useCallback(() => readTaskCompletions(accountId), [accountId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
