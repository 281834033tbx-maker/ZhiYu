'use client';
/* eslint-disable next/no-img-element -- Moments use their original local media. */
import {useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import type {Post} from './data';
import {animateSpring,resistBounds,type SpringState} from './spring-motion';
import './moment-media.css';

type Drag={id:number;x:number;y:number;origin:number;axis:'x'|'y'|null;lastAt:number;lastPosition:number;velocity:number};

/** Horizontal gestures retain release velocity; native vertical feed scrolling stays native. */
export default function MomentMedia({post,open}:{post:Post;open:(images:string[],index:number,origin:HTMLImageElement|null)=>void}) {
  const imgs=post.images,carousel=post.carousel||imgs.length>=4;
  const [index,setIndex]=useState(0);
  const selected=useRef(0),hit=useRef<HTMLButtonElement>(null),track=useRef<HTMLSpanElement>(null);
  const width=useRef(0),position=useRef<SpringState>({position:0,velocity:0}),drag=useRef<Drag|null>(null),suppressClick=useRef(false);
  const motion=useRef<ReturnType<typeof animateSpring>|null>(null);
  const paint=(state:SpringState)=>{position.current=state;if(track.current)track.current.style.transform=`translate3d(${state.position}px,0,0)`;};
  function settle(next:number,velocity=position.current.velocity) {
    const target=Math.max(0,Math.min(imgs.length-1,next));selected.current=target;setIndex(target);
    motion.current?.cancel();
    motion.current=animateSpring({from:position.current.position,to:-target*width.current,velocity,stiffness:240,damping:29,onUpdate:paint});
  }
  useLayoutEffect(()=>{
    const node=hit.current;if(!node||!carousel)return;
    const resize=()=>{
      const next=node.clientWidth;if(next===width.current&&selected.current<imgs.length)return;
      motion.current?.cancel();drag.current=null;width.current=next;
      selected.current=Math.min(selected.current,imgs.length-1);setIndex(selected.current);
      paint({position:-selected.current*next,velocity:0});
    };
    resize();const observer=new ResizeObserver(resize);observer.observe(node);
    return()=>{observer.disconnect();motion.current?.cancel();};
  },[carousel,imgs.length]);
  function down(event:ReactPointerEvent<HTMLButtonElement>) {
    if(event.button!==0||!event.isPrimary)return;
    motion.current?.cancel();suppressClick.current=false;
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,origin:position.current.position,axis:null,lastAt:performance.now(),lastPosition:position.current.position,velocity:0};
  }
  function move(event:ReactPointerEvent<HTMLButtonElement>) {
    const gesture=drag.current;if(!gesture||gesture.id!==event.pointerId)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>6){
      gesture.axis=Math.abs(dx)>Math.abs(dy)*1.1?'x':'y';
      suppressClick.current=true;
      if(gesture.axis==='x')event.currentTarget.setPointerCapture(event.pointerId);
    }
    if(gesture.axis!=='x')return;
    event.preventDefault();
    const next=resistBounds(gesture.origin+dx,-(imgs.length-1)*width.current,0,width.current);
    const at=performance.now(),seconds=Math.max(.001,(at-gesture.lastAt)/1000);
    gesture.velocity=gesture.velocity*.25+(next-gesture.lastPosition)/seconds*.75;
    gesture.lastAt=at;gesture.lastPosition=next;paint({position:next,velocity:gesture.velocity});
  }
  function end(event:ReactPointerEvent<HTMLButtonElement>,cancelled=false) {
    const gesture=drag.current;if(!gesture||gesture.id!==event.pointerId)return;
    drag.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    if(gesture.axis!=='x')return;
    const velocity=cancelled||performance.now()-gesture.lastAt>100?0:gesture.velocity;
    // Projection lets a short, quick flick advance; a slow drag follows distance.
    const next=Math.round(-(position.current.position+velocity*.16)/Math.max(1,width.current));
    settle(next,velocity);
  }
  if(!imgs.length)return null;
  return <div className={'zy-media '+(carousel?'is-carousel':'count-'+imgs.length)}>
    {carousel?<>
      <button ref={hit} type="button" className="zy-image-hit zy-carousel-hit" aria-label={`查看第 ${index+1} 张图片`}
        onPointerDown={down} onPointerMove={move} onPointerUp={event=>end(event)} onPointerCancel={event=>end(event,true)}
        onLostPointerCapture={event=>end(event,true)}
        onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();settle(index+(event.key==='ArrowLeft'?-1:1));}}}
        onClick={event=>{if(suppressClick.current){event.preventDefault();suppressClick.current=false;}else open(imgs,index,event.currentTarget.querySelectorAll('img')[index]||null);}}>
        <span ref={track} className="zy-carousel-track">{imgs.map((src,i)=><span className="zy-carousel-slide" key={src+i} aria-hidden={i!==index}>
          <img src={src} alt={i===index?`${post.text} · 第 ${i+1} 张`:''} draggable={false} decoding="async" loading={Math.abs(i-index)<=1?'eager':'lazy'}/>
        </span>)}</span>
      </button>
      {index>0&&<button type="button" className="zy-icon zy-carousel-arrow prev" aria-label="上一张图片" onClick={()=>settle(index-1)}><ChevronLeft/></button>}
      {index<imgs.length-1&&<button type="button" className="zy-icon zy-carousel-arrow next" aria-label="下一张图片" onClick={()=>settle(index+1)}><ChevronRight/></button>}
      <div className="zy-dots" aria-label="图片分页">{imgs.map((_,i)=><button type="button" key={i} aria-label={`切换至第 ${i+1} 张图片`} aria-current={i===index?'true':undefined} onClick={()=>settle(i)}><i className={i===index?'current':''}/></button>)}</div>
    </>:imgs.map((src,i)=><button type="button" className="zy-image-hit" key={src+i} aria-label={`查看第 ${i+1} 张图片`} onClick={event=>open(imgs,i,event.currentTarget.querySelector('img'))}><img src={src} alt={`${post.text} · 图片 ${i+1}`} draggable={false} decoding="async" loading="lazy"/></button>)}
  </div>;
}
