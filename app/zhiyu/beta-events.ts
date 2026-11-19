'use client';

import type {BetaEventMeta} from '../../lib/npc/beta-analytics';

type Feature='brief_viewed'|'weekly_viewed'|'platform_opened'|'card_shared';
/** Records a completed UI action, never its content. Retries retain the event ID. */
export function recordBetaFeature(account:{id:string;storageMode?:string},type:Feature,options:{npcId?:string;meta?:BetaEventMeta}={}){
  if(account.storageMode!=='server')return;
  const body=JSON.stringify({eventId:crypto.randomUUID(),type,...options});
  let attempts=0;
  const send=async()=>{
    try{
      const response=await fetch('/api/beta/events',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account.id},body,keepalive:true});
      if(response.ok||response.status===401||response.status===409||response.status===400)return;
    }catch{/* Retry this real action without inventing another event. */}
    if(++attempts<5)setTimeout(()=>void send(),Math.min(1000*2**attempts,15000));
  };
  void send();
}
