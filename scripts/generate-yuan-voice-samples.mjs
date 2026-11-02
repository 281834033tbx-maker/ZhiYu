import { loadEnv } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = loadEnv('development', process.cwd(), 'NPC_');
const apiKey = env.NPC_AUDIO_API_KEY || process.env.NPC_AUDIO_API_KEY;
if (!apiKey) throw Error('NPC_AUDIO_API_KEY 未配置');

const voice = env.NPC_VOICE_YUAN || 'nova';
const model = env.NPC_TTS_MODEL || 'gpt-4o-mini-tts';
const instructions = 'Speak natural Mandarin Chinese as a cute young adult woman with a slightly mature, warm big-sister voice. Keep the delivery intimate and conversational, never announcer-like. Use light, genuine smiles only where the text calls for it. Make pauses natural; do not overact, rush, or sound childish.';
const samples = [
  ['daily', '我刚到家，鞋都没换就先坐下了。今天走得脚疼。'],
  ['teasing', '我操，他还真好意思。你做的时候不见他，领功倒挺快。'],
  ['warm', '今天辛苦啦。忙完早点找我，我想听你讲讲今天的事。'],
];
const output = join(process.cwd(), 'output', 'voice-samples', 'yuan-xiaoman');
mkdirSync(output, { recursive: true });
for (const [id, text] of samples) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, voice, input: text, instructions, response_format: 'mp3' }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const type = typeof error?.error?.type === 'string' ? error.error.type : 'unknown';
    const code = typeof error?.error?.code === 'string' ? error.error.code : '';
    throw Error(`语音生成失败：${response.status} ${type}${code ? `/${code}` : ''}`);
  }
  writeFileSync(join(output, `${id}.mp3`), Buffer.from(await response.arrayBuffer()));
}
console.log(JSON.stringify({ output, model, voice, samples: samples.map(([id, text]) => ({ id, text })) }));
