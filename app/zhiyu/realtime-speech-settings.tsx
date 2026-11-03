'use client';

import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import { Check, Eye, EyeOff, Mic, RefreshCw } from 'lucide-react';
import './realtime-speech-settings.css';

type SettingsStatus = {
  apiKeyConfigured: boolean;
  configured: boolean;
  voice: string;
  updatedAt?: string;
};

const endpoint = '/api/npc/realtime-speech/settings';

export default function RealtimeSpeechSettings({ onStartCall }: { onStartCall?: () => void }) {
  const [refresh,setRefresh]=useState(0);
  return <RealtimeSpeechSettingsSession key={refresh} onStartCall={onStartCall} onReload={()=>setRefresh(value=>value+1)}/>;
}
function RealtimeSpeechSettingsSession({onStartCall,onReload}:{onStartCall?:()=>void;onReload:()=>void}) {
  const id = useId();
  const [apiKey, setApiKey] = useState('');
  const [tokenSaved, setTokenSaved] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = !!apiKey.trim();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let active = true;
    fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as SettingsStatus & { error?: string };
        if (!response.ok) throw new Error(data.error || '读取设置失败，请重试。');
        if (typeof data.apiKeyConfigured !== 'boolean' || typeof data.configured !== 'boolean')
          throw new Error('读取设置失败，请重试。');
        if (active) {
          setTokenSaved(data.apiKeyConfigured);
          setConnectionOpen(!data.apiKeyConfigured);
          setLoaded(true);
        }
      })
      .catch(cause => {
        if (active) setError(reportUserFacingError(cause,'load','读取语音设置'));
      })
      .finally(() => {
        clearTimeout(timer);
        if (active) setLoading(false);
      });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, []);

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !loaded) return;
    setError('');
    setMessage('');
    const key = apiKey.trim();
    if (!key && !tokenSaved) { setConnectionOpen(true); setError('请填写 API Key。'); return; }
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(key ? { apiKey: key } : {}),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json() as SettingsStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || '保存失败，请重试。');
      if (typeof data.apiKeyConfigured !== 'boolean') throw new Error('未能确认保存状态，请重新读取设置。');
      setTokenSaved(data.apiKeyConfigured);
      setApiKey('');
      setShowToken(false);
      setConnectionOpen(false);
      setMessage('API Key 已保存，可在桌面人物窗口开启语音互动。');
    } catch (cause) {
      setError(reportUserFacingError(cause,'save','保存语音设置'));
    } finally { setBusy(false); }
  }

  return <section className="zy-realtime-settings" aria-label="实时语音连接设置">
    <div className="zy-realtime-intro">
      <span className="zy-realtime-icon"><Mic size={20} aria-hidden="true" /></span>
      <div>
        <h3>连接豆包实时语音</h3>
        <p>填写 API Key 后，在桌面人物窗口开启语音互动。</p>
      </div>
    </div>
    {loading ? <output className="zy-realtime-loading">正在读取本机设置…</output> : <>
      <form onSubmit={save} autoComplete="off">
        <details className="zy-realtime-connection" open={connectionOpen}
          onToggle={event => setConnectionOpen(event.currentTarget.open)}>
          <summary>连接设置 <span>{tokenSaved ? 'API Key 已保存' : '首次使用需填写 API Key'}</span></summary>
          <div className="zy-realtime-connection-body">
        <div className="zy-realtime-token-heading">
          <label className="zy-realtime-label" htmlFor={`${id}-api-key`}>API Key</label>
          {tokenSaved && <span className="zy-realtime-token-saved"><Check size={12} aria-hidden="true" />已保存</span>}
        </div>
        <div className="zy-realtime-token-field">
          <input id={`${id}-api-key`} name="doubao-realtime-api-key"
            className="zy-realtime-input" type={showToken ? 'text' : 'password'}
            value={apiKey} onChange={event => { setApiKey(event.target.value); setMessage(''); }}
            placeholder={tokenSaved ? '留空保留已保存的密钥' : '粘贴火山引擎 API Key'}
            autoComplete="off" spellCheck={false} maxLength={4096} disabled={busy || !loaded}/>
          <button type="button" className="zy-realtime-token-toggle" disabled={busy || !apiKey}
            onClick={() => setShowToken(value => !value)} aria-label={showToken ? '隐藏刚填写的密钥' : '显示刚填写的密钥'}
            aria-pressed={showToken}>
            {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <p className="zy-realtime-field-note">保存后只显示是否已配置，不显示密钥。</p>
          </div>
        </details>
        {error && <p className="zy-realtime-error" role="alert">{error}</p>}
        {message && <output className="zy-realtime-success"><Check size={15} aria-hidden="true" />{message}</output>}
        <footer className="zy-realtime-footer">
          <small>仅保存在这台电脑。</small>
          {loaded ? <button type="submit" className="zy-realtime-save"
            disabled={busy || !dirty || (!tokenSaved && !apiKey.trim())}>
            {busy ? '正在保存…' : '保存 API Key'}
          </button> : <button type="button" className="zy-realtime-save" onClick={onReload}>
            <RefreshCw size={14} aria-hidden="true" />重新读取
          </button>}
        </footer>
      </form>
      {tokenSaved && onStartCall && <>
        {dirty && <p className="zy-realtime-field-note">先保存密钥，再开启语音互动。</p>}
        <button type="button" className="zy-realtime-save zy-realtime-start" onClick={onStartCall}
          disabled={busy || !loaded || dirty}>打开语音互动</button>
      </>}
    </>}
  </section>;
}
