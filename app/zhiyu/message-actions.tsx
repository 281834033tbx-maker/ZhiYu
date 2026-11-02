'use client';

import {useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Reply, Languages, Forward, MoreHorizontal} from 'lucide-react';
import {npcFetch} from './npc-fetch';
import {useAnchoredPopupPresence, type PopupAnchor} from './anchored-popup-motion';
import './message-actions.css';

export interface MessageActionsProps {
  children: ReactNode;
  text: string;
  onQuote: () => void;
  onDelete?: () => void;
  onForward?: () => void;
  voice?: boolean;
}

type MenuPosition = {x: number; y: number};
const viewportInset = 8;
function clampPosition(position: MenuPosition, element: HTMLElement): MenuPosition {
  return {
    x: Math.max(viewportInset, Math.min(position.x, window.innerWidth - element.offsetWidth - viewportInset)),
    y: Math.max(viewportInset, Math.min(position.y, window.innerHeight - element.offsetHeight - viewportInset)),
  };
}

export default function MessageActions({children, text, onQuote, onDelete, onForward}: MessageActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({x: 0, y: 0});
  const [languageMenu, setLanguageMenu] = useState(false);
  const [languagePosition, setLanguagePosition] = useState<MenuPosition>({x: 0, y: 0});
  const [translation, setTranslation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const translateTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuAnchor = useRef<PopupAnchor>(null);
  const alive = useRef(true);
  const menuPresent = useAnchoredPopupPresence(menuOpen, menuRef, () => menuAnchor.current);
  const languagePresent = useAnchoredPopupPresence(languageMenu && menuOpen, languageRef, () => translateTrigger.current);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const next = clampPosition(menuPosition, menuRef.current);
    setMenuPosition(previous => previous.x === next.x && previous.y === next.y ? previous : next);
  }, [menuOpen, menuPosition, menuPresent]);

  useLayoutEffect(() => {
    if (!menuOpen || !languageMenu || !languageRef.current || !translateTrigger.current || !menuRef.current) return;
    const childWidth = languageRef.current.offsetWidth;
    const right = menuPosition.x + menuRef.current.offsetWidth + 4;
    const next = clampPosition({
      x: right + childWidth <= window.innerWidth - viewportInset ? right : menuPosition.x - childWidth - 4,
      y: menuPosition.y + translateTrigger.current.offsetTop - 6,
    }, languageRef.current);
    setLanguagePosition(previous => previous.x === next.x && previous.y === next.y ? previous : next);
  }, [menuOpen, menuPosition, languageMenu, languagePresent]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menuOpen, menuPresent]);

  useEffect(() => {
    if (languageMenu && menuOpen) languageRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [languageMenu, menuOpen, languagePresent]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => { setMenuOpen(false); setLanguageMenu(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (languageMenu && event.key === 'ArrowLeft')) {
        event.preventDefault();
        if (languageMenu) {
          setLanguageMenu(false);
          translateTrigger.current?.focus();
        } else {
          close();
          trigger.current?.focus();
        }
        return;
      }
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'ArrowRight' && document.activeElement === translateTrigger.current) {
        event.preventDefault();
        setLanguageMenu(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const activeMenu = languageMenu ? languageRef.current : menuRef.current;
      const buttons = Array.from(activeMenu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : at < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
        : (at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
      buttons[next]?.focus();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', key);
    };
  }, [menuOpen, languageMenu]);

  function open(x: number, y: number, anchor: PopupAnchor) {
    menuAnchor.current = anchor;
    setLanguageMenu(false);
    setMenuPosition({x, y});
    setMenuOpen(true);
  }
  function close() {
    setMenuOpen(false);
    setLanguageMenu(false);
  }
  async function translate(target: 'zh' | 'en') {
    close();
    setBusy(true);
    setError('');
    try {
      const response = await npcFetch('/api/npc/audio/translate', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text, target}),
      });
      const result = await response.json() as {text: string; error?: string};
      if (!response.ok) throw Error(result.error || '翻译失败');
      if (alive.current) setTranslation(result.text);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '翻译失败');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return <div className="message-actions"
    onContextMenu={event => { event.preventDefault(); open(event.clientX, event.clientY, {x: event.clientX, y: event.clientY}); }}>
    {children}
    <button ref={trigger} className="message-menu-trigger" type="button" aria-label="消息操作" aria-haspopup="menu" aria-expanded={menuOpen}
      onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        open(rect.left, rect.bottom, event.currentTarget);
      }}
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); open(rect.left, rect.bottom, event.currentTarget); }}><MoreHorizontal size={16}/></button>
    {busy && <output className="message-translation">正在翻译…</output>}
    {translation && <div className="message-translation"><small>译文 <button type="button" onClick={() => setTranslation('')}>收起</button></small>{translation}</div>}
    {error && <div role="alert" className="chat-compose-error">{error}</div>}
    {menuPresent && createPortal(<>
      <div ref={menuRef} className="message-context-menu" role="menu" aria-label="消息操作" style={{left: menuPosition.x, top: menuPosition.y}} onPointerDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { close(); onQuote(); }}><Reply size={17} strokeWidth={1.7} aria-hidden="true"/><span>引用</span></button>
        <button type="button" role="menuitem" disabled={!text} onClick={() => {
          close();
          void navigator.clipboard.writeText(text).catch(() => { if (alive.current) setError('无法访问剪贴板，请手动选择文字复制'); });
        }}><span className="message-action-icon-space" aria-hidden="true"/><span>复制</span></button>
        <button ref={translateTrigger} type="button" role="menuitem" disabled={!text || busy} aria-haspopup="menu" aria-expanded={languageMenu}
          onClick={() => setLanguageMenu(!languageMenu)}><Languages size={17} strokeWidth={1.7} aria-hidden="true"/><span>翻译</span></button>
        <hr className="message-action-divider" aria-hidden="true"/>
        <button type="button" role="menuitem" disabled={!onForward} onClick={() => { close(); onForward?.(); }}><Forward size={17} strokeWidth={1.7} aria-hidden="true"/><span>转发…</span></button>
        <hr className="message-action-divider" aria-hidden="true"/>
        <button className="message-action-delete" type="button" role="menuitem" disabled={!onDelete} onClick={() => { close(); onDelete?.(); }}><span className="message-action-icon-space" aria-hidden="true"/><span>删除</span></button>
      </div>
      {languagePresent && <div ref={languageRef} className="message-context-menu message-language-menu" role="menu" aria-label="选择翻译语言" style={{left: languagePosition.x, top: languagePosition.y}} onPointerDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => void translate('zh')}><span>中文</span></button>
        <button type="button" role="menuitem" onClick={() => void translate('en')}><span>英文</span></button>
      </div>}
    </>, document.body)}
  </div>;
}
