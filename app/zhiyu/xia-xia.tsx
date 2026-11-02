'use client';
/* eslint-disable next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, CheckCheck, Reply } from 'lucide-react';
import {
  assets,
  type Part,
  type ChatMessage,
  type PublicSession,
} from '../../lib/npc/contracts';
import './xia-xia.css';
import { people } from './data';
import ChatHeader from './chat-header';
import { useChatView } from './chat-view-store';
import ChatImage from './chat-image';
import ChatImagePlaceholder from './chat-image-placeholder';
import NpcContactCard from './npc-contact-card';
import {ImageGallery,chatGallery} from './image-gallery';
import MessageActions from './message-actions';
import {hideMessage, useMessageVisibility} from './message-visibility';
import { bubblePosition } from './message-bubbles';
import ChatComposer, {type ComposePayload} from './chat-composer';
import VoiceBubble from './voice-bubble';
import { npcFetch } from './npc-fetch';
import { useAccount } from './auth-gate';
import { ensureHeChatHistory } from './he-chat-history';
import { ensureChefChatHistory } from './chef-chat-history';
import RelationshipDashboard from './relationship-dashboard';
import type { DisplayPet } from './pet-storage';
import GroupChatSearch, {type GroupSearchEntry} from './group-chat-search';
import {ProfessionalTaskCard, ProfessionalTaskDetailsDialog, ProfessionalTaskEntry} from './professional-task';
import {ingestProfessionalTasks, useProfessionalTasks} from './professional-task-store';
import type {ProfessionalTask} from '../../lib/npc/professional-task';
import {choicePlainText} from '../../lib/npc/choice-chat';
import {allowsCharacterChoice} from '../../lib/npc/character-output-policy';
import ChoiceChat, {type ChoiceChatProps} from './choice-chat';
import type {TaskPageContext} from '../../lib/npc/task-page-context';

function TaskMessage({taskId,onOpen}:{taskId:string;onOpen?:(taskId:string)=>void}){const {account}=useAccount();return <ProfessionalTaskCard accountId={account.id} taskId={taskId} onOpen={onOpen}/>;}
export function NpcPart({ part, characterId, onRetry, messageId, onOpenTask, onChoose, pendingIndex, choiceDisabled, choiceError }: { part: Part; characterId?:string; onRetry?:()=>void; messageId?:string; onOpenTask?:(taskId:string)=>void; onChoose?:ChoiceChatProps['onChoose']; pendingIndex?:number; choiceDisabled?:boolean; choiceError?:string }) {
  if(part.type==='choice')return <ChoiceChat part={part} characterId={characterId} onChoose={onChoose} pendingIndex={pendingIndex} disabled={choiceDisabled} error={choiceError}/>;
  if(part.type==='professional_task')return characterId&&!allowsCharacterChoice(characterId)
    ? <div className="xx-bubble">历史任务消息</div>
    : <TaskMessage taskId={part.taskId} onOpen={onOpenTask}/>;
  if(part.type==='voice')return part.status==='ready'&&part.url?<div className="xx-bubble xx-bubble-voice"><VoiceBubble src={part.url} durationSeconds={part.durationSeconds}/></div>:<div className="npc-voice"><p>{part.status==='pending'?'语音生成中…':part.error||'语音生成失败'}{part.status==='failed'&&<><br/>{part.text}</>}</p></div>;
  if(part.type==='generated_photo')return <figure className="xx-media generated-photo">{part.status==='ready'&&part.url?.trim()?<><ChatImage messageId={messageId} src={part.url} alt={part.caption||'NPC生成的虚构生活场景'}/>{part.caption&&<div className="xx-bubble xx-media-caption">{part.caption}</div>}</>:part.status==='failed'?<ChatImagePlaceholder label="图片未能生成" onRetry={onRetry}/>:part.status==='ready'?<ChatImagePlaceholder/>:<output className={'generated-photo-placeholder '+part.status}><span className="photo-spinner"/><span>正在生成图片…</span><small>完成后会自动显示</small></output>}</figure>;

  if (part.type === 'text' || part.type === 'emoji')
    return (
      <div className={'xx-bubble ' + (part.type === 'emoji' ? 'xx-emoji' : '')}>
        {part.text}
      </div>
    );
  if(part.type==='upload') return <figure className="xx-media upload"><ChatImage messageId={messageId} src={part.url} alt="用户发送的图片"/>{part.text&&<div className="xx-bubble xx-media-caption">{part.text}</div>}</figure>;
  if (!('assetId' in part)) return null;
  const asset = assets[part.assetId];
  return (
    <figure className={'xx-media ' + part.type}>
      <ChatImage messageId={messageId} src={asset.url} alt={asset.description}/>
      <figcaption>{asset.label}</figcaption>{part.caption&&<div className="xx-bubble xx-media-caption">{part.caption}</div>}
    </figure>
  );
}
function messageGroups(messages: ChatMessage[], boundary?:string|null) {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    const last = groups.at(-1),
      previous = last?.at(-1);
    const gap = previous ? Date.parse(message.at) - Date.parse(previous.at) : Infinity;
    const together =
      message.id !== boundary && previous?.role === message.role &&
      ((gap >= 0 && gap < 120000) ||
        (message.role === 'assistant' && previous.turnId === message.turnId));
    if (together) last!.push(message);
    else groups.push([message]);
  }
  return groups;
}
function messageTime(at: string) {
  const date = new Date(at),
    today = new Date().toDateString() === date.toDateString();
  return (
    (today ? '今天 ' : date.toLocaleDateString('zh-CN') + ' ') +
    date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  );
}
function searchMessageText(message:ChatMessage,tasks:readonly ProfessionalTask[]=[]) {
  const part=message.part;
  let text:string;
  switch(part.type){
    case 'choice':text=choicePlainText(part);break;
    case 'professional_task':text='[任务] '+(tasks.find(task=>task.id===part.taskId)?.title||'任务');break;
    case 'voice':text='[语音]'+(part.text?' '+part.text:'');break;
    case 'upload':text='[图片]'+(part.text?' '+part.text:'');break;
    case 'generated_photo':text='[图片]'+(part.caption?' '+part.caption:'');break;
    case 'photo':text='[图片] '+(part.caption||assets[part.assetId].label);break;
    case 'sticker':text=(assets[part.assetId].animated?'[动画表情] ':'[表情] ')+(part.caption||assets[part.assetId].label);break;
    default:text=part.text;
  }
  const legacy=message.legacyContent;
  const attachments=[legacy?.image&&!text.includes('[图片]')?'[图片]':'',legacy?.audio&&!text.includes('[语音]')?'[语音]':'',legacy?.file?'[文件] '+legacy.file:''].filter(Boolean);
  return [...attachments,text].filter(Boolean).join(' ');
}
export default function XiaxiaChat({
  character = 'xia-xia',
  mirror = false,
  displayName,
  companion,
  onOpenNpc,
  onOpenTasks,
  onOpenGroup,
  onProfile,
  onDesktop,
  desktopOpen,
  onCalendar,
  onRealtimeCall,
  onCreateGroup,
  onBeforeSend,
  muted,
  onToggleMute,
  pinned,
  onTogglePin,
  legacyDraft,
  onLegacyDraftConsumed,
  onForward,
  taskPageContext,
  onDismissTaskPageContext,
}: {
  mirror?: boolean;
  character?: 'xia-xia' | 'molly' | 'yuan-xiaoman' | 'liu' | 'chen-nian' | 'he-jiawei' | 'zhou-chef';
  displayName?: string;
  companion?: DisplayPet | null;
  onOpenNpc?: (id: string) => void;
  onOpenTasks?: (scope: 'today'|'all') => void;
  onOpenGroup?: (groupId:string) => void;
  onProfile?:(anchor:HTMLElement)=>void;
  onDesktop?:()=>void;
  desktopOpen?:boolean;
  onCalendar?:()=>void;
  onRealtimeCall?:()=>void;
  onCreateGroup?:()=>void;
  onBeforeSend?:(text:string)=>Promise<boolean>|boolean;
  muted?:boolean;
  onToggleMute?:()=>void;
  pinned?:boolean;
  onTogglePin?:()=>void;
  legacyDraft?:string;
  onLegacyDraftConsumed?:()=>void;
  onForward?:(text:string)=>void;
  taskPageContext?:TaskPageContext;
  onDismissTaskPageContext?:()=>void;
}) {
  const { account } = useAccount();
  const isHe = character === 'he-jiawei';
  const isChef = character === 'zhou-chef';
  const textOnly = isHe || isChef;
  const isMolly = character === 'molly';
  const isYuan = character === 'yuan-xiaoman';
  const isLiu = character === 'liu';
  const isChen = character === 'chen-nian';
  const profile = people.find(p => p.id === character);
  const name = displayName || (isMolly ? 'Molly' : profile?.nickname || profile?.name || '我不是龙虾'),
    shortName = isMolly ? 'Molly' : isChef ? '赵一帆' : isHe ? '嘉伟' : isChen ? '陈年' : isYuan ? '小满' : isLiu ? '智敏' : '夏夏';
  const avatar = isMolly
    ? '/stitch/molly-avatar-v2.png'
    : isChef || isHe || isChen || isLiu ? profile!.avatar! : isYuan ? '/npc/yuan-xiaoman/avatar.png' : '/npc/xia-xia/avatar.png';
  const {data,draft,setDraft,accept,boundary}=useChatView(`${account.id}:${character}`);
  const professionalTasks=useProfessionalTasks(account.id);
  const [taskDialog,setTaskDialog]=useState<{key:string;taskId:string}|null>(null);
  const taskScope=account.id+':'+character,openTaskId=taskDialog?.key===taskScope?taskDialog.taskId:null;
  const setOpenTaskId=(taskId:string|null)=>setTaskDialog(taskId?{key:taskScope,taskId}:null);
  useEffect(()=>{if((isChef||isChen||isLiu)&&data?.professionalTasks)ingestProfessionalTasks(account.id,data.professionalTasks,data.revision,character as 'zhou-chef'|'chen-nian'|'liu');},[account.id,character,isChef,isChen,isLiu,data?.professionalTasks,data?.revision]);
  const hiddenMessages = useMessageVisibility(account.id);
  const visibleMessages = useMemo(() => (data?.messages || []).filter(message => !hiddenMessages[character]?.includes(message.id)), [data?.messages, hiddenMessages, character]);
  const migratedDraft = useRef('');
  useEffect(() => {
    const key = `${account.id}:${character}`;
    if (!isChef || !legacyDraft || migratedDraft.current === key) return;
    migratedDraft.current = key;
    setDraft(current => current || legacyDraft);
    onLegacyDraftConsumed?.();
  }, [account.id, character, isChef, legacyDraft, onLegacyDraftConsumed, setDraft]);
  const gallery=useMemo(()=>chatGallery(visibleMessages,name),[visibleMessages,name]);
  const [error,setError]=useState('');
  const acceptRef=useRef({key:taskScope,accept});acceptRef.current={key:taskScope,accept};
  const acceptSession=useCallback((next:PublicSession)=>{const current=acceptRef.current;if(current.key===taskScope)current.accept(next);},[taskScope]);
  const [sending, setSending] = useState(false);
  const [choiceState,setChoiceState]=useState<{key:string;messageId:string;index?:number;error?:string}|null>(null);
  const choosing=choiceState?.key===taskScope&&choiceState.index!==undefined;
  const choiceLocks=useRef(new Set<string>());
  const choiceRequests=useRef(new Map<string,{index:number;turnId:string}>());
  const [showRelationship, setShowRelationship] = useState(false);
  const [deliveryClock,setDeliveryClock]=useState(Date.now());
  useEffect(()=>{if(!data?.pending)return;const timer=setInterval(()=>setDeliveryClock(Date.now()),250);return()=>clearInterval(timer);},[data?.pending]);
  const [outgoing, setOutgoing] = useState('');
  const [quoted,setQuoted]=useState<ChatMessage|null>(null);
  const validQuoted = quoted && !hiddenMessages[character]?.includes(quoted.id) ? quoted : null;
  const thread = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const excerpt=(m:ChatMessage)=>m.part.type==='professional_task'||m.part.type==='choice'?searchMessageText(m,professionalTasks):m.part.type==='generated_photo'?(m.part.caption||'图片'):'text'in m.part?(m.part.text||'图片'):'图片';
  const [searchOpen,setSearchOpen]=useState(false);
  const [locationHighlight,setLocationHighlight]=useState<{top:number;height:number}|null>(null);
  const [locationRequest,setLocationRequest]=useState<{id:string}|null>(null);
  const locationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>()=>{if(locationTimer.current)clearTimeout(locationTimer.current);},[]);
  const jump=(id:string)=>{setSearchOpen(false);setShowRelationship(false);setLocationRequest({id});};
  useEffect(()=>{
    if(!locationRequest)return;
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      const container=thread.current,el=container?.querySelector<HTMLElement>('[data-message-id="'+CSS.escape(locationRequest.id)+'"]');
      if(!container||!el)return;
      el.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
      const bounds=el.getBoundingClientRect(),streamBounds=container.getBoundingClientRect();
      setLocationHighlight({top:bounds.top-streamBounds.top+container.scrollTop-8,height:bounds.height+16});
      if(locationTimer.current)clearTimeout(locationTimer.current);
      locationTimer.current=setTimeout(()=>setLocationHighlight(null),1500);
    });});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[locationRequest]);
  const searchEntries:GroupSearchEntry[]=visibleMessages.map(message=>{
    const text=searchMessageText(message,professionalTasks);
    return {id:message.id,senderName:message.role==='user'?account.username:name,text,at:message.chronologyUnknown?'':message.at,displayTime:message.legacyTime,
      avatar:message.role==='user'?<span>{account.username.slice(0,1)}</span>:<img src={avatar} alt=""/>,content:<span>{text}</span>};
  });
  const end = useRef<HTMLDivElement>(null),
    retry = useRef<{ text: string; id: string } | null>(null);
  const requestedChenRelationship =
    isChen && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('relationship')
      : '';
  const requestedChenScenario =
    isChen && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('scenario')
      : '';
  const requestedChenGrowth =
    isChen && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('growth')
      : '';
  const endpoint = `/api/npc/${character}?mode=normal${
    requestedChenRelationship === 'lovers' || requestedChenRelationship === 'strangers'
      ? `&relationship=${requestedChenRelationship}`
      : ''
  }${requestedChenScenario === 'early-sharing' ? '&scenario=early-sharing' : ''}${
    requestedChenScenario === 'early-sharing' && /^-?\d{1,3}$/.test(requestedChenGrowth || '')
      ? `&growth=${requestedChenGrowth}`
      : ''
  }`;
  const receivedGroupEvents=useRef(new Set<string>());
  useEffect(() => {
    if (!isMolly || !data)return;
    window.dispatchEvent(new CustomEvent('molly-session', { detail: data }));
    let changed=false;
    for(const message of data.messages){const event=message.secretaryEvent;if(event?.kind!=='group'||!event.groupId)continue;const key=account.id+':'+event.id;if(!receivedGroupEvents.current.has(key)){receivedGroupEvents.current.add(key);changed=true;}}
    if(changed)window.dispatchEvent(new Event('npc-groups-changed'));
  }, [data, isMolly,account.id]);
  const typingClient = useRef(''),
    sequence = useRef(0),
    lastTyping = useRef(0),
    typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalTyping = useCallback((active: boolean) => {
    typingClient.current ||= crypto.randomUUID();
    void npcFetch(endpoint, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Zhiyu-Account':account.id },
      body: JSON.stringify({
        action: 'typing',
        clientId: typingClient.current,
        sequence: ++sequence.current,
        active,
      }),
    }).catch(() => {});
  },[endpoint,account.id]);
  const updateTyping = (value: string) => {
    setDraft(value);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (!value) {
      signalTyping(false);
      lastTyping.current = 0;
      return;
    }
    if (Date.now() - lastTyping.current > 800) {
      signalTyping(true);
      lastTyping.current = Date.now();
    }
    typingTimer.current = setTimeout(() => {
      signalTyping(false);
      lastTyping.current = 0;
    }, 1800);
  };
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      signalTyping(false);
    },
    [signalTyping],
  );
  useEffect(() => {
    const root = thread.current;
    if (!root) return;
    const seen = new Set<string>();
    const mark = () => {
      if (
        document.visibilityState !== 'visible' ||
        !document.hasFocus() ||
        !seen.size
      )
        return;
      const ids = Array.from(seen).slice(0, 100);
      seen.clear();
      void npcFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zhiyu-Account':account.id },
        body: JSON.stringify({ action: 'read', ids }),
      }).catch(() => {});
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.unreadId!;
          if (entry.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        mark();
      },
      { root, threshold: 0.5 },
    );
    root
      .querySelectorAll('[data-unread-id]')
      .forEach((el) => observer.observe(el));
    window.addEventListener('focus', mark);
    document.addEventListener('visibilitychange', mark);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', mark);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [data?.messages,endpoint,textOnly,account.id]);
  const prepareHistory = useCallback(async () => {
    if (isHe) await ensureHeChatHistory(account.id);
    if (isChef) await ensureChefChatHistory(account.id);
  }, [isHe, isChef, account.id]);
  const refreshSession = async () => {
    await prepareHistory();
    const res = await npcFetch(endpoint, { cache: 'no-store', headers:{'X-Zhiyu-Account':account.id} });
    if (
      !res.ok ||
      !res.headers.get('content-type')?.includes('application/json')
    )
      throw new Error('本地 NPC 服务未启动，请使用 npm run dev 启动本项目');
    const json = (await res.json()) as PublicSession;
    acceptSession(json);
    return json;
  };
  useEffect(() => {
    if(mirror)return;
    let alive = true;
    prepareHistory().then(() => npcFetch(endpoint, { cache: 'no-store', headers:{'X-Zhiyu-Account':account.id} }))
      .then(async (res) => {
        if (
          !res.ok ||
          !res.headers.get('content-type')?.includes('application/json')
        )
          throw new Error('本地 NPC 服务未启动');
        const d = (await res.json()) as PublicSession;
        if (alive) {
          acceptSession(d);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [endpoint,acceptSession,mirror,prepareHistory,textOnly,account.id]);
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    const toBottom = () => { el.scrollTop = el.scrollHeight; };
    stickBottom.current = true;
    toBottom();
    const raf = requestAnimationFrame(toBottom);
    const onImgLoad = (e: Event) => {
      if ((e.target as HTMLElement).tagName === 'IMG' && stickBottom.current) toBottom();
    };
    el.addEventListener('load', onImgLoad, true);
    const onScroll = () => {
      stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('load', onImgLoad, true);
      el.removeEventListener('scroll', onScroll);
    };
  }, [data?.messages.length, sending]);
  useEffect(() => {
    if (sending || mirror) return;
    let alive = true;
    const timer = setInterval(() => {
      void prepareHistory().then(() => npcFetch(endpoint, { cache: 'no-store', headers:{'X-Zhiyu-Account':account.id} }))
        .then((res) => {if(!res.ok)throw new Error('暂时无法同步消息');return res.json();})
        .then((d) => { if (alive) acceptSession(d as PublicSession); })
        .catch((e) => { if (alive && textOnly) setError(e instanceof Error ? e.message : '暂时无法同步消息'); });
    }, 1000);
    return () => { alive=false;clearInterval(timer); };
  }, [data?.pending, sending, endpoint,acceptSession,mirror,prepareHistory,textOnly,account.id]);
  async function post(body: Record<string, unknown>) {
    await prepareHistory();
    const res = await npcFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Zhiyu-Account':account.id },
      body: JSON.stringify(body),
    });
    const result = (await res.json()) as PublicSession & { error?: string };
    if (!res.ok) throw new Error(result.error || '请求失败');
    acceptSession(result);
  }
  function deleteMessage(message: ChatMessage) {
    try {
      hideMessage(account.id, character, message.id);
      if (quoted?.id === message.id) setQuoted(null);
      if (locationRequest?.id === message.id) {setLocationRequest(null); setLocationHighlight(null);}
    } catch (failure) {setError(failure instanceof Error ? failure.message : '删除未保存，请重试。');}
  }
  async function clearHistory() {
    await post({action:'clear'});
    setQuoted(null);setLocationHighlight(null);setLocationRequest(null);retry.current=null;
    if(locationTimer.current)clearTimeout(locationTimer.current);
  }
  async function send(payload: ComposePayload) {
    const text = payload.text;
    if ((!text && !payload.imageId && !payload.assetId && !payload.audioId) || sending || choiceLocks.current.has(taskScope)) return;
    // Route a group request before the single-person model or message queue.
    // Keep the original draft when a consent dialog is cancelled.
    if (text && !payload.imageId && !payload.assetId && !payload.audioId && onBeforeSend && await onBeforeSend(text)) return;
    setError('');
    setSending(true);
    setOutgoing(payload.audioId?'[语音]':text || '[图片]');
    setDraft('');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    signalTyping(false);
    lastTyping.current = 0;
    const retryKey=JSON.stringify({...payload,taskPageContext});
    if (retry.current?.text !== retryKey)
      retry.current = { text:retryKey, id: crypto.randomUUID() };
    try {
      await post({ action: 'send', ...payload, turnId: retry.current.id, ...(validQuoted?{replyTo:validQuoted.id}:{}), ...(taskPageContext?{taskPageContext}:{}) });
      setQuoted(null);
      retry.current = null;
    } catch (e) {
      setDraft((current) => current || text);
      setError(e instanceof Error ? e.message : '发送失败');
      await refreshSession().catch(() => {});
      throw e;
    } finally {
      setSending(false);
    }
  }
  async function choose(message:ChatMessage,index:number) {
    if(!allowsCharacterChoice(character)||mirror||sending||choiceLocks.current.has(taskScope)||!data?.available||message.part.type!=='choice'||message.part.selection||!message.part.options[index])return;
    const requestKey=taskScope+':'+message.id;
    const previous=choiceRequests.current.get(requestKey);
    const request=previous?.index===index?previous:{index,turnId:crypto.randomUUID()};
    choiceRequests.current.set(requestKey,request);
    choiceLocks.current.add(taskScope);
    setChoiceState({key:taskScope,messageId:message.id,index});
    setError('');
    try {
      // The server maps this index to the original option; the composer draft stays untouched.
      await post({action:'send',turnId:request.turnId,choice:{messageId:message.id,index}});
      choiceRequests.current.delete(requestKey);
      setChoiceState(current=>current?.key===taskScope&&current.messageId===message.id?null:current);
    } catch(failure) {
      const current=await refreshSession().catch(()=>null);
      const persisted=current?.messages.find(item=>item.id===message.id)?.part;
      if(persisted?.type==='choice'&&persisted.selection?.index===index) {
        choiceRequests.current.delete(requestKey);
        setChoiceState(value=>value?.key===taskScope&&value.messageId===message.id?null:value);
      } else {
        setChoiceState(value=>value?.key===taskScope&&value.messageId===message.id?{key:taskScope,messageId:message.id,error:failure instanceof Error?failure.message:'未能发送，点击选项重试。'}:value);
      }
    } finally {
      choiceLocks.current.delete(taskScope);
    }
  }
  async function ring(kind: 'voice' | 'video') {
    if (textOnly) { setError(`${name}暂未接通实时语音／视频，可以继续文字聊天。`); return; }
    if (kind === 'voice' && onRealtimeCall) {
      setError('');
      onRealtimeCall();
      return;
    }
    try {
      await post(character==='xia-xia'?{ action: 'call', kind, turnId: crypto.randomUUID() }:{action:'send',text:kind==='video'?'[用户发起视频通话请求；当前仅送达呼叫提醒，未接通音视频]':'[用户发起语音通话请求；当前仅送达呼叫提醒，未接通实时音频]',turnId:crypto.randomUUID()});
      setError(
        '呼叫提醒已发送，她醒来后会通过消息回复。实时语音／视频尚未接通。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '呼叫失败');
    }
  }
  return (
    <ImageGallery conversationId={character} images={gallery}><div className="xx-layout">
      <section className="xx-chat" aria-label={shortName + '聊天'}>
        <ChatHeader name={name} avatar={avatar} bio={isMolly?'您的智能机器人助手（闲聊200）':profile?.bio || ''} dialoguePurpose={isMolly?undefined:profile?.dialoguePurpose} professionalTitle={profile?.professionalProfile?.title||profile?.professionalTitle} onProfile={onProfile} onCall={kind=>void ring(kind)} onDesktop={onDesktop} desktopOpen={desktopOpen} onCalendar={onCalendar} onRelationship={!isMolly?()=>setShowRelationship(true):undefined} onCreateGroup={onCreateGroup} muted={muted} onToggleMute={onToggleMute} pinned={pinned} onTogglePin={onTogglePin} onSearch={()=>setSearchOpen(true)} onClear={clearHistory}/>
        {showRelationship ? <RelationshipDashboard name={name} values={data?.relationshipValues} relationship={data?.relationship} loading={!data} onBack={()=>setShowRelationship(false)}/> : <>
        <div className="xx-thread" ref={thread} aria-live="polite">
          {locationHighlight&&<div className="zy-private-location-highlight" aria-hidden="true" style={{top:locationHighlight.top,height:locationHighlight.height}}/>}
          {!visibleMessages.length && (
            <div className="xx-welcome">
              <img className="xx-avatar large" src={avatar} alt={shortName} />
              <h2>{name}</h2>
              <p>和{shortName}打个招呼吧。</p>
            </div>
          )}
          {messageGroups(visibleMessages,boundary).map((group) => {
            const last = group[group.length - 1],
              mine = last.role === 'user',
              read = group.every((m) => !!m.readAt);
            return (
              <div key={group[0].id} className={'xx-group ' + last.role}>
                {group[0].id===boundary && <div className="zy-unread-line"><span/>未读消息<span/></div>}
                <div className="xx-group-row">
                  {!mine && (
                    <button type="button" className="xx-profile-avatar-button" disabled={!onProfile} onClick={event=>onProfile?.(event.currentTarget.querySelector<HTMLElement>('.xx-group-avatar')||event.currentTarget)} aria-label={'查看'+name+'的资料'}><img
                      className="xx-group-avatar"
                      src={avatar}
                      alt={shortName}
                    /></button>
                  )}
                  <div className="xx-group-bubbles">
                    {group.map((m, index) => (
                      <div
                        key={m.id}
                        id={(mirror?"mobile-":"")+"npc-message-"+m.id}
                        data-message-id={m.id}
                        data-unread-id={!mine && !m.readAt ? m.id : undefined}
                        data-message-type={m.part.type}
                        data-bubble-position={bubblePosition(
                          m.part.type === 'text' && !m.replyTo && group[index - 1]?.part.type === 'text' && !group[index - 1]?.recommendations?.length && !group[index - 1]?.taskLinks?.length && group[index - 1]?.secretaryEvent?.kind!=='group',
                          m.part.type === 'text' && !m.recommendations?.length && !m.taskLinks?.length && m.secretaryEvent?.kind!=='group' && group[index + 1]?.part.type === 'text' && !group[index + 1]?.replyTo,
                        )}
                        className="xx-message"
                      >
                        {m.replyTo && (()=>{const original=visibleMessages.find(item=>item.id===m.replyTo);return original?<button type="button" className="npc-quote" onClick={()=>jump(original.id)}><strong>{original.role==='user'?'你':name}</strong><span>{excerpt(original)}</span></button>:null;})()}
                        <MessageActions text={m.part.type==='professional_task'||m.part.type==='choice'?searchMessageText(m,professionalTasks):m.part.type==='voice'||'text'in m.part?m.part.text:m.part.type==='generated_photo'?m.part.caption:('caption'in m.part?m.part.caption||'':'')} voice={m.part.type==='voice'} onQuote={()=>setQuoted(m)} onDelete={()=>deleteMessage(m)} onForward={onForward?()=>onForward(m.part.type==='professional_task'||m.part.type==='choice'?searchMessageText(m,professionalTasks):'text'in m.part?m.part.text:'caption'in m.part?m.part.caption||'':''):undefined}>
                        {m.legacyContent?.image && <figure className="xx-media upload"><ChatImage messageId={m.id} src={m.legacyContent.image} alt="历史聊天图片"/></figure>}
                        {m.legacyContent?.audio && <div className="xx-bubble xx-bubble-voice"><VoiceBubble src={m.legacyContent.audio} durationSeconds={m.legacyContent.audioDurationSeconds}/></div>}
                        {m.legacyContent?.file && <div className="xx-bubble">{m.legacyContent.file}</div>}
                        {(!m.legacyContent || ('text' in m.part && m.part.text)) && <NpcPart messageId={m.id} characterId={character} part={m.part} onOpenTask={setOpenTaskId} onChoose={allowsCharacterChoice(character)&&!mirror&&!mine?index=>void choose(m,index):undefined} pendingIndex={choiceState?.key===taskScope&&choiceState.messageId===m.id?choiceState.index:undefined} choiceDisabled={mirror||mine||sending||choosing||!data?.available} choiceError={choiceState?.key===taskScope&&choiceState.messageId===m.id?choiceState.error:undefined} onRetry={()=>{void npcFetch('/api/npc/images/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({character,messageId:m.id})}).then(async r=>{if(!r.ok)throw Error('图片重试未能启动');await refreshSession();}).catch(e=>setError(e.message));}} />}
                        </MessageActions>
                        {!mine&&m.taskLinks?.length&&onOpenTasks?<div className="xx-task-link-bubbles" aria-label="查看任务">{m.taskLinks.map(link=><button key={link.scope} type="button" className="xx-bubble xx-task-link-bubble" onClick={()=>onOpenTasks(link.scope)}><span className="xx-task-link-label">{link.label}</span></button>)}</div>:null}
                        {!mine&&m.secretaryEvent?.kind==='group'&&m.secretaryEvent.groupId&&onOpenGroup?<div className="xx-task-links"><button type="button" onClick={()=>{if(m.secretaryEvent?.groupId)onOpenGroup(m.secretaryEvent.groupId);}}>进入群聊</button></div>:null}
                        {m.recommendations?.map(candidate => <NpcContactCard key={candidate.id} candidate={candidate} onOpen={onOpenNpc}/>)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="xx-group-meta">
                  <time dateTime={last.at}>{last.legacyTime || messageTime(last.at)}</time>
                  <CheckCheck
                    size={17}
                    className={read ? 'read' : ''}
                    aria-label={read ? '已读' : mine ? '已送达，未读' : '未读'}
                  >
                    <title>{read ? '已读' : '未读'}</title>
                  </CheckCheck>
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="xx-message user">
              <div className="xx-bubble">{outgoing}</div>
              <time>发送中</time>
            </div>
          )}
          {data?.pending && data.typingAfter!==undefined && deliveryClock>=data.typingAfter && (
            <div className="xx-typing-row" role="status" aria-label={`${name}正在输入中`}>
              <img className="xx-group-avatar" src={avatar} alt="" />
              <span className="xx-typing-text" aria-hidden="true">
                {Array.from('对方正在输入中...').map((character, index) => (
                  <span key={index} style={{ animationDelay: `${index * 70}ms` }}>{character}</span>
                ))}
              </span>
            </div>
          )}
          <div ref={end} />
        </div>
        {error && (
          <div className="xx-notice" role="alert">
            {error}
            <button aria-label="关闭提示" onClick={() => setError('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {!error && data?.deliveryError && (
          <output className="xx-notice">{data.deliveryError}{(textOnly || isChen) && <button type="button" disabled={sending || choosing || !!data.pending || !data.available} onClick={()=>void post({action:'retry'}).catch(e=>setError(e.message))}>重新回复</button>}</output>
        )}
        {data && !data.available && (
          <div className="xx-notice">
            Codex 尚未就绪。请在本机终端执行 <code>codex login</code>，再刷新。
          </div>
        )}
        {taskPageContext&&<div className="npc-quote-draft npc-task-page-context" aria-label="当前任务上下文"><Reply size={15}/><span><strong>当前任务：{taskPageContext.title}</strong><small>{taskPageContext.summary.split('\n').slice(0,3).join(' · ')}</small></span><button type="button" onClick={()=>onOpenTasks?.('today')}>查看任务</button><button type="button" aria-label="取消任务上下文" onClick={onDismissTaskPageContext}><X size={16}/></button></div>}
        {validQuoted && <div className="npc-quote-draft"><Reply size={15}/><span><strong>回复 {validQuoted.role==='user'?'你':name}</strong><small>{excerpt(validQuoted)}</small></span><button aria-label="取消引用" onClick={()=>setQuoted(null)}><X size={16}/></button></div>}
        <ChatComposer allowImages={!textOnly} allowVoice={!textOnly} showUnavailableTools value={draft} onChange={updateTyping} onSend={send} disabled={sending || choosing || !data?.available} label={'给'+shortName+'的消息'} placeholder={`和${shortName}说点什么…`} companion={companion} aboveInput={isChef||isChen||isLiu?<ProfessionalTaskEntry accountId={account.id} characterId={character} companion={!!companion} onOpen={setOpenTaskId}/>:undefined}/>
        </>}
        {searchOpen&&<GroupChatSearch name={name} entries={searchEntries} onLocate={jump} onClose={()=>setSearchOpen(false)}/>}
        {openTaskId&&<ProfessionalTaskDetailsDialog accountId={account.id} taskId={openTaskId} onClose={()=>setOpenTaskId(null)} onViewMessage={jump}/>}
      </section>
    </div></ImageGallery>
  );
}
