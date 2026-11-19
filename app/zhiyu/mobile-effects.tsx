'use client';

import {useEffect,useRef,useState,type ButtonHTMLAttributes,type CSSProperties,type ReactNode} from 'react';

const iconAnimations=new WeakMap<Element,Animation>();
const firstEntries=new Set<string>();
const pause=(duration:number)=>new Promise<void>(resolve=>setTimeout(resolve,duration));
const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run after the click's React update, so a replacement glyph also bounces. */
export function bounceMobileIcon(button:HTMLElement,kind:'icon'|'like'='icon') {
  requestAnimationFrame(()=>{
    if(!button.isConnected||reducedMotion())return;
    const icon=button.querySelector('svg,[data-mobile-bounce-icon]');
    if(!icon||typeof icon.animate!=='function')return;
    iconAnimations.get(icon)?.cancel();
    const animation=icon.animate([
      {transform:'scale(1)',offset:0},
      {transform:'scale(.8)',offset:.3},
      {transform:'scale(1.2)',offset:.65},
      {transform:'scale(1)',offset:1},
    ],{duration:kind==='like'?420:300,easing:'cubic-bezier(.3,1.2,.5,1)'});
    iconAnimations.set(icon,animation);
  });
}

export function MobileIconButton({children,onClick,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={props.type||'button'} className={'zy-mobile-icon-button '+className} onClick={event=>{
    onClick?.(event);
    if(!event.defaultPrevented)bounceMobileIcon(event.currentTarget);
  }}>{children}</button>;
}

export function MobileLikeButton({children,onClick,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={props.type||'button'} className={'zy-mobile-like-button '+className} onClick={event=>{
    onClick?.(event);
    if(!event.defaultPrevented)bounceMobileIcon(event.currentTarget,'like');
  }}>{children}</button>;
}

/** Account-qualified keys prevent data refreshes and return visits replaying entry. */
export function useMobileFirstEntry(key:string) {
  const [entry]=useState(()=>({key,first:!firstEntries.has(key)}));
  useEffect(()=>{firstEntries.add(key);},[key]);
  return entry.key===key?entry.first:!firstEntries.has(key);
}

export function MobileSwitch({checked,onChange,label,disabled=false,id,className=''}:{
  checked:boolean;onChange:(checked:boolean)=>void;label:string;disabled?:boolean;id?:string;className?:string;
}) {
  const [pulse,setPulse]=useState(0);
  return <button type="button" id={id} role="switch" aria-label={label} aria-checked={checked} disabled={disabled}
    className={'zy-mobile-switch '+className} data-switch-pulse={pulse?pulse%2?'odd':'even':undefined}
    onClick={()=>{setPulse(value=>value+1);onChange(!checked);}}><span aria-hidden="true"/></button>;
}

type SubmitPhase='idle'|'shrinking'|'loading'|'success'|'restoring';
export type MobileSubmitButtonProps<T>={
  children:ReactNode;
  onSubmit:()=>Promise<T>|T;
  onComplete?:(result:T)=>void;
  onError?:(error:unknown)=>void;
  disabled?:boolean;
  className?:string;
  style?:CSSProperties;
  'aria-label'?:string;
  title?:string;
};

/** Callers keep navigation/closing in onComplete, after the restored button. */
export function MobileSubmitButton<T=unknown>({children,onSubmit,onComplete,onError,disabled=false,className='',style,'aria-label':ariaLabel,title}:MobileSubmitButtonProps<T>) {
  const button=useRef<HTMLButtonElement>(null);
  const alive=useRef(true),running=useRef(false);
  const [phase,setPhase]=useState<SubmitPhase>('idle');
  const [size,setSize]=useState<{width:number;height:number}|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const pending=phase!=='idle';
  async function submit() {
    if(disabled||running.current)return;
    running.current=true;
    const rect=button.current?.getBoundingClientRect();
    if(rect)setSize({width:rect.width,height:rect.height});
    const motion=!reducedMotion();
    setPhase('shrinking');
    if(motion&&rect&&button.current&&typeof button.current.animate==='function')button.current.animate([
      {width:rect.width+'px',borderRadius:'10px'},
      {width:'34px',borderRadius:'17px'},
    ],{duration:300,easing:'ease-in-out'});
    const started=performance.now();
    const loading=pause(motion?300:0).then(()=>{if(alive.current)setPhase('loading');});
    try {
      const result=await onSubmit();
      await loading;
      await pause(motion?Math.max(0,1500-(performance.now()-started)):0);
      if(!alive.current)return;
      setPhase('success');
      await pause(motion?1000:0);
      if(!alive.current)return;
      setPhase('restoring');
      await pause(motion?300:0);
      if(!alive.current)return;
      setPhase('idle');
      setSize(null);
      running.current=false;
      onComplete?.(result);
    } catch(error) {
      await loading;
      if(!alive.current)return;
      setPhase('restoring');
      await pause(motion?300:0);
      if(!alive.current)return;
      setPhase('idle');setSize(null);running.current=false;
      onError?.(error);
    } finally {
      if(!alive.current)running.current=false;
    }
  }
  const label=phase==='success'?'已完成':pending?'正在提交':ariaLabel;
  return <span className="zy-mobile-submit-wrap" style={size?{width:size.width,height:size.height}:undefined}>
    <button ref={button} type="button" title={title} className={'zy-mobile-submit-button '+className} style={style}
      data-submit-phase={phase} disabled={disabled||pending} aria-busy={pending} aria-label={label}
      onClick={()=>void submit()}>
      <span className="zy-mobile-submit-label">{children}</span>
      {pending&&phase!=='restoring'&&<span className="zy-mobile-submit-indicator" aria-hidden="true">{phase==='success'
        ?<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-8.5"/></svg>
        :<span className="zy-mobile-submit-spinner"/>}</span>}
    </button>
  </span>;
}
