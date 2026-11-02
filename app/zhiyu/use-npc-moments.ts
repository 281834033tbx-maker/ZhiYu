'use client';
import { useEffect } from 'react';
import { npcFetch } from './npc-fetch';
import type { Post, Comment } from './data';
type Item={id:string;personId:string;status:string;text:string;createdAt:number;images:string[];chatScreenshot?:Post['chatScreenshot'];liked?:boolean;likes?:{actorId:string;name:string}[];likeCount?:number;comments?:Comment[]};
export function useNpcMoments(ready:boolean,onPosts:(posts:Post[])=>void) {
  useEffect(()=>{
    if(!ready)return;
    let cancelled=false,fetching=false;
    const refresh=async()=>{
      if(fetching || document.visibilityState==='hidden')return;
      fetching=true;
      try {
        const response=await npcFetch('/api/npc/moments');if(!response.ok)return;
        const data=await response.json() as {items:Item[]};
        if(!cancelled)onPosts(data.items.filter(i=>i.status==='published').map(i=>({id:i.id,personId:i.personId,time:new Date(i.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}),text:i.text,images:i.images,chatScreenshot:i.chatScreenshot,source:'npc-moment',location:'',liked:i.liked||false,likes:i.likes||[],likeCount:i.likeCount||0,comments:i.comments||[]})));
      } catch { /* Keep the last loaded feed and retry on the next interval. */ }
      finally{fetching=false;}
    };
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('npc-moments-changed',refresh);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('npc-moments-changed',refresh);};
  },[ready,onPosts]);
}
