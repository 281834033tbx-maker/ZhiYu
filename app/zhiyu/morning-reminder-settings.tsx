'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {X} from 'lucide-react';
import {useAccount} from './auth-gate';
import {npcFetch} from './npc-fetch';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import type {SecretarySettings} from '../../lib/npc/experience';
import './morning-reminder-settings.css';

type Settings = SecretarySettings;
type SettingsResponse = {settings?:Settings;error?:string};
const validTime = (time:string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
const defaults:Settings = {enabled:true,time:'07:00',weeklyEnabled:true,weeklyDay:0,weeklyTime:'21:30'};
function responseSettings(result:SettingsResponse):Settings {
  const settings=result.settings;
  if(!settings || typeof settings.enabled!=='boolean' || !validTime(settings.time)) throw Error('设置暂时无法同步');
  return {...defaults,...settings};
}

export default function MorningReminderSettings({onClose}:{onClose:()=>void}) {
  const {account}=useAccount();
  return <SettingsDialog key={account.id} accountId={account.id} onClose={onClose}/>;
}
export function ReportScheduleSettings() {
  const {account}=useAccount();
  return <SettingsDialog key={account.id} accountId={account.id} onClose={()=>{}} inline/>;
}
function SettingsDialog({accountId,onClose,inline=false}:{accountId:string;onClose:()=>void;inline?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),busy=useRef(false);
  const titleId=useId(),descriptionId=useId();
  const [settings,setSettings]=useState<Settings>(defaults);
  const settingsRef=useRef<Settings>(defaults),confirmedRef=useRef<Settings>(defaults),queuedSettings=useRef<Settings|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[loadError,setLoadError]=useState(false);
  const [error,setError]=useState(''),[feedback,setFeedback]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{if(inline)return;const node=dialog.current;node?.showModal();return()=>node?.close();},[inline]);
  useEffect(()=>{
    alive.current=true;
    const controller=new AbortController();
    void npcFetch('/api/npc/secretary',{cache:'no-store',signal:controller.signal,headers:{'X-Zhiyu-Account':accountId}}).then(async response=>{
      const result=await response.json() as SettingsResponse;
      if(!response.ok)throw Error(result.error||'设置暂时无法同步');
      const next=responseSettings(result);
      if(alive.current){settingsRef.current=next;confirmedRef.current=next;setSettings(next);setLoadError(false);}
    }).catch(reason=>{if(alive.current&&!controller.signal.aborted){setLoadError(true);setError(reportUserFacingError(reason,'load','读取简报设置'));}})
      .finally(()=>{if(alive.current&&!controller.signal.aborted)setLoading(false);});
    return()=>{alive.current=false;controller.abort();};
  },[accountId,retry]);
  async function request(body:Record<string,unknown>) {
    const response=await npcFetch('/api/npc/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(body)});
    const result=await response.json() as SettingsResponse;
    if(!response.ok)throw Error(result.error||'修改未保存');
    return result;
  }
  async function save(patch:Partial<Settings>) {
    const next={...settingsRef.current,...patch};
    if(loading||loadError||!validTime(next.time)||!validTime(next.weeklyTime||''))return;
    settingsRef.current=next;queuedSettings.current=next;if(alive.current)setSettings(next);
    if(busy.current)return;
    busy.current=true;if(alive.current){setSaving(true);setError('');setFeedback('');}
    try {
      while(queuedSettings.current) {
        const pending=queuedSettings.current;queuedSettings.current=null;
        const confirmed=responseSettings(await request({action:'settings',...pending}));
        confirmedRef.current=confirmed;
        if(alive.current&&!queuedSettings.current){settingsRef.current=confirmed;setSettings(confirmed);setFeedback('已保存');}
      }
    } catch(reason) {
      queuedSettings.current=null;settingsRef.current=confirmedRef.current;
      if(alive.current){setSettings(confirmedRef.current);setError(reportUserFacingError(reason,'save','保存简报设置'));}
    } finally {busy.current=false;if(alive.current)setSaving(false);}
  }
  // Controls use explicit 24-hour parts, avoiding native AM/PM clipping.
  // Save from the latest ref so quick hour/minute edits stay in one queue.
  function saveTime(key:'time'|'weeklyTime',part:'hour'|'minute',value:string) {
    const pieces=(settingsRef.current[key]||defaults[key]!).split(':');
    pieces[part==='hour'?0:1]=value;
    void save({[key]:pieces.join(':')});
  }
  const disabled=loading||loadError;
  const timePicker=(key:'time'|'weeklyTime',label:string,off:boolean)=>{
    const [hour,minute]=(settings[key]||defaults[key]!).split(':');
    return <fieldset className="zy-report-settings-time" aria-label={label}>
      <select aria-label={label+'小时'} value={hour} disabled={disabled||off} onChange={event=>saveTime(key,'hour',event.currentTarget.value)}>{Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(value=><option key={value} value={value}>{value}</option>)}</select>
      <span aria-hidden="true">:</span>
      <select aria-label={label+'分钟'} value={minute} disabled={disabled||off} onChange={event=>saveTime(key,'minute',event.currentTarget.value)}>{Array.from({length:60},(_,i)=>String(i).padStart(2,'0')).map(value=><option key={value} value={value}>{value}</option>)}</select>
    </fieldset>;
  };
  const content=<>
    <section className="zy-report-settings-section" aria-label="今日简报设置">
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-enabled'}>今日简报</label><button type="button" id={titleId+'-enabled'} role="switch" aria-checked={settings.enabled} aria-label="今日简报" className="zy-morning-settings-switch" disabled={disabled} onClick={()=>void save({enabled:!settings.enabled})}><span/></button></div>
      <div className="zy-morning-settings-row"><span>每天发送时间</span>{timePicker('time','简报时间',!settings.enabled)}</div>
    </section>
    <section className="zy-report-settings-section" aria-label="周报设置">
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-weekly'}>周报</label><button type="button" id={titleId+'-weekly'} role="switch" aria-checked={settings.weeklyEnabled} aria-label="周报" className="zy-morning-settings-switch" disabled={disabled} onClick={()=>void save({weeklyEnabled:!settings.weeklyEnabled})}><span/></button></div>
      <div className="zy-morning-settings-row"><span>每周发送时间</span><div className="zy-report-settings-week"><select aria-label="周报星期" value={settings.weeklyDay} disabled={disabled||!settings.weeklyEnabled} onChange={event=>void save({weeklyDay:Number(event.currentTarget.value)})}>{['日','一','二','三','四','五','六'].map((day,index)=><option key={day} value={index}>周{day}</option>)}</select>{timePicker('weeklyTime','周报时间',!settings.weeklyEnabled)}</div></div>
    </section>
    <p id={descriptionId} className="zy-morning-settings-note">北京时间 · 修改后自动保存</p>
    <div className="zy-morning-settings-status" aria-live="polite">{error?<p role="alert">{error}{loadError&&<button type="button" onClick={()=>{setLoading(true);setError('');setRetry(value=>value+1);}}>重新同步</button>}</p>:loading?'正在同步…':saving?'保存中…':feedback}</div>
  </>;
  if(inline)return <div className="zy-morning-settings zy-report-settings-inline" aria-label="简报与周报设置">{content}</div>;
  return <dialog ref={dialog} className="zy-dialog zy-morning-settings" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header><h2 id={titleId}>简报与周报</h2><button type="button" aria-label="关闭简报设置" onClick={onClose}><X size={18} strokeWidth={1.7}/></button></header>
    {content}
  </dialog>;
}
