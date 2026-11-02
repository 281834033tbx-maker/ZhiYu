// The gateway sends raw little-endian 24 kHz, mono PCM. Schedule each block
// on the same clock so playback starts before the full reply has arrived.
export class RealtimePcmPlayer {
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    private readonly onActivity: (playing: boolean) => void,
    private readonly onDrained: () => void,
  ) {}

  get empty() { return this.sources.size === 0; }

  push(bytes: ArrayBuffer) {
    if (this.disposed || !bytes.byteLength) return;
    if (bytes.byteLength % 2 !== 0 || bytes.byteLength > 1024 * 1024)
      throw new Error('收到的语音格式不正确，请重新通话。');
    if (this.nextTime - this.context.currentTime > 30)
      throw new Error('语音播放积压，请检查网络后重新通话。');
    const frames = bytes.byteLength / 2;
    const buffer = this.context.createBuffer(1, frames, 24000);
    const samples = buffer.getChannelData(0);
    const view = new DataView(bytes);
    for (let index = 0; index < frames; index++)
      samples[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size && !this.disposed) {
        this.nextTime = 0;
        this.onActivity(false);
        this.onDrained();
      }
    };
    const wasEmpty = this.empty;
    this.sources.add(source);
    // This short lead absorbs ordinary packet jitter without waiting for a file.
    const at = Math.max(this.nextTime, this.context.currentTime + 0.045);
    this.nextTime = at + buffer.duration;
    source.start(at);
    if (wasEmpty) this.onActivity(true);
  }

  interrupt() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may have just ended. */ }
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
    if (!this.disposed) this.onActivity(false);
  }

  dispose() {
    this.disposed = true;
    this.interrupt();
  }
}
