'use client';


import {accountStorage} from './account-storage';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  defaultDesktopAppearancePreference, desktopRailPositionFromPixels,
  loadDesktopAppearancePreference, resolveDesktopRailPosition, saveDesktopAppearancePreference,
  type DesktopAppearanceLayout, type DesktopAppearancePreference, type DesktopRailPoint,
} from './desktop-appearance-preferences';
import './desktop-appearance-editor.css';

function browserStorage(accountId:string): Storage | null {
  try { return accountStorage(accountId); } catch { return null; }
}

/** The renderer owns background paint and rail placement; no chat/store/native state is touched. */
export default function DesktopAppearanceEditor({ accountId, editing, onClose, layout = 'floating' }: {
  accountId: string; editing: boolean; onClose: () => void; layout?: DesktopAppearanceLayout;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const activeHost = useRef<HTMLElement | null>(null);
  const slider = useRef<HTMLInputElement>(null);
  const saved = useRef(defaultDesktopAppearancePreference(layout));
  const draft = useRef(defaultDesktopAppearancePreference(layout));
  const editingRef = useRef(editing);
  const [transparency, setTransparency] = useState(() => defaultDesktopAppearancePreference(layout).transparency);
  const [error, setError] = useState('');

  const apply = useCallback((preference: DesktopAppearancePreference) => {
    const host = activeHost.current;
    if (!host) return;
    if (layout === 'classic') {
      if (preference.transparency > 0) host.setAttribute('data-zy-classic-translucency', 'true');
      else host.removeAttribute('data-zy-classic-translucency');
      host.style.setProperty('--zy-classic-alpha', `${100 - preference.transparency}%`);
      host.style.setProperty('--zy-classic-strength', String((100 - preference.transparency) / 100));
      return;
    }
    const rail = host.querySelector<HTMLElement>(':scope > .zy-rail');
    if (!rail) return;
    const point = resolveDesktopRailPosition(preference.position,
      { width: host.clientWidth, height: host.clientHeight },
      { width: rail.offsetWidth, height: rail.offsetHeight });
    host.style.setProperty('--zy-rail-left', `${point.x}px`);
    host.style.setProperty('--zy-rail-top', `${point.y}px`);
    host.style.setProperty('--zy-detached-alpha', `${100 - preference.transparency}%`);
  }, [layout]);

  useLayoutEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    activeHost.current = host;
    saved.current = loadDesktopAppearancePreference(browserStorage(accountId), accountId, layout).preference;
    draft.current = saved.current;
    apply(saved.current);
    const observer = new ResizeObserver(() => apply(editingRef.current ? draft.current : saved.current));
    observer.observe(host);
    const rail = host.querySelector<HTMLElement>(':scope > .zy-rail');
    if (rail && layout === 'floating') observer.observe(rail);
    return () => {
      observer.disconnect();
      // Session cleanup must not repaint old styles after this owner unmounts.
      activeHost.current = null;
      host.style.removeProperty('--zy-rail-left');
      host.style.removeProperty('--zy-rail-top');
      host.style.removeProperty('--zy-detached-alpha');
      host.style.removeProperty('--zy-classic-alpha');
      host.style.removeProperty('--zy-classic-strength');
      host.removeAttribute('data-zy-classic-translucency');
    };
  }, [accountId, apply, layout]);

  // oxlint-disable-next-line react/react-compiler -- Initialize a cancellable editor session from the account-scoped saved preference.
  useLayoutEffect(() => {
    editingRef.current = editing;
    const host = anchor.current?.parentElement;
    const rail = host?.querySelector<HTMLElement>(':scope > .zy-rail');
    if (!host || (layout === 'floating' && !rail) || !editing) { apply(saved.current); return; }
    draft.current = { ...saved.current };
    setTransparency(draft.current.transparency);
    setError('');
    const previousFocus = document.activeElement;
    const restoreFocus = () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      else rail?.querySelector<HTMLButtonElement>('.zy-rail-bottom')?.focus({ preventScroll: true });
    };
    slider.current?.focus({ preventScroll: true });
    if (layout === 'classic') {
      const key = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault(); apply(saved.current); onClose();
      };
      window.addEventListener('keydown', key);
      return () => {
        window.removeEventListener('keydown', key);
        apply(saved.current);
        restoreFocus();
      };
    }
    if (!rail) return;
    host.setAttribute('data-zy-layout-editing', 'true');
    const previousTabIndex = rail.getAttribute('tabindex');
    const buttons = [...rail.querySelectorAll<HTMLButtonElement>('button')].map(button => ({ button, tab: button.getAttribute('tabindex') }));
    rail.setAttribute('tabindex', '0');
    for (const { button } of buttons) button.setAttribute('tabindex', '-1');
    let drag: { id: number; start: DesktopRailPoint; pointer: DesktopRailPoint; original: DesktopAppearancePreference['position'] } | null = null;
    let frame = 0;
    let latest: DesktopRailPoint | null = null;
    const size = () => ({ width: host.clientWidth, height: host.clientHeight });
    const railSize = () => ({ width: rail.offsetWidth, height: rail.offsetHeight });
    const moveTo = (point: DesktopRailPoint) => {
      draft.current = { ...draft.current, position: desktopRailPositionFromPixels(point, size(), railSize()) };
      apply(draft.current);
    };
    const flush = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (latest) { moveTo(latest); latest = null; }
    };
    const finish = (cancelled: boolean) => {
      const current = drag;
      if (!current) return;
      if (cancelled) {
        cancelAnimationFrame(frame); frame = 0; latest = null;
        draft.current = { ...draft.current, position: current.original };
        apply(draft.current);
      } else flush();
      drag = null;
      rail.removeAttribute('data-zy-dragging');
      if (rail.hasPointerCapture(current.id)) rail.releasePointerCapture(current.id);
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || drag) return;
      event.preventDefault(); event.stopImmediatePropagation();
      drag = { id: event.pointerId, start: resolveDesktopRailPosition(draft.current.position, size(), railSize()),
        pointer: { x: event.clientX, y: event.clientY }, original: draft.current.position };
      rail.setPointerCapture(event.pointerId);
      rail.setAttribute('data-zy-dragging', 'true');
      rail.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault(); event.stopImmediatePropagation();
      latest = { x: drag.start.x + event.clientX - drag.pointer.x, y: drag.start.y + event.clientY - drag.pointer.y };
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      move(event); finish(false);
    };
    const cancelPointer = (event: PointerEvent) => { if (drag?.id === event.pointerId) finish(true); };
    const blur = () => finish(true);
    const blockClick = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); finish(true); apply(saved.current); onClose();
      } else if (event.target === rail && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const point = resolveDesktopRailPosition(draft.current.position, size(), railSize());
        const step = event.shiftKey ? 10 : 1;
        moveTo({ x: point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
          y: point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
      }
    };
    rail.addEventListener('pointerdown', down, true);
    rail.addEventListener('pointermove', move, true);
    rail.addEventListener('pointerup', up, true);
    rail.addEventListener('pointercancel', cancelPointer, true);
    rail.addEventListener('lostpointercapture', cancelPointer, true);
    rail.addEventListener('click', blockClick, true);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
    return () => {
      finish(true);
      host.removeAttribute('data-zy-layout-editing');
      rail.removeEventListener('pointerdown', down, true);
      rail.removeEventListener('pointermove', move, true);
      rail.removeEventListener('pointerup', up, true);
      rail.removeEventListener('pointercancel', cancelPointer, true);
      rail.removeEventListener('lostpointercapture', cancelPointer, true);
      rail.removeEventListener('click', blockClick, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key);
      if (previousTabIndex === null) rail.removeAttribute('tabindex'); else rail.setAttribute('tabindex', previousTabIndex);
      for (const { button, tab } of buttons) { if (tab === null) button.removeAttribute('tabindex'); else button.setAttribute('tabindex', tab); }
      apply(saved.current);
      restoreFocus();
    };
  }, [editing, accountId, apply, onClose, layout]);

  return <div ref={anchor} className="zy-appearance-anchor">
    {editing && <form className="zy-appearance-editor" data-layout={layout} aria-labelledby="zy-appearance-title" onSubmit={event => {
      event.preventDefault();
      const result = saveDesktopAppearancePreference(browserStorage(accountId), accountId, draft.current, layout);
      if (!result.ok) { setError('暂时无法保存，请重试。'); return; }
      saved.current = result.preference; apply(saved.current); onClose();
    }}>
      <h2 id="zy-appearance-title">{layout === 'classic' ? '透明度调整' : '外观调整'}</h2>
      <p>{layout === 'classic' ? '调节背景的通透程度，文字保持清晰。' : '拖动导航条（板块二）调整位置。'}</p>
      <label htmlFor="zy-appearance-transparency">{layout === 'classic' ? '额外透明度' : '背景透明度'} <output>{transparency}%</output></label>
      <input ref={slider} id="zy-appearance-transparency" type="range" min="0" max="100" step="1" value={transparency} onChange={event => {
        const value = Number(event.target.value);
        draft.current = { ...draft.current, transparency: value };
        setTransparency(value); setError(''); apply(draft.current);
      }}/>
      <div className="zy-appearance-scale"><span>{layout === 'classic' ? '原有质感' : '不透明'}</span><span>{layout === 'classic' ? '更透明' : '透明'}</span></div>
      <p className="zy-appearance-hint">{layout === 'classic' ? '点击确定保存，重开仍保留。' : '板块二、三同步调整，文字保持清晰。确定后锁定，重开仍保留。'}</p>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" className="zy-appearance-reset" onClick={() => {
          draft.current = defaultDesktopAppearancePreference(layout); setTransparency(draft.current.transparency); setError(''); apply(draft.current);
        }}>恢复默认</button>
        <button type="button" onClick={() => { apply(saved.current); onClose(); }}>取消</button>
        <button type="submit" className="zy-appearance-confirm">确定</button>
      </footer>
    </form>}
  </div>;
}
