'use client';
/* eslint-disable next/no-img-element */
import {useState} from 'react';
import {useImageGallery, openImageViewer} from './image-gallery';
import type {ViewerImage} from './desktop-bridge';
import './chat-image.css';
import ChatImagePlaceholder from './chat-image-placeholder';

export default function ChatImage({src,alt,messageId,className,gallery:providedGallery}:{src:string;alt:string;messageId?:string;className?:string;gallery?:{conversationId:string;images:ViewerImage[]}}) {
  const inheritedGallery=useImageGallery();
  const gallery=providedGallery||inheritedGallery;
  const [error,setError]=useState('');
  const [failedSrc,setFailedSrc]=useState<string|null>(null);
  const [attempt,setAttempt]=useState(0);
  const missingSource=!src.trim();
  const failed=missingSource||failedSrc===src;
  function reload() {
    setFailedSrc(null);
    setAttempt(previous=>previous+1);
    setError('');
  }
  async function open() {
    setError('');
    const index=gallery?.images.findIndex(item=>messageId ? item.id===messageId : item.src===src) ?? -1;
    try {
      await openImageViewer(index>=0 && gallery ? {...gallery,index}
        : {conversationId:'image',images:[{id:messageId||src,src,alt}],index:0});
    } catch(cause) {setError(cause instanceof Error?cause.message:'图片窗口未能打开');}
  }
  return <>{failed?<ChatImagePlaceholder className={className} onRetry={missingSource?undefined:reload}/>:<button className="chat-image-open" type="button" aria-label="查看图片" onClick={()=>void open()}><img key={`${src}:${attempt}`} className={className} src={src} alt={alt} onError={()=>setFailedSrc(src)}/></button>}
    {error&&<small className="chat-image-error" role="alert">{error}</small>}</>;
}
