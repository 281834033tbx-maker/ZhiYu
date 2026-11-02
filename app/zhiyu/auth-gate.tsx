'use client';
/* eslint-disable next/no-img-element -- The bundled desktop logo is a fixed local asset. */

import { createContext, useContext, useEffect, useState, type SyntheticEvent, type ReactNode } from 'react';
import { LockKeyhole, QrCode } from 'lucide-react';
import { authFailureFeedback, validateAuthForm, type AuthFieldErrors, type AuthFieldName } from './auth-validation';
import './auth-gate.css';

type Account = { id: string; username: string };
type AuthContextValue = { account: Account; logout: () => Promise<void> };
type AuthResponse = { authenticated: boolean; account?: Account; claimedLegacy?: boolean; error?: string };
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

export default function AuthGate({ children }: { children: ReactNode }) {
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

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.json() as Promise<AuthResponse>)
      .then(data => {
        if (alive && data.authenticated && data.account) {
          if (data.claimedLegacy) {
            try { migrateLegacyBrowserState(data.account.id); }
            catch { setError('旧聊天列表迁移失败；人物记忆仍可读取'); }
          }
          setAccount(data.account);
        }
      })
      .catch(() => { if (alive) setError('本机登录服务暂时无法连接'); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  const switchView = (next: View) => {
    setView(next);
    setPassword('');
    setConfirmPassword('');
    setError('');
    setFieldErrors({});
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
    setBusy(true);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/auth/${view}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword }),
      });
      const data = await response.json() as AuthResponse;
      if (!response.ok || !data.account) {
        const feedback = authFailureFeedback(view, response.status, data.error);
        setError(feedback.error);
        showFieldErrors(feedback.fields, form);
        return;
      }
      if (data.claimedLegacy) {
        try { migrateLegacyBrowserState(data.account.id); }
        catch { setError('旧聊天列表迁移失败；人物记忆仍可读取'); }
      }
      setPassword('');
      setConfirmPassword('');
      setAccount(data.account);
    } catch {
      setError('本机登录服务暂时无法连接，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('退出失败，请重试');
    setAccount(null);
    setUsername('');
    switchView('welcome');
  }

  if (checking) return <main className="zy-auth-stage"><div className="zy-auth-loading">正在打开智域…</div></main>;
  if (account) return <AuthContext.Provider value={{ account, logout }}>{children}</AuthContext.Provider>;

  return <main className="zy-auth-stage">
    <section className="zy-auth-card" aria-label="智域登录">
      <img className="zy-auth-logo" src="/zhiyu-logo.png" alt="智域" />
      {view === 'welcome' ? <>
        <div className="zy-auth-qr" aria-hidden="true"><QrCode size={164} strokeWidth={1.25} /></div>
        <div className="zy-auth-qr-title">扫码登录</div>
        <p className="zy-auth-note">暂未开放</p>
        <button className="zy-auth-entry" type="button" onClick={() => switchView('choose')}>账号密码登录 / 注册</button>
      </> : <>
        <div className="zy-auth-heading">
          <LockKeyhole size={34} strokeWidth={1.6} />
          <h1>{view === 'choose' ? '使用智域账号' : view === 'login' ? '登录智域' : '注册智域'}</h1>
          <p>{view === 'choose' ? '选择登录，或创建一个新账号。' : view === 'login' ? '输入账号和密码继续聊天。' : '注册后即可开始与人物聊天。'}</p>
        </div>
        {view === 'choose' ? <div className="zy-auth-choices">
          <button className="zy-auth-primary" type="button" onClick={() => switchView('login')}>登录</button>
          <button className="zy-auth-secondary" type="button" onClick={() => switchView('register')}>注册</button>
        </div> : <form className="zy-auth-form" onSubmit={submit} noValidate>
          <AuthField field="username" label="账号名称" value={username} autoComplete="username" error={fieldErrors.username} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />
          <AuthField field="password" label="密码" value={password} autoComplete={view === 'register' ? 'new-password' : 'current-password'} error={fieldErrors.password} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />
          {view === 'register' && <AuthField field="confirmPassword" label="确认密码" value={confirmPassword} autoComplete="new-password" error={fieldErrors.confirmPassword} feedbackRevision={feedbackRevision} busy={busy} onChange={editField} />}
          {error && <p className="zy-auth-error" role="alert">{error}</p>}
          <button className="zy-auth-primary" type="submit" disabled={busy}>{busy ? '请稍候…' : view === 'login' ? '登录' : '注册'}</button>
          <button className="zy-auth-switch" type="button" disabled={busy} onClick={() => switchView(view === 'login' ? 'register' : 'login')}>{view === 'login' ? '还没有账号？注册' : '已有账号？登录'}</button>
        </form>}
        {view === 'choose' && error && <p className="zy-auth-error" role="alert">{error}</p>}
        <button className="zy-auth-back" type="button" disabled={busy} onClick={() => switchView(view === 'choose' ? 'welcome' : 'choose')}>返回</button>
      </>}
    </section>
  </main>;
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
