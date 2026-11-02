import {choicePlainText} from '../../lib/npc/choice-chat';
import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assets, type Part, type ChatMessage } from '../../lib/npc/contracts';
const filePattern = /^[a-f0-9-]{36}\.(png|jpg|webp|gif)$/;
export const mediaUser = (cookie = '') => /(?:^|;\s*)zhiyu_npc=([a-f0-9-]{36})(?:;|$)/.exec(cookie)?.[1];
export function imageExtension(b: Buffer) {
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (b[0]===255 && b[1]===216 && b[2]===255) return 'jpg';
  if (['GIF87a','GIF89a'].includes(b.subarray(0,6).toString())) return 'gif';
  if (b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP') return 'webp';
  return null;
}
export function userPart(root:string, user:string, body:Record<string,unknown>): Part | null {
  const text = typeof body.text==='string' ? body.text.trim() : '';
  if(text.length>4000) return null;
  if(body.audioId!==undefined){
    const id=body.audioId;
    if(typeof id!=='string'||!/^[a-f0-9-]{36}\.(webm|mp4|ogg|wav|mp3)$/.test(id))return null;
    const path=join(root,'.npc-runtime/audio',user,id);
    if(!existsSync(path)||!existsSync(path+'.json'))return null;
    try{const meta=JSON.parse(readFileSync(path+'.json','utf8'));if(typeof meta.text!=='string'||!meta.text.trim()||meta.text.length>4000)return null;
      return {type:'voice',text:meta.text,url:'/api/npc/audio/'+id,status:'ready',synthetic:false,...(Number.isInteger(meta.durationSeconds)&&meta.durationSeconds>=1&&meta.durationSeconds<=60?{durationSeconds:meta.durationSeconds}:{})};
    }catch{return null;}
  }
  if(body.imageId!==undefined) {
    if(typeof body.imageId!=='string' || !filePattern.test(body.imageId) || !existsSync(join(root,'.npc-runtime/uploads',user,body.imageId)))return null;
    return {type:'upload',url:'/api/npc/media/'+body.imageId,text};
  }
  if(body.assetId!==undefined) {
    if(typeof body.assetId!=='string' || !Object.hasOwn(assets,body.assetId))return null;
    const id=body.assetId as keyof typeof assets;
    if(assets[id].kind!=='sticker')return null;
    return {type:'sticker',assetId:id,...(text?{caption:text}:{})};
  }
  return text ? {type:'text',text} : null;
}
export function partInput(p:Part) {
  if(p.type==='choice')return choicePlainText(p);
  if(p.type==='professional_task')return '[已发布的任务卡：'+p.taskId+']';
  if(p.type==='voice')return '[语音转写，可能有识别误差，不代表已感知声线或情绪] '+p.text;
  if(p.type==='generated_photo')return '[NPC虚构场景图片：'+p.caption+'，状态：'+p.status+']';
  if(p.type==='upload')return (p.text ? p.text+'\n' : '')+'[用户发送了一张图片，请结合本轮附图理解；未附上的历史图片不得臆测内容]';
  return 'text' in p?p.text:(p.caption?p.caption+'\n':'')+'[用户发送表情包：'+assets[p.assetId].description+']';
}
export function imageInputs(root:string,user:string,messages:ChatMessage[]) {
  return messages.filter(m=>m.role==='user' && m.part.type==='upload').slice(-4).flatMap(m=>{
    if(m.part.type!=='upload')return [];
    const id=m.part.url.split('/').pop()!;
    const path=join(root,'.npc-runtime/uploads',user,id);
    return filePattern.test(id)&&existsSync(path)?[path]:[];
  });
}
export function npcMedia():Plugin {
 return {name:'zhiyu-npc-media',apply:'serve',configureServer(server){
  server.middlewares.use('/api/npc/media',(req,res)=>{void(async()=>{
   const origin=new URL('http://'+req.headers.host);
   const respond=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
   if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))return respond(403,{error:'仅允许本机访问'});
   const user=mediaUser(req.headers.cookie);
   if(!user)return respond(401,{error:'请先打开聊天窗口'});
   const dir=join(server.config.root,'.npc-runtime/uploads',user);
   if(req.method==='GET') {
    const id=(req.url||'').split('?')[0].slice(1);
    if(!filePattern.test(id)||!existsSync(join(dir,id)))return respond(404,{error:'图片不存在'});
    res.setHeader('Content-Type',id.endsWith('.jpg')?'image/jpeg':'image/'+id.split('.').pop());
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(readFileSync(join(dir,id)));return;
   }
   if(req.method!=='POST')return respond(405,{error:'不支持的方法'});
   if(req.headers.origin!==origin.origin)return respond(403,{error:'请求来源不匹配'});
   let size=0;const chunks:Buffer[]=[];
   for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)return respond(413,{error:'图片请小于12MB'});chunks.push(Buffer.from(chunk));}
   const bytes=Buffer.concat(chunks),ext=imageExtension(bytes);
   if(!ext)return respond(400,{error:'请选择PNG、JPEG、WebP或GIF图片'});
   mkdirSync(dir,{recursive:true});const id=crypto.randomUUID()+'.'+ext;
   writeFileSync(join(dir,id),bytes,{flag:'wx'});
   respond(200,{imageId:id,url:'/api/npc/media/'+id});
  })().catch(()=>{if(!res.writableEnded){res.statusCode=500;res.end(JSON.stringify({error:'图片保存失败，请重试'}));}});});
 }};
}
