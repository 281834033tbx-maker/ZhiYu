'use client';
import {getActiveAccountStorageIdentity} from '../account-storage';
import {createReadonlyBoardSnapshot} from '../../../lib/npc/board-readonly-snapshot';
import type {Task} from './types';

type Queue = {epoch:string; sequence:number; tasks:Task[]|null; revision:number; busy:boolean; retry:number; timer?:ReturnType<typeof setTimeout>};
const queues=new Map<string,Queue>();
const isLegacyOwner=(id:string)=>{const active=getActiveAccountStorageIdentity();return active?.id===id&&active.storageMode!=='server';};

/** Legacy desktop boards remain local. This bridge sends only a read-only
 * progress snapshot to the same authenticated local service, never a task
 * mutation or an execution receipt. Server-backed accounts already sync. */
export function queueReadonlyBoardSnapshot(accountId:string,tasks:Task[]) {
  if(typeof window==='undefined'||!isLegacyOwner(accountId))return;
  let queue=queues.get(accountId);
  if(!queue){queue={epoch:crypto.randomUUID(),sequence:0,tasks:null,revision:0,busy:false,retry:0};queues.set(accountId,queue);}
  queue.tasks=structuredClone(tasks);queue.revision++;
  if(queue.timer){clearTimeout(queue.timer);queue.timer=undefined;}
  void flush(accountId,queue);
}

async function flush(owner:string,queue:Queue) {
  if(queue.busy||!queue.tasks)return;
  if(!isLegacyOwner(owner)){queue.tasks=null;return;}
  queue.busy=true;
  try {
    while(queue.tasks&&isLegacyOwner(owner)) {
      const revision=queue.revision;
      const body=createReadonlyBoardSnapshot(owner,queue.tasks,queue.epoch,++queue.sequence);
      const response=await fetch('/api/npc/dialogue-preferences',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json','X-Zhiyu-Account':owner},body:JSON.stringify(body)});
      if(!isLegacyOwner(owner)){queue.tasks=null;return;}
      if(response.status===401||response.status===409){queue.tasks=null;return;}
      if(!response.ok)throw Error('Read-only arrangement snapshot not saved');
      queue.retry=0;
      if(queue.revision===revision)queue.tasks=null;
    }
  } catch {
    // A failed mirror must not undo a successful local board save. Retry the
    // latest snapshot, never replay older clicks over newer progress.
    if(queue.tasks&&isLegacyOwner(owner))queue.timer=setTimeout(()=>{
      queue.timer=undefined;void flush(owner,queue);
    },Math.min(30_000,1000*2**Math.min(queue.retry++,5)));
  } finally {queue.busy=false;}
}
if(typeof window!=='undefined')window.addEventListener('online',()=>{
  for(const [owner,queue] of queues)if(isLegacyOwner(owner)){
    if(queue.timer){clearTimeout(queue.timer);queue.timer=undefined;}
    void flush(owner,queue);
  }
});
