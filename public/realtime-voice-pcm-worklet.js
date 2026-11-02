/* Raw mono PCM capture for Zhiyu's realtime voice gateway. No credentials live here. */
class ZhiyuRealtimePcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.step = sampleRate / this.targetRate;
    this.radius = 16;
    this.cutoff = Math.min(1, this.targetRate / sampleRate) * 0.94;
    this.input = Array(this.radius).fill(0);
    this.position = this.radius;
    this.packet = new ArrayBuffer(320 * 2);
    this.packetView = new DataView(this.packet);
    this.packetIndex = 0;
    this.energy = 0;
    this.packetCount = 0;
    this.muted = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'mute') this.muted = Boolean(event.data.muted);
    };
  }

  process(inputs, outputs) {
    // The node stays connected to a silent output so browsers keep processing it.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let mono = 0;
      for (const channel of channels) mono += channel[frame] || 0;
      this.input.push(mono / channels.length);
    }

    // Windowed-sinc low-pass interpolation prevents aliasing when the device
    // runs at 44.1/48 kHz. Fractional position is retained across process blocks.
    while (this.position + this.radius < this.input.length) {
      let value = 0;
      let weightTotal = 0;
      const centre = Math.floor(this.position);
      for (let offset = -this.radius + 1; offset <= this.radius; offset++) {
        const distance = centre + offset - this.position;
        const scaled = distance * this.cutoff;
        const sinc = Math.abs(scaled) < 1e-8 ? 1 : Math.sin(Math.PI * scaled) / (Math.PI * scaled);
        const window = 0.5 + 0.5 * Math.cos(Math.PI * distance / this.radius);
        const weight = sinc * window * this.cutoff;
        value += this.input[centre + offset] * weight;
        weightTotal += weight;
      }
      value = this.muted ? 0 : Math.max(-1, Math.min(1, value / weightTotal));
      this.energy += value * value;
      this.packetView.setInt16(this.packetIndex * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
      this.packetIndex++;
      this.position += this.step;
      if (this.packetIndex === 320) {
        const level = Math.sqrt(this.energy / 320);
        this.port.postMessage({ type: 'pcm', audio: this.packet, level, meter: ++this.packetCount % 5 === 0 }, [this.packet]);
        this.packet = new ArrayBuffer(640);
        this.packetView = new DataView(this.packet);
        this.packetIndex = 0;
        this.energy = 0;
      }
    }
    const consumed = Math.max(0, Math.floor(this.position) - this.radius);
    if (consumed) {
      this.input.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}

registerProcessor('zhiyu-realtime-pcm-capture', ZhiyuRealtimePcmCapture);
