'use client';
/* eslint-disable next/no-img-element -- The bundled desktop logo is a fixed local asset. */

import { createContext, useContext, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';
import { QrCode } from 'lucide-react';
import { authFailureFeedback, validateAuthForm, type AuthFieldErrors, type AuthFieldName } from './auth-validation';
import './auth-gate.css';
import {userFacingError} from '../../lib/user-facing-errors';
import {npcFetch} from './npc-fetch';
import {validContentResetAt} from '../../lib/npc/content-reset';
import {applyAccountContentReset,ContentResetStorageError,needsAccountContentReset} from './content-reset';
import {resetChatViewsForAccount} from './chat-view-store';
import ReflectiveLoginCard from './reflective-login-card';
import {accountStorage,hydrateAccountStorage,flushAccountStorage,releaseAccountStorage,getAccountStorageStatus,subscribeAccountStorageStatus,resolveAccountStorageConflict,type AccountStorageStatus} from './account-storage';

type Account = { id: string; username: string; contentResetAt?:number;userNumber?:string;internal?:boolean;createdAt?:number;storageMode?:'server' };
type AuthContextValue = { account: Account; firstUse?:boolean; logout: () => Promise<void> };
type AuthResponse = { authenticated: boolean; account?: Account; claimedLegacy?: boolean; firstUse?:boolean; error?: string;inviteOnly?:boolean;adultConfirmationRequired?:boolean };
type View = 'welcome' | 'choose' | 'login' | 'register';

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAccount() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('智域页面需要登录后打开');
  return value;
}

function migrateLegacyBrowserState(accountId: string) {
  const source = localStorage.getItem('zhiyu-stitch-desktop-v2');
  const target = `zhiyu-stitch-desktop-v2:${accountId}`;
  if (source && !localStorage.getItem(target)) localStorage.setItem(target, source);
  for (const character of ['xia', 'yuan', 'liu', 'chen']) {
    const oldKey = `zhiyu-${character}-last-read`;
    const value = localStorage.getItem(oldKey);
    if (value && !localStorage.getItem(`${oldKey}:${accountId}`)) localStorage.setItem(`${oldKey}:${accountId}`, value);
  }
}
function prepareAccountBrowserState(account:Account,claimedLegacy?:boolean):string|undefined{
  const reset=validContentResetAt(account.contentResetAt);
  try{
    // Once reset, old unscoped archives must never be re-imported on sign-in.
    if(claimedLegacy&&(!reset||needsAccountContentReset(account.id,account.contentResetAt,accountStorage(account.id))))migrateLegacyBrowserState(account.id);
    if(reset&&applyAccountContentReset(account.id,account.contentResetAt,accountStorage(account.id),sessionStorage,Date.now(),claimedLegacy===true))resetChatViewsForAccount(account.id);
  }catch{if(reset)throw new ContentResetStorageError();return '旧聊天列表迁移失败；人物记忆仍可读取';}
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [firstUse,setFirstUse]=useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>('welcome');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [contentResetError,setContentResetError]=useState('');
  const [inviteOnly,setInviteOnly]=useState(false);
  const [adultConfirmationRequired,setAdultConfirmationRequired]=useState(false);
  const [inviteCode,setInviteCode]=useState('');
  const [adultConfirmed,setAdultConfirmed]=useState(false);

  useEffect(()=>{
    const loginSurface=checking||!account||!!contentResetError;
    document.documentElement.dataset.zyAuthSurface=loginSurface?'card':'app';
    void window.zhiyuDesktop?.setAuthWindowMode?.(loginSurface,checking).catch(()=>{});
  },[checking,account,contentResetError]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    async function ensureReportSettings() {
      try {
        const response = await npcFetch('/api/npc/secretary', {
          cache:'no-store',headers:{'X-Zhiyu-Account':account!.id},
        });
        if (response.status===401 || response.status===409) return;
        if (!response.ok) throw new Error('简报设置暂时未就绪');
      } catch {
        // Register this account's schedule without inserting sample reports.
        // The server's durable occurrences own delivery and deduplication.
        if (!cancelled) timer = setTimeout(ensureReportSettings, Math.min(1000 * 2 ** Math.min(++attempt,5), 30000));
      }
    }
    void ensureReportSettings();
    return () => {cancelled = true; if (timer) clearTimeout(timer);};
  }, [account]);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.json() as Promise<AuthResponse>)
      .then(async data => {
        if(alive){setInviteOnly(data.inviteOnly===true);setAdultConfirmationRequired(data.adultConfirmationRequired===true);}
        if (alive && data.authenticated && data.account) {
          await hydrateAccountStorage(data.account);
          if(!alive)return;
          const warning=data.account.storageMode==='server'?undefined:prepareAccountBrowserState(data.account,data.claimedLegacy);if(warning)setError(warning);
          setAccount(data.account);
        }
      })
      .catch(reason => { if (alive) {if(reason instanceof ContentResetStorageError)setContentResetError(reason.message);else setContentResetError('账号资料暂时无法读取，请连接网络后重试。');} })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  const switchView = (next: View) => {
    setView(next);
    setPassword('');
    setConfirmPassword('');
    setError('');
    setFieldErrors({});
    setAdultConfirmed(false);
  };

  const editField = (field: AuthFieldName, value: string) => {
    if (field === 'username') setUsername(value);
    else if (field === 'password') setPassword(value);
    else setConfirmPassword(value);
    setFieldErrors(current => {
      const next = { ...current };
      delete next[field];
      // A credential failure covers both entries. Editing either starts a new
      // attempt; a confirmation mismatch also depends on the original password.
      if (field === 'username' && next.password === '密码错误') delete next.password;
      if (field === 'password' && next.confirmPassword === '两次输入的密码不一致') delete next.confirmPassword;
      return next;
    });
    setError('');
  };

  const showFieldErrors = (fields: AuthFieldErrors, form: HTMLFormElement) => {
    setFieldErrors(fields);
    setFeedbackRevision(current => current + 1);
    const first = (['username', 'password', 'confirmPassword'] as const).find(field => fields[field]);
    const input = first ? form.elements.namedItem(first) : null;
    if (input instanceof HTMLInputElement) requestAnimationFrame(() => { if (input.isConnected) input.focus(); });
  };

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (view !== 'login' && view !== 'register') return;
    const form = event.currentTarget;
    const fields = validateAuthForm(view, { username, password, confirmPassword });
    setError('');
    if (Object.keys(fields).length) return showFieldErrors(fields, form);
    if(view==='register'&&adultConfirmationRequired&&!adultConfirmed){setError('请先确认你已满18岁');return;}
    setBusy(true);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/auth/${view}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword,...(view==='register'&&adultConfirmationRequired?{adultConfirmed}:{}) }),
      });
      const data = await response.json() as AuthResponse;
      if (!response.ok || !data.account) {
        const feedback = authFailureFeedback(view, response.status, data.error);
        setError(Object.keys(feedback.fields).length?'':userFacingError(feedback.error,'load'));
        showFieldErrors(feedback.fields, form);
        return;
      }
      await hydrateAccountStorage(data.account);
      const warning=data.account.storageMode==='server'?undefined:prepareAccountBrowserState(data.account,data.claimedLegacy);if(warning)setError(warning);
      setPassword('');
      setConfirmPassword('');
      setFirstUse(view==='register'&&data.firstUse===true);
      setAccount(data.account);
    } catch(reason) {
      if(reason instanceof ContentResetStorageError)setContentResetError(reason.message);else setError('网络不太好，请稍后重试，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if(account)await flushAccountStorage(account.id);
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('退出失败，请重试');
    if(account)releaseAccountStorage(account.id);
    setAccount(null);
    setUsername('');
    switchView('welcome');
  }

  async function submitInvite(event:SyntheticEvent<HTMLFormElement>){
    event.preventDefault();if(busy||!adultConfirmed||!inviteCode.trim())return;setBusy(true);setError('');
    try{
      const response=await fetch('/api/auth/invite',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:inviteCode.trim(),adultConfirmed:true})});
      const data=await response.json() as AuthResponse;
      if(!response.ok||!data.account){setError(data.error||'邀请码暂时无法验证，请重试');return;}
      await hydrateAccountStorage(data.account);setInviteCode('');setFirstUse(data.firstUse===true);setAccount(data.account);
    }catch{setError('账号资料暂时无法读取，请连接网络后重试。');}finally{setBusy(false);}
  }

  if (checking) return <AuthCardFrame><AuthBrand/><div className="zy-auth-loading">正在打开智域…</div></AuthCardFrame>;
  if (contentResetError) return <AuthCardFrame><AuthBrand/><p className="zy-auth-error zy-auth-reset-error" role="alert">{contentResetError}</p><button type="button" className="zy-auth-primary" onClick={()=>window.location.reload()}>重新尝试</button></AuthCardFrame>;
  if (account) return <AuthContext.Provider value={{ account, logout,firstUse }}>{children}<AccountStorageFeedback/></AuthContext.Provider>;

  if(inviteOnly)return <AuthCardFrame><AuthBrand/><form className="zy-auth-form zy-invite-form" onSubmit={submitInvite}>
    <label className="zy-invite-input"><span className="sr-only">输入邀请码</span><input aria-label="输入邀请码" placeholder="输入邀请码" value={inviteCode} onChange={event=>{setInviteCode(event.target.value);setError('');}} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} maxLength={128}/></label>
    <p className="zy-invite-adult-notice">本产品仅供 18 岁以上成年人使用</p>
    <label className="zy-invite-adult-check"><input type="checkbox" checked={adultConfirmed} onChange={event=>setAdultConfirmed(event.target.checked)} disabled={busy}/><span>我已满 18 岁</span></label>
    {error&&<p className="zy-auth-error" role="alert">{error}</p>}
    <button data-zy-magnetic-entry className="zy-auth-primary" type="submit" disabled={busy||!adultConfirmed||!inviteCode.trim()}>{busy?'正在进入…':'进入智域'}</button>
  </form></AuthCardFrame>;

  return <AuthCardFrame>
      <AuthBrand/>
      {view === 'welcome' ? <>
        <div className="zy-auth-welcome-heading"><h1>欢迎来到智域</h1><p>登录后，继续你的对话。</p></div>
        <div className="zy-auth-welcome-actions">
          <button data-zy-magnetic-entry className="zy-auth-primary" type="button" onClick={() => switchView('login')}>登录</button>
          <button className="zy-auth-secondary" type="button" onClick={() => switchView('register')}>注册</button>
        </div>
        <div className="zy-auth-qr-status"><QrCode size={20} strokeWidth={1.5} aria-hidden="true" /><span>扫码登录<span>暂未开放</span></span></div>
      </> : <>
        <div className="zy-auth-heading">
          <h1>{view === 'choose' ? '使用智域账号' : view === 'login' ? '登录智域' : '注册智域'}</h1>
          <p>{view === 'choose' ? '选择登录，或创建一个新账号。' : view === 'login' ? '输入账号和密码继续聊天。' : '注册后即可开始与人物聊天。'}</p>
        </div>
        {view === 'choose' ? <div className="zy-auth-choices">
          <button data-zy-magnetic-entry className="zy-auth-primary" type="button" onClick={() => switchView('login')}>登录</button>
          <button className="zy-auth-secondary" type="button" onClick={() => switchView('register')}>注册</button>
        </div> : <form className="zy-auth-form" onSubmit={submit} noValidate>
          <AuthField field="username" label="账号名称" value={username} autoComplete="username" error={fieldErrors.username} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />
          <AuthField field="password" label="密码" value={password} autoComplete={view === 'register' ? 'new-password' : 'current-password'} error={fieldErrors.password} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />
          {view === 'register' && <AuthField field="confirmPassword" label="确认密码" value={confirmPassword} autoComplete="new-password" error={fieldErrors.confirmPassword} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />}
          {view==='register'&&adultConfirmationRequired&&<><p className="zy-invite-adult-notice">本产品仅供 18 岁以上成年人使用</p><label className="zy-invite-adult-check"><input type="checkbox" checked={adultConfirmed} onChange={event=>{setAdultConfirmed(event.target.checked);setError('');}} disabled={busy}/><span>我已满 18 岁</span></label></>}
          {error && <p className="zy-auth-error" role="alert">{error}</p>}
          <button data-zy-magnetic-entry={view==='login'?true:undefined} className="zy-auth-primary" type="submit" disabled={busy||(view==='register'&&adultConfirmationRequired&&!adultConfirmed)}>{busy ? '请稍候…' : view === 'login' ? '登录' : '注册'}</button>
          <button className="zy-auth-switch" type="button" disabled={busy} onClick={() => switchView(view === 'login' ? 'register' : 'login')}>{view === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button>
        </form>}
        {view === 'choose' && error && <p className="zy-auth-error" role="alert">{error}</p>}
        <button className="zy-auth-back" type="button" disabled={busy} onClick={() => switchView(view === 'choose' ? 'welcome' : 'choose')}>返回</button>
      </>}
  </AuthCardFrame>;
}

function AuthBrand() {
  return <div className="zy-auth-brand"><img className="zy-auth-logo" src="/zhiyu-logo.png" alt="智域"/><span>智域</span></div>;
}

function AuthCardFrame({children}:{children:ReactNode}) {
  return <main className="zy-auth-stage"><ReflectiveLoginCard><section className="zy-auth-card" aria-label="智域登录">{children}</section></ReflectiveLoginCard></main>;
}

function AuthField({ field, label, value, autoComplete, error, feedbackRevision, busy, onChange }: {
  field: AuthFieldName;
  label: string;
  value: string;
  autoComplete: string;
  error?: string;
  feedbackRevision: number;
  busy: boolean;
  onChange: (field: AuthFieldName, value: string) => void;
}) {
  const id = field === 'confirmPassword' ? 'zy-auth-confirm' : `zy-auth-${field}`;
  const [feedbackText, setFeedbackText] = useState(error || '');
  if (error && feedbackText !== error) setFeedbackText(error);
  useEffect(() => {
    if (error) return;
    // Keep the previous line just long enough for the feedback row to fold up.
    const timeout = setTimeout(() => setFeedbackText(''), 180);
    return () => clearTimeout(timeout);
  }, [error]);
  return <div className={`zy-auth-field${error ? ' is-invalid' : ''}`} data-feedback-phase={feedbackRevision % 2 ? 'odd' : 'even'}>
    <label htmlFor={id}>{label}</label>
    <input id={id} name={field} type={field === 'username' ? 'text' : 'password'} autoComplete={autoComplete}
      value={value} onChange={event => onChange(field, event.target.value)} required disabled={busy}
      minLength={field === 'username' ? 6 : 12} maxLength={field === 'username' ? 32 : undefined}
      aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
    <div className="zy-auth-field-feedback" aria-hidden={!error}>
      <p id={`${id}-error`} className="zy-auth-field-error" role={error ? 'alert' : undefined}>{feedbackText}</p>
    </div>
  </div>;
}

function AccountStorageFeedback(){
  const [status,setStatus]=useState<AccountStorageStatus>(()=>getAccountStorageStatus());
  const [retrying,setRetrying]=useState(false);
  useEffect(()=>subscribeAccountStorageStatus(()=>setStatus(getAccountStorageStatus())),[]);
  if(!status.error&&!status.pending)return null;
  if(!status.error)return <output className="zy-storage-feedback" aria-live="polite">正在保存…</output>;
  return <output className="zy-storage-feedback" aria-live="polite"><span>{status.error} {status.pending>0?'尚有修改未保存，请保持此页面打开。':''}</span>
    {status.conflict?<div><button type="button" onClick={()=>resolveAccountStorageConflict('local')}>保留本次修改</button><button type="button" onClick={()=>{resolveAccountStorageConflict('server');window.location.reload();}}>使用云端版本</button></div>:<button type="button" disabled={retrying} onClick={()=>{setRetrying(true);void flushAccountStorage().catch(()=>{}).finally(()=>setRetrying(false));}}>{retrying?'正在重试…':'重新保存'}</button>}
  </output>;
}
