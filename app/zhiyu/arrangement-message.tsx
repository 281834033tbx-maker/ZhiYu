'use client';
import {useEffect,useState} from 'react';
import type {ArrangementMessageMetadata} from '../../lib/npc/arrangement-chat';
import {ArrangementCard,ArrangementOffer} from './arrangement-card';
import {ARRANGEMENTS_CHANGED,mutateArrangement} from './task-board/use-arrangements';
import {useAccount} from './auth-gate';

export function ArrangementMessage({message,disabled=false}:{message:ArrangementMessageMetadata;disabled?:boolean}){
 const {account}=useAccount();
 const [decision,setDecision]=useState<'accepted'|'declined'>();
 const cardId=message.arrangementCard?.id,cardStatus=message.arrangementCard?.status;
 useEffect(()=>{if(cardId&&cardStatus)window.dispatchEvent(new CustomEvent(ARRANGEMENTS_CHANGED,{detail:{accountId:account.id}}));},[account.id,cardId,cardStatus]);
 return <>{message.arrangementOffer&&<ArrangementOffer disabled={disabled} offer={{...message.arrangementOffer,decision:message.arrangementOffer.decision||decision}} onChoose={async(text,pendingId)=>{const result=text==='好'?'accepted':'declined';await mutateArrangement(account.id,{action:'offer',pendingId,decision:result});setDecision(result);}}/>}{message.arrangementCard&&<ArrangementCard item={message.arrangementCard}/>}</>;
}
