'use client';

import './realtime-voice-call.css';

export type RealtimeVoiceControlsProps = {
  muted:boolean;
  microphoneReady:boolean;
  cameraEnabled:boolean;
  cameraPending:boolean;
  onToggleMute:()=>void;
  onHangup:()=>void;
  onToggleCamera:()=>void;
};

function MicrophoneIcon({muted}:{muted:boolean}) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {muted?<><path d="M15 9.4V5.5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v2.5a3 3 0 0 0 5.1 2.1"/><path d="M16.9 16.9A7 7 0 0 1 5 11.5v-1"/><path d="M19 10.5v1a7 7 0 0 1-.1 1.2"/><path d="M12 18.5v3"/><path d="M3 3l18 18"/></>:<><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M19 10.5v1a7 7 0 0 1-14 0v-1"/><path d="M12 18.5v3"/></>}
  </svg>;
}

function CameraIcon({enabled}:{enabled:boolean}) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {enabled?<><rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="M16 10.2l4.7-2.9a.6.6 0 0 1 .9.5v8.4a.6.6 0 0 1-.9.5L16 13.8"/></>:<><path d="M7 6h6.5A2.5 2.5 0 0 1 16 8.5v3"/><path d="M16 15.5A2.5 2.5 0 0 1 13.5 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 4 6.2"/><path d="M16 10.2l4.7-2.9a.6.6 0 0 1 .9.5v8.4a.6.6 0 0 1-.9.5L16 13.8"/><path d="M3 3l18 18"/></>}
  </svg>;
}

function HangupIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(135 12 12)"><path fill="currentColor" d="M21 16.4v2.6a2 2 0 0 1-2.2 2 18 18 0 0 1-7.8-2.8 17.7 17.7 0 0 1-5.4-5.4A18 18 0 0 1 2.8 5 2 2 0 0 1 4.8 3h2.6a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8.5 10.4a14.4 14.4 0 0 0 5.4 5.4l1.1-1.1a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2z"/></g></svg>;
}

/** The parent owns permissions, streams and all call state changes. */
export default function RealtimeVoiceControls({muted,microphoneReady,cameraEnabled,cameraPending,onToggleMute,onHangup,onToggleCamera}:RealtimeVoiceControlsProps) {
  return <div className="zy-call-controls" aria-label="视频通话控制" data-call-controls="true">
    <button type="button" className={'zy-call-control'+(muted?' is-lit':'')} data-call-control="microphone"
      aria-label={muted?'打开麦克风':'关闭麦克风'} aria-pressed={!muted} disabled={!microphoneReady} onClick={onToggleMute}>
      <span className="zy-call-control-disc"><MicrophoneIcon muted={muted}/></span>
      <span className="zy-call-control-label">{muted?'麦克风已关':'麦克风已开'}</span>
    </button>
    <button type="button" className="zy-call-control is-hangup" data-call-control="hangup" aria-label="挂断" onClick={onHangup}>
      <span className="zy-call-control-disc"><HangupIcon/></span><span className="zy-call-control-label">挂断</span>
    </button>
    <button type="button" className={'zy-call-control'+(cameraEnabled?' is-lit':'')} data-call-control="camera"
      aria-label={cameraEnabled?'关闭摄像头':'打开摄像头'} aria-pressed={cameraEnabled} aria-busy={cameraPending} disabled={cameraPending} onClick={onToggleCamera}>
      <span className="zy-call-control-disc"><CameraIcon enabled={cameraEnabled}/></span>
      <span className="zy-call-control-label">{cameraPending?'正在打开':cameraEnabled?'摄像头已开':'摄像头已关'}</span>
    </button>
  </div>;
}
