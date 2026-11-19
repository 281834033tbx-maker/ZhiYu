'use client';
import {reportUserFacingError} from '../../lib/user-facing-errors';

import {useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Reply, Languages, Forward, MoreHorizontal, FileText} from 'lucide-react';
import {npcFetch} from './npc-fetch';
import {MobileComposerContext} from './mobile-composer-context';
import {useAnchoredPopupPresence, type PopupAnchor} from './anchored-popup-motion';
import './message-actions.css';

export interface MessageActionsProps {
  children: ReactNode;
  text: string;
  onQuote: () => void;
  onDelete?: () => void;
  onForward?: () => void;
  voice?: boolean;
  voiceSrc?: string;
  voiceTranscript?: string;
  accountId?: string;
}

type MenuPosition = {x: number; y: number};
type Press = {id: number; x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout>};
const viewportInset = 8;
const longPressMilliseconds = 500;
const longPressMovement = 10;
function clampPosition(position: MenuPosition, element: HTMLElement): MenuPosition {
  return {
    x: Math.max(viewportInset, Math.min(position.x, window.innerWidth - element.offsetWidth - viewportInset)),
    y: Math.max(viewportInset, Math.min(position.y, window.innerHeight - element.offsetHeight - viewportInset)),
  };
}

export default function MessageActions(props: MessageActionsProps) {
  // A reused message slot must never retain another account/recording's text,
  // including a transcription response that finishes after the slot changes.
  const identity = JSON.stringify([props.accountId, props.voiceSrc, props.voice || props.voiceSrc ? props.voiceTranscript ?? props.text : '']);
  return <MessageActionsContent key={identity} {...props}/>;
}

function MessageActionsContent({children, text, onQuote, onDelete, onForward, voice, voiceSrc, voiceTranscript, accountId}: MessageActionsProps) {
  const mobile = useContext(MobileComposerContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({x: 0, y: 0});
  const [languageMenu, setLanguageMenu] = useState(false);
  const [languagePosition, setLanguagePosition] = useState<MenuPosition>({x: 0, y: 0});
  const [translation, setTranslation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const messageRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef<{target: Element; until: number} | null>(null);
  const transcriptCache = useRef<{src: string | undefined; text: string} | null>(null);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const translateTrigger = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuAnchor = useRef<PopupAnchor>(null);
  const alive = useRef(true);
  const menuPresent = useAnchoredPopupPresence(menuOpen, menuRef, () => menuAnchor.current);
  const languagePresent = useAnchoredPopupPresence(languageMenu && menuOpen, languageRef, () => translateTrigger.current);
  const cancelPress = useCallback((blockClick = false) => {
    if (press.current) {
      clearTimeout(press.current.timer);
      if (blockClick) suppressClick.current = {target: press.current.target, until: Date.now() + 1200};
    }
    press.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancelPress(); transcriptionRequest.current?.abort(); };
  }, [cancelPress]);

  useEffect(() => {
    if (!mobile) return;
    const cancel = () => cancelPress();
    const abort = () => cancelPress(true);
    const move = (event: PointerEvent) => {
      const active = press.current;
      if (active && (event.pointerId !== active.id || Math.hypot(event.clientX - active.x, event.clientY - active.y) > longPressMovement)) cancelPress(true);
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || languageRef.current?.contains(event.target))) return;
      cancelPress(true); setMenuOpen(false); setLanguageMenu(false);
    };
    window.addEventListener('pointermove', move, {passive: true});
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', scroll, true);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      cancelPress(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', abort); window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', scroll, true); document.removeEventListener('visibilitychange', cancel);
    };
  }, [mobile, cancelPress]);

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
  async function showTranscript() {
    close();
    if (transcriptionRequest.current) return;
    setTranscriptError('');
    const existing = (voiceTranscript ?? text).trim();
    if (existing && !/^\[(?:语音|语音消息)\]$/.test(existing)) { setTranscript(existing); return; }
    if (transcript) return;
    const source = voiceSrc;
    const cached = transcriptCache.current;
    if (cached && cached.src === source && cached.text) { setTranscript(cached.text); return; }
    let audioId: string | undefined;
    try {
      const url = new URL(source || '', window.location.origin);
      if (url.origin === window.location.origin) audioId = /^\/api\/npc\/audio\/([a-f0-9-]{36}\.(?:webm|mp4|ogg|wav|mp3))$/.exec(url.pathname)?.[1];
    } catch {}
    if (!audioId) { setTranscriptError('这条语音暂时无法转文字，请稍后重试'); return; }
    const controller = new AbortController(); transcriptionRequest.current = controller;
    setTranscribing(true);
    try {
      const response = await npcFetch('/api/npc/audio/transcribe', {
        method: 'POST', headers: {'Content-Type': 'application/json', ...(accountId ? {'X-Zhiyu-Account': accountId} : {})}, body: JSON.stringify({audioId}), signal: controller.signal,
      });
      const result = await response.json() as {text?: string; error?: string};
      if (!response.ok || typeof result.text !== 'string' || !result.text.trim()) throw Error(result.error || '语音转文字失败');
      if (alive.current && !controller.signal.aborted) {
        transcriptCache.current = {src: source, text: result.text.trim()};
        setTranscript(result.text.trim());
      }
    } catch (reason) {
      if (alive.current && !controller.signal.aborted) {
        reportUserFacingError(reason, 'media', '语音转文字');
        setTranscriptError('语音转文字失败，请重试');
      }
    } finally {
      if (transcriptionRequest.current === controller) {
        transcriptionRequest.current = null;
        if (alive.current) setTranscribing(false);
      }
    }
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
      if (alive.current) setError(reportUserFacingError(reason,'load','翻译消息'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return <div ref={messageRef} className={'message-actions' + (mobile ? ' is-mobile' : '') + (voice || voiceSrc ? ' has-voice' : '')}
    onPointerDown={event => {
      if (!mobile || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || event.target.closest('.message-menu-trigger,.message-transcript,.message-translation,.chat-compose-error')) return;
      cancelPress(); suppressClick.current = null;
      const target = event.target, {pointerId: id, clientX: x, clientY: y} = event;
      const timer = setTimeout(() => {
        if (!press.current || press.current.id !== id) return;
        press.current = null;
        suppressClick.current = {target, until: Date.now() + 1200};
        open(x, y, {x, y});
      }, longPressMilliseconds);
      press.current = {id, x, y, target, timer};
    }}
    onPointerLeave={() => cancelPress(true)}
    onClickCapture={event => {
      const suppressed = suppressClick.current;
      if (!suppressed || Date.now() > suppressed.until) { suppressClick.current = null; return; }
      if (event.detail > 0 && event.target instanceof Node && (suppressed.target.contains(event.target) || event.target.contains(suppressed.target))) {
        event.preventDefault(); event.stopPropagation(); suppressClick.current = null;
      }
    }}
    onContextMenu={event => {
      event.preventDefault(); cancelPress();
      if (mobile && event.target instanceof Element) suppressClick.current = {target: event.target, until: Date.now() + 1200};
      open(event.clientX, event.clientY, {x: event.clientX, y: event.clientY});
    }}>
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
    {transcribing && <output className="message-transcript" aria-live="polite">正在转文字…</output>}
    {transcript && <div className="message-transcript"><small>语音文字 <button type="button" onClick={() => setTranscript('')}>收起</button></small>{transcript}</div>}
    {transcriptError && <div role="alert" className="message-transcript message-transcript-error">{transcriptError} <button type="button" disabled={transcribing} onClick={() => void showTranscript()}>重试</button></div>}
    {translation && <div className="message-translation"><small>译文 <button type="button" onClick={() => setTranslation('')}>收起</button></small>{translation}</div>}
    {error && <div role="alert" className="chat-compose-error">{error}</div>}
    {menuPresent && createPortal(<>
      <div ref={menuRef} className={'message-context-menu' + (mobile ? ' is-mobile' : '')} role="menu" aria-label="消息操作" style={{left: menuPosition.x, top: menuPosition.y}} onPointerDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => { close(); onQuote(); }}><Reply size={17} strokeWidth={1.7} aria-hidden="true"/><span>引用</span></button>
        {(voice || voiceSrc) && <button type="button" role="menuitem" disabled={transcribing} onClick={() => void showTranscript()}><FileText size={17} strokeWidth={1.7} aria-hidden="true"/><span>语音转文字</span></button>}
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
      {languagePresent && <div ref={languageRef} className={'message-context-menu message-language-menu' + (mobile ? ' is-mobile' : '')} role="menu" aria-label="选择翻译语言" style={{left: languagePosition.x, top: languagePosition.y}} onPointerDown={event => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => void translate('zh')}><span>中文</span></button>
        <button type="button" role="menuitem" onClick={() => void translate('en')}><span>英文</span></button>
      </div>}
    </>, document.body)}
  </div>;
}
