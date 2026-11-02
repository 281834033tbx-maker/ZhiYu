import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

export type QwenAudio={bytes:Buffer;extension:'mp3'|'wav'};

function audioType(bytes:Buffer):QwenAudio['extension']|null{
 if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')return 'wav';
 if(bytes.length>=3&&(bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&0xe0)===0xe0)))return 'mp3';
 return null;
}

function dashscopeKey(){
 const key=process.env.DASHSCOPE_API_KEY?.trim();
 if(!key)throw Error('千问语音尚未配置：请填写 DASHSCOPE_API_KEY 后重启程序');
 return key;
}

function dashscopeWorkspace(){
 const workspace=process.env.DASHSCOPE_WORKSPACE_ID?.trim();
 if(!workspace)throw Error('千问语音尚未配置：请填写北京地域的 DASHSCOPE_WORKSPACE_ID 后重启程序');
 if(!/^[a-zA-Z0-9-]+$/.test(workspace))throw Error('千问语音 Workspace ID 格式无效');
 return workspace;
}

function dashscopeUrl(){
 return `https://${dashscopeWorkspace()}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
}

function providerError(status:number){
 return Error(status===401||status===403
  ?'千问语音密钥无效或模型服务未开通'
  :status===402||status===429?'千问语音额度或速率受限'
  :`千问语音请求失败（HTTP ${status}）`);
}

function trustedAudioUrl(value:string){
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||!(url.hostname==='aliyuncs.com'||url.hostname.endsWith('.aliyuncs.com')))
  throw Error('千问语音返回了不可信的音频地址');
 // Qwen-Audio-TTS currently returns an http OSS URL even though the same
 // signed object is available over TLS. Keep the download encrypted.
 url.protocol='https:';
 return url;
}

async function validAudio(response:Response):Promise<QwenAudio>{
 if(!response.ok)throw providerError(response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>12*1024*1024)throw Error('千问语音合成音频过大');
 const extension=audioType(bytes);
 if(!extension)throw Error('千问语音没有返回有效音频');
 return {bytes,extension};
}

export async function synthesizeQwen(
 text:string,voice:string,request:typeof fetch=fetch,
):Promise<QwenAudio>{
 const response=await request(dashscopeUrl(),{
  method:'POST',
  headers:{Authorization:'Bearer '+dashscopeKey(),'Content-Type':'application/json'},
  body:JSON.stringify({
   model:process.env.QWEN_TTS_MODEL?.trim()||'qwen-audio-3.0-tts-flash',
   input:{text,voice,format:'wav',sample_rate:24000},
  }),
  signal:AbortSignal.timeout(90000),
 });
 let result:{code?:unknown;message?:unknown;output?:{audio?:{data?:unknown;url?:unknown}}}={};
 try{result=await response.json() as typeof result;}catch{
  if(!response.ok)throw providerError(response.status);
  throw Error('千问语音返回格式无效');
 }
 if(!response.ok){
  if(result.code||result.message)throw Error(`千问语音合成失败（${String(result.code||response.status)}：${String(result.message||'请求被拒绝')}）`);
  throw providerError(response.status);
 }
 if(result.code)throw Error(`千问语音合成失败（${String(result.code)}：${String(result.message||'未知错误')}）`);
 const audio=result.output?.audio;
 if(typeof audio?.url==='string'&&audio.url){
  const download=await request(trustedAudioUrl(audio.url),{signal:AbortSignal.timeout(90000)});
  return validAudio(download);
 }
 if(typeof audio?.data==='string'&&audio.data){
  const bytes=Buffer.from(audio.data,'base64');
  if(bytes.length>12*1024*1024)throw Error('千问语音合成音频过大');
  const extension=audioType(bytes);
  if(extension)return {bytes,extension};
 }
 throw Error('千问语音没有返回有效音频');
}

export const qwenLocalPython=()=>resolve(process.env.QWEN_TTS_LOCAL_PYTHON||'.npc-runtime/qwen3-tts-env/bin/python');
export const qwenLocalModel=()=>resolve(process.env.QWEN_TTS_LOCAL_MODEL||'.npc-runtime/models/Qwen3-TTS-12Hz-0.6B-CustomVoice');
export const qwenLocalUrl=()=>process.env.QWEN_TTS_LOCAL_URL?.trim()||'http://127.0.0.1:9873';

export function qwenLocalReady(){
 return existsSync(qwenLocalPython())&&existsSync(join(qwenLocalModel(),'model.safetensors'));
}

export async function synthesizeQwenLocal(
 text:string,speaker:string,request:typeof fetch=fetch,
):Promise<QwenAudio>{
 if(!qwenLocalReady())throw Error('本地 Qwen3-TTS 模型尚未安装');
 let response:Response;
 try{
  response=await request(qwenLocalUrl()+'/synthesize',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text,speaker,language:'Chinese'}),signal:AbortSignal.timeout(120000),
  });
 }catch{throw Error('本地 Qwen3-TTS 服务未启动或正在加载');}
 if(!response.ok){
  let detail='';
  try{detail=String((await response.json() as {error?:unknown}).error||'');}catch{}
  throw Error(detail?`本地 Qwen3-TTS 合成失败：${detail}`:'本地 Qwen3-TTS 合成失败');
 }
 return validAudio(response);
}
