import type {Plugin} from 'vite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {ArrangementStore,ArrangementSuppressedError} from './arrangements-store';
import {isTrustedHost,isTrustedMutation,lookupBetaAccount} from './beta-identity';
import {appendMollyArrangement,decideArrangementOffer} from './arrangement-dialogue';
import type {ArrangementCreateResult} from '../../lib/npc/arrangement-types';
import type {ArrangementSectionId} from '../../lib/npc/arrangement-sections';

const stores=new Map<string,ArrangementStore>();
export function arrangementsFor(root:string){return stores.get(root);}
export type ArrangementPluginOptions={
 now?:()=>number;
 /** The resolver must fetch owner-scoped consent from actual server messages.
  * A client-provided recognition/source can never serve as save authority. */
 confirm?:(owner:string,pendingId:string)=>Promise<ArrangementCreateResult|null>|ArrangementCreateResult|null;
 decide?:(owner:string,pendingId:string,decision:'accepted'|'declined')=>unknown;
 automatic?:boolean;
 onChanged?:(owner:string)=>void;
};
function reply(res:ServerResponse,status:number,body:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
export async function serveArrangements(req:IncomingMessage,res:ServerResponse,db:DatabaseSync,store:ArrangementStore,options:ArrangementPluginOptions={}){
 if(!isTrustedHost(req)||(req.method!=='GET'&&!isTrustedMutation(req)))return reply(res,403,{error:'请求来源无效'});
 const account=lookupBetaAccount(req,db,options.now?.());if(!account)return reply(res,401,{error:'请先登录智域'});
 if(req.headers['x-zhiyu-account']&&req.headers['x-zhiyu-account']!==account.id)return reply(res,409,{error:'账号已变化，请重新打开安排'});
 const owner=account.owner_id;
 if(req.method==='GET'){const status=new URL(req.url||'/', 'http://localhost').searchParams.get('status');return reply(res,200,{items:store.list(owner,status==='all'?'all':'active'),preferences:store.preferences(owner)});}
 if(req.method!=='POST')return reply(res,405,{error:'不支持的方法'});
 if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))return reply(res,415,{error:'请使用JSON请求'});
 let content='',size=0;for await(const raw of req){size+=Buffer.byteLength(raw);if(size>16384)return reply(res,413,{error:'安排内容过长'});content+=raw.toString();}
 let body:Record<string,unknown>;try{body=JSON.parse(content);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return reply(res,400,{error:'无效JSON'});}
 const exact=(keys:string[])=>Object.keys(body).every(k=>keys.includes(k));
 const id=typeof body.id==='string'&&body.id.length<=200?body.id:'';
 try{
  let result:unknown;
  if(body.action==='revoke'&&id&&exact(['action','id']))result=store.atomic(()=>{const item=store.revoke(owner,id);if(item)appendMollyArrangement(db,owner,'OK',undefined,options.now?.(),`revoke:${item.id}:${item.updatedAt}`);return {item};});
  else if(body.action==='complete'&&id&&exact(['action','id']))result={item:store.complete(owner,id)};
  else if(body.action==='move'&&id&&typeof body.section==='string'&&exact(['action','id','section']))result=store.atomic(()=>{const item=store.move(owner,id,body.section as ArrangementSectionId);if(item)appendMollyArrangement(db,owner,'挪了',item,options.now?.(),`move:${item.id}:${item.section}:${item.updatedAt}`);return {item};});
  else if(body.action==='step'&&id&&Number.isInteger(body.index)&&typeof body.done==='boolean'&&exact(['action','id','index','done']))result={item:store.updateStep(owner,id,body.index as number,{done:body.done})};
  else if(body.action==='preference'&&typeof body.section==='string'&&typeof body.enabled==='boolean'&&(body.category===undefined||typeof body.category==='string')&&exact(['action','section','category','enabled']))result={preference:store.setPreference(owner,{section:body.section as ArrangementSectionId,...(typeof body.category==='string'?{category:body.category}:{}),enabled:body.enabled})};
  else if(body.action==='offer'&&typeof body.pendingId==='string'&&body.pendingId.length<=200&&(body.decision==='accepted'||body.decision==='declined')&&exact(['action','pendingId','decision']))result=options.decide?await options.decide(owner,body.pendingId,body.decision):decideArrangementOffer(db,store,owner,body.pendingId,body.decision,options.now?.());
  else if((body.action==='create'||body.action==='confirm')&&typeof body.pendingId==='string'&&body.pendingId.length<=200&&exact(['action','pendingId'])&&options.confirm){const saved=await options.confirm(owner,body.pendingId);if(!saved)return reply(res,404,{error:'这个待确认安排已失效'});result=saved;}
  else return reply(res,400,{error:'不支持的安排操作'});
  options.onChanged?.(owner);return reply(res,200,result);
 }catch(error){if(error instanceof ArrangementSuppressedError)return reply(res,409,{error:error.message});return reply(res,400,{error:'没记上，请再试一次'});}
}
/** No external sender or model call: notices enter the existing local Molly
 * conversation, with a stable message id across crash/retry. */
export function scanArrangementReminders(db:DatabaseSync,store:ArrangementStore,now=Date.now()){
 let delivered=0;const errors:unknown[]=[];
 for(const owner of store.owners()){
  try{
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='molly_sessions'").get()){
   const row=db.prepare('SELECT data FROM molly_sessions WHERE id=?').get(`${owner}:molly-system-secretary`) as {data:string}|undefined;
   if(row){const state=JSON.parse(row.data);if(state.pending||state.queue?.length||Object.values(state.typing||{}).some(value=>(value as {until?:number}).until!>now))continue;}
  }
  for(const reminder of store.tick(owner)){
   const saved=store.atomic(()=>{appendMollyArrangement(db,owner,reminder.text,reminder.item,now,`reminder:${reminder.id}`);return store.markReminderDelivered(owner,reminder.id);});
   if(saved)delivered++;
  }
  }catch(error){errors.push(error);}
 }
 if(errors.length)throw new AggregateError(errors,'Some arrangement reminders remain pending');
 return delivered;
}
export function arrangementsLocal(options:ArrangementPluginOptions={}):Plugin{
 return {name:'zhiyu-arrangements',apply:'serve',configureServer(server){
  const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL');
  const store=new ArrangementStore(db,options.now);stores.set(root,store);let active=0,closed=false;
  const timer=options.automatic===false?undefined:setInterval(()=>{if(closed)return;try{scanArrangementReminders(db,store,options.now?.());}catch(error){console.error('Arrangement reminders deferred',error);}},60000);timer?.unref();
  server.middlewares.use('/api/npc/arrangements',(req,res)=>{const path=(req.url||'/').split('?')[0];if(path!=='/'&&path!=='')return reply(res,404,{error:'安排接口不存在'});active++;void serveArrangements(req,res,db,store,options).catch(()=>{if(!res.writableEnded)reply(res,500,{error:'安排暂时不可用'});}).finally(()=>{active--;});});
  server.httpServer?.once('close',()=>{closed=true;if(timer)clearInterval(timer);if(stores.get(root)===store)stores.delete(root);const close=()=>{if(active){setTimeout(close,25).unref();return;}db.close();};close();});
 }};
}
