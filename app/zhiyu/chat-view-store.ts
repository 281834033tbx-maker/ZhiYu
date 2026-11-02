import { useSyncExternalStore } from 'react';
import type { PublicSession } from '../../lib/npc/contracts';
type Snapshot={data:PublicSession|null;draft:string;boundary:string|null};
const empty:Snapshot={data:null,draft:'',boundary:null};
const values=new Map<string,Snapshot>();
const listeners=new Set<()=>void>();
function write(key:string,value:Snapshot){values.set(key,value);listeners.forEach(fn=>fn());}
export function useChatView(key:string){
 const state=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>values.get(key)||empty,()=>empty);
 const accept=(next:PublicSession)=>{if(!Array.isArray(next?.messages))return;const old=values.get(key)||empty;if(old.data&&next.conversationId===old.data.conversationId&&(next.revision??0)<(old.data.revision??0))return;write(key,{...old,data:next,boundary:old.data?old.boundary:next.messages.find(m=>m.role==='assistant'&&!m.readAt)?.id||null});};
 const draft=(next:string|((old:string)=>string))=>{const old=values.get(key)||empty;write(key,{...old,draft:typeof next==='function'?next(old.draft):next});};
 return {...state,accept,setDraft:draft};
}
