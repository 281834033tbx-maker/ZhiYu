'use client';
import {reportUserFacingError} from '../../lib/user-facing-errors';

import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode} from 'react';
import {Camera, LoaderCircle, Pencil} from 'lucide-react';
import './inline-name-edit.css';
import './self-profile-card.css';

export type SelfProfileCardProps = {
  name: string;
  account: string;
  signature: string;
  avatar: ReactNode;
  background?: string;
  editing: 'name' | 'bio' | null;
  draft: string;
  onAvatar: () => void;
  onBackground: () => void;
  onBeginEdit: (kind: 'name' | 'bio') => void;
  onDraftChange: (value: string) => void;
  onSaveEdit: () => Promise<unknown> | void;
  onCancelEdit: () => void;
};

type PressGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  bounds: DOMRect;
  moved: boolean;
};

const INTERACTIVE_TARGET = 'button,input,textarea,select,a,label,[role="button"],[contenteditable="true"],[data-card-no-press]';

export function SelfProfileCard({name, account, signature, avatar, background, editing, draft, onAvatar, onBackground, onBeginEdit, onDraftChange, onSaveEdit, onCancelEdit}: SelfProfileCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const gesture = useRef<PressGesture | null>(null);
  const suppressClick = useRef(false);
  const [pressed, setPressed] = useState(false);

  const finishPress = useCallback((cancelled = false) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    suppressClick.current = !cancelled && active.moved;
    const element = card.current;
    element?.style.setProperty('--zy-self-card-rotate-x', '0deg');
    element?.style.setProperty('--zy-self-card-rotate-y', '0deg');
    setPressed(false);
    if (element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
  }, []);

  const movePress = useCallback((clientX: number, clientY: number) => {
    const active = gesture.current;
    const element = card.current;
    if (!active || !element) return;
    if (Math.hypot(clientX - active.startX, clientY - active.startY) > 6) active.moved = true;
    const x = Math.max(0, Math.min(1, (clientX - active.bounds.left) / Math.max(1, active.bounds.width)));
    const y = Math.max(0, Math.min(1, (clientY - active.bounds.top) / Math.max(1, active.bounds.height)));
    element.style.setProperty('--zy-self-card-press-x', `${x * 100}%`);
    element.style.setProperty('--zy-self-card-press-y', `${y * 100}%`);
    element.style.setProperty('--zy-self-card-rotate-x', `${(0.5 - y) * 6}deg`);
    element.style.setProperty('--zy-self-card-rotate-y', `${(x - 0.5) * 6}deg`);
  }, []);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) movePress(event.clientX, event.clientY);
    };
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) finishPress();
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) finishPress(true);
    };
    const reset = () => finishPress(true);
    const visibility = () => {if (document.hidden) reset();};
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('pointermove', move, {passive: true});
    window.addEventListener('pointerup', up, {passive: true});
    window.addEventListener('pointercancel', cancel, {passive: true});
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', visibility);
    reducedMotion.addEventListener('change', reset);
    const element = card.current;
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', visibility);
      reducedMotion.removeEventListener('change', reset);
      const active = gesture.current;
      gesture.current = null;
      if (active && element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
    };
  }, [finishPress, movePress]);

  function beginPress(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_TARGET)) return;
    gesture.current = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, bounds: event.currentTarget.getBoundingClientRect(), moved: false};
    movePress(event.clientX, event.clientY);
    setPressed(true);
    // Pointer capture keeps release reliable even after dragging outside the card.
    try {event.currentTarget.setPointerCapture(event.pointerId);} catch { /* Window listeners cover unavailable capture. */ }
  }

  function clickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return <div ref={card} className={`zy-self-profile-card${pressed ? ' is-pressed' : ''}`} onPointerDown={beginPress} onLostPointerCapture={() => finishPress(true)} onClickCapture={clickCapture}>
    <div className="zy-self-card-surface">
      {/* eslint-disable-next-line next/no-img-element */}
      <img className="zy-self-card-background" src={background || '/stitch/self-profile-hiking-background-20261008.png'} alt="" aria-hidden="true"/>
      <div className="zy-self-card-shade" aria-hidden="true"/>
      <button type="button" className="zy-self-card-background-edit" aria-label="更换资料卡背景" title="更换资料卡背景" onClick={onBackground}><Pencil size={14} strokeWidth={1.65} aria-hidden="true"/></button>
      <div className="zy-self-card-light zy-self-card-light-mint" aria-hidden="true"/>
      <div className="zy-self-card-light zy-self-card-light-peach" aria-hidden="true"/>
      <div className="zy-self-card-light zy-self-card-light-lilac" aria-hidden="true"/>
      <div className="zy-self-card-content">
        <div className="zy-self-card-identity">
          <button type="button" className="zy-self-card-avatar" aria-label="更改头像" onClick={onAvatar}>{avatar}<span className="zy-self-card-camera"><Camera size={16} aria-hidden="true"/></span></button>
          <div className="zy-self-card-copy">
            <div className="zy-self-card-name"><ProfileFieldEditor kind="name" value={name} editing={editing === 'name'} draft={draft} onBegin={() => onBeginEdit('name')} onDraftChange={onDraftChange} onSave={onSaveEdit} onCancel={onCancelEdit}/></div>
          </div>
        </div>
        <div className="zy-self-card-details">
          <ProfileFieldEditor kind="bio" value={signature} editing={editing === 'bio'} draft={draft} onBegin={() => onBeginEdit('bio')} onDraftChange={onDraftChange} onSave={onSaveEdit} onCancel={onCancelEdit}/>
          <p className="zy-self-card-account" data-card-no-press>{account}</p>
        </div>
      </div>
    </div>
  </div>;
}

function ProfileFieldEditor({kind, value, editing, draft, onBegin, onDraftChange, onSave, onCancel}: {
  kind: 'name' | 'bio';
  value: string;
  editing: boolean;
  draft: string;
  onBegin: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => Promise<unknown> | void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const suppressBlur = useRef(false);
  const returnFocus = useRef(false);
  const composing = useRef(false);
  const errorId = useId();
  const label = kind === 'name' ? '名字' : '个性签名';
  const displayValue = value || (kind === 'name' ? '未设置' : '添加个性签名');
  const signatureGlyphs = kind === 'bio' ? Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(displayValue), part => part.segment) : [];

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  useLayoutEffect(() => {
    if (editing) {
      suppressBlur.current = false;
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  function begin() {
    if (lock.current) return;
    suppressBlur.current = false;
    returnFocus.current = false;
    setError('');
    onBegin();
  }

  function cancel() {
    if (lock.current) return;
    suppressBlur.current = true;
    returnFocus.current = true;
    setError('');
    onCancel();
  }

  async function save(from: 'enter' | 'blur') {
    if (lock.current || suppressBlur.current) return;
    if (kind === 'name' && !draft.trim()) {setError('名字不能为空'); return;}
    lock.current = true;
    suppressBlur.current = true;
    returnFocus.current = from === 'enter';
    setSaving(true);
    setError('');
    try {
      await onSave();
    } catch (cause) {
      suppressBlur.current = false;
      returnFocus.current = false;
      if (mounted.current) setError(reportUserFacingError(cause,'save','保存资料'));
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'Enter' && (kind === 'name' || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      void save('enter');
    }
  }

  const inputProps = {
    'aria-label': `修改${label}`,
    'aria-invalid': !!error,
    'aria-describedby': error ? errorId : undefined,
    value: draft,
    disabled: saving,
    onChange: (event: {target: {value: string}}) => {onDraftChange(event.target.value); setError('');},
    onCompositionStart: () => {composing.current = true;},
    onCompositionEnd: () => {composing.current = false;},
    onBlur: () => {void save('blur');},
    onKeyDown: keyDown,
  };

  return <div className={kind === 'name' ? 'zy-inline-name-edit' : 'zy-self-card-signature'}>
    <span className={kind === 'name' ? 'zy-inline-name-label' : 'zy-self-card-signature-label'}>{label}</span>
    <div className="zy-inline-name-field">
      {editing ? <div className={kind === 'name' ? 'zy-inline-name-input-wrap' : 'zy-self-card-signature-input-wrap'} aria-busy={saving}>
        {kind === 'name' ? <input ref={element => {input.current = element;}} className="zy-inline-name-input" maxLength={40} required {...inputProps}/> : <textarea ref={element => {input.current = element;}} className="zy-inline-name-input zy-self-card-signature-input" maxLength={120} rows={2} {...inputProps}/>}
        {saving && <LoaderCircle className="zy-self-card-saving" size={13} aria-label="保存中"/>}
      </div> : <button ref={button} type="button" className={kind === 'name' ? 'zy-inline-name-value' : 'zy-self-card-signature-value'} aria-label={`修改${label}`} onClick={begin}>{kind === 'bio' ? <span className={value ? '' : 'is-placeholder'}><span>{signatureGlyphs.slice(0, -1).join('')}</span><span className="zy-self-card-signature-tail">{signatureGlyphs.at(-1)}<Pencil size={13} strokeWidth={1.65} aria-hidden="true"/></span></span> : <><span className={value ? '' : 'is-placeholder'}>{displayValue}</span><Pencil size={13} strokeWidth={1.65} aria-hidden="true"/></>}</button>}
      {error && <p className="zy-self-card-error" id={errorId} role="alert">{error}</p>}
    </div>
  </div>;
}

export default SelfProfileCard;
