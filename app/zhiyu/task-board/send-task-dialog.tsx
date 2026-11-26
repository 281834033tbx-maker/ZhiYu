'use client';

import {useId, useLayoutEffect, useRef, useState, type SubmitEvent} from 'react';
import {X} from 'lucide-react';
import PressableIconButton from '../pressable-icon-button';
import {useAnchoredPopupPresence} from '../anchored-popup-motion';
import {categories, npcs} from './config';
import {buildSendTaskRecord} from './send-task';
import type {CommitTaskRecord} from './task-record-editor';
import type {Task} from './types';
import './task-record-editor.css';

export default function SendTaskDialog({today, order, onCommitRecord, onSent, onClose}:{
  today:string;order:number;onCommitRecord:CommitTaskRecord;onSent:(task:Task)=>void;onClose:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null),titleId=useId();
  const present=useAnchoredPopupPresence(true,dialog,()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
  const [title,setTitle]=useState(''),[note,setNote]=useState(''),[date,setDate]=useState(today);
  const [npcId,setNpcId]=useState('molly'),[categoryId,setCategoryId]=useState('chores');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  useLayoutEffect(()=>{
    const node=dialog.current;if(!present||!node)return;
    if(!node.open)node.showModal();
    return()=>{node.close();};
  },[present]);
  async function submit(event:SubmitEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setError('');setBusy(true);
    try {
      const {record,task}=buildSendTaskRecord({title,note,date,npcId,categoryId,order});
      await onCommitRecord(record);
      onSent(task);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'任务没有发出去，请重试。');
      setBusy(false);
    }
  }
  if(!present)return null;
  return <dialog ref={dialog} className="zy-dialog zy-task-record-editor" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onPointerDown={event=>{if(busy||event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header className="zy-tre-header"><h2 id={titleId}>发任务</h2><PressableIconButton type="button" aria-label="关闭发任务" disabled={busy} onClick={onClose}><X size={18}/></PressableIconButton></header>
    <form className="zy-tre-body" onSubmit={event=>void submit(event)} aria-label="发任务">
      <p className="zy-tre-help">写好要办的事，发给对应智友。发出后会打开围绕这件任务的对话。</p>
      <div className="zy-tre-grid">
        <label className="zy-tre-field is-wide"><span>任务</span><input value={title} required maxLength={160} disabled={busy} onChange={event=>setTitle(event.target.value)} placeholder="例如：周末把客厅收拾出来"/></label>
        <label className="zy-tre-field"><span>日期</span><input type="date" required value={date} disabled={busy} onChange={event=>setDate(event.target.value)}/></label>
        <label className="zy-tre-field"><span>交给</span><select value={npcId} disabled={busy} onChange={event=>setNpcId(event.target.value)}>{npcs.map(npc=><option key={npc.id} value={npc.id}>{npc.name}</option>)}</select></label>
        <label className="zy-tre-field"><span>分类</span><select value={categoryId} disabled={busy} onChange={event=>setCategoryId(event.target.value)}>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      </div>
      <label className="zy-tre-field"><span>补充（可选）</span><textarea rows={3} value={note} maxLength={2000} disabled={busy} onChange={event=>setNote(event.target.value)} placeholder="时间、份量或要注意的事"/></label>
      {error&&<p className="zy-tre-error" role="alert">{error}</p>}
      <div className="zy-tre-actions"><button type="submit" className="zy-tre-button is-primary" disabled={busy||!title.trim()}>{busy?'发出中…':'发出去'}</button></div>
    </form>
  </dialog>;
}
