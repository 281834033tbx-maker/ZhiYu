'use client';

import {useId,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useAccount} from './auth-gate';
import PetPage from './pets';
import {useDialogLightDismiss} from './use-dialog-light-dismiss';
import './pets.css';

/** The existing pet catalog stays in this page; no desktop window is opened. */
export default function PetsDialog({onClose}:{onClose:()=>void}) {
  const {account}=useAccount(),dialog=useRef<HTMLDialogElement>(null),title=useId();
  useLayoutEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  const close=()=>{if(!dialog.current?.querySelector('dialog[open]'))onClose();};
  useDialogLightDismiss(dialog,close);
  if(typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="zy-dialog zy-pets-catalog-dialog" aria-labelledby={title}
    onCancel={event=>{if(event.target===event.currentTarget){event.preventDefault();close();}}}>
    <header><h2 id={title}>宠物</h2><button type="button" aria-label="关闭宠物" title="关闭" onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();close();}}><X size={19}/></button></header>
    <PetPage accountId={account.id} dirWidth={260} onDirectoryWidthChange={()=>{}} embedded/>
  </dialog>,document.body);
}
