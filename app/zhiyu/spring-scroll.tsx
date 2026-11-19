'use client';

import {useEffect} from 'react';
import {criticalScrollStep} from './scroll-spring';
import './spring-scroll.css';

type Motion={node:HTMLElement;position:number;velocity:number;target:number;written:number;at:number;previousTranslate:string;previousBehavior:string};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const scope='.zy-app,.zy-auth-stage,.zy-dialog,.zy-mobile-detail-page,.image-viewer,.viewer-forward,.zy-task-history,.zy-task-history-details,.zy-realtime-page';
const editing='input,textarea,select,button,[contenteditable="true"]';

/** Wheel and touch already contain platform inertia. Passive listeners only
 * cancel a keyboard spring; replaying their deltas adds a second scroll engine.
 * Non-editing keyboard navigation retains the critically damped spring. */
export default function SpringScroll() {
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)'),motions=new Map<HTMLElement,Motion>();
  let frame=0;
  const maximum=(node:HTMLElement)=>Math.max(0,node.scrollHeight-node.clientHeight);
  const restore=(motion:Motion)=>{
   motion.node.classList.remove('zy-spring-scrolling');
   motion.node.style.removeProperty('--zy-scroll-edge-offset');
   if(motion.previousTranslate)motion.node.style.translate=motion.previousTranslate;
   else motion.node.style.removeProperty('translate');
   if(motion.previousBehavior)motion.node.style.scrollBehavior=motion.previousBehavior;
   else motion.node.style.removeProperty('scroll-behavior');
   motions.delete(motion.node);
  };
  const cancelFrame=()=>{if(!motions.size&&frame){cancelAnimationFrame(frame);frame=0;}};
  const cancelRelated=(target:EventTarget|null)=>{
   if(!motions.size||!(target instanceof Element))return;
   for(const motion of motions.values())if(motion.node.contains(target))restore(motion);
   cancelFrame();
  };
  const find=(target:EventTarget|null)=>{
   if(!(target instanceof Element)||!target.closest(scope))return null;
   let node:HTMLElement|null=target instanceof HTMLElement?target:target.parentElement;
   while(node&&node!==document.body){
    if(/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)&&maximum(node)>1)return node;
    node=node.parentElement;
   }
   return null;
  };
  const state=(node:HTMLElement)=>{
   let motion=motions.get(node);
   if(motion&&Math.abs(node.scrollTop-motion.written)>2){restore(motion);motion=undefined;}
   if(!motion){const position=node.scrollTop;motion={node,position,velocity:0,target:position,written:position,at:performance.now(),previousTranslate:node.style.translate,previousBehavior:node.style.scrollBehavior};motions.set(node,motion);node.style.scrollBehavior='auto';}
   return motion;
  };
  const paint=(motion:Motion,max:number)=>{
   const position=clamp(motion.position,0,max);
   motion.node.scrollTop=position;motion.written=position;
   const edge=clamp((position-motion.position)*.36,-10,10);
   if(Math.abs(edge)>.04){motion.node.classList.add('zy-spring-scrolling');motion.node.style.setProperty('--zy-scroll-edge-offset',edge.toFixed(3)+'px');motion.node.style.translate='0 var(--zy-scroll-edge-offset)';}
   else{motion.node.classList.remove('zy-spring-scrolling');motion.node.style.removeProperty('--zy-scroll-edge-offset');if(motion.previousTranslate)motion.node.style.translate=motion.previousTranslate;else motion.node.style.removeProperty('translate');}
  };
  const tick=(now:number)=>{
   frame=0;
   for(const motion of motions.values()){
    if(!motion.node.isConnected||media.matches){restore(motion);continue;}
    // Restoration, chat autoscroll, scrollbar dragging and focus own their scroll.
    if(Math.abs(motion.node.scrollTop-motion.written)>2){restore(motion);continue;}
    const max=maximum(motion.node);
    motion.target=clamp(motion.target,0,max);
    const next=criticalScrollStep(motion.position,motion.velocity,motion.target,clamp((now-motion.at)/1000,0,.05));
    motion.position=next.position;motion.velocity=next.velocity;motion.at=now;paint(motion,max);
    if(Math.abs(motion.position-motion.target)<.15&&Math.abs(motion.velocity)<2){motion.node.scrollTop=motion.target;restore(motion);}
   }
   if(motions.size)frame=requestAnimationFrame(tick);
  };
  const wheel=(event:WheelEvent)=>{if(event.isTrusted)cancelRelated(event.target);};
  const touchStart=(event:TouchEvent)=>{if(event.isTrusted)cancelRelated(event.target);};
  const key=(event:KeyboardEvent)=>{
   if(media.matches||event.defaultPrevented||event.altKey||event.metaKey||event.ctrlKey||!event.isTrusted||event.target instanceof Element&&event.target.closest(editing))return;
   if(!['ArrowDown','ArrowUp','PageDown','PageUp',' ','Home','End'].includes(event.key))return;
   const node=find(event.target);if(!node||!event.cancelable)return;
   const motion=state(node),page=node.clientHeight*.85,max=maximum(node);
   const values:Record<string,number>={ArrowDown:42,ArrowUp:-42,PageDown:page,PageUp:-page,' ':event.shiftKey?-page:page};
   event.preventDefault();motion.target=event.key==='Home'?0:event.key==='End'?max:clamp(motion.target+values[event.key],0,max);
   // Repeated key input changes the target, not the integration clock/velocity.
   if(!frame)frame=requestAnimationFrame(tick);
  };
  const pointer=(event:PointerEvent)=>{if(event.isTrusted)cancelRelated(event.target);};
  const reset=()=>{for(const motion of motions.values())restore(motion);cancelFrame();};
  const hidden=()=>{if(document.hidden)reset();};
  document.addEventListener('wheel',wheel,{capture:true,passive:true});
  document.addEventListener('touchstart',touchStart,{capture:true,passive:true});
  document.addEventListener('touchcancel',reset,{capture:true,passive:true});
  document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',pointer,{capture:true,passive:true});
  document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',reset);window.addEventListener('resize',reset);media.addEventListener('change',reset);
  return()=>{reset();document.removeEventListener('wheel',wheel,true);document.removeEventListener('touchstart',touchStart,true);document.removeEventListener('touchcancel',reset,true);document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',reset);window.removeEventListener('resize',reset);media.removeEventListener('change',reset);};
 },[]);
 return null;
}
