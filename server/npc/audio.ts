import type {Plugin} from 'vite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {mediaUser} from './media';
import {translateText} from './codex';
import {transcribeDoubao, synthesizeDoubao} from './doubao-audio';
import {asrReady,audioReady, speechProvider, voiceForCharacter} from './speech-config';
import {transcribeLocal} from './local-asr';
import {synthesizeQwen,synthesizeQwenLocal} from './qwen-audio';
export const audioPattern=/^[a-f0-9-]{36}\.(webm|mp4|ogg|wav|mp3)$/;
export function audioExtension(b:Buffer){
 if(b.length<12)return null;
 if(b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return 'webm';
 if(b.subarray(4,8).toString()==='ftyp')return 'mp4';
 if(b.subarray(0,4).toString()==='OggS')return 'ogg';
 if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE')return 'wav';
 if(b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&0xe0)===0xe0))return 'mp3';
 return null;
}
export const audioMime=(ext:string)=>({webm:'audio/webm',mp4:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav',mp3:'audio/mpeg'}[ext]||'application/octet-stream');
export {audioReady};
export async function audioRequest(path:string,body:FormData|string){
 if(!audioReady())throw Error('语音服务未配置：请在本机 .env.local 设置 NPC_AUDIO_API_KEY，再重启程序');
 const response=await fetch('https://api.openai.com/v1/audio/'+path,{method:'POST',headers:{Authorization:'Bearer '+process.env.NPC_AUDIO_API_KEY,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},body,signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error(response.status===401?'语音服务密钥无效':response.status===429?'语音服务额度或速率受限，请稍后重试':'语音服务请求失败，请稍后重试');
 return response;
}
export async function transcribe(bytes:Buffer,ext:string){
 if(['local','qwen','qwen-local'].includes(speechProvider()))return transcribeLocal(bytes,ext);
 if(speechProvider()==='doubao')return transcribeDoubao(bytes,ext);
 const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)],{type:audioMime(ext)}),'voice.'+ext);form.set('model',process.env.NPC_ASR_MODEL||'gpt-4o-mini-transcribe');
 const result=await(await audioRequest('transcriptions',form)).json() as {text?:unknown};
 if(typeof result.text!=='string'||!result.text.trim()||result.text.length>4000)throw Error('没有识别到有效语音，请重新录制');
 return result.text.trim();
}
export async function synthesize(root:string,user:string,text:string,character:string){
 if(speechProvider()==='local')throw Error('本地语音合成模型尚未接入');
 const voice=voiceForCharacter(character);
 const provider=speechProvider();
 const generated=provider==='qwen'?await synthesizeQwen(text,voice)
  :provider==='qwen-local'?await synthesizeQwenLocal(text,voice)
  :{bytes:provider==='doubao'?await synthesizeDoubao(text,voice)
    :Buffer.from(await(await audioRequest('speech',JSON.stringify({model:process.env.NPC_TTS_MODEL||'gpt-4o-mini-tts',voice,input:text,response_format:'mp3'}))).arrayBuffer()),extension:'mp3' as const};
 const {bytes,extension}=generated;
 if(bytes.length>12*1024*1024||audioExtension(bytes)!==extension)throw Error('语音服务没有返回有效音频');
 const id=crypto.randomUUID()+'.'+extension,dir=join(root,'.npc-runtime/audio',user);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,id),bytes,{flag:'wx'});
 return '/api/npc/audio/'+id;
}
export function npcAudio(deps={transcribe,translate:translateText}):Plugin{
 return {name:'zhiyu-npc-audio',apply:'serve',configureServer(server){
  const root=server.config.root;
  const active=new Set<string>();
  server.middlewares.use('/api/npc/audio',(req,res)=>{void(async()=>{
   const base=new URL('http://'+req.headers.host),path=(req.url||'/').split('?')[0];
   const reply=(status:number,data:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
   if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))return reply(403,{error:'仅允许本机访问'});
   const user=mediaUser(req.headers.cookie);if(!user)return reply(401,{error:'请先打开会话'});
   if(req.method==='GET'&&path==='/status')return reply(200,{configured:asrReady(),provider:speechProvider()});
   const dir=join(root,'.npc-runtime/audio',user);
   if(req.method==='GET'){
    const id=path.slice(1);if(!audioPattern.test(id)||!existsSync(join(dir,id)))return reply(404,{error:'语音不存在'});
    try{const meta=JSON.parse(readFileSync(join(dir,id+'.json'),'utf8'));if(Number.isInteger(meta.durationSeconds)&&meta.durationSeconds>0&&meta.durationSeconds<=3600)res.setHeader('X-Zhiyu-Audio-Duration',String(meta.durationSeconds));}catch{}
    res.setHeader('Content-Type',audioMime(id.split('.').pop()!));res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(readFileSync(join(dir,id)));return;
   }
   if(req.method!=='POST'||req.headers.origin!==base.origin)return reply(403,{error:'请求来源不匹配'});
   if(!['/upload','/translate'].includes(path))return reply(404,{error:'接口不存在'});
   if(active.has(user))return reply(409,{error:'正在处理上一条，请稍等'});
   active.add(user);
   try{
    const limit=path==='/upload'?12*1024*1024:20000;let size=0;const chunks:Buffer[]=[];
    for await(const c of req){size+=c.length;if(size>limit)return reply(413,{error:'内容过大'});chunks.push(Buffer.from(c));}
    const bytes=Buffer.concat(chunks);
    if(path==='/translate'){
     const body=JSON.parse(bytes.toString());if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000||!['zh','en'].includes(body.target))return reply(400,{error:'翻译内容无效'});
     return reply(200,{text:await deps.translate(root,body.text,body.target)});
    }
    const ext=audioExtension(bytes);if(!ext)return reply(400,{error:'音频格式不支持'});
    const text=await deps.transcribe(bytes,ext);
    const rawDuration=Number(req.headers['x-zhiyu-audio-duration']);
    const durationSeconds=Number.isInteger(rawDuration)&&rawDuration>=1&&rawDuration<=60?rawDuration:undefined;
    const id=crypto.randomUUID()+'.'+ext;mkdirSync(dir,{recursive:true});writeFileSync(join(dir,id),bytes,{flag:'wx'});writeFileSync(join(dir,id+'.json'),JSON.stringify({text,...(durationSeconds?{durationSeconds}:{})}),{flag:'wx'});
    reply(200,{audioId:id,url:'/api/npc/audio/'+id,text,durationSeconds});
   }finally{active.delete(user);}
  })().catch(e=>{if(!res.writableEnded){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e instanceof Error&&/^(本地语音识别|语音服务|豆包|没有识别到|Codex|DeepSeek)/.test(e.message)?e.message:'处理失败，请重试'}));}});});
 }};
}
