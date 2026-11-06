import {Check,CheckCheck} from 'lucide-react';
import './message-receipt.css';

export function messagesHaveReadReceipt(messages:readonly {readAt?:string}[]):boolean {
  return messages.length>0&&messages.every(message=>!!message.readAt&&Number.isFinite(Date.parse(message.readAt)));
}

/** Delivery and reading are distinct. A missing receipt always stays single-check. */
export default function MessageReceipt({read=false,size=17,unreadLabel='已送达，未读'}:{read?:boolean;size?:number;unreadLabel?:string}) {
  const Icon=read?CheckCheck:Check;
  const label=read?'已读':unreadLabel;
  return <Icon size={size} className={'zy-message-receipt'+(read?' is-read read':'')} aria-label={label}>
    <title>{label}</title>
  </Icon>;
}
