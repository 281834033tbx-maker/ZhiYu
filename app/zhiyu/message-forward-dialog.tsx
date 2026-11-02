'use client';

import {useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent} from 'react';
import {Check, Search} from 'lucide-react';
import './group-create-dialog.css';
import './message-forward-dialog.css';

export type ForwardTarget = {id: string; name: string; face: ReactNode; disabled?: string; pending?: boolean};

export default function MessageForwardDialog({text, targets, onSend, onClose}: {
  text: string;
  targets: ForwardTarget[];
  onSend: (target: ForwardTarget, requestId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attemptedTargets, setAttemptedTargets] = useState<string[]>([]);
  const titleId = useId();
  const radioName = useId();
  const chosen = targets.find(target => target.id === selectedId);
  const filtered = targets.filter(target => target.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const unavailable = (target: ForwardTarget) => target.disabled || (target.pending && !attemptedTargets.includes(target.id) ? '成员正在回复，请稍后再试' : '');
  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    node?.showModal(); search.current?.focus();
    return () => {mounted.current = false; node?.close();};
  }, []);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !chosen || unavailable(chosen) || !text.trim()) return;
    lock.current = true; setBusy(true); setError('');
    let requestId = requestIds.current.get(chosen.id);
    if (!requestId) {requestId = crypto.randomUUID(); requestIds.current.set(chosen.id, requestId);}
    setAttemptedTargets(previous => previous.includes(chosen.id) ? previous : [...previous, chosen.id]);
    try {await onSend(chosen, requestId); if (mounted.current) onClose();}
    catch (failure) {if (mounted.current) setError(failure instanceof Error ? failure.message : '转发失败，请重试。');}
    finally {lock.current = false; if (mounted.current) setBusy(false);}
  }
  return <dialog ref={dialog} className="zy-dialog zy-contact-create zy-message-forward" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); if (!lock.current) onClose();}}>
    <form className="zy-contact-create-layout" onSubmit={submit}>
      <section className="zy-contact-create-contacts" aria-label="选择转发对象">
        <div className="zy-contact-create-search"><Search size={17}/><input ref={search} type="search" placeholder="搜索联系人或群聊" aria-label="搜索转发对象" disabled={busy} value={query} onChange={event => setQuery(event.target.value)}/></div>
        <h3>联系人和群聊</h3>
        <div className="zy-contact-create-list">{filtered.map(target => <label key={target.id} className={`zy-contact-create-option${selectedId === target.id ? ' is-selected' : ''}${unavailable(target) ? ' is-unavailable' : ''}`} title={unavailable(target) || undefined}>
          <input type="radio" name={radioName} checked={selectedId === target.id} disabled={busy || !!unavailable(target)} aria-label={`转发给${target.name}${unavailable(target) ? `，${unavailable(target)}` : ''}`} onChange={() => {setSelectedId(target.id); setError('');}}/>
          <span className="zy-contact-create-check" aria-hidden="true">{selectedId === target.id && <Check size={13}/>}</span>
          <span className="zy-message-forward-face" aria-hidden="true">{target.face}</span><span className="zy-contact-create-name">{target.name}</span>
        </label>)}{!filtered.length && <p className="zy-contact-create-empty">没有找到联系人或群聊</p>}</div>
      </section>
      <section className="zy-contact-create-selected" aria-label="转发确认">
        <header className="zy-contact-create-head"><h2 id={titleId}>转发消息</h2></header>
        <p className="zy-message-forward-recipient">{chosen ? `发送给 ${chosen.name}` : '请选择一个联系人或群聊'}</p>
        <div className="zy-message-forward-preview">{text}</div>
        <p className="zy-message-forward-note">转发文字内容</p>
        {error && <p className="zy-contact-create-error" role="alert">{error}</p>}
        <footer className="zy-contact-create-footer"><button type="button" className="zy-contact-create-cancel" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="zy-contact-create-submit" disabled={busy || !chosen || !!unavailable(chosen)}>{busy ? '发送中…' : '发送'}</button></footer>
      </section>
    </form>
  </dialog>;
}
