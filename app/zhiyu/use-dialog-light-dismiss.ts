'use client';

import {useEffect, useLayoutEffect, useRef, type RefObject} from 'react';

/** Dismiss only a complete primary click on this dialog's own backdrop.
 * Nested modal events and gestures that start inside never dismiss a parent. */
export function useDialogLightDismiss(
  ref: RefObject<HTMLDialogElement | null>,
  onDismiss: () => void,
  disabled = false,
) {
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || disabled) return;
    let press: {id: number; x: number; y: number} | null = null;
    const outside = (event: PointerEvent) => {
      if (!dialog.open || event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    const down = (event: PointerEvent) => {
      press = event.isPrimary && event.button === 0 && outside(event)
        ? {id: event.pointerId, x: event.clientX, y: event.clientY} : null;
    };
    const up = (event: PointerEvent) => {
      const start = press;
      press = null;
      if (start && start.id === event.pointerId && event.isPrimary && event.button === 0
        && outside(event) && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 6) dismiss.current();
    };
    const cancel = () => { press = null; };
    dialog.addEventListener('pointerdown', down);
    dialog.addEventListener('pointerup', up);
    dialog.addEventListener('pointercancel', cancel);
    return () => {
      dialog.removeEventListener('pointerdown', down);
      dialog.removeEventListener('pointerup', up);
      dialog.removeEventListener('pointercancel', cancel);
    };
  }, [ref, disabled]);
}
