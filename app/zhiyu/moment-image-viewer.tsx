'use client';

// Display original local/user images at native dimensions for canvas copying.
/* eslint-disable next/no-img-element */

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,Copy,X} from 'lucide-react';
import './moment-image-viewer.css';

export default function MomentImageViewer({images,start,close}:{images:string[];start:number;close:()=>void}) {
  const [index,setIndex]=useState(()=>Math.max(0,Math.min(images.length-1,start)));
  const [loaded,setLoaded]=useState(''),[failed,setFailed]=useState(''),[notice,setNotice]=useState(''),[copying,setCopying]=useState(false);
  const [displayOnly,setDisplayOnly]=useState<Set<string>>(()=>new Set());
  const dialog=useRef<HTMLDialogElement>(null),image=useRef<HTMLImageElement>(null),alive=useRef(true),copyLock=useRef(false);
  const current=images[index],key=index+':'+current;
  const anonymous=!displayOnly.has(current);
  const ready=loaded===key&&failed!==key;
  const selectImage=useCallback((position:number)=>{
    if(position===index)return;
    setLoaded('');setFailed('');setNotice('');setIndex(position);
  },[index]);
  useLayoutEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      if(event.key==='ArrowLeft'){event.preventDefault();selectImage(Math.max(0,index-1));}
      if(event.key==='ArrowRight'){event.preventDefault();selectImage(Math.min(images.length-1,index+1));}
    };
    document.addEventListener('keydown',keyboard);
    return()=>document.removeEventListener('keydown',keyboard);
  },[images.length,index,selectImage]);
  async function copyCurrent() {
    if(copyLock.current||!ready||!image.current?.naturalWidth)return;
    copyLock.current=true;setCopying(true);setNotice('');
    try {
      if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('当前环境暂不支持复制图片');
      const picture=image.current,canvas=document.createElement('canvas');
      canvas.width=picture.naturalWidth;canvas.height=picture.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('图片读取失败，请重试');
      context.drawImage(picture,0,0);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('图片转换失败，请重试')),'image/png'));
      await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      if(alive.current)setNotice('图片已复制');
    }catch(error){
      if(alive.current)setNotice(error instanceof DOMException&&error.name==='SecurityError'?'这张图片不允许复制，请换一张重试':error instanceof Error?error.message:'复制图片失败，请重试');
    }finally{copyLock.current=false;if(alive.current)setCopying(false);}
  }
  if(typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="zy-moment-image-viewer" aria-label="查看图片"
    onCancel={event=>{event.preventDefault();close();}}>
    <div className="zy-moment-image-toolbar">
      <button type="button" aria-label="复制图片" title="复制图片" disabled={!ready||copying} onClick={()=>void copyCurrent()}><Copy size={20}/></button>
      <button type="button" aria-label="关闭图片" title="关闭" onClick={close} autoFocus><X size={22}/></button>
    </div>
    <div className="zy-moment-image-stage">
      {current&&<img key={key+(anonymous?':cors':':display')} ref={image} src={current} crossOrigin={anonymous?'anonymous':undefined} alt={`图片 ${index+1}`} draggable={false}
        onLoad={()=>{setLoaded(key);setFailed(value=>value===key?'':value);}} onError={()=>{
          if(anonymous){
            // Some otherwise displayable external images do not send CORS
            // headers. Retry display once; canvas still enforces copy access.
            setLoaded('');setDisplayOnly(previous=>previous.has(current)?previous:new Set([...previous,current]));
          }else setFailed(key);
        }}/>}
      {failed===key&&<p className="zy-moment-image-error" role="alert">图片暂时无法打开</p>}
    </div>
    {images.length>1&&<>
      <button type="button" className="zy-moment-image-prev" aria-label="上一张" title="上一张" disabled={index===0} onClick={()=>selectImage(Math.max(0,index-1))}><ChevronLeft size={28}/></button>
      <button type="button" className="zy-moment-image-next" aria-label="下一张" title="下一张" disabled={index===images.length-1} onClick={()=>selectImage(Math.min(images.length-1,index+1))}><ChevronRight size={28}/></button>
      <fieldset className="zy-moment-image-dots" aria-label="图片切换">
        {images.map((src,position)=><button type="button" key={position+':'+src} aria-label={`查看第${position+1}张图片`} aria-pressed={index===position} onClick={()=>selectImage(position)}><i aria-hidden="true"/></button>)}
      </fieldset>
    </>}
    <span className="zy-moment-image-position" aria-live="polite">{index+1} / {images.length}</span>
    {notice&&<output className="zy-moment-image-notice">{notice}</output>}
  </dialog>,document.body);
}
