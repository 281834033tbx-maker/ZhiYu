'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {ArrangementItem,ArrangementPreference} from '../../../lib/npc/arrangement-types';
import type {ArrangementSectionId} from '../../../lib/npc/arrangement-sections';
import {npcFetch} from '../npc-fetch';

export const ARRANGEMENTS_CHANGED='zhiyu-arrangements-changed';
export const OPEN_ARRANGEMENT='zhiyu-open-arrangement';
export function openArrangementSection(section:ArrangementSectionId,id?:string) {
  window.dispatchEvent(new CustomEvent(OPEN_ARRANGEMENT,{detail:{section,id}}));
}
export type ArrangementMutation=
  |{action:'revoke'|'complete';id:string}
  |{action:'move';id:string;section:ArrangementSectionId}
  |{action:'step';id:string;index:number;done:boolean}
  |{action:'offer';pendingId:string;decision:'accepted'|'declined'}
  |{action:'preference';section:ArrangementSectionId;category?:string;enabled:boolean};
export async function mutateArrangement(accountId:string,mutation:ArrangementMutation):Promise<ArrangementItem|undefined> {
  const response=await npcFetch('/api/npc/arrangements',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(mutation)});
  const result=await response.json().catch(()=>({error:'安排未保存，请重试。'})) as {error?:string;item?:ArrangementItem};
  if(!response.ok)throw Error(typeof result.error==='string'?result.error:'安排未保存，请重试。');
  window.dispatchEvent(new CustomEvent(ARRANGEMENTS_CHANGED,{detail:{accountId}}));
  return result.item;
}
/** Read only active records for the signed-in owner. Old board snapshots are
 * displayed separately; opening this view never migrates or rewrites them. */
export function useArrangements(accountId:string) {
  const [snapshot,setSnapshot]=useState<{owner:string;items:ArrangementItem[];preferences:ArrangementPreference[];ready:boolean;error:string}>({owner:'',items:[],preferences:[],ready:false,error:''});
  const ownerRef=useRef(accountId),revision=useRef(0);
  const refresh=useCallback(async()=>{
    const turn=++revision.current;
    try {
      const response=await npcFetch('/api/npc/arrangements?status=all',{cache:'no-store',credentials:'same-origin',headers:{'X-Zhiyu-Account':accountId}});
      const result=await response.json() as {items?:ArrangementItem[];preferences?:ArrangementPreference[]};
      if(!response.ok||!Array.isArray(result.items))throw Error('安排暂时无法读取，请稍后重试。');
      if(ownerRef.current===accountId&&revision.current===turn)setSnapshot({owner:accountId,items:result.items,preferences:Array.isArray(result.preferences)?result.preferences:[],ready:true,error:''});
    }catch(error){
      if(ownerRef.current===accountId&&revision.current===turn)setSnapshot(previous=>({owner:accountId,items:previous.owner===accountId?previous.items:[],preferences:previous.owner===accountId?previous.preferences:[],ready:true,error:error instanceof Error?error.message:'安排暂时无法读取。'}));
    }
  },[accountId]);
  useEffect(()=>{
    if(!accountId)return;
    ownerRef.current=accountId;
    const requestRevision=revision;
    const frame=requestAnimationFrame(()=>void refresh());
    const changed=(event:Event)=>{const owner=(event as CustomEvent<{accountId?:string}>).detail?.accountId;if(!owner||owner===accountId)void refresh();};
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener(ARRANGEMENTS_CHANGED,changed);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    const timer=setInterval(visible,30000);
    return()=>{requestRevision.current++;cancelAnimationFrame(frame);clearInterval(timer);window.removeEventListener(ARRANGEMENTS_CHANGED,changed);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[accountId,refresh]);
  const mutate=useCallback(async(mutation:ArrangementMutation)=>{const item=await mutateArrangement(accountId,mutation);await refresh();return item;},[accountId,refresh]);
  return {items:snapshot.owner===accountId?snapshot.items:[],preferences:snapshot.owner===accountId?snapshot.preferences:[],ready:snapshot.owner===accountId&&snapshot.ready,error:snapshot.owner===accountId?snapshot.error:'',refresh,mutate};
}
