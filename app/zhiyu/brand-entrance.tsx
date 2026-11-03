'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import './brand-entrance.css';

const subscribeHydration=()=>()=>{};

/** One continuous mark: depth landing, hold, then FLIP to the real navigation mark. */
export default function BrandEntrance({ src }: { src: string }) {
  const mounted=useSyncExternalStore(subscribeHydration,()=>true,()=>false);
  const [done, setDone] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mounted || done) return;
    const root = layer.current;
    const target = document.querySelector<HTMLImageElement>('[data-navigation-logo]');
    const mark = root?.querySelector<HTMLImageElement>('.zy-entrance-mark');
    const flight = root?.querySelector<HTMLElement>('.zy-entrance-flight');
    const backdrop = root?.querySelector<HTMLElement>('.zy-entrance-backdrop');
    if (!root || !target || !mark || !flight || !backdrop || document.hidden
      || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (root) root.style.display = 'none';
      setDone(true);
      return;
    }
    const animations: Animation[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const previousVisibility = target.style.visibility;
    const deadline = Date.now() + 4500;
    let active = true, finished = false, stopped = false;
    let interrupt = () => {};
    const interrupted = new Promise<void>(resolve => {interrupt = resolve;});
    const stop = () => {
      if (stopped) return;
      stopped = true;
      interrupt();
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      animations.forEach(animation => {try {animation.cancel();} catch { /* Cleanup must still restore the page. */ }});
      target.style.visibility = previousVisibility;
    };
    const finish = () => {
      if (!active || finished) return;
      finished = true;
      // Release the visual layer immediately, even if a hidden React render waits.
      root.style.display = 'none';
      stop();
      setDone(true);
    };
    const canContinue = () => {
      if (!active || finished) return false;
      if (document.hidden || Date.now() >= deadline) {finish(); return false;}
      return true;
    };
    const delay = (duration: number) => new Promise<void>(resolve => {
      const timer = setTimeout(() => {timers.delete(timer); resolve();}, duration);
      timers.add(timer);
    });
    const wait = (promise: Promise<unknown>) => Promise.race([promise, interrupted]);
    timers.add(setTimeout(finish, 4500));
    target.style.visibility = 'hidden';
    const animate = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = el.animate(frames, { fill: 'forwards', ...options });
      animations.push(animation);
      return animation;
    };
    const run = async () => {
      try {
        // Decoding can remain pending while an Electron renderer is hidden.
        await wait(Promise.race([mark.decode().catch(() => {}), delay(600)]));
        if (!canContinue()) return;
        if (!mark.complete || !mark.naturalWidth) {finish(); return;}
        await wait(animate(mark, [
          { transform: 'translateZ(840px)', filter: 'drop-shadow(32px 52px 24px rgb(38 40 45 / .18))' },
          { transform: 'translateZ(0)', filter: 'drop-shadow(3px 6px 2px rgb(38 40 45 / .16))' },
        ], { duration: 2000, easing: 'cubic-bezier(.12,.82,.18,1)' }).finished);
        if (!canContinue()) return;
        await wait(delay(100));
        if (!canContinue()) return;
        // Measure at departure, after the home page has laid out and restored its size.
        const from = flight.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const dx = to.x + to.width / 2 - (from.x + from.width / 2);
        const dy = to.y + to.height / 2 - (from.y + from.height / 2);
        animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 280 });
        await wait(animate(flight, [
          { transform: 'translate(0px, 0px) scale(1, 1)' },
          { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})` },
        ], { duration: 820, easing: 'cubic-bezier(.65,0,.2,1)' }).finished);
        finish();
      } catch { finish(); }
    };
    void run();
    // Resizing mid-flight must never strand the mark at an obsolete position.
    const onResize = () => finish();
    const onVisibility = () => finish();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mounted, done]);
  if (!mounted || done) return null;
  return createPortal(
    <div className="zy-entrance" ref={layer} aria-hidden="true">
      <div className="zy-entrance-backdrop" />
      <div className="zy-entrance-flight">
        <div className="zy-entrance-depth">
          <Image unoptimized width={180} height={180} className="zy-entrance-mark" src={src} alt="" />
        </div>
      </div>
    </div>, document.querySelector('.zy-desktop-slot') || document.body,
  );
}
