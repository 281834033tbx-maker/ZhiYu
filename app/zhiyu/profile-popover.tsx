'use client';

import {useLayoutEffect, useRef, type KeyboardEvent, type ReactNode} from 'react';
import {createAnchoredPopupMotion} from './anchored-popup-motion';
import './profile-popover.css';

/** A non-modal top-layer card anchored to the actual avatar that opened it. */
export default function ProfilePopover({title, anchor, close, className = '', children}: {
  title: string;
  anchor: HTMLElement | null;
  close: () => void;
  className?: string;
  children: ReactNode;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const latestClose = useRef(close);
  const restoreFocus = useRef(false);
  const dismissRequest = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {latestClose.current = close;});
  useLayoutEffect(() => {
    const node = popover.current;
    if (!node || !anchor?.isConnected) {
      let invalidActive = true;
      queueMicrotask(() => {if (invalidActive) latestClose.current();});
      return () => {invalidActive = false;};
    }
    const trigger = anchor.closest<HTMLButtonElement>('button') || (anchor.matches('button,[tabindex]') ? anchor : null);
    let active = true;
    let dismissing = false;
    let afterDismiss: (() => void) | null = null;
    let positionFrame: number | null = null;
    restoreFocus.current = false;
    node.style.visibility = 'hidden';
    node.showPopover();
    const motion = createAnchoredPopupMotion(node, () => anchor);
    const dismiss = () => {
      if (!active || dismissing) return;
      dismissing = true;
      // Start any pending blur save before click, scroll, or a lost anchor unmounts the card.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && node.contains(focused)) focused.blur();
      motion.play(false, () => {if (afterDismiss) afterDismiss(); else latestClose.current();});
    };
    dismissRequest.current = dismiss;
    const position = () => {
      if (!active || dismissing) return;
      if (!anchor.isConnected) {queueMicrotask(dismiss); return;}
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const margin = 12, gap = 10;
      const rect = anchor.getBoundingClientRect();
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      if (!rect.width || !rect.height || rect.bottom <= viewportTop || rect.top >= viewportBottom || rect.right <= viewportLeft || rect.left >= viewportRight) {queueMicrotask(dismiss); return;}
      const fullHeight = Math.max(1, viewportHeight - 2 * margin);
      const below = Math.max(0, viewportBottom - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - viewportTop - margin);
      // Keep the card below the clicked avatar whenever a usable scroll area fits.
      const side = below >= 96 ? 'bottom' : above >= 96 ? 'top' : below >= above ? 'bottom' : 'top';
      const space = side === 'bottom' ? below : above;
      // Very short windows still get a usable, scrollable card inside the viewport.
      const maxHeight = Math.min(fullHeight, Math.max(96, space));
      // Apply only the final limits. Temporarily enlarging an observed card to
      // measure its natural height creates another resize during RO delivery.
      node.style.maxHeight = `${maxHeight}px`;
      node.style.maxWidth = `${Math.max(1, viewportWidth - 2 * margin)}px`;
      // Animated transforms must not feed back into the observed card's layout.
      const height = node.offsetHeight;
      const left = Math.max(viewportLeft + margin, Math.min(rect.left, viewportRight - margin - node.offsetWidth));
      const desiredTop = side === 'bottom' ? rect.bottom + gap : rect.top - gap - height;
      const top = Math.max(viewportTop + margin, Math.min(desiredTop, viewportBottom - margin - height));
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.visibility = 'visible';
      node.dataset.anchorSide = side;
      motion.reanchor();
    };
    const schedulePosition = () => {
      if (!active || dismissing || positionFrame !== null) return;
      // ResizeObserver watches this card as well as the avatar. Defer writes
      // outside its notification phase and coalesce repeated resize events.
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        position();
      });
    };
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (node.contains(target) || anchor.contains(target) || trigger?.contains(target))) return;
      dismiss();
    };
    const toggle = () => {
      afterDismiss = null;
      if (!dismissing) {dismiss(); return;}
      dismissing = false;
      restoreFocus.current = false;
      motion.play(true);
      schedulePosition();
      node.focus({preventScroll: true});
    };
    const replace = (event: Event) => {
      afterDismiss = (event as CustomEvent<{afterClose: () => void}>).detail.afterClose;
      dismiss();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && node.contains(event.target)) return;
      dismiss();
    };
    const escapeAfterEdit = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Node) || (!node.contains(target) && target !== document.body && target !== document.documentElement)) return;
      if (target instanceof Element && target.closest('.zy-inline-name-input')) return;
      event.preventDefault();
      restoreFocus.current = true;
      dismiss();
    };
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(node); observer.observe(anchor);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escapeAfterEdit);
    anchor.addEventListener('zy-profile-toggle', toggle);
    anchor.addEventListener('zy-profile-replace', replace);
    viewportListener('add', schedulePosition);
    position();
    node.focus({preventScroll: true});
    motion.play(true);
    return () => {
      active = false;
      motion.dispose();
      if (dismissRequest.current === dismiss) dismissRequest.current = null;
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
      observer.disconnect();
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', scroll, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escapeAfterEdit);
      anchor.removeEventListener('zy-profile-toggle', toggle);
      anchor.removeEventListener('zy-profile-replace', replace);
      viewportListener('remove', schedulePosition);
      if (node.matches(':popover-open')) node.hidePopover();
      if (restoreFocus.current && trigger?.isConnected) trigger.focus({preventScroll: true});
    };
  }, [anchor]);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    // The shared editor owns Escape while its draft is open.
    if ((event.target as HTMLElement).closest('.zy-inline-name-input')) return;
    event.preventDefault(); event.stopPropagation();
    restoreFocus.current = true;
    dismissRequest.current?.();
  }
  // The native manual popover supplies the top layer; dialog semantics stay non-modal.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-interactions
  return <div ref={popover} popover="manual" role="dialog" aria-modal="false" aria-label={title} tabIndex={-1} className={`zy-dialog zy-profile-popover zy-anchored-profile-popover ${className}`} onKeyDown={keyDown}>{children}</div>;
}

function viewportListener(action: 'add' | 'remove', listener: () => void) {
  const viewport = window.visualViewport;
  if (action === 'add') {viewport?.addEventListener('resize', listener); viewport?.addEventListener('scroll', listener);}
  else {viewport?.removeEventListener('resize', listener); viewport?.removeEventListener('scroll', listener);}
}
