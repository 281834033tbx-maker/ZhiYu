'use client';
import {reportUserFacingError} from '../../lib/user-facing-errors';
/* eslint-disable next/no-img-element */

import {useEffect, useId, useRef, useState, type SubmitEvent} from 'react';
import {Bot, Check, LockKeyhole, Search, X} from 'lucide-react';
import {molly, type Person} from './data';
import './group-create-dialog.css';

export type GroupCreateSelection = {goal: string; memberIds: string[]};

function ContactFace({person}: {person: Person}) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  return <span className="zy-contact-create-face" aria-hidden="true">
    {person.avatar && person.avatar !== failedAvatar
      ? <img src={person.avatar} alt="" draggable={false} onError={() => setFailedAvatar(person.avatar)}/>
      : person.id === 'molly' ? <Bot size={21}/> : <span>{person.initial || person.name.slice(0, 1)}</span>}
  </span>;
}

export function GroupCreateDialog({source, people, initialGoal = '', initialMemberIds = [], onCreate, onClose, busy = false, error = ''}: {
  source: Person;
  people: Person[];
  initialGoal?: string;
  initialMemberIds?: string[];
  onCreate: (input: GroupCreateSelection) => Promise<unknown>;
  onClose: () => void;
  busy?: boolean;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [goal, setGoal] = useState(initialGoal);
  const required = new Set(['molly', source.id]);
  const available = [...new Map([molly, source, ...people]
    .filter(person => person.id !== 'self' && person.id !== 'user' && !person.group)
    .map(person => [person.id, person])).values()];
  const [selected, setSelected] = useState(() => new Set([...initialMemberIds, ...required]));
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const blocked = busy || submitting;
  const isMolly = source.id === 'molly';
  const titleId = useId();
  const goalId = useId();
  const noteId = useId();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = available.filter(person => [person.name, person.nickname, person.realName, person.account]
    .some(value => value?.toLocaleLowerCase().includes(normalizedQuery)));
  const chosen = available.filter(person => selected.has(person.id) || required.has(person.id));

  useEffect(() => {
    const node = dialog.current;
    if (!node?.open) node?.showModal();
    search.current?.focus();
    return () => node?.close();
  }, []);

  function toggle(id: string, checked: boolean) {
    if (required.has(id) || blocked) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || !goal.trim()) return;
    setSubmitting(true);
    setLocalError('');
    try {
      await onCreate({goal: goal.trim(), memberIds: chosen.map(person => person.id)});
    } catch (createError) {
      setLocalError(reportUserFacingError(createError,'send','创建群聊'));
    } finally {
      setSubmitting(false);
    }
  }

  return <dialog ref={dialog} className="zy-dialog zy-contact-create" aria-labelledby={titleId} aria-describedby={noteId}
    onCancel={event => {event.preventDefault(); if (!blocked) onClose();}}>
    <form className="zy-contact-create-layout" onSubmit={submit}>
      <section className="zy-contact-create-contacts" aria-label="选择联系人">
        <div className="zy-contact-create-search"><Search size={17} aria-hidden="true"/>
          <input ref={search} type="search" value={query} aria-label="搜索联系人" placeholder="搜索联系人" disabled={blocked} onChange={event => setQuery(event.target.value)}/>
        </div>
        <h3>联系人</h3>
        <div className="zy-contact-create-list">
          {filtered.map(person => {
            const checked = selected.has(person.id) || required.has(person.id);
            const fixed = required.has(person.id);
            return <label key={person.id} className={`zy-contact-create-option${checked ? ' is-selected' : ''}${fixed ? ' is-fixed' : ''}`}>
              <input type="checkbox" checked={checked} disabled={fixed || blocked} aria-label={`选择${person.name}${fixed ? '，固定成员' : ''}`} onChange={event => toggle(person.id, event.target.checked)}/>
              <span className="zy-contact-create-check" aria-hidden="true">{checked && <Check size={13}/>}</span>
              <ContactFace person={person}/>
              <span className="zy-contact-create-name" title={person.name}>{person.name}</span>
              {fixed && <LockKeyhole className="zy-contact-create-lock" size={12} aria-label="固定成员"/>}
            </label>;
          })}
          {!filtered.length && <p className="zy-contact-create-empty">没有找到联系人</p>}
        </div>
      </section>
      <section className="zy-contact-create-selected" aria-label="已选联系人">
        <header className="zy-contact-create-head"><h2 id={titleId}>{isMolly ? '让 Molly 建群' : '交给 Molly 建群'}</h2><span aria-live="polite">已选择 {chosen.length} 位联系人</span></header>
        <div className="zy-contact-create-chosen-list">
          {chosen.map(person => <div className="zy-contact-create-chosen" key={person.id}>
            <ContactFace person={person}/>
            <div className="zy-contact-create-chosen-copy"><span title={person.name}>{person.name}</span>
              {required.has(person.id) && <small>{person.id === 'molly' ? '管理员 · 固定加入' : '当前联系人 · 固定加入'}</small>}
            </div>
            {!required.has(person.id) && <button type="button" className="zy-contact-create-remove" aria-label={`移除已选联系人${person.name}`} disabled={blocked} onClick={() => toggle(person.id, false)}><X size={13}/></button>}
          </div>)}
        </div>
        <div className="zy-contact-create-goal">
          <p id={noteId}>{isMolly ? '你会自动加入，Molly 会主持协作并为群起名。' : `是否让 Molly 邀请${source.name}和已选联系人一起建群？你会自动加入。`}</p>
          <label htmlFor={goalId}>想一起做什么？</label>
          <textarea id={goalId} value={goal} maxLength={1000} rows={2} required disabled={blocked} placeholder="例如：健身，也想学着做一周的营养餐" onChange={event => setGoal(event.target.value)}/>
          {(error || localError) && <p className="zy-contact-create-error" role="alert">{error || localError}</p>}
        </div>
        <footer className="zy-contact-create-footer"><button type="button" className="zy-contact-create-cancel" disabled={blocked} onClick={onClose}>取消</button><button type="submit" className="zy-contact-create-submit" disabled={blocked || !goal.trim()}>{blocked ? '正在建群…' : isMolly ? '完成' : '同意并完成'}</button></footer>
      </section>
    </form>
  </dialog>;
}
