'use client';

import {useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {LoaderCircle, Pencil} from 'lucide-react';
import './inline-name-edit.css';

export type InlineNameEditProps = {
  label: string;
  value: string;
  onSave: (value: string) => Promise<unknown> | void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
};

export function InlineNameEdit({label, value, onSave, maxLength = 40, placeholder = '', disabled = false, required = false}: InlineNameEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const lock = useRef(false);
  const suppressBlur = useRef(false);
  const returnFocus = useRef(false);
  const composing = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  function begin() {
    if (disabled || lock.current) return;
    suppressBlur.current = false;
    returnFocus.current = false;
    setDraft(value);
    setError('');
    setEditing(true);
  }

  function cancel() {
    if (lock.current) return;
    suppressBlur.current = true;
    returnFocus.current = true;
    setDraft(value);
    setError('');
    setEditing(false);
  }

  async function save(from: 'enter' | 'blur') {
    // Enter can disable/unmount the input and cause a blur in the same turn.
    if (lock.current || suppressBlur.current || disabled) return;
    const next = draft.trim();
    if (required && !next) {setError(`${label}不能为空`); return;}
    if (next === value) {
      suppressBlur.current = true;
      returnFocus.current = from === 'enter';
      setEditing(false);
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(next);
      if (!mounted.current) return;
      // The display keeps using the caller's saved value; no optimistic rename.
      suppressBlur.current = true;
      returnFocus.current = from === 'enter';
      setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && cause.message ? cause.message : `${label}未保存，请重试。`);
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void save('enter');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  return <div className="zy-inline-name-edit">
    <span className="zy-inline-name-label">{label}</span>
    <div className="zy-inline-name-field">
      {editing ? <div className="zy-inline-name-input-wrap" aria-busy={saving}>
        <input ref={input} className="zy-inline-name-input" aria-label={label} aria-invalid={!!error} value={draft} maxLength={maxLength} placeholder={placeholder} disabled={disabled || saving} required={required} onChange={event => {setDraft(event.target.value); setError('');}} onCompositionStart={() => {composing.current = true;}} onCompositionEnd={() => {composing.current = false;}} onBlur={() => {void save('blur');}} onKeyDown={keyDown}/>
        {saving && <LoaderCircle className="zy-inline-name-saving" size={13} aria-label="保存中"/>}
      </div> : <button ref={button} type="button" className="zy-inline-name-value" aria-label={`编辑${label}`} disabled={disabled} title={value || placeholder} onClick={begin}>
        <span className={value ? '' : 'is-placeholder'}>{value || placeholder || '未设置'}</span>
        <Pencil size={13} strokeWidth={1.65} aria-hidden="true"/>
      </button>}
      {error && <p className="zy-inline-name-error" role="alert">{error}</p>}
    </div>
  </div>;
}

export default InlineNameEdit;
