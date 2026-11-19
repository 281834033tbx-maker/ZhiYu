'use client';
/* eslint-disable next/no-img-element */
import {createContext,useContext,useCallback,useEffect,useLayoutEffect,useId,useRef,useState,type CSSProperties,type ReactNode,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ChevronRight,Plus,Search,UserRoundPlus,Users} from 'lucide-react';
import type {Person} from './data';
import type {GroupChat} from '../../lib/npc/group-chat';
import {GroupAvatar,groupPreview} from './group-chat';
import {MobileIconButton,MobileSubmitButton,useMobileFirstEntry} from './mobile-effects';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import './mobile-detail-pages.css';

export const MobileHeaderContext=createContext<{mobile:boolean;onBack:()=>void;onDetailChange?:(id:string,open:boolean)=>void;onRemoveContact?:()=>Promise<void>|void;onRestoreContact?:()=>Promise<void>|void}>({mobile:false,onBack:()=>{}});
export function MobileFace({person,size=42}:{person:Person;size?:number}) {return <span className="zy-mobile-face" style={{width:size,height:size}}>{person.avatar?<img src={person.avatar} alt=""/>:<span>{(person.nickname||person.name).slice(0,1)}</span>}</span>;}
export function MobilePageHeader({title,onBack,onCreate,backDisabled=false}:{title:string;onBack?:()=>void;onCreate?:()=>void;backDisabled?:boolean}) {return <header className="zy-mobile-header">{onBack&&<MobileIconButton aria-label="返回" disabled={backDisabled} onClick={onBack}><ArrowLeft size={22}/></MobileIconButton>}{title==='消息'?<img data-navigation-logo className="zy-mobile-header-logo" src="/zhiyu-logo.png" alt="智域"/>:<h1>{title}</h1>}{onCreate&&<MobileIconButton className="zy-mobile-header-right" aria-label="发起群聊" onClick={onCreate}><Plus size={22}/></MobileIconButton>}</header>;}
export function MobileSearch({value,onChange}:{value:string;onChange:(value:string)=>void}) {return <label className="zy-mobile-search"><Search size={16} strokeWidth={2}/><input aria-label="搜索" placeholder="搜索" type="search" value={value} onChange={event=>onChange(event.target.value)}/></label>;}

const collator=new Intl.Collator('zh-CN-u-co-pinyin');
export function mobileInitial(name:string) {
 const first=name.trim().slice(0,1);if(/^[a-z]$/i.test(first))return first.toUpperCase();
 const bounds=['阿','八','嚓','搭','蛾','发','噶','哈','击','喀','垃','妈','拿','噢','啪','期','然','撒','塌','挖','昔','压','匝'],letters='ABCDEFGHJKLMNOPQRSTWXYZ';
 if(!/\p{Script=Han}/u.test(first))return '#';let result='#';for(let i=0;i<bounds.length;i++){if(collator.compare(first,bounds[i])<0)break;result=letters[i];}return result;
}
const mobileContactSort=(a:Person,b:Person)=>{const x=mobileInitial(a.name),y=mobileInitial(b.name);return x===y?collator.compare(a.name,b.name):x==='#'?1:y==='#'?-1:x.localeCompare(y,'en');};
export function MobileContacts({accountId,people,query,onQuery,statusFor,onProfile,onGroups,onNew}:{accountId:string;people:Person[];query:string;onQuery:(v:string)=>void;statusFor:(id:string)=>string;onProfile:(p:Person,anchor:HTMLElement)=>void;onGroups:()=>void;onNew:()=>void}) {
 const first=useMobileFirstEntry(accountId+':contacts');
 const filtered=people.filter(p=>[p.name,p.account,p.nickname,p.realName].some(v=>v?.toLowerCase().includes(query.toLowerCase()))).sort(mobileContactSort);
 const groups=new Map<string,Person[]>();for(const p of filtered){const key=mobileInitial(p.name);groups.set(key,[...(groups.get(key)||[]),p]);}
 return <section className={'zy-mobile-contacts'+(first?' is-first-entry':'')}><MobileSearch value={query} onChange={onQuery}/><div className="zy-mobile-contacts-scroll">
  <button type="button" className="zy-mobile-contact-entry" onClick={onNew}><span className="zy-mobile-entry-icon"><span><UserRoundPlus size={18}/></span></span><span>新的朋友</span><ChevronRight size={16}/></button>
  <button type="button" className="zy-mobile-contact-entry" onClick={onGroups}><span className="zy-mobile-entry-icon"><span><Users size={18}/></span></span><span>群聊</span><ChevronRight size={16}/></button>
  {[...groups].map(([letter,rows])=><section key={letter} id={'zy-mobile-letter-'+letter} className="zy-mobile-contact-group"><h2 className="zy-mobile-contact-letter">{letter}</h2>{rows.map(p=><button type="button" key={p.id} className={'zy-mobile-contact-row'+(filtered.indexOf(p)<12?' zy-mobile-entry':'')} style={{'--zy-m-entry-delay':Math.min(filtered.indexOf(p),11)*35+'ms'} as CSSProperties} onClick={event=>onProfile(p,event.currentTarget)}><MobileFace person={p}/><span className="zy-mobile-contact-copy"><strong>{p.name}{p.dialoguePurpose==='professional'&&<span className="zy-mobile-pro-label">专业智友</span>}</strong><small>{statusFor(p.id)}</small></span></button>)}</section>)}
  </div><div className="zy-mobile-letter-index" aria-label="联系人字母索引">{'ABCDEFGHJKLMNPQRSTWXYZ#'.split('').map(letter=><button type="button" key={letter} className={groups.has(letter)?'has-people':''} aria-label={'跳到'+letter} onClick={()=>document.getElementById('zy-mobile-letter-'+letter)?.scrollIntoView({block:'start',behavior:'smooth'})}>{letter}</button>)}</div></section>;
}
export function MobileGroupList({groups,onOpen,onBack}:{groups:GroupChat[];onOpen:(id:string)=>void;onBack:()=>void}) {
 const [query,setQuery]=useState('');const rows=groups.filter(g=>g.name.toLowerCase().includes(query.toLowerCase()));
 return <section className="zy-mobile-subpage zy-mobile-groups"><MobilePageHeader title="群聊" onBack={onBack}/><MobileSearch value={query} onChange={setQuery}/><div className="zy-mobile-groups-scroll">{rows.map(g=><button type="button" className="zy-mobile-group-row" key={g.id} onClick={()=>onOpen(g.id)}><GroupAvatar members={g.members} size={48}/><span className="zy-mobile-group-copy"><strong>{g.name}</strong><small>{g.members.map(m=>m.name).join('、')}</small><span className="zy-sr">{groupPreview(g)}</span></span></button>)}<footer>{rows.length} 个群聊</footer></div></section>;
}
export function MobileNewFriends({onBack,removedPeople=[],onRestore}:{onBack:()=>void;removedPeople?:Person[];onRestore?:(id:string)=>void}) {return <section className="zy-mobile-subpage"><MobilePageHeader title="新的朋友" onBack={onBack}/>{removedPeople.length?<div className="zy-mobile-contacts-scroll"><p className="zy-mobile-empty">已移除的联系人</p>{removedPeople.map(person=><div key={person.id} className="zy-mobile-restore-contact"><MobileFace person={person}/><strong>{person.name}</strong><button type="button" onClick={()=>onRestore?.(person.id)}>重新添加</button></div>)}</div>:<p className="zy-mobile-empty">暂时没有新的朋友</p>}</section>;}

/** Portal each mobile detail into the phone root so header/scroll transforms
 * never move its parent conversation or clip the full-screen page. */
export function MobileDetailSurface({children,close,title,className='',dismissDisabled=false}:{children:ReactNode;close:()=>void;title:string;className?:string;dismissDisabled?:boolean}) {
 const {mobile,onDetailChange}=useContext(MobileHeaderContext),id=useId();
 const [closing,setClosing]=useState(false),start=useRef<{x:number;y:number}|null>(null),ref=useRef<HTMLDialogElement>(null),closeRef=useRef(close),timer=useRef<ReturnType<typeof setTimeout>|null>(null),closingLock=useRef(false),disabledRef=useRef(dismissDisabled);
 useLayoutEffect(()=>{disabledRef.current=dismissDisabled;},[dismissDisabled]);
 useLayoutEffect(()=>{closeRef.current=close;},[close]);
 const dismiss=useCallback(()=>{if(closingLock.current||disabledRef.current)return;closingLock.current=true;setClosing(true);timer.current=setTimeout(()=>closeRef.current(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:260);},[]);
 useLayoutEffect(()=>{if(!mobile)return;onDetailChange?.(id,true);return()=>onDetailChange?.(id,false);},[mobile,id,onDetailChange]);
 useEffect(()=>{if(!mobile)return;const previous=document.activeElement as HTMLElement|null;ref.current?.focus();const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.key!=='Escape')return;if(document.querySelector('dialog:modal')||[...document.querySelectorAll('.zy-mobile-detail-page')].at(-1)!==ref.current)return;e.preventDefault();e.stopImmediatePropagation();dismiss();};document.addEventListener('keydown',key);return()=>{if(timer.current)clearTimeout(timer.current);document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus({preventScroll:true});};},[mobile,dismiss]);
 if(!mobile)return children;
 const down=(event:PointerEvent)=>{start.current={x:event.clientX,y:event.clientY};};
 const content=<dialog open ref={ref} tabIndex={-1} aria-label={title} className={'zy-mobile-detail-page '+className+(closing?' is-closing':'')} onPointerDown={down} onPointerUp={event=>{const origin=start.current;start.current=null;if(origin&&origin.x<48&&event.clientX-origin.x>70&&Math.abs(event.clientY-origin.y)<50)dismiss();}}><MobilePageHeader title={title} onBack={dismiss} backDisabled={dismissDisabled}/><div className="zy-mobile-detail-scroll">{children}</div></dialog>;
 const root=typeof document==='undefined'?null:document.querySelector('main.zy-mobile');
 return root?createPortal(content,root):content;
}

export function MobileProfileDrawer({children,close,title,className=''}:{children:ReactNode;close:()=>void;title?:string;className?:string;anchor?:HTMLElement|null}) {
 return <MobileDetailSurface title={title==='我的资料'?'我的资料':'个人信息'} close={close} className={'zy-mobile-profile-drawer '+className}>{children}</MobileDetailSurface>;
}

export function MobileMePage({self,onEdit,settings}:{self:Person;accountId:string;onEdit:(anchor:HTMLElement)=>void;settings:ReactNode}) {
 return <section className="zy-mobile-me"><MobilePageHeader title="我"/><div className="zy-mobile-me-card"><MobileFace person={self} size={60}/><div><h2>{self.nickname||self.name}</h2><p>{self.bio}</p></div><MobileIconButton aria-label="编辑资料" onClick={event=>onEdit(event.currentTarget)}>编辑</MobileIconButton></div>{settings}<p className="zy-mobile-ai-note">智友由 AI 驱动，可能会出错，重要的事请自己再确认</p></section>;
}

export function MobileGroupCreate({people,source,initialGoal='',initialMemberIds=[],onClose,onCreate,onComplete}:{people:Person[];source:Person;initialGoal?:string;initialMemberIds?:string[];onClose:()=>void;onCreate:(goal:string,ids:string[])=>Promise<GroupChat>;onComplete:(group:GroupChat)=>void}) {
 const [query,setQuery]=useState(''),[goal,setGoal]=useState(initialGoal),[selected,setSelected]=useState(()=>new Set(['molly',source.id,...initialMemberIds])),[error,setError]=useState(''),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const dismiss=()=>{if(busy)return;setClosing(true);timer.current=setTimeout(onClose,matchMedia('(prefers-reduced-motion: reduce)').matches?0:260);};
 const rows=[...new Map(people.map(p=>[p.id,p])).values()].filter(p=>!p.group&&p.id!=='self'&&[p.name,p.account,p.nickname].some(v=>v?.toLowerCase().includes(query.toLowerCase()))).sort(mobileContactSort);
 return <dialog open className={'zy-mobile-subpage zy-mobile-group-create'+(closing?' is-closing':'')} aria-modal="true" aria-label="发起群聊"><header className="zy-mobile-header"><button type="button" disabled={busy} onClick={dismiss}>取消</button><h1>发起群聊</h1><MobileSubmitButton className="zy-mobile-create-done" disabled={!goal.trim()} onSubmit={async()=>{setBusy(true);setError('');try{return await onCreate(goal.trim(),[...selected]);}catch(e){setBusy(false);throw e;}}} onError={e=>setError(reportUserFacingError(e,'save','创建群聊'))} onComplete={onComplete}>完成({selected.size})</MobileSubmitButton></header><MobileSearch value={query} onChange={setQuery}/><p className="zy-mobile-host-note">Molly 将主持群聊、协调分工</p><label className="zy-mobile-group-goal"><span>想一起做什么？</span><textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder="写下这次群聊的目标" disabled={busy}/></label>{error&&<p role="alert">{error}</p>}<div className="zy-mobile-create-list">{rows.map((p,index)=>{const fixed=p.id==='molly'||p.id===source.id,checked=selected.has(p.id),letter=mobileInitial(p.name),prev=rows[index-1];return <div key={p.id}>{(!prev||mobileInitial(prev.name)!==letter)&&<h2 className="zy-mobile-contact-letter">{letter}</h2>}<label className="zy-mobile-create-row"><input type="checkbox" checked={checked} disabled={fixed||busy} onChange={()=>setSelected(old=>{const next=new Set(old);if(next.has(p.id))next.delete(p.id);else next.add(p.id);return next;})}/><i aria-hidden="true" className={checked?'is-selected':''}>{checked?'✓':''}</i><MobileFace person={p} size={36}/><span>{p.name}</span>{fixed&&<small>{p.id==='molly'?'主持人':'固定成员'}</small>}</label></div>;})}</div></dialog>;
}

export type MobileIncoming={id:string;person:Person;text:string;messageId:string};
export function MobileMessageBanner({items,currentChat,onMessagesPage,onOpen}:{items:MobileIncoming[];currentChat:string;onMessagesPage:boolean;onOpen:(id:string)=>void}) {
 const swiped=useRef(false),seen=useRef<Map<string,string>|null>(null),[incoming,setIncoming]=useState<MobileIncoming|null>(null),[leaving,setLeaving]=useState(false),start=useRef(0);
 useEffect(()=>{const old=seen.current;seen.current=new Map(items.map(i=>[i.id,i.messageId]));if(!old)return;const next=items.find(item=>old.has(item.id)&&old.get(item.id)!==item.messageId&&item.messageId);if(next&&!onMessagesPage&&next.id!==currentChat){setLeaving(false);setIncoming(next);}},[items,currentChat,onMessagesPage]);
 useEffect(()=>{if(!incoming)return;const t=setTimeout(()=>setLeaving(true),4000);return()=>clearTimeout(t);},[incoming]);
 useEffect(()=>{if(!leaving)return;const t=setTimeout(()=>setIncoming(null),220);return()=>clearTimeout(t);},[leaving]);
 if(!incoming||onMessagesPage||incoming.id===currentChat)return null;
 return <output className={'zy-mobile-message-banner'+(leaving?' is-leaving':'')} aria-label={`${incoming.person.name}发来消息`}><button type="button" onPointerDown={e=>{start.current=e.clientY;swiped.current=false;}} onPointerUp={e=>{if(start.current-e.clientY>30){swiped.current=true;setLeaving(true);}}} onClick={()=>{if(leaving||swiped.current)return;onOpen(incoming.id);setIncoming(null);}}><MobileFace person={incoming.person}/><span><strong>{incoming.person.name}</strong><small>{incoming.text}</small></span><time>刚刚</time></button></output>;
}
