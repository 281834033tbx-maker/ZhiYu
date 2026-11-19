'use client';
import {reportUserFacingError} from '../../lib/user-facing-errors';
/* eslint-disable next/no-img-element */
import {useRef,useState} from 'react';
import {useImageGallery, openImageViewer} from './image-gallery';
import type {ViewerImage} from './desktop-bridge';
import './chat-image.css';
import ChatImagePlaceholder from './chat-image-placeholder';
import {LoadingSkeleton} from './loading-state';
import {afterImageDecode} from './media-loading';
import MomentImageViewer from './moment-image-viewer';

export default function ChatImage({src,alt,messageId,className,gallery:providedGallery}:{src:string;alt:string;messageId?:string;className?:string;gallery?:{conversationId:string;images:ViewerImage[]}}) {
  const inheritedGallery=useImageGallery();
  const gallery=providedGallery||inheritedGallery;
  const [viewer,setViewer]=useState<{images:string[];start:number;origin:HTMLImageElement|null;gallery:{conversationId:string;images:ViewerImage[]}}|null>(null);
  const [error,setError]=useState('');
  const [failedSrc,setFailedSrc]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  const [loaded,setLoaded]=useState(''),[sized,setSized]=useState('');
  const image=useRef<HTMLImageElement>(null);
  const imageKey=`${src}:${attempt}`;
  const ready=loaded===imageKey;
  const missingSource=!src.trim();
  const failed=missingSource||failedSrc===src;
  function reload() {
    setFailedSrc(null);
    setAttempt(previous=>previous+1);
    setError('');
  }
  function open() {
    setError('');
    const index=gallery?.images.findIndex(item=>messageId ? item.id===messageId : item.src===src) ?? -1;
    setViewer(index>=0&&gallery?{images:gallery.images.map(item=>item.src),start:index,gallery,origin:image.current}:{images:[src],start:0,origin:image.current,gallery:{conversationId:'image',images:[{id:messageId||src,src,alt}]}});
  }
  return <>{failed?<ChatImagePlaceholder className={className} onRetry={missingSource?undefined:reload}/>:<button className={'chat-image-open'+(!ready?' is-loading':'')+(sized!==imageKey?' is-unsized':'')} type="button" aria-label="查看图片" aria-busy={!ready} onClick={open}>
    <img key={imageKey} ref={image} className={`${className||''} zy-media-reveal${ready?' is-ready':''}`} src={src} alt={alt} decoding="async" onLoad={event=>{
      const picture=event.currentTarget;setSized(imageKey);
      afterImageDecode(picture,()=>{if(image.current===picture)setLoaded(imageKey);});
    }} onError={()=>setFailedSrc(src)}/>
    {!ready&&<LoadingSkeleton label="正在加载图片" variant="media"/>}
  </button>}
    {error&&<small className="chat-image-error" role="alert">{error}</small>}
    {viewer&&<MomentImageViewer images={viewer.images} start={viewer.start} origin={viewer.origin} close={()=>setViewer(null)} onOpenNative={async index=>{try{await openImageViewer({...viewer.gallery,index});}catch(cause){setError(reportUserFacingError(cause,'media','打开图片'));throw cause;}}}/>}</>;
}
