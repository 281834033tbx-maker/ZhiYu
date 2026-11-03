'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {npcFetch} from './npc-fetch';
import './voice-bubble.css';

function validSeconds(value?:number){return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.ceil(value):null;}
function label(seconds:number|null){return seconds===null?'…':seconds<60?`${seconds}"`:`${Math.floor(seconds/60)}′${String(seconds%60).padStart(2,'0')}″`;}

type Props={src:string;durationSeconds?:number};
export default function VoiceBubble(props:Props){return <VoiceBubbleRecording key={`${props.src}:${props.durationSeconds||''}`} {...props}/>;}
function VoiceBubbleRecording({src,durationSeconds}:Props){
 const audio=useRef<HTMLAudioElement>(null),objectUrl=useRef<string|null>(null),loading=useRef<Promise<string>|null>(null),abort=useRef<AbortController|null>(null);
 const [seconds,setSeconds]=useState<number|null>(()=>validSeconds(durationSeconds));
 const [playing,setPlaying]=useState(false),[failed,setFailed]=useState(false);

 const ensureLoaded=useCallback(():Promise<string>=>{
  if(objectUrl.current)return Promise.resolve(objectUrl.current);
  if(loading.current)return loading.current;
  const controller=new AbortController();abort.current=controller;
  const task=npcFetch(src,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error(`语音读取失败 (${response.status})`);
   const storedSeconds=validSeconds(Number(response.headers.get('X-Zhiyu-Audio-Duration')));
   if(storedSeconds!==null)setSeconds(storedSeconds);
   const blob=await response.blob();
   if(!blob.type.startsWith('audio/')||!blob.size)throw Error('语音文件无效');
   if(controller.signal.aborted)throw new DOMException('已取消','AbortError');
   const url=URL.createObjectURL(blob);objectUrl.current=url;
   if(audio.current){audio.current.src=url;audio.current.load();}
   if(validSeconds(durationSeconds)===null&&storedSeconds===null){
    void (async()=>{let context:AudioContext|undefined;try{context=new AudioContext();const decoded=await context.decodeAudioData(await blob.arrayBuffer());if(!controller.signal.aborted)setSeconds(validSeconds(decoded.duration));}catch{}finally{if(context)void context.close();}})();
   }
   return url;
  }).finally(()=>{if(abort.current===controller)loading.current=null;});
  loading.current=task;return task;
 },[src,durationSeconds]);

 useEffect(()=>{
  const element=audio.current,task=ensureLoaded(),controller=abort.current;
  void task.catch(()=>{if(!controller?.signal.aborted)setFailed(true);});
  return()=>{abort.current?.abort();abort.current=null;element?.pause();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;loading.current=null;};
 // A new URL is a new recording. The download uses npcFetch so the session cookie is ready.
 },[ensureLoaded]);

 function readDuration(){const value=audio.current?.duration;if(value&&Number.isFinite(value))setSeconds(validSeconds(value));}
 function toggle(){
  const element=audio.current;if(!element)return;
  if(!element.paused){element.pause();return;}
  setFailed(false);
  const play=(url:string)=>{
   if(element.src!==url){element.src=url;element.load();}
   void element.play().catch(()=>setFailed(true));
  };
  // Keep play() in the click gesture when the recording is already buffered.
  if(objectUrl.current){play(objectUrl.current);return;}
  void ensureLoaded().then(play).catch(()=>setFailed(true));
 }
 return <div className="voice-bubble-wrap">
  <button type="button" className={'voice-bubble'+(playing?' is-playing':'')} onClick={toggle} aria-label={`${playing?'暂停':'播放'}语音，${seconds===null?'时长加载中':`${seconds}秒`}`} aria-pressed={playing}>
   <span className="voice-bubble-duration">{label(seconds)}</span>
   <svg className="voice-bubble-waves" width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
    <circle className="voice-wave-one" cx="12.7" cy="8.5" r="1.1" fill="currentColor"/>
    <path className="voice-wave-two" d="M9.6 5.4a4.4 4.4 0 0 0 0 6.2" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round"/>
    <path className="voice-wave-three" d="M6.8 2.8a8.1 8.1 0 0 0 0 11.4" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round"/>
   </svg>
  </button>
  {/* Voice-only owner-scoped blobs have no separate caption file. Their real transcript is exposed by the surrounding message’s “转文字” action. */}
  {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Equivalent text is available in MessageActions; do not invent captions for dynamic recordings. */}
  <audio ref={audio} preload="none" onLoadedMetadata={readDuration} onDurationChange={readDuration} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setPlaying(false);setFailed(true);}} />
  {failed&&<span className="voice-bubble-error" role="alert">播放失败，点气泡重试</span>}
 </div>;
}
