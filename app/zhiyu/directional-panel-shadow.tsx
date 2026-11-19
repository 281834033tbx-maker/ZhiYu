'use client';

import {useId,useLayoutEffect,useRef} from 'react';
import {continuousCornerPath,resolveCornerRadii} from './continuous-corners';
import './directional-panel-shadow.css';

/** Reuse the existing theme's cast-shadow colour, including its opacity. */
export function existingShadowInk(token:string){return token.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/iu)?.[0]||'currentColor';}

/** The clip is outside the panel's bounding box on its left and bottom only.
 * Applying it AFTER blur means no blur can leak to the top or the right. */
export default function DirectionalPanelShadow({targetSelector,surface}:{targetSelector:string;surface:'main'|'topbar'}){
 const svg=useRef<SVGSVGElement>(null),path=useRef<SVGPathElement>(null),filter=useRef<SVGFilterElement>(null),left=useRef<SVGRectElement>(null),bottom=useRef<SVGRectElement>(null);
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,''),clipId=`zy-dir-clip-${id}`,filterId=`zy-dir-blur-${id}`;
 useLayoutEffect(()=>{
  const node=svg.current,host=node?.parentElement,target=host?.querySelector<HTMLElement>(targetSelector);
  if(!node||!host||!target||!path.current||!filter.current||!left.current||!bottom.current)return;
  const doc=node.ownerDocument,win=doc.defaultView;if(!win)return;
  const padding=20;let frame=0;
  const paint=()=>{
   frame=0;const box=target.getBoundingClientRect(),parent=host.getBoundingClientRect(),width=target.offsetWidth,height=target.offsetHeight;
   if(!width||!height){node.style.display='none';return;}node.style.display='block';
   const targetX=box.left-parent.left,targetY=box.top-parent.top;
   const leftSpace=Math.min(padding,Math.max(0,targetX)),bottomSpace=Math.min(padding,Math.max(0,host.clientHeight-targetY-height));
   node.style.left=`${targetX-leftSpace}px`;node.style.top=`${targetY}px`;
   node.style.width=`${width+leftSpace}px`;node.style.height=`${height+bottomSpace}px`;
   node.setAttribute('viewBox',`${-leftSpace} 0 ${width+leftSpace} ${height+bottomSpace}`);
   const style=win.getComputedStyle(target),radii=resolveCornerRadii([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius],width,height);
   path.current!.setAttribute('d',continuousCornerPath(width,height,radii));path.current!.setAttribute('fill',existingShadowInk(style.getPropertyValue('--zy-popup-shadow')));
   for(const [name,value]of Object.entries({x:-padding,y:-padding,width:width+padding*2,height:height+padding*2}))filter.current!.setAttribute(name,String(value));
   for(const [name,value]of Object.entries({x:-leftSpace,y:0,width:leftSpace,height:height+bottomSpace}))left.current!.setAttribute(name,String(value));
   for(const [name,value]of Object.entries({x:0,y:height,width,height:bottomSpace}))bottom.current!.setAttribute(name,String(value));
  };
  const refresh=()=>{if(!frame)frame=win.requestAnimationFrame(paint);};
  const setActive=(active:boolean)=>node.dataset.shadowActive=String(active);
  const focus=()=>setActive(doc.hasFocus()&&(surface==='topbar'||target.contains(doc.activeElement)));
  const blur=()=>setActive(false);
  const interact=(event:Event)=>setActive(target.contains(event.target as Node));
  paint();focus();
  const sizes=new ResizeObserver(refresh);sizes.observe(target);sizes.observe(host);
  const styles=new MutationObserver(refresh);styles.observe(doc.documentElement,{attributes:true,attributeFilter:['data-zy-theme','data-zy-font-size']});styles.observe(target,{attributes:true,attributeFilter:['class','style']});
  doc.addEventListener('pointerdown',interact,true);doc.addEventListener('focusin',interact,true);win.addEventListener('focus',focus);win.addEventListener('blur',blur);win.addEventListener('resize',refresh);
  return()=>{if(frame)win.cancelAnimationFrame(frame);sizes.disconnect();styles.disconnect();doc.removeEventListener('pointerdown',interact,true);doc.removeEventListener('focusin',interact,true);win.removeEventListener('focus',focus);win.removeEventListener('blur',blur);win.removeEventListener('resize',refresh);};
 },[targetSelector,surface]);
 return <svg ref={svg} className="zy-directional-panel-shadow" data-shadow-surface={surface} data-shadow-active="false" aria-hidden="true" focusable="false" preserveAspectRatio="none">
  <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect ref={left}/><rect ref={bottom}/></clipPath><filter ref={filter} id={filterId} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="5"/><feOffset dx="-7" dy="7"/></filter></defs>
  <g clipPath={`url(#${clipId})`}><path ref={path} filter={`url(#${filterId})`}/></g>
 </svg>;
}
