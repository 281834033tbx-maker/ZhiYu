import {useCallback,useSyncExternalStore} from 'react';
const empty:never[]=[];
const queues=new Map<string,unknown[]>();
const listeners=new Map<string,Set<()=>void>>();

/** Keep unsent user input across navigation; nothing is auto-sent or stored in server history. */
export function useFailedChatSends<T>(scope:string):[T[],(update:T[]|((current:T[])=>T[]))=>void] {
  const subscribe=useCallback((listener:()=>void)=>{
    const current=listeners.get(scope)||new Set<()=>void>();current.add(listener);listeners.set(scope,current);
    return()=>{current.delete(listener);if(!current.size)listeners.delete(scope);};
  },[scope]);
  const queue=useSyncExternalStore(subscribe,()=>queues.get(scope)||empty,()=>empty) as T[];
  const update=useCallback((next:T[]|((current:T[])=>T[]))=>{
    const previous=(queues.get(scope)||empty) as T[];
    const value=typeof next==='function'?next(previous):next;
    if(value===previous)return;
    if(value.length)queues.set(scope,value);else queues.delete(scope);
    for(const listener of listeners.get(scope)||[])listener();
  },[scope]);
  return [queue,update];
}
