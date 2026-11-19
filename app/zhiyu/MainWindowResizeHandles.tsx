'use client';

import {useEffect,useRef,useSyncExternalStore,type PointerEvent} from 'react';
import type {MainWindowResizeEdge} from './desktop-bridge';
import './MainWindowResizeHandles.css';

const edges:MainWindowResizeEdge[]=['n','s','e','w','ne','nw','se','sw'];
let nextGesture=0;
const subscribe=()=>()=>{};
const serverAvailability=()=>false;
function clientAvailability(){const bridge=typeof window==='undefined'?undefined:window.zhiyuDesktop;return !!bridge?.beginMainWindowResize&&!!bridge.updateMainWindowResize&&!!bridge.finishMainWindowResize&&!bridge.mobilePreview;}
function finishLease(gesture:number){void window.zhiyuDesktop?.finishMainWindowResize?.(gesture).catch(()=>{});}

/** Invisible native-window hit areas, kept outside the painted panels. They
 * resize the existing BrowserWindow, never a second DOM-sized application. */
export default function MainWindowResizeHandles(){
  const available=useSyncExternalStore(subscribe,clientAvailability,serverAvailability),pointer=useRef<{pointerId:number;gesture:number}|null>(null),frame=useRef(0);
  const finish=()=>{const active=pointer.current;pointer.current=null;cancelAnimationFrame(frame.current);frame.current=0;if(active)finishLease(active.gesture);};
  useEffect(()=>{
    const bridge=window.zhiyuDesktop;
    return()=>{const active=pointer.current;pointer.current=null;cancelAnimationFrame(frame.current);if(active)void bridge?.finishMainWindowResize?.(active.gesture).catch(()=>{});};
  },[]);
  function begin(event:PointerEvent<HTMLSpanElement>,edge:MainWindowResizeEdge){
    if(event.button!==0||event.isPrimary===false)return;
    if(pointer.current)finish();
    event.preventDefault();event.stopPropagation();const gesture=++nextGesture;pointer.current={pointerId:event.pointerId,gesture};event.currentTarget.setPointerCapture(event.pointerId);
    void window.zhiyuDesktop?.beginMainWindowResize?.(edge,gesture).then(ok=>{if(pointer.current?.gesture!==gesture){if(ok)finishLease(gesture);}else if(!ok)finish();}).catch(()=>{if(pointer.current?.gesture===gesture)finish();else finishLease(gesture);});
  }
  function update(event:PointerEvent<HTMLSpanElement>){
    if(pointer.current?.pointerId!==event.pointerId||frame.current)return;
    const gesture=pointer.current.gesture;
    frame.current=requestAnimationFrame(()=>{frame.current=0;if(pointer.current?.gesture===gesture)void window.zhiyuDesktop?.updateMainWindowResize?.(gesture).then(ok=>{if(!ok&&pointer.current?.gesture===gesture)finish();}).catch(()=>{if(pointer.current?.gesture===gesture)finish();});});
  }
  if(!available)return null;
  return <div className="zy-native-window-resize" aria-hidden="true">
    {edges.map(edge=><span key={edge} className={'zy-native-window-resize-edge '+edge} data-edge={edge} onPointerDown={event=>begin(event,edge)} onPointerMove={update} onPointerUp={event=>{if(pointer.current?.pointerId===event.pointerId){finish();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}} onPointerCancel={event=>{if(pointer.current?.pointerId===event.pointerId)finish();}} onLostPointerCapture={event=>{if(pointer.current?.pointerId===event.pointerId)finish();}}/>)}
  </div>;
}
