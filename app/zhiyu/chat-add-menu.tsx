'use client';

import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {PawPrint, Plus, UsersRound} from 'lucide-react';
import type {GroupChat} from '../../lib/npc/group-chat';
import PetsDialog from './pets-dialog';
import PressableIconButton from './pressable-icon-button';
import {useAnchoredPopupPresence} from './anchored-popup-motion';
import './chat-add-menu.css';

export default function ChatAddMenu({onCreateGroup}: {
  groups: GroupChat[];
  onCreateGroup: () => void;
  onSelectGroup: (groupId: string) => void;
  onSelectCharacter?: (characterId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [petsOpen, setPetsOpen] = useState(false);
  const [position, setPosition] = useState({left: 0, top: 0});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const present = useAnchoredPopupPresence(open, menu, () => trigger.current);

  useLayoutEffect(() => {
    if (!open || !present) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const node = menu.current;
      if (!anchor || !node) return;
      const width = node.offsetWidth, height = node.offsetHeight;
      const left = Math.max(8, Math.min(anchor.left + (anchor.width - width) / 2, window.innerWidth - width - 8));
      const preferredTop = anchor.bottom + 8;
      const top = preferredTop + height <= window.innerHeight - 8 ? preferredTop : Math.max(8, anchor.top - height - 8);
      setPosition({left, top});
    };
    place();
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);};
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);};
  }, [open]);

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  }

  return <>
    <PressableIconButton ref={trigger} rotateOnClick type="button" className="zy-chat-add-trigger" aria-label="添加与任务" title="添加与任务" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}><Plus size={20} strokeWidth={1.7}/></PressableIconButton>
    {present && createPortal(<div ref={menu} id={menuId} className="zy-chat-add-menu" role="menu" tabIndex={-1} aria-label="添加与任务" aria-hidden={!open} inert={!open} style={position} onKeyDown={menuKeys}>
      <button type="button" role="menuitem" onClick={() => {setOpen(false); onCreateGroup();}}><UsersRound size={17} strokeWidth={1.65}/><span>发起群聊</span></button>
      <button type="button" role="menuitem" onClick={() => {setOpen(false); setPetsOpen(true);}}><PawPrint size={17} strokeWidth={1.65}/><span>宠物</span></button>
    </div>, document.body)}
    {petsOpen && <PetsDialog onClose={()=>{setPetsOpen(false);trigger.current?.focus();}}/>}
  </>;
}
