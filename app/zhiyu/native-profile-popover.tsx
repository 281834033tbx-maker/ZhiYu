'use client';

import {useLayoutEffect,useRef,useState,type ReactNode,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {createAnchoredPopupMotion} from './anchored-popup-motion';
import type {ProfilePopoverAnchor,ProfilePopoverLayout} from './desktop-bridge';

type Surface={popup:Window;host:HTMLElement;id:string};
const anchorBox=(anchor:HTMLElement):ProfilePopoverAnchor=>{const r=anchor.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};

/** Use the existing React tree in a native child, not a second profile/account. */
export default function NativeProfilePopover({title,anchor,close,className,children,fallback}:{
  title:string;anchor:HTMLElement;close:()=>void;className:string;children:ReactNode;fallback:ReactNode;
}) {
  const [surface,setSurface]=useState<Surface|null>(null),[failed,setFailed]=useState(false);
  const card=useRef<HTMLDivElement>(null),natural=useRef<HTMLDivElement>(null),latestClose=useRef(close);
  const requestClose=useRef<()=>void>(()=>{}),layout=useRef<ProfilePopoverLayout|null>(null),unavailable=useRef(false),restoreFocus=useRef(false);
  useLayoutEffect(()=>{latestClose.current=close;});
  useLayoutEffect(()=>{
    if(failed)return;
    const bridge=window.zhiyuDesktop;unavailable.current=false;restoreFocus.current=false;
    let alive=true,popup:Window|null=null,id='',headObserver:MutationObserver|null=null;
    let removeClosed:(()=>void)|undefined,removeDismiss:(()=>void)|undefined;
    const fail=()=>{
      unavailable.current=true;
      if(id)void bridge?.closeProfilePopover?.(id);
      if(popup&&!popup.closed)popup.close();
      if(alive){setSurface(null);setFailed(true);}
    };
    const syncTheme=()=>{
      if(!popup||popup.closed)return;
      for(const name of ['data-zy-theme','data-zy-font-size','data-zy-native-material']){
        const value=document.documentElement.getAttribute(name);
        if(value===null)popup.document.documentElement.removeAttribute(name);else popup.document.documentElement.setAttribute(name,value);
      }
    };
    let themeObserver:MutationObserver|null=null;
    void (async()=>{
      try {
        const prepared=await bridge?.prepareProfilePopover?.({anchor:anchorBox(anchor),width:277.5});
        if(!prepared){if(alive)fail();return;}
        id=prepared.id;
        if(!alive){void bridge?.closeProfilePopover?.(id);return;}
        removeClosed=bridge?.onProfilePopoverClosed?.(closed=>{if(alive&&!unavailable.current&&closed===id)latestClose.current();});
        removeDismiss=bridge?.onProfilePopoverDismiss?.(closed=>{if(closed===id)requestClose.current();});
        popup=window.open('about:blank',prepared.name,'popup,width=302,height=264');
        if(!popup||popup.closed){fail();return;}
        // A renamed, navigated or independently created document cannot host this tree.
        if(popup.location.href!=='about:blank'){fail();return;}
        const doc=popup.document;doc.title=title;
        const base=doc.createElement('base');base.href=document.baseURI;doc.head.appendChild(base);
        const syncStyles=()=>{
          if(!alive||!popup||popup.closed)return;
          doc.head.querySelectorAll('[data-zy-profile-style]').forEach(node=>node.remove());
          for(const source of document.head.querySelectorAll('style,link[rel="stylesheet"]')){
            const clone=source.cloneNode(true) as HTMLElement;clone.setAttribute('data-zy-profile-style','');
            doc.head.appendChild(clone);
          }
        };
        syncStyles();syncTheme();
        doc.documentElement.style.background='transparent';doc.documentElement.style.overflow='hidden';
        doc.body.style.cssText='margin:0;background:transparent;overflow:hidden;';
        const host=doc.createElement('main');host.className='zy-app zy-desktop zy-native-profile-host';
        host.style.cssText='display:block;position:relative;width:100%;height:100vh;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;background:transparent;overflow:visible;box-shadow:none;';
        doc.body.appendChild(host);
        headObserver=new MutationObserver(syncStyles);headObserver.observe(document.head,{subtree:true,childList:true,characterData:true});
        themeObserver=new MutationObserver(syncTheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-zy-theme','data-zy-font-size','data-zy-native-material']});
        setSurface({popup,host,id});
      }catch{if(alive)fail();}
    })();
    const pageEnd=()=>{if(id)void bridge?.closeProfilePopover?.(id);};
    window.addEventListener('pagehide',pageEnd);
    return()=>{
      alive=false;headObserver?.disconnect();themeObserver?.disconnect();removeClosed?.();removeDismiss?.();
      window.removeEventListener('pagehide',pageEnd);
      if(id)void bridge?.closeProfilePopover?.(id);
      if(popup&&!popup.closed)popup.close();
    };
  },[anchor,title,failed]);

  useLayoutEffect(()=>{
    if(failed||!surface||!card.current||!natural.current)return;
    const bridge=window.zhiyuDesktop,node=card.current,content=natural.current,doc=surface.popup.document;
    let alive=true,frame:number|null=null,inFlight=false,again=false,dismissing=false,fitGeneration=0,opened=false;
    const motion=createAnchoredPopupMotion(node,()=>layout.current?{x:layout.current.anchorX,y:layout.current.anchorY}:null);
    const applyLayout=(value:ProfilePopoverLayout)=>{
      if(!alive||dismissing)return;layout.current=value;
      node.style.maxHeight=`${Math.max(1,value.height-24)}px`;
      node.style.maxWidth=`${Math.max(1,value.width-24)}px`;
      node.dataset.anchorSide=value.side;
      if(!opened){opened=true;node.style.visibility='visible';node.focus({preventScroll:true});motion.play(true);}
      else motion.reanchor();
    };
    const finishClose=()=>{
      void bridge?.closeProfilePopover?.(surface.id);
      if(restoreFocus.current&&anchor.isConnected)(anchor.closest<HTMLButtonElement>('button')||anchor).focus({preventScroll:true});
      latestClose.current();
    };
    const dismiss=()=>{
      if(!alive||dismissing)return;dismissing=true;
      const focused=doc.activeElement;
      if(focused&&node.contains(focused)&&typeof (focused as HTMLElement).blur==='function')(focused as HTMLElement).blur();
      motion.play(false,finishClose);
    };
    requestClose.current=dismiss;
    const fit=async()=>{
      frame=null;
      if(!alive||dismissing)return;
      if(!anchor.isConnected){dismiss();return;}
      if(inFlight){again=true;return;}
      inFlight=true;const generation=++fitGeneration;
      try {
        const value=await bridge?.fitProfilePopover?.({id:surface.id,anchor:anchorBox(anchor),height:Math.max(1,content.scrollHeight)});
        if(!alive||generation!==fitGeneration)return;
        if(value)applyLayout(value);
        else if(!surface.popup.closed){unavailable.current=true;setSurface(null);setFailed(true);void bridge?.closeProfilePopover?.(surface.id);}
      }catch{if(alive){unavailable.current=true;setSurface(null);setFailed(true);void bridge?.closeProfilePopover?.(surface.id);}}finally{inFlight=false;if(again&&alive){again=false;scheduleFit();}}
    };
    const scheduleFit=()=>{if(alive&&!dismissing&&frame===null)frame=requestAnimationFrame(()=>{void fit();});};
    const removeLayout=bridge?.onProfilePopoverLayout?.(value=>{if(value.id===surface.id)applyLayout(value);});
    const observer=new ResizeObserver(scheduleFit);observer.observe(content);observer.observe(anchor);
    const childMutation=new MutationObserver(scheduleFit);childMutation.observe(content,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['open','src','style']});
    const outside=(event:Event)=>{const target=event.target as Node|null;if(target&&(anchor.contains(target)||anchor.closest('button')?.contains(target)))return;dismiss();};
    const key=(event:globalThis.KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return;
      if((event.target as Element)?.closest?.('.zy-inline-name-input'))return;
      event.preventDefault();restoreFocus.current=true;dismiss();
    };
    const replace=(event:Event)=>{const after=(event as CustomEvent<{afterClose:()=>void}>).detail.afterClose;latestClose.current=after;dismiss();};
    document.addEventListener('pointerdown',outside);doc.addEventListener('keydown',key);
    window.addEventListener('resize',scheduleFit);window.addEventListener('scroll',dismiss,true);
    anchor.addEventListener('zy-profile-toggle',dismiss);anchor.addEventListener('zy-profile-replace',replace);
    doc.addEventListener('load',scheduleFit,true);void doc.fonts.ready.then(scheduleFit);
    scheduleFit();
    return()=>{
      alive=false;fitGeneration++;motion.dispose();observer.disconnect();childMutation.disconnect();removeLayout?.();
      if(requestClose.current===dismiss)requestClose.current=()=>{};
      if(frame!==null)cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown',outside);doc.removeEventListener('keydown',key);
      window.removeEventListener('resize',scheduleFit);window.removeEventListener('scroll',dismiss,true);
      anchor.removeEventListener('zy-profile-toggle',dismiss);anchor.removeEventListener('zy-profile-replace',replace);
      doc.removeEventListener('load',scheduleFit,true);
    };
  },[surface,anchor,failed]);
  function keyDown(event:KeyboardEvent<HTMLDivElement>){
    if(event.key!=='Escape'||event.defaultPrevented||event.nativeEvent.isComposing||(event.target as Element).closest('.zy-inline-name-input'))return;
    event.preventDefault();event.stopPropagation();restoreFocus.current=true;requestClose.current();
  }
  if(failed)return fallback;
  if(!surface)return null;
  // A separate native window is not a modal HTML dialog in the opener.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-interactions
  return createPortal(<div ref={card} role="dialog" aria-modal="false" aria-label={title} tabIndex={-1}
    className={`zy-dialog zy-profile-popover zy-native-profile-content ${className}`} onKeyDown={keyDown}
    style={{position:'relative',inset:'auto',boxSizing:'border-box',width:277.5,maxWidth:'calc(100% - 24px)',maxHeight:'none',margin:12,padding:0,overflow:'auto',overscrollBehavior:'contain',outline:'none',visibility:'hidden'}}>
    <div ref={natural}>{children}</div>
  </div>,surface.host);
}
