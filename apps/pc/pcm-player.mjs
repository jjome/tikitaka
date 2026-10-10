// OpenAI speech PCM: mono signed 16-bit little endian, 24 kHz.
export class PcmPlayer {
  constructor(context, { onStart, onFinish }) {
    Object.assign(this, { context, onStart, onFinish });
    this.sources = new Set(); this.pending = new Uint8Array(0);
    this.total = 0; this.nextAt = 0; this.started = false; this.ended = false; this.cancelled = false;
  }
  push(chunk) {
    if (this.cancelled) return;
    this.total += chunk.byteLength;
    if (this.total > 3_000_000) throw new Error('AI 음성의 길이를 확인하지 못했습니다.');
    const bytes = new Uint8Array(this.pending.length + chunk.length);
    bytes.set(this.pending); bytes.set(chunk, this.pending.length); this.pending = bytes;
    // Batch tiny network packets; retain odd bytes across packet boundaries.
    if (this.pending.length >= 4800) this.flush();
  }
  flush() {
    const length = this.pending.length - this.pending.length % 2;
    if (!length || this.cancelled) return;
    const view = new DataView(this.pending.buffer, this.pending.byteOffset, length);
    const buffer = this.context.createBuffer(1, length / 2, 24000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    this.pending = this.pending.slice(length);
    const source = this.context.createBufferSource(); source.buffer = buffer;
    source.connect(this.context.destination); this.sources.add(source);
    source.onended = () => {
      source.disconnect(); this.sources.delete(source); this.finishIfReady();
    };
    const at = Math.max(this.nextAt, this.context.currentTime + (this.started ? .02 : .1));
    source.start(at); this.nextAt = at + buffer.duration;
    if (!this.started) { this.started = true; this.onStart(); }
  }
  end() {
    if (!this.total || this.pending.length % 2) throw new Error('AI 음성을 끝까지 받지 못했습니다.');
    this.flush(); this.ended = true; this.finishIfReady();
  }
  finishIfReady() {
    if (!this.cancelled && this.ended && !this.sources.size) {
      this.ended = false; this.onFinish();
    }
  }
  cancel() {
    this.cancelled = true; this.pending = new Uint8Array(0);
    for (const source of this.sources) {
      source.onended = null; try { source.stop(); } catch {} source.disconnect();
    }
    this.sources.clear();
  }
}
