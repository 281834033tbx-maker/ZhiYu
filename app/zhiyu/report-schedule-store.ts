'use client';

import {useCallback,useEffect,useSyncExternalStore} from 'react';
import type {SecretarySettings} from '../../lib/npc/experience';
import {npcFetch} from './npc-fetch';

type ScheduleSnapshot={settings:SecretarySettings|null;loading:boolean;error:boolean};
const emptySnapshot:ScheduleSnapshot={settings:null,loading:true,error:false};
const validTime=(value:unknown):value is string=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const reportScheduleDefaults:SecretarySettings={enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30'};

/** In-memory confirmed settings only. No task records, timers or browser
 * persistence are changed when the task board displays a saved schedule. */
export function createReportScheduleStore(fetcher:typeof npcFetch=npcFetch) {
  const snapshots=new Map<string,ScheduleSnapshot>(),versions=new Map<string,number>();
  const listeners=new Map<string,Set<()=>void>>(),pending=new Map<string,Promise<void>>();
  const get=(accountId:string)=>snapshots.get(accountId)||emptySnapshot;
  const notify=(accountId:string)=>listeners.get(accountId)?.forEach(listener=>listener());
  function publish(accountId:string,settings:SecretarySettings) {
    if(!accountId||!validTime(settings.time)||typeof settings.enabled!=='boolean')return;
    const confirmed={...settings,weeklyEnabled:settings.weeklyEnabled??reportScheduleDefaults.weeklyEnabled,weeklyDay:settings.weeklyDay??reportScheduleDefaults.weeklyDay,weeklyTime:settings.weeklyTime??reportScheduleDefaults.weeklyTime,...(settings.city?{city:{...settings.city}}:{})};
    versions.set(accountId,(versions.get(accountId)||0)+1);
    snapshots.set(accountId,{settings:confirmed,loading:false,error:false});notify(accountId);
  }
  function subscribe(accountId:string,listener:()=>void) {
    const set=listeners.get(accountId)||new Set<()=>void>();set.add(listener);listeners.set(accountId,set);
    return()=>{set.delete(listener);if(!set.size)listeners.delete(accountId);};
  }
  function refresh(accountId:string):Promise<void> {
    if(!accountId)return Promise.resolve();
    const existing=pending.get(accountId);if(existing)return existing;
    const version=versions.get(accountId)||0;
    const request=Promise.resolve().then(async()=>{
      try {
        const response=await fetcher('/api/npc/secretary',{cache:'no-store',headers:{'X-Zhiyu-Account':accountId}});
        const data=await response.json() as {settings?:SecretarySettings};
        if(!response.ok||!data.settings||!validTime(data.settings.time)||typeof data.settings.enabled!=='boolean')throw Error('Settings unavailable');
        if((versions.get(accountId)||0)===version)publish(accountId,data.settings);
      }catch{
        if((versions.get(accountId)||0)===version){snapshots.set(accountId,{settings:get(accountId).settings,loading:false,error:true});notify(accountId);}
      }finally{pending.delete(accountId);}
    });
    pending.set(accountId,request);return request;
  }
  return {get,publish,subscribe,refresh};
}

export const reportScheduleStore=createReportScheduleStore();

export function useReportSchedule(accountId:string) {
  const subscribe=useCallback((listener:()=>void)=>reportScheduleStore.subscribe(accountId,listener),[accountId]);
  const snapshot=useCallback(()=>reportScheduleStore.get(accountId),[accountId]);
  const value=useSyncExternalStore(subscribe,snapshot,()=>emptySnapshot);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState!=='hidden')void reportScheduleStore.refresh(accountId);};
    refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[accountId]);
  return value;
}

export function weeklyReviewScheduleLabel(snapshot:ScheduleSnapshot):string {
  const {settings,loading,error}=snapshot;
  if(!settings)return loading?'时间同步中…':error?'周报时间暂未同步':'周报时间未设置';
  if(settings.weeklyEnabled===false)return '周报已关闭';
  return validTime(settings.weeklyTime)?`今晚 ${settings.weeklyTime}`:'周报时间未设置';
}
