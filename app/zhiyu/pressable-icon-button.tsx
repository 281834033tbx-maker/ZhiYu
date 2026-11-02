'use client';

import {useEffect, useImperativeHandle, useRef, useState, type ComponentPropsWithRef, type CSSProperties} from 'react';
import './chat-icon-controls.css';
import './pressable-icon-button.css';

type Press = {kind:'pointer'; pointerId:number} | {kind:'keyboard'; key:'Enter'|' '};
type PressState = 'idle'|'pressed'|'release';
type PressableIconButtonProps = ComponentPropsWithRef<'button'> & {rotateOnClick?:boolean};

/** Native button semantics remain intact; this only supplies a short pressure response. */
export default function PressableIconButton({
  ref, className, style, disabled, rotateOnClick=false, onPointerDown, onPointerUp, onPointerLeave,
  onPointerCancel, onLostPointerCapture, onKeyDown, onKeyUp, onBlur,
  onClick, onAnimationEnd, ...props
}:PressableIconButtonProps) {
  const button=useRef<HTMLButtonElement>(null);
  const press=useRef<Press|null>(null);
  const listeners=useRef<(()=>void)|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const alive=useRef(true);
  const [state,setState]=useState<PressState>('idle');
  const [quarterTurns,setQuarterTurns]=useState(0);
  useImperativeHandle(ref,()=>button.current!,[]);

  function cleanup() {
    listeners.current?.();listeners.current=null;
    if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}
  }

  function release() {
    if(!press.current)return;
    press.current=null;cleanup();
    if(!alive.current)return;
    setState('release');
    timer.current=setTimeout(()=>{
      timer.current=null;
      if(alive.current&&!press.current)setState('idle');
    },360);
  }

  function begin(next:Press) {
    if(disabled||press.current||!button.current)return;
    cleanup();press.current=next;setState('pressed');
    const node=button.current;
    const document=node.ownerDocument;
    const window=document.defaultView;
    const pointerRelease=(event:PointerEvent)=>{
      if(press.current?.kind==='pointer'&&press.current.pointerId===event.pointerId)release();
    };
    const pointerMove=(event:PointerEvent)=>{
      if(press.current?.kind!=='pointer'||press.current.pointerId!==event.pointerId)return;
      const bounds=node.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)release();
    };
    const keyRelease=(event:KeyboardEvent)=>{
      if(press.current?.kind==='keyboard'&&(event.key===press.current.key||event.key==='Escape'))release();
    };
    const visibility=()=>{if(document.hidden)release();};
    document.addEventListener('pointerup',pointerRelease,true);
    document.addEventListener('pointercancel',pointerRelease,true);
    document.addEventListener('pointermove',pointerMove,true);
    document.addEventListener('keyup',keyRelease,true);
    document.addEventListener('visibilitychange',visibility);
    window?.addEventListener('blur',release);
    listeners.current=()=>{
      document.removeEventListener('pointerup',pointerRelease,true);
      document.removeEventListener('pointercancel',pointerRelease,true);
      document.removeEventListener('pointermove',pointerMove,true);
      document.removeEventListener('keyup',keyRelease,true);
      document.removeEventListener('visibilitychange',visibility);
      window?.removeEventListener('blur',release);
    };
  }

  useEffect(()=>{
    alive.current=true;
    return()=>{alive.current=false;press.current=null;cleanup();};
  },[]);
  useEffect(()=>{
    // Sending can disable the button on click; let its release finish naturally.
    if(disabled&&press.current)release();
  },[disabled]);

  return <button {...props} ref={button} disabled={disabled}
    className={['zy-pressable-icon',className].filter(Boolean).join(' ')} data-icon-press={state}
    data-icon-rotate={rotateOnClick?'true':undefined}
    style={rotateOnClick?{...style,'--zy-icon-click-rotation':`${quarterTurns*-90}deg`} as CSSProperties:style}
    onPointerDown={event=>{
      onPointerDown?.(event);
      if(!event.defaultPrevented&&event.button===0&&event.isPrimary)begin({kind:'pointer',pointerId:event.pointerId});
    }}
    onPointerUp={event=>{onPointerUp?.(event);if(press.current?.kind==='pointer'&&press.current.pointerId===event.pointerId)release();}}
    onPointerLeave={event=>{onPointerLeave?.(event);if(press.current?.kind==='pointer'&&press.current.pointerId===event.pointerId)release();}}
    onPointerCancel={event=>{onPointerCancel?.(event);if(press.current?.kind==='pointer'&&press.current.pointerId===event.pointerId)release();}}
    onLostPointerCapture={event=>{onLostPointerCapture?.(event);if(press.current?.kind==='pointer'&&press.current.pointerId===event.pointerId)release();}}
    onKeyDown={event=>{
      onKeyDown?.(event);
      if(!event.defaultPrevented&&!event.repeat&&(event.key==='Enter'||event.key===' '))begin({kind:'keyboard',key:event.key});
    }}
    onKeyUp={event=>{onKeyUp?.(event);if(press.current?.kind==='keyboard'&&event.key===press.current.key)release();}}
    onBlur={event=>{release();onBlur?.(event);}}
    onClick={event=>{
      // Enter fires its native click on keydown; a dialog may then move focus before keyup.
      if(press.current?.kind==='keyboard'&&press.current.key==='Enter')release();
      onClick?.(event);
      if(rotateOnClick&&!disabled&&!event.defaultPrevented&&alive.current)setQuarterTurns(turns=>turns+1);
    }}
    onAnimationEnd={event=>{
      if(event.target instanceof SVGElement&&event.target.parentElement===event.currentTarget&&event.animationName==='zy-icon-pressure-release'&&!press.current){
        cleanup();setState('idle');
      }
      onAnimationEnd?.(event);
    }}/>
}
