'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { RealtimePcmPlayer } from './realtime-voice-audio';
import './desktop-bridge';
import './realtime-voice-call.css';

type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';
type Transcript = { id: string; role: 'user' | 'assistant'; text: string; final: boolean; interrupted?: boolean };
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
  character: 'yuan-xiaoman';
  authorize: () => Promise<boolean>;
};

const descriptions: Record<CallState, string> = {
  idle: '开启后，直接说话就可以聊天',
  connecting: '正在连接语音服务…',
  listening: '正在听你说话',
  thinking: '正在准备回复',
  speaking: '正在说话，你可以插话',
  ended: '通话已结束',
  error: '通话暂时无法继续',
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

export default function RealtimeVoiceCall({ name, character, authorize }: RealtimeVoiceCallProps) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [muted, setMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [microphoneDenied, setMicrophoneDenied] = useState(false);
  const mounted = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const mutedRef = useRef(false);
  const nextTranscriptId = useRef(0);
  const currentTranscript = useRef<Record<'user' | 'assistant', string | null>>({ user: null, assistant: null });
  const captions = useRef<HTMLDivElement>(null);

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
    if (sessionRef.current === session) sessionRef.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sessionRef.current) release(sessionRef.current, true);
    };
  }, [release]);

  useEffect(() => {
    const element = captions.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [transcripts]);

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
    setTranscripts([]);
    setMuted(false);
    mutedRef.current = false;
    currentTranscript.current = { user: null, assistant: null };

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined')
        throw new Error('当前环境不支持实时语音，请使用智域桌面程序或最新版浏览器。');
      // Construct and resume synchronously in the button's user gesture.
      const context = new AudioContext({ latencyHint: 'interactive' });
      session.context = context;
      const resumed = context.resume().then(() => true, () => false);
      // Resume while the microphone button still owns the user gesture, then
      // verify that this window still belongs to the currently signed-in user.
      const authorized = await authorize();
      if (!current()) return;
      if (!authorized) throw new Error('暂时无法确认登录状态，请稍后再点击麦克风。');
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
        if (!configuration.configured) throw new Error('实时语音尚未配置，请先完成开发者连接配置，再点击麦克风。');
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
      if (!audioReady || context.state !== 'running') throw new Error('声音播放未能开启，请重新点击开启通话。');
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
          const id = currentTranscript.current.assistant;
          if (wasSpeaking || id) setTranscripts(items => {
            const interruptedId = id || [...items].reverse().find(item => item.role === 'assistant')?.id;
            return items.map(item => item.id === interruptedId ? { ...item, final: true, interrupted: true } : item);
          });
          currentTranscript.current.assistant = null;
        } else if (message.type === 'transcript' && (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string') {
          const role = message.role;
          if ((role === 'user' && message.final === true) || (role === 'assistant' && message.text)) setNotice('');
          const turnId = typeof message.turnId === 'string' || typeof message.turnId === 'number' ? String(message.turnId).slice(0, 100) : '';
          const id = turnId ? `${role}-${turnId}` : currentTranscript.current[role] || `${role}-local-${++nextTranscriptId.current}`;
          currentTranscript.current[role] = message.final === true ? null : id;
          const line: Transcript = { id, role, text: message.text.slice(0, 10000), final: message.final === true };
          setTranscripts(items => {
            const exists = items.some(item => item.id === id);
            return (exists ? items.map(item => item.id === id ? { ...item, ...line } : item) : [...items, line]).slice(-80);
          });
        } else if (message.type === 'error') {
          fail(typeof message.message === 'string' ? message.message : '语音服务连接失败，请检查配置后重试。');
        } else if (message.type === 'notice' && typeof message.message === 'string') {
          setNotice(safeError(message.message));
        } else if (message.type === 'ended') {
          release(session);
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
    mutedRef.current = false;
    setMuted(false);
    setNotice('');
    setState('ended');
  }

  const active = state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking';
  const ready = active && state !== 'connecting';
  const microphoneLabel = active ? state === 'connecting' ? '取消语音连接' : '结束语音互动' : '开始语音互动';
  return <section className="zy-realtime-scene" aria-label={`与${name}语音互动`}>
    <div className="zy-realtime-scene-tools">
      {ready && <button type="button" className="zy-realtime-scene-mute" onClick={toggleMute}
        aria-pressed={muted} aria-label={muted ? '取消麦克风静音' : '麦克风静音'} title={muted ? '取消静音' : '静音'}>
        <MicOff size={19} aria-hidden="true"/>
      </button>}
      <button type="button" className={`zy-realtime-scene-microphone${active ? ' is-active' : ''}`}
        aria-label={microphoneLabel} title={microphoneLabel} aria-pressed={active}
        onClick={() => { if (sessionRef.current) close(); else void start(); }}>
        <Mic size={23} aria-hidden="true"/>
      </button>
    </div>
    {state !== 'idle' && <div className="zy-realtime-scene-status">
      <p role="status">{muted && ready ? '麦克风已静音' : descriptions[state]}{active ? ' · 点击麦克风结束' : ''}</p>
      {error && <div className="zy-realtime-scene-error" role="alert">
        <p>{error}</p>
        {microphoneDenied && window.zhiyuDesktop?.openMicrophoneSettings && <button type="button"
          onClick={() => void window.zhiyuDesktop?.openMicrophoneSettings?.()}>打开系统麦克风设置</button>}
      </div>}
      {notice && <p className="zy-realtime-scene-notice" role="status">{notice}</p>}
    </div>}
    {active && transcripts.length > 0 && <div className="zy-realtime-scene-captions" ref={captions}
      role="log" aria-label="双方语音字幕" aria-live="polite" aria-relevant="additions text">
      {transcripts.slice(-4).map(line => <p className={`zy-realtime-scene-caption ${line.role}`} key={line.id}>
        <span>{line.role === 'user' ? '我' : name}{line.interrupted ? ' · 已打断' : ''}</span>{line.text || '…'}
      </p>)}
    </div>}
  </section>;
}
