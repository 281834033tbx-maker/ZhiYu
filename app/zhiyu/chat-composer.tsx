'use client';

import {accountStorage} from './account-storage';
/* eslint-disable next/no-img-element */
import {useRef,useState,useEffect,useLayoutEffect,useId,useImperativeHandle,useContext, type KeyboardEvent, type ReactNode, type Ref} from 'react';
import {Smile,ImagePlus,X,Mic} from 'lucide-react';
import {assets} from '../../lib/npc/contracts';
import {npcFetch} from './npc-fetch';
import {npcUpload,type NpcUploadProgress} from './npc-upload';
import {MeasuredProgress} from './loading-state';
import './chat-composer.css';
import EmojiPicker from './emoji-picker';
import PressableIconButton from './pressable-icon-button';
import {recordedVoiceWav} from './audio-format';
import type { DisplayPet } from './pet-storage';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import {AiDisclosure} from './user-facing-ui';
import {continuousCornerPath,resolveCornerRadii} from './continuous-corners';
import {createRecordingPauseDetector} from './recording-pause';
import {MobileComposerContext} from './mobile-composer-context';
import MobileComposer from './mobile-composer';
export type ComposePayload={text:string;audioId?:string;audioUrl?:string;audioText?:string;audioDurationSeconds?:number;imageId?:string;imageUrl?:string;assetId?:keyof typeof assets};
export function shouldSendEnter(key:string,shift:boolean,composing:boolean,keyCode:number,_endedAt:number,_now=Date.now()) {
 return key==='Enter'&&!shift&&!composing&&keyCode!==229;
}
export type ChatComposerProps={value:string;onChange:(text:string)=>void;onSend:(payload:ComposePayload)=>Promise<void|boolean>|void|boolean;disabled?:boolean;placeholder:string;label?:string;companion?:DisplayPet|null;allowImages?:boolean;allowVoice?:boolean;textareaRef?:Ref<HTMLTextAreaElement>;onSelectionChange?:(text:string,start:number,end:number)=>void;onEditorKeyDown?:(event:KeyboardEvent<HTMLTextAreaElement>)=>void;aboveInput?:ReactNode;inputPrefix?:ReactNode;presentation?:'topbar';onError?:(message:string)=>void} & {mobile?:boolean};
export default function ChatComposer(props:ChatComposerProps) {
 const contextMobile=useContext(MobileComposerContext);
 return (props.mobile??contextMobile)&&props.presentation!=='topbar'?<MobileComposer {...props}/>:<DesktopChatComposer {...props}/>;
}
export function DesktopChatComposer({value,onChange,onSend,disabled=false,placeholder,label='输入消息',companion,allowImages=true,allowVoice=true,textareaRef,onSelectionChange,onEditorKeyDown,aboveInput,inputPrefix,presentation,onError}:ChatComposerProps) {
 const quick=presentation==='topbar';
 const [picker,setPicker]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [microphoneDenied,setMicrophoneDenied]=useState(false);
 const [uploadProgress,setUploadProgress]=useState<(NpcUploadProgress&{kind:'image'|'audio'})|null>(null);
 const uploadController=useRef<AbortController|null>(null);
 useEffect(()=>{if(quick&&error)onError?.(error);},[quick,error,onError]);
 const [attachment,setAttachment]=useState<{url:string;file?:File;assetId?:keyof typeof assets;uploaded?:{imageId:string;imageUrl:string}}|null>(null);
 const [recording,setRecording]=useState(false),[recordSeconds,setRecordSeconds]=useState(0),[audioLevel,setAudioLevel]=useState(0),[voice,setVoice]=useState<{blob:Blob;durationSeconds:number;uploaded?:{audioId:string;audioUrl:string;audioText:string;audioDurationSeconds:number}}|null>(null);
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),recordTimer=useRef<ReturnType<typeof setInterval>|null>(null),recordStartedAt=useRef(0),mounted=useRef(true),recordStarting=useRef(false),discardRecording=useRef(false),audioContext=useRef<AudioContext|null>(null),meterFrame=useRef<number|null>(null);
 const speechProvider=useRef<'openai'|'doubao'|'local'|'qwen'|'qwen-local'>('local');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;uploadController.current?.abort();uploadController.current=null;if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());if(recordTimer.current)clearInterval(recordTimer.current);if(meterFrame.current!==null)cancelAnimationFrame(meterFrame.current);void audioContext.current?.close();};},[]);
 useEffect(()=>{accountStorage().removeItem('zhiyu-microphone-id');},[]);
 async function uploadBlob(kind:'image'|'audio',body:Blob,headers:HeadersInit){
  const controller=new AbortController();uploadController.current?.abort();uploadController.current=controller;
  try{return await npcUpload(kind==='image'?'/api/npc/media':'/api/npc/audio/upload',body,{headers,signal:controller.signal,onProgress:progress=>{
   if(mounted.current&&uploadController.current===controller)setUploadProgress({...progress,kind});
  }});}finally{if(uploadController.current===controller){uploadController.current=null;if(mounted.current)setUploadProgress(null);}}
 }
 async function sendRecordedVoice(blob:Blob,durationSeconds:number){
  if(disabled||locked.current||!mounted.current)return;
  locked.current=true;setBusy(true);setError('');
  let upload=blob,uploaded:NonNullable<typeof voice>['uploaded'];
  try{
   setUploadProgress({kind:'audio',loaded:0,total:null,phase:'preparing'});
   upload=speechProvider.current==='doubao'?await recordedVoiceWav(blob):blob;if(!mounted.current)return;
   const response=await uploadBlob('audio',upload,{'Content-Type':upload.type,'X-Zhiyu-Audio-Duration':String(durationSeconds)});
   const result=await response.json() as {audioId:string;url:string;text:string;error?:string};if(!response.ok)throw Error(result.error||'语音识别失败');if(!mounted.current)return;
   uploaded={audioId:result.audioId,audioUrl:result.url,audioText:result.text,audioDurationSeconds:durationSeconds};await onSend({text:'',...uploaded});if(mounted.current)setVoice(null);
  }catch(e){if(mounted.current){setVoice(quick?null:{blob:upload,durationSeconds,uploaded});setError(reportUserFacingError(e,'send','发送语音'));}}
  finally{locked.current=false;if(mounted.current){setBusy(false);setUploadProgress(null);}}
 }
 async function startRecording(){
  if(!allowVoice||recordStarting.current)return;
  if(value.trim()||attachment){setError('请先发送或清空当前文字和图片，再录制语音');return;}
  recordStarting.current=true;setError('');setMicrophoneDenied(false);
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('当前浏览器不支持录音，请用最新版 Chrome 或 Safari 打开本机网页');
   // Resume inside the click gesture; some browsers refuse to start Web Audio after async permission checks.
   try{const context=new AudioContext();audioContext.current=context;void context.resume().catch(()=>{});}catch{}
   const desktopAccess=await window.zhiyuDesktop?.requestMicrophoneAccess?.();
   if(desktopAccess==='denied'||desktopAccess==='restricted'){
    setMicrophoneDenied(true);
    throw Error('智域没有麦克风权限。请在系统设置中允许智域使用麦克风，然后重试。');
   }
   const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(!mounted.current){mic.getTracks().forEach(t=>t.stop());return;}stream.current=mic;
   const r=await npcFetch('/api/npc/audio/status');const status=await r.json() as {configured?:boolean;provider?:'openai'|'doubao'|'local'|'qwen'|'qwen-local'};
   if(!r.ok)throw Error('无法检查语音识别服务，请稍后重试');
   if(status.provider==='local'&&!status.configured)throw Error('麦克风权限已就绪；本地语音识别模型尚未安装，请检查本机模型文件。');
   if(!status.configured)throw Error('麦克风权限已就绪；语音识别服务尚未配置，暂时不能发送语音。');
   speechProvider.current=status.provider&&['doubao','local','qwen','qwen-local'].includes(status.provider)?status.provider:'openai';
   try{const context=audioContext.current;if(!context)throw Error('AudioContext unavailable');const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(mic).connect(analyser);const samples=new Uint8Array(analyser.fftSize),pause=quick?createRecordingPauseDetector(performance.now()):null;let lastUpdate=0;const meter=(at:number)=>{analyser.getByteTimeDomainData(samples);if(at-lastUpdate>85){lastUpdate=at;let energy=0;for(const sample of samples){const delta=(sample-128)/128;energy+=delta*delta;}const rms=Math.sqrt(energy/samples.length);if(mounted.current&&context.state==='running')setAudioLevel(Math.min(1,rms*20));if(pause?.(at,rms)&&recorder.current?.state==='recording'){recorder.current.stop();return;}}meterFrame.current=requestAnimationFrame(meter);};meterFrame.current=requestAnimationFrame(meter);}catch{}
   const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
   const rec=new MediaRecorder(mic,type?{mimeType:type}:undefined),chunks:BlobPart[]=[];recorder.current=rec;
   rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   rec.onstop=()=>{mic.getTracks().forEach(t=>t.stop());recorder.current=null;stream.current=null;if(recordTimer.current)clearInterval(recordTimer.current);if(meterFrame.current!==null)cancelAnimationFrame(meterFrame.current);meterFrame.current=null;void audioContext.current?.close();audioContext.current=null;if(!mounted.current)return;setAudioLevel(0);setRecording(false);if(discardRecording.current){discardRecording.current=false;return;}const blob=new Blob(chunks,{type:rec.mimeType});if(blob.size>12*1024*1024){setError('录音过大，请缩短后重试');return;}if(blob.size){const durationSeconds=Math.max(1,Math.min(60,Math.ceil((Date.now()-recordStartedAt.current)/1000)));void sendRecordedVoice(blob,durationSeconds);}};
   rec.onerror=()=>{setError('录音失败，请重试');if(rec.state!=='inactive')rec.stop();};
   discardRecording.current=false;setVoice(null);setAttachment(null);setPicker(false);setRecordSeconds(0);setAudioLevel(0);setRecording(true);rec.start();recordStartedAt.current=Date.now();let seconds=0;
   recordTimer.current=setInterval(()=>{setRecordSeconds(++seconds);if(seconds>=60&&rec.state==='recording')rec.stop();},1000);
  }catch(e){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;void audioContext.current?.close();audioContext.current=null;if(mounted.current){
   if(e instanceof DOMException&&['NotAllowedError','PermissionDeniedError','SecurityError'].includes(e.name)){setMicrophoneDenied(true);setError('麦克风被系统或浏览器拒绝。请允许智域使用麦克风，然后重试。');}
   else if(e instanceof DOMException&&e.name==='NotFoundError')setError('没有找到麦克风，请检查麦克风是否已连接。');
   else if(e instanceof DOMException&&e.name==='NotReadableError')setError('麦克风被其他程序占用或无法读取，请关闭占用程序后重试。');
   else setError(reportUserFacingError(e,'media','开启录音'));
  }}finally{recordStarting.current=false;}
 }
 function cancelRecording(){discardRecording.current=true;if(recorder.current?.state==='recording')recorder.current.stop();setRecording(false);setRecordSeconds(0);setAudioLevel(0);}
 const composing=useRef(false),endedAt=useRef(0),fileInput=useRef<HTMLInputElement>(null),editor=useRef<HTMLTextAreaElement>(null),locked=useRef(false);
 useImperativeHandle(textareaRef,()=>editor.current!);
 useEffect(()=>{if(!quick)editor.current?.focus();},[quick]);
 const previewUrl=attachment?.file?attachment.url:null;
 useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
 async function choose(file?:File){
  if(!file)return;
  if(!allowImages){setError('当前聊天只支持文字与小表情');return;}
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){setError('支持 PNG、JPEG、WebP 和 GIF 图片');return;}
  if(file.size>12*1024*1024){setError('单张图片请小于12MB');return;}
  setVoice(null);setError('');setAttachment({file,url:URL.createObjectURL(file)});setPicker(false);editor.current?.focus();
 }
 async function submit(){
  if(disabled||recording||locked.current||composing.current||!mounted.current||(!value.trim()&&!attachment&&!voice))return;
  locked.current=true;setBusy(true);setError('');
  try{
   if(voice){
    let uploaded=voice.uploaded;
    if(!uploaded){
     setUploadProgress({kind:'audio',loaded:0,total:null,phase:'preparing'});
     const upload=speechProvider.current==='doubao'&&voice.blob.type!=='audio/wav'?await recordedVoiceWav(voice.blob):voice.blob;if(!mounted.current)return;
     const r=await uploadBlob('audio',upload,{'Content-Type':upload.type,'X-Zhiyu-Audio-Duration':String(voice.durationSeconds)});
     const result=await r.json() as {audioId:string;url:string;text:string;error?:string};if(!r.ok)throw Error(result.error||'语音识别失败');if(!mounted.current)return;
     uploaded={audioId:result.audioId,audioUrl:result.url,audioText:result.text,audioDurationSeconds:voice.durationSeconds};setVoice({...voice,uploaded});
    }
    await onSend({text:'',...uploaded});if(mounted.current)setVoice(null);return;
   }
   let uploaded=attachment?.uploaded;
   if(attachment?.file&&!uploaded){
    const res=await uploadBlob('image',attachment.file,{'Content-Type':attachment.file.type});
    const result=await res.json() as {imageId:string;url:string;error?:string};if(!res.ok)throw Error(result.error||'图片上传失败');
    if(!mounted.current)return;uploaded={imageId:result.imageId,imageUrl:result.url};setAttachment({...attachment,uploaded});
   }
   await onSend({text:value.trim(),...uploaded,...(attachment?.assetId?{assetId:attachment.assetId}:{})});
   if(mounted.current){setAttachment(null);setPicker(false);}
  }catch(e){if(mounted.current)setError(reportUserFacingError(e,'send','发送消息'));}
  finally{locked.current=false;if(mounted.current){setBusy(false);setUploadProgress(null);setTimeout(()=>{if(mounted.current)editor.current?.focus();},0);}}
 }
 function keyDown(e:KeyboardEvent<HTMLTextAreaElement>){
  if(quick&&e.key==='Escape'){e.preventDefault();cancelRecording();onChange('');setVoice(null);setError('');return;}
  onEditorKeyDown?.(e);if(e.defaultPrevented)return;
  if(e.key==='Enter'&&!e.shiftKey){
   if(shouldSendEnter(e.key,e.shiftKey,composing.current||e.nativeEvent.isComposing,0,endedAt.current)){e.preventDefault();void submit();}
   else if(!composing.current&&!e.nativeEvent.isComposing)e.preventDefault();
  }
 }
 if(quick)return <form className="zy-quick-compose" onSubmit={event=>{event.preventDefault();void submit();}}>
  <img className="zy-quick-molly" src="/stitch/molly-avatar-v2.png" alt="" aria-hidden="true"/>
  {recording?<output className="chat-recording-bar" aria-label={`正在录音 ${recordSeconds} 秒`}><div className="chat-recording-info">{recordSeconds}秒</div><div className={audioLevel<.015?'chat-recording-dots':'chat-recording-wave'} aria-hidden="true">{audioLevel<.015?Array.from({length:9},(_,i)=><i key={i}/>):Array.from({length:17},(_,i)=><i key={i} style={{height:`${Math.min(22,4+audioLevel*(15+(i%5)*3))}px`}}/>)}</div></output>:<textarea ref={editor} rows={1} aria-label={label} placeholder={placeholder} value={value} maxLength={4000} disabled={busy||disabled} onChange={event=>onChange(event.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;endedAt.current=Date.now();}} onKeyDown={keyDown}/>}
  <PressableIconButton type="button" className={recording?'is-recording':''} aria-label={recording?'停止录音':'录制语音'} title={recording?'停止录音并发送':'录制语音，停顿后发送'} disabled={busy||disabled} onClick={()=>recording?recorder.current?.state==='recording'&&recorder.current.stop():void startRecording()}><Mic size={16}/></PressableIconButton>
 </form>;
 return <div className="chat-composer-shell">
  {error&&<div className="chat-compose-error" role="alert">{error}{voice&&<button type="button" disabled={busy} onClick={()=>void submit()}>重试发送</button>}{microphoneDenied&&window.zhiyuDesktop?.openMicrophoneSettings&&<button type="button" onClick={()=>void window.zhiyuDesktop?.openMicrophoneSettings?.()}>打开麦克风设置</button>}<button type="button" aria-label="关闭发送提示" onClick={()=>{setError('');setVoice(null);}}><X size={14}/></button></div>}
  {attachment&&<div className="chat-attachment"><img src={attachment.url} alt={attachment.assetId?'待发送表情包':'待发送图片'}/><span>{attachment.assetId?'表情包':attachment.file?.name||'图片'}<small>确认后发送</small></span><button type="button" aria-label="移除待发送图片" disabled={busy} onClick={()=>setAttachment(null)}><X size={16}/></button></div>}
  {uploadProgress&&<div className="chat-upload-progress" aria-busy="true">
   {uploadProgress.phase==='uploading'&&uploadProgress.total!==null?<MeasuredProgress value={uploadProgress.loaded} total={uploadProgress.total} label={uploadProgress.kind==='audio'?'正在上传语音':'正在上传图片'}/>:<output className="chat-upload-phase">{uploadProgress.phase==='processing'?(uploadProgress.kind==='audio'?'上传完成，正在识别语音…':'上传完成，正在处理图片…'):uploadProgress.phase==='preparing'?(uploadProgress.kind==='audio'?'正在准备语音…':'正在准备上传…'):'正在上传…'}</output>}
  </div>}
  {picker&&<EmojiPicker allowImages={allowImages} onClose={()=>setPicker(false)} onFile={file=>{void choose(file);}} onEmoji={emoji=>{const start=editor.current?.selectionStart??value.length,end=editor.current?.selectionEnd??value.length;if(value.length-(end-start)+emoji.length>4000)return;onChange(value.slice(0,start)+emoji+value.slice(end));requestAnimationFrame(()=>{editor.current?.focus();editor.current?.setSelectionRange(start+emoji.length,start+emoji.length);});}}/>}
  {aboveInput}
  <form className="chat-compose-row" onSubmit={e=>{e.preventDefault();void submit();}}>
   <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
   <PressableIconButton type="button" title={allowImages?"添加图片，也可以粘贴图片":"当前聊天暂不支持图片"} aria-label="添加图片" disabled={busy||disabled||recording||!!voice} onClick={()=>allowImages?fileInput.current?.click():setError("当前聊天暂不支持发送图片，可以先发送文字或小表情。")}><ImagePlus size={19}/></PressableIconButton>
   <PressableIconButton type="button" title="表情包" aria-label="选择表情包" aria-expanded={picker} disabled={busy||disabled||recording||!!voice} onClick={()=>setPicker(!picker)}><Smile size={19}/></PressableIconButton>
   <PressableIconButton type="button" className={recording?'is-recording':''} aria-label={recording?'停止录音':'录制语音'} title={!allowVoice?'当前聊天暂不支持语音':recording?'停止录音并发送':'录制语音，最长60秒'} disabled={busy||disabled||!!voice} onClick={()=>!allowVoice?setError('当前聊天暂不支持发送语音，可以先发送文字或小表情。'):recording?recorder.current?.state==='recording'&&recorder.current.stop():void startRecording()}><Mic size={19}/></PressableIconButton>
   {recording?<output className="chat-recording-bar" aria-label={`正在录音 ${recordSeconds} 秒`}><div className="chat-recording-info">{recordSeconds}秒</div><div className={audioLevel<.015?'chat-recording-dots':'chat-recording-wave'} aria-hidden="true">{audioLevel<.015?Array.from({length:9},(_,i)=><i key={i}/>):Array.from({length:17},(_,i)=><i key={i} style={{height:`${Math.min(22,4+audioLevel*(15+(i%5)*3))}px`}}/>)}</div><button type="button" aria-label="取消录音" title="取消录音" onClick={cancelRecording}><X size={16}/></button></output>:<div className="chat-text-entry" data-zy-corners="off">
    <ChatInputSurface/>
    {companion?.imageSrc&&<div className="chat-pet-horizon" aria-hidden="true"><span className="chat-pet-walker"><img src={companion.imageSrc} alt="" draggable={false}/></span></div>}
    <div className="chat-text-entry-body">{inputPrefix}<textarea ref={editor} rows={1} aria-label={label} placeholder={placeholder} value={value} maxLength={4000} disabled={busy||recording||!!voice} onChange={e=>{onChange(e.target.value);onSelectionChange?.(e.target.value,e.target.selectionStart,e.target.selectionEnd);}} onSelect={e=>onSelectionChange?.(e.currentTarget.value,e.currentTarget.selectionStart,e.currentTarget.selectionEnd)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;endedAt.current=Date.now();}} onKeyDown={keyDown} onPaste={e=>{const images=Array.from(e.clipboardData.items).filter(i=>i.kind==='file'&&i.type.startsWith('image/'));if(images.length){e.preventDefault();void choose(images[0].getAsFile()||undefined);}}}/></div>
    <PressableIconButton type="submit" aria-label="发送消息" title="发送消息" disabled={busy||disabled||recording||(!value.trim()&&!attachment&&!voice)}><svg className="chat-send-plane" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><defs><linearGradient id="zy-paper-plane-hover" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop stopColor="#f49373"/><stop offset="1" stopColor="#e47a96"/></linearGradient></defs><path d="m22 2-7 20-4-9-9-4Z"/></svg></PressableIconButton>
   </div>}
  </form>
  <AiDisclosure/>
 </div>;
}

/** The fill and one-pixel outline share the actual continuous contour. This
 * avoids clipping away an ordinary circular CSS border at the smoothed corners. */
export function ChatInputSurface() {
 const svg=useRef<SVGSVGElement>(null),path=useRef<SVGPathElement>(null);
 const gradient='zy-composer-edge-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
 useLayoutEffect(()=>{
  const node=svg.current,target=node?.parentElement,outline=path.current;if(!node||!target||!outline)return;
  let frame=0;
  const paint=(width=target.offsetWidth,height=target.offsetHeight)=>{
   if(width<=1||height<=1)return;
   const style=getComputedStyle(target),radii=resolveCornerRadii([style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius],width,height);
   const inner=radii.map(radius=>({x:Math.max(0,radius.x-.5),y:Math.max(0,radius.y-.5)})) as typeof radii;
   node.setAttribute('viewBox',`0 0 ${width} ${height}`);
   outline.setAttribute('d',continuousCornerPath(width-1,height-1,inner));
  };
  paint();
  const observer=new ResizeObserver(entries=>{const box=entries[0]?.borderBoxSize?.[0];paint(box?.inlineSize,box?.blockSize);});observer.observe(target);
  const refresh=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>paint());};
  const styles=new MutationObserver(refresh);styles.observe(target,{attributes:true,attributeFilter:['class','style']});
  window.addEventListener('resize',refresh,{passive:true});
  return()=>{cancelAnimationFrame(frame);observer.disconnect();styles.disconnect();window.removeEventListener('resize',refresh);};
 },[]);
 return <svg ref={svg} className="chat-input-surface" aria-hidden="true" focusable="false" preserveAspectRatio="none">
  <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0"><stop stopColor="var(--zy-directory-tone-start)"/><stop offset="48%" stopColor="var(--zy-directory-tone-middle)"/><stop offset="100%" stopColor="var(--zy-directory-tone-end)"/></linearGradient></defs>
  <path ref={path} transform="translate(.5 .5)" fill="var(--zy-canvas)" stroke={`url(#${gradient})`} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
 </svg>;
}
