import type {Plugin} from 'vite';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {appendFileSync,mkdirSync} from 'node:fs';
import {synthesize} from './audio';
import type {ChatMessage} from '../../lib/npc/contracts';
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
     error=/^(千问语音|本地 Qwen3-TTS|豆包语音|语音服务)/.test(detail)
      ?detail:'语音未生成成功，可以先查看文字。请检查语音服务配置。';
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
 stop(){this.stopped=true;}
}
export function npcVoiceWorker():Plugin{return {name:'zhiyu-npc-voice-worker',apply:'serve',configureServer(server){
 const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL');
 const queue=new VoiceQueue(db,root),timer=setInterval(()=>void queue.tick().catch(()=>{}),1000);timer.unref();
 server.httpServer?.once('close',()=>{clearInterval(timer);queue.stop();db.close();});
}};}
