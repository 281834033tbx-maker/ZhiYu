'use client';

/** Beta business state lives in RAM and in the authenticated server account.
 * Native browser storage is used only by explicitly hydrated legacy accounts. */
export type StorageAccount={id:string;storageMode?:'server'};
type Entry={value:string|null;revision:number};
type Snapshot={accountId:string;requestId:string;changes:Array<{key:string;value:string|null;revision:number}>};
export type AccountStorageStatus={accountId:string|null;pending:number;error:string;conflict:boolean};
const records=new Map<string,CloudStorage>();
const legacy=new Set<string>();
const retired=new Set<string>();
const knownIds=new Set<string>();
const listeners=new Set<()=>void>();
let activeId:string|null=null;
let preauth:Storage|undefined;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const missing=Symbol('missing');
type MergeResult={ok:boolean;value:unknown};
function mergeValue(base:unknown,local:unknown,remote:unknown):MergeResult{
  if(equal(local,remote))return {ok:true,value:local};
  if(equal(local,base))return {ok:true,value:remote};
  if(equal(remote,base))return {ok:true,value:local};
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  if(object(local)&&object(remote)&&(object(base)||base===missing)){
    const previous=object(base)?base:{};const merged:Record<string,unknown>={};
    for(const key of new Set([...Object.keys(previous),...Object.keys(local),...Object.keys(remote)])){
      const result=mergeValue(key in previous?previous[key]:missing,key in local?local[key]:missing,key in remote?remote[key]:missing);
      if(!result.ok)return result;if(result.value!==missing)merged[key]=result.value;
    }return {ok:true,value:merged};
  }
  if(Array.isArray(local)&&Array.isArray(remote)&&Array.isArray(base)){
    const identified=(items:unknown[])=>items.every(v=>object(v)&&typeof v.id==='string')&&new Set(items.map(v=>(v as {id:string}).id)).size===items.length;
    if(identified(base)&&identified(local)&&identified(remote)){
      const map=(v:unknown[])=>new Map(v.map(item=>[(item as {id:string}).id,item]));
      const b=map(base),l=map(local),r=map(remote),merged:unknown[]=[];
      for(const id of new Set([...r.keys(),...l.keys(),...b.keys()])){
        const result=mergeValue(b.has(id)?b.get(id):missing,l.has(id)?l.get(id):missing,r.has(id)?r.get(id):missing);
        if(!result.ok)return result;if(result.value!==missing)merged.push(result.value);
      }return {ok:true,value:merged};
    }
  }
  return {ok:false,value:local};
}
export function mergeAccountStorageValue(base:string|null,local:string|null,remote:string|null):{ok:boolean;value:string|null}{
  if(local===remote)return {ok:true,value:local};if(local===base)return {ok:true,value:remote};if(remote===base)return {ok:true,value:local};
  if(base===null||local===null||remote===null)return {ok:false,value:local};
  try{const result=mergeValue(JSON.parse(base),JSON.parse(local),JSON.parse(remote));return {ok:result.ok,value:result.ok?JSON.stringify(result.value):local};}catch{return {ok:false,value:local};}
}
function changed(){for(const listener of listeners)listener();}
function dispatchReady(id:string,key:string|null=null,oldValue:string|null=null,newValue:string|null=null){
  if(typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent('zhiyu-account-storage-ready',{detail:{accountId:id,key}}));
  window.dispatchEvent(new StorageEvent('storage',{key,oldValue,newValue}));
}
class MemoryStorage implements Storage{
  protected values=new Map<string,string>();
  get length(){return this.values.size;}
  clear(){this.values.clear();}
  getItem(key:string){return this.values.get(String(key))??null;}
  key(index:number){return Array.from(this.values.keys())[index]??null;}
  removeItem(key:string){this.values.delete(String(key));}
  setItem(key:string,value:string){this.values.set(String(key),String(value));}
}
class CloudStorage extends MemoryStorage{
  readonly id:string;
  base=new Map<string,Entry>();dirty=new Set<string>();conflicts=new Map<string,Entry>();
  error='';closed=false;timer:ReturnType<typeof setTimeout>|undefined;
  running:Promise<void>|null=null;inflight:Snapshot|null=null;retry=0;
  constructor(id:string,entries:Record<string,Entry>){super();this.id=id;for(const [key,entry]of Object.entries(entries)){this.base.set(key,entry);if(entry.value!==null)this.values.set(key,entry.value);}}
  override setItem(key:string,value:string){if(this.closed||Array.from(knownIds).some(id=>id!==this.id&&String(key).includes(id)))return;key=String(key);value=String(value);if(this.getItem(key)===value)return;super.setItem(key,value);this.mark(key);}
  override removeItem(key:string){if(this.closed||Array.from(knownIds).some(id=>id!==this.id&&String(key).includes(id)))return;key=String(key);if(this.getItem(key)===null)return;super.removeItem(key);this.mark(key);}
  override clear(){if(this.closed)return;const keys=Array.from(this.values.keys());super.clear();for(const key of keys)this.mark(key);}
  mark(key:string){this.dirty.add(key);changed();this.schedule(80);}
  schedule(delay:number){if(this.timer)clearTimeout(this.timer);if(this.closed||this.conflicts.size)return;this.timer=setTimeout(()=>{this.timer=undefined;void this.flush().catch(()=>{});},delay);}
  snapshot():Snapshot{return {accountId:this.id,requestId:crypto.randomUUID(),changes:Array.from(this.dirty).slice(0,512).map(key=>({key,value:this.getItem(key),revision:this.base.get(key)?.revision??0}))};}
  async flush():Promise<void>{
    if(this.closed||!this.dirty.size)return;if(this.conflicts.size)throw Error('请先处理其他设备的修改');
    if(this.running){await this.running;if(this.dirty.size)return this.flush();return;}
    this.running=this.save();try{await this.running;}finally{this.running=null;}
    if(this.dirty.size)return this.flush();
  }
  async save(){
    const snapshot=this.inflight??this.snapshot();this.inflight=snapshot;
    try{
      const response=await fetch('/api/account/state',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Zhiyu-Account':this.id},body:JSON.stringify(snapshot)});
      const data=await response.json() as {accountId?:string;error?:string;entries?:Record<string,Entry>;versions?:Record<string,number>};
      if(this.closed)return;
      if(data.accountId&&data.accountId!==this.id)throw Error('账号已变化，请重新登录');
      if(response.status===409&&data.entries){
        this.inflight=null;
        for(const change of snapshot.changes){
          const remote=data.entries[change.key]??{value:null,revision:0};
          const previous=this.getItem(change.key);
          const result=mergeAccountStorageValue(this.base.get(change.key)?.value??null,previous,remote.value);
          if(result.ok){
            this.base.set(change.key,remote);
            if(result.value===null)this.values.delete(change.key);else this.values.set(change.key,result.value);
            if(result.value===remote.value)this.dirty.delete(change.key);
            // Reconcile mounted consumers before their next whole-object save.
            // This notifies readers only; it does not enqueue another write.
            if(result.value!==previous)dispatchReady(this.id,change.key,previous,result.value);
          }
          else this.conflicts.set(change.key,remote);
        }
        if(this.conflicts.size){this.error='其他设备也修改了同一项资料，请选择要保留的版本。';changed();throw Error(this.error);}
        this.error='';this.retry=0;changed();return;
      }
      if(!response.ok||!data.versions)throw Error(data.error||'资料暂未保存到服务器');
      for(const change of snapshot.changes){
        this.base.set(change.key,{value:change.value,revision:data.versions[change.key]});
        if(this.getItem(change.key)===change.value)this.dirty.delete(change.key);
      }
      this.inflight=null;this.error='';this.retry=0;changed();
    }catch(reason){
      if(!this.closed&&!this.conflicts.size){this.error=reason instanceof Error?reason.message:'资料暂未保存到服务器';this.schedule(Math.min(1000*2**Math.min(this.retry++,5),30000));changed();}
      throw reason;
    }
  }
  resolve(choice:'local'|'server'){
    for(const [key,remote]of this.conflicts){this.base.set(key,remote);if(choice==='server'){const before=this.getItem(key);if(remote.value===null)this.values.delete(key);else this.values.set(key,remote.value);this.dirty.delete(key);dispatchReady(this.id,key,before,remote.value);}}
    this.conflicts.clear();this.error='';changed();this.schedule(0);
  }
  beacon(){if(this.closed||!this.dirty.size||this.conflicts.size)return;const snapshot=this.inflight??this.snapshot(),body=JSON.stringify(snapshot);if(new TextEncoder().encode(body).length>60000)return;this.inflight=snapshot;navigator.sendBeacon('/api/account/state',new Blob([body],{type:'application/json'}));}
  close(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.values.clear();this.base.clear();this.dirty.clear();this.conflicts.clear();}
}
export function accountStorage(accountId?:string):Storage{
  const id=accountId??activeId;
  if(id&&records.has(id))return records.get(id)!;
  if(id&&legacy.has(id)&&!retired.has(id)&&typeof window!=='undefined')return window.localStorage;
  preauth??=new MemoryStorage();return preauth;
}
export async function hydrateAccountStorage(account:StorageAccount){
  knownIds.add(account.id);
  if(account.storageMode!=='server'){legacy.add(account.id);activeId=account.id;dispatchReady(account.id);return;}
  const response=await fetch('/api/account/state',{credentials:'same-origin',cache:'no-store',headers:{'X-Zhiyu-Account':account.id}});
  const data=await response.json() as {accountId?:string;entries?:Record<string,Entry>;error?:string};
  if(!response.ok||data.accountId!==account.id||!data.entries)throw Error(data.error||'无法读取账号资料，请重试');
  records.get(account.id)?.close();records.set(account.id,new CloudStorage(account.id,data.entries));retired.delete(account.id);legacy.delete(account.id);activeId=account.id;preauth=new MemoryStorage();changed();dispatchReady(account.id);
}
export async function flushAccountStorage(accountId?:string){const id=accountId??activeId;if(id)await records.get(id)?.flush();}
export function releaseAccountStorage(accountId:string){records.get(accountId)?.close();records.delete(accountId);legacy.delete(accountId);retired.add(accountId);if(activeId===accountId)activeId=null;preauth=new MemoryStorage();changed();}
export function getActiveAccountStorageIdentity():StorageAccount|null{return activeId?{id:activeId,...(records.has(activeId)?{storageMode:'server' as const}:{})}:null;}
export function getAccountStorageStatus():AccountStorageStatus{const record=activeId?records.get(activeId):undefined;return {accountId:activeId,pending:record?.dirty.size??0,error:record?.error??'',conflict:!!record?.conflicts.size};}
export function subscribeAccountStorageStatus(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function resolveAccountStorageConflict(choice:'local'|'server'){if(activeId)records.get(activeId)?.resolve(choice);}
if(typeof window!=='undefined'){
  window.addEventListener('pagehide',()=>{if(activeId)records.get(activeId)?.beacon();});
  window.addEventListener('online',()=>{void flushAccountStorage().catch(()=>{});});
  window.addEventListener('beforeunload',event=>{if(getAccountStorageStatus().pending){event.preventDefault();}});
}
