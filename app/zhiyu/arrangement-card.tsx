'use client';

import {useState} from 'react';
import {ArrowUpRight,CalendarCheck,Check} from 'lucide-react';
import type {ArrangementItem} from '../../lib/npc/arrangement-types';
import {arrangementCardSubtitle,arrangementSectionName,type ArrangementSectionId} from '../../lib/npc/arrangement-sections';
import {publicGroupDirectory} from '../../lib/npc/character-directory';
import {useAccount} from './auth-gate';
import {mutateArrangement,openArrangementSection} from './task-board/use-arrangements';
import './arrangement-card.css';

export type ArrangementOfferData={id:string;section:ArrangementSectionId;title:string;question?:string;decision?:'accepted'|'declined'};
export function ArrangementOffer({offer,onChoose,disabled=false}:{offer:ArrangementOfferData;onChoose:(text:'好'|'不用',offerId:string)=>void|Promise<void>;disabled?:boolean}) {
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[localDecision,setLocalDecision]=useState<ArrangementOfferData['decision']>();
  const decision=offer.decision||localDecision;
  async function choose(text:'好'|'不用'){if(pending||disabled||decision)return;setPending(true);setError('');try{await onChoose(text,offer.id);setLocalDecision(text==='好'?'accepted':'declined');}catch{setError('没有发送成功，请重试。');}finally{setPending(false);}}
  return <section className="zy-arrangement-offer" aria-label="让 Molly 记录安排">
    <p>{offer.question||`要不要让Molly记进${arrangementSectionName(offer.section)}呀`}</p>
    {decision?<span className="zy-arrangement-offer-result"><Check size={13}/>{decision==='accepted'?'已同意':'不用记录'}</span>:<div className="zy-arrangement-offer-options">{(['好','不用'] as const).map(text=><button type="button" key={text} disabled={disabled||pending} onClick={()=>void choose(text)}>{text}</button>)}</div>}
    {error&&<span role="alert" className="zy-arrangement-feedback">{error}</span>}
  </section>;
}
/** Host-authored receipt card. Its data must come from a saved arrangement,
 * never from the language model's claim that something was saved. */
export function ArrangementCard({item,onOpen,onRevoke}:{item:ArrangementItem;onOpen?:(section:ArrangementSectionId)=>void;onRevoke?:(id:string)=>Promise<void>}) {
  const {account}=useAccount();
  const [pending,setPending]=useState(false),[revoked,setRevoked]=useState(item.status==='revoked'),[error,setError]=useState('');
  const publisherName=publicGroupDirectory().find(npc=>npc.id===item.sourceNpcId)?.name||item.sourceNpcId;
  const subtitle=arrangementCardSubtitle(item.section,{time:item.time,publisherName,itemCount:item.details.items?.length,completedSteps:item.details.steps?.filter(step=>step.done).length,totalSteps:item.details.steps?.length});
  async function revoke(){if(pending||revoked)return;setPending(true);setError('');try{if(onRevoke)await onRevoke(item.id);else await mutateArrangement(account.id,{action:'revoke',id:item.id});setRevoked(true);}catch(error){setError(error instanceof Error?error.message:'没能撤销，请重试。');}finally{setPending(false);}}
  return <div className={'zy-arrangement-card'+(revoked?' is-revoked':'')} data-arrangement-id={item.id}>
    <button type="button" className="zy-arrangement-card-open" onClick={()=>onOpen?onOpen(item.section):openArrangementSection(item.section,item.id)}><span className="zy-arrangement-card-icon"><CalendarCheck size={19}/></span><span><strong>{item.title}</strong><small>{subtitle}</small></span><ArrowUpRight size={15}/></button>
    <button type="button" className="zy-arrangement-card-revoke" disabled={pending||revoked} onClick={()=>void revoke()}>{revoked?'已撤销':pending?'撤销中…':'撤销'}</button>
    {error&&<span className="zy-arrangement-feedback" role="alert">{error}</span>}
  </div>;
}
