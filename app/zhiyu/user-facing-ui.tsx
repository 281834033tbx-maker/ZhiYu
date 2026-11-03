import type {DialoguePurpose} from '../../lib/npc/dialogue-purpose';
import type {ReactNode} from 'react';
import {RotateCcw} from 'lucide-react';
import './user-facing-ui.css';

export const AI_DISCLOSURE='智友由 AI 驱动，可能会出错，重要的事请自己再确认';
export function AiDisclosure() {return <p className="zy-ai-disclosure">{AI_DISCLOSURE}</p>;}
export function RetryableMessage({failed,disabled=false,onRetry,label='重试这条消息',children}:{failed:boolean;disabled?:boolean;onRetry:()=>void;label?:string;children:ReactNode}) {
  return failed?<div className="zy-retry-bubble-row"><button type="button" className="zy-message-retry" aria-label={label} title="消息没发出去，点一下重试" disabled={disabled} onClick={onRetry}><RotateCcw size={16}/></button>{children}</div>:children;
}
export function ChatIdentityNotice({name,purpose,molly=false}:{name:string;purpose?:DialoguePurpose;molly?:boolean}) {
  const text=molly?'Molly 是你在智域的秘书，由 AI 驱动。':purpose==='professional'?`${name}是智域的专业智友，由 AI 驱动。建议很专业，但也可能出错；身体不适请先就医。`:`${name}是智域的智友，由 AI 驱动。`;
  return <p className="zy-chat-identity-notice">{text}</p>;
}
