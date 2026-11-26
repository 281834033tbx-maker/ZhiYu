'use client';

import {useCallback, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Copy, X} from 'lucide-react';
import {useAccount} from './auth-gate';
import {accountStorage} from './account-storage';
import {mollyPurchaseGroups, mollyPurchasePlainText, purchaseCheckKey, purchaseGroupComplete, type MollyPurchaseGroup} from './molly-purchase-model';
import {useArrangements} from './task-board/use-arrangements';
import './molly-report-cards.css';

function storedChecks(accountId:string) {
  try {
    const value=JSON.parse(accountStorage(accountId).getItem(`zhiyu-molly-purchase-checks:${accountId}`)||'[]');
    return new Set(Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[]);
  } catch {return new Set<string>();}
}

export default function MollyPurchaseList({onClose}:{onClose:()=>void}) {
  const {account}=useAccount();
  const arrangements=useArrangements(account.id);
  const groups=useMemo(()=>mollyPurchaseGroups(arrangements.items),[arrangements.items]);
  const [checked,setChecked]=useState(()=>storedChecks(account.id));
  const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),titleId=useId(),descriptionId=useId();
  const count=groups.reduce((sum,group)=>sum+group.lines.length,0);
  useLayoutEffect(()=>{const node=dialog.current;node?.showModal();close.current?.focus();return()=>node?.close();},[]);
  const persist=useCallback((next:Set<string>)=>{
    setChecked(next);
    accountStorage(account.id).setItem(`zhiyu-molly-purchase-checks:${account.id}`,JSON.stringify([...next]));
  },[account.id]);
  async function toggle(group:MollyPurchaseGroup,index:number) {
    if(busy)return;
    const key=purchaseCheckKey(group.id,index),next=new Set(checked);
    if(next.has(key))next.delete(key);else next.add(key);
    persist(next);setError('');
    if(!purchaseGroupComplete(group,next))return;
    setBusy(true);
    try {
      await arrangements.mutate({action:'complete',id:group.id});
      const remaining=new Set([...next].filter(item=>!item.startsWith(group.id+':')));
      persist(remaining);setNotice('这单买齐了');
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'勾选没有保存，请重试。');
    } finally {setBusy(false);}
  }
  async function copy() {
    try {await navigator.clipboard.writeText(mollyPurchasePlainText(groups));setNotice('已复制');}
    catch {setError('没有复制成功，请重试。');}
  }
  return <dialog ref={dialog} className="zy-dialog zy-molly-shopping-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header><div><h2 id={titleId}>Molly 采购</h2><p id={descriptionId}>{count?`${groups.length} 单 · ${count} 样`:'你让 Molly 买的东西会列在这里'}</p></div><div className="zy-molly-shopping-tools"><button type="button" aria-label="复制采购清单" title="复制" onClick={()=>void copy()}><Copy size={17}/></button><button ref={close} type="button" aria-label="关闭采购清单" title="关闭" onClick={onClose}><X size={18}/></button></div></header>
    <div className="zy-molly-shopping-scroll">
      {!arrangements.ready&&<p className="zy-molly-shopping-source">正在读取采购…</p>}
      {arrangements.ready&&!groups.length&&<p className="zy-molly-shopping-source">还没有要买的东西。和 Molly 说要买什么，记进采购后会出现在这里。</p>}
      {groups.map(group=><section className="zy-molly-shopping-group" key={group.id}><h3>{group.title}</h3>{group.lines.map((line,index)=><label className={'zy-molly-shopping-item'+(checked.has(purchaseCheckKey(group.id,index))?' is-checked':'')} key={purchaseCheckKey(group.id,index)}><span><input type="checkbox" checked={checked.has(purchaseCheckKey(group.id,index))} disabled={busy} onChange={()=>void toggle(group,index)}/><span>{line}</span></span></label>)}</section>)}
      {!!groups.some(group=>group.source)&&<p className="zy-molly-shopping-source">{groups.map(group=>group.source).filter(Boolean).join('；')}</p>}
    </div>
    {error&&<p className="zy-molly-shopping-error" role="alert">{error}</p>}{notice&&<output className="zy-molly-shopping-toast">{notice}</output>}
  </dialog>;
}
