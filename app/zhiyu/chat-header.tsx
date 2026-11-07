'use client';
/* eslint-disable next/no-img-element */
import {useEffect,useId,useRef,useState} from 'react';
import {CalendarDays,ChevronRight,MoreHorizontal} from 'lucide-react';
import PhosphorActionIcon from './phosphor-action-icon';
import PressableIconButton from './pressable-icon-button';
import {useAnchoredPopupPresence} from './anchored-popup-motion';
import NpcTypeBadge from './npc-type-badge';
import type {DialoguePurpose} from '../../lib/npc/dialogue-purpose';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import './private-chat-settings.css';
import './user-facing-ui.css';

type ChatHeaderProps = {
 name:string; avatar?:string; bio:string;
 status?:string;typing?:boolean;typingName?:string;
 dialoguePurpose?:DialoguePurpose; professionalTitle?:string;
 onCall?:(kind:'voice'|'video')=>void;
 onProfile?:(anchor:HTMLElement)=>void;
 onDesktop?:()=>void; desktopOpen?:boolean;
 onCalendar?:()=>void;
 onRelationship?:()=>void; onCreateGroup?:()=>void;
 muted?:boolean; onToggleMute?:()=>void;
 pinned?:boolean; onTogglePin?:()=>void;
 onSearch?:()=>void; onClear?:()=>Promise<void>|void;
};

function ClearChatConfirm({onClear,onClose}:{onClear:()=>Promise<void>|void;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null), title=useId();
 const [busy,setBusy]=useState(false), [error,setError]=useState('');
 const lock=useRef(false), alive=useRef(true);
 useEffect(()=>{const node=dialog.current;alive.current=true;node?.showModal();return()=>{alive.current=false;node?.close();};},[]);
 const confirm=async()=>{
  if(lock.current)return;
  lock.current=true;setBusy(true);setError('');
  try {await onClear();if(alive.current)onClose();}
  catch(e){if(alive.current)setError(reportUserFacingError(e,'save','清空聊天记录'));}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 };
 return <dialog ref={dialog} className="zy-dialog zy-private-clear-dialog" aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!lock.current)onClose();}}>
  <h2 id={title}>清空聊天记录？</h2>
  {error&&<p role="alert">{error}</p>}
  <footer><button type="button" disabled={busy} autoFocus onClick={onClose}>取消</button><button type="button" className="zy-private-clear-confirm" disabled={busy} onClick={()=>void confirm()}>{busy?'清空中…':'清空'}</button></footer>
 </dialog>;
}

export default function ChatHeader({name,avatar,status='',typing=false,typingName,dialoguePurpose,professionalTitle,onProfile,onDesktop,desktopOpen,onCalendar,muted,onToggleMute,pinned,onTogglePin,onSearch,onClear}:ChatHeaderProps){
 const [drawerOpen,setDrawerOpen]=useState(false),[confirmClear,setConfirmClear]=useState(false);
 const drawerId=useId();
 const root=useRef<HTMLDivElement>(null);
 const drawer=useRef<HTMLElement>(null),drawerToggle=useRef<HTMLButtonElement>(null);
 const drawerPresent=useAnchoredPopupPresence(drawerOpen,drawer,()=>drawerToggle.current);
 useEffect(()=>{
  if(!drawerOpen)return;
  const close=(event:Event)=>{
   if(confirmClear)return;
   if(event.type==='keydown'&&(event as KeyboardEvent).key!=='Escape')return;
   if(event.type==='pointerdown'&&root.current?.contains(event.target as Node))return;
   if(event.type==='pointerdown'&&event.target instanceof Element&&event.target.closest('dialog[open], .zy-profile-popover, .message-context-menu'))return;
   setDrawerOpen(false);
  };
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};
 },[drawerOpen,confirmClear]);
 const face=<>{avatar?<img className="xx-avatar" src={avatar} alt={name}/>:<span className="xx-avatar">{name.slice(0,1)}</span>}</>;
 return <>
  <header className="xx-head unified-chat-head">
   <div className="chat-header-person chat-header-person-avatar-only">
    <button type="button" className="chat-header-avatar" disabled={!onProfile} aria-label={name+'的资料'} title="查看资料" onClick={event=>onProfile?.(event.currentTarget.querySelector<HTMLElement>('.xx-avatar')||event.currentTarget)}>{face}</button>
    <span className="chat-header-copy"><strong>{name}<NpcTypeBadge purpose={dialoguePurpose} professionalTitle={professionalTitle}/></strong>{(status||typing)&&<small className={'zy-chat-header-status zy-character-status'+(typing?' is-typing':'')} role={typing?'status':undefined}>{typing?`${typingName?typingName+' ':''}正在输入…`:status}</small>}</span>
   </div>
   <div className="xx-call-actions" ref={root}>
    {onCalendar&&<PressableIconButton type="button" aria-label="查看历史任务日历" title="查看历史任务日历" onClick={onCalendar}><CalendarDays size={17} style={{width:17,height:17}} strokeWidth={1.7}/></PressableIconButton>}
    {onDesktop&&<PressableIconButton type="button" aria-label="打开桌面人物" title="打开桌面人物" aria-pressed={!!desktopOpen} onClick={onDesktop}><PhosphorActionIcon name="video" size={20}/></PressableIconButton>}
    <PressableIconButton ref={drawerToggle} type="button" aria-label="更多选项" title="更多选项" aria-expanded={drawerOpen} aria-controls={drawerId} onClick={()=>setDrawerOpen(value=>!value)}><MoreHorizontal size={20} strokeWidth={1.7}/></PressableIconButton>
    {drawerPresent&&<aside ref={drawer} id={drawerId} className="zy-private-drawer" aria-label="聊天设置" aria-hidden={!drawerOpen} inert={!drawerOpen}>
     <button type="button" className="zy-private-person" aria-label={`查看${name}的资料`} disabled={!onProfile} onClick={event=>onProfile?.(event.currentTarget.querySelector<HTMLElement>('.xx-avatar')||event.currentTarget)}>{face}</button>
     <button type="button" className="zy-private-search" disabled={!onSearch} onClick={()=>{setDrawerOpen(false);onSearch?.();}}><span>查找聊天内容</span><ChevronRight size={16}/></button>
     <div className="zy-private-switches">
      <label><span>置顶聊天</span><input type="checkbox" role="switch" aria-label="置顶聊天" aria-checked={!!pinned} checked={!!pinned} disabled={!onTogglePin} onChange={onTogglePin}/><i aria-hidden="true"/></label>
      <label><span>消息免打扰</span><input type="checkbox" role="switch" aria-label="消息免打扰" aria-checked={!!muted} checked={!!muted} disabled={!onToggleMute} onChange={onToggleMute}/><i aria-hidden="true"/></label>
     </div>
     <button type="button" className="zy-private-clear" disabled={!onClear} onClick={()=>setConfirmClear(true)}>清空聊天记录</button>
    </aside>}
    {confirmClear&&onClear&&<ClearChatConfirm onClear={onClear} onClose={()=>setConfirmClear(false)}/>}
   </div>
  </header>
 </>;
}
