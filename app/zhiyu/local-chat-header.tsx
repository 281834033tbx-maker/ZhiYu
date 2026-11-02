'use client';
/* eslint-disable next/no-img-element */

import {useEffect, useRef, useState, type ComponentProps, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import ChatHeader from './chat-header';
import GroupChatSearch from './group-chat-search';
import type {Message, Person} from './data';
import './local-chat-header.css';

type Props = ComponentProps<typeof ChatHeader> & {
  messages: Message[];
  self: Person;
  thread: RefObject<HTMLDivElement | null>;
};

export default function LocalChatHeader({messages, self, thread, ...header}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [located, setLocated] = useState<{id:string;top:number;height:number}|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locatedId=located?.id;
  useEffect(() => () => {if (timer.current) clearTimeout(timer.current);}, []);
  useEffect(() => {
    const node = thread.current;
    if (!node || !locatedId) return;
    const refresh = () => {
      const row = Array.from(node.querySelectorAll<HTMLElement>('[data-local-message-id]')).find(item=>item.dataset.localMessageId===locatedId);
      if (!row) return;
      const box=row.getBoundingClientRect(), viewport=node.getBoundingClientRect();
      setLocated(old=>old&&({...old,top:box.top-viewport.top+node.scrollTop,height:box.height}));
    };
    const observer=new ResizeObserver(refresh);observer.observe(node);
    return()=>observer.disconnect();
  }, [locatedId, thread]);
  const locate = (id:string) => {
    const node=thread.current;
    const row=node&&Array.from(node.querySelectorAll<HTMLElement>('[data-local-message-id]')).find(item=>item.dataset.localMessageId===id);
    if(!node||!row)return;
    setSearchOpen(false);
    row.scrollIntoView({block:'center',behavior:'instant'});
    const box=row.getBoundingClientRect(),viewport=node.getBoundingClientRect();
    setLocated({id,top:box.top-viewport.top+node.scrollTop,height:box.height});
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>setLocated(null),1500);
  };
  const entries=messages.map(message=>({
    id:message.id,senderName:message.mine?(self.nickname||self.name):header.name,
    text:[message.text,message.image?'[图片]':'',message.audio?'[语音]':'',message.file||''].filter(Boolean).join('\n'),
    at:message.at||'',displayTime:message.time,
    avatar:message.mine?(self.avatar?<img src={self.avatar} alt=""/>:self.name.slice(0,1)):(header.avatar?<img src={header.avatar} alt=""/>:header.name.slice(0,1)),
    content:<>{message.text}{message.image&&<span>[图片]</span>}{message.audio&&<span>[语音]</span>}{message.file&&<span>[文件] {message.file}</span>}</>,
  }));
  return <>
    <ChatHeader {...header} onSearch={()=>setSearchOpen(true)}/>
    {searchOpen&&<GroupChatSearch name={header.name} entries={entries} onLocate={locate} onClose={()=>setSearchOpen(false)}/>}
    {located&&thread.current&&createPortal(<div className="zy-local-location-highlight" data-located-message-id={located.id} style={{top:located.top,height:located.height}} aria-hidden="true"/>,thread.current)}
  </>;
}
