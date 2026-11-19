'use client';

import {useContext,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Send,Smile,X} from 'lucide-react';
import catalog from './emoji-data/catalog.json';
import './moment-comment-controls.css';
import {MobileComposerContext} from './mobile-composer-context';
import MobileComposer from './mobile-composer';
import type {ComposePayload} from './chat-composer';

const limit=1000;

type MomentCommentEditorProps={
  value:string;onChange:(value:string)=>void;onSubmit:()=>Promise<void>|void;onCancel:()=>void;
  replyName?:string;onCancelReply:()=>void;disabled?:boolean;
  onSendPayload?:(payload:ComposePayload)=>Promise<void|boolean>|void|boolean;
};

export default function MomentCommentEditor(props:MomentCommentEditorProps) {
  const mobile=useContext(MobileComposerContext);
  return mobile?<MobileMomentCommentEditor {...props}/>:<DesktopMomentCommentEditor {...props}/>;
}

function MobileMomentCommentEditor({value,onChange,onSubmit,onSendPayload,onCancel,replyName,onCancelReply,disabled=false}:MomentCommentEditorProps) {
  const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const frame=requestAnimationFrame(()=>input.current?.focus());
    return()=>{cancelAnimationFrame(frame);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  if(typeof document==='undefined')return null;
  const main=document.querySelector('main.zy-mobile');if(!main)return null;
  return createPortal(<div className="zy-mobile-comment-compose" aria-label="评论输入">
    <MobileComposer value={value} onChange={text=>onChange(text.slice(0,limit))} textareaRef={input} placeholder={replyName?'回复 '+replyName:'发表评论'} label="评论"
      allowImages={!!onSendPayload} allowVoice={!!onSendPayload} disabled={disabled}
      onSend={async payload=>{if(disabled)return false;if(onSendPayload)return onSendPayload(payload);if(!payload.text.trim())return false;await onSubmit();}}
      onSendComplete={onCancel}
      onEditorKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}}}
      aboveInput={<div className="zy-mobile-comment-reply"><span>{replyName?'回复 '+replyName:'发表评论'}</span>{replyName&&<button type="button" aria-label="取消回复" disabled={disabled} onClick={onCancelReply}><X size={16}/></button>}<button type="button" aria-label="关闭评论" disabled={disabled} onClick={onCancel}><X size={18}/></button></div>}/>
  </div>,main);
}

function DesktopMomentCommentEditor({value,onChange,onSubmit,onCancel,replyName,onCancelReply,disabled=false}:MomentCommentEditorProps) {
  const input=useRef<HTMLTextAreaElement>(null),working=useRef(false);
  const [emojiOpen,setEmojiOpen]=useState(false);
  useEffect(()=>{input.current?.focus();},[]);
  const hasText=!!value.trim();
  function insert(text:string) {
    const start=input.current?.selectionStart??value.length,end=input.current?.selectionEnd??value.length;
    if(value.length-(end-start)+text.length>limit)return;
    onChange(value.slice(0,start)+text+value.slice(end));
    requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(start+text.length,start+text.length);});
  }
  async function submit(event:{preventDefault:()=>void}) {
    event.preventDefault();
    if(disabled||working.current||!value.trim())return;
    working.current=true;
    // Only the owner can confirm success and close this editor. A failed send
    // retains its text and emoji panel; never clear it on promise resolution.
    try {await onSubmit();}catch{/* The owner reports the send error. */}finally{working.current=false;}
  }
  function dismiss(event:{key:string;preventDefault:()=>void;stopPropagation:()=>void}) {
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(emojiOpen)setEmojiOpen(false);else onCancel();}
  }
  return <form className="zy-moments-comment-editor" aria-label="发表评论" onSubmit={event=>void submit(event)}>
    {replyName&&<div className="zy-moments-comment-reply">回复 {replyName}<button type="button" aria-label="取消回复" disabled={disabled} onKeyDown={dismiss} onClick={()=>{onCancelReply();input.current?.focus();}}><X size={12}/></button></div>}
    <div className="zy-moments-comment-entry">
      <textarea ref={input} aria-label="评论内容" placeholder={replyName?`回复 ${replyName}…`:'写下一句回应…'} value={value} maxLength={limit} rows={1} disabled={disabled} onChange={event=>onChange(event.target.value)}
        onKeyDown={event=>{dismiss(event);if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing)void submit(event);}}
        onPaste={event=>{if(event.clipboardData.files.length){event.preventDefault();const text=event.clipboardData.getData('text/plain');if(text)insert(text);}}}
        onDrop={event=>{if(event.dataTransfer.files.length)event.preventDefault();}}/>
      <div className="zy-moments-comment-tools">
        <button type="button" className={'zy-moments-comment-emoji'+(emojiOpen||hasText?' is-active':'')} aria-label="选择评论表情" aria-expanded={emojiOpen} disabled={disabled} onKeyDown={dismiss} onMouseDown={event=>event.preventDefault()} onClick={()=>setEmojiOpen(open=>!open)}><Smile size={18}/></button>
        <button type="submit" className="zy-moments-comment-send" aria-label="发送评论" disabled={disabled||!hasText} onKeyDown={dismiss}><Send size={17}/></button>
      </div>
    </div>
    {emojiOpen&&<section className="zy-moments-comment-emojis" aria-label="评论表情">
      <div>{catalog.items.map(item=><button type="button" key={item.emoji} title={item.name} aria-label={item.name} onKeyDown={dismiss} onMouseDown={event=>event.preventDefault()} onClick={()=>insert(item.emoji)}>{item.emoji}</button>)}</div>
    </section>}
  </form>;
}
