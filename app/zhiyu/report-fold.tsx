'use client';

import {useCallback, useId, useSyncExternalStore, type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import type {FoldState} from '../../lib/npc/molly-reports';

const memory=new Map<string,string>();
const listeners=new Map<string,Set<()=>void>>();
function readFolds(key:string,messageId:string):string {
  if(memory.has(key))return memory.get(key)!;
  let ids:string[]=[];
  try {
    const value=JSON.parse(window.localStorage.getItem(key)||'null') as FoldState|null;
    if(value?.messageId===messageId&&Array.isArray(value.collapsedBlockIds))ids=value.collapsedBlockIds.filter((id):id is string=>typeof id==='string').slice(0,100);
  } catch { /* A denied or full storage keeps the card usable in memory. */ }
  const next=JSON.stringify(ids);memory.set(key,next);return next;
}

/** Reports share one account-scoped, message-scoped fold state. Card updates do not reset it. */
export function useReportFolds(accountId:string,messageId:string) {
  const key=`zhiyu:report-folds:${encodeURIComponent(accountId)}:${encodeURIComponent(messageId)}`;
  const subscribe=useCallback((notify:()=>void)=>{
    if(!listeners.has(key))listeners.set(key,new Set());
    listeners.get(key)!.add(notify);
    const onStorage=(event:StorageEvent)=>{if(event.key===key){memory.delete(key);notify();}};
    window.addEventListener('storage',onStorage);
    return()=>{listeners.get(key)?.delete(notify);window.removeEventListener('storage',onStorage);};
  },[key]);
  const snapshot=useCallback(()=>readFolds(key,messageId),[key,messageId]);
  const stored=useSyncExternalStore(subscribe,snapshot,()=>'[]'),collapsed=JSON.parse(stored) as string[];
  function toggle(blockId:string) {
    const current=JSON.parse(readFolds(key,messageId)) as string[];
    const collapsedBlockIds=current.includes(blockId)?current.filter(id=>id!==blockId):[...current,blockId];
    memory.set(key,JSON.stringify(collapsedBlockIds));
    try {window.localStorage.setItem(key,JSON.stringify({messageId,collapsedBlockIds}));}catch{/* The current chat still remembers the choice. */}
    listeners.get(key)?.forEach(notify=>notify());
  }
  return {isCollapsed:(blockId:string)=>collapsed.includes(blockId),toggle};
}

export function ReportFold({id,name,collapsed,onToggle,children}:{id:string;name:string;collapsed:boolean;onToggle:()=>void;children:ReactNode}) {
  const contentId=useId();
  return <section className="zy-molly-report-block" data-report-block={id}>
    <button type="button" className="zy-molly-report-fold" aria-expanded={!collapsed} aria-controls={contentId} onClick={onToggle}>
      <span>{name}</span><ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" className={collapsed?'':'is-open'}/>
    </button>
    <div id={contentId} className={'zy-molly-report-fold-body'+(collapsed?' is-collapsed':'')} aria-hidden={collapsed} inert={collapsed}>
      <div><div className="zy-molly-report-rows">{children}</div></div>
    </div>
  </section>;
}
