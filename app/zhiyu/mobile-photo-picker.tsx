'use client';
/* eslint-disable next/no-img-element */

import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Camera,Check,ChevronDown,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import type {NpcUploadProgress} from './npc-upload';
import {MeasuredProgress} from './loading-state';

export const MOBILE_IMAGE_LIMIT=9;
export function mobileImageError(file:Pick<File,'type'|'size'>){
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))return '支持 PNG、JPEG、WebP 和 GIF 图片';
 if(file.size>12*1024*1024)return '单张图片请小于12MB';
 return '';
}
type Photo={id:number;file:File;url:string};
type Props={host:Element|null;initialFiles?:File[];disabled?:boolean;progress?:NpcUploadProgress|null;onClose:()=>void;onSend:(files:File[],original:boolean,onDelivered:(file:File)=>void)=>Promise<void>};

/** The grid is populated exclusively by the native file inputs below. */
export default function MobilePhotoPicker({host,initialFiles=[],disabled=false,progress,onClose,onSend}:Props){
 const [photos,setPhotos]=useState<Photo[]>([]),[selected,setSelected]=useState<number[]>([]),[original,setOriginal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<number|null>(null),[closing,setClosing]=useState(false);
 const library=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),panel=useRef<HTMLDialogElement>(null),items=useRef<Photo[]>([]),selection=useRef<number[]>([]),sequence=useRef(0),lock=useRef(false),alive=useRef(true),closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null),loadedInitial=useRef(false);
 const updateSelection=useCallback((next:number[])=>{selection.current=next;setSelected(next);},[]);
 const addFiles=useCallback((files:File[])=>{
  if(lock.current||disabled)return;
  const additions:Photo[]=[],warnings:string[]=[];
  for(const file of files){
   const issue=mobileImageError(file);if(issue){warnings.push(issue);continue;}
   if(selection.current.length+additions.length>=MOBILE_IMAGE_LIMIT){warnings.push('一次最多选择9张图片');break;}
   additions.push({id:++sequence.current,file,url:URL.createObjectURL(file)});
  }
  items.current=[...items.current,...additions];setPhotos(items.current);updateSelection([...selection.current,...additions.map(item=>item.id)]);setError([...new Set(warnings)].join('；'));
 },[disabled,updateSelection]);
 useEffect(()=>{
  alive.current=true;
  panel.current?.focus();
  return()=>{alive.current=false;if(closeTimer.current)clearTimeout(closeTimer.current);for(const item of items.current)URL.revokeObjectURL(item.url);};
 // A picker session owns its initial files and object URLs until it closes.
 },[]);
 useEffect(()=>{if(!loadedInitial.current){loadedInitial.current=true;addFiles(initialFiles);}},[initialFiles,addFiles]);
 function close(){
  if(lock.current||closing)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){onClose();return;}
  setClosing(true);closeTimer.current=setTimeout(onClose,260);
 }
 function toggle(id:number){
  if(lock.current||disabled)return;
  const current=selection.current;
  if(!current.includes(id)&&current.length>=MOBILE_IMAGE_LIMIT){setError('一次最多选择9张图片');return;}
  updateSelection(current.includes(id)?current.filter(value=>value!==id):[...current,id]);
 }
 function delivered(file:File){
  if(!alive.current)return;
  const removed=items.current.filter(item=>item.file===file),ids=new Set(removed.map(item=>item.id));
  items.current=items.current.filter(item=>!ids.has(item.id));setPhotos(items.current);updateSelection(selection.current.filter(id=>!ids.has(id)));for(const item of removed)URL.revokeObjectURL(item.url);
 }
 async function send(){
  if(lock.current||disabled||!selection.current.length)return;
  const files=selection.current.map(id=>items.current.find(item=>item.id===id)?.file).filter((file):file is File=>!!file);
  lock.current=true;setBusy(true);setError('');setPreview(null);
  try{await onSend(files,original,delivered);if(alive.current){lock.current=false;setBusy(false);close();}}
  catch(cause){if(alive.current)setError(reportUserFacingError(cause,'send','发送图片'));}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 const selectedPhotos=selected.map(id=>photos.find(item=>item.id===id)).filter((item):item is Photo=>!!item),current=preview===null?null:selectedPhotos[preview],blocked=busy||disabled;
 const page=<dialog open ref={panel} className={`zy-m-photo-picker${closing?' is-closing':''}`} aria-modal="true" aria-label="选择图片" tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(preview!==null)setPreview(null);else close();}if(event.key==='Tab'){const buttons=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([hidden])')||[]),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}}>
  <input ref={library} type="file" accept="image/*" multiple hidden onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/>
  <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/>
  <header className="zy-m-photo-head"><button type="button" disabled={blocked} onClick={close}>取消</button><button type="button" className="zy-m-photo-source" disabled={blocked} onClick={()=>library.current?.click()}>最近项目<ChevronDown size={14}/></button><span/></header>
  {error&&<p className="zy-m-photo-error" role="alert">{error}</p>}
  {progress&&<div className="zy-m-photo-upload-status" aria-live="polite">{progress.phase==='uploading'&&progress.total!==null?<MeasuredProgress value={progress.loaded} total={progress.total} label="正在上传图片"/>:<span>{progress.phase==='processing'?'上传完成，正在处理图片…':progress.phase==='preparing'?'正在准备上传…':'正在上传…'}</span>}</div>}
  <div className="zy-m-photo-grid"><button type="button" className="zy-m-photo-camera" disabled={blocked} onClick={()=>camera.current?.click()}><Camera size={24} strokeWidth={1.6}/><span>拍照</span></button>{photos.map(photo=>{const order=selected.indexOf(photo.id);return <button type="button" className="zy-m-photo-tile" key={photo.id} aria-label={`${photo.file.name}，${order<0?'未选择':`已选择第${order+1}张`}`} aria-pressed={order>=0} disabled={blocked} onClick={()=>toggle(photo.id)}><img src={photo.url} alt={photo.file.name}/><span className={`zy-m-photo-number${order>=0?' is-selected':''}`}>{order>=0?order+1:''}</span></button>;})}</div>
  <footer className="zy-m-photo-footer"><button type="button" disabled={blocked||!selected.length} onClick={()=>setPreview(0)}>预览</button><button type="button" className="zy-m-photo-original" role="switch" aria-label="原图" aria-checked={original} disabled={blocked} onClick={()=>setOriginal(value=>!value)}><span>{original&&<Check size={10} strokeWidth={2.5}/>}</span>原图</button><button type="button" className="zy-m-photo-send" disabled={blocked||!selected.length} onClick={()=>void send()}>{busy?'发送中…':`发送 (${selected.length})`}</button></footer>
  {current&&<div className="zy-m-photo-preview"><button type="button" className="zy-m-photo-preview-close" aria-label="关闭预览" onClick={()=>setPreview(null)}><X size={22}/></button><img src={current.url} alt={current.file.name}/><div><button type="button" aria-label="上一张图片" disabled={preview===0} onClick={()=>setPreview(value=>Math.max(0,(value||0)-1))}><ChevronLeft size={24}/></button><span>{(preview||0)+1} / {selected.length}</span><button type="button" aria-label="下一张图片" disabled={preview===selected.length-1} onClick={()=>setPreview(value=>Math.min(selected.length-1,(value||0)+1))}><ChevronRight size={24}/></button></div></div>}
 </dialog>;
 return host?createPortal(page,host):page;
}
