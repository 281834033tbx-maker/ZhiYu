'use client';

import {useEffect,useRef,useState} from 'react';
import {Send,Smile,X} from 'lucide-react';
import catalog from './emoji-data/catalog.json';

const limit=1000;

export default function MomentCommentEditor({value,onChange,onSubmit,onCancel,replyName,onCancelReply,disabled=false}: {
  value:string;onChange:(value:string)=>void;onSubmit:()=>Promise<void>|void;onCancel:()=>void;
  replyName?:string;onCancelReply:()=>void;disabled?:boolean;
}) {
  const input=useRef<HTMLTextAreaElement>(null),working=useRef(false);
  const [emojiOpen,setEmojiOpen]=useState(false),[query,setQuery]=useState('');
  useEffect(()=>{input.current?.focus();},[]);
  const emojis=catalog.items.filter(item=>!query||`${item.name} ${item.keywords}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,120);
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
    try {await onSubmit();setEmojiOpen(false);}finally{working.current=false;}
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
        <button type="button" className="zy-moments-comment-emoji" aria-label="选择评论表情" aria-expanded={emojiOpen} disabled={disabled} onKeyDown={dismiss} onMouseDown={event=>event.preventDefault()} onClick={()=>setEmojiOpen(open=>!open)}><Smile size={18}/></button>
        <button type="button" aria-label="取消评论" disabled={disabled} onKeyDown={dismiss} onClick={onCancel}><X size={16}/></button>
        <button type="submit" className="zy-moments-comment-send" aria-label="发送评论" disabled={disabled||!value.trim()} onKeyDown={dismiss}><Send size={17}/></button>
      </div>
    </div>
    {emojiOpen&&<section className="zy-moments-comment-emojis" aria-label="评论表情">
      <label><span>表情</span><input type="search" aria-label="搜索评论表情" placeholder="搜索表情" value={query} onKeyDown={dismiss} onChange={event=>setQuery(event.target.value)}/></label>
      <div>{emojis.map(item=><button type="button" key={item.emoji} title={item.name} aria-label={item.name} onKeyDown={dismiss} onMouseDown={event=>event.preventDefault()} onClick={()=>insert(item.emoji)}>{item.emoji}</button>)}</div>
      {!emojis.length&&<p>没有找到这个表情</p>}
    </section>}
  </form>;
}
