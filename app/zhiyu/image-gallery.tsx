'use client';
import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {assets, type ChatMessage} from '../../lib/npc/contracts';
import type {ImageViewerPayload, ViewerImage} from './desktop-bridge';

type Gallery = {conversationId:string; images:ViewerImage[]};
const GalleryContext = createContext<Gallery|null>(null);
export const useImageGallery = () => useContext(GalleryContext);

export function chatGallery(messages:ChatMessage[], npcName:string):ViewerImage[] {
  return messages.flatMap(message => {
    const part = message.part;
    const src = message.legacyContent?.image || (part.type === 'generated_photo' ? (part.status === 'ready' ? part.url : null)
      : part.type === 'upload' ? part.url : 'assetId' in part ? assets[part.assetId].url : null);
    if (!src) return [];
    return [{id:message.id, src, alt:part.type==='generated_photo' ? part.caption || '聊天图片'
      : 'assetId' in part ? assets[part.assetId].description : '聊天图片',
      at:message.at, sender:message.role==='user' ? '你' : npcName}];
  });
}
export function ImageGallery({conversationId,images,children}:Gallery & {children:ReactNode}) {
  useEffect(() => {
    if (images.length) void window.zhiyuDesktop?.updateImageViewer?.({conversationId,images,index:0});
  },[conversationId,images]);
  return <GalleryContext.Provider value={{conversationId,images}}>{children}</GalleryContext.Provider>;
}

export async function openImageViewer(payload:ImageViewerPayload) {
  if (window.zhiyuDesktop?.openImageViewer) {
    if (!await window.zhiyuDesktop.openImageViewer(payload)) throw Error('图片窗口未能打开，请重试');
    return;
  }
  // An already-running old desktop shell must not fall back to a normal framed popup.
  // That popup has a second title bar and cannot perform native pin/copy/save actions.
  if (window.zhiyuDesktop || /Electron\//.test(navigator.userAgent)) {
    throw Error('图片查看器已更新，请用 ⌘Q 完全退出智域后重新打开');
  }
  // Browser previews use a real popup too, not a modal inside the main application.
  const key = crypto.randomUUID();
  localStorage.setItem(`zhiyu-image-popup:${key}`,JSON.stringify({...payload,history:false,pinned:false}));
  const popup = window.open(`/image-viewer?key=${key}`,`zhiyu-image-${key}`,'popup,width=800,height=540');
  if (!popup) { localStorage.removeItem(`zhiyu-image-popup:${key}`); throw Error('请允许浏览器弹出图片窗口'); }
}
