'use client';

import {useLayoutEffect, useRef, useState, type RefObject} from 'react';

export type PopupAnchor = HTMLElement | {x: number; y: number} | null;

/** Keep one reversible animation so an interrupted close retraces its actual opening. */
export function createAnchoredPopupMotion(node: HTMLElement, getAnchor: () => PopupAnchor) {
  let animation: Animation | null = null;
  let disposed = false;
  let opening = true;
  let completed: (() => void) | undefined;
  let frame: number | null = null;
  let hasOrigin = false;
  const originalOpacity = node.style.opacity;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');

  function origin() {
    const anchor = getAnchor();
    const rect = node.getBoundingClientRect();
    // Recover the layout box while a scale animation is running. This lets a
    // newly clamped right-click location retain the same reversible animation.
    const matrix = animation ? new DOMMatrixReadOnly(getComputedStyle(node).transform) : null;
    const left = rect.left - (matrix ? (Number.parseFloat(node.style.transformOrigin) || 0) * (1 - matrix.a) : 0);
    const top = rect.top - (matrix ? (Number.parseFloat(node.style.transformOrigin.split(' ')[1]) || 0) * (1 - matrix.d) : 0);
    const source = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : null;
    const x = source ? source.left + source.width / 2 : anchor && 'x' in anchor ? anchor.x : rect.left + node.offsetWidth / 2;
    const y = source ? source.top + source.height / 2 : anchor && 'y' in anchor ? anchor.y : rect.top;
    node.style.transformOrigin = `${x - left}px ${y - top}px`;
  }

  function finish() {
    if (disposed) return;
    if (frame !== null) cancelAnimationFrame(frame); frame = null;
    if (opening) {animation?.cancel(); animation = null;}
    else if (animation) {animation.onfinish = null;}
    node.style.opacity = originalOpacity;
    node.style.willChange = '';
    node.dataset.popupPhase = opening ? 'open' : 'closed';
    const callback = completed; completed = undefined;
    callback?.();
  }

  function play(open: boolean, onComplete?: () => void) {
    if (disposed) return;
    opening = open; completed = onComplete;
    node.inert = !open;
    if (open) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', 'true');
    node.dataset.popupPhase = open ? 'opening' : 'closing';
    if (media.matches || typeof node.animate !== 'function') {finish(); return;}
    const start = () => {
      frame = null;
      if (disposed) return;
      if (media.matches) {finish(); return;}
      if (!hasOrigin || !open) {origin(); hasOrigin = true;}
      node.style.willChange = 'transform, opacity';
      animation = node.animate([
        {transform: 'scale(0.08)', opacity: 0},
        {transform: 'scale(1)', opacity: 1},
      ], {duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both'});
      animation.pause();
      animation.currentTime = open ? 0 : 280;
      animation.onfinish = finish;
      node.style.opacity = originalOpacity;
      animation.playbackRate = open ? 1 : -1.2;
      animation.play();
    };
    if (!animation) {
      if (frame !== null) {cancelAnimationFrame(frame); frame = null;}
      if (open) {
        // Placement effects can clamp a portal after this hook runs. Measure
        // on the next frame, once all layout effects have committed coordinates.
        node.style.opacity = '0';
        frame = requestAnimationFrame(start);
      } else if (!hasOrigin) finish();
      else start();
    } else {
      animation.onfinish = finish;
      animation.playbackRate = open ? 1 : -1.2;
      animation.play();
    }
  }

  const reduceMotion = () => {if (media.matches && animation) finish();};
  media.addEventListener('change', reduceMotion);
  function reanchor() {
    if (disposed || media.matches || typeof node.animate !== 'function' || frame !== null) return;
    frame = requestAnimationFrame(() => {frame = null; if (!disposed) origin();});
  }
  return {
    play,
    reanchor,
    dispose() {
      disposed = true; completed = undefined;
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      animation?.cancel(); animation = null;
      node.style.opacity = originalOpacity;
      node.style.willChange = '';
      media.removeEventListener('change', reduceMotion);
    },
  };
}

/** Retain the element until its closing motion finishes; rapid reopen reverses in place. */
export function useAnchoredPopupPresence(open: boolean, nodeRef: RefObject<HTMLElement | null>, getAnchor: () => PopupAnchor): boolean {
  const [present, setPresent] = useState(open);
  // Adjust only this hook's own state before commit, so opening mounts in the
  // same commit without a second layout-effect render.
  if (open && !present) setPresent(true);
  const latestAnchor = useRef(getAnchor);
  const motion = useRef<ReturnType<typeof createAnchoredPopupMotion> | null>(null);
  useLayoutEffect(() => {latestAnchor.current = getAnchor;});
  useLayoutEffect(() => {
    if (!present || !nodeRef.current) return;
    const controller = createAnchoredPopupMotion(nodeRef.current, () => latestAnchor.current());
    motion.current = controller;
    return () => {controller.dispose(); if (motion.current === controller) motion.current = null;};
  }, [present, nodeRef]);
  useLayoutEffect(() => {
    if (!present) return;
    motion.current?.play(open, open ? undefined : () => setPresent(false));
  }, [open, present]);
  useLayoutEffect(() => {motion.current?.reanchor();});
  return present;
}
