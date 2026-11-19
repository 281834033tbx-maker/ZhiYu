'use client';

import { useEffect, useRef, useState } from 'react';
import {CAPTION_CASE_CLIP,CAPTION_CASE_TIME} from './caption-case-intent';

const clips = [
  '/desktop-npc/video/xu-xiaoman/00-idle.mp4',
  '/desktop-npc/video/xu-xiaoman/02-lean-forward.mp4',
  '/desktop-npc/video/xu-xiaoman/03-touch-hair.mp4',
  '/desktop-npc/video/xu-xiaoman/04-daydream.mp4',
  '/desktop-npc/video/xu-xiaoman/05-reply-normal.mp4',
  '/desktop-npc/video/xu-xiaoman/06-reply-happy.mp4',
] as const;

type Slots = [number, number];

export default function XiaomanVideoScene({fallback,caseFrame=false,onCaseReady,onCaseError}:{fallback:string;caseFrame?:boolean;onCaseReady?:()=>void;onCaseError?:()=>void}) {
  return caseFrame?<XiaomanCaseFrame fallback={fallback} onReady={onCaseReady} onError={onCaseError}/>:<XiaomanLoopScene fallback={fallback}/>;
}

function XiaomanCaseFrame({fallback,onReady,onError}:{fallback:string;onReady?:()=>void;onError?:()=>void}) {
  const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const element=video.current,surface=canvas.current;if(!element||!surface)return;
    const context=surface.getContext('2d',{alpha:false});
    let active=true,failed=false,seeked=false,drawn=false;
    setReady(false);
    const fail=()=>{failed=true;element.pause();if(active){setReady(false);onError?.();}};
    const seek=()=>{
      element.pause();
      if(!Number.isFinite(element.duration)||element.duration<=CAPTION_CASE_TIME){fail();return;}
      seeked=false;
      element.currentTime=CAPTION_CASE_TIME;
    };
    const draw=()=>{
      element.pause();
      if(!active||failed||drawn||!seeked||element.seeking||Math.abs(element.currentTime-CAPTION_CASE_TIME)>.08||element.readyState<2)return;
      if(!context||element.videoWidth!==1920||element.videoHeight!==1080){fail();return;}
      try{
        // Copy only the original, decoded video frame at native resolution. This
        // avoids Electron retaining a paused video's old compositor texture.
        context.drawImage(element,0,0);
        drawn=true;setReady(true);onReady?.();
      }catch{fail();}
    };
    const completedSeek=()=>{seeked=true;draw();};
    element.addEventListener('loadedmetadata',seek);element.addEventListener('seeked',completedSeek);element.addEventListener('loadeddata',draw);element.addEventListener('canplay',draw);element.addEventListener('error',fail);
    if(!context)fail();else if(element.readyState>=1)seek();
    return()=>{active=false;element.pause();element.removeEventListener('loadedmetadata',seek);element.removeEventListener('seeked',completedSeek);element.removeEventListener('loadeddata',draw);element.removeEventListener('canplay',draw);element.removeEventListener('error',fail);context?.clearRect(0,0,surface.width,surface.height);};
  },[onReady,onError]);
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element -- Exact existing desktop fallback. */}
    <img className="zy-character-window-scene-direct" src={fallback} alt="小满" draggable={false}/>
    <video ref={video} className="zy-character-window-scene-video" src={CAPTION_CASE_CLIP} preload="auto" muted playsInline aria-hidden="true" tabIndex={-1} data-caption-case-video="true" data-caption-case-video-ready={ready}/>
    <canvas ref={canvas} className={`zy-character-window-scene-video${ready?' is-active':''}`} width={1920} height={1080} aria-hidden="true" data-caption-case-canvas="true" data-caption-case-canvas-ready={ready}/>
  </>;
}

function XiaomanLoopScene({fallback}:{fallback:string}) {
  const firstVideo = useRef<HTMLVideoElement>(null);
  const secondVideo = useRef<HTMLVideoElement>(null);
  const activeSlot = useRef(0);
  const clipIndex = useRef(0);
  const switching = useRef(false);
  const [sources, setSources] = useState<Slots>([0, 1]);
  const [visibleSlot, setVisibleSlot] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = firstVideo.current;
    if (!video) return;
    const start = () => {
      if (!video.paused) return;
      void video.play().then(() => setStarted(true)).catch(() => setFailed(true));
    };
    video.addEventListener('loadeddata', start);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) start();
    return () => video.removeEventListener('loadeddata', start);
  }, []);

  const advance = async (slot: number) => {
    if (slot !== activeSlot.current || switching.current) return;
    switching.current = true;
    const nextSlot = 1 - slot;
    const next = (nextSlot === 0 ? firstVideo : secondVideo).current;
    if (!next) { setFailed(true); return; }
    try {
      next.currentTime = 0;
      await next.play();
      clipIndex.current = (clipIndex.current + 1) % clips.length;
      activeSlot.current = nextSlot;
      setVisibleSlot(nextSlot);
      setSources(previous => {
        const updated: Slots = [...previous];
        updated[slot] = (clipIndex.current + 1) % clips.length;
        return updated;
      });
    } catch {
      setFailed(true);
    } finally {
      switching.current = false;
    }
  };

  return <>
    {/* Preserve the established still scene while the first clip loads or if playback fails. */}
    {/* eslint-disable-next-line @next/next/no-img-element -- Exact existing desktop scene fallback. */}
    <img className="zy-character-window-scene-direct" src={fallback} alt="徐小曼" draggable={false} />
    {sources.map((sourceIndex, slot) => <video
      key={slot}
      ref={slot === 0 ? firstVideo : secondVideo}
      className={`zy-character-window-scene-video${started && !failed && visibleSlot === slot ? ' is-active' : ''}`}
      src={clips[sourceIndex]}
      preload="auto"
      muted
      playsInline
      aria-hidden="true"
      tabIndex={-1}
      onEnded={() => { void advance(slot); }}
      onError={() => setFailed(true)}
    />)}
  </>;
}
