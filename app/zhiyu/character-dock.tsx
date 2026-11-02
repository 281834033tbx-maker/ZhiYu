'use client';

/* eslint-disable next/no-img-element -- Existing NPC portraits and project-owned cutouts are local assets. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Heart, Send, X } from 'lucide-react';
import type { ChatMessage, PublicSession } from '../../lib/npc/contracts';
import { choicePlainText } from '../../lib/npc/choice-chat';
import type { Person } from './data';
import { useChatView } from './chat-view-store';
import { npcFetch } from './npc-fetch';
import './character-dock.css';

type DockSize = 'half' | 'full';
type Activity = 'idle' | 'selfie' | 'review';
type Outfit = 'casual' | 'denim';

function spokenText(message: ChatMessage): string {
  if (message.part.type === 'choice') return choicePlainText(message.part);
  if (message.part.type === 'text' || message.part.type === 'emoji' || message.part.type === 'voice') return message.part.text;
  return '';
}

function acceptedChange(reply: string) {
  return /可以|好啊|好的|好呀|行啊|行吧|没问题|试试|换上|穿上|听你的/.test(reply) &&
    !/不行|不能|不想|不换|不穿|没法|算了|下次/.test(reply);
}

function requestedOutfit(text: string): Outfit | null {
  if (!/穿|换|试/.test(text)) return null;
  if (/牛仔|丹宁/.test(text)) return 'denim';
  if (/换回|原来|灰色上衣|灰色衣服/.test(text)) return 'casual';
  return null;
}

function moodScore(data: PublicSession | null): number {
  if (data?.moodLabel === '有点紧张') return 42;
  if (data?.moodLabel === '平静') return 68;
  if (data?.presence === 'busy') return 45;
  return 60;
}

export default function CharacterDock({ person, accountId, size, onSize, onClose, onOpenChat }: {
  person: Person;
  accountId: string;
  size: DockSize;
  onSize: (size: DockSize) => void;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const { data, accept } = useChatView(person.id);
  const isYuan = person.id === 'yuan-xiaoman';
  const sceneSource = person.desktopImage || null;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [bubble, setBubble] = useState('');
  const [activity, setActivity] = useState<Activity>('idle');
  const [outfit, setOutfit] = useState<Outfit>('casual');
  const [away, setAway] = useState(false);
  const lastAssistant = useRef<string | null>(null);
  const processedTurns = useRef<Set<string> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outfitKey = `zhiyu-character-outfit:v1:${accountId}:${person.id}`;
  const endpoint = `/api/npc/${person.id}?mode=normal`;
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    try { setOutfit(localStorage.getItem(outfitKey) === 'denim' ? 'denim' : 'casual'); }
    catch { setOutfit('casual'); }
  }, [outfitKey]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await npcFetch(endpoint, { cache: 'no-store',headers:{'X-Zhiyu-Account':accountId} });
        if (!response.ok) throw new Error('暂时无法同步消息');
        const next = await response.json() as PublicSession;
        if (active) acceptRef.current(next);
      } catch { /* The main chat keeps its existing error handling. */ }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [endpoint,accountId]);

  const changeOutfit = useCallback((next: Outfit) => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    setAway(true);
    setBubble('');
    changeTimer.current = setTimeout(() => {
      setOutfit(next);
      try { localStorage.setItem(outfitKey, next); } catch { /* storage may be disabled */ }
      setActivity('idle');
      setAway(false);
    }, 1100);
  }, [outfitKey]);

  useEffect(() => {
    if (!data) return;
    const messages = data?.messages || [];
    if (processedTurns.current === null) {
      processedTurns.current = new Set(messages.filter(m => m.role === 'user').map(m => m.turnId));
      lastAssistant.current = [...messages].reverse().find(m => m.role === 'assistant')?.id || '';
      return;
    }
    const latest = [...messages].reverse().find(m => m.role === 'assistant' && spokenText(m).trim());
    if (latest && latest.id !== lastAssistant.current) {
      lastAssistant.current = latest.id;
      setBubble(spokenText(latest).trim().slice(0, 90));
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      bubbleTimer.current = setTimeout(() => setBubble(''), 11000);
    }
    if (!isYuan || sceneSource) return;
    for (const userMessage of messages) {
      if (userMessage.role !== 'user' || processedTurns.current.has(userMessage.turnId)) continue;
      const wanted = requestedOutfit(spokenText(userMessage));
      if (!wanted) { processedTurns.current.add(userMessage.turnId); continue; }
      const reply = messages.find(m => m.role === 'assistant' && m.turnId === userMessage.turnId && spokenText(m).trim());
      if (!reply) continue;
      processedTurns.current.add(userMessage.turnId);
      if (acceptedChange(spokenText(reply))) changeOutfit(wanted);
    }
  }, [data?.messages, isYuan, sceneSource, changeOutfit]);

  useEffect(() => {
    if (!isYuan || sceneSource || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const clearActivities = () => { activityTimers.current.forEach(clearTimeout); activityTimers.current = []; };
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible' || away) return;
      setActivity('selfie');
      clearActivities();
      activityTimers.current.push(setTimeout(() => setActivity('review'), 3800));
      activityTimers.current.push(setTimeout(() => setActivity('idle'), 7200));
    }, 33000);
    return () => { clearInterval(interval); clearActivities(); };
  }, [isYuan, sceneSource, away]);

  useEffect(() => () => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    if (changeTimer.current) clearTimeout(changeTimer.current);
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await npcFetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json','X-Zhiyu-Account':accountId },
        body: JSON.stringify({ action: 'send', text, turnId: crypto.randomUUID() }),
      });
      const next = await response.json() as PublicSession & { error?: string };
      if (!response.ok) throw new Error(next.error || '发送失败');
      acceptRef.current(next);
      setDraft('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '发送失败');
    } finally { setSending(false); }
  }

  const mood = moodScore(data);
  const base = '/desktop-npc/yuan-xiaoman/v1/';
  const source = sceneSource || (!isYuan ? person.avatar || '/stitch/molly-avatar-v2.png' : outfit === 'denim'
    ? base + 'denim-standing.png'
    : activity === 'selfie' ? base + 'selfie.png'
    : activity === 'review' ? base + 'review.png'
    : size === 'half' ? base + 'lean.png' : base + 'standing.png');

  return <aside className={'zy-character-dock zy-character-dock-' + size + (sceneSource ? ' zy-character-dock-scene' : '') + (away ? ' is-away' : '')} aria-label={(person.realName || person.name) + '桌面人物'}>
    <section className="zy-character-frame">
      <div className="zy-character-toolbar">
        <span className="zy-character-name">{person.realName || person.name}</span>
        <div className="zy-character-tools">
          {!sceneSource && <button type="button" onClick={() => onSize(size === 'half' ? 'full' : 'half')} aria-label={size === 'half' ? '展开人物全身' : '切换人物半身'} title={size === 'half' ? '展开全身' : '切换半身'}>{size === 'half' ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}</button>}
          <button type="button" onClick={onClose} aria-label="收起桌面人物" title="收起桌面人物"><X size={18} /></button>
        </div>
      </div>
      <div className="zy-character-stage">
        <span className="zy-character-mood" aria-label={`心情 ${mood}`}>
          <Heart aria-hidden="true" />
          <span>{mood}</span>
        </span>
        {bubble && <button type="button" className="zy-character-bubble" onClick={onOpenChat} aria-label="查看聊天中的这条消息">{bubble}</button>}
        <img className={sceneSource ? 'zy-character-scene-image' : isYuan ? 'zy-character-cutout' : 'zy-character-portrait'} src={source} alt={`${person.realName || person.name}的桌面形象`} draggable={false} />
        {!isYuan && !sceneSource && <span className="zy-character-asset-note">全身动作素材待制作</span>}
        {size === 'half' && !sceneSource && <span className="zy-character-sill" aria-hidden="true" />}
      </div>
      <form className="zy-character-compose" onSubmit={send}>
        <label className="sr-only" htmlFor={`zy-character-input-${person.id}`}>给{person.realName || person.name}发消息</label>
        <input id={`zy-character-input-${person.id}`} value={draft} onChange={event => setDraft(event.target.value)} placeholder="说点什么…" disabled={sending || !data?.available} />
        <button type="submit" disabled={!draft.trim() || sending || !data?.available} aria-label="发送消息"><Send size={17} /></button>
      </form>
      {error && <output className="zy-character-error" role="alert">{error}</output>}
    </section>
  </aside>;
}
