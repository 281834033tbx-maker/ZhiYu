'use client';
import {mergeTaskCompletions,readTaskCompletions,setTaskComplete,taskCompletionKey} from './task-completion';
import {npcFetch} from './npc-fetch';

type CompletionResponse={completions?:Record<string,true>;error?:string};
type SyncState={pending:Map<string,{value:boolean;version:number}>;allowed:Set<string>;tail:Promise<void>;version:number};
const states=new Map<string,SyncState>();
const syncKey=(accountId:string)=>taskCompletionKey(accountId)+':pending';
const migratedKey=(accountId:string)=>taskCompletionKey(accountId)+':migrated';
function storedFlags(key:string):Record<string,boolean>{
  try{const value:unknown=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).filter(([id,flag])=>!!id&&typeof flag==='boolean'));}catch{}
  return {};
}
function stateFor(accountId:string){
  let state=states.get(accountId);
  if(!state){state={pending:new Map(Object.entries(storedFlags(syncKey(accountId))).map(([id,value])=>[id,{value,version:0}])),allowed:new Set(),tail:Promise.resolve(),version:0};states.set(accountId,state);}
  return state;
}
function persistPending(accountId:string,state:SyncState){
  try{localStorage.setItem(syncKey(accountId),JSON.stringify(Object.fromEntries([...state.pending].map(([id,item])=>[id,item.value]))));}catch{throw Error('完成状态同步记录未保存，请稍后重试。');}
}
function completionsFrom(result:CompletionResponse){
  if(!result.completions||typeof result.completions!=='object'||Array.isArray(result.completions))throw Error('任务完成状态暂时无法同步。');
  return Object.fromEntries(Object.entries(result.completions).filter(([id,value])=>!!id&&value===true)) as Record<string,true>;
}
async function request(accountId:string,changes?:Record<string,boolean>){
  const response=await npcFetch('/api/npc/secretary',{method:changes?'POST':'GET',cache:'no-store',headers:{'X-Zhiyu-Account':accountId,...(changes?{'Content-Type':'application/json'}:{})},...(changes?{body:JSON.stringify({action:'completions',changes})}:{})});
  const result=await response.json() as CompletionResponse;
  if(!response.ok)throw Error(result.error||'完成状态暂时未同步，稍后会重试。');
  return completionsFrom(result);
}
function serialize(state:SyncState,work:()=>Promise<void>){
  const next=state.tail.catch(()=>{}).then(work);state.tail=next;return next;
}
async function flush(accountId:string,state:SyncState,remote?:Record<string,true>){
  const sending=new Map([...state.pending].filter(([id])=>state.allowed.has(id)));
  const entries=[...sending];
  for(let start=0;start<entries.length;start+=1000){
    const batch=entries.slice(start,start+1000);
    remote=await request(accountId,Object.fromEntries(batch.map(([id,item])=>[id,item.value])));
    for(const [id,item] of batch)if(state.pending.get(id)?.version===item.version)state.pending.delete(id);
    persistPending(accountId,state);
  }
  if(!remote)return;
  const pending=Object.fromEntries([...state.pending].map(([id,item])=>[id,item.value]));
  mergeTaskCompletions(accountId,remote,[...state.allowed],pending);
  const migrated=storedFlags(migratedKey(accountId));for(const id of state.allowed)migrated[id]=true;
  try{localStorage.setItem(migratedKey(accountId),JSON.stringify(migrated));}catch{throw Error('完成状态已同步，本机同步记录暂时未保存。');}
}
/** Legacy local completions are migrated once per real task, without erasing history. */
export function refreshTaskCompletions(accountId:string,taskIds:readonly string[]){
  if(!accountId||typeof window==='undefined')return Promise.resolve();
  const state=stateFor(accountId);state.allowed=new Set(taskIds);
  return serialize(state,async()=>{
    const remote=await request(accountId),migrated=storedFlags(migratedKey(accountId)),local=readTaskCompletions(accountId);
    for(const id of taskIds)if(local[id]&&!migrated[id]&&!state.pending.has(id))state.pending.set(id,{value:true,version:++state.version});
    persistPending(accountId,state);await flush(accountId,state,remote);
  });
}
/** Keep the immediate local response; failed network changes remain queued for retry. */
export function setTaskCompleteAndSync(accountId:string,taskId:string,completed:boolean){
  setTaskComplete(accountId,taskId,completed);
  const state=stateFor(accountId);state.allowed.add(taskId);state.pending.set(taskId,{value:completed,version:++state.version});persistPending(accountId,state);
  return serialize(state,()=>flush(accountId,state));
}
