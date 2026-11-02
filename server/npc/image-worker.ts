import type {Plugin} from 'vite';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {generateScene} from './image-generator';
import {mediaUser} from './media';
import {asksLegPhoto,legPhotoAllowed} from './reply-context';
import type {ChatMessage,GeneratedPhoto} from '../../lib/npc/contracts';
type State={revision:number;messages:ChatMessage[];values?:{affection?:number|null}};
type Row={id:string;data:string};
// Molly has no photo output. Preserve her historical rows, but never resume
// legacy pending/generating jobs or create retries for them.
const characters = {sessions:'xia-xia', yuan_sessions:'yuan-xiaoman', liu_sessions:'liu'} as const;
const tables=Object.keys(characters) as (keyof typeof characters)[];
export class ImageQueue {
 private running=false;
 private stopped=false;
 private controller:AbortController|null=null;
 constructor(private db:DatabaseSync,private root:string,private generate=generateScene){}
 private rows(table:string):Row[]{
  if(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))return [];
  return this.db.prepare(`SELECT id,data FROM ${table}`).all() as Row[];
 }
 private update(table:string,id:string,messageId:string,change:(part:GeneratedPhoto)=>void){
  const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as {data:string}|undefined;if(!row)return;
  const state=JSON.parse(row.data) as State,m=state.messages.find(m=>m.id===messageId);
  if(m?.part.type!=='generated_photo')return;
  change(m.part);state.revision++;
  if(table==='sessions')this.db.prepare('UPDATE sessions SET revision=?,data=? WHERE id=?').run(state.revision,JSON.stringify(state),id);
  else this.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(state),id);
 }
 async tick(){
  if(this.running||this.stopped)return;
  for(const table of tables)for(const row of this.rows(table)){
   const state=JSON.parse(row.data) as State;
   const message=state.messages.find(m=>m.role==='assistant'&&m.part.type==='generated_photo'&&(m.part.status==='pending'||(m.part.status==='generating'&&Date.now()-(m.part.startedAt||0)>360000)));
   if(!message||message.part.type!=='generated_photo')continue;
   const request=state.messages.slice(0,state.messages.indexOf(message)).findLast(m=>m.role==='user');
   if(request&&'text' in request.part&&asksLegPhoto(request.part.text)&&!legPhotoAllowed(state.values?.affection)){
    this.update(table,row.id,message.id,p=>{p.status='failed';p.error='当前关系尚未开放这类照片';});
    continue;
   }
   this.running=true;this.controller=new AbortController();
   const part=message.part;
   this.update(table,row.id,message.id,p=>{p.status='generating';p.startedAt=Date.now();p.attempts++;delete p.error;});
   try{
    const url=await this.generate(this.root,row.id.split(':')[0],characters[table],part,this.controller.signal);
    if(!this.stopped)this.update(table,row.id,message.id,p=>{p.url=url;p.status='ready';delete p.error;});
   }catch(e){if(!this.stopped)this.update(table,row.id,message.id,p=>{p.status='failed';p.error=e instanceof Error&&/^(生图额度暂不可用|图片生成未完成|生图服务没有返回图片|无法启动生图服务|没有获得本次生成的有效图片|生图返回格式无效|生图返回了无效的文件位置)/.test(e.message)?e.message:'图片生成失败，请重试';});}
   finally{this.running=false;this.controller=null;}
   return;
  }
 }
 retry(user:string,character:string,messageId:string){
  if(character==='molly'||character==='molly-system-secretary')return false;
  const table=tables.find(t=>characters[t]===character);if(!table)return false;
  const id=character==='xia-xia'?`${user}:xia-xia:normal`:`${user}:${character}`;
  const row=this.rows(table).find(r=>r.id===id);if(!row)return false;
  const m=(JSON.parse(row.data)as State).messages.find(m=>m.id===messageId);
  if(m?.part.type!=='generated_photo'||m.part.status!=='failed')return false;
  this.update(table,id,messageId,p=>{p.status='pending';delete p.error;});return true;
 }
 stop(){this.stopped=true;this.controller?.abort();}
}
export function npcImageWorker():Plugin {
 return {name:'zhiyu-npc-image-worker',apply:'serve',configureServer(server){
  const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});
  const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL');
  const queue=new ImageQueue(db,root),timer=setInterval(()=>{void queue.tick().catch(()=>{});},2000);timer.unref();
  server.middlewares.use('/api/npc/images/retry',(req,res)=>{void(async()=>{
   const url=new URL(req.url||'/',`http://${req.headers.host}`);
   const reply=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
   if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||req.method!=='POST'||req.headers.origin!==url.origin)return reply(403,{error:'请求不被允许'});
   const user=mediaUser(req.headers.cookie);if(!user)return reply(401,{error:'请先打开会话'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1500)return reply(413,{error:'请求过长'});}
   const body=JSON.parse(raw);if(!queue.retry(user,body.character,body.messageId))return reply(400,{error:'找不到可重试的图片'});
   reply(200,{ok:true});void queue.tick().catch(()=>{});
  })().catch(()=>{if(!res.writableEnded){res.statusCode=500;res.end(JSON.stringify({error:'重试未能启动'}));}});});
  server.httpServer?.once('close',()=>{clearInterval(timer);queue.stop();db.close();});
 }};
}
