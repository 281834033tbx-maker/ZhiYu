import {npcFetch} from './npc-fetch';
import type {PublicSession} from '../../lib/npc/contracts';

/** Same authenticated send action and server delivery queue as Molly's chat.
 * The native bridge only selects a visible main window after acknowledgement. */
export async function sendMollyQuickText(accountId:string,text:string,turnId:string):Promise<PublicSession> {
 const response=await npcFetch('/api/npc/molly?mode=normal',{
  method:'POST',headers:{'Content-Type':'application/json','X-Zhiyu-Account':accountId},
  body:JSON.stringify({action:'send',text,turnId}),
 });
 const result=await response.json() as PublicSession&{error?:string};
 if(!response.ok)throw new Error(result.error||'请求失败');
 return result;
}
