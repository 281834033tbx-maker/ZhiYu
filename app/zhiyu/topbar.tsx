'use client';
/* eslint-disable next/no-img-element -- Shared local avatars and user-selected photos. */
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAccount} from './auth-gate';
import {useSelfProfile} from './self-profile-store';
import {SelfProfileCard} from './self-profile-card';
import ProfilePopover from './profile-popover';
import NativeProfilePopover from './native-profile-popover';
import ChatComposer,{type ComposePayload} from './chat-composer';
import {sendMollyQuickText} from './molly-quick-send';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import './desktop-bridge';
import './topbar.css';
import DirectionalPanelShadow from './directional-panel-shadow';

export function topbarGreeting(date:Date){const hour=date.getHours();return hour>=5&&hour<11?'早上好':hour>=11&&hour<13?'中午好':hour>=13&&hour<18?'下午好':'晚上好';}
export function topbarDate(date:Date){return `${date.getMonth()+1}月${date.getDate()}日 星期${['日','一','二','三','四','五','六'][date.getDay()]}`;}

function readPhoto(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('图片读取失败'));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}

/** An independent renderer with the same HttpOnly session, profile and Molly
 * endpoint. It never mounts another main app or another set of conversations. */
export default function Topbar(){
 const {account}=useAccount(),[self,setSelf]=useSelfProfile(account);
 const [clock,setClock]=useState<Date|null>(null),[text,setText]=useState(''),[toast,setToast]=useState('');
 const [anchor,setAnchor]=useState<HTMLElement|null>(null),[editing,setEditing]=useState<'name'|'bio'|null>(null),[draft,setDraft]=useState('');
 const avatarInput=useRef<HTMLInputElement>(null),backgroundInput=useRef<HTMLInputElement>(null);
 const alive=useRef(true),scope=useRef(account.id),pending=useRef<{text:string;turnId:string}|null>(null);
 const notify=useCallback((message:string)=>setToast(message),[]);
 useEffect(()=>{alive.current=true;scope.current=account.id;return()=>{alive.current=false;};},[account.id]);
 useEffect(()=>{const tick=()=>setClock(new Date());tick();const timer=setInterval(tick,15000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{document.documentElement.dataset.zyWindowSurface='topbar';return()=>{delete document.documentElement.dataset.zyWindowSurface;};},[]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(timer);},[toast]);
 async function send(payload:ComposePayload){
  const value=(payload.audioText||payload.text).trim();
  if(!value)throw new Error('语音识别没有返回文字');
  const expected=account.id;
  if(pending.current?.text!==value)pending.current={text:value,turnId:crypto.randomUUID()};
  await sendMollyQuickText(expected,value,pending.current.turnId);
  if(!alive.current||scope.current!==expected)return;
  pending.current=null;setText('');
  // A window-selection failure must not turn a delivered message into a retry.
  void window.zhiyuDesktop?.notifyTopbarMessageSent?.().catch(cause=>console.error('[智域] 切换Molly会话',cause));
 }
 function beginEdit(kind:'name'|'bio'){setDraft(kind==='name'?self.nickname||self.name:self.bio);setEditing(kind);}
 function saveEdit(){if(editing==='name'){const name=draft.trim();if(!name){notify('名字不能为空');return;}setSelf(current=>({...current,name,nickname:name}));}else if(editing==='bio')setSelf(current=>({...current,bio:draft.trim()}));setEditing(null);}
 async function changePhoto(file:File,kind:'avatar'|'background'){
  const expected=account.id,limit=kind==='avatar'?4:12;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>limit*1024*1024){notify(kind==='avatar'?'请选择4MB以内的PNG、JPEG或WebP图片':'请选择12MB以内的PNG、JPEG或WebP图片');return;}
  try {const src=await readPhoto(file);if(alive.current&&scope.current===expected){setSelf(current=>({...current,...(kind==='avatar'?{avatar:src}:{profileBackground:src})}));notify(kind==='avatar'?'头像已更新':'个人资料背景已更新');}}
  catch(cause){if(alive.current&&scope.current===expected)notify(reportUserFacingError(cause,'save','更换资料图片'));}
 }
 const card=anchor?<SelfProfileCard name={self.nickname||self.name} account={self.account} signature={self.bio} background={self.profileBackground} avatar={<img className="zy-topbar-card-avatar" src={self.avatar} alt={self.nickname||self.name}/>} editing={editing} draft={draft} onBeginEdit={beginEdit} onDraftChange={setDraft} onSaveEdit={saveEdit} onCancelEdit={()=>setEditing(null)} onAvatar={()=>avatarInput.current?.click()} onBackground={()=>backgroundInput.current?.click()}/>:null;
 const close=()=>{setAnchor(null);setEditing(null);};
 const fallback=anchor?<ProfilePopover title="我的资料" anchor={anchor} close={close} className="zy-self-profile-popover">{card}</ProfilePopover>:null;
 return <main className="zy-app zy-topbar-app" aria-label="顶部条">
  <DirectionalPanelShadow targetSelector=".zy-topbar" surface="topbar"/>
  <header className="zy-topbar" aria-label="智域顶部条">
   <div className="zy-topbar-identity"><button type="button" className="zy-topbar-avatar" aria-label="查看我的资料" onClick={event=>{if(anchor)close();else setAnchor(event.currentTarget);}}><img src={self.avatar} alt={self.nickname||self.name}/></button><p><span>{clock?topbarGreeting(clock):''}{clock?'，':''}</span><strong>{self.nickname||self.name}</strong></p></div>
   <div className="zy-topbar-molly"><ChatComposer presentation="topbar" allowImages={false} value={text} onChange={setText} onSend={send} placeholder="跟 Molly 说…" label="跟 Molly 说" onError={notify}/></div>
   <time className="zy-topbar-date" dateTime={clock?`${clock.getFullYear()}-${String(clock.getMonth()+1).padStart(2,'0')}-${String(clock.getDate()).padStart(2,'0')}`:undefined}>{clock?topbarDate(clock):''}</time>
  </header>
  {anchor&&(window.zhiyuDesktop?.profilePopoverControl==='native-v2'?<NativeProfilePopover title="我的资料" anchor={anchor} close={close} className="zy-self-profile-popover" fallback={fallback}>{card}</NativeProfilePopover>:fallback)}
  <input ref={avatarInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void changePhoto(file,'avatar');}}/>
  <input ref={backgroundInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void changePhoto(file,'background');}}/>
  {toast&&<output className="zy-toast zy-topbar-toast">{toast}</output>}
 </main>;
}
