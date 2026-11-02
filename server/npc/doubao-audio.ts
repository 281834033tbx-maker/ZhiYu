import {randomUUID} from 'node:crypto';

// Official API references:
// https://docs.volcengine.com/docs/DoubaoVoice/LargemodelrecordingfileLiterecognitionAPI
// https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http
const asrUrl = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const ttsUrl = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

function apiKey(): string {
  const key = process.env.DOUBAO_SPEECH_API_KEY?.trim();
  if (!key) throw Error('豆包语音尚未配置：请填写 DOUBAO_SPEECH_API_KEY 后重启程序');
  return key;
}

function providerError(response: Response, operation: string): Error {
  return Error(response.status === 401 || response.status === 403
    ? `豆包${operation}密钥无效或服务未开通`
    : response.status === 402 || response.status === 429
      ? `豆包${operation}额度或速率受限`
      : `豆包${operation}请求失败（HTTP ${response.status}）`);
}

export async function transcribeDoubao(bytes: Buffer, ext: string): Promise<string> {
  if (!['wav', 'mp3', 'ogg'].includes(ext))
    throw Error('豆包语音识别需要 WAV、MP3 或 OGG 录音，请重新录制');
  const response = await fetch(asrUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey(),
      'X-Api-Resource-Id': process.env.DOUBAO_ASR_RESOURCE_ID || 'volc.bigasr.auc_turbo',
      'X-Api-Request-Id': randomUUID(),
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify({
      user: {uid: 'zhiyu-local'},
      audio: {data: bytes.toString('base64'), format: ext, ...(ext === 'ogg' ? {codec: 'opus'} : {})},
      request: {model_name: 'bigmodel', enable_punc: true, enable_ddc: false},
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw providerError(response, '识别');
  const status = response.headers.get('X-Api-Status-Code');
  if (status && status !== '20000000') {
    if (status === '20000003') throw Error('没有识别到有效语音，请重新录制');
    throw Error(`豆包语音识别失败（状态 ${status}）；请检查服务权限和音频格式`);
  }
  const result = await response.json() as {result?: {text?: unknown}; code?: number | string};
  if (result.code && String(result.code) !== '20000000')
    throw Error(`豆包语音识别失败（状态 ${result.code}）`);
  const text = result.result?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 4000)
    throw Error('没有识别到有效语音，请重新录制');
  return text.trim();
}

export async function synthesizeDoubao(text: string, speaker: string): Promise<Buffer> {
  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey(),
      'X-Api-Resource-Id': process.env.DOUBAO_TTS_RESOURCE_ID || 'seed-tts-2.0',
      'X-Api-Request-Id': randomUUID(),
    },
    body: JSON.stringify({req_params: {text, speaker, audio_params: {format: 'mp3', sample_rate: 24000}}}),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw providerError(response, '合成');
  // HTTP Chunked sends one JSON object per line. The same parser also accepts
  // a single non-streamed JSON object, which is useful for short messages.
  const reader = response.body?.getReader();
  if (!reader) throw Error('豆包语音合成没有返回音频');
  const decoder = new TextDecoder();
  let pending = '', total = 0;
  const audio: Buffer[] = [];
  const consume = (line: string) => {
    const value = line.trim().replace(/^data:\s*/, '');
    if (!value || value === '[DONE]') return;
    let item: {code?: number; message?: string; data?: string};
    try { item = JSON.parse(value); } catch { throw Error('豆包语音合成响应格式无效'); }
    if (item.code !== undefined && item.code !== 0)
      throw Error(`豆包语音合成失败（状态 ${item.code}）；请检查音色 ID 和服务权限`);
    if (item.data) {
      const chunk = Buffer.from(item.data, 'base64');
      total += chunk.length;
      if (total > 12 * 1024 * 1024) throw Error('豆包语音合成音频过大');
      audio.push(chunk);
    }
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      pending += decoder.decode(value, {stream: true});
      if (pending.length > 20 * 1024 * 1024) throw Error('豆包语音合成响应过大');
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, index));
        pending = pending.slice(index + 1);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  } finally { reader.releaseLock(); }
  if (!audio.length) throw Error('豆包语音合成没有返回音频');
  return Buffer.concat(audio);
}
