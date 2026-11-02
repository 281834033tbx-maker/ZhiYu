'use client';

import { useEffect, useRef, useState } from 'react';

const clips = [
  '/desktop-npc/video/xu-xiaoman/00-idle.mp4',
  '/desktop-npc/video/xu-xiaoman/02-lean-forward.mp4',
  '/desktop-npc/video/xu-xiaoman/03-touch-hair.mp4',
  '/desktop-npc/video/xu-xiaoman/04-daydream.mp4',
  '/desktop-npc/video/xu-xiaoman/05-reply-normal.mp4',
  '/desktop-npc/video/xu-xiaoman/06-reply-happy.mp4',
] as const;

type Slots = [number, number];

export default function XiaomanVideoScene({ fallback }: { fallback: string }) {
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
    <img className="zy-character-window-scene-direct" src={fallback} alt="许晓曼的桌面人物形象" draggable={false} />
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
