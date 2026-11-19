'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {X} from 'lucide-react';
import type {GroupChat} from '../../lib/npc/group-chat';
import {CUT_OPENING_MESSAGES,CUT_OPENING_SENDER_NAMES} from '../../lib/npc/cut-opening-record';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import {useDialogLightDismiss} from './use-dialog-light-dismiss';
import './cut-opening-record-dialog.css';

export default function CutOpeningRecordDialog({group,mode,onClose,onSave}:{
  group:GroupChat;
  mode:'update'|'restore';
  onClose:()=>void;
  onSave:(requestId:string)=>Promise<unknown>;
}) {
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null),alive=useRef(false),lock=useRef(false),requestId=useRef('');
  const titleId=useId(),descriptionId=useId();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const restoring=mode==='restore';
  useDialogLightDismiss(dialog,onClose,busy);
  useEffect(()=>{
    alive.current=true;opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const node=dialog.current;node?.showModal();
    return()=>{alive.current=false;node?.close();if(opener.current?.isConnected)opener.current.focus({preventScroll:true});};
  },[]);
  async function save(){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try{await onSave(requestId.current);if(alive.current)onClose();}
    catch(cause){if(alive.current)setError(reportUserFacingError(cause,'save',restoring?'恢复建群记录':'保存建群记录'));}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  const name=(senderId:string)=>(CUT_OPENING_SENDER_NAMES as Readonly<Record<string,string>>)[senderId]||group.members.find(member=>member.id===senderId)?.name||senderId;
  return <dialog ref={dialog} className="zy-dialog zy-cut-opening-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h2 id={titleId}>{restoring?'恢复更新前记录':'更新建群记录'}</h2><button type="button" aria-label="关闭建群记录预览" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    <div className="zy-cut-opening-body">
      <p id={descriptionId}>{restoring?'恢复更新前的聊天记录，保留之后的普通消息。':'按下面的原文保存为 12 条独立消息。更新前的聊天会保留，可在群设置中恢复。'}</p>
      {!restoring&&<ol className="zy-cut-opening-preview" aria-label="建群记录原文预览">{CUT_OPENING_MESSAGES.map((message,index)=>{
        const original='quoteIndex' in message&&typeof message.quoteIndex==='number'?CUT_OPENING_MESSAGES[message.quoteIndex]:undefined;
        return <li key={index}><strong>{name(message.senderId)}</strong>{original&&<blockquote aria-label="引用的赵一帆消息"><strong>{name(original.senderId)}</strong><span>{original.text}</span></blockquote>}<p>{message.text}</p></li>;
      })}</ol>}
      {error&&<p className="zy-group-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" className="zy-group-cancel" disabled={busy} onClick={onClose}>取消</button><button type="button" className="zy-group-submit" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':restoring?'恢复更新前记录':'保存建群记录'}</button></footer>
  </dialog>;
}
