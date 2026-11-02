'use client';

import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {Search, X} from 'lucide-react';

export type GroupSearchEntry = {
  id: string;
  senderName: string;
  text: string;
  at: string;
  displayTime?: string;
  avatar: ReactNode;
  content: ReactNode;
};

function historyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export default function GroupChatSearch({name, memberCount, entries, onLocate, onClose}: {
  name: string;
  memberCount?: number;
  entries: GroupSearchEntry[];
  onLocate: (messageId: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    input.current?.focus();
    return () => node?.close();
  }, []);
  const keyword = query.trim().toLocaleLowerCase();
  const results = [...entries].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).filter(entry => !keyword || `${entry.senderName}\n${entry.text}`.toLocaleLowerCase().includes(keyword));
  return <dialog ref={dialog} className="zy-dialog zy-group-search-dialog" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onClose();}}>
    <header className="zy-group-search-head"><h2 id={titleId}>“{name}”的聊天记录{memberCount!==undefined?`（${memberCount}）`:''}</h2><button type="button" className="zy-group-icon" aria-label="关闭聊天记录" onClick={onClose}><X size={18}/></button></header>
    <label className="zy-group-history-search"><Search size={18} aria-hidden="true"/><input ref={input} value={query} placeholder="搜索" aria-label={memberCount!==undefined?'搜索群聊天记录':'搜索聊天记录'} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" className="zy-group-icon" aria-label="清除搜索" onClick={() => {setQuery(''); input.current?.focus();}}><X size={15}/></button>}</label>
    <div className="zy-group-search-results" aria-label={memberCount!==undefined?'群聊天记录':'聊天记录'}>
      {results.map(entry => <article key={entry.id} className="zy-group-search-result" data-search-message-id={entry.id}>
        <span className="zy-group-search-avatar">{entry.avatar}</span>
        <div className="zy-group-search-message"><span className="zy-group-search-sender">{entry.senderName}</span><div className="zy-group-search-preview">{entry.content}</div></div>
        <div className="zy-group-search-location"><time dateTime={entry.at||undefined}>{historyTime(entry.at)||entry.displayTime}</time><button type="button" className="zy-group-search-locate" aria-label={`定位到${entry.senderName}的聊天位置`} onClick={() => onLocate(entry.id)}>定位到聊天位置</button></div>
      </article>)}
      {!results.length && <p className="zy-group-search-empty">{keyword ? '没有找到匹配的聊天记录' : '还没有聊天记录'}</p>}
    </div>
  </dialog>;
}
