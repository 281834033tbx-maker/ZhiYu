'use client';

import {accountStorage,flushAccountStorage,getAccountStorageStatus} from './account-storage';
import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {assets, type ChatMessage} from '../../lib/npc/contracts';
import type {ImageViewerPayload, ViewerImage} from './desktop-bridge';
import {MobileComposerContext} from './mobile-composer-context';
import {TEAM_CARD_IMAGE,TEAM_CARD_LABEL} from '../../lib/npc/team-card';

type Gallery = {conversationId:string; images:ViewerImage[]};
const GalleryContext = createContext<Gallery|null>(null);
export const useImageGallery = () => useContext(GalleryContext);

export function chatGallery(messages:ChatMessage[], npcName:string):ViewerImage[] {
  return messages.flatMap(message => {
    const part = message.part;
    if(part.type==='team_card')return [{id:message.id,src:TEAM_CARD_IMAGE,alt:TEAM_CARD_LABEL,
      at:message.at,sender:message.role==='user'?'你':npcName}];
    const src = message.legacyContent?.image || (part.type === 'generated_photo' ? (part.status === 'ready' ? part.url : null)
      : part.type === 'upload' ? part.url : 'assetId' in part ? assets[part.assetId].url : null);
    if (!src) return [];
    return [{id:message.id, src, alt:part.type==='generated_photo' ? part.caption || '聊天图片'
      : 'assetId' in part ? assets[part.assetId].description : '聊天图片',
      at:message.at, sender:message.role==='user' ? '你' : npcName}];
  });
}
export function ImageGallery({conversationId,images,children}:Gallery & {children:ReactNode}) {
  const mobile=useContext(MobileComposerContext);
  useEffect(() => {
    if(mobile)return;
    if (images.length) void window.zhiyuDesktop?.updateImageViewer?.({conversationId,images,index:0});
  },[conversationId,images,mobile]);
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
  const owner=getAccountStorageStatus().accountId;
  const store=accountStorage(owner||undefined);
  // Open during the user's click so popup blockers permit it; navigate only
  // after the authenticated server has acknowledged the handoff payload.
  const popup=window.open('about:blank',`zhiyu-image-${key}`,'popup,width=800,height=540');
  if(!popup)throw Error('请允许浏览器弹出图片窗口');
  try{
    store.setItem(`zhiyu-image-popup:${key}`,JSON.stringify({...payload,history:false,pinned:false}));
    await flushAccountStorage(owner||undefined);
    if(getAccountStorageStatus().accountId!==owner)throw Error('账号已变化，请重新打开图片');
    if(popup.closed)return;
    popup.location.replace(`/image-viewer?key=${key}`);
  }catch(reason){popup.close();store.removeItem(`zhiyu-image-popup:${key}`);throw reason;}
}
