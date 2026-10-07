import { ActivityGate } from './voice-core.mjs?v=20261002-endpoint2';

export function encodeWav(chunks, rate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const data = new ArrayBuffer(44 + length * 2), view = new DataView(data);
  const word = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return data;
}

export class AudioTurns {
  constructor({ rate, onStart, onTurn, silenceMs = 900, maxMs = 20000 }) {
    Object.assign(this, { rate, onStart, onTurn, silenceMs, maxMs });
    this.gate = new ActivityGate({ threshold: .006, onsetMs: 80, offsetMs: 180,
      onStart: () => {
        if (this.recording) return;
        this.recording = true; this.startedNow = true; this.startedAt = this.now;
        this.chunks = [...this.preRoll]; this.onStart();
      }, onEnd: () => {} });
    this.reset();
  }
  reset() { this.recording = false; this.preRoll = []; this.chunks = []; this.gate.reset(); }
  push(samples, now) {
    const chunk = new Float32Array(samples);
    const rms = Math.sqrt(chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length);
    this.now = now; this.startedNow = false;
    this.preRoll.push(chunk);
    while (this.preRoll.length > Math.ceil(this.rate * .3 / chunk.length)) this.preRoll.shift();
    const active = this.gate.process(rms, now);
    if (active) this.lastActiveAt = now;
    if (this.recording) {
      if (!this.startedNow) this.chunks.push(chunk);
      if (now - this.lastActiveAt >= this.silenceMs || now - this.startedAt >= this.maxMs - 400) {
        const wav = encodeWav(this.chunks, this.rate);
        this.reset(); this.onTurn(wav);
      }
    }
    return rms;
  }
}
