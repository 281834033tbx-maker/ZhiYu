'use client';
/* eslint-disable next/no-img-element */
import {useRef,useState,type CSSProperties} from 'react';
import {Minimize2} from 'lucide-react';
import type {Person} from './data';
import RealtimeVoiceCall from './realtime-voice-call';
import XiaomanVideoScene from '../character-window/xiaoman-video-scene';
import {useAccount} from './auth-gate';
import {npcFetch} from './npc-fetch';

export default function MobileCallLayer({person,onClose}:{person:Person;onClose:()=>void}) {
 const {account}=useAccount();
 const [minimized,setMinimized]=useState(false),[position,setPosition]=useState<{x:number;y:number}|null>(null),[expansion,setExpansion]=useState(0);
 const root=useRef<HTMLDivElement>(null),drag=useRef<{id:number;x:number;y:number;left:number;top:number;distance:number}|null>(null);
 const authorize=async()=>{const response=await npcFetch('/api/auth/session',{cache:'no-store'});const session=await response.json() as {authenticated?:boolean;account?:{id?:string}};return response.ok&&session.authenticated===true&&session.account?.id===account.id;};
 const restore=()=>{setMinimized(false);setExpansion(value=>value+1);};
 return <><div ref={root} data-expansion={expansion} className={'zy-mobile-call'+(minimized?' is-minimized':'')} style={position?{'--zy-m-call-origin-x':position.x+29+'px','--zy-m-call-origin-y':position.y+29+'px'} as CSSProperties:undefined}>
  <div className="zy-mobile-call-scene">{person.id==='yuan-xiaoman'&&person.desktopImage?<XiaomanVideoScene fallback={person.desktopImage}/>:<img src={person.desktopImage||person.avatar} alt={person.name}/>}</div><div className="zy-mobile-call-shade"/>
  <header><button type="button" aria-label="缩小通话" onClick={()=>setMinimized(true)}><Minimize2 size={20}/></button><strong>{person.name}</strong></header>
  <RealtimeVoiceCall mobile name={person.name} character={person.id} gender={person.gender} authorize={authorize} available={person.id==='yuan-xiaoman'} onEnd={onClose}/>
 </div>{minimized&&<button type="button" className="zy-mobile-call-mini" aria-label={`恢复与${person.name}的通话`} style={position?{left:position.x,top:position.y,right:'auto'}:undefined}
  onPointerDown={event=>{const box=event.currentTarget.getBoundingClientRect(),parent=event.currentTarget.offsetParent?.getBoundingClientRect();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left-(parent?.left||0),top:box.top-(parent?.top||0),distance:0};event.currentTarget.setPointerCapture(event.pointerId);}}
  onPointerMove={event=>{const initial=drag.current;if(!initial||initial.id!==event.pointerId)return;const width=event.currentTarget.offsetParent?.clientWidth||426,height=event.currentTarget.offsetParent?.clientHeight||853,dx=event.clientX-initial.x,dy=event.clientY-initial.y;initial.distance=Math.max(initial.distance,Math.hypot(dx,dy));setPosition({x:Math.max(8,Math.min(width-66,initial.left+dx)),y:Math.max(8,Math.min(height-170,initial.top+dy))});}}
  onPointerUp={event=>{const initial=drag.current;drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(initial&&initial.distance<4)restore();}}
  onPointerCancel={()=>{drag.current=null;}} onClick={event=>{if(event.detail===0)restore();}}><i/><i/><i/>{person.avatar?<img src={person.avatar} alt=""/>:<span>{person.name.slice(0,1)}</span>}</button>}</>;
}
