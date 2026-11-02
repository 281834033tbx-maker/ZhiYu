import { lstatSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';

const VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const MAX_CONFIG_BYTES = 2048;

export class RealtimeVoiceConfigError extends Error {}

export type XiaomanRealtimeVoiceSettings = { voice: string; speed: number };

// Developer-owned, non-secret configuration. Read for each new call so changing
// the voice or speed does not require touching the API credentials.
export function readXiaomanRealtimeVoiceSettings(root: string, fallbackVoice: string): XiaomanRealtimeVoiceSettings {
  const path = join(root, 'npc-skills/config/xiaoman-realtime-voice.json');
  let stat: Stats;
  try { stat = lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { voice: fallbackVoice, speed: 0 };
    throw new RealtimeVoiceConfigError('小满音色配置无法读取，请检查 xiaoman-realtime-voice.json。');
  }
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new RealtimeVoiceConfigError('小满音色配置文件无效，请检查 xiaoman-realtime-voice.json。');
  }
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch {
    throw new RealtimeVoiceConfigError('小满音色配置无法解析，请检查 xiaoman-realtime-voice.json 的 JSON 格式。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RealtimeVoiceConfigError('小满音色配置应包含有效的 voice 字段。');
  }
  const settings = value as Record<string, unknown>;
  const voice = settings.voice;
  if (typeof voice !== 'string' || !VOICE_PATTERN.test(voice)) {
    throw new RealtimeVoiceConfigError('小满音色配置的 voice 无效，请填写官方音色 ID。');
  }
  // Seeduplex 3.0 uses session.audio.output.speed, with 0 as the default.
  // Keep older voice-only files compatible, but reject malformed speed values.
  const speed = settings.speed === undefined ? 0 : settings.speed;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < -50 || speed > 100) {
    throw new RealtimeVoiceConfigError('小满语速配置的 speed 无效，请填写 -50 到 100 之间的数字。');
  }
  return { voice, speed };
}
