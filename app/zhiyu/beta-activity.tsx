'use client';

import {useEffect} from 'react';
import {useAccount} from './auth-gate';

/** Confirmed foreground intervals only. No transcript, key presses, or
 * business data is stored by the usage collector. */
export default function BetaActivityTracker() {
  const {account}=useAccount();
  const serverBacked=(account as {storageMode?:string}).storageMode==='server';
  useEffect(()=>{
    if(!serverBacked)return;
    const accountId=account.id,tabId=crypto.randomUUID();
    let totalActiveMs=0,activeSince:number|null=null,sequence=0,closed=false;
    let lastDay='',sending=false;
    const queue:{action:'open'|'heartbeat'|'end';tabId:string;accountId:string;eventId:string;seq:number;totalActiveMs:number;visible:boolean}[]=[];
    const visible=()=>document.visibilityState==='visible'&&document.hasFocus();
    const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const measure=()=>{
      const at=performance.now();
      if(activeSince!==null)totalActiveMs+=Math.max(0,at-activeSince);
      activeSince=visible()?at:null;
    };
    async function drain() {
      if(sending||closed)return;
      sending=true;
      try{
        while(queue.length&&!closed){
          const next=queue[0];
          const response=await fetch('/api/beta/activity',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(next),keepalive:true});
          if(response.status===401||response.status===409){queue.length=0;return;}
          if(!response.ok)return;
          queue.shift();
        }
      }catch{/* Retry the same event ID on the next real foreground update. */}
      finally{sending=false;}
    }
    const send=(action:'open'|'heartbeat'|'end',terminal=false)=>{
      measure();
      const value={action,tabId,accountId,eventId:crypto.randomUUID(),seq:++sequence,totalActiveMs:Math.floor(totalActiveMs),visible:visible()};
      if(terminal){
        // Keepalive carries the captured account header; a cookie change can
        // never attribute this page's last interval to the next account.
        void fetch('/api/beta/activity',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},body:JSON.stringify(value),keepalive:true}).catch(()=>{});
      }else{
        // An unacknowledged heartbeat can be replaced by a newer monotonic
        // total. Explicit opens retain their own identity for daily delivery.
        if(action==='heartbeat'&&queue.length>1&&queue.at(-1)?.action==='heartbeat')queue.pop();
        queue.push(value);void drain();
      }
    };
    const opened=()=>{lastDay=day();send('open');};
    const visibility=()=>{if(visible())opened();else send('end',true);};
    const leaving=()=>send('end',true);
    const tick=()=>{
      if(!visible())return;
      if(lastDay!==day())opened();else send('heartbeat');
    };
    if(visible())opened();
    const timer=setInterval(tick,15000);
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('focus',visibility);
    window.addEventListener('blur',visibility);
    window.addEventListener('pageshow',visibility);
    window.addEventListener('pagehide',leaving);
    window.addEventListener('online',tick);
    return()=>{
      send('end',true);closed=true;clearInterval(timer);
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('focus',visibility);window.removeEventListener('blur',visibility);
      window.removeEventListener('pageshow',visibility);window.removeEventListener('pagehide',leaving);window.removeEventListener('online',tick);
    };
  },[account.id,serverBacked]);
  return null;
}
