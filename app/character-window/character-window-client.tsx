'use client';

/* eslint-disable next/no-img-element -- Character scenes are the exact user-approved local assets. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Part, PublicSession } from '../../lib/npc/contracts';
import ChatComposer, { type ComposePayload } from '../zhiyu/chat-composer';
import { molly, allPeople, type Message } from '../zhiyu/data';
import { bubblePosition } from '../zhiyu/message-bubbles';
import {appendLocalCharacterMessage,localCharacterChatKey,localCharacterIds,readLocalCharacterChat} from '../zhiyu/local-character-chat';
import { useAccount } from '../zhiyu/auth-gate';
import { npcFetch } from '../zhiyu/npc-fetch';
import { ensureHeChatHistory } from '../zhiyu/he-chat-history';
import { ensureChefChatHistory } from '../zhiyu/chef-chat-history';
import {notificationMessages, readMutedChats, useChatMuted} from '../zhiyu/chat-mute';
import RealtimeVoiceCall from '../zhiyu/realtime-voice-call';
import XiaomanVideoScene from './xiaoman-video-scene';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import './character-window.css';
import {useContinuousUse} from '../zhiyu/use-continuous-use';
import {AiDisclosure} from '../zhiyu/user-facing-ui';

const liveCharacters = new Set(['chen-nian', 'yuan-xiaoman', 'xia-xia', 'liu', 'molly', 'he-jiawei', 'zhou-chef']);
const textOnlyCharacters = new Set(['he-jiawei', 'zhou-chef']);
type FloatingMessage = { id: string; mine: boolean; text: string };
type FloatingChat = { key: string; messages: FloatingMessage[] };
type AuthenticationScope = {
  accountId: string;
  active: boolean;
  invalidated: boolean;
  controllers: Set<AbortController>;
  checking: Promise<boolean> | null;
  reloadTimer?: ReturnType<typeof setTimeout>;
};

function messageText(part: Part): string {
  if(part.type==='professional_task')return '[任务] 可在聊天窗口查看和完成';
  if(part.type==='text'||part.type==='emoji'||part.type==='voice')return part.text;
  if(part.type==='upload')return part.text || '[图片]';
  if(part.type==='generated_photo')return part.caption || '[图片]';
  return 'caption' in part ? part.caption || '[图片]' : '[消息]';
}

function subscribeLocation(onChange:()=>void) {
  window.addEventListener('popstate',onChange);
  return()=>window.removeEventListener('popstate',onChange);
}
function readWindowPerson() {
  const requested=new URLSearchParams(window.location.search).get('npc');
  return [molly,...allPeople].some(person=>person.id===requested)?requested:null;
}
export default function CharacterWindowClient() {
  const {account}=useAccount();
  const personId=useSyncExternalStore(subscribeLocation,readWindowPerson,()=>null);
  return <CharacterWindowSession key={`${account.id}:${personId||''}`} personId={personId}/>;
}
function CharacterWindowSession({personId}:{personId:string|null}) {
  const {account}=useAccount();
  const [session, setSession] = useState<{ key: string; data: PublicSession } | null>(null);
  const [localChat,setLocalChat]=useState<{ key: string; messages: Message[] } | null>(null);
  const [floatingChat,setFloatingChat]=useState<FloatingChat | null>(null);
  const [chatOverflowing,setChatOverflowing]=useState(false);
  const [draft, setDraft] = useState('');
  const [macFullscreen, setMacFullscreen] = useState(false);
  const [authChanged, setAuthChanged] = useState(false);
  const [syncError, setSyncError] = useState<{ key: string; text: string } | null>(null);
  const [callBusy,setCallBusy]=useState<{key:string;busy:boolean}|null>(null);
  const [callPresentation,setCallPresentation]=useState<{key:string;active:boolean}|null>(null);
  const titlebar = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLElement>(null);
  const chatBox = useRef<HTMLDivElement>(null);
  const stream = useRef<{ key: string; seen: Set<string>; initialized: boolean } | null>({key:`${account.id}:${personId||''}`,seen:new Set(),initialized:false});
  const authentication = useRef<AuthenticationScope | null>(null);

  const invalidateAuthentication = useCallback((scope: AuthenticationScope) => {
    if (!scope.active || scope.invalidated || authentication.current !== scope) return;
    scope.invalidated = true;
    scope.controllers.forEach(controller => controller.abort());
    setSession(null);
    setLocalChat(null);
    setFloatingChat(null);
    setChatOverflowing(false);
    setDraft('');
    setSyncError(null);
    stream.current = null;
    setAuthChanged(true);
    // Remove the call first, then let AuthGate read the current cookie.
    scope.reloadTimer = setTimeout(() => {
      if (scope.active && authentication.current === scope) window.location.reload();
    }, 0);
  }, []);

  const verifyAuthentication = useCallback(async (): Promise<boolean> => {
    const scope = authentication.current;
    if (!scope?.active || scope.invalidated || scope.accountId !== account.id) return false;
    if (scope.checking) return scope.checking;
    scope.checking = (async () => {
      const controller = new AbortController();
      scope.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (!scope.active || scope.invalidated || authentication.current !== scope) return false;
        if (response.status === 401) { invalidateAuthentication(scope); return false; }
        if (!response.ok) return false;
        const result = await response.json() as { authenticated?: boolean; account?: { id?: string } };
        if (!scope.active || scope.invalidated || authentication.current !== scope) return false;
        if (result.authenticated !== true || result.account?.id !== scope.accountId) {
          invalidateAuthentication(scope);
          return false;
        }
        return true;
      } catch { return false; }
      finally {
        clearTimeout(timeout);
        scope.controllers.delete(controller);
        scope.checking = null;
      }
    })();
    return scope.checking;
  }, [account.id, invalidateAuthentication]);

  useEffect(() => {
    const scope: AuthenticationScope = { accountId: account.id, active: true, invalidated: false, controllers: new Set(), checking: null };
    authentication.current = scope;
    return () => {
      scope.active = false;
      scope.controllers.forEach(controller => controller.abort());
      if (scope.reloadTimer) clearTimeout(scope.reloadTimer);
      if (authentication.current === scope) authentication.current = null;
    };
  }, [account.id]);

  useEffect(() => {
    const check = () => { void verifyAuthentication(); };
    const checkVisible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', checkVisible);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', checkVisible); };
  }, [verifyAuthentication]);

  useEffect(() => {
    // Live NPCs already check with their existing polling loop.
    if (!personId || liveCharacters.has(personId)) return;
    const timer = setInterval(() => { void verifyAuthentication(); }, 2500);
    return () => clearInterval(timer);
  }, [personId, verifyAuthentication]);

  useEffect(() => {
    const desktop = window.zhiyuDesktop;
    if (desktop?.platform !== 'darwin') return;
    let active = true;
    void desktop.getCharacterFullScreen?.().then(value => { if (active) setMacFullscreen(value); });
    const unsubscribe = desktop.onCharacterFullScreenChange?.(setMacFullscreen);
    return () => { active = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!personId || !liveCharacters.has(personId)) return;
    let active = true;
    let polling = false;
    const pending = new Set<AbortController>();
    const key = `${account.id}:${personId}`;
    const endpoint = `/api/npc/${personId}?mode=normal`;
    const poll = async () => {
      if (!active) return;
      if (polling) { void verifyAuthentication(); return; }
      polling = true;
      let controller: AbortController | undefined;
      let scope: AuthenticationScope | null = null;
      try {
        if (!await verifyAuthentication() || !active) return;
        scope = authentication.current;
        if (!scope?.active || scope.invalidated) return;
        if (textOnlyCharacters.has(personId)) {
          if (personId === 'he-jiawei') await ensureHeChatHistory(account.id);
          else await ensureChefChatHistory(account.id);
          if (!active || !scope.active || scope.invalidated || authentication.current !== scope || !await verifyAuthentication()) return;
        }
        controller = new AbortController();
        scope.controllers.add(controller);
        pending.add(controller);
        const response = await npcFetch(endpoint, {
          cache: 'no-store', signal: controller.signal,
          headers: { 'X-Zhiyu-Account': account.id },
        });
        if (response.status === 401) { invalidateAuthentication(scope); return; }
        if (!response.ok) throw new Error('暂时无法同步人物状态');
        const next = await response.json() as PublicSession;
        if (!active || !scope.active || scope.invalidated || authentication.current !== scope) return;
        if (!await verifyAuthentication()) return;
        if (active && scope.active && !scope.invalidated && authentication.current === scope) {
          setSession({ key, data: next });
          if (textOnlyCharacters.has(personId)) setSyncError(null);
        }
      } catch (cause) {
        if (textOnlyCharacters.has(personId) && active && scope?.active && !scope.invalidated && authentication.current === scope) {
          setSyncError({ key, text: reportUserFacingError(cause,'load','同步人物消息') });
        }
      }
      finally {
        if (controller) { pending.delete(controller); scope?.controllers.delete(controller); }
        polling = false;
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2500);
    return () => { active = false; clearInterval(timer); pending.forEach(controller => controller.abort()); };
  }, [account.id,personId,verifyAuthentication,invalidateAuthentication]);

  useEffect(()=>{
    if(!personId || liveCharacters.has(personId) || !localCharacterIds.some(id=>id===personId))return;
    const key=`${account.id}:${personId}`;
    const sync=()=>{
      const scope=authentication.current;
      if(scope?.active&&!scope.invalidated&&scope.accountId===account.id)setLocalChat({key,messages:readLocalCharacterChat(account.id,personId)});
    };
    sync();
    const onStorage=(event:StorageEvent)=>{
      if(event.key===localCharacterChatKey(account.id,personId))sync();
    };
    window.addEventListener('storage',onStorage);
    return()=>window.removeEventListener('storage',onStorage);
  },[account.id,personId]);

  const person = [molly, ...allPeople].find(item => item.id === personId);
  const scene = person?.desktopImage;
  const source = scene || person?.avatar;
  const isLive=!!personId&&liveCharacters.has(personId);
  const chatKey=`${account.id}:${personId||''}`;
  const chatMuted = useChatMuted(account.id, personId);
  const data=session?.key===chatKey?session.data:null;
  const localMessages=localChat?.key===chatKey?localChat.messages:null;
  const incomingMessages:FloatingMessage[] | null=isLive
    ? data?.messages.map(message=>({id:message.id,mine:message.role==='user',text:messageText(message.part)})) || null
    : localMessages?.map(message=>({id:message.id,mine:message.mine,text:message.text|| (message.image?'[图片]':message.audio?'[语音]':'[消息]')})) || null;
  const visibleMessages=floatingChat?.key===chatKey?floatingChat.messages:[];
  const realtimeLayout=!!person;
  const callActive=realtimeLayout&&(callPresentation?.key!==chatKey||callPresentation.active);
  const onCallBusyChange=useCallback((busy:boolean)=>setCallBusy(previous=>previous?.key===chatKey&&previous.busy===busy?previous:{key:chatKey,busy}),[chatKey]);
  useContinuousUse({accountId:account.id,characterId:personId||'molly',enabled:!!personId&&!authChanged,busy:!!(callBusy?.key===chatKey&&callBusy.busy)||!!data?.pending});
  const onCallActiveChange=useCallback((active:boolean)=>setCallPresentation(previous=>previous?.key===chatKey&&previous.active===active?previous:{key:chatKey,active}),[chatKey]);

  useEffect(()=>{
    const box=chatBox.current;
    if(!box){setChatOverflowing(false);return;}
    setChatOverflowing(box.scrollHeight>box.clientHeight+1);
    box.scrollTo({top:box.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  },[floatingChat?.messages]);

  useEffect(()=>{
    if(!personId || !incomingMessages)return;
    const current=stream.current;
    if(!current || current.key!==chatKey)return;
    const fresh=incomingMessages.filter(message=>!current.seen.has(message.id));
    incomingMessages.forEach(message=>current.seen.add(message.id));
    if(!current.initialized){
      // Existing chat history is the baseline. It never pops up when this window opens.
      current.initialized=true;
      return;
    }
    const mutedNow = chatMuted || readMutedChats(account.id).includes(personId);
    const visibleFresh = notificationMessages(fresh, mutedNow);
    if(!visibleFresh.length && !mutedNow)return;
    setFloatingChat(previous=>{
      const existing=previous?.key===chatKey?previous.messages:[];
      const visibleExisting=notificationMessages(existing,mutedNow);
      if(!visibleFresh.length && visibleExisting.length===existing.length)return previous;
      return {key:chatKey,messages:[...visibleExisting,...visibleFresh]};
    });
  },[chatKey,personId,incomingMessages,chatMuted,account.id]);

  async function send(payload: ComposePayload) {
    if (!personId) return;
    if (!await verifyAuthentication()) {
      const current=authentication.current;
      if(current?.active&&!current.invalidated&&current.accountId===account.id)throw new Error('暂时无法确认登录状态，请稍后重试。');
      return;
    }
    const scope=authentication.current;
    if(!scope?.active||scope.invalidated||scope.accountId!==account.id)return;
    if(textOnlyCharacters.has(personId)&&(payload.imageId||payload.imageUrl||payload.audioId||payload.audioUrl||payload.assetId))throw new Error(`${person?.realName || person?.name || '人物'}目前支持文字和小表情聊天。`);
    if(!isLive){
      const message:Message={id:crypto.randomUUID(),mine:true,text:payload.text||payload.audioText||'',image:payload.imageUrl,audio:payload.audioUrl,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})};
      setLocalChat({key:chatKey,messages:appendLocalCharacterMessage(account.id,personId,message)});
      setDraft('');
      return;
    }
    const controller=new AbortController();
    scope.controllers.add(controller);
    try {
      if(textOnlyCharacters.has(personId)) {
        if (personId === 'he-jiawei') await ensureHeChatHistory(account.id);
        else await ensureChefChatHistory(account.id);
        if(!scope.active||scope.invalidated||authentication.current!==scope||!await verifyAuthentication())return;
      }
      const response = await npcFetch(`/api/npc/${personId}?mode=normal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zhiyu-Account': account.id },
        body: JSON.stringify({ action: 'send', ...payload, turnId: crypto.randomUUID() }),
        signal:controller.signal,
      });
      if(response.status===401){invalidateAuthentication(scope);return;}
      const next = await response.json() as PublicSession & { error?: string };
      if(!scope.active||scope.invalidated||authentication.current!==scope)return;
      if (!response.ok) throw new Error(next.error || '发送失败');
      if(!await verifyAuthentication()||!scope.active||scope.invalidated||authentication.current!==scope)return;
      setSession({key:chatKey,data:next});
      setDraft('');
    } catch(cause) {
      if(scope.active&&!scope.invalidated&&authentication.current===scope)throw cause;
    } finally {scope.controllers.delete(controller);}
  }

  if(authChanged)return <main className="zy-app zy-character-window" aria-label="正在刷新登录状态"><output style={{padding:20}}>正在刷新登录状态…</output></main>;

  return <main className={`zy-app zy-character-window${macFullscreen?' is-mac-fullscreen':''}${realtimeLayout?' has-realtime-layout':''}${callActive?' is-call-active':''}`} aria-label="桌面人物窗口">
    <div ref={titlebar} className="zy-character-window-titlebar" aria-label={macFullscreen?'全屏窗口控制':undefined}>
      {macFullscreen&&<button type="button" className="zy-character-window-exit-fullscreen" onClick={()=>void window.zhiyuDesktop?.setCharacterFullScreen?.(false)}>退出全屏 <kbd>Esc</kbd></button>}
    </div>
    <div className="zy-character-window-stage">
      {personId==='yuan-xiaoman'&&scene
        ? <XiaomanVideoScene fallback={scene}/>
        : scene
          ? <img className="zy-character-window-scene-direct" src={scene} alt={person?.realName || person?.name || '智友'} draggable={false}/>
          : source
            ? <img className="zy-character-window-avatar" src={source} alt={person?.realName || person?.name || '智友'} draggable={false} />
            : personId==='zhou-chef'&&<div className="zy-character-window-avatar" style={{color:'#fff',display:'grid',placeContent:'center',textAlign:'center'}}><h1>赵一帆</h1></div>}
      {visibleMessages.length>0&&<aside className="zy-character-window-chat" role="log" aria-label={`${person?.name||'人物'}的新消息`} aria-live="polite">
        <div ref={chatBox} className={`zy-character-window-chat-scroll${chatOverflowing?' is-overflowing':''}`}>
          {visibleMessages.map((message,index)=><div
            className={`zy-character-window-chat-message ${message.mine?'is-mine':'is-npc'}`}
            data-bubble-position={bubblePosition(!!(index&&visibleMessages[index-1].mine===message.mine),!!(visibleMessages[index+1]&&visibleMessages[index+1].mine===message.mine))}
            aria-label={`${message.mine?'我':person?.name||'人物'}：${message.text}`}
            key={message.id}
          ><div className="zy-character-window-chat-bubble"><span>{message.text}</span></div></div>)}
        </div>
      </aside>}
      {person&&<RealtimeVoiceCall key={chatKey}
        name={person.nickname||person.name} character={person.id} gender={person.gender} available={personId==='yuan-xiaoman'} authorize={verifyAuthentication} onCallActiveChange={onCallActiveChange} onBusyChange={onCallBusyChange}/>}
      {person&&<div className="zy-character-call-disclosure"><AiDisclosure/></div>}
    </div>
    {!realtimeLayout&&<section ref={composer} className="zy-character-window-composer" aria-label="发送消息">
      {syncError?.key===chatKey&&<div className="chat-compose-error" role="alert">{syncError.text}</div>}
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSend={send}
        allowImages={!personId || !textOnlyCharacters.has(personId)}
        allowVoice={false}
        disabled={!personId || (isLive&&!data?.available) || (!isLive&&!localMessages)}
        label="给智友的消息"
        placeholder="和智友说点什么…"
      />
    </section>}
  </main>;
}
