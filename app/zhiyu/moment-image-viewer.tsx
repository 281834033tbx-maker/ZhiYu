'use client';

// Original local/user media remains available to canvas copy and downloads.
/* eslint-disable next/no-img-element */
import {useCallback,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,Copy,Download,ExternalLink,X} from 'lucide-react';
import {LoadingSkeleton} from './loading-state';
import {afterImageDecode} from './media-loading';
import {MobileComposerContext} from './mobile-composer-context';
import {animateImageTransition,findImageOrigin,type ImageTransition} from './image-viewer-motion';
import './moment-image-viewer.css';

type Props={images:string[];start:number;close:()=>void;origin?:HTMLImageElement|null;onOpenNative?:(index:number)=>Promise<void>};
export default function MomentImageViewer({images,start,close,origin,onOpenNative}:Props) {
 const mobile=useContext(MobileComposerContext);
 const [index,setIndex]=useState(()=>Math.max(0,Math.min(images.length-1,start)));
 const [loaded,setLoaded]=useState(''),[failed,setFailed]=useState(''),[notice,setNotice]=useState(''),[copying,setCopying]=useState(false),[saving,setSaving]=useState(false),[nativeOpening,setNativeOpening]=useState(false);
 const [phase,setPhase]=useState<'pending'|'opening'|'open'|'closing'>('pending');
 const phaseRef=useRef(phase),closing=useRef(false),openingStarted=useRef(false),transition=useRef<ImageTransition|null>(null),closeRef=useRef(close);
 const [displayOnly,setDisplayOnly]=useState<Set<string>>(()=>new Set());
 const dialog=useRef<HTMLDialogElement>(null),image=useRef<HTMLImageElement>(null),alive=useRef(true),copyLock=useRef(false),saveLock=useRef(false),nativeLock=useRef(false);
 const current=images[index],key=index+':'+current,anonymous=!displayOnly.has(current),ready=loaded===key&&failed!==key;
 useLayoutEffect(()=>{phaseRef.current=phase;closeRef.current=close;},[phase,close]);
 const requestClose=useCallback(()=>{
  if(closing.current)return;closing.current=true;phaseRef.current='closing';setPhase('closing');
  const node=dialog.current,frame=node?.querySelector<HTMLElement>('.zy-image-motion-frame'),frameImage=frame?.querySelector('img');
  const closingFrom=frame&&frameImage?{rect:frame.getBoundingClientRect(),crop:getComputedStyle(frameImage).objectPosition}:undefined;
  transition.current?.cancel();
  if(!node){closeRef.current();return;}
  transition.current=animateImageTransition({dialog:node,picture:image.current,origin:findImageOrigin(images[index],index===start?origin:undefined),closing:true,closingFrom});
  void transition.current.finished.then(()=>{if(alive.current)closeRef.current();});
 },[images,index,origin,start]);
 const selectImage=useCallback((position:number)=>{
  if(position===index||closing.current||phaseRef.current!=='open')return;
  setLoaded('');setFailed('');setNotice('');setIndex(position);
 },[index]);
 useLayoutEffect(()=>{
  const node=dialog.current;
  if(!mobile){node?.showModal();return()=>node?.close();}
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  node?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[mobile]);
 useLayoutEffect(()=>{
  if(closing.current||openingStarted.current||(!ready&&failed!==key))return;
  const node=dialog.current;if(!node)return;
  openingStarted.current=true;setPhase('opening');
  transition.current=animateImageTransition({dialog:node,picture:ready?image.current:null,origin:findImageOrigin(current,origin)});
  void transition.current.finished.then(()=>{if(alive.current&&!closing.current){phaseRef.current='open';setPhase('open');}});
 },[current,failed,key,origin,ready]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;transition.current?.cancel();};},[]);
 useEffect(()=>{
  const keyboard=(event:KeyboardEvent)=>{
   if(event.altKey||event.ctrlKey||event.metaKey)return;
   if(event.key==='Escape'){event.preventDefault();requestClose();return;}
   if(event.key==='ArrowLeft'){event.preventDefault();selectImage(Math.max(0,index-1));}
   if(event.key==='ArrowRight'){event.preventDefault();selectImage(Math.min(images.length-1,index+1));}
  };
  document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);
 },[images.length,index,selectImage,requestClose]);
 async function copyCurrent() {
  if(copyLock.current||!ready||!image.current?.naturalWidth)return;
  copyLock.current=true;setCopying(true);setNotice('');
  try {
   if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('当前环境暂不支持复制图片');
   const picture=image.current,canvas=document.createElement('canvas');canvas.width=picture.naturalWidth;canvas.height=picture.naturalHeight;
   const context=canvas.getContext('2d');if(!context)throw Error('图片读取失败，请重试');context.drawImage(picture,0,0);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片转换失败，请重试')),'image/png'));
   await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);if(alive.current)setNotice('图片已复制');
  }catch(error){if(alive.current)setNotice(error instanceof DOMException&&error.name==='SecurityError'?'这张图片不允许复制，请换一张重试':error instanceof Error?error.message:'复制图片失败，请重试');}
  finally{copyLock.current=false;if(alive.current)setCopying(false);}
 }
 async function saveCurrent() {
  if(saveLock.current||!ready)return;saveLock.current=true;setSaving(true);setNotice('');
  try{
   const response=await fetch(current);if(!response.ok)throw Error('图片读取失败');const blob=await response.blob();
   const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'} as Record<string,string>)[blob.type]||'png';
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`智域图片-${Date.now()}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   if(alive.current)setNotice('已开始下载图片');
  }catch{if(alive.current)setNotice('图片暂时无法保存，请稍后重试');}
  finally{saveLock.current=false;if(alive.current)setSaving(false);}
 }
 async function openNative() {
  if(!onOpenNative||nativeLock.current)return;nativeLock.current=true;setNativeOpening(true);setNotice('');
  try{await onOpenNative(index);if(alive.current)requestClose();}
  catch{if(alive.current)setNotice('独立图片窗口暂时无法打开，请重试');}
  finally{nativeLock.current=false;if(alive.current)setNativeOpening(false);}
 }
 if(typeof document==='undefined')return null;
 const portal=mobile?document.querySelector('main.zy-mobile'):document.body;if(!portal)return null;
 return createPortal(<dialog ref={dialog} open={mobile||undefined} tabIndex={mobile?-1:undefined} aria-modal={mobile?'true':undefined} data-image-phase={phase} className={'zy-moment-image-viewer zy-image-motion-viewer'+(mobile?' zy-mobile-image-viewer':'')} aria-label="查看图片" onCancel={event=>{event.preventDefault();requestClose();}}>
  <button type="button" className="zy-moment-image-dismiss-area" aria-label="收起图片背景" onClick={requestClose}/><div className="zy-moment-image-toolbar">
   {!mobile&&onOpenNative&&<button type="button" aria-label="在独立窗口打开" title="在独立窗口打开" disabled={nativeOpening} onClick={()=>void openNative()}><ExternalLink size={19}/></button>}
   <button type="button" aria-label="保存图片" title="保存图片" disabled={!ready||saving} onClick={()=>void saveCurrent()}><Download size={20}/></button>
   <button type="button" aria-label="复制图片" title="复制图片" disabled={!ready||copying} onClick={()=>void copyCurrent()}><Copy size={20}/></button>
   <button type="button" aria-label="关闭图片" title="关闭" onClick={requestClose} autoFocus><X size={22}/></button>
  </div>
  <button type="button" className="zy-moment-image-stage" aria-label="收起图片" aria-busy={!ready&&failed!==key} onClick={requestClose}>
   {current&&<img key={key+(anonymous?':cors':':display')} ref={image} src={current} crossOrigin={anonymous?'anonymous':undefined} alt={`图片 ${index+1}`} draggable={false} decoding="async" className={'zy-media-reveal'+(ready?' is-ready':'')}
    onLoad={()=>{const picture=image.current;if(picture)afterImageDecode(picture,()=>{if(alive.current&&image.current===picture){setLoaded(key);setFailed(value=>value===key?'':value);}});}} onError={()=>{
     if(anonymous){setLoaded('');setDisplayOnly(previous=>previous.has(current)?previous:new Set([...previous,current]));}else setFailed(key);
    }}/>} 
   {!ready&&failed!==key&&<LoadingSkeleton label="正在加载图片" variant="media"/>}
   {failed===key&&<p className="zy-moment-image-error" role="alert">图片暂时无法打开</p>}
  </button>
  {images.length>1&&<>
   <button type="button" className="zy-moment-image-prev" aria-label="上一张" title="上一张" disabled={index===0} onClick={()=>selectImage(Math.max(0,index-1))}><ChevronLeft size={28}/></button>
   <button type="button" className="zy-moment-image-next" aria-label="下一张" title="下一张" disabled={index===images.length-1} onClick={()=>selectImage(Math.min(images.length-1,index+1))}><ChevronRight size={28}/></button>
   <fieldset className="zy-moment-image-dots" aria-label="图片切换">{images.map((src,position)=><button type="button" key={position+':'+src} aria-label={`查看第${position+1}张图片`} aria-pressed={index===position} onClick={()=>selectImage(position)}><i aria-hidden="true"/></button>)}</fieldset>
  </>}
  <span className="zy-moment-image-position" aria-live="polite">{index+1} / {images.length}</span>
  {notice&&<output className="zy-moment-image-notice">{notice}</output>}
 </dialog>,portal);
}
