import type {Plugin} from 'vite';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {appendFileSync,mkdirSync} from 'node:fs';
import {synthesize} from './audio';
import type {ChatMessage} from '../../lib/npc/contracts';
import {mediaUser} from './media';
// Molly is text-only. Her existing voice history stays in the database, while
// old pending requests must never synthesize after the role policy changes.
const tables=['sessions','yuan_sessions','liu_sessions'] as const;
export class VoiceQueue {
 private running=false;private stopped=false;
 constructor(private db:DatabaseSync,private root:string,private speak=synthesize){}
 async tick(){
  if(this.running||this.stopped)return;
  for(const table of tables){
   if(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   const rows=this.db.prepare(`SELECT id,data FROM ${table}`).all() as {id:string;data:string}[];
   for(const row of rows){
    const state=JSON.parse(row.data) as {messages:ChatMessage[]};
    const message=state.messages.find(m=>m.role==='assistant'&&m.part.type==='voice'&&m.part.status==='pending');
    if(!message||message.part.type!=='voice')continue;
    this.running=true;let url:string|undefined,error:string|undefined;
    try{url=await this.speak(this.root,row.id.split(':')[0],message.part.text,table==='sessions'?'xia-xia':table==='yuan_sessions'?'yuan-xiaoman':'liu');}
    catch(cause){
     const detail=cause instanceof Error?cause.message:String(cause);
     appendFileSync(join(this.root,'.npc-runtime/voice-worker.log'),`${new Date().toISOString()} ${table} ${message.id} ${detail.replace(/[\r\n]+/g,' ')}\n`);
     error='语音没发出去，点一下重发';
    }
    try{
     if(this.stopped)return;
     // Re-read after the async request: never overwrite a concurrent chat turn.
     const fresh=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(row.id) as {data:string}|undefined;
     if(!fresh)return;
     const next=JSON.parse(fresh.data),part=next.messages.find((m:ChatMessage)=>m.id===message.id)?.part;
     if(part?.type!=='voice'||part.status!=='pending')return;
     Object.assign(part,{status:url?'ready':'failed',...(url?{url}:{error})});next.revision=(next.revision||0)+1;
     if(table==='sessions')this.db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(next.revision,JSON.stringify(next),row.id);
     else this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(next),row.id);
    }finally{this.running=false;}
    return;
   }
  }
 }
 retry(user:string,character:string,messageId:string){
  const table=character==='xia-xia'?'sessions':character==='yuan-xiaoman'?'yuan_sessions':character==='liu'?'liu_sessions':null;
  if(!table||!user||!messageId||!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))return false;
  const id=character==='xia-xia'?`${user}:xia-xia:normal`:`${user}:${character}`;
  const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as {data:string}|undefined;
  if(!row)return false;
  const state=JSON.parse(row.data),message=state.messages?.find((entry:ChatMessage)=>entry.id===messageId);
  if(message?.role!=='assistant'||message.part?.type!=='voice'||message.part.status!=='failed')return false;
  message.part.status='pending';delete message.part.error;delete message.part.url;
  state.revision=(state.revision||0)+1;
  if(table==='sessions')this.db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(state.revision,JSON.stringify(state),id);
  else this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state),id);
  return true;
 }
 stop(){this.stopped=true;}
}
export function npcVoiceWorker():Plugin{return {name:'zhiyu-npc-voice-worker',apply:'serve',configureServer(server){
 const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL');
 const queue=new VoiceQueue(db,root),timer=setInterval(()=>void queue.tick().catch(()=>{}),1000);timer.unref();
 server.middlewares.use('/api/npc/voice/retry',(req,res)=>{void(async()=>{
  const url=new URL(req.url||'/',`http://${req.headers.host}`);
  const reply=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||req.method!=='POST'||req.headers.origin!==url.origin)return reply(403,{error:'请求不被允许'});
  const user=mediaUser(req.headers.cookie);if(!user)return reply(401,{error:'请先登录智域'});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1500)return reply(413,{error:'请求过长'});}
  let body:{character?:unknown;messageId?:unknown};try{body=JSON.parse(raw);}catch{return reply(400,{error:'请求内容无效'});}
  if(!body||typeof body.character!=='string'||typeof body.messageId!=='string'||body.messageId.length>160||!queue.retry(user,body.character,body.messageId))return reply(400,{error:'找不到可重发的语音'});
  reply(200,{ok:true});void queue.tick().catch(()=>{});
 })().catch(error=>{console.error('[智域] 语音重发失败',error);if(!res.writableEnded){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'语音没发出去，点一下重发'}));}});});
 server.httpServer?.once('close',()=>{clearInterval(timer);queue.stop();db.close();});
}};}
