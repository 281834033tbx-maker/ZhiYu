import {qwenLocalReady} from './qwen-audio';
import {localAsrReady} from './local-asr';

export type SpeechProvider='openai'|'doubao'|'local'|'qwen'|'qwen-local';

export function speechProvider():SpeechProvider{
  const selected=process.env.NPC_AUDIO_PROVIDER;
  return selected==='local'||selected==='doubao'||selected==='qwen'||selected==='qwen-local'?selected:'openai';
}

export function audioReady(): boolean {
  if (speechProvider() === 'local') return false;
  if (speechProvider() === 'qwen') return Boolean(
    process.env.DASHSCOPE_API_KEY?.trim()&&process.env.DASHSCOPE_WORKSPACE_ID?.trim(),
  );
  if (speechProvider() === 'qwen-local') return qwenLocalReady();
  return speechProvider() === 'doubao'
    ? Boolean(process.env.DOUBAO_SPEECH_API_KEY?.trim())
    : Boolean(process.env.NPC_AUDIO_API_KEY?.trim());
}

export function asrReady(): boolean {
  return ['local','qwen','qwen-local'].includes(speechProvider())?localAsrReady():audioReady();
}

export function voiceForCharacter(character: string): string {
  if(speechProvider()==='qwen'){
    const selected=character==='xia-xia'?process.env.QWEN_VOICE_XIA_XIA
      :character==='yuan-xiaoman'?process.env.QWEN_VOICE_YUAN
      :character==='liu'?process.env.QWEN_VOICE_LIU:process.env.QWEN_VOICE_MOLLY;
    return selected?.trim()||(character==='yuan-xiaoman'?'longanfengyue':'Cherry');
  }
  if(speechProvider()==='qwen-local'){
    const selected=character==='xia-xia'?process.env.QWEN_LOCAL_SPEAKER_XIA_XIA
      :character==='yuan-xiaoman'?process.env.QWEN_LOCAL_SPEAKER_YUAN
      :character==='liu'?process.env.QWEN_LOCAL_SPEAKER_LIU:process.env.QWEN_LOCAL_SPEAKER_MOLLY;
    return selected?.trim()||(character==='yuan-xiaoman'?'Serena':'Vivian');
  }
  if (speechProvider() === 'doubao') {
    const selected = character === 'xia-xia' ? process.env.DOUBAO_VOICE_XIA_XIA
      : character === 'yuan-xiaoman' ? process.env.DOUBAO_VOICE_YUAN
      : character === 'liu' ? process.env.DOUBAO_VOICE_LIU
      : process.env.DOUBAO_VOICE_MOLLY;
    return selected?.trim() || process.env.DOUBAO_DEFAULT_VOICE?.trim() || 'zh_female_vv_uranus_bigtts';
  }
  return character === 'xia-xia' ? process.env.NPC_VOICE_XIA_XIA || 'coral'
    : character === 'yuan-xiaoman' ? process.env.NPC_VOICE_YUAN || 'nova'
    : character === 'liu' ? process.env.NPC_VOICE_LIU || 'alloy'
    : process.env.NPC_VOICE_MOLLY || 'alloy';
}
