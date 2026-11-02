import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import NodeWebSocket, { WebSocketServer, type RawData } from 'ws';
import { readRealtimeSpeechConfig, type RealtimeSpeechConfig } from './realtime-speech-settings';
import { readXiaomanRealtimeVoiceSettings, RealtimeVoiceConfigError } from './realtime-speech-voice';
import { REALTIME_INITIAL_PAYLOAD_BYTES, REALTIME_PROVIDER_CONTEXT_TOKENS, realtimeHistoryBudget, realtimeInstructions } from './realtime-speech-budget';
import { RealtimeInputTranscriptAssembler } from '../../lib/npc/realtime-transcript';

const CALL_PATH = '/api/npc/realtime-speech/call';
const LOCAL_PROTOCOL = 'vite-zhiyu-realtime-v1';
const CHARACTER = 'yuan-xiaoman';
const UPSTREAM_URL = 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
const MAX_CALL_MS = 15 * 60 * 1000;
const MAX_UPSTREAM_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 128 * 1024;

export type RealtimeSpeechContext = {
  botName: string;
  systemRole: string;
  speakingStyle: string;
  dialogContext?: Array<{ role: 'user' | 'assistant'; text: string; timestamp?: number }>;
  audit?: {
    skillVersion?: string;
    skillRulesHash?: string;
    skillRulesBytes?: number;
    memorySourceCount?: number;
    memoryIncludedCount?: number;
    historyIncludedPairs?: number;
    historyAvailablePairs?: number;
    stateFound?: boolean;
  };
};

type GatewayOptions = {
  loadContext: (root: string, ownerId: string) => RealtimeSpeechContext | Promise<RealtimeSpeechContext>;
  recordEvent?: (root: string, ownerId: string, callId: string, event: Record<string, unknown>) => void | Promise<void>;
};

type ActiveCall = { finish: () => void; dispose: () => void };
class CallContextError extends Error {}

function textHash(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function contextAuditMetadata(metadata: RealtimeSpeechContext['audit']) {
  const result: Record<string, string | number | boolean> = {};
  if (!metadata) return result;
  if (typeof metadata.skillVersion === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(metadata.skillVersion)) {
    result.skillVersion = metadata.skillVersion;
  }
  if (typeof metadata.skillRulesHash === 'string' && /^[a-f0-9]{64}$/i.test(metadata.skillRulesHash)) {
    result.skillRulesHash = metadata.skillRulesHash;
  }
  for (const key of ['skillRulesBytes', 'memorySourceCount', 'memoryIncludedCount', 'historyIncludedPairs', 'historyAvailablePairs'] as const) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  if (typeof metadata.stateFound === 'boolean') result.stateFound = metadata.stateFound;
  return result;
}

function appendContextAudit(root: string, entry: Record<string, unknown>) {
  try {
    const directory = join(root, '.npc-runtime');
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'realtime-speech-context-audit.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch {
    // Audit persistence must never interrupt a call or reveal raw exceptions.
  }
}

function rawBuffer(data: RawData): Buffer {
  return Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function providerFailure(event: Record<string, unknown>) {
  const detail = object(event.error);
  const rawCode = detail.code ?? detail.status_code ?? event.code ?? event.status_code;
  const code = typeof rawCode === 'number' && Number.isSafeInteger(rawCode) ? String(rawCode)
    : typeof rawCode === 'string' && /^[A-Za-z0-9_:.-]{1,96}$/.test(rawCode) ? rawCode : undefined;
  // Classify only the diagnostic prefix; provider messages can echo private
  // request contents. Neither those messages nor the request are persisted.
  const rawMessage = detail.message ?? event.message;
  const diagnostic = typeof rawMessage === 'string' ? rawMessage.slice(0, 256) : '';
  const contextLimit = /(?:context_(?:length|limit|window)_exceeded|token_limit_exceeded|(?:prompt|input|instructions)_too_long)/i.test(code ?? '')
    || /(?:(?:context|prompt|input|instructions?)[ _-]?(?:length|tokens?|size)[^\n]{0,60}(?:exceed|too (?:long|large)|over (?:the )?limit)|(?:context|prompt|input|instructions?)\s+too (?:long|large)|too many tokens|(?:exceed|too (?:long|large))[^\n]{0,60}(?:context|prompt|token)|(?:上下文|提示词|指令)[^\n]{0,30}(?:超限|超过|过长))/i.test(diagnostic);
  return { code, category: contextLimit ? 'context-limit' : 'request-failed', message: contextLimit
    ? '这次聊天资料超过语音服务的容量，请联系开发者调整。'
    : '语音服务暂时无法继续，请稍后重试。' };
}

function ownerFor(req: IncomingMessage, db: DatabaseSync): string | null {
  const token = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith('zhiyu_auth='))?.slice('zhiyu_auth='.length);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const digest = createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT a.owner_id, s.expires_at FROM zhiyu_auth_sessions s
    JOIN zhiyu_accounts a ON a.id=s.account_id WHERE s.token_digest=?`)
    .get(digest) as { owner_id: string; expires_at: number } | undefined;
  return row && row.expires_at > Date.now() ? row.owner_id : null;
}

function validOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host)) return false;
  try { return req.headers.origin === new URL(`http://${host}`).origin; }
  catch { return false; }
}

function rejectUpgrade(socket: Duplex, status: number) {
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 409 ? 'Conflict' : 'Bad Request';
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function sessionPayload(context: RealtimeSpeechContext, config: RealtimeSpeechConfig & { speed: number }) {
  const instructions = realtimeInstructions(context.systemRole, context.speakingStyle);
  const dialogContext: NonNullable<RealtimeSpeechContext['dialogContext']> = [];
  let contextChars = 0;
  const historyBudget = realtimeHistoryBudget();
  const incoming = context.dialogContext ?? [];
  // The API requires complete user/assistant pairs. Preserve the newest pairs
  // and a bounded text budget; never upload audio or unrelated characters.
  for (let i = incoming.length - 2; i >= 0; i -= 2) {
    const user = incoming[i];
    const assistant = incoming[i + 1];
    if (user?.role !== 'user' || assistant?.role !== 'assistant') continue;
    const userText = user.text;
    const assistantText = assistant.text;
    if (contextChars + userText.length + assistantText.length > historyBudget) continue;
    contextChars += userText.length + assistantText.length;
    dialogContext.unshift(
      { role: 'user', text: userText, ...(Number.isFinite(user.timestamp) ? { timestamp: user.timestamp } : {}) },
      { role: 'assistant', text: assistantText, ...(Number.isFinite(assistant.timestamp) ? { timestamp: assistant.timestamp } : {}) },
    );
  }
  const payload = {
    type: 'session.create',
    event_id: randomUUID(),
    session: {
      model: '1.2.6.1',
      instructions,
      audio: {
        input: { format: { type: 'pcm', rate: 16000 } },
        output: { format: { type: 'pcm_s16le', rate: 24000 }, voice: config.voice, speed: config.speed },
      },
    },
    extension: { asr: {}, tts: {}, dialog: dialogContext.length ? { dialog_context: dialogContext } : {} },
  };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > REALTIME_INITIAL_PAYLOAD_BYTES) {
    throw new CallContextError('小满通话资料过大，请联系开发者调整后重试。');
  }
  return payload;
}

function attachCall(client: NodeWebSocket, root: string, ownerId: string, config: RealtimeSpeechConfig,
  options: GatewayOptions, released: () => void): ActiveCall {
  const callId = randomUUID();
  const ownerHash = textHash(ownerId).slice(0, 16);
  let sentInstructionsHash: string | undefined;
  const audit = (event: Record<string, unknown>) => appendContextAudit(root, {
    at: new Date().toISOString(), callId, ownerHash, ...event,
  });
  let upstream: NodeWebSocket | undefined;
  let starting = false;
  let ready = false;
  let ending = false;
  let disposed = false;
  let muted = false;
  let lastPong = Date.now();
  let lastInput = Date.now();
  let audioCredit = 64000;
  let audioCreditAt = Date.now();
  let messageWindow = Date.now();
  let messageCount = 0;
  let state: 'listening' | 'thinking' | 'speaking' = 'listening';
  // The provider's delta label does not distinguish every interim hypothesis
  // shape. Use conservative three-hypothesis compatibility for unmarked input;
  // explicit whole-text fields/results remain authoritative snapshots.
  const inputTranscripts=new RealtimeInputTranscriptAssembler(randomUUID,'auto');
  let assistantText = '';
  let responseId: string | undefined;
  let audioDelivered = false;
  let audioCompleted = false;
  const canceledResponses = new Set<string>();
  let dropPendingResponse = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let endedRecorded = false;
  let historyWarningSent = false;
  let historyQueue = Promise.resolve();

  const send = (event: Record<string, unknown>) => {
    if (client.readyState === NodeWebSocket.OPEN) client.send(JSON.stringify(event));
  };
  const sendUpstream = (event: Record<string, unknown>) => {
    if (upstream?.readyState === NodeWebSocket.OPEN) upstream.send(JSON.stringify({ event_id: randomUUID(), ...event }));
  };
  const record = (event: Record<string, unknown>) => {
    if (!options.recordEvent) return;
    historyQueue = historyQueue.then(() => options.recordEvent!(root, ownerId, callId, event)).then(() => undefined).catch(() => {
      if (!historyWarningSent && !ending) {
        historyWarningSent = true;
        send({ type: 'notice', message: '本地通话记录暂时无法保存。' });
      }
    });
  };
  const recordEnded = () => {
    if (endedRecorded) return;
    endedRecorded = true;
    record({ type: 'ended' });
  };
  const setState = (next: typeof state) => {
    if (state === next) return;
    state = next;
    send({ type: 'state', state });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ending = true;
    recordEnded();
    clearTimeout(startupTimer);
    clearTimeout(finishTimer);
    clearTimeout(callLimit);
    clearInterval(heartbeat);
    upstream?.terminate();
    if (client.readyState !== NodeWebSocket.CLOSED) client.terminate();
    released();
  };
  const finish = (message?: string) => {
    if (ending || disposed) return;
    ending = true;
    ready = false;
    clearTimeout(startupTimer);
    if (message) send({ type: 'error', message });
    send({ type: 'ended' });
    recordEnded();
    if (upstream?.readyState === NodeWebSocket.OPEN) {
      sendUpstream({ type: 'session.close' });
      finishTimer = setTimeout(dispose, 2000);
    } else {
      dispose();
    }
    if (client.readyState === NodeWebSocket.OPEN) client.close(1000, 'Call ended');
  };
  const callLimit = setTimeout(() => finish('本次通话已达到 15 分钟，请重新开始。'), MAX_CALL_MS);
  const heartbeat = setInterval(() => {
    if (ending || disposed) return;
    const now = Date.now();
    if (now - lastPong > 45000 || (ready && now - lastInput > (muted ? 5 * 60 * 1000 : 30000))) {
      return finish('通话连接已超时，请重新开始。');
    }
    try { client.ping(); } catch { finish(); }
  }, 15000);
  const startupTimer = setTimeout(() => finish('通话启动超时，请重新开始。'), 15000);

  const updateAssistant = (text: string, final: boolean, turnId?: string) => {
    if (turnId && canceledResponses.has(turnId)) return;
    if (turnId && turnId !== responseId) {
      responseId = turnId;
      assistantText = '';
      audioDelivered = false;
      audioCompleted = false;
      dropPendingResponse = false;
    }
    responseId ??= randomUUID();
    if ((turnId && canceledResponses.has(turnId)) || dropPendingResponse) return;
    assistantText = (final ? text : assistantText + text).slice(0, 12000);
    const event = { type: 'transcript', role: 'assistant', text: assistantText, final, turnId: responseId };
    send(event);
    if (final) record(event);
  };

  const onProviderEvent = (event: Record<string, unknown>) => {
    const type = event.type;
    const turnId = identifier(event.response_id);
    if (ending) {
      if (type === 'session.closed') dispose();
      return;
    }
    if (type === 'session.created') {
      const echoedInstructions = object(event.session).instructions;
      const echoPresent = typeof echoedInstructions === 'string';
      const echoHash = echoPresent ? textHash(echoedInstructions) : undefined;
      audit({
        event: 'session-created',
        echoPresent,
        echoMatches: echoPresent && sentInstructionsHash ? echoHash === sentInstructionsHash : 'unknown',
        ...(echoHash ? { echoHash } : {}),
      });
      ready = true;
      lastInput = Date.now();
      clearTimeout(startupTimer);
      send({ type: 'ready', callId, inputSampleRate: 16000, outputSampleRate: 24000, channels: 1, format: 'pcm_s16le' });
      send({ type: 'state', state: 'listening' });
      if (muted) sendUpstream({ type: 'input_audio_mute.commit' });
      return;
    }
    if (type === 'session.closed') return finish();
    if (type === 'error') {
      // Provider errors may contain request payloads. Never forward them.
      const failure = providerFailure(event);
      audit({ event: 'provider-error', category: failure.category, ...(failure.code ? { code: failure.code } : {}) });
      return finish(failure.message);
    }
    if (type === 'conversation.item.input_audio_transcription.started') {
      const started=inputTranscripts.start(identifier(event.item_id),identifier(event.event_id));
      if(!started.fresh)return;
      if (state === 'speaking' || state === 'thinking') {
        if (responseId) canceledResponses.add(responseId);
        if (canceledResponses.size > 64) canceledResponses.delete(canceledResponses.values().next().value!);
        dropPendingResponse = true;
        audioCompleted = false;
        sendUpstream({ type: 'response.cancel' });
      }
      send({ type: 'interrupt' });
      record({ type: 'interrupt', turnId: responseId });
      setState('listening');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.delta' || type === 'conversation.item.input_audio_transcription.result') {
      const snapshot=typeof event.transcript==='string'?event.transcript:typeof event.text==='string'?event.text:undefined;
      const partial=inputTranscripts.update({kind:snapshot!==undefined||type.endsWith('.result')?'snapshot':'delta',
        itemId:identifier(event.item_id),eventId:identifier(event.event_id),text:snapshot??(typeof event.delta==='string'?event.delta:undefined)});
      if(partial)send(partial);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const completed=inputTranscripts.update({kind:'complete',itemId:identifier(event.item_id),eventId:identifier(event.event_id),
        text:typeof event.transcript==='string'?event.transcript:typeof event.text==='string'?event.text:undefined});
      if(!completed)return;
      send(completed);
      record(completed);
      if (state !== 'speaking'&&completed.turnId===inputTranscripts.currentTurnId) setState('thinking');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.failed') {
      inputTranscripts.fail(identifier(event.item_id));
      send({ type: 'notice', message: '这句话没听清，请再说一次。' });
      setState('listening');
      return;
    }
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') return updateAssistant(event.delta, false, turnId);
    if (type === 'response.output_text.done' && typeof event.text === 'string') return updateAssistant(event.text, true, turnId);
    if (type === 'response.output_audio.started') {
      if (turnId && canceledResponses.has(turnId)) return;
      if (turnId && turnId !== responseId) {
        responseId = turnId; assistantText = ''; dropPendingResponse = false; audioDelivered = false; audioCompleted = false;
      }
      if ((turnId && canceledResponses.has(turnId)) || dropPendingResponse) return;
      setState('speaking');
      return;
    }
    if (type === 'response.output_audio.delta') {
      if (turnId && canceledResponses.has(turnId)) return;
      if (turnId && turnId !== responseId) {
        responseId = turnId; assistantText = ''; dropPendingResponse = false; audioDelivered = false; audioCompleted = false;
      }
      if ((turnId && canceledResponses.has(turnId)) || dropPendingResponse) return;
      responseId ??= randomUUID();
      if (typeof event.delta !== 'string' || event.delta.length > MAX_UPSTREAM_MESSAGE_BYTES
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.delta) || event.delta.length % 4 !== 0) {
        return finish('实时语音音频格式异常，请重新开始。');
      }
      const pcm = Buffer.from(event.delta, 'base64');
      if (!pcm.length) return;
      if (pcm.length % 2 !== 0 || client.bufferedAmount > MAX_BUFFERED_BYTES) return finish('语音播放连接异常，请重新开始。');
      setState('speaking');
      audioDelivered = true;
      client.send(pcm, { binary: true });
      return;
    }
    // response.done is a usage/interaction event, not proof that this audio
    // response has finished. A late canceled turn must not finish a new one.
    if (type === 'response.done') return;
    if (type === 'response.output_audio.done') {
      if (!turnId || turnId !== responseId) return;
      if ((turnId && canceledResponses.has(turnId)) || dropPendingResponse) return;
      if (audioDelivered) {
        audioCompleted = true;
        send({ type: 'audio-end', turnId: turnId ?? responseId });
      } else {
        setState('listening');
      }
      return;
    }
    if (type === 'response.canceled') {
      // The local interrupt was emitted when cancellation was requested.
      // A late acknowledgement must not flush a subsequent response.
      return;
    }
  };

  const start = async () => {
    if (starting || ready || ending) return;
    starting = true;
    const context = await options.loadContext(root, ownerId);
    if (ending || disposed) return;
    const voiceSettings = readXiaomanRealtimeVoiceSettings(root, config.voice);
    const payload = sessionPayload(context, { ...config, ...voiceSettings });
    sentInstructionsHash = textHash(payload.session.instructions);
    const sentHistory = object(payload.extension.dialog).dialog_context;
    audit({
      event: 'context-built',
      instructionsChars: payload.session.instructions.length,
      instructionsHash: sentInstructionsHash,
      initialPayloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      providerContextTokenLimit: REALTIME_PROVIDER_CONTEXT_TOKENS,
      providerTokensMeasured: false,
      voice: voiceSettings.voice,
      speed: voiceSettings.speed,
      historySentPairs: Array.isArray(sentHistory) ? sentHistory.length / 2 : 0,
      metadata: contextAuditMetadata(context.audit),
    });
    upstream = new NodeWebSocket(UPSTREAM_URL, {
      headers: { 'X-Api-Key': config.apiKey },
      handshakeTimeout: 10000,
      maxPayload: MAX_UPSTREAM_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    upstream.on('open', () => {
      if (ending) return dispose();
      upstream!.send(JSON.stringify(payload), error => {
        if (error) return finish('实时语音上下文未能发送，请重新开始。');
        audit({
          event: 'context-sent',
          instructionsHash: sentInstructionsHash,
          historySentPairs: Array.isArray(sentHistory) ? sentHistory.length / 2 : 0,
        });
      });
    });
    upstream.on('message', (data, isBinary) => {
      try {
        if (isBinary) return finish('实时语音服务返回了不支持的协议。');
        const bytes = rawBuffer(data);
        if (bytes.length > MAX_UPSTREAM_MESSAGE_BYTES) return finish('实时语音服务返回内容过长。');
        onProviderEvent(object(JSON.parse(bytes.toString('utf8'))));
      } catch { finish('实时语音数据处理失败，请重新开始。'); }
    });
    upstream.on('error', () => finish('豆包实时语音连接失败，请确认 API Key 权限、额度和网络连接。'));
    upstream.on('close', () => ending ? dispose() : finish('豆包实时语音连接已断开，请重新开始。'));
    upstream.on('unexpected-response', (_request: unknown, response: IncomingMessage) => {
      response.resume();
      finish('豆包实时语音拒绝了连接，请确认 API Key 已开通实时语音权限。');
    });
  };

  client.on('pong', () => { lastPong = Date.now(); });
  client.on('close', () => finish());
  client.on('error', () => finish());
  client.on('message', (data, isBinary) => {
    if (ending || disposed) return;
    try {
      const now = Date.now();
      if (now - messageWindow >= 1000) { messageWindow = now; messageCount = 0; }
      if (++messageCount > 160) return finish('音频发送过快，请重新开始。');
      const bytes = rawBuffer(data);
      if (isBinary) {
        if (!ready || muted) return;
        if (bytes.length < 2 || bytes.length > 3200 || bytes.length % 2) return finish('麦克风音频格式异常。');
        audioCredit = Math.min(64000, audioCredit + (now - audioCreditAt) * 40);
        audioCreditAt = now;
        if (bytes.length > audioCredit || !upstream || upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
          return finish('音频传输拥堵，请重新开始。');
        }
        audioCredit -= bytes.length;
        lastInput = now;
        sendUpstream({ type: 'input_audio_buffer.append', audio: bytes.toString('base64') });
        return;
      }
      if (bytes.length > 4096) return finish('通话请求内容过长。');
      const event = object(JSON.parse(bytes.toString('utf8')));
      if (event.type === 'start' && (event.character === undefined || event.character === CHARACTER)) {
        void start().catch(error => finish(error instanceof CallContextError || error instanceof RealtimeVoiceConfigError
          ? error.message : '小满通话启动失败，请稍后重试。'));
      } else if (event.type === 'finish' || event.type === 'end') {
        finish();
      } else if (event.type === 'mute' && typeof event.muted === 'boolean') {
        if (muted !== event.muted) {
          muted = event.muted;
          lastInput = now;
          if (ready) sendUpstream({ type: muted ? 'input_audio_mute.commit' : 'input_audio_unmute.commit' });
        }
      } else if (event.type === 'playback-ended' && ready) {
        if (audioDelivered && audioCompleted && state === 'speaking' && (!event.turnId || event.turnId === responseId)) {
          record({ type: 'playback-ended', turnId: identifier(event.turnId) ?? responseId });
          setState('listening');
        }
      } else {
        finish('通话控制请求无效。');
      }
    } catch { finish('通话数据处理失败，请重新开始。'); }
  });
  return { finish: () => finish(), dispose };
}

export function npcRealtimeSpeechGateway(options: GatewayOptions): Plugin {
  return {
    name: 'zhiyu-realtime-speech-gateway',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const httpServer = server.httpServer;
      if (!httpServer) return;
      const db = new DatabaseSync(join(root, '.npc-runtime/state.sqlite'), { readOnly: true });
      const calls = new Map<string, ActiveCall>();
      const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false, clientTracking: false });
      const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        let url: URL;
        try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { return; }
        if (url.pathname !== CALL_PATH) return;
        try {
          // Cloudflare's development adapter skips the reserved vite prefix;
          // Vite HMR only handles its own exact protocols. Without this local
          // subprotocol the adapter also consumes and destroys our upgrade.
          if (req.headers['sec-websocket-protocol'] !== LOCAL_PROTOCOL) return rejectUpgrade(socket, 400);
          if (!validOrigin(req)) return rejectUpgrade(socket, 403);
          const ownerId = ownerFor(req, db);
          if (!ownerId) return rejectUpgrade(socket, 401);
          if (url.searchParams.get('character') !== CHARACTER) return rejectUpgrade(socket, 400);
          if (calls.has(ownerId)) return rejectUpgrade(socket, 409);
          const config = readRealtimeSpeechConfig(root);
          if (!config) return rejectUpgrade(socket, 400);
          sockets.handleUpgrade(req, socket, head, client => {
            const call = attachCall(client, root, ownerId, config, options, () => {
              if (calls.get(ownerId) === call) calls.delete(ownerId);
            });
            calls.set(ownerId, call);
          });
        } catch { rejectUpgrade(socket, 400); }
      };
      httpServer.on('upgrade', upgrade);
      httpServer.once('close', () => {
        httpServer.off('upgrade', upgrade);
        for (const call of calls.values()) call.dispose();
        calls.clear();
        sockets.close();
        db.close();
      });
    },
  };
}
