'use client';
/* eslint-disable next/no-img-element */
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {CalendarCheck,Compass,MessageSquare,Users} from 'lucide-react';
import type {Page,Person} from './data';
import {bounceMobileIcon} from './mobile-effects';

const keys:Page[]=['chat','contacts','tasks','moments','me'];
const labels=['消息','通讯录','安排','动态','我'];
export default function MobileNavigation({page,self,unread,tasks,moments,hidden,onNavigate}:{page:Page;self:Person;unread:number;tasks:boolean;moments:boolean;hidden:boolean;onNavigate:(page:Page)=>void}) {
 const [scrollState,setScrollState]=useState({page,hidden,collapsed:false}),[flow,setFlow]=useState<{from:number;to:number;key:number}|null>(null);
 if(scrollState.page!==page||scrollState.hidden!==hidden)setScrollState({page,hidden,collapsed:false});
 const collapsed=scrollState.page===page&&scrollState.hidden===hidden&&scrollState.collapsed;
 const nav=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(hidden)return;
  const root=nav.current?.closest('main.zy-mobile');
  if(!root)return;
  let collapsedNow=false;
  const setCollapsed=(value:boolean)=>{if(collapsedNow===value)return;collapsedNow=value;setScrollState({page,hidden,collapsed:value});};
  const last=new WeakMap<HTMLElement,number>(),intents=new WeakMap<HTMLElement,{at:number;direction:number}>();
  type ScrollerCache={node:HTMLElement;until:number};
  let cache=new WeakMap<HTMLElement,ScrollerCache>();
  let touch:{target:EventTarget|null;y:number}|null=null,rebound:ReturnType<typeof setTimeout>|null=null,inputFrame=0,pending:{target:EventTarget|null;direction:number}|null=null;
  let gesture:{node:HTMLElement|null;at:number;direction:number;startTop:number}|null=null;
  const clearRebound=()=>{if(rebound)clearTimeout(rebound);rebound=null;};
  const eligible=(target:EventTarget|null)=>target instanceof Element&&root.contains(target)&&!target.closest('.zy-mobile-nav,.zy-m-composer,input,textarea,select,[contenteditable="true"],dialog:not(.zy-mobile-detail-page)');
  const scroller=(target:EventTarget|null)=>{
   if(!eligible(target)||!(target instanceof Element))return null;
   const now=performance.now(),path:HTMLElement[]=[];
   let node:HTMLElement|null=target instanceof HTMLElement?target:target.parentElement;
   while(node&&node!==root){
    const known=cache.get(node);
    if(known&&known.until>now&&known.node.isConnected&&root.contains(known.node)){for(const ancestor of path)cache.set(ancestor,known);return known.node;}
    path.push(node);
    // Most event targets are text, icons or rows. Only a genuine overflow
    // candidate needs scroll geometry; cache its ancestry for this gesture.
    if(/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1){const entry={node,until:now+200};for(const ancestor of path)cache.set(ancestor,entry);return node;}
    node=node.parentElement;
   }
   return null;
  };
  const intend=(target:EventTarget|null,direction=0)=>{
   if(!eligible(target))return;
   const node=scroller(target),now=performance.now(),top=node?.scrollTop??0;if(node){if(!last.has(node))last.set(node,top);intents.set(node,{at:now,direction});}
   if(!gesture||gesture.node!==node||gesture.direction!==direction||now-gesture.at>200)gesture={node,at:now,direction,startTop:top};else gesture.at=now;
   clearRebound();
   if(direction<0){setCollapsed(false);return;}
   if(direction===0)return;
   setCollapsed(true);
   // Even a short page acknowledges the swipe. When there is nowhere to
   // scroll (or the edge springs back), restore the capsule after the gesture.
   const active=gesture;
   rebound=setTimeout(()=>{rebound=null;if(gesture!==active)return;if(!node){setCollapsed(false);return;}const current=node.scrollTop;if(current>=node.scrollHeight-node.clientHeight-2||Math.abs(current-active.startTop)<2)setCollapsed(false);},480);
  };
  const queueIntent=(target:EventTarget|null,direction=0)=>{if(!eligible(target))return;pending={target,direction};if(inputFrame)return;inputFrame=requestAnimationFrame(()=>{inputFrame=0;const next=pending;pending=null;if(next)intend(next.target,next.direction);});};
  const wheel=(e:WheelEvent)=>{if(!e.isTrusted||e.ctrlKey||Math.abs(e.deltaY)<3||Math.abs(e.deltaY)<Math.abs(e.deltaX))return;queueIntent(e.target,Math.sign(e.deltaY));};
  const touchStart=(e:TouchEvent)=>{touch=e.touches.length===1&&eligible(e.target)?{target:e.target,y:e.touches[0].clientY}:null;};
  const touchMove=(e:TouchEvent)=>{if(e.touches.length!==1){touch=null;return;}if(!e.isTrusted||!touch)return;const y=e.touches[0].clientY;if(Math.abs(y-touch.y)>2){queueIntent(touch.target,Math.sign(touch.y-y));touch.y=y;}};
  const pointer=(e:PointerEvent)=>{if(!e.isTrusted||e.pointerType==='touch')return;const node=scroller(e.target);if(!node)return;const box=node.getBoundingClientRect();if(e.clientX>=box.right-16)queueIntent(node);};
  const key=(e:KeyboardEvent)=>{if(!e.isTrusted||!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)||(e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable="true"],button')))return;const node=scroller(e.target);if(node)queueIntent(node,['ArrowUp','PageUp','Home'].includes(e.key)||e.key===' '&&e.shiftKey?-1:1);};
  const scroll=(e:Event)=>{
   const node=e.target;if(!(node instanceof HTMLElement)||!root.contains(node)||!eligible(node))return;
   const before=last.get(node),intent=intents.get(node),top=node.scrollTop;last.set(node,top);
   // Browser restoration, focus, message autoscroll and layout changes are not swipes.
   if(!intent||performance.now()-intent.at>1200)return;
   const delta=before===undefined?0:top-before;
   // Compositor scrolling can already be applied before a passive wheel is
   // delivered. Its genuine input direction still identifies this gesture.
   if(delta<-2||intent.direction<0)setCollapsed(false);else if(delta>2&&intent.direction>0)setCollapsed(true);
  };
  document.addEventListener('wheel',wheel,{capture:true,passive:true});
  document.addEventListener('touchstart',touchStart,{capture:true,passive:true});
  document.addEventListener('touchmove',touchMove,{capture:true,passive:true});
  document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);document.addEventListener('scroll',scroll,true);
  const resize=()=>{cache=new WeakMap();};window.addEventListener('resize',resize);
  return()=>{clearRebound();if(inputFrame)cancelAnimationFrame(inputFrame);window.removeEventListener('resize',resize);document.removeEventListener('wheel',wheel,true);document.removeEventListener('touchstart',touchStart,true);document.removeEventListener('touchmove',touchMove,true);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);document.removeEventListener('scroll',scroll,true);};
 },[page,hidden]);
 useEffect(()=>{if(!flow)return;const timer=setTimeout(()=>setFlow(null),400);return()=>clearTimeout(timer);},[flow]);
 if(hidden)return null;
 const select=(next:Page)=>{const element=nav.current;if(element&&next!==page){const buttons=element.querySelectorAll<HTMLButtonElement>('button'),box=element.getBoundingClientRect(),a=buttons[keys.indexOf(page)]?.getBoundingClientRect(),b=buttons[keys.indexOf(next)]?.getBoundingClientRect();if(a&&b)setFlow({from:a.x+a.width/2-box.x-15,to:b.x+b.width/2-box.x-15,key:(flow?.key||0)+1});}onNavigate(next);};
 return <nav ref={nav} className={'zy-mobile-nav'+(collapsed?' is-collapsed':'')} aria-label="主导航">
  {flow&&<i key={flow.key} className="zy-mobile-nav-flow" aria-hidden="true" style={{'--zy-m-nav-from':flow.from+'px','--zy-m-nav-to':flow.to+'px'} as CSSProperties}/>}
  <div className="zy-mobile-nav-items">{keys.map((key,i)=>{const active=key===page,notice=key==='chat'&&unread>0?`${unread}条未读消息`:key==='tasks'&&tasks?'有正在进行的安排':key==='moments'&&moments?'有新动态':'';const Icon=[MessageSquare,Users,CalendarCheck,Compass][i];return <button type="button" key={key} data-nav-key={key} className={active?'is-active':''} aria-label={labels[i]+(notice?'，'+notice:'')} aria-current={active?'page':undefined} onClick={event=>{bounceMobileIcon(event.currentTarget);select(key);}}>
   {key==='me'?<span className="zy-mobile-nav-avatar" data-mobile-bounce-icon>{self.avatar?<img src={self.avatar} alt=""/>:<span>{(self.nickname||self.name).slice(0,1)}</span>}</span>:<Icon size={24} strokeWidth={1.8} fill={active?'currentColor':'none'}/>}
   {key==='chat'&&unread>0&&<span key={unread} className="zy-mobile-nav-unread">{unread>99?'99+':unread}</span>}
   {(key==='tasks'&&tasks||key==='moments'&&moments)&&<i className="zy-mobile-nav-dot"/>}
  </button>;})}</div>
 </nav>;
}
