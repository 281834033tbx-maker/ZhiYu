'use client';

import {useLayoutEffect,useRef,useState,type Ref} from 'react';
import {createPortal} from 'react-dom';
import {formatCallDuration} from '../../lib/npc/realtime-call-presentation';
import {splitCaptionUpdate} from './caption-reveal';
import './realtime-voice-call.css';

export type RealtimeCaptionLine = {id:string;role:'user'|'assistant';text:string};
export type RealtimeCaptionMessage = {text:string;tone:'error'|'notice';action?:{label:string;onClick:()=>void}};

function CaptionLine({line,previous=false,softenText=false}:{line:RealtimeCaptionLine;previous?:boolean;softenText?:boolean}) {
  const clip=useRef<HTMLDivElement>(null);
  const [reveal,setReveal]=useState(()=>({text:line.text,revision:0,...splitCaptionUpdate('',line.text)}));
  if(reveal.text!==line.text)setReveal({text:line.text,revision:reveal.revision+1,...splitCaptionUpdate(reveal.text,line.text)});
  useLayoutEffect(()=>{if(clip.current)clip.current.scrollTop=clip.current.scrollHeight;},[line.text]);
  useLayoutEffect(()=>{
    const element=clip.current;
    if(!element||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(()=>{element.scrollTop=element.scrollHeight;});
    observer.observe(element);
    if(element.firstElementChild)observer.observe(element.firstElementChild);
    return()=>observer.disconnect();
  },[]);
  return <div ref={clip} className={'zy-caption-line '+(previous?'zy-caption-prev':'zy-caption-current')+' is-'+line.role} data-caption-id={line.id} data-caption-role={line.role}>
    <p>{softenText&&!previous?<>{reveal.before}{reveal.added&&<span key={reveal.revision} className="zy-caption-ink">{reveal.added}</span>}{reveal.after}</>:line.text}</p>
  </div>;
}

export function RealtimeCallCaptions({previous,current,waiting=false,hidden=false,message,softenText=false}: {
  previous?:RealtimeCaptionLine|null;
  current?:RealtimeCaptionLine|null;
  waiting?:boolean;
  hidden?:boolean;
  message?:RealtimeCaptionMessage|null;
  /** Enabled by the video scene only; ordinary chat and voice surfaces keep their existing behavior. */
  softenText?:boolean;
}) {
  return <section className={'zy-call-captions'+(hidden?' is-hidden':'')} aria-label="通话字幕" aria-live={hidden?'off':'polite'} aria-atomic="false" aria-hidden={hidden} inert={hidden} data-caption-hidden={hidden}>
    {message?<div className={'zy-caption-message is-'+message.tone} data-caption-message={message.tone}>
      <output aria-live={message.tone==='error'?'assertive':'polite'}>{message.text}</output>
      {message.action&&<button type="button" className="zy-call-glass-button zy-call-settings-button" onClick={message.action.onClick}>{message.action.label}</button>}
    </div>:<>
      {previous?.text&&<CaptionLine key={'previous:'+previous.role+':'+previous.id} line={previous} previous/>}
      {waiting?<output className="zy-caption-current zy-caption-waiting" aria-label="正在准备回复" data-caption-waiting="true"><i aria-hidden="true"/><i aria-hidden="true"/><i aria-hidden="true"/></output>
        :current?.text?<CaptionLine key={'current:'+current.role+':'+current.id} line={current} softenText={softenText}/>:null}
    </>}
  </section>;
}

export function RealtimeCallTimer({elapsedMs,connecting=false,connected=false}:{elapsedMs:number;connecting?:boolean;connected?:boolean}) {
  return <output className={'zy-call-timer'+(!connected?' is-connecting':'')} aria-label={'人物互动时长 '+formatCallDuration(elapsedMs)} aria-live="off" data-call-timer="true" data-call-connecting={connecting} data-voice-connected={connected}>
    <span className="zy-call-timer-dot" aria-hidden="true"/><span>{formatCallDuration(elapsedMs)}</span>
  </output>;
}

export function LocalCameraPreview({visible,pending,videoRef}:{visible:boolean;pending:boolean;videoRef:Ref<HTMLVideoElement>}) {
  return <section className="zy-call-camera" data-camera-visible={visible} data-camera-pending={pending} aria-label="你的本地摄像头预览" aria-hidden={!visible} inert={!visible}>
    <video ref={videoRef} autoPlay muted playsInline aria-label="你的摄像头画面，仅本地显示"/>
    <div className="zy-call-camera-placeholder" aria-hidden={!pending}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="20" cy="13" r="6"/><path d="M8 33v-3a12 12 0 0 1 24 0v3"/></svg>
      <output>正在打开摄像头…</output>
    </div>
  </section>;
}

export function RealtimeCallEnd({visible,elapsedMs,reconnectLabel,onReconnect,title}:{visible:boolean;elapsedMs:number;reconnectLabel:string;onReconnect:()=>void;title?:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useLayoutEffect(()=>{
    const element=dialog.current;
    if(!visible||!element)return;
    if(!element.open)element.showModal();
    return()=>{if(element.open)element.close();};
  },[visible]);
  if(!visible||typeof document==='undefined')return null;
  return createPortal(<dialog ref={dialog} className="zy-call-ended" aria-label={title||'通话已结束'} data-call-ended="true" onCancel={event=>event.preventDefault()}>
    <h2>{title||`通话已结束 · ${formatCallDuration(elapsedMs)}`}</h2>
    <button type="button" className="zy-call-glass-button" onClick={onReconnect}>{reconnectLabel}</button>
  </dialog>,document.body);
}
