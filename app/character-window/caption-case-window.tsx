'use client';

import {useCallback,useEffect,useState} from 'react';
import {allPeople} from '../zhiyu/data';
import {RealtimeCallCaptions,RealtimeCallTimer} from '../zhiyu/realtime-call-captions';
import RealtimeVoiceControls from '../zhiyu/realtime-voice-controls';
import {AiDisclosure} from '../zhiyu/user-facing-ui';
import XiaomanVideoScene from './xiaoman-video-scene';
import {CAPTION_CASE_ELAPSED_MS,CAPTION_CASE_TEXT,markCaptionCaseLocation,releaseCaptionCaseWindow,type CaptionCaseState} from './caption-case-intent';
import '../zhiyu/desktop-bridge';
import './caption-case-window.css';

export default function CaptionCaseWindow({accountId,preview}:{accountId:string;preview:CaptionCaseState}) {
  const [frame,setFrame]=useState<'loading'|'ready'|'failed'>('loading');
  const [fullscreen,setFullscreen]=useState(false);
  const ready=preview.kind==='ready'&&frame==='ready';
  const person=allPeople.find(item=>item.id==='yuan-xiaoman');
  useEffect(()=>{
    markCaptionCaseLocation();
    const release=()=>releaseCaptionCaseWindow(accountId,preview.kind==='ready'?preview.intent.nonce:undefined);
    window.addEventListener('pagehide',release);window.addEventListener('beforeunload',release);
    return()=>{window.removeEventListener('pagehide',release);window.removeEventListener('beforeunload',release);};
  },[accountId,preview]);
  useEffect(()=>{
    const desktop=window.zhiyuDesktop;if(desktop?.platform!=='darwin')return;
    let active=true;void desktop.getCharacterFullScreen?.().then(value=>{if(active)setFullscreen(value);});
    const unsubscribe=desktop.onCharacterFullScreenChange?.(setFullscreen);
    return()=>{active=false;unsubscribe?.();};
  },[]);
  const onReady=useCallback(()=>setFrame('ready'),[]),onError=useCallback(()=>setFrame('failed'),[]);
  const exit=()=>{releaseCaptionCaseWindow(accountId,preview.kind==='ready'?preview.intent.nonce:undefined);if(window.zhiyuDesktop)window.close();else window.location.replace('/');};
  const message=preview.kind==='unavailable'?{text:preview.reason,tone:'notice' as const}:frame==='failed'?{text:'原视频暂时无法打开，请退出后重试。',tone:'error' as const}:frame==='loading'?{text:'正在准备案例画面…',tone:'notice' as const}:undefined;
  return <main className={`zy-app zy-character-window has-realtime-layout is-call-active${fullscreen?' is-mac-fullscreen':''}`} aria-label={ready?'桌面人物窗口，案例画面已就绪':'桌面人物窗口，正在准备案例画面'} data-caption-case="movie-ending-xiaoman-v1" data-caption-case-ready={ready} data-caption-case-frame={frame}>
    <div className="zy-character-window-titlebar" aria-hidden="true"/>
    <div className="zy-character-window-stage">
      {preview.kind==='ready'&&person?.desktopImage&&<XiaomanVideoScene fallback={person.desktopImage} caseFrame onCaseReady={onReady} onCaseError={onError}/>}
      <section className="zy-realtime-scene" aria-label="与小满人物互动" data-call-state="preview" data-voice-elapsed-ms={CAPTION_CASE_ELAPSED_MS}>
        <RealtimeCallTimer elapsedMs={CAPTION_CASE_ELAPSED_MS} connecting={false} connected/>
        <RealtimeCallCaptions current={ready?{id:'authored-movie-ending-user',role:'user',text:CAPTION_CASE_TEXT}:null} message={message} softenText/>
        <RealtimeVoiceControls muted={false} microphoneReady={false} microphoneAvailable cameraEnabled={false} cameraPending={false} cameraAvailable={false} onToggleMute={()=>{}} onToggleCamera={()=>{}} onHangup={exit}/>
      </section>
      <div className="zy-character-call-disclosure"><AiDisclosure/></div>
    </div>
  </main>;
}
