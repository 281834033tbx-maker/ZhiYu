'use client';

import {useCallback, useSyncExternalStore, type ReactNode} from 'react';

const memory=new Map<string,boolean>();
const listeners=new Map<string,Set<()=>void>>();
function readExpanded(key:string,messageId:string):boolean {
  if(memory.has(key))return memory.get(key)!;
  let expanded=false;
  try {
    const value=JSON.parse(window.localStorage.getItem(key)||'null') as {messageId?:unknown;expanded?:unknown}|null;
    if(value?.messageId===messageId&&typeof value.expanded==='boolean')expanded=value.expanded;
  } catch { /* Denied or invalid storage leaves new cards collapsed and usable. */ }
  memory.set(key,expanded);return expanded;
}

/** Whole-card preference, separate from the retired per-block fold format. */
export function useReportExpansion(accountId:string,messageId:string) {
  const key=`zhiyu:report-expanded-v1:${encodeURIComponent(accountId)}:${encodeURIComponent(messageId)}`;
  const subscribe=useCallback((notify:()=>void)=>{
    if(!listeners.has(key))listeners.set(key,new Set());
    listeners.get(key)!.add(notify);
    const onStorage=(event:StorageEvent)=>{if(event.key===key||event.key===null){memory.delete(key);notify();}};
    window.addEventListener('storage',onStorage);
    return()=>{
      const group=listeners.get(key);group?.delete(notify);if(!group?.size)listeners.delete(key);
      window.removeEventListener('storage',onStorage);
    };
  },[key]);
  const snapshot=useCallback(()=>readExpanded(key,messageId),[key,messageId]);
  const expanded=useSyncExternalStore(subscribe,snapshot,()=>false);
  const toggle=useCallback(()=>{
    const next=!readExpanded(key,messageId);memory.set(key,next);
    try {window.localStorage.setItem(key,JSON.stringify({messageId,expanded:next}));}catch{/* The current chat still remembers the choice. */}
    listeners.get(key)?.forEach(notify=>notify());
  },[key,messageId]);
  return {expanded,toggle};
}

export function ReportSummary({label,expanded,contentId,onToggle}:{label:string;expanded:boolean;contentId:string;onToggle:()=>void}) {
  return <header className="zy-molly-report-header">
    <button type="button" className="zy-molly-report-summary" aria-label={`${expanded?'收起':'展开'}${label}`} aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
      <strong className="zy-molly-report-summary-copy">{label}</strong>
      <span className="zy-molly-report-toggle" aria-hidden="true">{expanded?'收起':'展开'}</span>
    </button>
  </header>;
}

export function ReportBody({id,expanded,children}:{id:string;expanded:boolean;children:ReactNode}) {
  return <div id={id} className={'zy-molly-report-body'+(expanded?' is-expanded':'')} aria-hidden={!expanded} inert={!expanded}>
    <div><div>{children}</div></div>
  </div>;
}

/** Once a report opens, every non-empty section is displayed directly. */
export function ReportBlock({id,name,children}:{id:string;name:string;children:ReactNode}) {
  return <section className="zy-molly-report-block" data-report-block={id}>
    <h4 className="zy-molly-report-block-name">{name}</h4>
    <div className="zy-molly-report-rows">{children}</div>
  </section>;
}
