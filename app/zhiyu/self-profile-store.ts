'use client';


import {accountStorage} from './account-storage';
import {useCallback,useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {self as defaultSelf,type Person} from './data';

const changed='zhiyu-self-profile-changed';
export const selfProfileKey=(accountId:string)=>`zhiyu-stitch-desktop-v2:${accountId}`;
type AccountIdentity={id:string;username:string};
const initialProfile=(account:AccountIdentity):Person=>({...defaultSelf,name:account.username,nickname:account.username,account:account.username});

/** Share only the existing account-scoped profile field. Large user photos
 * stay in one storage record, and edits merge rather than replace chat data. */
export function readSelfProfile(account:AccountIdentity,storage:Pick<Storage,'getItem'>):Person {
 const fallback=initialProfile(account);
 try {
  const parsed=JSON.parse(storage.getItem(selfProfileKey(account.id))||'null');
  const profile=parsed?.selfProfile;
  return profile&&typeof profile==='object'&&!Array.isArray(profile)?{...fallback,...profile,id:'self',account:account.username}:fallback;
 }catch{return fallback;}
}

export function useSelfProfile(account:AccountIdentity):[Person,Dispatch<SetStateAction<Person>>] {
 const [profile,update]=useState(()=>initialProfile(account));
 const current=useRef(profile),scope=useRef(account.id);
 useEffect(()=>{
  scope.current=account.id;
  const sync=()=>{const next=readSelfProfile({id:account.id,username:account.username},accountStorage(account.id));if(JSON.stringify(next)===JSON.stringify(current.current))return;current.current=next;update(next);};
  const storage=(event:StorageEvent)=>{if(event.key===selfProfileKey(account.id)||event.key===null)sync();};
  sync();window.addEventListener('storage',storage);window.addEventListener(changed,sync);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener(changed,sync);};
 },[account.id,account.username]);
 const setProfile=useCallback<Dispatch<SetStateAction<Person>>>(value=>{
  if(scope.current!==account.id)return;
  const next={...(typeof value==='function'?value(current.current):value),id:'self',account:account.username};
  current.current=next;update(next);
  // Keep the edited profile in memory even if the browser quota is exhausted.
  try {const key=selfProfileKey(account.id),stored=JSON.parse(accountStorage(account.id).getItem(key)||'{}');accountStorage(account.id).setItem(key,JSON.stringify({...stored,selfProfile:next}));window.dispatchEvent(new Event(changed));}
  catch(cause){console.error('[智域] 保存共享个人资料',cause);}
 },[account.id,account.username]);
 return [profile,setProfile];
}
