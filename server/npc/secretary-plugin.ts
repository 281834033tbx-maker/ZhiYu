import type {Plugin} from 'vite';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {SecretaryStore,type SecretaryDependencies} from './secretary-service';

const stores=new Map<string,SecretaryStore>();
export function secretaryFor(root:string){return stores.get(root);}
export function secretaryLocal(deps:SecretaryDependencies&{automatic?:boolean}={}):Plugin{
  return {name:'zhiyu-molly-secretary',apply:'serve',configureServer(server){
    const root=server.config.root;mkdirSync(join(root,'.npc-runtime'),{recursive:true});
    const db=new DatabaseSync(join(root,'.npc-runtime/state.sqlite'));db.exec('PRAGMA journal_mode=WAL');
    const store=new SecretaryStore(db,root,deps);stores.set(root,store);
    let ticking=false,reporting=false,closed=false;
    const timer=deps.automatic===false?undefined:setInterval(()=>{
      if(closed)return;
      // The daily clock must run even while an NPC model is still replying.
      store.scanTaskExpiry();
      if(!reporting){reporting=true;void store.scanMorning().then(()=>store.scanReports()).catch(()=>{}).finally(()=>{reporting=false;});}
      if(ticking)return;ticking=true;
      void store.drain().catch(()=>{}).finally(()=>{ticking=false;});
    },1000);
    timer?.unref();
    server.middlewares.use('/api/npc/secretary',(req,res)=>{void(async()=>{
      const reply=(code:number,value:unknown)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));};
      let url:URL;try{url=new URL(req.url||'/',`http://${req.headers.host}`);}catch{return reply(403,{error:'请求来源无效'});}
      if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||(req.method!=='GET'&&req.headers.origin!==url.origin))return reply(403,{error:'请求来源不匹配'});
      const owner=/(?:^|;\s*)zhiyu_npc=([a-f0-9-]{36})(?:;|$)/i.exec(req.headers.cookie||'')?.[1];
      if(!owner)return reply(401,{error:'请先登录智域'});
      if(url.pathname!=='/')return reply(404,{error:'秘书接口不存在'});
      if(req.method==='GET')return reply(200,{settings:store.settings(owner),completions:store.completions(owner)});
      if(req.method!=='POST')return reply(405,{error:'不支持的方法'});
      if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return reply(415,{error:'请使用JSON请求'});
      const chunks:Buffer[]=[];let size=0;
      for await(const raw of req){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>128*1024)return reply(413,{error:'请求内容过长'});chunks.push(chunk);}
      let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'无效JSON'});}
      if(!input||typeof input!=='object'||Array.isArray(input))return reply(400,{error:'请求内容无效'});
      const body=input as Record<string,unknown>;
      try{
        if(body.action==='settings'&&Object.keys(body).every(key=>['action','enabled','time','city'].includes(key)))
          return reply(200,{settings:store.updateSettings(owner,{enabled:body.enabled,time:body.time,...(body.city!==undefined?{city:body.city}:{})}),completions:store.completions(owner)});
        if(body.action==='locate-city'&&Object.keys(body).every(key=>['action','query','source'].includes(key)))
          return reply(200,{city:await store.locateCity(owner,body.query,body.source)});
        if(body.action==='city'&&Object.keys(body).every(key=>['action','city'].includes(key)))
          return reply(200,{settings:store.updateCity(owner,body.city)});
        if(body.action==='report-quote'&&Object.keys(body).every(key=>['action','reportId','characterId'].includes(key)))
          return reply(200,store.reportQuote(owner,body.reportId,body.characterId));
        if(body.action==='usage'&&Object.keys(body).every(key=>['action','currentNpc','visible','busy','clientId'].includes(key)))
          return reply(200,store.usage(owner,body as {currentNpc:string;visible:boolean;busy?:boolean;clientId:string}));
        if(body.action==='completions'&&Object.keys(body).every(key=>['action','changes'].includes(key)))
          return reply(200,{settings:store.settings(owner),completions:store.updateCompletions(owner,body.changes)});
        return reply(400,{error:'不支持的秘书设置'});
      }catch(error){console.error('Secretary setting request failed',error);return reply(400,{error:'没保存上，再试一次'});}
    })().catch(()=>{if(!res.writableEnded){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'秘书服务暂时不可用'}));}});});
    server.httpServer?.once('close',()=>{closed=true;store.stop();if(timer)clearInterval(timer);if(stores.get(root)===store)stores.delete(root);
      // A receiver may still be awaiting a model. It observes stop before further
      // writes; release this connection only once its tick unwinds.
      const close=()=>{if(ticking||reporting){setTimeout(close,50).unref();return;}db.close();};close();});
  }};
}
