'use client';
import {useEffect,useLayoutEffect,useRef} from 'react';
import {npcFetch} from './npc-fetch';
const validPeople=new Set(['molly','xia-xia','yuan-xiaoman','he-jiawei','chen-nian','liu','zhou-chef']);
/** One stable participant per mounted window; account clock is deduplicated by the server. */
export function useContinuousUse({accountId,characterId,enabled=true,busy=false}:{accountId:string;characterId:string;enabled?:boolean;busy?:boolean}){
 const context=useRef({characterId,enabled,busy});
 const changed=useRef<(()=>void)|null>(null);
 useLayoutEffect(()=>{context.current={characterId,enabled,busy};changed.current?.();},[characterId,enabled,busy]);
 useEffect(()=>{
  const clientId=crypto.randomUUID();
  const ping=(closing=false)=>{const state=context.current;void npcFetch('/api/npc/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify({action:'usage',clientId,currentNpc:validPeople.has(state.characterId)?state.characterId:'molly',visible:!closing&&state.enabled&&document.visibilityState==='visible',busy:state.busy||!document.hasFocus()})}).catch(()=>{});};
  const sync=()=>ping();changed.current=sync;sync();
  const timer=setInterval(sync,30000);document.addEventListener('visibilitychange',sync);window.addEventListener('focus',sync);window.addEventListener('blur',sync);
  return()=>{changed.current=null;clearInterval(timer);document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync);window.removeEventListener('blur',sync);ping(true);};
 },[accountId]);
}
