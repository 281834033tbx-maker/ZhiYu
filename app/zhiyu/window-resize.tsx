'use client';

import { useEffect, useRef, type PointerEvent } from 'react';

const storageKey = 'zhiyu-window-size';
const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const labels = ['上边', '下边', '右边', '左边', '右上角', '左上角', '右下角', '左下角'];

export default function WindowResize() {
  const anchor = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const windowElement = () => anchor.current?.parentElement;
  function apply(width: number, height: number) {
    const el = windowElement();
    if (!el) return;
    const maxWidth = Math.max(320, window.innerWidth - 48);
    const maxHeight = Math.max(320, window.innerHeight - 48);
    el.style.width = `${Math.min(maxWidth, Math.max(Math.min(900, maxWidth), width))}px`;
    el.style.height = `${Math.min(maxHeight, Math.max(Math.min(540, maxHeight), height))}px`;
  }
  function save() {
    const rect = windowElement()?.getBoundingClientRect();
    if (rect) try { localStorage.setItem(storageKey, JSON.stringify({ width: rect.width, height: rect.height })); } catch { /* Storage may be disabled. */ }
  }
  useEffect(() => {
    try {
      const size = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) apply(size.width, size.height);
    } catch { /* Fall back to the original window size. */ }
    const fit = () => {
      const rect = windowElement()?.getBoundingClientRect();
      if (rect) apply(rect.width, rect.height);
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  function start(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const rect = windowElement()?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  return <div ref={anchor} className="zy-resize-handles">
    {edges.map((edge, index) => <button key={edge} className={`zy-resize-handle ${edge}`}
      aria-label={`调整窗口${labels[index]}尺寸`} title="拖动调整大小；双击恢复默认尺寸"
      onPointerDown={start}
      onPointerMove={e => {
        const origin = drag.current;
        if (!origin) return;
        const dx = (e.clientX - origin.x) * 2;
        const dy = (e.clientY - origin.y) * 2;
        apply(origin.width + (edge.includes('e') ? dx : edge.includes('w') ? -dx : 0),
          origin.height + (edge.includes('s') ? dy : edge.includes('n') ? -dy : 0));
      }}
      onPointerUp={() => { drag.current = null; save(); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => {
        const el = windowElement();
        if (el) { el.style.width = ''; el.style.height = ''; }
        try { localStorage.removeItem(storageKey); } catch { /* Optional persistence. */ }
      }}
      onKeyDown={e => {
        const rect = windowElement()?.getBoundingClientRect();
        if (!rect || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        apply(rect.width + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0),
          rect.height + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0));
        save();
      }} />)}
  </div>;
}
