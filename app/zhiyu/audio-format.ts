// Doubao's recording-file API accepts WAV but not MediaRecorder's WebM output.
// Decode locally, mix to mono and upload 16 kHz PCM without a media server or
// temporary public URL for the user's private recording.
export async function recordedVoiceWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw Error('无法转换录音格式，请换用最新版浏览器后重试');
  } finally {
    await context.close();
  }
  const rate = 16000;
  const frames = Math.ceil(decoded.duration * rate);
  if (!frames || frames > 16000 * 65) throw Error('录音时长无效，请重新录制');
  const offline = new OfflineAudioContext(1, frames, rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([bytes], {type: 'audio/wav'});
}
