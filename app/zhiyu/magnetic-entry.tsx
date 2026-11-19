'use client';

import {useEffect} from 'react';
import {advanceSpring,type SpringState} from './spring-motion';
import './magnetic-entry.css';

type Target={x:SpringState;y:SpringState;originalX:string;originalY:string};
const SELECTOR='button[data-zy-magnetic-entry]';
const RADIUS=60,MAX_SHIFT=3;

/** Decorative pointer response only: native button, keyboard and form events
 * continue through the original auth controls without interception. */
export default function MagneticEntry() {
 useEffect(()=>{
  const pointerMode=matchMedia('(hover: hover) and (pointer: fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const targets=new Map<HTMLButtonElement,Target>();
  let pointer:{x:number;y:number}|null=null,frame=0,previous=0,pressed=false;
  const allowed=()=>pointerMode.matches&&!reduced.matches;
  const restore=(node:HTMLButtonElement,state:Target)=>{node.style.setProperty('--zy-entry-magnet-x',state.originalX);node.style.setProperty('--zy-entry-magnet-y',state.originalY);node.removeAttribute('data-zy-magnetic-active');};
  const reset=()=>{
   pointer=null;pressed=false;if(frame)cancelAnimationFrame(frame);frame=0;previous=0;
   for(const [node,state]of targets)restore(node,state);targets.clear();
  };
  const schedule=()=>{if(!frame&&allowed())frame=requestAnimationFrame(tick);};
  const tick=(at:number)=>{
   frame=0;const dt=previous?Math.min(.05,(at-previous)/1000):1/60;previous=at;
   if(!allowed()){reset();return;}
   for(const node of document.querySelectorAll<HTMLButtonElement>(SELECTOR))if(!targets.has(node))targets.set(node,{x:{position:0,velocity:0},y:{position:0,velocity:0},originalX:node.style.getPropertyValue('--zy-entry-magnet-x'),originalY:node.style.getPropertyValue('--zy-entry-magnet-y')});
   let moving=false;
   for(const [node,state]of targets){
    if(!node.isConnected||!node.matches(SELECTOR)){restore(node,state);targets.delete(node);continue;}
    let x=0,y=0;
    if(pointer&&!pressed&&!node.disabled&&node.getAttribute('aria-busy')!=='true'){
     const box=node.getBoundingClientRect(),left=box.left-state.x.position,top=box.top-state.y.position;
     const edgeX=Math.max(left-pointer.x,0,pointer.x-(left+box.width)),edgeY=Math.max(top-pointer.y,0,pointer.y-(top+box.height)),gap=Math.hypot(edgeX,edgeY);
     if(box.width&&box.height&&gap<RADIUS){
      const dx=pointer.x-(left+box.width/2),dy=pointer.y-(top+box.height/2),length=Math.hypot(dx,dy),near=1-gap/RADIUS;
      const strength=MAX_SHIFT*near*near*(3-2*near)*Math.min(1,length/90);
      if(length){x=dx/length*strength;y=dy/length*strength;}
     }
    }
    state.x=advanceSpring(state.x,x,dt,{stiffness:360,damping:28});state.y=advanceSpring(state.y,y,dt,{stiffness:360,damping:28});
    const length=Math.hypot(state.x.position,state.y.position);
    if(length>MAX_SHIFT){state.x.position*=MAX_SHIFT/length;state.y.position*=MAX_SHIFT/length;}
    const settled=Math.abs(state.x.position-x)<.01&&Math.abs(state.y.position-y)<.01&&Math.abs(state.x.velocity)<.08&&Math.abs(state.y.velocity)<.08;
    if(settled){state.x={position:x,velocity:0};state.y={position:y,velocity:0};}
    else moving=true;
    if(!x&&!y&&settled){restore(node,state);continue;}
    node.dataset.zyMagneticActive='true';
    node.style.setProperty('--zy-entry-magnet-x',state.x.position.toFixed(3)+'px');node.style.setProperty('--zy-entry-magnet-y',state.y.position.toFixed(3)+'px');
   }
   if(moving)frame=requestAnimationFrame(tick);else previous=0;
  };
  const move=(event:PointerEvent)=>{if(event.pointerType!=='mouse'||!allowed()){if(targets.size)reset();return;}pointer={x:event.clientX,y:event.clientY};pressed=event.buttons!==0;schedule();};
  const down=(event:PointerEvent)=>{if(event.pointerType!=='mouse'){reset();return;}pressed=true;schedule();};
  const up=(event:PointerEvent)=>{if(event.pointerType!=='mouse')return;pressed=false;pointer={x:event.clientX,y:event.clientY};schedule();};
  const leave=(event:PointerEvent)=>{if(event.relatedTarget!==null)return;pointer=null;pressed=false;schedule();};
  const blur=()=>{pointer=null;pressed=false;schedule();};
  const visibility=()=>{if(document.hidden)reset();};
  const preference=()=>{reset();};
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerdown',down,{passive:true});document.addEventListener('pointerup',up,{passive:true});document.addEventListener('pointerout',leave,{passive:true});document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);pointerMode.addEventListener('change',preference);reduced.addEventListener('change',preference);
  return()=>{reset();document.removeEventListener('pointermove',move);document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);document.removeEventListener('pointerout',leave);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);pointerMode.removeEventListener('change',preference);reduced.removeEventListener('change',preference);};
 },[]);
 return null;
}
