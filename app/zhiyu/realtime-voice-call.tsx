'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RealtimePcmPlayer } from './realtime-voice-audio';
import RealtimeVoiceControls from './realtime-voice-controls';
import type { RealtimeCaption } from '../../lib/npc/realtime-transcript';
import {callCaptionWindowReducer,createCallCaptionWindow,getCallCaptionFrame,callElapsedMs} from '../../lib/npc/realtime-call-presentation';
import {LocalCameraPreview,RealtimeCallCaptions,RealtimeCallEnd,RealtimeCallTimer,type RealtimeCaptionMessage} from './realtime-call-captions';
import './desktop-bridge';
import './realtime-voice-call.css';

type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';
type Transcript = RealtimeCaption;
type Session = {
  closed: boolean;
  ready: boolean;
  outputComplete: boolean;
  playbackAcknowledged: boolean;
  outputTurnId?: string;
  serverState: 'listening' | 'thinking' | 'speaking';
  context?: AudioContext;
  player?: RealtimePcmPlayer;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  capture?: AudioWorkletNode;
  silentOutput?: GainNode;
  socket?: WebSocket;
  prepareAbort?: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
};

export type RealtimeVoiceCallProps = {
  name: string;
  character: string;
  gender?: 'female'|'male';
  authorize: () => Promise<boolean>;
  onCallActiveChange?: (active: boolean) => void;
};

function microphoneError(cause: unknown) {
  if (cause instanceof DOMException) {
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(cause.name))
      return '麦克风权限被拒绝。请允许智域使用麦克风，再重新开启。';
    if (cause.name === 'NotFoundError') return '没有找到麦克风，请检查设备连接。';
    if (cause.name === 'NotReadableError') return '麦克风无法读取，请关闭占用麦克风的程序后重试。';
  }
  return cause instanceof Error ? safeError(cause.message) : '无法开启通话，请重试。';
}

function safeError(message: string) {
  // Gateway errors are already sanitized; redact recognisable credential
  // shapes again before any remotely supplied error is shown in the scene.
  return message.slice(0, 500)
    .replace(/(?:bearer\s+)[\w.+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/(?:access[_ -]?token|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '凭据：[已隐藏]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[已隐藏]')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[已隐藏]');
}

export default function RealtimeVoiceCall({ name, character, gender='female', authorize, onCallActiveChange }: RealtimeVoiceCallProps) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [muted, setMuted] = useState(false);
  const [captionWindow, updateCaptions] = useReducer(callCaptionWindowReducer,undefined,createCallCaptionWindow);
  const [microphoneDenied, setMicrophoneDenied] = useState(false);
  const [readyAt,setReadyAt]=useState<number|null>(null);
  const [endedAt,setEndedAt]=useState<number|null>(null);
  const [now,setNow]=useState(()=>Date.now());
  const [cameraEnabled,setCameraEnabled]=useState(false);
  const [cameraPending,setCameraPending]=useState(false);
  const [cameraError,setCameraError]=useState('');
  const [cameraDenied,setCameraDenied]=useState(false);
  const mounted = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const mutedRef = useRef(false);
  const nextTranscriptId = useRef(0);
  const currentTranscript = useRef<Record<'user' | 'assistant', string | null>>({ user: null, assistant: null });
  const cameraVideo=useRef<HTMLVideoElement>(null);
  const cameraStream=useRef<MediaStream|null>(null);
  const cameraRequest=useRef(0);
  const cameraOpening=useRef(false);
  const startRef=useRef<()=>Promise<void>>(async()=>{});
  const active=state==='connecting'||state==='listening'||state==='thinking'||state==='speaking';
  const ready=active&&state!=='connecting';

  const stopCamera=useCallback(()=>{
    cameraRequest.current++;
    cameraOpening.current=false;
    cameraStream.current?.getTracks().forEach(track=>{track.onended=null;track.stop();});
    cameraStream.current=null;
    if(cameraVideo.current)cameraVideo.current.srcObject=null;
    if(mounted.current){setCameraPending(false);setCameraEnabled(false);}
  },[]);

  const release = useCallback((session: Session, notify = false) => {
    if (session.closed) return;
    session.closed = true;
    session.ready = false;
    if (session.timeout) clearTimeout(session.timeout);
    session.prepareAbort?.abort();
    const socket = session.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (notify && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'finish' })); } catch { /* Already closing. */ }
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        socket.close(1000, 'call ended');
    }
    session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    session.source?.disconnect();
    if (session.capture) {
      session.capture.port.onmessage = null;
      session.capture.port.close();
      session.capture.disconnect();
    }
    session.silentOutput?.disconnect();
    session.player?.dispose();
    if (session.context) {
      session.context.onstatechange = null;
      void session.context.close().catch(() => {});
    }
    if (sessionRef.current === session) {sessionRef.current = null;stopCamera();}
  }, [stopCamera]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sessionRef.current) release(sessionRef.current, true);
      stopCamera();
    };
  }, [release,stopCamera]);

  useEffect(() => {
    // Defer past StrictMode's setup/cleanup probe. The surviving mount starts
    // exactly one session; auth checks and native permission gates still run.
    const timer=setTimeout(()=>void startRef.current(),0);
    return()=>clearTimeout(timer);
  }, []);

  useEffect(()=>{onCallActiveChange?.(state==='idle'||active);},[active,state,onCallActiveChange]);
  useEffect(()=>{
    if(!active)return;
    const timer=setInterval(()=>{const time=Date.now();setNow(time);updateCaptions({type:'tick',now:time});},250);
    return()=>clearInterval(timer);
  },[active]);
  useEffect(()=>{
    if(state==='listening'||state==='thinking'||state==='speaking')updateCaptions({type:'phase',phase:state,now:Date.now()});
  },[state]);
  useEffect(()=>{
    if(!notice)return;
    const timer=setTimeout(()=>setNotice(''),3000);
    return()=>clearTimeout(timer);
  },[notice]);
  useEffect(()=>{
    if(cameraVideo.current&&cameraStream.current){cameraVideo.current.srcObject=cameraStream.current;void cameraVideo.current.play().catch(()=>{});}
  },[cameraEnabled,cameraPending]);

  async function toggleCamera() {
    if(!active||!sessionRef.current||sessionRef.current.closed)return;
    if(cameraStream.current||cameraOpening.current){stopCamera();return;}
    const request=++cameraRequest.current;
    const session=sessionRef.current;
    const current=()=>mounted.current&&request===cameraRequest.current&&sessionRef.current===session&&!session.closed;
    cameraOpening.current=true;setCameraPending(true);setCameraError('');setCameraDenied(false);
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前环境不支持摄像头，请使用智域桌面程序。');
      const permission=await window.zhiyuDesktop?.requestCameraAccess?.();
      if(!current())return;
      if(permission==='denied'||permission==='restricted')throw new DOMException('camera permission denied','NotAllowedError');
      // Camera tracks never enter the audio capture graph or WebSocket. This
      // stream is solely attached to the muted, local mirror preview.
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720},audio:false});
      if(!current()){stream.getTracks().forEach(track=>track.stop());return;}
      cameraStream.current=stream;
      stream.getVideoTracks().forEach(track=>{track.onended=()=>{if(current()){stopCamera();setCameraError('摄像头连接已中断，请检查设备后重试。');}};});
      cameraOpening.current=false;setCameraPending(false);setCameraEnabled(true);
      if(cameraVideo.current){cameraVideo.current.srcObject=stream;void cameraVideo.current.play().catch(()=>{});}
    }catch(cause){
      if(!current())return;
      stopCamera();
      const denied=cause instanceof DOMException&&['NotAllowedError','PermissionDeniedError','SecurityError'].includes(cause.name);
      setCameraDenied(denied);
      setCameraError(denied?'智域没有摄像头权限，请在系统设置里允许后重试':cause instanceof DOMException&&cause.name==='NotFoundError'?'没有找到摄像头，请检查设备连接。':'摄像头无法打开，请关闭占用摄像头的程序后重试。');
    }
  }

  async function start() {
    if (sessionRef.current) return;
    const session: Session = {
      closed: false, ready: false, outputComplete: false, playbackAcknowledged: false, serverState: 'listening',
    };
    sessionRef.current = session;
    const current = () => mounted.current && sessionRef.current === session && !session.closed;
    const fail = (message: string) => {
      if (!current()) return;
      release(session);
      setEndedAt(Date.now());
      setNotice('');
      setError(safeError(message));
      setState('error');
    };
    const acknowledgePlayback = () => {
      if (!current() || !session.ready || !session.outputComplete || !session.player?.empty || session.playbackAcknowledged) return;
      session.playbackAcknowledged = true;
      if (session.socket?.readyState === WebSocket.OPEN)
        session.socket.send(JSON.stringify({ type: 'playback-ended', ...(session.outputTurnId ? { turnId: session.outputTurnId } : {}) }));
      // The gateway owns the turn state. A packet gap or local drain alone
      // must not pretend the assistant has finished the response.
    };
    setState('connecting');
    setError('');
    setNotice('');
    setMicrophoneDenied(false);
    updateCaptions({type:'reset'});
    setReadyAt(null);setEndedAt(null);setNow(Date.now());
    setCameraError('');setCameraDenied(false);stopCamera();
    setMuted(false);
    mutedRef.current = false;
    currentTranscript.current = { user: null, assistant: null };

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined')
        throw new Error('当前环境不支持实时语音，请使用智域桌面程序或最新版浏览器。');
      // Electron permits automatic playback for this trusted character window.
      // A browser with stricter autoplay still receives the existing error path.
      const context = new AudioContext({ latencyHint: 'interactive' });
      session.context = context;
      const resumed = context.resume().then(() => true, () => false);
      // Verify that this window still belongs to the currently signed-in user.
      const authorized = await authorize();
      if (!current()) return;
      if (!authorized) throw new Error('暂时无法确认登录状态，请稍后重试通话。');
      const controller = new AbortController();
      session.prepareAbort = controller;
      const configurationTimeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/npc/realtime-speech/settings', {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        });
        const configuration = await response.json() as { configured?: boolean; error?: string };
        if (!current()) return;
        if (!response.ok) throw new Error(response.status === 401 ? '请先登录智域，再开启通话。' : configuration.error || '无法读取语音设置，请重试。');
        if (!configuration.configured) throw new Error('实时语音尚未配置，请先完成开发者连接配置，再重试通话。');
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError' && current())
          throw new Error('读取语音配置超时，请检查本机服务后重试。');
        throw cause;
      } finally { clearTimeout(configurationTimeout); }
      if (!current()) return;
      const permission = await window.zhiyuDesktop?.requestMicrophoneAccess?.();
      if (!current()) return;
      if (permission === 'denied' || permission === 'restricted') {
        setMicrophoneDenied(true);
        throw new Error('智域没有麦克风权限。请在系统设置中允许智域使用麦克风，然后重试。');
      }
      const audioReady = await resumed;
      if (!current()) return;
      if (!audioReady || context.state !== 'running') throw new Error('声音播放未能开启，请挂断后重新开启通话。');
      await context.audioWorklet.addModule('/realtime-voice-pcm-worklet.js');
      if (!current()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      stream.getAudioTracks().forEach(track => { track.onended = () => fail('麦克风连接已中断，请检查设备后重新通话。'); });
      session.source = context.createMediaStreamSource(stream);
      session.capture = new AudioWorkletNode(context, 'zhiyu-realtime-pcm-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
      });
      session.silentOutput = context.createGain();
      session.silentOutput.gain.value = 0;
      session.source.connect(session.capture);
      session.capture.connect(session.silentOutput);
      session.silentOutput.connect(context.destination);
      session.player = new RealtimePcmPlayer(context, playing => {
        if (current() && session.ready && playing) setState('speaking');
      }, acknowledgePlayback);
      const url = new URL('/api/npc/realtime-speech/call', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('character', character);
      // The dev server's Cloudflare adapter reserves the "vite" prefix for
      // local sockets; the exact HMR protocol remains separate.
      const socket = new WebSocket(url, 'vite-zhiyu-realtime-v1');
      session.socket = socket;
      socket.binaryType = 'arraybuffer';
      session.timeout = setTimeout(() => fail('连接语音服务超时，请检查配置和网络后重试。'), 25000);
      socket.onopen = () => {
        if (current()) socket.send(JSON.stringify({ type: 'start', character }));
      };
      session.capture.port.onmessage = event => {
        if (!current() || !session.ready || socket.readyState !== WebSocket.OPEN || event.data?.type !== 'pcm') return;
        // The worklet also supports silent 20 ms packets if the upstream
        // protocol needs keep-alive audio. The gateway currently owns keep-alive.
        if (mutedRef.current) return;
        if (socket.bufferedAmount > 64000) { fail('语音上传积压，请检查网络后重新通话。'); return; }
        const audio = event.data.audio;
        if (audio instanceof ArrayBuffer && audio.byteLength === 640) socket.send(audio);
      };
      session.capture.onprocessorerror = () => fail('麦克风处理已停止，请重新开启通话。');
      context.onstatechange = () => {
        if (current() && session.ready && context.state === 'suspended')
          fail('声音播放已暂停，请重新开启通话。');
      };
      socket.onmessage = event => {
        if (!current()) return;
        if (event.data instanceof ArrayBuffer) {
          if (!session.ready) return;
          session.outputComplete = false;
          session.playbackAcknowledged = false;
          try { session.player?.push(event.data); } catch (cause) { fail(microphoneError(cause)); }
          return;
        }
        if (typeof event.data !== 'string') return;
        let message: Record<string, unknown>;
        try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { fail('收到的通话消息无法读取，请重新开启。'); return; }
        if (!message || typeof message !== 'object') return;
        if (!session.ready && !['ready', 'error', 'ended', 'notice'].includes(String(message.type))) return;
        if (message.type === 'ready') {
          if ((message.inputSampleRate !== undefined && message.inputSampleRate !== 16000)
            || (message.outputSampleRate !== undefined && message.outputSampleRate !== 24000)
            || (message.channels !== undefined && message.channels !== 1)
            || (message.format !== undefined && message.format !== 'pcm_s16le')) {
            fail('语音服务的音频格式与当前通话不兼容。'); return;
          }
          if (session.timeout) clearTimeout(session.timeout);
          if(!session.ready){const time=Date.now();setReadyAt(time);setNow(time);}
          session.ready = true;
          setState('listening');
        } else if (message.type === 'state' && ['listening', 'thinking', 'speaking'].includes(String(message.state))) {
          session.serverState = message.state as Session['serverState'];
          if (session.ready) setState(session.player?.empty ? session.serverState : 'speaking');
        } else if (message.type === 'audio-end') {
          session.outputComplete = true;
          session.outputTurnId = typeof message.turnId === 'string' || typeof message.turnId === 'number' ? String(message.turnId).slice(0, 100) : undefined;
          acknowledgePlayback();
        } else if (message.type === 'interrupt') {
          const wasSpeaking = session.player?.empty === false || session.serverState === 'speaking';
          session.player?.interrupt();
          session.outputComplete = false;
          session.playbackAcknowledged = false;
          session.outputTurnId = undefined;
          session.serverState = 'listening';
          setState('listening');
          if (wasSpeaking || currentTranscript.current.assistant) updateCaptions({type:'interrupt',now:Date.now()});
          currentTranscript.current.assistant = null;
        } else if (message.type === 'transcript' && (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string') {
          const role = message.role;
          if ((role === 'user' && message.final === true) || (role === 'assistant' && message.text)) setNotice('');
          const turnId = typeof message.turnId === 'string' || typeof message.turnId === 'number' ? String(message.turnId).slice(0, 100) : '';
          const id = turnId ? `${role}-${turnId}` : currentTranscript.current[role] || `${role}-local-${++nextTranscriptId.current}`;
          currentTranscript.current[role] = message.final === true ? null : id;
          const line: Transcript = { id, role, text: message.text.slice(0, 10000), final: message.final === true };
          updateCaptions({type:'transcript',line,now:Date.now()});
        } else if (message.type === 'error') {
          fail(typeof message.message === 'string' ? message.message : '语音服务连接失败，请检查配置后重试。');
        } else if (message.type === 'notice' && typeof message.message === 'string') {
          setNotice(safeError(message.message));
        } else if (message.type === 'ended') {
          release(session);
          setEndedAt(Date.now());
          setState('ended');
        }
      };
      socket.onerror = () => fail('实时语音连接失败，请检查本机服务和网络。');
      socket.onclose = () => fail('实时语音连接已断开，请重新开启通话。');
    } catch (cause) {
      if (current()) {
        if (cause instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(cause.name))
          setMicrophoneDenied(true);
        fail(microphoneError(cause));
      }
    }
  }

  useEffect(()=>{startRef.current=start;});

  function toggleMute() {
    const session = sessionRef.current;
    if (!session?.ready || session.closed) return;
    const next = !mutedRef.current;
    // Flip the upload gate before async React rendering or worklet messages.
    mutedRef.current = next;
    session.stream?.getAudioTracks().forEach(track => { track.enabled = !next; });
    session.capture?.port.postMessage({ type: 'mute', muted: next });
    if (session.socket?.readyState === WebSocket.OPEN)
      session.socket.send(JSON.stringify({ type: 'mute', muted: next }));
    setMuted(next);
  }

  function close() {
    if (sessionRef.current) release(sessionRef.current, true);
    stopCamera();setEndedAt(Date.now());
    mutedRef.current = false;
    setMuted(false);
    setNotice('');
    setState('ended');
  }

  const elapsedMs=callElapsedMs(readyAt,now,endedAt);
  const frame=getCallCaptionFrame(captionWindow);
  let message:RealtimeCaptionMessage|undefined;
  if(error)message={text:error,tone:'error',...(microphoneDenied?{action:{label:'打开系统麦克风设置',onClick:()=>void window.zhiyuDesktop?.openMicrophoneSettings?.()}}:{})};
  else if(cameraError)message={text:cameraError,tone:'error',...(cameraDenied?{action:{label:'打开系统摄像头设置',onClick:()=>void window.zhiyuDesktop?.openCameraSettings?.()}}:{})};
  else if(notice)message={text:notice,tone:'notice'};
  else if(state==='idle'||state==='connecting')message={text:'正在接通…',tone:'notice'};
  return <section className="zy-realtime-scene" aria-label={`与${name}语音互动`} data-call-state={state}>
    {state!=='ended'&&<>
      {(state==='idle'||active)&&<RealtimeCallTimer elapsedMs={elapsedMs} connecting={readyAt===null}/>}
      <LocalCameraPreview visible={cameraEnabled||cameraPending} pending={cameraPending} videoRef={cameraVideo}/>
      <RealtimeCallCaptions {...frame} hidden={message?false:frame.hidden} message={message}/>
      <RealtimeVoiceControls muted={muted} microphoneReady={ready} cameraEnabled={cameraEnabled} cameraPending={cameraPending}
        onToggleMute={toggleMute} onHangup={close} onToggleCamera={()=>void toggleCamera()}/>
    </>}
    <RealtimeCallEnd visible={state==='ended'} elapsedMs={elapsedMs} reconnectLabel={`再打给${gender==='male'?'他':'她'}`} onReconnect={()=>void start()}/>
  </section>;
}
