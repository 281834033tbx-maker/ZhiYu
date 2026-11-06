'use client';

// Stitch assets are already hosted locally; native images also support user-selected data URLs.
/* eslint-disable next/no-img-element */
import { useNpcMoments } from './use-npc-moments';
import MessageActions from './message-actions';
import MessageForwardDialog, {type ForwardTarget} from './message-forward-dialog';
import {hideMessage, isMessageHidden, useMessageVisibility} from './message-visibility';
import LocalChatHeader from './local-chat-header';
import ChatAddMenu from './chat-add-menu';
import TaskBoard from './task-board/task-board';
import {useTaskBoard} from './task-board/use-task-board';
import {useLiveTaskImport} from './task-board/use-live-task-import';
import DirectoryDivider from './directory-divider';
import type {Task as BoardTask} from './task-board/types';
import {taskPageContextFor} from './task-board/task-context';
import {refreshTaskCompletions} from './task-completion-sync';
import {shanghaiToday,taskCalendarRange,taskItemsForDate} from './task-items';
import {openTaskCalendarWindow, bindTaskCalendarWindowLifecycle} from './task-calendar-window';
import {ingestProfessionalTasks,useProfessionalTasks} from './professional-task-store';
import AppSettings from './app-settings';
import RailNavigation, {RailNotificationDot} from './rail-navigation';
import LiquidBasePlate from './liquid-base-plate';
import PageErrorBoundary from './page-error-boundary';
import {ChatIdentityNotice} from './user-facing-ui';
import {resolveCharacterStatus} from '../../lib/npc/character-status';
import {contactSourceLabel,type CharacterStatus} from '../../lib/npc/experience';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import {features} from './features';
import {useContinuousUse} from './use-continuous-use';
import './me-page.css';
import ProfessionalProfile from './professional-profile';
import ProfilePopover from './profile-popover';
import { SelfProfileCard } from './self-profile-card';
import {appendLocalCharacterMessage,localCharacterChatKey,localCharacterIds,readLocalCharacterChat} from './local-character-chat';
import BrandEntrance from './brand-entrance';
import ChatComposer from './chat-composer';
import MessageReceipt from './message-receipt';
import MomentPostInteractions from './moment-post-interactions';
import MomentCommentEditor from './moment-comment-editor';
import './moments-refinement.css';
import {formatConversationTime} from '../../lib/npc/conversation-time';
import VoiceBubble from './voice-bubble';
import ChatImage from './chat-image';
import XiaxiaChat from './xia-xia';
import { ensureHeChatHistory } from './he-chat-history';
import { captureChefChatHistorySources, ensureChefChatHistory } from './chef-chat-history';
import PetPage from './pets';
import { PET_STATE_CHANGED_EVENT, petStorageKey, readDisplayedPet, type DisplayPet } from './pet-storage';
import { npcFetch } from './npc-fetch';
import { useAccount } from './auth-gate';
import { useGroupChats } from './use-group-chats';
import { GroupAvatar, GroupChatPanel, groupPreview } from './group-chat';
import { GroupCreateDialog } from './group-create-dialog';
import { detectGroupRequest } from './group-intent';
import { groupSelf } from './group-self';
import { rememberLocalTaskMessage, syncLocalGroupFacts } from './group-memory';
import {InlineNameEdit} from './inline-name-edit';
import {CHAT_MUTE_CHANGED, chatMuteKey, readMutedChats, writeMutedChats} from './chat-mute';
import './chat-mute.css';
import type { GroupChat } from '../../lib/npc/group-chat';
import './desktop-bridge';
import { assets as npcAssets, type PublicSession } from '../../lib/npc/contracts';
import { choicePlainText } from '../../lib/npc/choice-chat';
import { Bot, Pin } from 'lucide-react';
import { molly, withMolly } from './data';
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  MessageCircle,
  MessageSquare,
  Users,
  Compass,
  LayoutGrid,
  Menu,
  Search,
  MoreHorizontal,
  Video,
  Paperclip,
  Reply,
  Heart,
  MapPin,
  ChevronRight,
  ChevronLeft,
  X,
  Camera,
  ImagePlus,
  ArrowLeft,
  RefreshCw,
  Bell,
  Bookmark,
  Copy,
  EyeOff,
  Check,
  BellOff,
  CalendarCheck,
} from 'lucide-react';
import {
  asset,
  people,
  allPeople,
  self as defaultSelf,
  initialMessages,
  initialPosts,
  uid,
  now,
  type Person,
  type Page,
  type Message,
  type Post,
} from './data';
import './app.css';
import './conversation-status.css';



import './professional-profile.css';
import { bubblePosition } from './message-bubbles';

// Set false to restore the previous plate; colours/layout stay independent.
const DESKTOP_LIQUID_BASE_ENABLED = true;

type Modal =
  | { kind: 'publish' }
  | { kind: 'image'; images: string[]; index: number }
  | { kind: 'settings' }
  | { kind: 'profile'; person: Person; anchor: HTMLElement | null }
  | null;

function IconButton({
  label,
  children,
  onClick,
  className = '',
  pressed,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={'zy-icon ' + className}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Avatar({
  person,
  size = 40,
  ring = false,
}: {
  person: Person;
  size?: number;
  ring?: boolean;
}) {
  return (
    <span
      className={'zy-avatar ' + (ring ? 'zy-ring ' : '')}
      style={{ width: size, height: size }}
    >
      {person.id === 'molly' && !person.avatar ? (
        <span className="zy-molly-avatar"><Bot size={size * .56} aria-label="机器人 Molly" /></span>
      ) : person.avatar ? (
        <img src={person.avatar} alt={person.name} draggable={false} />
      ) : (
        <span
          className="zy-avatar-letter"
          style={{
            background: person.color || '#e5dfd5',
            color: person.id === 'group' ? '#77716a' : '#fff',
          }}
        >
          {person.initial || person.name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

function Dialog({
  title,
  close,
  children,
  className = '',
  dismissOutside = false,
  hideClose = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
  dismissOutside?: boolean;
  hideClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
    };
  }, []);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native dialog handles Escape through onCancel; click only dismisses its backdrop.
    <dialog
      ref={ref}
      className={'zy-dialog ' + className}
      onCancel={close}
      onClick={event => {
        if (!dismissOutside || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}
      aria-label={title}
    >
      <header className="zy-dialog-head">
        <h2>{title}</h2>
        {!hideClose && <IconButton label="关闭" onClick={close}>
          <X />
        </IconButton>}
      </header>
      {children}
    </dialog>
  );
}
function Media({
  post,
  open,
}: {
  post: Post;
  open: (images: string[], index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const start = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);
  const imgs = post.images;
  const carousel = post.carousel || imgs.length >= 4;
  if (!imgs.length) return null;
  const change = (i: number) =>
    setIndex(Math.max(0, Math.min(imgs.length - 1, i)));
  function end(e: ReactPointerEvent) {
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    dragged.current = Math.abs(dx) > 25;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy))
      change(index + (dx < 0 ? 1 : -1));
  }
  return (
    <div
      className={
        'zy-media ' + (carousel ? 'is-carousel' : 'count-' + imgs.length)
      }
    >
      {carousel ? (
        <>
          <button
            className="zy-image-hit"
            aria-label={`查看第 ${index + 1} 张图片`}
            onPointerDown={(e) => {
              start.current = { x: e.clientX, y: e.clientY };
              dragged.current = false;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={end}
            onClick={() => {
              if (!dragged.current) open(imgs, index);
            }}
          >
            <img
              src={imgs[index]}
              alt={`${post.text} · 第 ${index + 1} 张`}
              draggable={false}
            />
          </button>
          {index > 0 && (
            <IconButton
              label="上一张图片"
              className="zy-carousel-arrow prev"
              onClick={() => change(index - 1)}
            >
              <ChevronLeft />
            </IconButton>
          )}
          {index < imgs.length - 1 && (
            <IconButton
              label="下一张图片"
              className="zy-carousel-arrow next"
              onClick={() => change(index + 1)}
            >
              <ChevronRight />
            </IconButton>
          )}
          <div className="zy-dots" aria-label="图片分页">
            {imgs.map((_, i) => (
              <button
                key={i}
                aria-label={`切换至第 ${i + 1} 张图片`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => change(i)}
              >
                <i className={index === i ? 'current' : ''} />
              </button>
            ))}
          </div>
        </>
      ) : (
        imgs.map((src, i) => (
          <button
            className="zy-image-hit"
            key={src + i}
            aria-label={`查看第 ${i + 1} 张图片`}
            onClick={() => open(imgs, i)}
          >
            <img
              src={src}
              alt={`${post.text} · 图片 ${i + 1}`}
              draggable={false}
            />
          </button>
        ))
      )}
    </div>
  );
}

function MomentChatScreenshot({post,person}:{post:Post;person:Person}) {
  const shot=post.chatScreenshot;
  if(!shot)return null;
  const groups=shot.lines.reduce<typeof shot.lines[]>((all,line)=>{
    const last=all.at(-1);
    if(last?.[0]?.role===line.role)last.push(line);else all.push([line]);
    return all;
  },[]);
  return <section className="zy-chat-screenshot" aria-label={`${person.name}分享的真实聊天片段`}>
    <header className="xx-head unified-chat-head zy-chat-shot-head">
      <span className="chat-header-person">
        {person.avatar?<img className="xx-avatar" src={person.avatar} alt={person.name}/>:<span className="xx-avatar">{person.name.slice(0,1)}</span>}
        <span className="chat-header-copy"><strong>{person.name}</strong><small>{person.bio}</small></span>
      </span>
    </header>
    <div className="xx-thread zy-chat-shot-thread">
      {groups.map(group=>{
        const mine=group[0].role==='user',last=group.at(-1)!;
        return <div className={'xx-group '+(mine?'user':'assistant')} key={group[0].id}>
          <div className="xx-group-row">
            {!mine&&<img className="xx-group-avatar" src={person.avatar} alt={person.name}/>} 
            <div className="xx-group-bubbles">
              {group.map((line,index)=><div className="xx-message" data-bubble-position={bubblePosition(index>0,index<group.length-1)} key={line.id}><div className="xx-bubble">{line.text}</div></div>)}
            </div>
          </div>
          <div className="xx-group-meta"><time dateTime={last.at}>{new Date(last.at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false})}</time><MessageReceipt unreadLabel="已发送，未提供已读回执"/></div>
        </div>;
      })}
    </div>
  </section>;
}

function PageSection({render}:{render:()=>ReactNode}) {return render();}

export default function Zhiyu({mode = 'desktop'}: {mode?: 'desktop' | 'mobile'}) {
  const mobile = mode === 'mobile';
  const liquidBaseEnabled = !mobile && DESKTOP_LIQUID_BASE_ENABLED;
  const {account,logout,firstUse}=useAccount();
  const [statusClock,setStatusClock]=useState(()=>Date.now());
  const [characterStatuses,setCharacterStatuses]=useState<Record<string,CharacterStatus>>({});
  const rememberStatus=useCallback((id:string,session:PublicSession)=>{if(session.characterStatus)setCharacterStatuses(old=>old[id]?.text===session.characterStatus!.text&&old[id]?.until===session.characterStatus!.until?old:{...old,[id]:session.characterStatus!});},[]);
  const statusFor=(id:string)=>characterStatuses[id]&&characterStatuses[id].until>statusClock?characterStatuses[id].text:resolveCharacterStatus(id,statusClock).text;
  useEffect(()=>{const timer=setInterval(()=>setStatusClock(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const store=`zhiyu-stitch-desktop-v2:${account.id}`;
  const [dockPersonId, setDockPersonId] = useState<string | null>(null);
  const characterPopup = useRef<Window | null>(null);
  const calendarOpenRequest = useRef(0);
  useEffect(() => {
    const dispose = bindTaskCalendarWindowLifecycle(account.id);
    return () => {dispose();};
  }, [account.id]);
  const openTaskCalendar = async (id: string) => {
    const request = ++calendarOpenRequest.current;
    const shown = await openTaskCalendarWindow({personId: id, accountId: account.id});
    if (!shown && request === calendarOpenRequest.current) notify('日历页面暂时无法显示，请再点击一次重试。');
  };
  useEffect(() => {
    const unsubscribe = window.zhiyuDesktop?.onCharacterWindowState?.(setDockPersonId);
    return () => {
      unsubscribe?.();
      void window.zhiyuDesktop?.closeCharacterWindow?.();
      characterPopup.current?.close();
      characterPopup.current = null;
    };
  }, []);
  const openDesktopCharacter = (id: string) => {
    const desktop = window.zhiyuDesktop;
    if (desktop?.openCharacterWindow) {
      void desktop.openCharacterWindow(id).then(open => { if (open) setDockPersonId(id); });
      return;
    }
    if (desktop) {
      notify('请退出并重新打开智域，以启用独立人物窗口。');
      return;
    }
    const popup = window.open(`/character-window?npc=${encodeURIComponent(id)}`, 'zhiyu-character', 'width=768,height=680');
    characterPopup.current = popup;
    if (popup) { setDockPersonId(id); popup.focus(); }
  };
  const momentSeenKey=`zhiyu-moments-seen-v1:${account.id}`;
  const [self,setSelf]=useState(()=>({...defaultSelf,name:account.username,nickname:account.username,account:account.username}));
  const [remarks,setRemarks]=useState<Record<string,string>>({});
  const displayPerson=(p:Person):Person=>({...p,name:remarks[p.id]?.trim()||p.nickname||p.name});
  const [pinned,setPinned]=useState<string[]>([]);
  const [markedUnread,setMarkedUnread]=useState<string[]>([]);
  const [dismissed,setDismissed]=useState<Record<string,string>>({});
  const [chatMenu,setChatMenu]=useState<{id:string;x:number;y:number}|null>(null);
  const avatarInput=useRef<HTMLInputElement>(null);
  const coverInput=useRef<HTMLInputElement>(null);
  const profileBackgroundInput=useRef<HTMLInputElement>(null);
  const profileBackgroundFlight=useRef<string|null>(null);
  useEffect(()=>()=>{profileBackgroundFlight.current=null;},[]);
  useEffect(()=>{if(!chatMenu)return;const close=(e:Event)=>{if(e.type==='keydown'&&(e as KeyboardEvent).key!=='Escape')return;if(e.type==='pointerdown'&&(e.target as Element)?.closest('.zy-chat-context'))return;setChatMenu(null);};window.addEventListener('pointerdown',close);window.addEventListener('keydown',close);return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',close);};},[chatMenu]);

  const [page, setPage] = useState<Page>('chat');
  const [selected, setSelected] = useState('');
  const [reportQuote,setReportQuote]=useState<{characterId:string;messageId:string;text?:string;referenceId:string}|null>(null);
  const [taskConversation, setTaskConversation] = useState<{npcId:string;task:BoardTask;referenceId:string}|null>(null);
  const taskBoard=useTaskBoard(account.id);
  const professionalBoardTasks=useProfessionalTasks(account.id);
  const hasTaskInProgress=taskBoard.ready&&taskBoard.model.tasks.some(task=>task.date===taskBoard.model.today&&task.status==='in_progress');
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
  useEffect(()=>{setTaskConversation(null);},[account.id]);
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
  useEffect(()=>{if(!firstUse)return;const key=`zhiyu-first-open:${account.id}`;if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');setSelected('molly');setPage('chat');const target=new URL(window.location.href);target.searchParams.delete('npc');target.hash='chat';window.history.replaceState(null,'',target);},[account.id,firstUse]);
  useContinuousUse({accountId:account.id,characterId:page==='chat'&&selected&&!selected.startsWith('group-')?selected:'molly'});
  const receivedSecretaryGroups=useRef(new Set<string>());
  const [displayPet, setDisplayPet] = useState<DisplayPet | null>(null);
  useEffect(() => {
    const sync = () => setDisplayPet(readDisplayedPet(account.id));
    const onStorage = (event: StorageEvent) => { if (event.key === petStorageKey(account.id)) sync(); };
    sync();
    window.addEventListener(PET_STATE_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PET_STATE_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [account.id]);
  const [dirWidth, setDirWidth] = useState(260);
  const [contact, setContact] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const hiddenMessages = useMessageVisibility(account.id);
  const visibleMessages = useMemo(() => Object.fromEntries(Object.entries(messages).map(([id, items]) => [id, items.filter(message => !hiddenMessages[id]?.includes(message.id))])), [messages, hiddenMessages]);
  const [posts, setPosts] = useState(initialPosts.filter(p=>people.some(person=>person.id===p.personId)));
  const momentSeen = useRef<Set<string> | null>(null);
  const [momentFeedLoaded, setMomentFeedLoaded] = useState(false);
  const [momentBadge, setMomentBadge] = useState(false);
  const receiveNpcPosts = useCallback((incoming: Post[]) => {
    setMomentFeedLoaded(true);
    setPosts(old => {
      const next = [...incoming.map(post => {
        const prior = old.find(p => p.id === post.id);
        return prior ? {...post, saved:prior.saved} : post;
      }), ...old.filter(p => p.source !== 'npc-moment')].sort((a,b)=>(Date.parse(b.createdAt||'')||0)-(Date.parse(a.createdAt||'')||0));
      return JSON.stringify(next) === JSON.stringify(old) ? old : next;
    });
  }, []);
  const [chatIds, setChatIds] = useState(people.map(p=>p.id));
  const [unread, setUnread] = useState<Record<string, number>>({
    liu: 0,
  });
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [menu, setMenu] = useState('');
  const [toast, setToast] = useState('');
  const [reaction, setReaction] = useState(true);
  const [contactSections, setContactSections] = useState({ new: false, groups: false, contacts: true });
  const [profileEditing, setProfileEditing] = useState<'name' | 'bio' | null>(null);
  const [profileDraft, setProfileDraft] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [momentsNotificationsOpen, setMomentsNotificationsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const groupChats = useGroupChats(account.id, ready);
  useLiveTaskImport(taskBoard,professionalBoardTasks,groupChats.groups);
  useEffect(()=>{
    if(!ready||groupChats.loading)return;
    const {dates}=taskCalendarRange(groupChats.groups,[],shanghaiToday(Date.now()));
    const ids=dates.flatMap(date=>taskItemsForDate(groupChats.groups,date).map(task=>task.id));
    void refreshTaskCompletions(account.id,ids).catch(()=>{/* The task dialog surfaces sync errors and retries. */});
  },[ready,account.id,groupChats.loading,groupChats.groups]);
  const visibleGroups = useMemo(() => groupChats.groups.map(group => ({...group, messages: group.messages.filter(message => !hiddenMessages[group.id]?.includes(message.id))})), [groupChats.groups, hiddenMessages]);
  const [forwardDraft, setForwardDraft] = useState<{accountId:string;text:string;id:string}|null>(null);
  const [groupCreate, setGroupCreate] = useState<{source:Person;goal:string;memberIds:string[];requestId:string}|null>(null);
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupError, setGroupError] = useState('');
  const [groupPinBusy, setGroupPinBusy] = useState('');
  const groupPinFlight = useRef<object | null>(null);
  const groupCreateLock = useRef<string|null>(null);
  const declinedGroupRequests = useRef(new Set<string>());
  const groupAccountScope=useRef({id:account.id});
  useLayoutEffect(()=>{groupAccountScope.current={id:account.id};},[account.id]);
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
  useEffect(()=>{setForwardDraft(null);setGroupCreate(null);setGroupError('');setGroupCreating(false);setGroupPinBusy('');groupPinFlight.current=null;groupCreateLock.current=null;declinedGroupRequests.current.clear();},[account.id]);
  useNpcMoments(ready, receiveNpcPosts);
  const [muted, setMuted] = useState<string[]>([]);
  const [preferencesAccount, setPreferencesAccount] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [commentReply,setCommentReply]=useState<{id:string;name:string}|null>(null);
  const [momentCommentTarget,setMomentCommentTarget]=useState<{accountId:string;postId:string;id:string}|null>(null);
  const momentCommentTargetRef=useRef<typeof momentCommentTarget>(null);
  const [interactionBusy,setInteractionBusy]=useState('');
  const commentRequest=useRef<{key:string;id:string}|null>(null);
  // oxlint-disable-next-line react/react-compiler -- Comment drafts belong to one account, never the next signed-in owner.
  useEffect(()=>{momentCommentTargetRef.current=null;setMomentCommentTarget(null);setComment('');setCommentReply(null);setInteractionBusy('');commentRequest.current=null;},[account.id]);
  const [postText, setPostText] = useState('');
  const [postLocation, setPostLocation] = useState('');
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoBusy = useRef(false);
  const thread = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const attachment = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedScroll = useRef(0);
  const person = displayPerson(selected === 'molly' ? molly : allPeople.find((p) => p.id === selected) || people[0]);
  useEffect(()=>{
    if(!localCharacterIds.some(id=>id===selected))return;
    const images=(visibleMessages[selected]||[]).filter(item=>!!item.image).map(item=>({id:item.id,src:item.image!,alt:'聊天图片',at:item.at,sender:item.mine?'你':person.name}));
    if(images.length)void window.zhiyuDesktop?.updateImageViewer?.({conversationId:selected,images,index:0});
  },[visibleMessages,selected,person.name]);
  const [liuPresence,setLiuPresence]=useState<'online'|'offline'|'busy'>('offline');
  const [hePresence,setHePresence]=useState<'online'|'offline'|'busy'>('offline');
  const [chefPresence,setChefPresence]=useState<'online'|'offline'|'busy'>('offline');
  const [chefHistoryProtectedFor,setChefHistoryProtectedFor]=useState('');
  const [chenPresence,setChenPresence]=useState<'online'|'offline'|'busy'>('offline');
  const [yuanPresence,setYuanPresence]=useState<'online'|'offline'|'busy'>('offline');
  const [xiaPresence,setXiaPresence]=useState<'online'|'offline'|'busy'>('offline');
  const [,setSelfPresence]=useState<'online'|'offline'|'busy'>('online');
  const [selfBusy]=useState(false);
  const [quoteDrafts,setQuoteDrafts]=useState<Record<string,string>>({});
  useEffect(()=>{
    const update=()=>setSelfPresence(!navigator.onLine||document.visibilityState==='hidden'?'offline':selfBusy?'busy':'online');
    update();window.addEventListener('online',update);window.addEventListener('offline',update);document.addEventListener('visibilitychange',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);document.removeEventListener('visibilitychange',update);};
  },[selfBusy]);
  useEffect(()=>{
    const listener=(event:Event)=>{
      const session=(event as CustomEvent<PublicSession>).detail;
      setMessages(old=>({...old,molly:session.messages.map(m=>({id:m.id,at:m.at,mine:m.role==='user',text:m.part.type==='choice'?choicePlainText(m.part):'text'in m.part?m.part.text:'',time:new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}))}));
    };
    window.addEventListener('molly-session',listener);return()=>window.removeEventListener('molly-session',listener);
  },[]);
  const activeGroup = visibleGroups.find(group=>group.id===selected);
  const groupPerson = (group:GroupChat):Person=>({id:group.id,name:group.name,group:true,bio:group.goal,account:group.id,region:'',added:group.createdAt,letter:'#'});
  const conversationAt = (id:string)=>visibleGroups.find(group=>group.id===id)?.updatedAt || visibleMessages[id]?.at(-1)?.at || '';
  const isChatPinned = (id:string)=>id==='molly' || (id.startsWith('group-') ? !!groupChats.groups.find(group=>group.id===id)?.pinned : pinned.includes(id));
  const isChatMuted = (id:string)=>id.startsWith('group-') ? !!groupChats.groups.find(group=>group.id===id)?.muted : muted.includes(id);
  const notificationUnreadCount = Object.entries(unread).reduce((total,[id,count])=>total+(isChatMuted(id)?0:count),0);
  const orderedChatIds = withMolly([...people.map(p=>p.id),...groupChats.groups.map(group=>group.id)]).filter(id=>id==='molly'||!(id in dismissed)||(messages[id]!==undefined && dismissed[id] !== (messages[id]?.at(-1)?.id||''))).sort((a,b)=>{
    if(a==='molly')return -1;if(b==='molly')return 1;
    const pin=Number(isChatPinned(b))-Number(isChatPinned(a));
    return pin || (Date.parse(conversationAt(b))||0)-(Date.parse(conversationAt(a))||0);
  });
  const friend = displayPerson(contact==='molly'?molly:allPeople.find((p) => p.id === contact) || people[0]);
  const personById = (id: string) => {
    const group=groupChats.groups.find(item=>item.id===id);
    return group ? groupPerson(group) : displayPerson(id === 'molly' ? molly : id === 'self' ? self : allPeople.find((p) => p.id === id) || self);
  };
  const notify = (text: string) => {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 3500);
  };
  const toggleChatPin = async (id: string) => {
    if (id === 'molly' || groupPinFlight.current) return;
    const group = groupChats.groups.find(item=>item.id===id);
    if (!group) {
      setPinned(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);
      setChatMenu(null);
      return;
    }
    const expectedScope = groupAccountScope.current;
    const flight = {};
    groupPinFlight.current = flight;
    setGroupPinBusy(id);
    try {
      await groupChats.settings(id, {pinned: !group.pinned}, crypto.randomUUID());
      if (groupAccountScope.current === expectedScope) setChatMenu(null);
    } catch (error) {
      if (groupAccountScope.current === expectedScope) notify(reportUserFacingError(error,'save','main'));
    } finally {
      if (groupPinFlight.current === flight) {
        groupPinFlight.current = null;
        setGroupPinBusy('');
      }
    }
  };
  const toggleChatMute = async (id: string) => {
    const expectedScope = groupAccountScope.current;
    try {
      const group = groupChats.groups.find(item=>item.id===id);
      if (group) await groupChats.settings(id, {muted: !group.muted}, crypto.randomUUID());
      else {
        const saved = readMutedChats(account.id);
        const next = saved.includes(id) ? saved.filter(item=>item!==id) : [...saved,id];
        writeMutedChats(account.id,next);
        setMuted(next.filter(item=>!item.startsWith('group-')));
      }
    } catch (error) {
      if (groupAccountScope.current === expectedScope) notify(reportUserFacingError(error,'save','main'));
    }
  };
  const clearLocalChat = async (id:string) => {
    if (!ready || preferencesAccount !== account.id) throw new Error('聊天记录正在加载，请稍后重试。');
    // Keep the original snapshot; clearing only changes the visible conversation.
    const prior=messages[id]||[];
    localStorage.setItem(`zhiyu-cleared-local-chat:${account.id}:${id}:${crypto.randomUUID()}`,JSON.stringify(prior));
    const saved=JSON.parse(localStorage.getItem(store)||'{}');
    localStorage.setItem(store,JSON.stringify({...saved,messages:{...saved.messages,[id]:[]}}));
    if(localCharacterIds.some(item=>item===id))localStorage.setItem(localCharacterChatKey(account.id,id),'[]');
    setMessages(old=>({...old,[id]:[]}));
    setQuoteDrafts(old=>({...old,[id]:''}));
    setUnread(old=>({...old,[id]:0}));
    setMarkedUnread(old=>old.filter(item=>item!==id));
  };
  const saveContactRemark = (id: string, value: string) => {
    if (!ready || preferencesAccount !== account.id) throw new Error('资料正在加载，请稍后重试。');
    const next = {...remarks,[id]:value};
    try {
      const saved = JSON.parse(localStorage.getItem(store) || '{}');
      localStorage.setItem(store, JSON.stringify({...saved,remarks:next}));
    } catch {throw new Error('备注未保存，请检查本机存储空间后重试。');}
    setRemarks(next);
  };
  useEffect(() => {
    // Hydrate client-only local storage after the server-rendered first frame.
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
    momentSeen.current = null;
    // oxlint-disable-next-line react/react-compiler -- Restore the account-scoped feed after browser storage hydration.
    setMomentFeedLoaded(false);
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
    setMomentBadge(false);
    let savedPosts: Post[] | null = null;
    try {
      captureChefChatHistorySources(account.id);
      setChefHistoryProtectedFor(account.id);
    } catch {
      setChefHistoryProtectedFor('');
      notify('赵一帆旧留言备份暂未完成，原归档已保留，暂不覆盖本机归档。');
    }
    try {
      const raw = localStorage.getItem(store);
      if (raw) {
        const d = JSON.parse(raw);
        if (
          d.version === 2 &&
          d.messages &&
          Array.isArray(d.posts) &&
          d.posts.every(
            (p: Post) =>
              typeof p.text === 'string' &&
              Array.isArray(p.images) &&
              Array.isArray(p.comments),
          )
        ) {
          const allowed=new Set(['molly',...allPeople.map(p=>p.id)]);
          const removed = new Set(['shen','yun','group','chen','lin','xu','zhou']);
          setPinned((d.pinned||[]).filter((id:string)=>allowed.has(id)&&id!=='molly'));
          setMarkedUnread((d.markedUnread||[]).filter((id:string)=>allowed.has(id)));
          setDismissed(d.dismissed||{});
          setRemarks(d.remarks||{});
          if(d.selfProfile)setSelf({...defaultSelf,...d.selfProfile,id:'self',account:account.username});
          const keepRecords = <T,>(records: Record<string, T>): Record<string, T> =>
            Object.fromEntries(Object.entries(records).filter(([id]) => !removed.has(id)));
          // eslint-disable-next-line react/react-compiler -- Hydrate browser-only saved state once.
          setMessages({...keepRecords(d.messages), liu: []});
          setPosts(d.posts.filter((p: Post) => !removed.has(p.personId)));
          savedPosts = d.posts;
          setChatIds([...new Set([...(d.chatIds || ['liu']).filter((id: string) => allowed.has(id) && !removed.has(id)), 'he-jiawei', 'zhou-chef'])]);
          setUnread({...keepRecords(d.unread || {}), liu: 0});
          setMuted((d.muted || []).filter((id: string) => !removed.has(id)));
          setHidden((d.hidden || []).filter((id: string) => !removed.has(id)));
          setAccepted((d.accepted || []).filter((id: string) => !removed.has(id)));
        }
      }
    } catch {
      notify('记录暂时没能打开，请稍后重试。');
    }
    setMessages(old=>{
      const next={...old};
      for(const id of localCharacterIds){
        const saved=readLocalCharacterChat(account.id,id);
        if(saved.length)next[id]=saved;
      }
      return next;
    });
    try {
      const savedSeen = localStorage.getItem(momentSeenKey);
      if (savedSeen !== null) {
        const ids: unknown = JSON.parse(savedSeen);
        if (Array.isArray(ids)) momentSeen.current = new Set(ids.filter((id): id is string => typeof id === 'string'));
      } else if (savedPosts) {
        // Existing accounts start from their last saved feed, not all historical server posts.
        momentSeen.current = new Set(savedPosts.filter(post => post.source === 'npc-moment' && post.personId !== 'self').map(post => post.id));
        localStorage.setItem(momentSeenKey, JSON.stringify([...momentSeen.current]));
      }
    } catch { /* A bad marker must not prevent the app from opening. */ }
    const hash = location.hash.replace('#', '').split('/')[0];
    if (['chat', 'contacts', 'tasks', 'moments', 'me', ...(features.extras?['pets']:[])].includes(hash)) setPage(hash as Page);
    if (['molly',...allPeople.map(p=>p.id)].includes(new URLSearchParams(location.search).get('npc')||'')) {
      setSelected(new URLSearchParams(location.search).get('npc')!);
      setPage('chat');
    }
    setMuted(readMutedChats(account.id).filter(id=>!id.startsWith('group-')));
    setPreferencesAccount(account.id);
    setReady(true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [store,account.id,account.username,momentSeenKey]);
  useEffect(() => {
    const sync = () => setMuted(previous => {
      const next = readMutedChats(account.id).filter(id=>!id.startsWith('group-'));
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
    const onStorage = (event: StorageEvent) => {if (event.key === chatMuteKey(account.id)) sync();};
    window.addEventListener('storage',onStorage);
    window.addEventListener(CHAT_MUTE_CHANGED,sync);
    return () => {window.removeEventListener('storage',onStorage); window.removeEventListener(CHAT_MUTE_CHANGED,sync);};
  }, [account.id]);
  useEffect(() => {
    if (!ready || preferencesAccount !== account.id || groupChats.loading) return;
    try {writeMutedChats(account.id,[...muted.filter(id=>!id.startsWith('group-')), ...groupChats.groups.filter(group=>group.muted).map(group=>group.id)]);}
    catch { /* The setting controls report write failures; keep current receive state. */ }
  }, [ready,preferencesAccount,account.id,muted,groupChats.groups,groupChats.loading]);
  useEffect(() => {
    if (!ready || preferencesAccount !== account.id) return;
    const counts: Record<string,number> = {};
    for (const group of groupChats.groups) {
      const key = `zhiyu-group-last-read:${account.id}:${group.id}`;
      const last = group.messages.at(-1)?.id;
      if (page === 'chat' && selected === group.id) {
        if (last) localStorage.setItem(key,last);
        counts[group.id] = 0;
      } else {
        const readId = localStorage.getItem(key);
        const index = group.messages.findIndex(message=>message.id===readId);
        counts[group.id] = group.messages.slice(index+1).filter(message=>message.type==='text' && message.senderId!=='user' && !isMessageHidden(account.id, group.id, message.id)).length;
      }
    }
    // eslint-disable-next-line react/react-compiler -- Synchronize server group messages with persisted read markers; unchanged counts keep the existing state.
    setUnread(previous=>{
      const removed = Object.keys(previous).filter(id=>id.startsWith('group-') && !(id in counts));
      if (!removed.length && !Object.entries(counts).some(([id,count])=>previous[id]!==count)) return previous;
      const next = {...previous,...counts};
      for (const id of removed) delete next[id];
      return next;
    });
  }, [ready,preferencesAccount,account.id,groupChats.groups,page,selected]);
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{
      const id=localCharacterIds.find(item=>event.key===localCharacterChatKey(account.id,item));
      if(!id)return;
      const saved=readLocalCharacterChat(account.id,id);
      setMessages(old=>({...old,[id]:saved}));
    };
    window.addEventListener('storage',sync);
    return()=>window.removeEventListener('storage',sync);
  },[account.id]);
  useEffect(() => {
    if (!ready || !momentFeedLoaded) return;
    const currentIds = posts.filter(post => post.source === 'npc-moment' && post.personId !== 'self').map(post => post.id);
    if (momentSeen.current === null) {
      // On a new account, the first server response establishes the baseline.
      momentSeen.current = new Set(currentIds);
      try { localStorage.setItem(momentSeenKey, JSON.stringify(currentIds)); } catch { /* Keep the in-memory baseline. */ }
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
      setMomentBadge(false);
      return;
    }
    if (page === 'moments') {
      let changed = false;
      for (const id of currentIds) if (!momentSeen.current.has(id)) { momentSeen.current.add(id); changed = true; }
      if (changed) try { localStorage.setItem(momentSeenKey, JSON.stringify([...momentSeen.current])); } catch { /* Keep the in-memory read state. */ }
  // oxlint-disable-next-line react/react-compiler -- Reconcile account-scoped browser persistence or an external feed subscription after commit.
      setMomentBadge(false);
    } else setMomentBadge(currentIds.some(id => !momentSeen.current!.has(id)));
  }, [ready, momentFeedLoaded, posts, page, momentSeenKey]);
  // Report storage quota failures while retaining the in-memory draft.
  useEffect(() => {
    if (!ready || chefHistoryProtectedFor !== account.id) return;
    try {
      localStorage.setItem(
        store,
        JSON.stringify({
          version: 2,
          messages,
          posts,
          chatIds,
          unread,
          muted,
          hidden,
          accepted,
          pinned,markedUnread,dismissed,remarks,selfProfile:self,
        }),
      );
    } catch {
      // eslint-disable-next-line react/react-compiler -- Surface a storage failure without losing the in-memory state.
      notify('浏览器存储空间不足，本次修改仍保留在当前页面。');
    }
  }, [messages, posts, chatIds, unread, muted, hidden, accepted, pinned, markedUnread, dismissed, remarks, self, ready, store, chefHistoryProtectedFor, account.id]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let inFlight = false;
    let eventVersion = 0;
    const invalidatePoll = () => {eventVersion += 1;};
    const sync = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      const startedVersion = eventVersion;
      try {
        const response = await npcFetch('/api/npc/molly?mode=normal', {cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
        if (!response.ok || !active) return;
        const session = await response.json() as PublicSession;rememberStatus('molly',session);
        if (!active || startedVersion !== eventVersion || !Array.isArray(session.messages)) return;
        let newGroup=false;
        for(const message of session.messages){const event=message.secretaryEvent;if(event?.kind!=='group'||!event.groupId)continue;const key=account.id+':'+event.id;if(!receivedSecretaryGroups.current.has(key)){receivedSecretaryGroups.current.add(key);newGroup=true;}}
        if(newGroup)window.dispatchEvent(new Event('npc-groups-changed'));
        const list = session.messages.map(message=>({id:message.id,at:message.at,mine:message.role==='user',text:message.part.type==='choice'?choicePlainText(message.part):'text' in message.part?message.part.text:'[消息]',time:new Date(message.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}));
        setMessages(previous=>previous.molly?.at(-1)?.id===list.at(-1)?.id && previous.molly?.length===list.length?previous:{...previous,molly:list});
        const key = `zhiyu-molly-last-read:${account.id}`;
        if (page==='chat' && selected==='molly') {
          if (list.length) localStorage.setItem(key,list.at(-1)!.id);
          setUnread(previous=>previous.molly?{...previous,molly:0}:previous);
        } else {
          const index = session.messages.findIndex(message=>message.id===localStorage.getItem(key));
          const count = session.messages.slice(index+1).filter(message=>message.role==='assistant' && !isMessageHidden(account.id,'molly',message.id)).length;
          setUnread(previous=>previous.molly===count?previous:{...previous,molly:count});
        }
      } catch { /* Continue receiving on the next poll. */ }
      finally {inFlight = false;}
    };
    window.addEventListener('molly-session', invalidatePoll);
    void sync();
    const interval = setInterval(()=>void sync(),3000);
    return () => {active=false;clearInterval(interval);window.removeEventListener('molly-session',invalidatePoll);};
  }, [ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if(!ready)return;
    let alive=true;
    const sync=async()=>{
      try {
        const response=await npcFetch('/api/npc/xia-xia?mode=normal',{cache:'no-store'});
        if(!response.ok){setXiaPresence('offline');return;}
        const session=await response.json() as PublicSession;
        if(!alive||!Array.isArray(session.messages))return;
        rememberStatus('xia-xia',session);setXiaPresence(session.presence||'offline');
        const list=session.messages.map(m=>({id:m.id,at:m.at,mine:m.role==='user',text:m.part.type==='choice'?choicePlainText(m.part):m.part.type==='professional_task'?'[任务] '+(session.professionalTasks?.find(task=>m.part.type==='professional_task'&&task.id===m.part.taskId)?.title||'任务'):'text' in m.part?(m.part.text||'[图片]'):'[图片]',time:new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),...('assetId' in m.part?{image:npcAssets[m.part.assetId].url}:{})}));
        setMessages(old=>old['xia-xia']?.at(-1)?.id===list.at(-1)?.id?old:{...old,'xia-xia':list});
        const key=`zhiyu-xia-last-read:${account.id}`;
        if(page==='chat'&&selected==='xia-xia') {
          if(list.length)localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old=>old['xia-xia']?{...old,'xia-xia':0}:old);
        } else {
          const readId=localStorage.getItem(key),index=session.messages.findIndex(m=>m.id===readId);
          const count=session.messages.slice(index+1).filter(m=>m.role==='assistant' && !isMessageHidden(account.id,'xia-xia',m.id)).length;
          setUnread(old=>old['xia-xia']===count?old:{...old,'xia-xia':count});
        }
      } catch { if(alive)setXiaPresence('offline'); }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if(!ready)return;
    let alive=true;
    const sync=async()=>{
      try {
        const response=await npcFetch('/api/npc/yuan-xiaoman?mode=normal',{cache:'no-store'});
        if(!response.ok){setYuanPresence('offline');return;}
        const session=await response.json() as PublicSession;
        if(!alive||!Array.isArray(session.messages))return;
        rememberStatus('yuan-xiaoman',session);setYuanPresence(session.presence||'offline');
        const list=session.messages.map(m=>({id:m.id,at:m.at,mine:m.role==='user',text:m.part.type==='choice'?choicePlainText(m.part):m.part.type==='professional_task'?'[任务] '+(session.professionalTasks?.find(task=>m.part.type==='professional_task'&&task.id===m.part.taskId)?.title||'任务'):'text' in m.part?(m.part.text||'[图片]'):'[图片]',time:new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),...('assetId' in m.part?{image:npcAssets[m.part.assetId].url}:{})}));
        setMessages(old=>old['yuan-xiaoman']?.at(-1)?.id===list.at(-1)?.id?old:{...old,'yuan-xiaoman':list});
        const key=`zhiyu-yuan-last-read:${account.id}`;
        if(page==='chat'&&selected==='yuan-xiaoman') {
          if(list.length)localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old=>old['yuan-xiaoman']?{...old,'yuan-xiaoman':0}:old);
        } else {
          const readId=localStorage.getItem(key),index=session.messages.findIndex(m=>m.id===readId);
          const count=session.messages.slice(index+1).filter(m=>m.role==='assistant' && !isMessageHidden(account.id,'yuan-xiaoman',m.id)).length;
          setUnread(old=>old['yuan-xiaoman']===count?old:{...old,'yuan-xiaoman':count});
        }
      } catch { if(alive)setYuanPresence('offline'); }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if(!ready)return;
    let alive=true;
    const sync=async()=>{
      try {
        const response=await npcFetch('/api/npc/liu?mode=normal',{cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
        if(!response.ok){setLiuPresence('offline');return;}
        const session=await response.json() as PublicSession;
        if(!alive||!Array.isArray(session.messages))return;
        rememberStatus('liu',session);setLiuPresence(session.presence||'offline');
        if(session.professionalTasks)ingestProfessionalTasks(account.id,session.professionalTasks,session.revision,'liu');
        const list=session.messages.map(m=>({id:m.id,at:m.at,mine:m.role==='user',text:m.part.type==='choice'?choicePlainText(m.part):m.part.type==='professional_task'?'[任务] '+(session.professionalTasks?.find(task=>m.part.type==='professional_task'&&task.id===m.part.taskId)?.title||'任务'):'text' in m.part?(m.part.text||'[图片]'):'[图片]',time:new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),...('assetId' in m.part?{image:npcAssets[m.part.assetId].url}:{})}));
        setMessages(old=>old['liu']?.at(-1)?.id===list.at(-1)?.id?old:{...old,'liu':list});
        const key=`zhiyu-liu-last-read:${account.id}`;
        if(page==='chat'&&selected==='liu') {
          if(list.length)localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old=>old['liu']?{...old,'liu':0}:old);
        } else {
          const readId=localStorage.getItem(key),index=session.messages.findIndex(m=>m.id===readId);
          const count=session.messages.slice(index+1).filter(m=>m.role==='assistant' && !isMessageHidden(account.id,'liu',m.id)).length;
          setUnread(old=>old['liu']===count?old:{...old,'liu':count});
        }
      } catch { if(alive)setLiuPresence('offline'); }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if(!ready)return;
    let alive=true;
    const sync=async()=>{
      try {
        const response=await npcFetch('/api/npc/chen-nian?mode=normal',{cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
        if(!response.ok){setChenPresence('offline');return;}
        const session=await response.json() as PublicSession;
        if(!alive||!Array.isArray(session.messages))return;
        rememberStatus('chen-nian',session);setChenPresence(session.presence||'offline');
        if(session.professionalTasks)ingestProfessionalTasks(account.id,session.professionalTasks,session.revision,'chen-nian');
        const list=session.messages.map(m=>({id:m.id,at:m.at,mine:m.role==='user',text:m.part.type==='choice'?choicePlainText(m.part):m.part.type==='professional_task'?'[任务] '+(session.professionalTasks?.find(task=>m.part.type==='professional_task'&&task.id===m.part.taskId)?.title||'任务'):'text' in m.part?(m.part.text||'[图片]'):'[图片]',time:new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),...('assetId' in m.part?{image:npcAssets[m.part.assetId].url}:{})}));
        setMessages(old=>old['chen-nian']?.at(-1)?.id===list.at(-1)?.id?old:{...old,'chen-nian':list});
        const key=`zhiyu-chen-last-read:${account.id}`;
        if(page==='chat'&&selected==='chen-nian') {
          if(list.length)localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old=>old['chen-nian']?{...old,'chen-nian':0}:old);
        } else {
          const readId=localStorage.getItem(key),index=session.messages.findIndex(m=>m.id===readId);
          const count=session.messages.slice(index+1).filter(m=>m.role==='assistant' && !isMessageHidden(account.id,'chen-nian',m.id)).length;
          setUnread(old=>old['chen-nian']===count?old:{...old,'chen-nian':count});
        }
      } catch { if(alive)setChenPresence('offline'); }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if (!ready) return;
    let alive = true, running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try {
        await ensureHeChatHistory(account.id);
        if (!alive) return;
        const response = await npcFetch('/api/npc/he-jiawei?mode=normal', {cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
        if (!response.ok) { if (alive) setHePresence('offline'); return; }
        const session = await response.json() as PublicSession;rememberStatus('he-jiawei',session);
        if (!alive || !Array.isArray(session.messages)) return;
        setHePresence(session.presence || 'offline');
        const list = session.messages.map(m => ({id:m.id,at:m.at,mine:m.role==='user',
          text:m.part.type==='choice'?choicePlainText(m.part):'text' in m.part ? m.part.text : '[图片]',
          time:m.legacyTime || new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),
          ...m.legacyContent,...(m.replyTo?{replyTo:m.replyTo}:{})}));
        setMessages(old => old['he-jiawei']?.at(-1)?.id === list.at(-1)?.id && old['he-jiawei']?.length === list.length ? old : {...old,'he-jiawei':list});
        const key = `zhiyu-he-last-read:${account.id}`;
        if (page==='chat' && selected==='he-jiawei') {
          if (list.length) localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old => old['he-jiawei'] ? {...old,'he-jiawei':0} : old);
        } else {
          const index = session.messages.findIndex(m => m.id===localStorage.getItem(key));
          const count = session.messages.slice(index+1).filter(m => m.role==='assistant' && !isMessageHidden(account.id,'he-jiawei',m.id)).length;
          setUnread(old => old['he-jiawei']===count ? old : {...old,'he-jiawei':count});
        }
      } catch { if (alive) setHePresence('offline'); }
      finally { running=false; }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return ()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    if (!ready) return;
    let alive = true, running = false;
    const sync = async () => {
      if (running) return;
      running = true;
      try {
        await ensureChefChatHistory(account.id);
        if (!alive) return;
        setChefHistoryProtectedFor(account.id);
        const response = await npcFetch('/api/npc/zhou-chef?mode=normal', {cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
        if (!response.ok) { if (alive) setChefPresence('offline'); return; }
        const session = await response.json() as PublicSession;rememberStatus('zhou-chef',session);
        if (!alive || !Array.isArray(session.messages)) return;
        setChefPresence(session.presence || 'offline');
        if(session.professionalTasks)ingestProfessionalTasks(account.id,session.professionalTasks,session.revision,'zhou-chef');
        const list = session.messages.map(m => ({id:m.id,at:m.at,chefApiPreview:true,mine:m.role==='user',
          text:m.part.type==='choice'?choicePlainText(m.part):m.part.type==='professional_task'?'[任务] '+(session.professionalTasks?.find(task=>m.part.type==='professional_task'&&task.id===m.part.taskId)?.title||'任务'):'text' in m.part ? m.part.text : '[图片]',
          time:m.legacyTime || new Date(m.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),
          ...m.legacyContent,...(m.replyTo?{replyTo:m.replyTo}:{})}));
        setMessages(old => old['zhou-chef']?.at(-1)?.id === list.at(-1)?.id && old['zhou-chef']?.length === list.length ? old : {...old,'zhou-chef':list});
        const key = `zhiyu-chef-last-read:${account.id}`;
        if (page==='chat' && selected==='zhou-chef') {
          if (list.length) localStorage.setItem(key,list.at(-1)!.id);
          setUnread(old => old['zhou-chef'] ? {...old,'zhou-chef':0} : old);
        } else {
          const index = session.messages.findIndex(m => m.id===localStorage.getItem(key));
          const count = session.messages.slice(index+1).filter(m => m.role==='assistant' && !isMessageHidden(account.id,'zhou-chef',m.id)).length;
          setUnread(old => old['zhou-chef']===count ? old : {...old,'zhou-chef':count});
        }
      } catch { if (alive) setChefPresence('offline'); }
      finally { running=false; }
    };
    void sync();
    const timer=setInterval(()=>void sync(),3000);
    return ()=>{alive=false;clearInterval(timer);};
  },[ready,page,selected,account.id,rememberStatus]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.zy-menu-anchor')))
        setMenu('');
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);
  useEffect(() => {
    const handler = () => {
      const p = location.hash.slice(1).split('/')[0];
      if (['chat', 'contacts', 'tasks', 'moments', 'me', ...(features.extras?['pets']:[])].includes(p)) {
        setPage(p as Page);
      }
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    if (page === 'moments' && feed.current)
      feed.current.scrollTop = feedScroll.current;
  }, [page]);
  function navigate(next: Page) {
    if(next==='pets'&&!features.extras)return;
    if (page === 'moments' && feed.current)
      feedScroll.current = feed.current.scrollTop;
    setPage(next);
    if (next === 'contacts' && page !== 'contacts') setContactSections(current => ({ ...current, contacts: true }));
    setQuery('');
    setMenu('');
    window.history.pushState(null,'','#'+next);
  }
  function navigateMain(next: Page) {
    if (mobile && next === 'chat') setSelected('');
    if (next === 'contacts') setContact('');
    navigate(next);
  }
  function openTasks() {
    taskBoard.dispatch({type:'set-view',view:'today'});
    navigate('tasks');
  }
  function openChat(p: Person) {
    setMarkedUnread(ids=>ids.filter(id=>id!==p.id));
    setDismissed(old=>{const next={...old};delete next[p.id];return next;});
    setSelected(p.id);
    setChatIds((ids) => (ids.includes(p.id) ? ids : [p.id, ...ids]));
    setUnread((u) => ({ ...u, [p.id]: 0 }));
    setModal(null);
    navigate('chat');
  }
  function openGroupDialog(source:Person, goal='', memberIds:string[]=['molly',...(source.id==='molly'?[]:[source.id])]) {
    setGroupError('');
    setGroupCreate({source,goal,memberIds,requestId:crypto.randomUUID()});
  }
  async function createGroup(source:Person,goal:string,memberIds:string[],requestId:string) {
    if(groupCreateLock.current)throw Error('Molly 正在创建群聊，请稍等');
    const expectedScope=groupAccountScope.current;
    const flight=crypto.randomUUID();
    groupCreateLock.current=flight;setGroupCreating(true);setGroupError('');
    try{
      const selfMember=await groupSelf(self.nickname||self.name,self.avatar);
      if(groupAccountScope.current!==expectedScope)throw Error('账号已切换，请重新操作。');
      await syncLocalGroupFacts(account.id,()=>groupAccountScope.current===expectedScope);
      if(groupAccountScope.current!==expectedScope)throw Error('账号已切换，请重新操作。');
      const group=await groupChats.create({requestId,sourceCharacterId:source.id,goal,memberIds,consent:source.id!=='molly',self:selfMember});
      if(groupAccountScope.current!==expectedScope)return group;
      setGroupCreate(null);
      openChat(groupPerson(group));
      notify('群聊已建立，Molly 会先介绍目标和分工。');
      return group;
    }catch(error){
      if(groupAccountScope.current===expectedScope)setGroupError(reportUserFacingError(error,'save','create-group'));
      throw error;
    }finally{if(groupCreateLock.current===flight)groupCreateLock.current=null;if(groupAccountScope.current===expectedScope)setGroupCreating(false);}
  }
  async function interceptGroupRequest(text:string,sourceId=selected):Promise<boolean>{
    if(declinedGroupRequests.current.has(sourceId+':'+text.trim()))return false;
    const request=detectGroupRequest(text,sourceId,people);
    if(!request)return false;
    if(request.error){notify(reportUserFacingError(request.error,'send','group-request'));return true;}
    const expectedScope=groupAccountScope.current;
    const source=displayPerson(sourceId==='molly'?molly:people.find(p=>p.id===sourceId)||molly);
    if(groupCreateLock.current)return true;
    if(sourceId==='molly'&&request.memberIds.some(id=>id!=='molly')){
      const requestId=crypto.randomUUID();
      try{await createGroup(source,request.goal,request.memberIds,requestId);}
      catch{if(groupAccountScope.current===expectedScope)setGroupCreate({source,goal:request.goal,memberIds:request.memberIds,requestId});}
    }else openGroupDialog(source,request.goal,request.memberIds);
    return true;
  }
  function closeGroupDialog(){
    if(groupCreating)return;
    if(groupCreate?.goal)declinedGroupRequests.current.add(groupCreate.source.id+':'+groupCreate.goal);
    setGroupCreate(null);setGroupError('');
  }
  function openProfile(p: Person, anchor?: HTMLElement) {
    const origin = anchor || document.querySelector<HTMLElement>('.zy-self-avatar-button .zy-avatar') || document.querySelector<HTMLElement>('.zy-self-avatar-button');
    if (modal?.kind === 'profile' && modal.person.id === p.id && modal.anchor === origin && origin) {
      // Let the mounted card finish/reverse its motion before clearing modal state.
      origin.dispatchEvent(new Event('zy-profile-toggle'));
      return;
    }
    if (modal?.kind === 'profile' && modal.anchor?.isConnected) {
      modal.anchor.dispatchEvent(new CustomEvent('zy-profile-replace', {detail: {afterClose: () => {
        setProfileEditing(null);
        setModal({kind: 'profile', person: p, anchor: origin});
      }}}));
      return;
    }
    setProfileEditing(null);
    setModal({kind: 'profile', person: p, anchor: origin});
  }
  function openMoments(id: string | null = null) {
    setFilter(id);
    setHidden((h) => (id ? h.filter((x) => x !== id) : h));
    feedScroll.current = 0;
    navigate('moments');
    requestAnimationFrame(() => {
      if (feed.current) feed.current.scrollTop = 0;
    });
  }

  function deleteLocalMessage(threadId:string, messageId:string) {
    try {
      hideMessage(account.id,threadId,messageId);
      setQuoteDrafts(previous=>previous[threadId]===messageId?{...previous,[threadId]:''}:previous);
    } catch (failure) {notify(reportUserFacingError(failure,'save','main'));}
  }
  function beginForward(text:string) {
    if (!text.trim()) {notify('这条消息没有可转发的文字；图片和语音原文件暂不支持转发。');return;}
    setForwardDraft({accountId:account.id,text:text.trim(),id:crypto.randomUUID()});
  }
  async function forwardMessage(target:ForwardTarget, requestId:string) {
    const expectedScope=groupAccountScope.current;
    if (!forwardDraft || forwardDraft.accountId!==account.id || target.disabled) throw new Error('请重新选择当前账号的转发对象。');
    const text=forwardDraft.text;
    const group=groupChats.groups.find(item=>item.id===target.id);
    if (group) {
      if (!group.chatEnabled || group.leftAt) throw new Error('这个群暂时不能接收消息，请稍后再试。');
      const result=await groupChats.send(group.id,text,[],requestId);
      if (!result.messages.some(message=>message.senderId==='user' && message.requestId===requestId)) throw new Error('未收到发送确认，请重试。');
    } else {
      if (![molly,...people].some(person=>person.id===target.id)) throw new Error('联系人已不可用，请重新选择。');
      if (target.id==='he-jiawei') await ensureHeChatHistory(account.id);
      if (target.id==='zhou-chef') await ensureChefChatHistory(account.id);
      if (groupAccountScope.current!==expectedScope) throw new Error('账号已切换，请重新转发。');
      const response=await npcFetch(`/api/npc/${target.id}?mode=normal`,{method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':account.id},body:JSON.stringify({action:'send',text,turnId:requestId})});
      const result=await response.json().catch(()=>null) as (PublicSession & {error?:string})|null;
      if (!response.ok) throw new Error(result?.error||'转发失败，请重试。');
      if (!result || !Array.isArray(result.messages) || !result.messages.some(message=>message.role==='user' && message.turnId===requestId)) throw new Error('未收到发送确认，请重试。');
    }
    if (groupAccountScope.current!==expectedScope) throw new Error('账号已切换，请在原账号查看发送结果。');
    openChat(personById(target.id));
    notify('已转发');
  }
  async function sendMessage(
    text = drafts[selected] || '',
    image?: string,
    file?: string,
    audio?: string,
    audioDurationSeconds?: number,
  ) {
    if (selected === 'molly' || activeGroup || (!text.trim() && !image && !file && !audio)) return;
    if(text.trim()&&!image&&!file&&!audio&&await interceptGroupRequest(text))return;
    const m: Message = {
      id: uid(),
      mine: true,
      text: text.trim(),
      replyTo:hiddenMessages[selected]?.includes(quoteDrafts[selected])?undefined:quoteDrafts[selected],
      time: now(),
      at: new Date().toISOString(),
      image,
      file,
      audio,
      audioDurationSeconds,
    };
    if(localCharacterIds.some(id=>id===selected)){
      try{appendLocalCharacterMessage(account.id,selected,m);
        if(selected==='zhou-chef')void rememberLocalTaskMessage(account.id,m).catch(()=>{});
      }
      catch{notify('本机存储空间不足，消息只保留在当前窗口。');}
    }
    setMessages((all) => ({
      ...all,
      [selected]: [...(all[selected] || []), m],
    }));
    setDrafts((d) => ({ ...d, [selected]: '' }));
    setQuoteDrafts(q=>({...q,[selected]:''}));
    requestAnimationFrame(() =>
      thread.current?.scrollTo({
        top: thread.current.scrollHeight,
        behavior: 'smooth',
      }),
    );
  }
  async function interactWithPost(post:Post, action:'like'|'comment', text='') {
    if(interactionBusy)return false;
    const expectedScope=groupAccountScope.current;
    if(post.source!=='npc-moment') {
      if(action==='like')patchPost(post.id,{liked:!post.liked,likeCount:(post.likeCount||Number(post.liked))+ (post.liked?-1:1)});
      else patchPost(post.id,{comments:[...post.comments,{id:uid(),actorId:'self',name:self.nickname||self.name,text,time:now(),replyTo:commentReply?.id,replyToName:commentReply?.name}]});
      return true;
    }
    setInteractionBusy(post.id);
    const key=post.id+'|'+text+'|'+(commentReply?.id||'');
    if(action==='comment' && commentRequest.current?.key!==key)commentRequest.current={key,id:uid()};
    try {
      const response=await npcFetch(`/api/npc/moments/${encodeURIComponent(post.id)}/interaction`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,liked:!post.liked,text,name:self.nickname||self.name,requestId:commentRequest.current?.id,replyTo:commentReply?.id})});
      if(!response.ok){const data=await response.json() as {error?:string};throw Error(data.error||'互动未成功');}
      const data=await response.json() as {items:Array<Post & {createdAt:number;status:string}>};
      if(groupAccountScope.current!==expectedScope)return false;
      receiveNpcPosts(data.items.filter(p=>p.status==='published').map(p=>({...p,time:new Date(p.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}),location:'',source:'npc-moment'})));
      if(action==='comment')commentRequest.current=null;
      window.dispatchEvent(new Event('npc-moments-changed'));return true;
    }catch(e){if(groupAccountScope.current===expectedScope)notify(reportUserFacingError(e,'save','main'));return false;}
    finally{if(groupAccountScope.current===expectedScope)setInteractionBusy('');}
  }
  function beginMomentComment(post:Post,reply?:{id:string;name:string}) {
    const target={accountId:account.id,postId:post.id,id:uid()};
    momentCommentTargetRef.current=target;setMomentCommentTarget(target);setComment('');setCommentReply(reply||null);
  }
  function cancelMomentComment() {
    momentCommentTargetRef.current=null;setMomentCommentTarget(null);setComment('');setCommentReply(null);
  }
  function patchPost(id: string, patch: Partial<Post>) {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function toggleMenu(id: string) {
    setMenu(menu === id ? '' : id);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify('已复制');
    } catch {
      notify('当前浏览器不允许读取剪贴板，请手动复制。');
    }
    setMenu('');
  }
  async function addPostPhotos(files: File[]) {
    if(photoBusy.current||!files.length)return;
    if(uploads.length+files.length>9){notify('每条动态最多9张图片');return;}
    photoBusy.current=true;setUploading(true);
    try{const result=await Promise.all(files.map(readPhoto));setUploads(old=>[...old,...result]);}
    catch(error){notify(reportUserFacingError(error,'save','main'));}
    finally{photoBusy.current=false;setUploading(false);}
  }
  function publishPost() {
    if(uploading||(!postText.trim()&&!uploads.length))return;
    if(chefHistoryProtectedFor!==account.id){notify('旧留言备份暂未完成，请稍后再发布，原归档已保留。');return;}
    const post:Post={id:uid(),personId:'self',createdAt:new Date().toISOString(),text:postText.trim(),time:'刚刚',location:postLocation.trim(),images:[...uploads],liked:false,comments:[]};
    const next=[post,...posts];
    try{localStorage.setItem(store,JSON.stringify({version:2,messages,posts:next,chatIds,unread,muted,hidden,accepted,pinned,markedUnread,dismissed,remarks,selfProfile:self}));}
    catch{notify('本机存储空间不足，内容仍保留在发布窗口，请减少图片后重试');return;}
    setPosts(next);setPostText('');setPostLocation('');setUploads([]);close();
    setHidden(ids=>ids.filter(id=>id!=='self'));openMoments();notify('动态已发布并保存到本机');
  }
  async function readPhoto(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size > 12 * 1024 * 1024) throw new Error('单张图片请小于 12MB');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const ratio = Math.min(1, 1400 / Math.max(img.width, img.height));
          c.width = Math.round(img.width * ratio);
          c.height = Math.round(img.height * ratio);
          c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () =>
          reject(new Error('无法读取这张图片，请使用 JPG、PNG 或 WebP'));
        img.src = typeof reader.result === 'string' ? reader.result : '';
      };
      reader.readAsDataURL(file);
    });
  }

  async function changeProfileBackground(file: File) {
    if (!ready || preferencesAccount !== account.id) {
      notify('资料正在加载，请稍后重试。');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      notify('请选择12MB以内的PNG、JPEG或WebP图片');
      return;
    }
    const expectedScope = groupAccountScope.current;
    const flight = crypto.randomUUID();
    profileBackgroundFlight.current = flight;
    try {
      const src = await readPhoto(file);
      if (groupAccountScope.current !== expectedScope || profileBackgroundFlight.current !== flight) return;
      setSelf(current => ({...current, profileBackground: src}));
      notify('个人资料背景已更新');
    } catch (error) {
      if (groupAccountScope.current === expectedScope && profileBackgroundFlight.current === flight) {
        notify(reportUserFacingError(error,'save','main'));
      }
    } finally {
      if (profileBackgroundFlight.current === flight) profileBackgroundFlight.current = null;
    }
  }

  const matches = (p: Person, q: string) =>
    (p.name + (p.nickname||'') + (p.realName||'') + p.account).toLowerCase().includes(q.toLowerCase());
  const listPeople = [molly,...people].map(displayPerson).filter(
    (p) => !p.group && matches(p, query),
  );
  const groupPeople = groupChats.groups.map(groupPerson).filter(p=>matches(p,query));
  const toggleContactSection = (section: keyof typeof contactSections) =>
    setContactSections(current => ({ ...current, [section]: !current[section] }));
  const beginProfileEdit = (field: 'name' | 'bio') => {
    setProfileDraft(field === 'name' ? self.nickname || self.name : self.bio);
    setProfileEditing(field);
  };
  const saveProfileEdit = () => {
    if (profileEditing === 'name') {
      const name = profileDraft.trim();
      if (!name) { notify('名字不能为空'); return; }
      setSelf(current => ({ ...current, name, nickname: name }));
    } else if (profileEditing === 'bio') {
      setSelf(current => ({ ...current, bio: profileDraft.trim() }));
    }
    setProfileEditing(null);
  };
  const currentPosts = posts.filter(
    (p) => !hidden.includes(p.personId) && (!filter || p.personId === filter),
  );
  const momentsNotifications = posts.filter(post=>post.personId==='self').flatMap(post=>[
    ...(post.likes||[]).filter(like=>like.actorId!=='self').map(like=>({id:`like:${post.id}:${like.actorId}`,postId:post.id,name:like.name,action:'赞了你的动态',detail:post.text,time:post.createdAt||post.time,sortAt:Date.parse(post.createdAt||'')||0})),
    ...post.comments.filter(comment=>!!comment.actorId&&comment.actorId!=='self').map(comment=>({id:`comment:${post.id}:${comment.id}`,postId:post.id,name:comment.name,action:'评论了你的动态',detail:comment.text,time:comment.time,sortAt:Date.parse(comment.time)||Date.parse(post.createdAt||'')||0})),
  ]).sort((a,b)=>b.sortAt-a.sortAt).slice(0,30);
  const close = () => {
    setModal(null);
    setComment('');
    setProfileEditing(null);
  };
  const selfHeader = (
    <div className="zy-self">
      <button type="button" className="zy-self-avatar-button" aria-label="查看我的资料" onClick={event => openProfile(self, event.currentTarget.querySelector<HTMLElement>('.zy-avatar') || event.currentTarget)}>
        <Avatar person={self} size={38} />
      </button>
      <div className="zy-self-copy">
        <strong>{self.nickname||self.account}</strong>
      </div>
    </div>
  );
  const search = (
    <div className="zy-search-row">
      <label className="zy-search">
        <Search size={17} />
        <input
          aria-label="搜索联系人"
          placeholder="搜索联系人、群聊"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <IconButton label="清空搜索" onClick={() => setQuery('')}>
            <X size={14} />
          </IconButton>
        )}
      </label>
      <ChatAddMenu groups={groupChats.groups} onCreateGroup={()=>openGroupDialog(displayPerson(molly))} onSelectGroup={id=>{const group=groupChats.groups.find(item=>item.id===id);if(group)openChat(groupPerson(group));}} onSelectCharacter={id=>{const person=people.find(item=>item.id===id);if(person)openChat(displayPerson(person));}}/>
    </div>
  );
  const mobileDetail = mobile && ((page === 'chat' && !!selected) || (page === 'contacts' && !!contact));
  const personNames=Object.fromEntries([molly,...people].map(item=>[item.id,item.name]));
  const pageTitles: Record<Page, string> = {chat:'消息', contacts:'智友', tasks:'任务', moments:'动态', pets:'多功能',me:'我'};
  const renderClient = () => (
    <main className={'zy-app zy-page-' + page + ' zy-desktop' + (mobile ? ' zy-mobile' : '') + (mobileDetail ? ' is-mobile-detail' : '') + (liquidBaseEnabled ? ' has-liquid-base-plate' : '')}>
      {liquidBaseEnabled && <LiquidBasePlate/>}
      {mobile && (mobileDetail ? <header className="zy-mobile-detail-head">
        <button type="button" aria-label={page === 'contacts' ? '返回联系人列表' : '返回聊天列表'} onClick={() => {if (page === 'contacts') setContact(''); else setSelected('');}}><ArrowLeft/></button>
        <h1>{pageTitles[page]}</h1>
      </header> : <header className="zy-mobile-page-head">
        <button type="button" className="zy-mobile-brand" aria-label="智域首页" onClick={() => navigateMain('chat')}><img data-navigation-logo src={asset('chat',0)} alt="智域"/></button>
        <h1>{pageTitles[page]}</h1>
        <button type="button" className="zy-mobile-self" aria-label="查看我的资料" onClick={event => openProfile(self, event.currentTarget)}><Avatar person={self} size={32}/></button>
        <button type="button" className="zy-mobile-settings" aria-label="设置与菜单" onClick={() => setModal({kind:'settings'})}><Menu/></button>
      </header>)}
      <BrandEntrance src={asset('chat', 0)} />
      <nav className="zy-rail" aria-label="主导航">
        <button
          className="zy-logo"
          aria-label="智域首页"
          onClick={() => navigateMain('chat')}
        >
          <img data-navigation-logo src={asset('chat', 0)} alt="智域" />
        </button>
        <RailNavigation activeIndex={({chat:0,contacts:1,tasks:2,moments:3,pets:4,me:4})[page]}>
          <IconButton
            label="消息"
            pressed={page === 'chat'}
            className={page === 'chat' ? 'active' : ''}
            onClick={() => navigateMain('chat')}
          >
            <span className="zy-nav-glyph">
              <MessageSquare fill={page === 'chat' ? 'currentColor' : 'none'} />
              {notificationUnreadCount > 0 && (
                <span className="zy-badge">
                  {notificationUnreadCount}
                </span>
              )}
            </span>
            <span className="zy-mobile-nav-label" aria-hidden="true">消息</span>
          </IconButton>
          <IconButton
            label="智友"
            pressed={page === 'contacts'}
            className={page === 'contacts' ? 'active' : ''}
            onClick={() => navigateMain('contacts')}
          >
            <Users fill={page === 'contacts' ? 'currentColor' : 'none'} />
            <span className="zy-mobile-nav-label" aria-hidden="true">智友</span>
          </IconButton>
          <IconButton label={hasTaskInProgress?'任务，有正在进行的任务':'任务'} pressed={page === 'tasks'} className={page === 'tasks' ? 'active' : ''} onClick={() => navigateMain('tasks')}>
            <span className="zy-nav-glyph"><CalendarCheck/>{hasTaskInProgress&&<RailNotificationDot label="有正在进行的任务"/>}</span>
            <span className="zy-mobile-nav-label" aria-hidden="true">任务</span>
          </IconButton>
          <IconButton
            label={momentBadge ? '动态，有新内容' : '动态'}
            pressed={page === 'moments'}
            className={page === 'moments' ? 'active' : ''}
            onClick={() => openMoments()}
          >
            <span className="zy-nav-glyph"><Compass fill={page === 'moments' ? 'currentColor' : 'none'} />{momentBadge&&<RailNotificationDot label="动态有新内容"/>}</span>
            <span className="zy-mobile-nav-label" aria-hidden="true">动态</span>
          </IconButton>
          {features.extras && <IconButton
            label="多功能区"
            pressed={page === 'pets'}
            className={page === 'pets' ? 'active' : ''}
            onClick={() => navigateMain('pets')}
          >
            <LayoutGrid />
            <span className="zy-mobile-nav-label" aria-hidden="true">多功能</span>
          </IconButton>}
          {mobile&&<IconButton label="我" pressed={page==='me'} className={page==='me'?'active':''} onClick={()=>navigateMain('me')}><Avatar person={self} size={30}/><span className="zy-mobile-nav-label" aria-hidden="true">我</span></IconButton>}
        </RailNavigation>
        <IconButton
          label="设置与菜单"
          className="zy-rail-bottom"
          onClick={() => setModal({kind:'settings'})}
        >
          <Menu/>
        </IconButton>
      </nav>
      <div className="zy-base"><PageErrorBoundary key={page} resetKey={page}><PageSection render={()=> <>
        {page !== 'moments' && page !== 'pets' && page !== 'tasks' && page !== 'me' && (
          <>
          <aside
            className="zy-directory"
            style={{ width: mobile?undefined:dirWidth }}
            aria-label={page === 'chat' ? '会话列表' : '联系人列表'}
          >
            {selfHeader}
            {search}
            {page === 'chat' ? (
              <div className="zy-list-scroll zy-chat-list">
                {orderedChatIds
                  .map((id) => personById(id))
                  .filter((p) => p.id === 'molly' || matches(p, query))
                  .map((p) => (
                    <button
                      key={p.id}
                      className={
                        'zy-conversation ' + (p.id === 'molly' ? 'zy-molly-pinned ' : '') +
                        (isChatPinned(p.id) ? 'zy-conversation-pinned ' : '') +
                        (selected === p.id ? 'selected' : '')
                      }
                      onContextMenu={e=>{e.preventDefault();setChatMenu({id:p.id,x:Math.min(e.clientX,window.innerWidth-190),y:Math.min(e.clientY,window.innerHeight-160)});}}
                      onClick={() => {
                        setMarkedUnread(ids=>ids.filter(id=>id!==p.id));
                        setSelected(p.id);
                        setUnread((u) => ({ ...u, [p.id]: 0 }));
                      }}
                    >
                      <span className="zy-list-avatar">
                        {p.group ? <GroupAvatar members={groupChats.groups.find(group=>group.id===p.id)!.members} size={34}/> : <Avatar
                          person={p.id==='xia-xia'?{...p,presence:xiaPresence}:p.id==='yuan-xiaoman'?{...p,presence:yuanPresence}:p.id==='liu'?{...p,presence:liuPresence}:p.id==='chen-nian'?{...p,presence:chenPresence}:p.id==='he-jiawei'?{...p,presence:hePresence}:p.id==='zhou-chef'?{...p,presence:chefPresence}:p}
                          size={34}
                        />}
                        {(!!unread[p.id]||markedUnread.includes(p.id)) && (
                          <span
                            className={
                              'zy-badge ' + (isChatMuted(p.id) ? 'is-muted-dot' : p.id === 'yun' ? 'brown' : '')
                            }
                            aria-label={isChatMuted(p.id)?'有未读消息':`${unread[p.id]||1}条未读消息`}
                          >
                            {isChatMuted(p.id)?null:unread[p.id]||1}
                          </span>
                        )}
                      </span>
                      <span className="zy-conversation-copy">
                        <span className="zy-conversation-heading">
                          <span className="zy-conversation-identity">
                            <strong>{p.name}{p.id === 'molly' && <span className="zy-system-label">系统</span>}</strong>
                          </span>
                          <time>
                            {p.id === 'molly' ? null : isChatPinned(p.id) ? <Pin size={13} aria-label="已置顶" /> : (()=>{const formatted=formatConversationTime(conversationAt(p.id));return <span className={formatted.yesterday?'is-yesterday':''}>{formatted.label}</span>;})()}
                          </time>
                        </span>
                        <span className="zy-conversation-preview"><small>
                          {p.group ? groupPreview(visibleGroups.find(group=>group.id===p.id)!) : p.id === 'molly' ? visibleMessages.molly?.at(-1)?.text || '' : visibleMessages[p.id]?.at(-1)?.text || ''}
                        </small>{isChatMuted(p.id)&&<BellOff className="zy-conversation-muted-icon" aria-label="消息免打扰"/>}</span>
                      </span>
                    </button>
                  ))}
                {groupChats.error && <p className="zy-group-load-error" role="alert">{reportUserFacingError(groupChats.error,'load','groups')}<button type="button" onClick={()=>void groupChats.refresh()}>重试</button></p>}
                {!orderedChatIds.some((id) => id!=='molly' && matches(personById(id), query)) && (
                  <div className="zy-empty">
                    <Search />
                    <p>没有找到相关会话</p>
                    <button onClick={() => navigate('contacts')}>
                      去联系人中查找
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="zy-list-scroll zy-address-list">
                <button type="button" className="zy-directory-row zy-contact-section-toggle" aria-expanded={contactSections.new} onClick={() => toggleContactSection('new')}>
                  <ChevronRight className="zy-disclosure-chevron" size={16} /><span>新的朋友</span>
                </button>
                {contactSections.new && <p className="zy-contact-section-empty">让 Molly 帮你认识合适的智友</p>}
                <button type="button" className="zy-directory-row zy-contact-section-toggle" aria-expanded={contactSections.groups} onClick={() => toggleContactSection('groups')}>
                  <ChevronRight className="zy-disclosure-chevron" size={16} /><span>群聊</span><small>{groupPeople.length}</small>
                </button>
                {contactSections.groups && (groupPeople.length ? groupPeople.map(p => <button type="button" className="zy-contact-row" key={p.id} onClick={() => openChat(p)}><GroupAvatar members={groupChats.groups.find(group=>group.id===p.id)!.members} size={34}/><strong>{p.name}</strong></button>) : <p className="zy-contact-section-empty">需要一起安排事情时，可以找 Molly 建群</p>)}
                <button type="button" className="zy-directory-row zy-contact-section-toggle" aria-expanded={contactSections.contacts} onClick={() => toggleContactSection('contacts')}>
                  <ChevronRight className="zy-disclosure-chevron" size={16} /><span>联系人</span><small>{listPeople.length}</small>
                </button>
                {contactSections.contacts &&
                  listPeople.map((p, index) => (
                    <div className={'zy-address-group ' + (index > 0 && listPeople[index - 1].letter !== p.letter ? 'zy-address-group-start' : '')} key={p.id}>
                      {(index === 0 || listPeople[index - 1].letter !== p.letter) && <span className="zy-letter">{p.letter}</span>}
                      <button
                        className={
                          'zy-contact-row ' +
                          (contact === p.id ? 'selected' : '')
                        }
                        onClick={() => {setContact(p.id);}}
                      >
                        <Avatar person={p} size={34} />
                        <strong>{p.name}</strong>
                      </button>
                    </div>
                  ))}
                {contactSections.contacts && !listPeople.length && (
                  <div className="zy-empty">
                    <Search />
                    <p>没有找到相关联系人</p>
                    <button onClick={() => setQuery('')}>清空搜索</button>
                  </div>
                )}
              </div>
            )}
          </aside>
          <DirectoryDivider width={dirWidth} onWidthChange={setDirWidth}/>
          </>
        )}
        {page === 'chat' && !selected && (
          <section className="zy-chat zy-chat-empty" aria-label="未选择会话">
            <div className="zy-empty-logo"><img src="/zhiyu-logo.png" alt="智域" /></div>
          </section>
        )}
        {page === 'chat' && activeGroup && <GroupChatPanel key={`${account.id}:${activeGroup.id}`} group={activeGroup} accountId={account.id} companion={displayPet}
          availablePeople={[molly,...people].map(displayPerson)}
          onForward={beginForward}
          onRename={name=>groupChats.rename(activeGroup.id,name)}
          onSettings={(patch,requestId)=>groupChats.settings(activeGroup.id,patch,requestId)}
          onMembers={(addIds,removeIds,requestId)=>groupChats.members(activeGroup.id,addIds,removeIds,requestId)}
          onClear={requestId=>groupChats.clear(activeGroup.id,requestId)}
          onExit={async requestId=>{const expectedScope=groupAccountScope.current;const result=await groupChats.exit(activeGroup.id,requestId);if(groupAccountScope.current===expectedScope)setSelected('');return result;}}
          onOpen={()=>groupChats.open(activeGroup.id)}
          onRetry={()=>groupChats.retry(activeGroup.id)}
          onSend={(text,mentionIds,requestId,replyTo,media)=>groupChats.send(activeGroup.id,text,mentionIds,requestId,replyTo,media)}
          onConfirmPlan={(planId,requestId)=>groupChats.confirmPlan(activeGroup.id,planId,requestId)}
          onReminder={(reminderId,operation,requestId)=>groupChats.reminder(activeGroup.id,reminderId,operation,requestId)}
        />}
        {page === 'chat' && (selected === 'xia-xia'||selected === 'molly'||selected === 'yuan-xiaoman'||selected === 'liu'||selected === 'chen-nian'||selected === 'he-jiawei'||selected === 'zhou-chef') && <XiaxiaChat key={`${account.id}:${selected}`} onForward={beginForward} taskPageContext={taskConversation?.npcId===selected?taskPageContextFor(taskConversation.task):undefined} taskPageContextKey={taskConversation?.npcId===selected?taskConversation.referenceId:undefined} onDismissTaskPageContext={()=>setTaskConversation(null)} onOpenTasks={openTasks} onOpenGroup={id=>{const group=groupChats.groups.find(item=>item.id===id);if(group)openChat(groupPerson(group));else notify('群聊正在同步，请稍后再试。');}} displayName={person.name} character={selected} legacyDraft={selected==='zhou-chef'?drafts[selected]:undefined} onLegacyDraftConsumed={()=>setDrafts(previous=>({...previous,[selected]:''}))} companion={displayPet} onProfile={anchor=>openProfile(person,anchor)} reportQuote={reportQuote?.characterId===selected?reportQuote:undefined} onReportQuoteConsumed={referenceId=>setReportQuote(current=>!referenceId||current?.referenceId===referenceId?null:current)} onOpenNpc={(id,quoteId,text)=>{const p=people.find(p=>p.id===id);if(p){if(quoteId){setTaskConversation(null);setReportQuote({characterId:id,messageId:quoteId,text,referenceId:crypto.randomUUID()});}openChat(p);}}} onDesktop={()=>openDesktopCharacter(selected)} onCalendar={person.dialoguePurpose==='professional' && person.id!=='molly'?()=>openTaskCalendar(selected):undefined} desktopOpen={dockPersonId===selected} onRealtimeCall={()=>openDesktopCharacter(selected)} onCreateGroup={()=>openGroupDialog(person)} onBeforeSend={selected==='molly'?undefined:text=>interceptGroupRequest(text,selected)} muted={isChatMuted(selected)} onToggleMute={()=>{void toggleChatMute(selected);}} pinned={isChatPinned(selected)} onTogglePin={selected==='molly'?undefined:()=>{void toggleChatPin(selected);}} />}
        {page === 'chat' && !activeGroup && !selected.startsWith('group-') && selected !== '' && selected !== 'xia-xia' && selected !== 'molly' && selected !== 'yuan-xiaoman' && selected !== 'liu' && selected !== 'chen-nian' && selected !== 'he-jiawei' && selected !== 'zhou-chef' && (
          <section className="zy-chat" aria-label="聊天内容">
            <LocalChatHeader key={`${account.id}:${selected}`} messages={visibleMessages[selected]||[]} self={self} thread={thread} name={person.name} avatar={person.avatar} bio={person.bio} status={statusFor(person.id)} dialoguePurpose={person.dialoguePurpose} professionalTitle={person.professionalProfile?.title||person.professionalTitle} onProfile={anchor=>openProfile(person,anchor)}  onDesktop={()=>openDesktopCharacter(selected)} onCalendar={person.dialoguePurpose==='professional' && person.id!=='molly'?()=>openTaskCalendar(selected):undefined} desktopOpen={dockPersonId===selected} onCreateGroup={()=>openGroupDialog(person)} muted={isChatMuted(selected)} onToggleMute={()=>{void toggleChatMute(selected);}} pinned={isChatPinned(selected)} onTogglePin={()=>{void toggleChatPin(selected);}} onClear={()=>clearLocalChat(selected)}/>
            <>
            <div className="zy-thread" ref={thread}>
              <div className="zy-thread-inner">
                {!visibleMessages[selected]?.length && (
                  <div className="zy-chat-welcome">
                    <Avatar person={person} size={64} />
                    <h2>{person.name}</h2><ChatIdentityNotice name={person.name} purpose={person.dialoguePurpose} molly={person.id==='molly'}/>
                  </div>
                )}
                {(visibleMessages[selected] || []).map((m, i, arr) => {
                  const before = arr[i - 1];
                  const after = arr[i + 1];
                  const last =
                    !after || after.mine !== m.mine || after.time !== m.time;
                  const first =
                    !before || before.mine !== m.mine || before.time !== m.time;
                  const textOnly = !m.image && !m.file && !m.audio;
                  const position = bubblePosition(
                    !first && textOnly && !m.replyTo && !before.image && !before.file && !before.audio,
                    !last && textOnly && !after.replyTo && !after.image && !after.file && !after.audio,
                  );
                  return (
                    <div key={m.id}>
                      {m.id === 'm6' && (
                        <div className="zy-unread-line">
                          <span />
                          未读消息
                          <span />
                        </div>
                      )}
                      <div
                        data-local-message-id={m.id}
                        data-bubble-position={position}
                        className={
                          'zy-message ' +
                          (m.mine ? 'mine ' : '') +
                          (first && i > 0 ? 'new-group ' : '') + (first?'group-first ':'') + (last?'group-last ':'')
                        }
                      >
                        {!m.mine && (
                          <span className="zy-message-avatar">
                            {last && <Avatar person={person} size={36} />}
                          </span>
                        )}
                        <div className="zy-message-content">
                          <div className="zy-bubble-wrap" id={'local-message-'+m.id}>
                            {m.replyTo&&(()=>{const original=arr.find(x=>x.id===m.replyTo);return original?<button className="npc-quote" onClick={()=>document.getElementById('local-message-'+original.id)?.scrollIntoView({behavior:'smooth',block:'center'})}><strong>{original.mine?'你':person.name}</strong><span>{original.text||'[图片]'}</span></button>:null;})()}
                            <MessageActions text={m.text} voice={!!m.audio} onQuote={()=>setQuoteDrafts(q=>({...q,[selected]:m.id}))} onDelete={()=>deleteLocalMessage(selected,m.id)} onForward={()=>beginForward(m.text)}>
                            <div className={'zy-bubble'+(m.audio?' zy-bubble-voice':'')}>
                              {m.image && (
                                <ChatImage className="zy-message-photo" messageId={m.id} src={m.image} alt="发送的图片" gallery={{conversationId:selected,images:arr.filter(item=>!!item.image).map(item=>({id:item.id,src:item.image!,alt:'聊天图片',at:item.at,sender:item.mine?'你':person.name}))}}/>
                              )}
                              {m.file && (
                                <span className="zy-file">
                                  <Paperclip size={18} />
                                  {m.file}
                                </span>
                              )}
                              {m.audio?<VoiceBubble src={m.audio} durationSeconds={m.audioDurationSeconds}/>:m.text}
                            </div>
                            </MessageActions>
                            {m.id === 'm2' && (
                              <button
                                title="红心回应"
                                aria-label="红心回应"
                                aria-pressed={reaction}
                                className={
                                  'zy-reaction ' + (reaction ? 'liked' : '')
                                }
                                onClick={() => setReaction(!reaction)}
                              >
                                <Heart
                                  size={13}
                                  fill={reaction ? 'currentColor' : 'none'}
                                />
                              </button>
                            )}
                          </div>
                          {last && (
                            <small className="zy-message-time">
                              {m.time}
                              <MessageReceipt
                                size={16}
                                read={!!m.read}
                                unreadLabel={m.mine?'已保存至本机，未读':'未读'}
                              />
                              <span className="zy-sr">
                                {m.read
                                  ? '已读'
                                  : m.mine
                                    ? '已保存至本机'
                                    : '未读'}
                              </span>
                            </small>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="zy-composer-area">
              {quoteDrafts[selected]&&!hiddenMessages[selected]?.includes(quoteDrafts[selected])&&<div className="npc-quote-draft"><Reply size={15}/><span>{visibleMessages[selected]?.find(m=>m.id===quoteDrafts[selected])?.text||'[图片]'}</span><button aria-label="取消引用" onClick={()=>setQuoteDrafts(q=>({...q,[selected]:''}))}><X size={16}/></button></div>}
              <ChatComposer key={selected} value={drafts[selected]||''} onChange={text=>setDrafts(d=>({...d,[selected]:text}))} placeholder={`和${person.name}说点什么…`} companion={displayPet} onSend={payload=>sendMessage(payload.audioText||payload.text,payload.imageUrl||(payload.assetId?npcAssets[payload.assetId].url:undefined),undefined,payload.audioUrl,payload.audioDurationSeconds)}/>

            </div>
            </>
          </section>
        )}
        {page === 'contacts' && !contact && (
          <section className="zy-chat zy-chat-empty" aria-label="智友">
            <div className="zy-empty-logo"><img src="/zhiyu-logo.png" alt="智域" /></div>
          </section>
        )}
        {page === 'contacts' && !!contact && (
          <section className="zy-contact-detail" aria-label={`${friend.id === 'molly' ? 'Molly' : friend.name}的资料`}>
            <div className={`zy-contact-profile${friend.id === 'molly' ? ' zy-molly-contact-profile' : ''}`}>
              <div className="zy-contact-profile-head">
                <button type="button" className="zy-contact-profile-avatar" aria-label={`查看${friend.name}头像`} disabled={!friend.avatar} onClick={() => friend.avatar && setModal({ kind: 'image', images: [friend.avatar], index: 0 })}><Avatar person={friend} size={60}/></button>
                <div className="zy-contact-profile-identity"><h1>{friend.id === 'molly' ? 'Molly' : friend.name}</h1>{friend.id !== 'molly' && <><p>{friend.account}</p>{friend.region && <p>{friend.region}</p>}</>}</div>
                {friend.id !== 'molly' && <div className="zy-menu-anchor zy-contact-profile-menu">
                  <IconButton label="朋友管理" onClick={() => toggleMenu('friend')}><MoreHorizontal size={18}/></IconButton>
                  {menu === 'friend' && <div className="zy-menu">
                    <button onClick={() => copy(friend.account)}><Copy/>复制账号</button>
                    <button onClick={() => { void toggleChatMute(friend.id); setMenu(''); }}><BellOff/>{isChatMuted(friend.id) ? '关闭消息免打扰' : '消息免打扰'}</button>
                    <button onClick={() => openMoments(friend.id)}><Compass/>查看动态</button>
                  </div>}
                </div>}
              </div>
              {friend.id === 'molly' ? <p className="zy-molly-contact-bio">{friend.bio}</p> : <>
              <section className="zy-contact-profile-section">
                <h2>朋友资料</h2>
                <InlineNameEdit key={`${account.id}:${friend.id}`} label="备注" value={remarks[friend.id] || friend.nickname || allPeople.find(item=>item.id===friend.id)?.name || friend.name} onSave={value=>saveContactRemark(friend.id,value)}/>
              </section>
              {friend.professionalProfile && <ProfessionalProfile profile={friend.professionalProfile} />}
              <section className="zy-contact-profile-section">
                <button type="button" className="zy-contact-profile-moments" onClick={() => openMoments(friend.id)}><span>动态圈</span><span className="zy-contact-profile-thumbnails">{posts.filter(post => post.personId === friend.id).flatMap(post => post.images).slice(0, 4).map((src, index) => <img key={`${src}-${index}`} src={src} alt="动态预览" />)}</span><ChevronRight size={16}/></button>
              </section>
              <section className="zy-contact-profile-section">
                <h2>更多信息</h2>
                <div className="zy-contact-profile-row"><span>状态</span><p><span className="zy-character-status">{statusFor(friend.id)}</span></p></div><div className="zy-contact-profile-row"><span>个性签名</span><p>{friend.bio || '暂无个性签名'}</p></div>
                {!friend.professionalProfile&&friend.professionalTitle&&<div className="zy-contact-profile-row"><span>职业</span><p>{friend.professionalTitle}</p></div>}
                {contactSourceLabel(friend.source,personNames)&&<div className="zy-contact-profile-row"><span>添加来源</span><p>{contactSourceLabel(friend.source,personNames)}</p></div>}
                {friend.added && <div className="zy-contact-profile-row"><span>添加时间</span><p>{friend.added}</p></div>}
              </section>
              </>}
              <div className="zy-contact-profile-actions"><button type="button" onClick={() => openChat(friend)}><MessageCircle size={20} strokeWidth={1.65}/>发消息</button>{friend.id !== 'molly' && <button type="button" aria-label={`打开${friend.name}的桌面人物`} onClick={() => openDesktopCharacter(friend.id)}><Video size={20} strokeWidth={1.65}/>视频</button>}</div>
            </div>
          </section>
        )}
        {page === 'me'&&<section className="zy-me-page" aria-label="我"><header><h1>我</h1></header><div className="zy-me-card"><button type="button" className="zy-me-avatar" onClick={event=>openProfile(self,event.currentTarget)} aria-label="编辑我的资料"><Avatar person={self} size={60}/></button><h2>{self.nickname||self.name}</h2><p>{self.bio}</p><button type="button" onClick={event=>openProfile(self,event.currentTarget)}>编辑资料</button></div><button className="zy-me-settings" type="button" onClick={()=>setModal({kind:'settings'})}>设置<ChevronRight size={18}/></button></section>}
        {page === 'tasks' && <TaskBoard key={account.id} board={taskBoard} dirWidth={dirWidth} onDirectoryWidthChange={setDirWidth} onOpenConversation={(npcId,task)=>{const target=[molly,...people].find(item=>item.id===npcId);if(target){if(task){setReportQuote(null);setTaskConversation({npcId,task,referenceId:crypto.randomUUID()});}else setTaskConversation(null);openChat(displayPerson(target));}}}/>}
        {page === 'pets' && <PetPage accountId={account.id} dirWidth={dirWidth} onDirectoryWidthChange={setDirWidth} />}
        {page === 'moments' && (
          <section className="zy-moments" ref={feed} aria-label="好友动态">
            <div className="zy-moments-cover">
              <img src={filter ? personById(filter).cover || asset('moments', 1) : self.cover || asset('moments', 1)} alt={filter ? personById(filter).coverAlt || `${personById(filter).name}的动态封面` : self.cover ? '我的动态封面' : '雪山摄影封面'} />
              {!filter && <>
                <button type="button" className="zy-moments-cover-change" aria-label="更换动态圈封面" title="更换动态圈封面" onClick={()=>coverInput.current?.click()} />
                <input ref={coverInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024){notify('请选择12MB以内的PNG、JPEG或WebP图片');e.target.value='';return;}void readPhoto(file).then(src=>{setSelf(old=>({...old,cover:src,coverAlt:'我的动态封面'}));notify('动态圈封面已更新');}).catch(error=>notify(reportUserFacingError(error,'save','main')));e.target.value='';}} />
              </>}
              <div className="zy-moments-tools" aria-label="动态圈操作">
                <button type="button" className="zy-moments-tool" aria-label="刷新动态圈" title="刷新" onClick={()=>{setMomentsNotificationsOpen(false);feed.current?.scrollTo({top:0,behavior:'smooth'});window.dispatchEvent(new Event('npc-moments-changed'));notify('正在刷新朋友圈');}}><RefreshCw size={18}/></button>
                <div className="zy-moments-notification-anchor">
                  <button type="button" className="zy-moments-tool" aria-label="动态圈通知" title="通知" aria-expanded={momentsNotificationsOpen} onClick={()=>setMomentsNotificationsOpen(open=>!open)}><Bell size={19}/>{momentsNotifications.length>0&&<i className="zy-moments-notification-dot"/>}</button>
                  {momentsNotificationsOpen&&<section className="zy-moments-notifications" aria-label="动态圈通知">
                    <header><strong>互动通知</strong><button type="button" aria-label="关闭通知" onClick={()=>setMomentsNotificationsOpen(false)}><X size={15}/></button></header>
                    {momentsNotifications.length?momentsNotifications.map(item=><button type="button" className="zy-moments-notification" key={item.id} onClick={()=>{setMomentsNotificationsOpen(false);openMoments();requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById(item.postId)?.scrollIntoView({behavior:'smooth',block:'center'})));}}><span><strong>{item.name}</strong> {item.action}</span>{item.detail&&<small>{item.detail}</small>}<time>{item.time}</time></button>):<p className="zy-moments-notifications-empty">暂时没有新的点赞或评论</p>}
                  </section>}
                </div>
                <button type="button" className="zy-moments-tool" aria-label="发布动态" title="发布动态" onClick={()=>setModal({kind:'publish'})}><Camera size={19}/></button>
              </div>
              <button
                className="zy-self-cover-avatar zy-moments-cover-profile"
                aria-label={filter ? `查看${personById(filter).name}的资料` : '查看我的资料'}
                onClick={event => openProfile(filter ? personById(filter) : self, event.currentTarget.querySelector<HTMLElement>('.zy-avatar') || event.currentTarget)}
              >
                <Avatar
                  person={
                    filter
                      ? personById(filter)
                      : self
                  }
                  size={64}
                />
              </button>
            </div>
            <div className="zy-feed-stream">
              {filter && (
                <button className="zy-back-feed" onClick={() => openMoments()}>
                  <ArrowLeft size={16} />
                  返回全部好友动态
                </button>
              )}
              {currentPosts.map((post) => {
                const author = personById(post.personId);
                return (
                  <article className={`zy-post ${post.personId==='self'?'is-self':'is-npc'}`} key={post.id} id={post.id}>
                    <header>
                      <button
                        className="zy-post-person"
                        onClick={event => openProfile(author, event.currentTarget.querySelector<HTMLElement>('.zy-avatar') || event.currentTarget)}
                      >
                        <Avatar
                          person={
                            post.personId === 'lin'
                              ? { ...author, avatar: asset('moments', 3) }
                              : post.personId === 'shen'
                                ? { ...author, avatar: asset('moments', 7) }
                                : author
                          }
                          size={42}
                        />
                        <span>
                          <span>
                            <strong>{author.name}</strong>
                          </span>
                          {author.id!=='self'&&<small className="zy-character-status zy-moment-status">{statusFor(author.id)}</small>}
                        </span>
                      </button>
                      <time className="zy-post-published-time" dateTime={post.createdAt}>{post.time}</time>
                      <div className="zy-menu-anchor">
                        <IconButton
                          label={`${author.name}动态更多操作`}
                          onClick={() => toggleMenu(post.id)}
                        >
                          <MoreHorizontal size={20} />
                        </IconButton>
                        {menu === post.id && (
                          <div className="zy-menu">
                            <button
                              onClick={() => {
                                patchPost(post.id, { saved: !post.saved });
                                setMenu('');
                                notify(
                                  post.saved ? '已取消收藏' : '已收藏到本机',
                                );
                              }}
                            >
                              <Bookmark />
                              {post.saved ? '取消收藏' : '收藏'}
                            </button>
                            <button onClick={() => copy(post.text)}>
                              <Copy />
                              复制动态文案
                            </button>
                            <button
                              onClick={() => {
                                setHidden((ids) => [...ids, post.personId]);
                                setMenu('');
                                notify('已隐藏该好友动态，可在设置中恢复');
                              }}
                            >
                              <EyeOff />
                              不看该好友
                            </button>
                          </div>
                        )}
                      </div>
                    </header>
                    {post.text && <p className="zy-post-caption">{post.text}</p>}
                    <Media
                      post={post}
                      open={(images, index) =>
                        setModal({ kind: 'image', images, index })
                      }
                    />
                    <MomentChatScreenshot post={post} person={author}/>
                    {post.location && (
                      <div className="zy-location">
                        <MapPin size={16} />
                        {post.location}
                      </div>
                    )}
                    <MomentPostInteractions post={post} authorName={author.name} selfName={self.nickname||self.name}
                      actorName={(id,fallback)=>[molly,...allPeople].some(person=>person.id===id)?personById(id).name:fallback} busy={interactionBusy===post.id}
                      onLike={()=>void interactWithPost(post,'like')} onComment={()=>beginMomentComment(post)} onReply={reply=>beginMomentComment(post,reply)}
                      editor={momentCommentTarget?.accountId===account.id&&momentCommentTarget.postId===post.id?<MomentCommentEditor key={`${account.id}:${post.id}:${momentCommentTarget.id}`}
                        value={comment} onChange={setComment} disabled={!!interactionBusy} replyName={commentReply?.name} onCancelReply={()=>setCommentReply(null)} onCancel={cancelMomentComment}
                        onSubmit={async()=>{const target=momentCommentTargetRef.current;if(!target||target.accountId!==account.id||target.postId!==post.id||!comment.trim()||interactionBusy)return;
                          if(await interactWithPost(post,'comment',comment.trim())&&momentCommentTargetRef.current?.id===target.id){setComment('');setCommentReply(null);}}}/>:undefined}/>
                  </article>
                );
              })}
              {!currentPosts.length && (
                <div className="zy-empty">
                  <Compass />
                  <p>
                    {filter ? '这位朋友还没有发布动态' : '暂时没有可见动态'}
                  </p>
                  <button
                    onClick={() => {
                      setHidden([]);
                      openMoments();
                    }}
                  >
                    查看全部好友动态
                  </button>
                </div>
              )}
              <div className="zy-feed-end">
                <span />
                智域 · 到底了
              </div>
            </div>
          </section>
        )}
      </>}/></PageErrorBoundary></div>
      <input
        type="file"
        hidden
        ref={attachment}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            if (file.type.startsWith('image/'))
              void sendMessage('', await readPhoto(file));
            else notify('请选择图片');
          } catch (err) {
            notify(reportUserFacingError(err,'save','main'));
          }
        }}
      />
      <input
        type="file"
        hidden
        multiple
        accept="image/*"
        ref={photos}
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          await addPostPhotos(files);
        }}
      />
      {modal?.kind === 'image' && (
        <Lightbox images={modal.images} start={modal.index} close={close} />
      )}
      {modal?.kind === 'publish' && (
        <Dialog title="记录此刻" close={close} className="zy-publish-dialog">
          <div className="zy-publish-editor" onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();void addPostPhotos(Array.from(e.dataTransfer.files));}} onPaste={e=>{const files=Array.from(e.clipboardData.files).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();void addPostPhotos(files);}}}>
          <div className="zy-publish-person">
            <Avatar person={self} size={40} />
            <strong>{self.nickname||self.account}</strong>
            <small>记录你此刻的生活</small>
          </div>
          <textarea
            aria-label="动态文案"
            placeholder="分享今天的一点新鲜事…"
            value={postText}
            maxLength={3000}
            onChange={(e) => setPostText(e.target.value)}
          />
          <p className="zy-publish-hint">可以只写文字，也可以粘贴或拖入图片 · 最多9张</p>
          <div className="zy-upload-grid">
            {uploads.map((src, i) => (
              <div key={i}>
                <img src={src} alt={`待发布图片 ${i + 1}`} />
                <IconButton
                  label={`移除图片 ${i + 1}`}
                  onClick={() => setUploads((a) => a.filter((_, n) => n !== i))}
                >
                  <X size={14} />
                </IconButton>
              </div>
            ))}
            {uploads.length < 9 && (
              <button
                className="zy-photo-add"
                onClick={() => photos.current?.click()}
                disabled={uploading}
              >
                <ImagePlus />
                <span>{uploading ? '读取中…' : '添加照片'}</span>
              </button>
            )}
          </div>
          <label className="zy-publish-location">
            <MapPin size={16} />
            <input
              aria-label="动态地点"
              placeholder="添加地点（可选）"
              value={postLocation}
              onChange={(e) => setPostLocation(e.target.value)}
            />
          </label>
          <footer>
            <small>仅保存在本机，不会发布到 Stitch 或其他平台。</small>
            <button
              className="zy-primary"
              disabled={uploading || (!postText.trim() && !uploads.length)}
              onClick={publishPost}
            >
              发布
            </button>
          </footer>
          </div>
        </Dialog>
      )}
      {modal?.kind === 'settings' && <AppSettings person={self} username={account.username} onLogout={logout} onClose={close}/> }
      {groupCreating && !groupCreate && <output className="zy-group-creation-status">Molly 正在起群名并创建群聊…</output>}
      {groupCreate && <GroupCreateDialog key={groupCreate.requestId} source={groupCreate.source} people={[molly,...people].map(displayPerson)} initialGoal={groupCreate.goal} initialMemberIds={groupCreate.memberIds} busy={groupCreating} error={groupError} onClose={closeGroupDialog} onCreate={input=>createGroup(groupCreate.source,input.goal,input.memberIds,groupCreate.requestId)}/>}
      {forwardDraft?.accountId===account.id && <MessageForwardDialog key={forwardDraft.id} text={forwardDraft.text} targets={[
        ...[molly,...people].map(displayPerson).map(target=>({id:target.id,name:target.name,face:<Avatar person={target} size={36}/>})),
        ...visibleGroups.map(group=>({id:group.id,name:group.name,face:<GroupAvatar members={group.members} size={36}/>,pending:group.pending,disabled:!group.chatEnabled?'群聊尚未开放发言':undefined})),
      ]} onSend={forwardMessage} onClose={()=>setForwardDraft(null)}/>}
      {chatMenu && <div className="zy-chat-context" role="menu" style={{left:chatMenu.x,top:chatMenu.y}}>
        <button role="menuitem" onClick={()=>{void toggleChatMute(chatMenu.id);setChatMenu(null);}}>{isChatMuted(chatMenu.id)?'关闭消息免打扰':'消息免打扰'}</button>
        <button role="menuitem" disabled={chatMenu.id==='molly'||!!groupPinBusy} onClick={()=>{void toggleChatPin(chatMenu.id);}}>{chatMenu.id==='molly'?'Molly 永久置顶':groupPinBusy===chatMenu.id?'保存中…':isChatPinned(chatMenu.id)?'取消置顶':'置顶'}</button>
        <button role="menuitem" onClick={()=>{setMarkedUnread(ids=>[...new Set([...ids,chatMenu.id])]);setChatMenu(null);}}>标为未读</button>
        <button role="menuitem" disabled={chatMenu.id==='molly'} onClick={()=>{const id=chatMenu.id;setDismissed(old=>({...old,[id]:messages[id]?.at(-1)?.id||''}));if(selected===id)setSelected('molly');setChatMenu(null);notify('已移除会话；可从联系人重新打开，聊天记录保留。');}}>删除会话</button>
      </div>}
      {modal?.kind === 'profile' && (
        <ProfilePopover key={`${account.id}:${modal.person.id}`} title={modal.person.id==='self'?'我的资料':modal.person.id==='molly'?'Molly的资料':'朋友资料'} anchor={modal.anchor} close={close} className={`${modal.person.id === 'self' ? 'zy-self-profile-popover' : ''} ${modal.person.professionalProfile ? 'zy-professional-profile-popover' : ''} ${modal.person.dialoguePurpose === 'companion' ? 'zy-companion-profile-popover' : ''}`}>
          {modal.person.id==='self'?<>
            <SelfProfileCard name={self.nickname || self.name} account={self.account} signature={self.bio} background={self.profileBackground} avatar={<Avatar person={self} size={56}/>} editing={profileEditing} draft={profileDraft} onBeginEdit={beginProfileEdit} onDraftChange={setProfileDraft} onSaveEdit={saveProfileEdit} onCancelEdit={()=>setProfileEditing(null)} onAvatar={()=>avatarInput.current?.click()} onBackground={()=>profileBackgroundInput.current?.click()}/>
            <input ref={avatarInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024){notify('请选择4MB以内的PNG、JPEG或WebP图片');return;}const reader=new FileReader();reader.onload=()=>{setSelf(old=>({...old,avatar:typeof reader.result==='string'?reader.result:''}));notify('头像已更新');};reader.readAsDataURL(file);e.target.value='';}}/>
            <input ref={profileBackgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择个人资料背景图片" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void changeProfileBackground(file);}}/>
          </>:modal.person.id==='molly'?<div className="zy-npc-profile-card zy-molly-profile-card">
            <div className="zy-npc-profile-top"><Avatar person={modal.person} size={48}/><div className="zy-npc-identity"><h3>Molly</h3></div></div>
            <dl className="zy-friend-details"><dt>状态</dt><dd><span className="zy-character-status">{statusFor('molly')}</span></dd><dt className="zy-profile-signature-label">个性签名</dt><dd className="zy-profile-signature-value" title={modal.person.bio || '暂无个性签名'}>{modal.person.bio}</dd></dl><dl className="zy-friend-source"><dt>添加来源</dt><dd>{contactSourceLabel('default')}</dd></dl>
            <div className="zy-npc-profile-actions"><button type="button" onClick={()=>openChat(modal.person)}><MessageCircle strokeWidth={1.65}/>发消息</button></div>
          </div>:<div className="zy-npc-profile-card">
            <div className="zy-npc-profile-top"><Avatar person={modal.person} size={48}/><div className="zy-npc-identity"><h3>{displayPerson(modal.person).name}{modal.person.gender&&<span className={'zy-gender '+modal.person.gender} aria-label={modal.person.gender==='female'?'女生':'男生'}>{modal.person.gender==='female'?'♀':'♂'}</span>}</h3><p>{modal.person.account}</p>{modal.person.region&&<p>{modal.person.region}</p>}</div></div>
            <section className="zy-friend-details"><h4>朋友资料</h4><InlineNameEdit key={`${account.id}:${modal.person.id}`} label="备注" value={remarks[modal.person.id] || modal.person.nickname || allPeople.find(item=>item.id===modal.person.id)?.name || modal.person.name} onSave={value=>saveContactRemark(modal.person.id,value)}/><dl><dt>状态</dt><dd><span className="zy-character-status">{statusFor(modal.person.id)}</span></dd><dt className="zy-profile-signature-label">个性签名</dt><dd className="zy-profile-signature-value" title={modal.person.bio || '暂无个性签名'}>{modal.person.bio || '暂无个性签名'}</dd>{!modal.person.professionalProfile&&modal.person.professionalTitle&&<><dt>职业</dt><dd>{modal.person.professionalTitle}</dd></>}</dl></section>
            {modal.person.professionalProfile && <ProfessionalProfile profile={modal.person.professionalProfile} />}
            <button type="button" className="zy-profile-moments" onClick={()=>{const id=modal.person.id;close();openMoments(id);}}><span className="zy-profile-moments-label">动态圈</span><span className="zy-profile-moments-content">{posts.filter(p=>p.personId===modal.person.id).flatMap(p=>p.images).slice(0,4).map((src,i)=><img key={`${src}-${i}`} src={src} alt="动态预览"/>)}</span><ChevronRight className="zy-profile-moments-chevron" size={15}/></button>
            {contactSourceLabel(modal.person.source,personNames)&&<dl className="zy-friend-source"><dt>添加来源</dt><dd>{contactSourceLabel(modal.person.source,personNames)}</dd></dl>}
            <div className="zy-npc-profile-actions"><button type="button" onClick={()=>openChat(modal.person)}><MessageCircle strokeWidth={1.65}/>发消息</button><button type="button" aria-label={`打开${displayPerson(modal.person).name}的桌面人物`} onClick={()=>{const id=modal.person.id;close();openDesktopCharacter(id);}}><Video strokeWidth={1.65}/>视频</button></div>
          </div>}
        </ProfilePopover>
      )}
      {toast && (
        <output className="zy-toast">
          <Check size={17} />
          {toast}
        </output>
      )}
    </main>
  );
  return <PageErrorBoundary><div className="zy-dual-preview"><div className="zy-desktop-slot">{renderClient()}</div></div></PageErrorBoundary>;
}
function Lightbox({
  images,
  start,
  close,
}: {
  images: string[];
  start: number;
  close: () => void;
}) {
  const [index, setIndex] = useState(start);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight')
        setIndex((i) => Math.min(images.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [images.length]);
  return (
    <Dialog
      title={`${index + 1} / ${images.length}`}
      close={close}
      className="zy-lightbox"
    >
      <div className="zy-lightbox-image">
        <img src={images[index]} alt={`图片 ${index + 1}`} />
        {index > 0 && (
          <IconButton
            label="上一张"
            className="prev"
            onClick={() => setIndex(index - 1)}
          >
            <ChevronLeft />
          </IconButton>
        )}
        {index < images.length - 1 && (
          <IconButton
            label="下一张"
            className="next"
            onClick={() => setIndex(index + 1)}
          >
            <ChevronRight />
          </IconButton>
        )}
      </div>
    </Dialog>
  );
}
