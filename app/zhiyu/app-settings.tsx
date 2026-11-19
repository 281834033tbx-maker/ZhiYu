'use client';

import {accountStorage} from './account-storage';
import {useDialogLightDismiss} from './use-dialog-light-dismiss';
/* eslint-disable next/no-img-element -- Profile images may be local or user-selected data URLs. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import desktopPackage from '../../desktop/package.json';
import type { Person } from './data';
import { useTheme } from './theme';
import { useFontSize } from './font-size';
import type { FontSize } from './font-config';
import MorningReminderSettings, {ReportScheduleSettings} from './morning-reminder-settings';
import RealtimeSpeechSettings from './realtime-speech-settings';
import {useAccount} from './auth-gate';
import {useReportSchedule} from './report-schedule-store';
import {MobileSwitch} from './mobile-effects';
import './app-settings.css';
import './mobile-settings.css';

function LogoutConfirmation({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useDialogLightDismiss(ref,onCancel,busy);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="zy-logout-dialog" aria-labelledby="zy-logout-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }}>
    <h2 id="zy-logout-title">退出登录后将无法收到新消息，<br/>确定退出登录？</h2>
    {error && <p role="alert">{error}</p>}
    <footer>
      <button type="button" autoFocus disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="zy-logout-confirm" disabled={busy} onClick={async () => {
        if (busy) return;
        setBusy(true); setError('');
        try { await onConfirm(); } catch { setError('退出失败，请重试'); setBusy(false); }
      }}>{busy ? '退出中…' : '确定'}</button>
    </footer>
  </dialog>;
}

const FONT_LABELS: Record<FontSize, string> = { small:'小', medium:'中', large:'大' };
type BackdropPointerEvent = Pick<PointerEvent, 'isPrimary' | 'button' | 'pointerId' | 'clientX' | 'clientY'>;

type AppSettingsProps={
  person: Person; username: string; desktop?: boolean; mobile?:boolean; inline?:boolean; appearanceLayout?: 'floating' | 'classic'; onAdjustAppearance?: () => void; onOpenRecord?: () => Promise<void>; onOpenCaptionCase?: () => Promise<void>; onOpenSpeechSettings?:()=>void; onLogout: () => Promise<void>; onClose: () => void;
};
export default function AppSettings(props:AppSettingsProps) {
  return props.inline?<MobileAppSettings {...props}/>:<AppSettingsDialog {...props}/>;
}
function MobileSpeechSheet({onClose}:{onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useDialogLightDismiss(dialog,onClose);
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  return <dialog ref={dialog} className="zy-mobile-settings-sheet" aria-labelledby="zy-mobile-speech-title" onCancel={event=>{event.preventDefault();onClose();}}><header><h2 id="zy-mobile-speech-title">语音与通话</h2><button type="button" aria-label="关闭语音设置" onClick={onClose}><X size={22}/></button></header><RealtimeSpeechSettings/></dialog>;
}
function MobileAppSettings({username,onLogout,onOpenSpeechSettings}:AppSettingsProps) {
  const {account}=useAccount(),theme=useTheme(),{fontSize,setFontSize}=useFontSize();
  const schedule=useReportSchedule(account.id);
  const [reportOpen,setReportOpen]=useState(false),[speechOpen,setSpeechOpen]=useState(false),[logoutOpen,setLogoutOpen]=useState(false),[updateStatus,setUpdateStatus]=useState('');
  const settings=schedule.settings;
  const daily=settings?(settings.enabled?`每天 ${settings.time}${settings.city?.name?' · '+settings.city.name:''}`:'已关闭'):schedule.loading?'同步中…':'暂未同步';
  const weekly=settings?(settings.weeklyEnabled===false?'已关闭':`周${['日','一','二','三','四','五','六'][settings.weeklyDay??0]} ${settings.weeklyTime||''}`):schedule.loading?'同步中…':'暂未同步';
  return <div className="zy-mobile-me-settings">
    <section className="zy-mobile-me-settings-group"><h2>Molly 的报告</h2><div className="zy-mobile-me-settings-card">
      <button type="button" className="zy-mobile-me-settings-row" onClick={()=>setReportOpen(true)}><span>今日简报</span><span className="zy-mobile-me-settings-value">{daily}</span><ChevronRight size={16}/></button>
      <button type="button" className="zy-mobile-me-settings-row" onClick={()=>setReportOpen(true)}><span>周报</span><span className="zy-mobile-me-settings-value">{weekly}</span><ChevronRight size={16}/></button>
    </div></section>
    <section className="zy-mobile-me-settings-group"><h2>通用</h2><div className="zy-mobile-me-settings-card">
      <div className="zy-mobile-me-settings-row"><span>深色模式</span><MobileSwitch label="深色模式" checked={theme.theme==='dark'} disabled={theme.transitioning} onChange={()=>theme.toggleTheme()}/></div>
      <div className="zy-mobile-me-settings-row"><span>字体大小</span><fieldset className="zy-mobile-font-options" aria-label="字体大小">{(['small','medium','large'] as const).map(size=><button type="button" key={size} aria-pressed={fontSize===size} disabled={theme.transitioning} onClick={()=>setFontSize(size)}>{FONT_LABELS[size]}</button>)}</fieldset></div>
      <button type="button" className="zy-mobile-me-settings-row" onClick={()=>{if(onOpenSpeechSettings)onOpenSpeechSettings();else setSpeechOpen(true);}}><span>语音与通话</span><ChevronRight size={16}/></button>
    </div></section>
    <section className="zy-mobile-me-settings-group"><h2>账号</h2><div className="zy-mobile-me-settings-card">
      <div className="zy-mobile-me-settings-row"><span>账号</span><span className="zy-mobile-me-settings-value">{username}</span></div>
      <button type="button" className="zy-mobile-me-settings-row" onClick={()=>setUpdateStatus(`当前版本 ${desktopPackage.version}，暂未开放在线更新。`)}><span>检查更新</span><span className="zy-mobile-me-settings-value">{updateStatus||desktopPackage.version}</span></button>
    </div></section>
    <button type="button" className="zy-mobile-me-logout" onClick={()=>setLogoutOpen(true)}>退出登录</button>
    {reportOpen&&<MorningReminderSettings mobile onClose={()=>setReportOpen(false)}/>}
    {speechOpen&&<MobileSpeechSheet onClose={()=>setSpeechOpen(false)}/>}
    {logoutOpen&&<LogoutConfirmation onCancel={()=>setLogoutOpen(false)} onConfirm={onLogout}/>}
  </div>;
}
function AppSettingsDialog({ person, username, desktop=true, mobile=false, appearanceLayout='floating', onAdjustAppearance, onOpenRecord, onOpenCaptionCase, onLogout, onClose }:AppSettingsProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const theme = useTheme();
  const { transitioning, setTheme, theme: chosenTheme } = theme;
  const { fontSize, setFontSize } = useFontSize();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [topbarVisible,setTopbarVisible] = useState(true);
  const [topbarBusy,setTopbarBusy] = useState(false);
  const [topbarError,setTopbarError] = useState('');
  const [demoBusy,setDemoBusy] = useState(false);
  const [demoError,setDemoError] = useState('');
  const demoFlight = useRef(false);
  const captionCaseFlight=useRef(false);
  const [captionCaseBusy,setCaptionCaseBusy]=useState(false),[captionCaseError,setCaptionCaseError]=useState('');
  const backdropPointer = useRef<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const transitionClosePointer = useRef<{id:number;x:number;y:number}|null>(null);
  useEffect(()=>{
    if(!desktop||typeof window==='undefined')return;
    let active=true;
    const bridge=window.zhiyuDesktop;
    const apply=(state:{visible:boolean}|null)=>{if(active&&state)setTopbarVisible(state.visible);};
    if(bridge?.getTopbarState)void bridge.getTopbarState().then(apply).catch(()=>{if(active)setTopbarError('顶部条设置读取失败，请重试。');});
    else void Promise.resolve().then(()=>{try{apply({visible:accountStorage().getItem('zhiyu-topbar-visible')!=='false'});}catch{/* The default remains enabled when local storage is unavailable. */}});
    const off=bridge?.onTopbarState?.(apply);
    return()=>{active=false;off?.();};
  },[desktop]);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const closeSettings = useCallback(() => {
    if (logoutOpen || closing.current) return;
    closing.current = true;
    backdropPointer.current = null;
    transitionClosePointer.current = null;
    // Closing during the reveal completes its chosen theme and removes the
    // native transition layer before the modal leaves the top layer.
    if (transitioning) setTheme(chosenTheme);
    onClose();
  }, [logoutOpen, transitioning, setTheme, chosenTheme, onClose]);
  const isOutsideDialog = useCallback((event: BackdropPointerEvent) => {
    const dialog = ref.current;
    if (!dialog?.open) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }, []);
  const startBackdropPointer = useCallback((event: BackdropPointerEvent, acceptTarget = true) => {
    backdropPointer.current = !logoutOpen && event.isPrimary && event.button === 0 && acceptTarget && isOutsideDialog(event) ? event.pointerId : null;
  }, [logoutOpen, isOutsideDialog]);
  const finishBackdropPointer = useCallback((event: BackdropPointerEvent, acceptTarget = true) => {
    const dismiss = backdropPointer.current === event.pointerId && event.isPrimary && event.button === 0 && !logoutOpen && acceptTarget && isOutsideDialog(event);
    // Document capture runs first. Clearing the same ref here prevents the
    // dialog's subsequent handler from closing a second time for this event.
    backdropPointer.current = null;
    if (dismiss) closeSettings();
  }, [logoutOpen, isOutsideDialog, closeSettings]);
  const cancelBackdropPointer = useCallback(() => { backdropPointer.current = null; transitionClosePointer.current = null; }, []);
  const isOnCloseButton = useCallback((event: BackdropPointerEvent) => {
    const button=closeButton.current;
    if(!button||button.disabled)return false;
    const bounds=button.getBoundingClientRect();
    return event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom;
  },[]);
  useEffect(() => {
    if (logoutOpen) {
      cancelBackdropPointer();
      return;
    }
    if (!theme.transitioning) return;
    // Native ViewTransition hit testing can retarget to html/body. During its
    // reveal only, use the live dialog bounds rather than the retargeted node.
    const down = (event: PointerEvent) => {
      transitionClosePointer.current=event.isPrimary&&event.button===0&&isOnCloseButton(event)?{id:event.pointerId,x:event.clientX,y:event.clientY}:null;
      startBackdropPointer(event);
    };
    const up = (event: PointerEvent) => {
      const press=transitionClosePointer.current;transitionClosePointer.current=null;
      if(press&&press.id===event.pointerId&&event.isPrimary&&event.button===0&&isOnCloseButton(event)&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<=6){
        backdropPointer.current=null;closeSettings();
      }else finishBackdropPointer(event);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancelBackdropPointer, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancelBackdropPointer, true);
    };
  }, [theme.transitioning, logoutOpen, startBackdropPointer, finishBackdropPointer, cancelBackdropPointer, isOnCloseButton, closeSettings]);
  return <dialog ref={ref} className="zy-settings-dialog" aria-labelledby="zy-settings-title" aria-busy={theme.transitioning}
    onCancel={event => { event.preventDefault(); if (event.target === event.currentTarget) closeSettings(); }}
    onPointerDown={event => startBackdropPointer(event, event.target === event.currentTarget)}
    onPointerUp={event => finishBackdropPointer(event, event.target === event.currentTarget)}
    onPointerCancel={cancelBackdropPointer}>
    <header><h2 id="zy-settings-title">设置</h2><button ref={closeButton} type="button" aria-label="关闭设置" onClick={closeSettings}><X size={19}/></button></header>
    <div className="zy-settings-content">
      <section className="zy-settings-section">
        <h3>账号</h3>
        <div className="zy-settings-account">
          <span className="zy-settings-avatar">{person.avatar ? <img src={person.avatar} alt="我的头像"/> : (person.nickname || person.name || username).slice(0,1)}</span>
          <div><strong>{person.nickname || person.name || username}</strong><span>{username}</span></div>
          <button type="button" className="zy-settings-button" disabled={theme.transitioning} onClick={() => setLogoutOpen(true)}>退出登录</button>
        </div>
      </section>
      <section className="zy-settings-section zy-settings-control-row">
        <h3 id="zy-dark-label">深色模式</h3>
        {mobile?<MobileSwitch label="深色模式" checked={theme.theme==='dark'} disabled={theme.transitioning} onChange={()=>theme.toggleTheme()}/>:<button type="button" role="switch" aria-labelledby="zy-dark-label" aria-checked={theme.theme === 'dark'} disabled={theme.transitioning} className="zy-settings-switch" onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          theme.toggleTheme({ x:bounds.left + bounds.width / 2, y:bounds.top + bounds.height / 2 });
        }}><span/></button>}
      </section>
      <section className="zy-settings-section zy-settings-control-row">
        <h3><label htmlFor="zy-font-size">字体</label></h3>
        <div className="zy-settings-font-select"><select id="zy-font-size" aria-label="字体大小" disabled={theme.transitioning} value={fontSize} onChange={event => setFontSize(event.target.value as FontSize)}>
          {(['small','medium','large'] as const).map(size => <option key={size} value={size}>{FONT_LABELS[size]}</option>)}
        </select><ChevronDown size={15} aria-hidden="true"/></div>
      </section>
      {desktop&&<section className="zy-settings-section zy-settings-topbar-section">
        <div className="zy-settings-control-row">
          <h3 id="zy-topbar-label">显示顶部条</h3>
          <button type="button" role="switch" aria-labelledby="zy-topbar-label" aria-checked={topbarVisible} disabled={theme.transitioning||topbarBusy} className="zy-settings-switch" onClick={async()=>{
            if(topbarBusy)return;
            setTopbarBusy(true);setTopbarError('');
            try{
              const next=!topbarVisible;
              if(window.zhiyuDesktop?.setTopbarVisible){const state=await window.zhiyuDesktop.setTopbarVisible(next);setTopbarVisible(state.visible);}
              else{accountStorage().setItem('zhiyu-topbar-visible',String(next));setTopbarVisible(next);}
            }catch{setTopbarError('顶部条设置未保存，请重试。');}
            finally{setTopbarBusy(false);}
          }}><span/></button>
        </div>
        {topbarError&&<p className="zy-settings-topbar-error" role="alert">{topbarError}</p>}
      </section>}
      {desktop&&onAdjustAppearance&&<section className="zy-settings-section zy-settings-control-row">
        <h3>外观调整</h3>
        <button type="button" className="zy-settings-button" disabled={theme.transitioning} onClick={()=>{
          if(logoutOpen||closing.current)return;
          closeSettings();
          onAdjustAppearance();
        }}>{appearanceLayout==='classic'?'调整透明度':'调整位置与透明度'}</button>
      </section>}
      {desktop&&onOpenRecord&&<section className="zy-settings-section zy-settings-topbar-section">
        <div className="zy-settings-control-row">
          <h3>聊天记录</h3>
          <button type="button" className="zy-settings-button" disabled={theme.transitioning||demoBusy} onClick={async()=>{
            if(logoutOpen||closing.current||demoFlight.current)return;
            demoFlight.current=true;setDemoBusy(true);setDemoError('');
            try{await onOpenRecord();closeSettings();}
            catch{setDemoError('聊天记录暂时无法打开，请重试。');}
            finally{demoFlight.current=false;setDemoBusy(false);}
          }}>{demoBusy?'正在打开…':'明天一起开饭'}</button>
        </div>
        {demoError&&<p className="zy-settings-topbar-error" role="alert">{demoError}</p>}
      </section>}
      {desktop&&onOpenCaptionCase&&<section className="zy-settings-section zy-settings-topbar-section">
        <div className="zy-settings-control-row"><h3>人物案例截图</h3><button type="button" className="zy-settings-button" disabled={theme.transitioning||captionCaseBusy} onClick={async()=>{
          if(logoutOpen||closing.current||captionCaseFlight.current)return;
          captionCaseFlight.current=true;setCaptionCaseBusy(true);setCaptionCaseError('');
          try{await onOpenCaptionCase();closeSettings();}
          catch{setCaptionCaseError('案例暂时无法打开，请重试。');}
          finally{captionCaseFlight.current=false;setCaptionCaseBusy(false);}
        }}>{captionCaseBusy?'正在打开…':'小满字幕案例'}</button></div>
        {captionCaseError&&<p className="zy-settings-topbar-error" role="alert">{captionCaseError}</p>}
      </section>}
      <section className="zy-settings-section zy-settings-report-section">
        <h3>简报与周报</h3>
        <ReportScheduleSettings mobile={mobile}/>
      </section>
      <section className="zy-settings-section zy-settings-version">
        <div><h3>版本信息</h3><span>{desktopPackage.version}</span></div>
        <button type="button" className="zy-settings-button" disabled={theme.transitioning} onClick={() => setUpdateStatus(`当前版本 ${desktopPackage.version}，暂未开放在线更新。`)}>检查更新</button>
        {updateStatus && <output>{updateStatus}</output>}
      </section>
    </div>
    {logoutOpen && <LogoutConfirmation onCancel={() => setLogoutOpen(false)} onConfirm={onLogout}/>}
  </dialog>;
}
