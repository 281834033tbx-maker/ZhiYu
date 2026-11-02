'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {X} from 'lucide-react';
import {useAccount} from './auth-gate';
import {npcFetch} from './npc-fetch';
import './morning-reminder-settings.css';

type Settings={enabled:boolean;time:string};
type SettingsResponse={settings?:Settings;error?:string};
const validTime=(time:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time);
function responseSettings(result:SettingsResponse):Settings{
  if(!result.settings||typeof result.settings.enabled!=='boolean'||!validTime(result.settings.time))throw Error('提醒设置暂时无法同步，请重试。');
  return result.settings;
}

export default function MorningReminderSettings({onClose}:{onClose:()=>void}){
  const {account}=useAccount();
  return <SettingsDialog key={account.id} accountId={account.id} onClose={onClose}/>;
}
function SettingsDialog({accountId,onClose}:{accountId:string;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),busy=useRef(false);
  const titleId=useId(),descriptionId=useId();
  const [settings,setSettings]=useState<Settings>({enabled:true,time:'08:00'});
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  useEffect(()=>{
    alive.current=true;
    const controller=new AbortController();
    void npcFetch('/api/npc/secretary',{cache:'no-store',signal:controller.signal,headers:{'X-Zhiyu-Account':accountId}}).then(async response=>{
      const result=await response.json() as SettingsResponse;
      if(!response.ok)throw Error(result.error||'提醒设置暂时无法同步，请重试。');
      const next=responseSettings(result);
      if(alive.current)setSettings(next);
    }).catch(reason=>{if(alive.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'提醒设置暂时无法同步，请重试。');})
      .finally(()=>{if(alive.current&&!controller.signal.aborted)setLoading(false);});
    return()=>{alive.current=false;controller.abort();};
  },[accountId,retry]);
  async function save(next:Settings){
    if(busy.current||loading||!validTime(next.time))return;
    busy.current=true;setSaving(true);setError('');setSaved(false);
    try{
      const response=await npcFetch('/api/npc/secretary',{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify({action:'settings',...next})});
      const result=await response.json() as SettingsResponse;
      if(!response.ok)throw Error(result.error||'修改未保存，请重试。');
      const confirmed=responseSettings(result);
      if(alive.current){setSettings(confirmed);setSaved(true);}
    }catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'修改未保存，请重试。');}
    finally{busy.current=false;if(alive.current)setSaving(false);}
  }
  return <dialog ref={dialog} className="zy-dialog zy-morning-settings" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)onClose();}}>
    <header><h2 id={titleId}>任务晨间提醒</h2><button type="button" aria-label="关闭提醒设置" onClick={onClose}><X size={18} strokeWidth={1.7}/></button></header>
    <p id={descriptionId}>Molly 在每天早晨提醒当天已安排的任务。</p>
    <div className="zy-morning-settings-row"><label htmlFor={titleId+'-enabled'}>晨间提醒</label><button type="button" id={titleId+'-enabled'} role="switch" aria-checked={settings.enabled} aria-label="晨间提醒" className="zy-morning-settings-switch" disabled={loading||saving||!!error&&!saved} onClick={()=>void save({...settings,enabled:!settings.enabled})}><span/></button></div>
    <div className="zy-morning-settings-row"><label htmlFor={titleId+'-time'}>提醒时间</label><input id={titleId+'-time'} type="time" aria-label="提醒时间" value={settings.time} disabled={loading||saving||!settings.enabled||!!error&&!saved} onChange={event=>{const time=event.currentTarget.value;if(validTime(time))void save({...settings,time});}}/></div>
    <p className="zy-morning-settings-note">上海时间 · 修改后自动保存<br/>关闭晨间提醒不会影响任务和步骤计时。</p>
    <div className="zy-morning-settings-status" aria-live="polite">{error?<p role="alert">{error}<button type="button" onClick={()=>{setLoading(true);setError('');setRetry(value=>value+1);}}>重新同步</button></p>:loading?'正在同步…':saving?'保存中…':saved?'已保存':''}</div>
  </dialog>;
}
