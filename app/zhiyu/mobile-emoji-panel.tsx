'use client';
/* eslint-disable next/no-img-element */

import {useEffect,useState} from 'react';
import {Delete,Heart,Smile} from 'lucide-react';
import catalog from './emoji-data/catalog.json';
import {listStickers,type SavedSticker} from './saved-stickers';
import {reportUserFacingError} from '../../lib/user-facing-errors';

type Props={onEmoji:(emoji:string)=>void;onSticker:(file:File)=>Promise<void>;onDelete:()=>void;onSend:()=>void;canSend:boolean;disabled:boolean;allowImages:boolean};

export default function MobileEmojiPanel({onEmoji,onSticker,onDelete,onSend,canSend,disabled,allowImages}:Props){
 const [tab,setTab]=useState<'emoji'|'saved'>('emoji'),[stickers,setStickers]=useState<SavedSticker[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  if(tab!=='saved'||!allowImages)return;
  let active=true;
  const refresh=()=>{setLoading(true);setError('');void listStickers().then(items=>{if(active)setStickers(items);}).catch(()=>{if(active)setError('暂时无法读取收藏的表情包，请重试');}).finally(()=>{if(active)setLoading(false);});};
  refresh();window.addEventListener('zhiyu-stickers-changed',refresh);
  return()=>{active=false;window.removeEventListener('zhiyu-stickers-changed',refresh);};
 },[tab,allowImages]);
 async function chooseSticker(sticker:SavedSticker){
  if(disabled)return;
  setError('');
  try{
   // The collection already contains the user's actual image bytes. No remote
   // image is fetched and no extra collection entry is created here.
   const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/.exec(sticker.data);
   if(!match)throw Error('收藏的表情包无法读取');
   const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   await onSticker(new File([bytes],sticker.name,{type:match[1]}));
  }catch(cause){setError(reportUserFacingError(cause,'media','读取收藏的表情包'));}
 }
 return <section className="zy-m-emoji-panel" aria-label="表情面板">
  <div className="zy-m-emoji-tabs" role="tablist" aria-label="表情类别">
   <button type="button" role="tab" aria-label="表情" aria-selected={tab==='emoji'} onPointerDown={event=>event.preventDefault()} onClick={()=>setTab('emoji')}><Smile size={22} strokeWidth={1.6}/></button>
   <button type="button" role="tab" aria-label="收藏的表情包" aria-selected={tab==='saved'} disabled={!allowImages} onPointerDown={event=>event.preventDefault()} onClick={()=>setTab('saved')}><Heart size={22} strokeWidth={1.6}/></button>
  </div>
  <div className="zy-m-emoji-grid" role="tabpanel" aria-label={tab==='emoji'?'表情':'收藏的表情包'}>
   {tab==='emoji'?catalog.items.map(item=><button type="button" key={item.emoji} aria-label={item.name} title={item.name} disabled={disabled} onPointerDown={event=>event.preventDefault()} onClick={()=>onEmoji(item.emoji)}>{item.emoji}</button>):stickers.map(item=><button type="button" key={item.id} className="zy-m-saved-sticker" aria-label={item.name} disabled={disabled} onClick={()=>void chooseSticker(item)}><img src={item.data} alt={item.name}/></button>)}
   {tab==='saved'&&loading&&<output className="zy-m-emoji-empty">正在读取收藏…</output>}
   {tab==='saved'&&!loading&&!error&&!stickers.length&&<p className="zy-m-emoji-empty">还没有收藏的表情包</p>}
   {error&&<p className="zy-m-emoji-empty" role="alert">{error}</p>}
  </div>
  <div className="zy-m-emoji-actions"><button type="button" aria-label="删除上一个字符" disabled={disabled} onPointerDown={event=>event.preventDefault()} onClick={onDelete}><Delete size={22} strokeWidth={1.6}/></button><button type="button" disabled={disabled||!canSend} onPointerDown={event=>event.preventDefault()} onClick={onSend}>发送</button></div>
 </section>;
}
