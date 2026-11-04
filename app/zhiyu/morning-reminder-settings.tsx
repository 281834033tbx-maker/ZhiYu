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
function SettingsDialog({accountId,onClose}:{accountId:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),busy=useRef(false);
  const titleId=useId(),descriptionId=useId();
  const [settings,setSettings]=useState<Settings>(defaults);
  const settingsRef=useRef<Settings>(defaults),confirmedRef=useRef<Settings>(defaults),queuedSettings=useRef<Settings|null>(null);
  const [city,setCity]=useState(''),[cityOpen,setCityOpen]=useState(false);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[loadError,setLoadError]=useState(false);
  const [error,setError]=useState(''),[feedback,setFeedback]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  useEffect(()=>{
    alive.current=true;
    const controller=new AbortController();
    void npcFetch('/api/npc/secretary',{cache:'no-store',signal:controller.signal,headers:{'X-Zhiyu-Account':accountId}}).then(async response=>{
      const result=await response.json() as SettingsResponse;
      if(!response.ok)throw Error(result.error||'设置暂时无法同步');
      const next=responseSettings(result);
      if(alive.current){settingsRef.current=next;confirmedRef.current=next;setSettings(next);setCity(next.city?.name||'');setLoadError(false);}
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
  async function regenerate(kind:'daily'|'weekly') {
    if(busy.current||loading)return;
    busy.current=true;setSaving(true);setError('');setFeedback('');
    try {
      await request({action:'regenerate-report-demo',kind});
      if(alive.current)setFeedback(`演示${kind==='daily'?'简报':'周报'}已生成，回到 Molly 查看`);
    } catch(reason) {if(alive.current)setError(reportUserFacingError(reason,'save','生成演示简报'));}
    finally {busy.current=false;if(alive.current)setSaving(false);if(queuedSettings.current)void save({});}
  }
  // Inputs remain editable while a save is in flight. The queue serializes
  // complete values, including native segmented hour/minute edits.
  const disabled=loading||loadError;
  return <dialog ref={dialog} className="zy-dialog zy-morning-settings" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header><h2 id={titleId}>简报与周报</h2><button type="button" aria-label="关闭简报设置" onClick={onClose}><X size={18} strokeWidth={1.7}/></button></header>
    <p id={descriptionId}>本期展示固定演示内容，以下时间和城市只保存，暂不定时发送。</p>
    <section className="zy-report-settings-section" aria-label="今日简报设置">
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-enabled'}>今日简报</label><button type="button" id={titleId+'-enabled'} role="switch" aria-checked={settings.enabled} aria-label="今日简报" className="zy-morning-settings-switch" disabled={disabled} onClick={()=>void save({enabled:!settings.enabled})}><span/></button></div>
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-time'}>简报时间</label><input id={titleId+'-time'} type="time" value={settings.time} disabled={disabled||!settings.enabled} onInput={event=>{const time=event.currentTarget.value;if(validTime(time))void save({time});}}/></div>
      <div className="zy-morning-settings-row"><span>城市</span><button type="button" className="zy-morning-city-change" disabled={disabled} onClick={()=>setCityOpen(value=>!value)}>{settings.city?.name||'设置城市'}</button></div>
      {cityOpen&&<form className="zy-report-settings-city" onSubmit={event=>{event.preventDefault();if(city.trim()){void save({city:{name:city.trim(),source:'manual'}});setCityOpen(false);}}}><label htmlFor={titleId+'-city'}>城市名称</label><input id={titleId+'-city'} value={city} maxLength={40} placeholder="输入城市" disabled={disabled} onChange={event=>setCity(event.currentTarget.value)}/><button type="submit" disabled={disabled||!city.trim()}>保存</button></form>}
    </section>
    <section className="zy-report-settings-section" aria-label="周报设置">
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-weekly'}>周报</label><button type="button" id={titleId+'-weekly'} role="switch" aria-checked={settings.weeklyEnabled} aria-label="周报" className="zy-morning-settings-switch" disabled={disabled} onClick={()=>void save({weeklyEnabled:!settings.weeklyEnabled})}><span/></button></div>
      <div className="zy-morning-settings-row"><label htmlFor={titleId+'-weekly-day'}>周报时间</label><div className="zy-report-settings-week"><select id={titleId+'-weekly-day'} aria-label="周报星期" value={settings.weeklyDay} disabled={disabled||!settings.weeklyEnabled} onChange={event=>void save({weeklyDay:Number(event.currentTarget.value)})}>{['日','一','二','三','四','五','六'].map((day,index)=><option key={day} value={index}>周{day}</option>)}</select><input type="time" aria-label="周报时刻" value={settings.weeklyTime} disabled={disabled||!settings.weeklyEnabled} onInput={event=>{const weeklyTime=event.currentTarget.value;if(validTime(weeklyTime))void save({weeklyTime});}}/></div></div>
    </section>
    <section className="zy-report-settings-section zy-report-settings-demo" aria-label="演示开发开关"><h3>演示测试</h3><button type="button" disabled={loading||saving} onClick={()=>void regenerate('daily')}>重新生成演示简报</button><button type="button" disabled={loading||saving} onClick={()=>void regenerate('weekly')}>重新生成演示周报</button></section>
    <p className="zy-morning-settings-note">北京时间 · 修改后自动保存<br/>演示操作不会更改任务、缴费和健康记录。</p>
    <div className="zy-morning-settings-status" aria-live="polite">{error?<p role="alert">{error}{loadError&&<button type="button" onClick={()=>{setLoading(true);setError('');setRetry(value=>value+1);}}>重新同步</button>}</p>:loading?'正在同步…':saving?'保存中…':feedback}</div>
  </dialog>;
}
