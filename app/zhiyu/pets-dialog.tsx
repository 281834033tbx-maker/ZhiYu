'use client';

import {useId,useLayoutEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {useAccount} from './auth-gate';
import PetPage from './pets';
import './pets.css';

/** The existing pet catalog stays in this page; no desktop window is opened. */
export default function PetsDialog({onClose}:{onClose:()=>void}) {
  const {account}=useAccount(),dialog=useRef<HTMLDialogElement>(null),title=useId();
  useLayoutEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  if(typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="zy-dialog zy-pets-catalog-dialog" aria-labelledby={title}
    onCancel={event=>{if(event.target===event.currentTarget){event.preventDefault();onClose();}}}
    onPointerDown={event=>{
      if(event.target!==event.currentTarget||event.button!==0)return;
      const r=event.currentTarget.getBoundingClientRect();
      if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)onClose();
    }}>
    <header><h2 id={title}>宠物</h2><button type="button" aria-label="关闭宠物" onClick={onClose}><X size={19}/></button></header>
    <PetPage accountId={account.id} dirWidth={260} onDirectoryWidthChange={()=>{}} embedded/>
  </dialog>,document.body);
}
