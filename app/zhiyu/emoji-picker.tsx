'use client';

import {useEffect,useRef} from 'react';
import catalog from './emoji-data/catalog.json';
import './emoji-picker.css';

// Keep the composer contract stable; saved stickers remain stored separately.
export default function EmojiPicker({onEmoji,onClose}:{onEmoji:(s:string)=>void;onFile:(f:File)=>void;onClose:()=>void;allowImages?:boolean}) {
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{
  const panel=root.current;if(!panel)return;
  const document=panel.ownerDocument;
  const trigger=panel.parentElement?.querySelector<HTMLButtonElement>('[aria-label="选择表情包"]');
  const outside=(event:PointerEvent)=>{
   const target=event.target as Node|null;
   if(target&&!panel.contains(target)&&!trigger?.contains(target))onClose();
  };
  const key=(event:KeyboardEvent)=>{
   if(event.key!=='Escape')return;
   event.preventDefault();event.stopPropagation();onClose();trigger?.focus();
  };
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key);};
 },[onClose]);
 return <section ref={root} className="chat-sticker-panel zy-emoji-only-panel" aria-label="表情面板">
  <div className="emoji-grid zy-emoji-only-grid">{catalog.items.map(item=><button type="button" key={item.emoji} title={item.name} aria-label={item.name} onMouseDown={event=>event.preventDefault()} onClick={()=>onEmoji(item.emoji)}>{item.emoji}</button>)}</div>
 </section>;
}
