import type {Plugin} from 'vite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {isTrustedHost,isTrustedMutation,lookupBetaAccount} from './beta-identity';
import {DialoguePreferencesStore,bindDialoguePreferences,preferenceNpcId} from './dialogue-preferences';
import {readArrangementStatus} from './arrangement-readonly';
import {scanSupervision} from './supervision-runtime';
import {readonlyBoardSnapshotMaxBytes} from '../../lib/npc/board-readonly-snapshot';
const reply=(res:ServerResponse,status:number,value:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
export async function serveDialoguePreferences(req:IncomingMessage,res:ServerResponse,db:DatabaseSync,store:DialoguePreferencesStore){
 if(!isTrustedHost(req)||(req.method!=='GET'&&!isTrustedMutation(req)))return reply(res,403,{error:'请求来源无效'});const account=lookupBetaAccount(req,db);if(!account)return reply(res,401,{error:'请先登录智域'});
 if(req.headers['x-zhiyu-account']&&req.headers['x-zhiyu-account']!==account.id)return reply(res,409,{error:'账号已变化'});
 try{
  const url=new URL(req.url||'/','http://localhost');if(req.method==='GET'){const npc=preferenceNpcId(url.searchParams.get('npc')||'molly');return reply(res,200,{address:store.effectiveAddress(account.owner_id,npc),supervision:store.supervision(account.owner_id,npc),arrangements:readArrangementStatus(db,account.owner_id)});}
  if(req.method!=='POST')return reply(res,405,{error:'不支持的方法'});if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,415,{error:'请使用JSON'});const chunks:Buffer[]=[];let size=0;for await(const raw of req){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>readonlyBoardSnapshotMaxBytes)return reply(res,413,{error:'内容过长'});chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8'),body=JSON.parse(text);if(!body||Array.isArray(body)||typeof body!=='object')throw Error();
  if(body.action==='board-snapshot'){if(req.headers['x-zhiyu-account']!==account.id||body.accountId!==account.id)return reply(res,409,{error:'账号已变化'});return reply(res,200,store.saveBoardSnapshot(account.owner_id,account.id,body));}
  if(Buffer.byteLength(text)>8192)return reply(res,413,{error:'偏好内容过长'});
  const exact=(keys:string[])=>Object.keys(body).every(k=>keys.includes(k)),npc=preferenceNpcId(body.npc);
  if(body.action==='address'&&exact(['action','npc','name','scope'])&&typeof body.name==='string'&&['global','personal'].includes(body.scope))return reply(res,200,{address:store.setAddress(account.owner_id,npc,{kind:'set',name:body.name,scope:body.scope})});
  if(body.action==='reset-address'&&exact(['action','npc']))return reply(res,200,{address:store.setAddress(account.owner_id,npc,{kind:'reset'})});
  if(body.action==='supervision'&&exact(['action','npc','scope','itemIds'])&&['all','items','off'].includes(body.scope)&&(body.itemIds===undefined||Array.isArray(body.itemIds)&&body.itemIds.every((id:unknown)=>typeof id==='string')))return reply(res,200,{supervision:store.setSupervision(account.owner_id,npc,{scope:body.scope,itemIds:body.itemIds})});
  return reply(res,400,{error:'不支持的偏好操作'});
 }catch{return reply(res,400,{error:'偏好尚未保存，请核对内容'});}
}
export function dialoguePreferencesLocal(options:{now?:()=>number;automatic?:boolean}={}):Plugin{return {name:'zhiyu-dialogue-preferences',apply:'serve',configureServer(server){
 const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000');const store=new DialoguePreferencesStore(db,options.now),unbind=bindDialoguePreferences(root,store);let active=0,busy=false,closed=false;
 const timer=options.automatic===false?undefined:setInterval(()=>{if(closed||busy)return;busy=true;void scanSupervision(db,store,{now:options.now}).finally(()=>{busy=false;});},60000);timer?.unref();
 server.middlewares.use('/api/npc/dialogue-preferences',(req,res)=>{const path=(req.url||'/').split('?')[0];if(path!=='/'&&path!=='')return reply(res,404,{error:'偏好接口不存在'});active++;void serveDialoguePreferences(req,res,db,store).catch(()=>{if(!res.writableEnded)reply(res,500,{error:'偏好暂时不可用'});}).finally(()=>{active--;});});
 server.httpServer?.once('close',()=>{closed=true;if(timer)clearInterval(timer);unbind();const close=()=>{if(active||busy){setTimeout(close,25).unref();return;}db.close();};close();});
}};}
