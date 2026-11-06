'use client';
/* eslint-disable next/no-img-element -- Profile images may be local or user-selected data URLs. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import desktopPackage from '../../desktop/package.json';
import type { Person } from './data';
import { useTheme } from './theme';
import { useFontSize } from './font-size';
import type { FontSize } from './font-config';
import {ReportScheduleSettings} from './morning-reminder-settings';
import './app-settings.css';

function LogoutConfirmation({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

export default function AppSettings({ person, username, onLogout, onClose }: {
  person: Person; username: string; onLogout: () => Promise<void>; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const theme = useTheme();
  const { transitioning, setTheme, theme: chosenTheme } = theme;
  const { fontSize, setFontSize } = useFontSize();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const backdropPointer = useRef<number | null>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const closeSettings = useCallback(() => {
    if (logoutOpen) return;
    backdropPointer.current = null;
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
  const cancelBackdropPointer = useCallback(() => { backdropPointer.current = null; }, []);
  useEffect(() => {
    if (logoutOpen) {
      cancelBackdropPointer();
      return;
    }
    if (!theme.transitioning) return;
    // Native ViewTransition hit testing can retarget to html/body. During its
    // reveal only, use the live dialog bounds rather than the retargeted node.
    const down = (event: PointerEvent) => startBackdropPointer(event);
    const up = (event: PointerEvent) => finishBackdropPointer(event);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancelBackdropPointer, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancelBackdropPointer, true);
    };
  }, [theme.transitioning, logoutOpen, startBackdropPointer, finishBackdropPointer, cancelBackdropPointer]);
  return <dialog ref={ref} className="zy-settings-dialog" aria-labelledby="zy-settings-title" aria-busy={theme.transitioning}
    onCancel={event => { event.preventDefault(); if (event.target === event.currentTarget) closeSettings(); }}
    onPointerDown={event => startBackdropPointer(event, event.target === event.currentTarget)}
    onPointerUp={event => finishBackdropPointer(event, event.target === event.currentTarget)}
    onPointerCancel={cancelBackdropPointer}>
    <header><h2 id="zy-settings-title">设置</h2><button type="button" aria-label="关闭设置" disabled={theme.transitioning} onClick={closeSettings}><X size={19}/></button></header>
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
        <button type="button" role="switch" aria-labelledby="zy-dark-label" aria-checked={theme.theme === 'dark'} disabled={theme.transitioning} className="zy-settings-switch" onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          theme.toggleTheme({ x:bounds.left + bounds.width / 2, y:bounds.top + bounds.height / 2 });
        }}><span/></button>
      </section>
      <section className="zy-settings-section zy-settings-control-row">
        <h3><label htmlFor="zy-font-size">字体</label></h3>
        <div className="zy-settings-font-select"><select id="zy-font-size" aria-label="字体大小" disabled={theme.transitioning} value={fontSize} onChange={event => setFontSize(event.target.value as FontSize)}>
          {(['small','medium','large'] as const).map(size => <option key={size} value={size}>{FONT_LABELS[size]}</option>)}
        </select><ChevronDown size={15} aria-hidden="true"/></div>
      </section>
      <section className="zy-settings-section zy-settings-report-section">
        <h3>简报与周报</h3>
        <ReportScheduleSettings/>
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
