'use client';

import {useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type KeyboardEvent,type PointerEvent,type ReactNode,type Ref} from 'react';
import {flushSync} from 'react-dom';
import {ImagePlus,Keyboard,Mic,Smile,X} from 'lucide-react';
import type {ComposePayload} from './chat-composer';
import {npcFetch} from './npc-fetch';
import {npcUpload,type NpcUploadProgress} from './npc-upload';
import {recordedVoiceWav} from './audio-format';
import {MeasuredProgress} from './loading-state';
import {reportUserFacingError} from '../../lib/user-facing-errors';
import {MobileIconButton} from './mobile-effects';
import MobileEmojiPanel from './mobile-emoji-panel';
import MobilePhotoPicker,{mobileImageError} from './mobile-photo-picker';
import MobilePreviewKeyboard,{MOBILE_PREVIEW_KEYBOARD_HEIGHT,useMobilePreviewKeyboard,type MobilePreviewKeyboardActions} from './mobile-preview-keyboard';
import './mobile-chat.css';

export type MobileComposerProps={value:string;onChange:(text:string)=>void;onSend:(payload:ComposePayload)=>Promise<void|boolean>|void|boolean;onSendComplete?:()=>void;disabled?:boolean;placeholder:string;label?:string;autoFocus?:boolean;allowImages?:boolean;allowVoice?:boolean;textareaRef?:Ref<HTMLTextAreaElement>;onSelectionChange?:(text:string,start:number,end:number)=>void;onEditorKeyDown?:(event:KeyboardEvent<HTMLTextAreaElement>)=>void;aboveInput?:ReactNode;inputPrefix?:ReactNode;onError?:(message:string)=>void};
type VoiceUpload={audioId:string;audioUrl:string;audioText:string;audioDurationSeconds:number};
type RecordedVoice={blob:Blob;durationSeconds:number;action:'send'|'text';uploaded?:VoiceUpload};
type HeldPointer={id:number;x:number;y:number;action:'send'|'cancel'|'text'};

/** Web image sends keep GIF animation. "原图" bypasses all canvas processing. */
export async function prepareMobileImage(file:File,original:boolean):Promise<Blob>{
 if(original||file.type==='image/gif')return file;
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)return file;
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,file.type,.85));
  return blob&&blob.size<file.size?blob:file;
 }catch{return file;}finally{URL.revokeObjectURL(url);}
}

export default function MobileComposer({value,onChange,onSend,onSendComplete,disabled=false,placeholder,label='输入消息',autoFocus=false,allowImages=true,allowVoice=true,textareaRef,onSelectionChange,onEditorKeyDown,aboveInput,inputPrefix,onError}:MobileComposerProps){
 const [photoHost,setPhotoHost]=useState<Element|null>(null),[mode,setMode]=useState<'text'|'voice'>('text'),[panel,setPanel]=useState<'emoji'|'photos'|null>(null),[pasteFiles,setPasteFiles]=useState<File[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[recording,setRecording]=useState(false),[starting,setStarting]=useState(false),[recordSeconds,setRecordSeconds]=useState(0),[audioLevel,setAudioLevel]=useState<number|null>(null),[gesture,setGesture]=useState<HeldPointer['action']>('send'),[keyboardInset,setKeyboardInset]=useState(0),[keyboardOpen,setKeyboardOpen]=useState(false),[microphoneDenied,setMicrophoneDenied]=useState(false),[retryVoice,setRetryVoice]=useState<RecordedVoice|null>(null),[progress,setProgress]=useState<(NpcUploadProgress&{kind:'image'|'audio'})|null>(null);
 const shell=useRef<HTMLDivElement>(null),editor=useRef<HTMLTextAreaElement>(null),alive=useRef(true),locked=useRef(false),composing=useRef(false),selection=useRef({start:value.length,end:value.length}),held=useRef<HeldPointer|null>(null),recordStarting=useRef(false),recordingEnded=useRef(false),recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),recordTimer=useRef<ReturnType<typeof setInterval>|null>(null),startedAt=useRef(0),meterFrame=useRef<number|null>(null),audioContext=useRef<AudioContext|null>(null),uploadController=useRef<AbortController|null>(null),provider=useRef('local'),voiceDisposition=useRef<HeldPointer['action']>('send'),imageCache=useRef(new WeakMap<File,Map<boolean,{imageId:string;imageUrl:string}>>());
 const currentValue=useRef(value),previewKeyboard=useMobilePreviewKeyboard({editorRef:editor,enabled:mode==='text'&&panel===null});
 const previewOpen=useRef(false),previewActions=useRef<MobilePreviewKeyboardActions|null>(null),previewPinyin=useRef('');
 const [previewComposition,setPreviewComposition]=useState('');
 const changePreviewComposition=(text:string)=>{previewPinyin.current=text;setPreviewComposition(text);};
 useLayoutEffect(()=>{currentValue.current=value;},[value]);
 useLayoutEffect(()=>{previewOpen.current=previewKeyboard.open;},[previewKeyboard.open]);
 useImperativeHandle(textareaRef,()=>editor.current!);
 useLayoutEffect(()=>{if(autoFocus)editor.current?.focus();},[autoFocus]);
 useEffect(()=>{if(error)onError?.(error);},[error,onError]);
 function releaseMicrophone(){
  if(recordTimer.current)clearInterval(recordTimer.current);recordTimer.current=null;
  if(meterFrame.current!==null)cancelAnimationFrame(meterFrame.current);meterFrame.current=null;
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  void audioContext.current?.close().catch(()=>{});audioContext.current=null;
 }
 useEffect(()=>{
  alive.current=true;setPhotoHost(shell.current?.closest('.zy-mobile')||null);
  const cancel=()=>{held.current=null;voiceDisposition.current='cancel';if(recorder.current?.state==='recording')recorder.current.stop();};
  const hidden=()=>{if(document.hidden)cancel();};
  window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',hidden);
  return()=>{alive.current=false;cancel();releaseMicrophone();uploadController.current?.abort();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 useEffect(()=>{
  const viewport=window.visualViewport;
  const update=()=>{
   if(!viewport){setKeyboardInset(0);setKeyboardOpen(false);return;}
   const height=Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop),focused=document.activeElement===editor.current,open=height>80&&focused;
   const chat=shell.current?.closest<HTMLElement>('.xx-chat,.zy-chat,.zy-mobile'),bottom=chat?.getBoundingClientRect().bottom??window.innerHeight;
   setKeyboardOpen(open);setKeyboardInset(open?Math.max(0,bottom-viewport.height-viewport.offsetTop):0);
  };
  update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',update);
  return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);};
 },[]);
 useLayoutEffect(()=>{
  const chat=shell.current?.closest<HTMLElement>('.xx-chat,.zy-chat,.zy-mobile');if(!chat)return;
  const thread=chat.querySelector<HTMLElement>('.xx-thread,.zy-thread'),atEnd=!thread||thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;
  chat.style.setProperty('--zy-m-composer-obstruction',`${panel==='emoji'?364:previewKeyboard.open?MOBILE_PREVIEW_KEYBOARD_HEIGHT+64:keyboardOpen?keyboardInset+64:112}px`);
  const frame=requestAnimationFrame(()=>{if(thread&&atEnd)thread.scrollTop=thread.scrollHeight;});
  return()=>{cancelAnimationFrame(frame);chat.style.removeProperty('--zy-m-composer-obstruction');};
 },[panel,keyboardOpen,keyboardInset,previewKeyboard.open]);
 useEffect(()=>{
  const chat=shell.current?.closest<HTMLElement>('.xx-chat,.zy-chat'),thread=chat?.querySelector<HTMLElement>('.xx-thread,.zy-thread');if(!thread)return;
  const seen=new WeakSet<Element>(),seenMessages=new WeakSet<Element>(),reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),running=new Set<Animation>();
  const groups=()=>Array.from(thread.querySelectorAll<HTMLElement>('.xx-group,.zy-message.group-first'));
  const messages=()=>Array.from(thread.querySelectorAll<HTMLElement>('.xx-message,.zy-message'));
  const animate=(node:HTMLElement,delay=0)=>{if(reduced.matches)return;const animation=node.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:380,delay,easing:'cubic-bezier(.22,.8,.25,1)',fill:'backwards'});running.add(animation);animation.onfinish=()=>running.delete(animation);};
  const initial=groups();let primed=initial.length>0;
  initial.forEach(node=>seen.add(node));messages().forEach(node=>seenMessages.add(node));initial.slice(-5).forEach((node,index)=>animate(node,index*90));
  const observer=new MutationObserver(()=>{
   const currentGroups=groups(),currentMessages=messages();
   if(!primed&&currentGroups.length){primed=true;currentGroups.forEach(node=>seen.add(node));currentMessages.forEach(node=>seenMessages.add(node));currentGroups.slice(-5).forEach((node,index)=>animate(node,index*90));return;}
   const added=new Set<Element>();for(const node of currentGroups)if(!seen.has(node)){seen.add(node);added.add(node);animate(node);}
   for(const node of currentMessages)if(!seenMessages.has(node)){seenMessages.add(node);if(!added.has(node)&&!added.has(node.closest('.xx-group')!))animate(node);}
  });observer.observe(thread,{childList:true,subtree:true});
  const stop=()=>{if(reduced.matches){running.forEach(animation=>animation.cancel());running.clear();}};reduced.addEventListener('change',stop);
  return()=>{observer.disconnect();running.forEach(animation=>animation.cancel());reduced.removeEventListener('change',stop);};
 },[]);
 async function upload(kind:'image'|'audio',blob:Blob,headers:HeadersInit){
  const controller=new AbortController();uploadController.current=controller;
  try{return await npcUpload(kind==='image'?'/api/npc/media':'/api/npc/audio/upload',blob,{headers,signal:controller.signal,onProgress:next=>{if(alive.current)setProgress({...next,kind});}});}
  finally{if(uploadController.current===controller)uploadController.current=null;if(alive.current)setProgress(null);}
 }
 async function deliver(payload:ComposePayload,send=onSend){if(await send(payload)===false)throw Error('消息没发出去，请重试');}
 async function sendText(){
  if(previewPinyin.current){if(previewActions.current)previewActions.current.commitPending();else textMode();return;}
  if(disabled||locked.current||recording||starting||composing.current||!currentValue.current.trim())return;
  const snapshot=currentValue.current,caret={...selection.current};let completed=false;
  locked.current=true;setBusy(true);setError('');
  try{await deliver({text:snapshot.trim()});completed=true;}
  catch(cause){if(alive.current){if(!currentValue.current||currentValue.current===snapshot){currentValue.current=snapshot;selection.current=caret;onChange(snapshot);}setError(reportUserFacingError(cause,'send','发送消息'));}}
  finally{locked.current=false;if(alive.current){setBusy(false);if(previewOpen.current)requestAnimationFrame(()=>{if(alive.current&&previewOpen.current&&previewKeyboard.isRequested()){editor.current?.focus();editor.current?.setSelectionRange(selection.current.start,selection.current.end);}});}}
  if(completed&&alive.current)onSendComplete?.();
 }
 async function sendImages(files:File[],original:boolean,onDelivered:(file:File)=>void=()=>{}){
  if(disabled||locked.current)throw Error('请等当前消息处理完再发送。');
  if(!allowImages)throw Error('当前聊天暂不支持发送图片，可以先发送文字或小表情。');
  if(files.length>9)throw Error('一次最多选择9张图片');
  locked.current=true;setBusy(true);setError('');
  const batchSend=onSend;let caption=value.trim();
  try{
   for(const file of files){
    const issue=mobileImageError(file);if(issue)throw Error(issue);
    if(!alive.current)throw new DOMException('已取消','AbortError');
    let variants=imageCache.current.get(file);if(!variants){variants=new Map();imageCache.current.set(file,variants);}
    let uploaded=variants.get(original);
    if(!uploaded){
     setProgress({kind:'image',loaded:0,total:null,phase:'preparing'});
     const body=await prepareMobileImage(file,original);if(!alive.current)throw new DOMException('已取消','AbortError');
     const response=await upload('image',body,{'Content-Type':body.type}),result=await response.json() as {imageId?:string;url?:string;error?:string};
     if(!response.ok||!result.imageId||!result.url)throw Error(result.error||'图片上传失败');
     uploaded={imageId:result.imageId,imageUrl:result.url};variants.set(original,uploaded);
    }
    if(!alive.current)throw new DOMException('已取消','AbortError');
    await deliver({text:caption,...uploaded},batchSend);caption='';onDelivered(file);
   }
  }catch(cause){if(alive.current)setError(reportUserFacingError(cause,'send','发送图片'));throw cause;}
  finally{locked.current=false;if(alive.current){setBusy(false);setProgress(null);}}
  if(alive.current)onSendComplete?.();
 }
 async function processVoice(voice:RecordedVoice){
  if(locked.current||!alive.current)return;
  locked.current=true;setBusy(true);setError('');let uploaded=voice.uploaded,completed=false;
  try{
   if(!uploaded){
    setProgress({kind:'audio',loaded:0,total:null,phase:'preparing'});
    const body=provider.current==='doubao'&&voice.blob.type!=='audio/wav'?await recordedVoiceWav(voice.blob):voice.blob;
    if(!alive.current)return;
    const response=await upload('audio',body,{'Content-Type':body.type,'X-Zhiyu-Audio-Duration':String(voice.durationSeconds)}),result=await response.json() as {audioId?:string;url?:string;text?:string;error?:string};
    if(!response.ok||!result.audioId||!result.url)throw Error(result.error||'语音识别失败');
    uploaded={audioId:result.audioId,audioUrl:result.url,audioText:result.text||'',audioDurationSeconds:voice.durationSeconds};
   }
   if(!alive.current)return;
   if(voice.action==='text'){
    if(!uploaded.audioText.trim())throw Error('语音识别失败，请重试');
    currentValue.current=uploaded.audioText;onChange(uploaded.audioText);selection.current={start:uploaded.audioText.length,end:uploaded.audioText.length};setMode('text');setPanel(null);
    requestAnimationFrame(()=>{if(alive.current)editor.current?.focus();});
   }else {await deliver({text:'',...uploaded});completed=true;}
   if(alive.current)setRetryVoice(null);
  }catch(cause){if(alive.current){setRetryVoice({...voice,uploaded});setError(reportUserFacingError(cause,'send',voice.action==='text'?'识别语音':'发送语音'));}}
  finally{locked.current=false;if(alive.current){setBusy(false);setProgress(null);}}
  if(completed&&alive.current)onSendComplete?.();
 }
 async function startRecording(){
  if(!allowVoice||recordStarting.current||recorder.current||locked.current||disabled)return;
  if(value.trim()){held.current=null;setError('请先发送或清空当前文字和图片，再录制语音');return;}
  recordStarting.current=true;recordingEnded.current=false;voiceDisposition.current='send';setStarting(true);setError('');setMicrophoneDenied(false);setRetryVoice(null);
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('当前浏览器不支持录音，请用最新版 Chrome 或 Safari 打开网页');
   try{const context=new AudioContext();audioContext.current=context;void context.resume().catch(()=>{});}catch{}
   const desktopAccess=await window.zhiyuDesktop?.requestMicrophoneAccess?.();
   if(desktopAccess==='denied'||desktopAccess==='restricted'){setMicrophoneDenied(true);throw Error('智域没有麦克风权限。请在系统设置中允许智域使用麦克风，然后重试。');}
   if(!held.current||!alive.current)return;
   const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(!held.current||!alive.current){microphone.getTracks().forEach(track=>track.stop());return;}stream.current=microphone;
   const response=await npcFetch('/api/npc/audio/status'),status=await response.json() as {configured?:boolean;provider?:string};
   if(!response.ok)throw Error('无法检查语音识别服务，请稍后重试');
   if(!status.configured)throw Error('麦克风权限已就绪；语音识别暂时不可用，请稍后重试。');
   if(!held.current||!alive.current)return;provider.current=status.provider||'openai';
   const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(candidate=>MediaRecorder.isTypeSupported(candidate)),record=new MediaRecorder(microphone,type?{mimeType:type}:undefined),chunks:BlobPart[]=[];recorder.current=record;
   record.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   record.onstop=()=>{
    recorder.current=null;releaseMicrophone();if(!alive.current)return;
    setRecording(false);setStarting(false);setAudioLevel(null);const action=voiceDisposition.current;held.current=null;
    if(action==='cancel')return;
    const blob=new Blob(chunks,{type:record.mimeType}),durationSeconds=Math.max(1,Math.min(60,Math.ceil((Date.now()-startedAt.current)/1000)));
    if(blob.size>12*1024*1024){setError('录音过大，请缩短后重试');return;}
    if(!blob.size){setError('录音失败，请重试');return;}
    void processVoice({blob,durationSeconds,action});
   };
   record.onerror=()=>{voiceDisposition.current='cancel';if(alive.current)setError('录音失败，请重试');if(record.state!=='inactive')record.stop();};
   try{
    const context=audioContext.current;if(!context)throw Error('Audio context unavailable');const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(microphone).connect(analyser);const samples=new Uint8Array(analyser.fftSize);let last=0;
    const meter=(at:number)=>{if(!alive.current||!recorder.current)return;analyser.getByteTimeDomainData(samples);if(at-last>85){last=at;let energy=0;for(const sample of samples)energy+=((sample-128)/128)**2;setAudioLevel(Math.min(1,Math.sqrt(energy/samples.length)*20));}meterFrame.current=requestAnimationFrame(meter);};meterFrame.current=requestAnimationFrame(meter);
   }catch{}
   setRecording(true);setRecordSeconds(0);setAudioLevel(null);startedAt.current=Date.now();record.start();
   recordTimer.current=setInterval(()=>{const seconds=Math.min(60,Math.floor((Date.now()-startedAt.current)/1000));setRecordSeconds(seconds);if(seconds>=60&&record.state==='recording'){voiceDisposition.current=held.current?.action||'send';recordingEnded.current=true;held.current=null;record.stop();}},200);
  }catch(cause){
   held.current=null;releaseMicrophone();if(alive.current){setRecording(false);
    if(cause instanceof DOMException&&['NotAllowedError','PermissionDeniedError','SecurityError'].includes(cause.name)){setMicrophoneDenied(true);setError('麦克风被系统或浏览器拒绝。请允许智域使用麦克风，然后重试。');}
    else if(cause instanceof DOMException&&cause.name==='NotFoundError')setError('没有找到麦克风，请检查麦克风是否已连接。');
    else if(cause instanceof DOMException&&cause.name==='NotReadableError')setError('麦克风被其他程序占用或无法读取，请关闭占用程序后重试。');
    else setError(reportUserFacingError(cause,'media','开启录音'));
   }
  }finally{recordStarting.current=false;if(!recorder.current)releaseMicrophone();if(alive.current)setStarting(false);}
 }
 function pointerDown(event:PointerEvent<HTMLButtonElement>){
  if(event.button!==0||held.current||disabled||busy||starting||recording)return;
  event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);held.current={id:event.pointerId,x:event.clientX,y:event.clientY,action:'send'};setGesture('send');void startRecording();
 }
 function pointerMove(event:PointerEvent<HTMLButtonElement>){
  const current=held.current;if(!current||current.id!==event.pointerId)return;
  const dx=event.clientX-current.x,dy=event.clientY-current.y,distance=Math.hypot(dx,dy);
  current.action=distance>60&&dy<0&&dx<0?'cancel':distance>60&&dy<0&&dx>0?'text':'send';voiceDisposition.current=current.action;setGesture(current.action);
 }
 function pointerEnd(event:PointerEvent<HTMLButtonElement>,cancel=false){
  const current=held.current;if(!current||current.id!==event.pointerId)return;
  voiceDisposition.current=cancel?'cancel':current.action;held.current=null;
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(!recordingEnded.current&&recorder.current?.state==='recording')recorder.current.stop();
 }
 function rememberSelection(){if(editor.current){selection.current={start:editor.current.selectionStart,end:editor.current.selectionEnd};onSelectionChange?.(currentValue.current,selection.current.start,selection.current.end);}}
 function insert(text:string){
  const existing=currentValue.current,start=Math.min(selection.current.start,existing.length),end=Math.min(selection.current.end,existing.length),next=existing.slice(0,start)+text+existing.slice(end);if(next.length>4000)return false;
  currentValue.current=next;onChange(next);selection.current={start:start+text.length,end:start+text.length};onSelectionChange?.(next,start+text.length,start+text.length);
  requestAnimationFrame(()=>{const caret=start+text.length;if(currentValue.current===next&&selection.current.start===caret&&selection.current.end===caret)editor.current?.setSelectionRange(caret,caret);});
  return true;
 }
 function erase(){
  const {start,end}=selection.current;if(start!==end){insert('');return;}if(!start)return;
  const segments=Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(currentValue.current.slice(0,start))),previous=segments.at(-1)?.index??Math.max(0,start-1);selection.current={start:previous,end};insert('');
 }
 function textMode(){const caret={...selection.current};flushSync(()=>{setMode('text');setPanel(null);});editor.current?.focus();editor.current?.setSelectionRange(caret.start,caret.end);selection.current=caret;previewKeyboard.show();}
 function previewEdit<T>(action:()=>T){const node=editor.current,caret=node&&node.value===currentValue.current?{start:node.selectionStart,end:node.selectionEnd}:selection.current;node?.focus();selection.current=caret;node?.setSelectionRange(caret.start,caret.end);return action();}
 const obstructed=keyboardOpen||previewKeyboard.open||panel==='emoji',blocked=busy||disabled,inputPlaceholder=/^和.+说点什么[….]*$/.test(placeholder)?'输入消息':placeholder||'输入消息';
 return <div ref={shell} className={`zy-m-composer${obstructed?' is-obstructed':''}${panel==='emoji'?' has-emoji':''}${previewKeyboard.open?' has-preview-keyboard':''}`} style={{bottom:keyboardOpen?Math.max(0,keyboardInset-6):0}} data-composer-state={recording?'recording':panel==='emoji'?'emoji':mode==='voice'?'voice':keyboardOpen||previewKeyboard.open?'keyboard':'text'}>
  <div className="zy-m-compose-controls">
   {error&&<div className="zy-m-compose-error" role="alert"><span>{error}</span>{retryVoice&&<button type="button" disabled={blocked} onClick={()=>void processVoice(retryVoice)}>重试</button>}{microphoneDenied&&window.zhiyuDesktop?.openMicrophoneSettings&&<button type="button" onClick={()=>void window.zhiyuDesktop?.openMicrophoneSettings?.()}>打开麦克风设置</button>}<button type="button" aria-label="关闭发送提示" disabled={busy} onClick={()=>{setError('');setRetryVoice(null);}}><X size={14}/></button></div>}
   {progress&&<div className="zy-m-upload-progress" aria-live="polite">{progress.phase==='uploading'&&progress.total!==null?<MeasuredProgress value={progress.loaded} total={progress.total} label={progress.kind==='audio'?'正在上传语音':'正在上传图片'}/>:<output>{progress.phase==='processing'?(progress.kind==='audio'?'上传完成，正在识别语音…':'上传完成，正在处理图片…'):progress.phase==='preparing'?'正在准备上传…':'正在上传…'}</output>}</div>}
   <div className="zy-m-above-input">{aboveInput}</div>
   {(recording||starting)&&<div className="zy-m-record-guidance" aria-label={starting?'正在开启麦克风':`正在录音 ${recordSeconds} 秒`}><div className={`zy-m-record-target is-cancel${gesture==='cancel'?' is-active':''}`}><span><X size={16}/></span><small>↖ 取消</small></div><output className="zy-m-record-meter"><span className={audioLevel===null?'is-fallback':''} aria-hidden="true">{Array.from({length:8},(_,index)=><i key={index} style={{height:audioLevel===null?`${6+(index%4)*3}px`:`${6+audioLevel*(6+(index%4)*2)}px`,animationDelay:`${index*100}ms`}}/>)}</span><strong>{starting?'…':`${recordSeconds}秒`}</strong></output><div className={`zy-m-record-target is-text${gesture==='text'?' is-active':''}`}><span>文</span><small>转文字 ↗</small></div></div>}
   <form className={`zy-m-compose-capsule${recording?' is-recording':''}`} onSubmit={event=>{event.preventDefault();void sendText();}}>
    <MobileIconButton type="button" className="zy-m-compose-tool" aria-label={mode==='voice'?'切换键盘':'切换语音'} disabled={blocked||recording||starting} onClick={()=>{previewKeyboard.hide();if(mode==='voice'){textMode();return;}if(!allowVoice){setError('当前聊天暂不支持发送语音，可以先发送文字或小表情。');return;}rememberSelection();editor.current?.blur();setPanel(null);setMode('voice');}}>{mode==='voice'?<Keyboard size={23} strokeWidth={1.6}/>:<Mic size={23} strokeWidth={1.6}/>}</MobileIconButton>
    {mode==='voice'?<button type="button" className="zy-m-hold-to-talk" disabled={blocked} aria-label="按住说话，左上滑取消，右上滑转文字" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event=>pointerEnd(event)} onPointerCancel={event=>pointerEnd(event,true)} onLostPointerCapture={event=>{if(held.current?.id===event.pointerId)pointerEnd(event,true);}} onContextMenu={event=>event.preventDefault()}>{starting?'正在开启麦克风…':recording?(gesture==='cancel'?'松开 取消':gesture==='text'?'松开 转文字':'松开 发送'):'按住 说话'}</button>:<div className="zy-m-text-entry">{inputPrefix}<textarea ref={editor} rows={1} value={value} disabled={blocked} aria-label={label} placeholder={inputPlaceholder} maxLength={4000} enterKeyHint="send" onChange={event=>{currentValue.current=event.target.value;onChange(event.target.value);selection.current={start:event.target.selectionStart,end:event.target.selectionEnd};onSelectionChange?.(event.target.value,event.target.selectionStart,event.target.selectionEnd);}} onSelect={rememberSelection} onFocus={()=>{setPanel(null);previewKeyboard.show();}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(!composing.current&&previewOpen.current&&previewActions.current?.handleKey(event.nativeEvent)){event.preventDefault();return;}onEditorKeyDown?.(event);if(event.defaultPrevented)return;if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!composing.current&&!event.nativeEvent.isComposing&&Reflect.get(event.nativeEvent,'keyCode')!==229)void sendText();}if(event.key==='Escape')setPanel(null);}} onPaste={event=>{const files=Array.from(event.clipboardData.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);if(files.length){event.preventDefault();if(!allowImages){setError('当前聊天暂不支持发送图片，可以先发送文字或小表情。');return;}editor.current?.blur();setPasteFiles(files);setPanel('photos');}}}/></div>}
    <MobileIconButton type="button" className="zy-m-compose-tool" aria-label={panel==='emoji'?'切换键盘':'选择表情'} aria-expanded={panel==='emoji'} disabled={blocked||recording||starting} onClick={()=>{previewKeyboard.hide();if(panel==='emoji'){textMode();return;}rememberSelection();editor.current?.blur();setMode('text');setPanel('emoji');}}>{panel==='emoji'?<Keyboard size={23} strokeWidth={1.6}/>:<Smile size={23} strokeWidth={1.6}/>}</MobileIconButton>
    <MobileIconButton type="button" className="zy-m-compose-tool" aria-label="选择图片" disabled={blocked||recording||starting} onClick={()=>{previewKeyboard.hide();if(!allowImages){setError('当前聊天暂不支持发送图片，可以先发送文字或小表情。');return;}rememberSelection();editor.current?.blur();setPasteFiles([]);setPanel('photos');}}><ImagePlus size={23} strokeWidth={1.6}/></MobileIconButton>
   </form>
   {!obstructed&&<p className="zy-m-ai-disclosure">智友由 AI 驱动，可能会出错，重要的事请自己再确认</p>}
  </div>
  {previewKeyboard.open&&<MobilePreviewKeyboard composition={previewComposition} onCompositionChange={changePreviewComposition} actionsRef={previewActions} disabled={blocked} canSend={!!value.trim()} onInsert={text=>previewEdit(()=>insert(text))} onDelete={()=>previewEdit(erase)} onSend={()=>void sendText()} onClose={()=>{previewKeyboard.hide();editor.current?.blur();}}/>}
  {panel==='emoji'&&<MobileEmojiPanel disabled={blocked} allowImages={allowImages} canSend={!!value.trim()} onEmoji={insert} onDelete={erase} onSend={()=>void sendText()} onSticker={file=>sendImages([file],true)}/>}
  {panel==='photos'&&<MobilePhotoPicker host={photoHost} initialFiles={pasteFiles} disabled={disabled} progress={progress?.kind==='image'?progress:null} onClose={()=>{setPanel(null);setPasteFiles([]);}} onSend={sendImages}/>}
 </div>;
}
