'use client';

import {useEffect} from 'react';

const candidates=[
  '.zy-conversation','.zy-contact-row','.zy-mobile-contact-row','.zy-mobile-group-row',
  '.zy-post','.tb-task-item','.tb-active-card','.zy-m-task-row','.zy-m-task-active',
  '.zy-tb-history-day','.zy-mobile-me-settings-group','.zy-settings-section',
].join(',');
const candidateClasses=new Set(candidates.split(',').map(selector=>selector.slice(1)));
const panels='.zy-app,.zy-dialog,dialog.zy-settings-dialog';
const excluded='.xx-thread,.zy-thread,.zy-group-thread,.zy-mobile-call,.zy-realtime-call,.zy-auth-stage,[data-scroll-reveal="off"]';
type ScrollState={top:number;userUntil:number;downUntil:number};
type TargetState={root:HTMLElement;key:string;measured:boolean};

/** Enhancement only: existing DOM and its default visibility remain untouched.
 * Mount within AuthGate so logging out clears this account's in-memory history. */
export default function ScrollReveal() {
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'||typeof MutationObserver==='undefined')return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const roots=new Map<HTMLElement,ScrollState>();
    const targets=new Map<HTMLElement,TargetState>();
    const seen=new Set<string>();
    const animations=new Map<HTMLElement,Animation>();
    const additions=new Set<Element>();
    let cleanupNeeded=false;
    let frame=0;
    let touch:{root:HTMLElement;y:number}|null=null;
    const documentRoot=()=>document.scrollingElement instanceof HTMLElement?document.scrollingElement:document.documentElement;
    const rootFor=(node:Element|null,cache?:WeakMap<Element,HTMLElement>):HTMLElement=>{
      const path:Element[]=[];
      const remember=(root:HTMLElement)=>{if(cache)for(const node of path)cache.set(node,root);return root;};
      for(let parent=node;parent&&parent!==document.body;parent=parent.parentElement){
        const known=cache?.get(parent);if(known)return remember(known);
        path.push(parent);
        if(parent instanceof HTMLElement&&/(?:auto|scroll)/.test(getComputedStyle(parent).overflowY))return remember(parent);
      }
      return remember(documentRoot());
    };
    const stateFor=(root:HTMLElement)=>{
      let state=roots.get(root);
      if(!state){state={top:root.scrollTop,userUntil:0,downUntil:0};roots.set(root,state);}
      return state;
    };
    const disarm=()=>{for(const state of roots.values()){state.userUntil=0;state.downUntil=0;}};
    const arm=(root:HTMLElement)=>{stateFor(root).userUntil=performance.now()+900;};
    const editable=(node:Element|null)=>!!node?.closest('input,textarea,select,[contenteditable="true"]');
    const forgetAnimation=(node:HTMLElement,animation:Animation)=>{
      if(animations.get(node)!==animation)return;
      animations.delete(node);
      delete node.dataset.zyScrollReveal;
    };
    const markSeen=(node:HTMLElement,state:TargetState)=>{
      seen.add(state.key);
      observer.unobserve(node);
      targets.delete(node);
    };
    const observer=new IntersectionObserver(entries=>{
      const now=performance.now();
      for(const entry of entries){
        const node=entry.target;
        if(!(node instanceof HTMLElement))continue;
        const state=targets.get(node);
        if(!state)continue;
        const first=!state.measured;
        state.measured=true;
        if(!entry.isIntersecting)continue;
        const rootState=stateFor(state.root);
        const reveal=!first&&!seen.has(state.key)&&!media.matches&&rootState.downUntil>=now&&rootState.userUntil>=now;
        markSeen(node,state);
        if(!reveal||typeof node.animate!=='function')continue;
        const style=getComputedStyle(node);
        const opacity=Number(style.opacity)||1;
        const animation=node.animate([
          {opacity:opacity*.18,translate:'0 14px'},
          {opacity,translate:style.translate==='none'?'0 0':style.translate},
        ],{duration:380,easing:'cubic-bezier(.22,.8,.25,1)',fill:'none'});
        animations.set(node,animation);
        node.dataset.zyScrollReveal='active';
        animation.onfinish=()=>forgetAnimation(node,animation);
        animation.oncancel=()=>forgetAnimation(node,animation);
      }
    },{threshold:0});
    const keyFor=(node:HTMLElement)=>{
      const main=node.closest('main.zy-app');
      const page=main?[...main.classList].find(name=>name.startsWith('zy-page-'))||'main':node.closest('dialog')?.className||'dialog';
      const kind=[...node.classList].find(name=>candidateClasses.has(name))||node.tagName;
      const identity=node.id||node.dataset.taskId||node.dataset.activeTaskId||node.dataset.historyDate||node.querySelector('strong,h2,.tb-task-name,.zy-m-task-name')?.textContent?.trim()||node.getAttribute('aria-label')||'';
      return [location.pathname,page,kind,identity].join(':');
    };
    const add=(node:Element,rootCache:WeakMap<Element,HTMLElement>)=>{
      if(!(node instanceof HTMLElement)||targets.has(node)||!node.closest(panels)||node.closest(excluded))return;
      // Reveal an outer card once, instead of animating all its nested rows.
      if(node.parentElement?.closest(candidates))return;
      const key=keyFor(node);
      if(seen.has(key))return;
      const root=rootFor(node.parentElement,rootCache);
      stateFor(root);
      targets.set(node,{root,key,measured:false});
      observer.observe(node);
    };
    const scan=(tree:Element,rootCache:WeakMap<Element,HTMLElement>)=>{
      if(tree.matches(candidates))add(tree,rootCache);
      for(const node of tree.querySelectorAll(candidates))add(node,rootCache);
    };
    const flush=()=>{
      frame=0;
      // This cache lasts only one discovery batch, so responsive overflow or
      // a later reparenting cannot retain a stale scroll-root measurement.
      const rootCache=new WeakMap<Element,HTMLElement>();
      for(const node of additions){
        if(!node.isConnected)continue;
        let covered=false;
        for(let parent=node.parentElement;parent;parent=parent.parentElement)if(additions.has(parent)){covered=true;break;}
        if(!covered)scan(node,rootCache);
      }
      additions.clear();
      if(cleanupNeeded){
        cleanupNeeded=false;
        for(const [node] of targets)if(!node.isConnected){observer.unobserve(node);targets.delete(node);}
        for(const [node,animation] of animations)if(!node.isConnected){animation.cancel();forgetAnimation(node,animation);}
        for(const [root] of roots)if(!root.isConnected)roots.delete(root);
      }
    };
    const mutations=new MutationObserver(records=>{
      for(const record of records){
        const parent=record.target instanceof Element?record.target:null;
        if(parent?.closest(excluded))continue;
        for(const node of record.addedNodes){
          if(!(node instanceof Element)||node.closest(excluded))continue;
          if(node.closest(panels)||node.querySelector(panels))additions.add(node);
        }
        for(const node of record.removedNodes)if(node instanceof Element&&(parent?.closest(panels)||node.matches(panels)||node.querySelector(panels)))cleanupNeeded=true;
      }
      // Text/status replacements and excluded chat streams do not discover
      // Reveal cards. In particular, they must not sweep every pending card.
      if(!frame&&(additions.size||cleanupNeeded))frame=requestAnimationFrame(flush);
    });
    const scroll=(event:Event)=>{
      const root=event.target instanceof HTMLElement?event.target:documentRoot();
      const state=roots.get(root);
      if(!state)return;
      const top=root.scrollTop,now=performance.now();
      if(top>state.top+.5)state.downUntil=state.userUntil>=now?now+200:0;
      else if(top<state.top-.5)state.downUntil=0;
      state.top=top;
    };
    const wheel=(event:WheelEvent)=>{
      if(!event.isTrusted||event.ctrlKey)return;
      const node=event.target instanceof Element?event.target:null;
      if(event.deltaY>0&&!editable(node)&&node?.closest(panels))arm(rootFor(node));
    };
    const touchstart=(event:TouchEvent)=>{
      if(!event.isTrusted)return;
      const node=event.target instanceof Element?event.target:null;
      disarm();
      touch=node?.closest(panels)&&!editable(node)&&event.touches.length===1?{root:rootFor(node),y:event.touches[0].clientY}:null;
    };
    const touchmove=(event:TouchEvent)=>{
      if(!event.isTrusted||!touch||event.touches.length!==1)return;
      const y=event.touches[0].clientY;
      if(y<touch.y-1)arm(touch.root);
      else if(y>touch.y+1)stateFor(touch.root).downUntil=0;
      touch.y=y;
    };
    const pointerdown=(event:PointerEvent)=>{
      if(!event.isTrusted)return;
      disarm();
      const node=event.target instanceof Element?event.target:null;
      if(event.pointerType!=='mouse'||!node?.closest(panels))return;
      const root=rootFor(node),rect=root.getBoundingClientRect();
      if(root.scrollHeight>root.clientHeight&&event.clientX>=rect.right-18)arm(root);
    };
    const keydown=(event:KeyboardEvent)=>{
      if(!event.isTrusted)return;
      const node=event.target instanceof Element?event.target:null;
      if(editable(node))return;
      disarm();
      if(!event.shiftKey&&['ArrowDown','PageDown','End',' '].includes(event.key)&&node?.closest(panels))arm(rootFor(node));
    };
    const reduce=()=>{if(media.matches){disarm();for(const [node,animation] of animations){animation.cancel();forgetAnimation(node,animation);}}};
    scan(document.body,new WeakMap<Element,HTMLElement>());
    mutations.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('scroll',scroll,true);
    document.addEventListener('wheel',wheel,{capture:true,passive:true});
    document.addEventListener('touchstart',touchstart,{capture:true,passive:true});
    document.addEventListener('touchmove',touchmove,{capture:true,passive:true});
    document.addEventListener('pointerdown',pointerdown,true);
    document.addEventListener('keydown',keydown,true);
    window.addEventListener('popstate',disarm);
    document.addEventListener('visibilitychange',disarm);
    media.addEventListener('change',reduce);
    return()=>{
      observer.disconnect();mutations.disconnect();
      if(frame)cancelAnimationFrame(frame);
      for(const [node,animation] of animations){animation.cancel();forgetAnimation(node,animation);}
      document.removeEventListener('scroll',scroll,true);
      document.removeEventListener('wheel',wheel,true);
      document.removeEventListener('touchstart',touchstart,true);
      document.removeEventListener('touchmove',touchmove,true);
      document.removeEventListener('pointerdown',pointerdown,true);
      document.removeEventListener('keydown',keydown,true);
      window.removeEventListener('popstate',disarm);
      document.removeEventListener('visibilitychange',disarm);
      media.removeEventListener('change',reduce);
    };
  },[]);
  return null;
}
