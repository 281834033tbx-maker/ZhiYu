'use client';

import {accountStorage} from './account-storage';
/* eslint-disable next/no-img-element */

import {Fragment,useContext,useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {AtSign, Bell, Bot, CalendarDays, Check, ChevronDown, ChevronRight, ChevronUp, MoreHorizontal, Megaphone, Plus, RefreshCw, Reply, X} from 'lucide-react';
import PressableIconButton from './pressable-icon-button';
import {useAnchoredPopupPresence} from './anchored-popup-motion';
import type {GroupChat, GroupMember, GroupMessage, GroupReminder, GroupSendMedia} from '../../lib/npc/group-chat';
import type {Person} from './data';
import ChatComposer, {type ComposePayload} from './chat-composer';
import ChatImage from './chat-image';
import VoiceBubble from './voice-bubble';
import {assets} from '../../lib/npc/contracts';
import InlineNameEdit from './inline-name-edit';
import GroupChatSearch from './group-chat-search';
import GroupMemberStack from './group-member-stack';
import MessageActions from './message-actions';
import {ArrangementMessage} from './arrangement-message';
import {hideMessage, useMessageVisibility} from './message-visibility';
import type {DisplayPet} from './pet-storage';
import {bubblePosition} from './message-bubbles';
import './xia-xia.css';
import './group-chat.css';
import './group-message-actions.css';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import {AiDisclosure,RetryableMessage} from './user-facing-ui';
import {useReplyRetry} from './reply-retry';
import {useFailedChatSends} from './chat-send-failures';
import {formatMessageTime} from './message-time';
import {groupMessageBlocks} from './group-message-blocks';
import {useDialogLightDismiss} from './use-dialog-light-dismiss';
import DemoOrderChangeCard from './demo-order-change-card';
import MessageReceipt, {messagesHaveReadReceipt} from './message-receipt';
import {canApplyCutOpeningRecord,CUT_OPENING_SENDER_NAMES} from '../../lib/npc/cut-opening-record';
import {MobileHeaderContext,MobileDetailSurface} from './mobile-pages';
import {MobileIconButton,MobileSubmitButton,MobileSwitch} from './mobile-effects';
import {ArrowLeft} from 'lucide-react';
import CutOpeningRecordDialog from './cut-opening-record-dialog';

function MemberFace({member}: {member: Pick<GroupMember, 'id' | 'name' | 'avatar'>}) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  return member.avatar && member.avatar !== failedAvatar
    ? <img src={member.avatar} alt="" draggable={false} onError={() => setFailedAvatar(member.avatar)}/>
    : member.id === 'molly' ? <Bot aria-hidden="true"/> : <span>{member.name.slice(0, 1)}</span>;
}

export function GroupAvatar({members, size = 34}: {members: GroupMember[]; size?: number}) {
  const first = [...members].sort((a, b) => a.order - b.order || a.joinedAt.localeCompare(b.joinedAt)).slice(0, 4);
  // A single accessible image represents the four independently rendered faces.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <span className={`zy-group-avatar count-${first.length}`} style={{width: size, height: size}} role="img" aria-label={`群头像：${first.map(member => member.name).join('、')}`}>
    {first.map(member => <span key={member.id} className="zy-group-avatar-tile"><MemberFace member={member}/></span>)}
  </span>;
}

export function groupPreview(group: GroupChat) {
  const last = group.messages.at(-1);
  if (!last) return group.chatEnabled ? '群聊已创建' : '群聊尚未开放发言';
  const text = last.type === 'event' ? groupEventLabel(last) : last.text?.trim() || ({image: '[图片]', sticker: '[动画表情]', voice: '[语音]', text: ''}[last.type]);
  return `${last.senderName}：${text}`;
}

export type GroupChatPanelProps = {
  accountId: string;
  group: GroupChat;
  companion?: DisplayPet | null;
  onRename: (name: string) => Promise<unknown>;
  onSend: (text: string, mentionIds: string[], requestId: string, replyTo?: string, media?: GroupSendMedia) => Promise<unknown>;
  onOpen: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onConfirmPlan: (planId: string, requestId: string) => Promise<unknown>;
  onConfirmRecordOrder?: (requestId: string) => Promise<unknown>;
  onImportCutOpeningRecord?: (requestId: string) => Promise<unknown>;
  onRestoreCutOpeningRecord?: (requestId: string) => Promise<unknown>;
  onReminder: (reminderId: string, operation: 'confirm' | 'pause' | 'resume' | 'cancel', requestId: string) => Promise<unknown>;
  availablePeople: Person[];
  onSettings: (settings: {purpose?: string; pinned?: boolean; announcement?: string; muted?: boolean}, requestId: string) => Promise<unknown>;
  onMembers: (addIds: string[], removeIds: string[], requestId: string) => Promise<unknown>;
  onClear: (requestId: string) => Promise<unknown>;
  onExit: (requestId: string) => Promise<unknown>;
  onForward?: (text: string) => void;
};

export function GroupChatPanel(props: GroupChatPanelProps) {
  return <GroupChatPanelContent key={`${props.accountId}:${props.group.id}`} {...props}/>;
}

type MentionQuery = {start: number; end: number; query: string};
type GroupDraft = {text: string; mentionIds: string[]; replyTo?: string};

function sameDraft(left: GroupDraft, right: GroupDraft) {
  return left.text === right.text && left.replyTo === right.replyTo
    && left.mentionIds.length === right.mentionIds.length && left.mentionIds.every((id, index) => id === right.mentionIds[index]);
}

function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const prefix = text.slice(0, caret);
  const start = prefix.lastIndexOf('@');
  if (start < 0 || (start > 0 && /[A-Za-z0-9_.+-]/.test(prefix[start - 1]))) return null;
  const query = prefix.slice(start + 1);
  if (query.length > 40 || /[\s@]/u.test(query)) return null;
  return {start, end: caret, query};
}

function groupEventLabel(message: GroupMessage) {
  const labels = {'plan-confirmed': '确认了一周计划', 'reminder-confirmed': '确认了提醒安排', 'reminder-paused': '暂停了提醒', 'reminder-resumed': '恢复了提醒', 'reminder-cancelled': '取消了提醒'};
  return message.event ? labels[message.event.kind] : '更新了群安排';
}

function groupMessageText(message: GroupMessage) {
  return message.type === 'event' ? groupEventLabel(message)
    : message.text || ({text: '', image: '[图片]', sticker: '[动画表情]', voice: '[语音]'}[message.type]);
}

function groupSenderName(message:GroupMessage,displayNames:Map<string,string>) {
  return message.authoredRecord?.scenario==='three-month-cut-opening-v1'
    ?(CUT_OPENING_SENDER_NAMES as Readonly<Record<string,string>>)[message.senderId]||message.senderName
    :displayNames.get(message.senderId)||message.senderName;
}

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function completeReminder(reminder: GroupReminder) {
  return reminder.timezone === 'Asia/Shanghai' && /^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) && validCalendarDate(reminder.startDate) && validCalendarDate(reminder.endDate) && reminder.startDate <= reminder.endDate;
}

function GroupMessageBody({message, members, displayNames}: {message: GroupMessage; members: GroupMember[]; displayNames: Map<string, string>}) {
  const mentioned = [...new Set(message.mentionIds || [])].map(id => members.find(member => member.id === id)).filter((member): member is GroupMember => !!member);
  const part = message.part;
  const text = part?.type === 'voice' ? '' : message.text || (part ? '' : {text: '', image: '[图片]', sticker: '[动画表情]', voice: '[语音]', event: ''}[message.type]);
  const exactRecord=message.authoredRecord?.scenario==='three-month-cut-opening-v1';
  const everyone=exactRecord&&text.startsWith('@所有人 ');
  const byToken = new Map(mentioned.flatMap(member => [[`@${member.name}`, member], [`@${displayNames.get(member.id) || member.name}`, member]] as [string, GroupMember][]));
  const xiaoman=exactRecord?mentioned.find(member=>member.id==='yuan-xiaoman'):undefined;
  if(xiaoman)byToken.set('@小满',xiaoman);
  const tokens = [...byToken.keys(),...(everyone?['@所有人']:[])].sort((a, b) => b.length - a.length);
  const matcher = tokens.length ? new RegExp(`(${tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g') : null;
  const pieces = matcher ? text.split(matcher) : [text];
  const missing = exactRecord?[]:mentioned.filter(member => !pieces.some(piece => byToken.get(piece)?.id === member.id));
  const caption = <span>{missing.map(member => <span key={member.id}><span className="zy-group-inline-mention" data-member-id={member.id}>@{displayNames.get(member.id) || member.name}</span>{' '}</span>)}{pieces.map((piece, index) => {
    if(everyone&&piece==='@所有人')return <span key={index} className="zy-group-inline-mention" data-member-id="all" data-mentioned-member-ids={mentioned.map(member=>member.id).join(',')}>@所有人</span>;
    const member=byToken.get(piece);return member?<span key={index} className="zy-group-inline-mention" data-member-id={member.id}>{exactRecord?piece:`@${displayNames.get(member.id)||member.name}`}</span>:piece;
  })}</span>;
  if (part?.type === 'upload') return <div className="zy-group-media">{(text || mentioned.length > 0) && caption}<ChatImage messageId={message.id} src={part.url} alt="群聊图片"/></div>;
  if (part?.type === 'voice') return <div className="zy-group-media zy-group-voice">{(text || mentioned.length > 0) && caption}{part.url ? <VoiceBubble src={part.url} durationSeconds={part.durationSeconds} transcript={part.text||message.text}/> : <span>语音暂不可用</span>}</div>;
  if (part?.type === 'sticker') return <div className="zy-group-media">{(text || mentioned.length > 0) && caption}<ChatImage messageId={message.id} src={assets[part.assetId].url} alt={assets[part.assetId].description}/></div>;
  return caption;
}

type FailedGroupSend={requestId:string;text:string;mentionIds:string[];replyTo?:string;media:GroupSendMedia};

function GroupChatPanelContent({accountId, group, companion, onRename, onSend, onOpen, onRetry, onConfirmPlan, onConfirmRecordOrder, onImportCutOpeningRecord, onRestoreCutOpeningRecord, onReminder, availablePeople, onSettings, onMembers, onClear, onExit, onForward}: GroupChatPanelProps) {
  const {mobile,onBack}=useContext(MobileHeaderContext);
  const record = group.authoredRecord;
  const hiddenMessages = useMessageVisibility(accountId);
  const visibleMessages = useMemo(() => group.messages.filter(message => !hiddenMessages[group.id]?.includes(message.id)), [group.messages, hiddenMessages, group.id]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = useRef(false);
  const announcementId = useId();
  const [editingAnnouncement, setEditingAnnouncement] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState(group.announcement || '');
  const [drawerBusy, setDrawerBusy] = useState('');
  const [mobileDrawerPhase,setMobileDrawerPhase]=useState<'announcement'|'members'|null>(null);
  const [mobileAnnouncementPreview,setMobileAnnouncementPreview]=useState(group.announcement||'');
  const mobileDrawerLock=useRef<'announcement'|'members'|null>(null);
  const [drawerError, setDrawerError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'clear' | 'exit' | null>(null);
  const [cutRecordMode,setCutRecordMode]=useState<'update'|'restore'|null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [locatedMessage, setLocatedMessage] = useState<{id: string; top: number; height: number} | null>(null);
  const locationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationFrame = useRef<number | null>(null);
  const [memberMode, setMemberMode] = useState<'add' | null>(null);
  const [memberSelection, setMemberSelection] = useState<string[]>([]);
  const drawer = useRef<HTMLElement>(null);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const drawerPresent = useAnchoredPopupPresence(!mobile&&drawerOpen, drawer, () => drawerToggle.current);
  const drawerLock = useRef(false);
  const drawerRequests = useRef(new Map<string, string>());
  const [{text, mentionIds, replyTo}, setMessageDraft] = useState<GroupDraft>({text: '', mentionIds: []});
  function setText(value: string) {setMessageDraft(previous => ({...previous, text: value}));}
  function setMentionIds(value: string[] | ((previous: string[]) => string[])) {setMessageDraft(previous => ({...previous, mentionIds: typeof value === 'function' ? value(previous.mentionIds) : value}));}
  const [draftHydrated, setDraftHydrated] = useState(false);
  const draftStorageKey = `zhiyu-group-draft-v1:${encodeURIComponent(accountId)}:${encodeURIComponent(group.id)}`;
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sendError, setSendError] = useState('');
  const [failedSends,setFailedSends]=useFailedChatSends<FailedGroupSend>(accountId+':group:'+group.id);
  const savedRequestIds=new Set(group.messages.filter(message=>message.senderId==='user').map(message=>message.requestId));
  const unsentMessages=failedSends.filter(message=>!savedRequestIds.has(message.requestId));
  useEffect(()=>{const saved=new Set(group.messages.filter(message=>message.senderId==='user').map(message=>message.requestId));setFailedSends(current=>{const next=current.filter(message=>!saved.has(message.requestId));return next.length===current.length?current:next;});},[group.messages,setFailedSends]);
  const [deliveryClock,setDeliveryClock]=useState(()=>Date.now());
  const replyKey=accountId+':group:'+group.id+':' +(group.messages.findLast(message=>message.senderId==='user')?.id||group.createdAt);
  const replyRetry=useReplyRetry(replyKey);
  const {claimAutomatic,claimManual,settle:settleReply}=replyRetry;
  const typing=!!group.pending&&!!group.typingName&&group.typingAfter!==undefined&&deliveryClock>=group.typingAfter&&(group.typingUntil===undefined||deliveryClock<group.typingUntil);
  useEffect(()=>{if(!group.pending)return;const timer=setInterval(()=>setDeliveryClock(Date.now()),250);return()=>clearInterval(timer);},[group.pending]);
  useEffect(()=>{
    if(!group.error||group.pending||!claimAutomatic())return;
    void onRetry().catch(cause=>{reportUserFacingError(cause,'send','自动重试群回复');}).finally(settleReply);
  },[group.error,group.pending,claimAutomatic,settleReply,onRetry]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const sendLock = useRef(false);
  const submission = useRef<{requestId: string; text: string; mentionKey: string; replyTo?: string; mediaKey: string} | null>(null);
  const menuId = useId();
  const [showPlan, setShowPlan] = useState(false);
  const [controlBusy, setControlBusy] = useState('');
  const [controlError, setControlError] = useState('');
  const controlRequestIds = useRef(new Map<string, string>());
  const controlLock = useRef(false);
  const lastMessageId = visibleMessages.at(-1)?.id;
  const lastUserMessageId=visibleMessages.findLast(message=>message.senderId==='user')?.id;
  const showMentionMenu = mentionQuery !== null;
  const recipientKey = group.members.filter(member => member.role !== 'user').map(member => member.id).join('\u0000');
  useLayoutEffect(() => {
    const node = composer.current;
    if (!node) return;
    const updateSpace = () => node.style.setProperty('--zy-group-picker-space', `${Math.max(0, node.getBoundingClientRect().top - 16)}px`);
    const observer = new ResizeObserver(updateSpace);
    observer.observe(node); updateSpace();
    window.addEventListener('resize', updateSpace);
    return () => {observer.disconnect(); window.removeEventListener('resize', updateSpace);};
  }, [group.chatEnabled]);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (locationTimer.current) clearTimeout(locationTimer.current);
      if (locationFrame.current) cancelAnimationFrame(locationFrame.current);
    };
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      if (!active.current) return;
      try {
        const stored = accountId ? accountStorage(accountId).getItem(draftStorageKey) : null;
        const saved: unknown = stored ? JSON.parse(stored) : null;
        if (saved && typeof saved === 'object' && 'text' in saved && typeof saved.text === 'string') {
          const ids = 'mentionIds' in saved && Array.isArray(saved.mentionIds) ? saved.mentionIds.filter((id): id is string => typeof id === 'string') : [];
          const savedReplyTo = 'replyTo' in saved && typeof saved.replyTo === 'string' && visibleMessages.some(message => message.id === saved.replyTo) ? saved.replyTo : undefined;
          setMessageDraft({text: saved.text, mentionIds: ids.filter(id => group.members.some(member => member.id === id && member.role !== 'user')), replyTo: savedReplyTo});
        }
      } catch { /* A malformed or unavailable draft store does not block chatting. */ }
      setDraftHydrated(true);
    });
    // This keyed panel hydrates once; membership changes must preserve current text.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [accountId, draftStorageKey]);
  useEffect(() => {
    if (!draftHydrated || !accountId) return;
    try {
      if (text || mentionIds.length || replyTo) accountStorage(accountId).setItem(draftStorageKey, JSON.stringify({text, mentionIds, replyTo}));
      else accountStorage(accountId).removeItem(draftStorageKey);
    } catch { /* Browser storage may be unavailable; the active draft remains usable. */ }
  }, [accountId, draftHydrated, draftStorageKey, text, mentionIds, replyTo]);
  useEffect(() => {
    if (replyTo && !visibleMessages.some(message => message.id === replyTo)) {
      queueMicrotask(() => {if (active.current) setMessageDraft(current => current.replyTo === replyTo ? {...current, replyTo: undefined} : current);});
    }
  }, [visibleMessages, replyTo]);
  useEffect(() => {
    const clearSentDraft = (event: Event) => {
      const detail = (event as CustomEvent<{storageKey: string; draftSnapshot: GroupDraft}>).detail;
      if (!active.current || detail?.storageKey !== draftStorageKey || !detail.draftSnapshot) return;
      const snapshot = detail.draftSnapshot;
      // The functional update also sees hydration or typing queued before this event.
      setMessageDraft(current => sameDraft(current, snapshot) ? {text: '', mentionIds: []} : current);
    };
    window.addEventListener('zhiyu-group-draft-sent', clearSentDraft);
    return () => window.removeEventListener('zhiyu-group-draft-sent', clearSentDraft);
  }, [draftStorageKey]);
  useEffect(() => {
    if (!drawerOpen || confirmAction || mobile) return;
    const close = (event: Event) => {
      if(mobile&&mobileDrawerLock.current)return;
      if (event.type === 'keydown') {
        if ((event as globalThis.KeyboardEvent).key !== 'Escape') return;
        if (event.defaultPrevented || (event.target instanceof Element && event.target.matches('.zy-inline-name-input'))) return;
        setDrawerOpen(false); drawerToggle.current?.focus(); return;
      }
      if (drawer.current?.contains(event.target as Node) || drawerToggle.current?.contains(event.target as Node)) return;
      // Portalled dialogs and menus remain interactive while their originating drawer is open.
      if (event.target instanceof Element && event.target.closest('dialog[open], .message-context-menu, .zy-profile-popover')) return;
      setDrawerOpen(false);
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => {document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close);};
  }, [drawerOpen, confirmAction,mobile]);
  useEffect(() => {
    const allowed = new Set(recipientKey.split('\u0000'));
    queueMicrotask(() => {if (active.current) setMentionIds(previous => previous.some(id => !allowed.has(id)) ? previous.filter(id => allowed.has(id)) : previous);});
  }, [recipientKey]);
  useEffect(() => {
    if (!showMentionMenu) return;
    const closeOutside = (event: Event) => {if (!composer.current?.contains(event.target as Node)) setMentionQuery(null);};
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('focusin', closeOutside);};
  }, [showMentionMenu]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (followBottom.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleMessages.length, lastMessageId, group.pending]);
  const members = [...group.members].sort((a, b) => a.order - b.order || a.joinedAt.localeCompare(b.joinedAt));
  const historicalMembers = [...members, ...(group.formerMembers || []).filter(member => !members.some(active => active.id === member.id))];
  const displayNames = new Map(historicalMembers.map(member => [member.id, member.role === 'user' ? member.name : availablePeople.find(person => person.id === member.id)?.name || member.name]));
  const recipients = members.filter(member => member.role !== 'user');
  const quotedMessage = replyTo ? visibleMessages.find(message => message.id === replyTo) : undefined;
  function deleteMessage(message: GroupMessage) {
    try {
      hideMessage(accountId, group.id, message.id);
      setMessageDraft(previous => previous.replyTo === message.id ? {...previous, replyTo: undefined} : previous);
      if (locatedMessage?.id === message.id) setLocatedMessage(null);
    } catch (failure) {setSendError(reportUserFacingError(failure,'save','删除群消息'));}
  }
  function quoteMessage(message: GroupMessage) {
    if (sendLock.current) return;
    setMessageDraft(previous => ({...previous, replyTo: message.id}));
    setMentionQuery(null); setSendError('');
    requestAnimationFrame(() => {if (active.current) textarea.current?.focus();});
  }
  const candidates = mentionQuery ? recipients.filter(member => !mentionIds.includes(member.id) && (displayNames.get(member.id) || member.name).toLocaleLowerCase().includes(mentionQuery.query.toLocaleLowerCase())) : [];
  const highlightedIndex = candidates.length ? Math.min(mentionIndex, candidates.length - 1) : 0;
  function updateMention(value: string, caret: number) {
    const next = mentionQueryAt(value, caret);
    if ((!next && !mentionQuery) || (next && mentionQuery && next.start === mentionQuery.start && next.end === mentionQuery.end && next.query === mentionQuery.query)) return;
    setMentionQuery(next);
    setMentionIndex(0);
  }
  function chooseMember(member: GroupMember) {
    if (!mentionQuery) return;
    const next = text.slice(0, mentionQuery.start) + text.slice(mentionQuery.end);
    const caret = mentionQuery.start;
    setText(next); setMentionIds(previous => [...new Set([...previous, member.id])]); setMentionQuery(null); setSendError('');
    requestAnimationFrame(() => {
      if (!active.current) return;
      const editor = composer.current?.querySelector('textarea'); editor?.focus(); editor?.setSelectionRange(caret, caret);
    });
  }
  async function sendMessage(payload: ComposePayload) {
    const draftSnapshot: GroupDraft = {text, mentionIds: [...mentionIds], replyTo};
    const outgoing = payload.text.trim();
    const media: GroupSendMedia = {...(payload.imageId ? {imageId: payload.imageId} : {}), ...(payload.audioId ? {audioId: payload.audioId} : {}), ...(payload.assetId ? {assetId: payload.assetId} : {})};
    const mediaKey = JSON.stringify(media);
    const ids = mentionIds.filter(id => recipients.some(member => member.id === id));
    if (!outgoing && !Object.keys(media).length) return;
    if (!group.chatEnabled || group.pending || sendLock.current) throw new Error('请等当前群消息处理完再发送。');
    const mentionKey = ids.join('\u0000');
    let request = submission.current;
    if (!request || request.text !== outgoing || request.mentionKey !== mentionKey || request.replyTo !== replyTo || request.mediaKey !== mediaKey) {
      request = {requestId: crypto.randomUUID(), text: outgoing, mentionKey, replyTo, mediaKey};
      submission.current = request;
    }
    sendLock.current = true; followBottom.current = true; setSending(true); setSendError(''); setMentionQuery(null);
    const failedMessage:FailedGroupSend={requestId:request.requestId,text:outgoing,mentionIds:[...ids],replyTo,media:{...media}};
    try {
      await onSend(outgoing, ids, request.requestId, replyTo, media);
      try {
        const stored = accountStorage(accountId).getItem(draftStorageKey);
        const saved: unknown = stored ? JSON.parse(stored) : null;
        if (saved && typeof saved === 'object' && 'text' in saved && typeof saved.text === 'string' && 'mentionIds' in saved && Array.isArray(saved.mentionIds)) {
          const savedDraft: GroupDraft = {text: saved.text, mentionIds: saved.mentionIds, replyTo: 'replyTo' in saved && typeof saved.replyTo === 'string' ? saved.replyTo : undefined};
          if (sameDraft(savedDraft, draftSnapshot)) accountStorage(accountId).removeItem(draftStorageKey);
        }
      } catch { /* A completed send must not fail because browser storage is unavailable. */ }
      window.dispatchEvent(new CustomEvent('zhiyu-group-draft-sent', {detail: {storageKey: draftStorageKey, draftSnapshot}}));
      if (active.current) {setMessageDraft(current => sameDraft(current, draftSnapshot) ? {text: '', mentionIds: []} : current); submission.current = null; composer.current?.querySelector('textarea')?.focus();}
    } catch(cause) {
      reportUserFacingError(cause,'send','发送群消息');
      if(!mobile)setFailedSends(current=>current.some(item=>item.requestId===failedMessage.requestId)?current:[...current,failedMessage]);
      if(active.current&&!mobile){setMessageDraft(current=>sameDraft(current,draftSnapshot)?{text:'',mentionIds:[]}:current);submission.current=null;}
      if(mobile)throw cause;
    } finally {
      sendLock.current = false;
      if (active.current) setSending(false);
    }
  }
  async function retryFailedSend(failed:FailedGroupSend) {
    if(sendLock.current||group.pending)return;
    sendLock.current=true;setSending(true);
    try {
      await onSend(failed.text,failed.mentionIds,failed.requestId,failed.replyTo,failed.media);
      setFailedSends(current=>current.filter(item=>item.requestId!==failed.requestId));
    }catch(cause){reportUserFacingError(cause,'send','重新发送群消息');}
    finally{sendLock.current=false;if(active.current)setSending(false);}
  }
  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (!mentionQuery && event.key === 'Backspace' && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0 && mentionIds.length) {
      event.preventDefault(); setMentionIds(previous => previous.slice(0, -1)); setSendError(''); return;
    }
    if (mentionQuery) {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setMentionQuery(null); return;}
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation();
        if (candidates.length) setMentionIndex((highlightedIndex + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); event.stopPropagation(); if (candidates.length) chooseMember(candidates[highlightedIndex]); return;}
    }
  }
  async function openChat() {
    if (opening || group.pending) return;
    setOpening(true); setSendError('');
    try {await onOpen();} catch (error) {if (active.current) setSendError(reportUserFacingError(error,'send','开启群聊'));}
    finally {if (active.current) setOpening(false);}
  }
  async function retryReply() {
    if (group.pending||!claimManual()) return;
    setSendError('');
    try {await onRetry();} catch (error) {reportUserFacingError(error,'send','重试群回复');}
    finally {settleReply();}
  }
  const selectedMembers = mentionIds.map(id => recipients.find(member => member.id === id)).filter((member): member is GroupMember => !!member);
  async function controlTask(key: string, task: (requestId: string) => Promise<unknown>, allowWhilePending = false) {
    if (controlLock.current || (group.pending && !allowWhilePending)) return;
    let requestId = controlRequestIds.current.get(key);
    if (!requestId) {requestId = crypto.randomUUID(); controlRequestIds.current.set(key, requestId);}
    controlLock.current = true; setControlBusy(key); setControlError('');
    try {await task(requestId); controlRequestIds.current.delete(key);}
    catch (error) {if (active.current) setControlError(reportUserFacingError(error,'save','保存群安排'));}
    finally {controlLock.current = false; if (active.current) setControlBusy('');}
  }
  const planComplete = group.plan?.days.length === 7 && group.plan.days.every((day, index, days) => validCalendarDate(day.date) && (index === 0 || Date.parse(day.date) - Date.parse(days[index - 1].date) === 86400000) && !!day.label?.trim() && !!day.breakfast?.trim() && !!day.lunch?.trim() && !!day.dinner?.trim());
  const controlBlocked = !!controlBusy || !!group.pending;
  function toggleDrawer() {
    if(mobile&&mobileDrawerLock.current)return;
    if (!drawerOpen) {setAnnouncementDraft(group.announcement || ''); setEditingAnnouncement(false); setDrawerError(''); setMemberMode(null); setMemberSelection([]);}
    setDrawerOpen(value => !value);
  }
  function toggleSelectedMember(id: string) {
    setMemberSelection(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  }
  async function drawerTask(key: string, task: (requestId: string) => Promise<unknown>, propagateError = false) {
    if (drawerLock.current) {
      if (propagateError) throw new Error('请等待当前设置保存完成。');
      return;
    }
    let requestId = drawerRequests.current.get(key);
    if (!requestId) {requestId = crypto.randomUUID(); drawerRequests.current.set(key, requestId);}
    drawerLock.current = true; setDrawerBusy(key); setDrawerError('');
    try {await task(requestId); drawerRequests.current.delete(key); return true;}
    catch (error) {
      if (propagateError) throw error;
      if (active.current) setDrawerError(reportUserFacingError(error,'save','保存群设置'));
      return false;
    }
    finally {drawerLock.current = false; if (active.current) setDrawerBusy('');}
  }
  async function saveMembers() {
    const ids = memberSelection.filter(id => availablePeople.some(person => person.id === id && !members.some(member => member.id === id)));
    if (!ids.length || !memberMode) return;
    const saved = await drawerTask(`members:add:${ids.join(',')}`, requestId => onMembers(ids, [], requestId));
    if (saved && active.current) {
      setMemberMode(null); setMemberSelection([]);
    }
  }
  async function mobileDrawerSave(kind:'announcement'|'members',key:string,task:(requestId:string)=>Promise<unknown>) {
    if(mobileDrawerLock.current)throw Error('请等待当前设置保存完成。');
    if(kind==='announcement')setMobileAnnouncementPreview(group.announcement||'');
    mobileDrawerLock.current=kind;setMobileDrawerPhase(kind);
    const saved=await drawerTask(key,async requestId=>{if(await task(requestId)===false)throw Error('群设置暂时没有保存，请重试。');});
    if(saved!==true)throw Error('群设置暂时没有保存，请重试。');
    return true;
  }
  function settleMobileDrawer(kind:'announcement'|'members',cause?:unknown) {
    if(mobileDrawerLock.current!==kind)return;
    mobileDrawerLock.current=null;
    if(active.current){setMobileDrawerPhase(null);if(cause!==undefined)setDrawerError(reportUserFacingError(cause,'save','保存群设置'));}
  }
  function mobileSetting(key:string,settings:{muted?:boolean;pinned?:boolean}) {
    return drawerTask(key,async requestId=>{if(await onSettings(settings,requestId)===false)throw Error('群设置暂时没有保存，请重试。');});
  }
  const addCandidates = availablePeople.filter(person => !person.group && !['user', 'self', 'molly'].includes(person.id) && !members.some(member => member.id === person.id));
  const drawerDisabled = !!drawerBusy||(mobile&&!!mobileDrawerPhase);
  function locateMessage(id: string) {
    setSearchOpen(false); setDrawerOpen(false); followBottom.current = false;
    if (locationTimer.current) clearTimeout(locationTimer.current);
    if (locationFrame.current) cancelAnimationFrame(locationFrame.current);
    locationFrame.current = requestAnimationFrame(() => {
      locationFrame.current = null;
      if (!active.current || !thread.current) return;
      const target = [...thread.current.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === id);
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      setLocatedMessage({id, top: bounds.top - thread.current.getBoundingClientRect().top + thread.current.scrollTop - 8, height: bounds.height + 16});
      target.scrollIntoView({block: 'center', behavior: 'instant'});
      locationTimer.current = setTimeout(() => {locationTimer.current = null; if (active.current) setLocatedMessage(null);}, 1500);
    });
  }
  const searchEntries = visibleMessages.map(message => {
    const senderName = groupSenderName(message,displayNames);
    const member = historicalMembers.find(item => item.id === message.senderId) || {id: message.senderId, name: message.senderName};
    const messageText = message.type === 'event' ? groupEventLabel(message) : message.text || ({text: '', image: '[图片]', sticker: '[动画表情]', voice: '[语音]'}[message.type]);
    const mentionText = (message.mentionIds || []).map(id => `@${displayNames.get(id) || historicalMembers.find(item => item.id === id)?.name || id}`).join(' ');
    return {id: message.id, at: message.at, senderName, text: `${mentionText} ${messageText}`, avatar: <MemberFace member={member}/>, content: message.type === 'event' ? messageText : <GroupMessageBody message={message} members={historicalMembers} displayNames={displayNames}/>};
  });
  const messageBlocks = groupMessageBlocks(group.messages, hiddenMessages[group.id]);
  return <section className={'zy-chat zy-group-chat'+(mobile?' zy-mobile-chat-page':'')} aria-label={`${group.name}群聊`}>
    <header className="xx-head unified-chat-head zy-group-head">
      {mobile&&<MobileIconButton className="zy-mobile-chat-back" aria-label="返回消息" onClick={onBack}><ArrowLeft size={22}/></MobileIconButton>}
      {mobile?<div className="chat-header-person zy-group-header-person"><span className="zy-mobile-group-avatars">{members.slice(0,3).map(member=><span key={member.id}><MemberFace member={member}/></span>)}</span><span className="chat-header-copy"><strong>{group.name}({group.members.length})</strong>{typing?<small className="zy-mobile-typing" aria-label="正在输入"><i/><i/><i/></small>:<small>Molly 主持</small>}</span></div>:<div className="chat-header-person zy-group-header-person"><GroupAvatar members={group.members}/><span className="chat-header-copy"><strong title={`${group.name}（${group.members.length}）`}>{group.name}（{group.members.length}）</strong>{typing&&<output className="zy-chat-header-status is-typing">{group.typingName} 正在输入…</output>}</span></div>}
      <div className="xx-call-actions"><div className="zy-chat-more"><PressableIconButton ref={drawerToggle} type="button" aria-label="更多选项" title="更多选项" aria-expanded={drawerOpen} onClick={toggleDrawer}><MoreHorizontal size={20} strokeWidth={1.7}/></PressableIconButton></div></div>
    </header>
    {mobile&&group.announcement&&<div className="zy-mobile-group-announcement"><Megaphone size={15} strokeWidth={1.6} aria-hidden="true"/><span>{group.announcement}</span></div>}
    {(group.plan || !!group.reminders?.length) && <div className="zy-group-task-area">
      <button type="button" className="zy-group-task-toggle" aria-expanded={showPlan} onClick={() => setShowPlan(value => !value)}><CalendarDays size={15}/><span>{group.plan?.status === 'confirmed' ? '一周计划 · 已确认' : group.plan ? '一周计划 · 待确认' : '提醒安排'}</span>{showPlan ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
      {showPlan && <div className="zy-group-task-details">
        {group.plan && <>
          <div className="zy-group-plan-table-wrap"><table className="zy-group-plan-table"><thead><tr><th>日期</th><th>安排</th><th>早餐</th><th>午餐</th><th>晚餐</th></tr></thead><tbody>{group.plan.days.map((day, index) => <tr key={`${day.date}-${index}`}><th>{day.date}</th><td>{day.label}</td><td>{day.breakfast}</td><td>{day.lunch}</td><td>{day.dinner}</td></tr>)}</tbody></table></div>
          <details className="zy-group-shopping"><summary>购物清单 · {group.plan.shopping.length} 项</summary><div className="zy-group-plan-table-wrap"><table className="zy-group-plan-table"><thead><tr><th>食材</th><th>计划所需</th><th>家里可用</th><th>还需购买</th></tr></thead><tbody>{group.plan.shopping.map((item, index) => <tr key={`${item.name}-${index}`}><th>{item.name}</th><td>{item.required}</td><td>{item.available}</td><td>{item.toBuy}</td></tr>)}</tbody></table></div></details>
          {group.plan.status === 'draft' ? <div className="zy-group-plan-confirm"><span>{planComplete ? '确认后，大家按这份计划协作。' : '先把七天安排和准确日期补齐，再确认计划。'}</span><button type="button" className="zy-group-submit" disabled={controlBlocked || !planComplete} onClick={() => {const plan = group.plan; if (plan) void controlTask(`plan:${plan.id}`, requestId => onConfirmPlan(plan.id, requestId));}}>{controlBusy === `plan:${group.plan.id}` ? '确认中…' : '确认这份计划'}</button></div> : <p className="zy-group-confirmed-label"><Check size={13}/>计划已确认</p>}
        </>}
        {!!group.reminders?.length && <div className="zy-group-reminders"><h3><Bell size={14}/>提醒安排</h3>{group.reminders.map(reminder => {
          const meal = {breakfast: '早餐', lunch: '午餐', dinner: '晚餐'}[reminder.meal];
          const status = {proposed: '待确认', active: '已启用', paused: '已暂停', cancelled: '已取消'}[reminder.status];
          const complete = completeReminder(reminder);
          return <div className="zy-group-reminder" key={reminder.id}><div><strong>{meal} · {reminder.time}</strong><small>{reminder.startDate} 至 {reminder.endDate} · {reminder.timezone}</small><span>{status}</span>{!complete && <small>时间或日期尚未确定，请先在群里补充。</small>}</div><div className="zy-group-reminder-actions">
            {reminder.status === 'proposed' && <button type="button" disabled={controlBlocked || !complete} onClick={() => void controlTask(`reminder:${reminder.id}:confirm`, requestId => onReminder(reminder.id, 'confirm', requestId))}>确认提醒</button>}
            {reminder.status === 'active' && <button type="button" disabled={!!controlBusy} onClick={() => void controlTask(`reminder:${reminder.id}:pause`, requestId => onReminder(reminder.id, 'pause', requestId), true)}>暂停</button>}
            {reminder.status === 'paused' && <button type="button" disabled={controlBlocked || !complete} onClick={() => void controlTask(`reminder:${reminder.id}:resume`, requestId => onReminder(reminder.id, 'resume', requestId))}>恢复</button>}
            {reminder.status !== 'cancelled' && <button type="button" disabled={!!controlBusy} onClick={() => void controlTask(`reminder:${reminder.id}:cancel`, requestId => onReminder(reminder.id, 'cancel', requestId), true)}>取消</button>}
          </div></div>;
        })}</div>}
        {controlError && <p className="zy-group-error" role="alert">{controlError}</p>}
      </div>}
    </div>}
    <div ref={thread} className={`xx-thread zy-group-thread ${visibleMessages.length ? 'has-messages' : ''}`} onScroll={event => {const node = event.currentTarget; followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;}}>
      {locatedMessage && <div className="zy-group-location-highlight" aria-hidden="true" data-located-message-id={locatedMessage.id} style={{top: locatedMessage.top, height: locatedMessage.height}}/>}
      {messageBlocks.map((block,blockIndex) => {
        const message = block[0],previous=messageBlocks[blockIndex-1]?.at(-1);
        const divider=mobile&&(blockIndex===0||!!previous&&Date.parse(message.at)-Date.parse(previous.at)>=5*60_000)?<div className="xx-time-divider"><time dateTime={message.at}>{formatMessageTime(message.at)}</time></div>:null;
        if (message.type === 'event') return <Fragment key={message.id}>{divider}<div data-message-id={message.id} className={`zy-group-event ${locatedMessage?.id === message.id ? 'is-located' : ''}`}><MessageActions text={`${message.senderName}${groupEventLabel(message)}`} onQuote={() => quoteMessage(message)} onDelete={() => deleteMessage(message)} onForward={onForward ? () => onForward(`${message.senderName}${groupEventLabel(message)}`) : undefined}><span>{message.senderName}{groupEventLabel(message)}</span><time dateTime={message.at}>{formatMessageTime(message.at)}</time></MessageActions></div></Fragment>;
        const last = block.at(-1)!;
        const member = historicalMembers.find(item => item.id === message.senderId) || {id: message.senderId, name: message.senderName};
        const mine = message.senderId === 'user';
        return <Fragment key={message.id}>{divider}<article className={`xx-group ${mine ? 'user' : 'assistant'} zy-group-message-block`}>
          <div className="xx-group-row">
            {!mine && <span className="xx-group-avatar zy-group-message-avatar" aria-label={groupSenderName(message,displayNames)}><MemberFace member={member}/></span>}
            <div className="xx-group-bubbles">
              {mobile&&!mine&&<small className="zy-mobile-group-sender">{groupSenderName(message,displayNames)}</small>}
              {block.map((item, index) => {
                const original = item.replyTo ? visibleMessages.find(candidate => candidate.id === item.replyTo) : undefined;
                const quote = original ? item.quote || {id: original.id, senderName: original.senderName, text: groupMessageText(original)} : undefined;
                return <div key={item.id} className={`xx-message ${locatedMessage?.id === item.id ? 'is-located' : ''}`} data-message-id={item.id} data-bubble-position={bubblePosition(index > 0 && item.type === 'text' && block[index - 1].type === 'text', index < block.length - 1 && item.type === 'text' && block[index + 1].type === 'text')}>
                  {quote && <button type="button" className="npc-quote zy-group-message-quote" onClick={() => locateMessage(quote.id)}><strong>{quote.senderName}</strong><span>{quote.text}</span></button>}
                  <RetryableMessage failed={item.id===lastUserMessageId&&!!group.error&&!group.pending&&replyRetry.attempted&&!replyRetry.pending} disabled={!!group.pending||replyRetry.pending} label="重新回复这条群消息" onRetry={()=>void retryReply()}><MessageActions text={groupMessageText(item)} voice={item.type === 'voice'} voiceSrc={item.part?.type==='voice'?item.part.url:undefined} voiceTranscript={item.part?.type==='voice'?item.part.text:item.text} accountId={accountId} onQuote={() => quoteMessage(item)} onDelete={() => deleteMessage(item)} onForward={onForward ? () => onForward(item.text || '') : undefined}>{(!item.arrangementOffer||!!item.text)&&<div className="xx-bubble zy-group-message-bubble"><GroupMessageBody message={item} members={historicalMembers} displayNames={displayNames}/></div>}</MessageActions></RetryableMessage>
                  {record&&item.recordAction==='order-change'&&<DemoOrderChangeCard confirmed={record.orderChange==='confirmed'} busy={controlBusy==='record-order'} error={controlError} onConfirm={()=>{if(onConfirmRecordOrder)void controlTask('record-order',onConfirmRecordOrder);}}/>}
                  {!mine&&<ArrangementMessage message={item} disabled={sending||!!group.pending}/>}
                </div>;
              })}
            </div>
          </div>
          <div className="xx-group-meta zy-group-message-meta">{!mobile&&<span>{groupSenderName(last,displayNames)}</span>}<time dateTime={last.at}>{formatMessageTime(last.at)}</time>{(record||block.some(item=>item.authoredRecord?.scenario==='three-month-cut-opening-v1'))&&<MessageReceipt read={messagesHaveReadReceipt(block)} unreadLabel={mine?'已送达，未读':'未读'}/>}</div>
        </article></Fragment>;
      })}
      {unsentMessages.map(message=><div className="xx-group user" key={message.requestId}><div className="zy-failed-message"><button type="button" className="zy-message-retry" aria-label="重新发送这条群消息" title="消息没发出去，点一下重试" disabled={sending||!!group.pending} onClick={()=>void retryFailedSend(message)}><RefreshCw size={16}/></button><div className="xx-bubble">{message.text||(message.media.audioId?'[语音]':message.media.assetId?'[表情]':'[图片]')}</div></div></div>)}

    </div>
    {group.chatEnabled ? <div ref={composer} className="zy-group-composer-wrap"><ChatComposer value={text} onChange={value => {setText(value); setSendError('');}} onSend={sendMessage} disabled={sending || !!group.pending} placeholder="发消息，输入 @ 选择成员" label="群聊消息" companion={companion} textareaRef={textarea} onSelectionChange={(value, start) => updateMention(value, start)} onEditorKeyDown={composerKey} inputPrefix={selectedMembers.length > 0 && <div className="zy-group-mention-chips" aria-label="本条消息提及的成员">{selectedMembers.map(member => <span key={member.id} data-member-id={member.id}><AtSign size={11}/>{displayNames.get(member.id) || member.name}<button type="button" aria-label={`取消 @ ${displayNames.get(member.id) || member.name}`} disabled={sending} onClick={() => {setMentionIds(previous => previous.filter(id => id !== member.id)); setSendError('');}}><X size={12}/></button></span>)}</div>} aboveInput={<>
      {quotedMessage && <div className="npc-quote-draft zy-group-quote-draft" aria-label="正在引用的群消息"><Reply size={15}/><span><strong>回复 {groupSenderName(quotedMessage,displayNames)}</strong><small>{groupMessageText(quotedMessage)}</small></span><button type="button" aria-label="取消引用" disabled={sending} onClick={() => {setMessageDraft(previous => ({...previous, replyTo: undefined})); setSendError('');}}><X size={16}/></button></div>}
      {mentionQuery && <div id={menuId} className="zy-group-mention-menu" aria-label="选择要 @ 的成员">
        <div className="zy-group-mention-menu-title">选择成员</div>
        {candidates.map((member, index) => <button id={`${menuId}-${index}`} key={member.id} type="button" className={highlightedIndex === index ? 'is-highlighted' : ''} aria-pressed={highlightedIndex === index} onMouseDown={event => event.preventDefault()} onClick={() => chooseMember(member)}>
          <span className="zy-group-member-face"><MemberFace member={member}/></span><span>{displayNames.get(member.id) || member.name}</span>{member.role === 'admin' && <small>管理员</small>}
        </button>)}
        {!candidates.length && <p>没有匹配的成员</p>}
      </div>}
    </>}/>
      {sendError && <p className="zy-group-error" role="alert">{sendError}</p>}
    </div> : <div className="zy-group-open-composer"><span>Molly 会主持目标和成员分工。</span><button type="button" className="zy-group-submit" disabled={opening || !!group.pending} onClick={() => void openChat()}>{opening || group.pending ? '开启中…' : '开始群聊'}</button>{sendError && <p className="zy-group-error" role="alert">{sendError}</p>}<AiDisclosure/></div>}
    {(mobile?drawerOpen:drawerPresent) && <MobileDetailSurface title="群聊详情" dismissDisabled={drawerDisabled} close={()=>{if(!mobileDrawerLock.current)setDrawerOpen(false);}}><aside ref={drawer} className="zy-group-drawer" aria-label="群聊设置" aria-hidden={!drawerOpen} inert={!drawerOpen}>
      <GroupMemberStack members={members} displayNames={displayNames} renderFace={member => <MemberFace member={member}/>} addAction={<button type="button" className="zy-group-drawer-member zy-group-drawer-member-action" disabled={drawerDisabled || !addCandidates.length} onClick={() => {setMemberMode(value => value === 'add' ? null : 'add'); setMemberSelection([]); setDrawerError('');}} aria-label="添加群成员"><span className="zy-group-drawer-member-face"><Plus size={23}/></span><span>添加</span></button>}/>
      {memberMode && <div className="zy-group-drawer-picker"><p>选择要添加的联系人</p><div className="zy-group-drawer-members">{addCandidates.map(person => <button key={person.id} type="button" className={`zy-group-drawer-member ${memberSelection.includes(person.id) ? 'is-selected' : ''}`} disabled={drawerDisabled} onClick={() => toggleSelectedMember(person.id)} aria-pressed={memberSelection.includes(person.id)}><span className="zy-group-drawer-member-face"><MemberFace member={person}/><i>{memberSelection.includes(person.id) && <Check size={11}/>}</i></span><span>{person.name}</span></button>)}</div><div className="zy-group-drawer-picker-actions"><button type="button" disabled={drawerDisabled} onClick={() => {setMemberMode(null); setMemberSelection([]);}}>取消</button>{mobile?<MobileSubmitButton className="zy-group-submit" disabled={(drawerDisabled&&mobileDrawerPhase!=='members')||!memberSelection.length} onSubmit={()=>{const ids=memberSelection.filter(id=>availablePeople.some(person=>person.id===id&&!members.some(member=>member.id===id)));if(!ids.length||!memberMode)throw Error('请选择要添加的联系人。');return mobileDrawerSave('members',`members:add:${ids.join(',')}`,requestId=>onMembers(ids,[],requestId));}} onComplete={()=>{settleMobileDrawer('members');if(active.current){setMemberMode(null);setMemberSelection([]);}}} onError={cause=>settleMobileDrawer('members',cause)}>添加选中成员</MobileSubmitButton>:<button type="button" className="zy-group-submit" disabled={drawerDisabled || !memberSelection.length} onClick={() => void saveMembers()}>{drawerBusy.startsWith('members:') ? '保存中…' : '添加选中成员'}</button>}</div></div>}
      <div className="zy-group-drawer-details">
        <InlineNameEdit label="群聊名称" value={group.name} required maxLength={40} disabled={drawerDisabled} onSave={name => drawerTask(`name:${name}`, () => onRename(name), true)}/>
        <button type="button" className="zy-group-drawer-value-row" aria-expanded={editingAnnouncement} disabled={drawerDisabled} onClick={() => {setAnnouncementDraft(group.announcement || ''); setEditingAnnouncement(value => !value); setDrawerError('');}}><span className="zy-group-drawer-value-copy"><span className="zy-group-drawer-field-title">群公告</span><span className={`zy-group-drawer-row-value ${(mobile&&mobileDrawerPhase==='announcement'?mobileAnnouncementPreview:group.announcement) ? '' : 'is-placeholder'}`}>{(mobile&&mobileDrawerPhase==='announcement'?mobileAnnouncementPreview:group.announcement) || '未设置'}</span></span><ChevronRight size={15}/></button>
        {editingAnnouncement && (mobile?<form className="zy-group-announcement-editor" onSubmit={event=>event.preventDefault()}>
          <label htmlFor={announcementId}>编辑群公告</label><textarea id={announcementId} value={announcementDraft} maxLength={2000} rows={4} disabled={drawerDisabled} placeholder="写一段群公告" onChange={event=>setAnnouncementDraft(event.target.value)}/><div><button type="button" className="zy-group-cancel" disabled={drawerDisabled} onClick={()=>setEditingAnnouncement(false)}>取消</button><MobileSubmitButton className="zy-group-drawer-save" disabled={drawerDisabled&&mobileDrawerPhase!=='announcement'} onSubmit={()=>{const announcement=announcementDraft.trim();return mobileDrawerSave('announcement',`announcement:${announcement}`,requestId=>onSettings({announcement},requestId));}} onComplete={()=>{settleMobileDrawer('announcement');if(active.current)setEditingAnnouncement(false);}} onError={cause=>settleMobileDrawer('announcement',cause)}>保存</MobileSubmitButton></div>
        </form>:<form className="zy-group-announcement-editor" onSubmit={event => {event.preventDefault(); const announcement = announcementDraft.trim(); void drawerTask(`announcement:${announcement}`, requestId => onSettings({announcement}, requestId)).then(saved => {if (saved && active.current) setEditingAnnouncement(false);});}}>
          <label htmlFor={announcementId}>编辑群公告</label><textarea id={announcementId} value={announcementDraft} maxLength={2000} rows={4} disabled={drawerDisabled} placeholder="写一段群公告" onChange={event => setAnnouncementDraft(event.target.value)}/><div><button type="button" className="zy-group-cancel" disabled={drawerDisabled} onClick={() => setEditingAnnouncement(false)}>取消</button><button type="submit" className="zy-group-drawer-save" disabled={drawerDisabled}>{drawerBusy.startsWith('announcement:') ? '保存中…' : '保存'}</button></div>
        </form>)}
        <InlineNameEdit label="备注" value={group.purpose || ''} placeholder="聊天群" maxLength={120} disabled={drawerDisabled} onSave={purpose => drawerTask(`purpose:${purpose}`, requestId => onSettings({purpose}, requestId), true)}/>
      </div>
      <button type="button" className="zy-group-drawer-search-row" disabled={mobile&&!!mobileDrawerPhase} onClick={() => {setDrawerOpen(false); setSearchOpen(true);}}>查找聊天内容<ChevronRight size={16}/></button>
      <div className="zy-group-drawer-switches">
        {mobile?<div className="zy-group-drawer-pin zy-mobile-setting-row"><span>消息免打扰</span><MobileSwitch label="消息免打扰" checked={!!group.muted} disabled={drawerDisabled} onChange={muted=>{void mobileSetting(`muted:${muted}`,{muted});}}/></div>:<label className="zy-group-drawer-pin"><span>消息免打扰</span><input type="checkbox" role="switch" aria-checked={!!group.muted} aria-label="消息免打扰" checked={!!group.muted} disabled={drawerDisabled} onChange={event => {const muted = event.target.checked; void drawerTask(`muted:${muted}`, requestId => onSettings({muted}, requestId));}}/><span className="zy-group-drawer-switch" aria-hidden="true"/></label>}
        {mobile?<div className="zy-group-drawer-pin zy-mobile-setting-row"><span>置顶聊天</span><MobileSwitch label="置顶聊天" checked={!!group.pinned} disabled={drawerDisabled} onChange={pinned=>{void mobileSetting(`pinned:${pinned}`,{pinned});}}/></div>:<label className="zy-group-drawer-pin"><span>置顶聊天</span><input type="checkbox" role="switch" aria-checked={!!group.pinned} aria-label="置顶聊天" checked={!!group.pinned} disabled={drawerDisabled} onChange={event => {const pinned = event.target.checked; void drawerTask(`pinned:${pinned}`, requestId => onSettings({pinned}, requestId));}}/><span className="zy-group-drawer-switch" aria-hidden="true"/></label>}
      </div>
      <div className="zy-group-drawer-actions">
        {onImportCutOpeningRecord&&canApplyCutOpeningRecord(group)&&<button type="button" disabled={drawerDisabled} onClick={()=>setCutRecordMode('update')}>更新建群记录</button>}
        <button type="button" disabled={drawerDisabled} onClick={() => {setDrawerError(''); setConfirmAction('clear');}}>清空聊天记录</button><button type="button" disabled={drawerDisabled} onClick={() => {setDrawerError(''); setConfirmAction('exit');}}>退出群聊</button></div>
      {drawerError && <p className="zy-group-error" role="alert">{drawerError}</p>}
    </aside></MobileDetailSurface>}
    {searchOpen && <GroupChatSearch name={group.name} memberCount={group.members.length} entries={searchEntries} onLocate={locateMessage} onClose={() => setSearchOpen(false)}/>}
    {cutRecordMode&&(cutRecordMode==='update'?onImportCutOpeningRecord:onRestoreCutOpeningRecord)&&<CutOpeningRecordDialog group={group} mode={cutRecordMode} onClose={()=>setCutRecordMode(null)} onSave={async requestId=>{
      await (cutRecordMode==='update'?onImportCutOpeningRecord!:onRestoreCutOpeningRecord!)(requestId);
      if(active.current)setDrawerOpen(false);
    }}/>}
    {confirmAction && <GroupActionConfirm action={confirmAction} busy={drawerBusy === confirmAction} error={drawerError} onClose={() => {if (!drawerLock.current) {setConfirmAction(null); setDrawerError('');}}} onConfirm={async () => {
      const saved = await drawerTask(confirmAction, requestId => confirmAction === 'clear' ? onClear(requestId) : onExit(requestId));
      if (saved && active.current) {setConfirmAction(null); if (confirmAction === 'clear') {setFailedSends([]);setLocatedMessage(null); setMessageDraft(previous => ({...previous, replyTo: undefined})); followBottom.current = true;}}
    }}/>}
  </section>;
}

function GroupActionConfirm({action, busy, error, onClose, onConfirm}: {action: 'clear' | 'exit'; busy: boolean; error: string; onClose: () => void; onConfirm: () => Promise<void>}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useDialogLightDismiss(dialog, onClose, busy);
  useEffect(() => {const node = dialog.current; node?.showModal(); return () => node?.close();}, []);
  const clearing = action === 'clear';
  return <dialog ref={dialog} className="zy-dialog zy-group-action-dialog" aria-labelledby={titleId} onCancel={event => {event.preventDefault(); if (!busy) onClose();}}>
    <h2 id={titleId}>{clearing ? '清空聊天记录？' : '退出群聊？'}</h2>{!clearing && <p>退出后，这个群将从你的聊天列表移除。</p>}
    {error && <p className="zy-group-error" role="alert">{error}</p>}
    <footer><button type="button" className="zy-group-cancel" disabled={busy} autoFocus onClick={onClose}>取消</button><button type="button" className="zy-group-danger-confirm" disabled={busy} onClick={() => void onConfirm()}>{busy ? '处理中…' : clearing ? '清空' : '退出'}</button></footer>
  </dialog>;
}

export {GroupCreateDialog} from './group-create-dialog';
export type {GroupCreateSelection} from './group-create-dialog';
