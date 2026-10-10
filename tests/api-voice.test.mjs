import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiVoice } from '../apps/pc/api-voice.mjs';
import { AudioTurns, encodeWav } from '../apps/pc/audio-turns.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('PCM speech captures its beginning, ends once after silence, and excludes idle silence', () => {
  const clips = []; let starts = 0, now = 0;
  const turns = new AudioTurns({ rate: 48000, onStart: () => starts++, onTurn: wav => clips.push(wav) });
  const frames = (level, count) => { for (let i = 0; i < count; i++) turns.push(new Float32Array(2048).fill(level), now += 2048 / 48); };
  frames(0, 15); assert.equal(clips.length, 0);
  frames(.02, 12); frames(0, 40);
  assert.equal(starts, 1); assert.equal(clips.length, 1); assert.equal(turns.recording, false);
  const view = new DataView(clips[0]);
  assert.equal(view.getUint32(24, true), 48000);
  const samples = Array.from({ length: (clips[0].byteLength - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
  assert.equal(samples.filter(value => value > 0).length, 12 * 2048);
});

test('long continuous input is split into bounded clips', () => {
  const clips = []; let now = 0;
  const turns = new AudioTurns({ rate: 48000, onStart() {}, onTurn: wav => clips.push(wav) });
  for (let i = 0; i < 1200; i++) turns.push(new Float32Array(2048).fill(.02), now += 2048 / 48);
  assert.ok(clips.length >= 2);
  assert.ok(clips.every(clip => (clip.byteLength - 44) / 2 / 48000 <= 21));
});

test('WAV encoding clamps PCM without wrapping its sign', () => {
  const view = new DataView(encodeWav([new Float32Array([-2, 0, 2])], 16000));
  assert.equal(view.getInt16(44, true), -32768); assert.equal(view.getInt16(48, true), 32767);
});

function fixture() {
  const names = ['window', 'navigator', 'AudioContext', 'AudioWorkletNode', 'fetch', 'performance'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let now = 0, stopped = 0, node;
  const outputs = [], requests = [], texts = [], events = [], errors = [];
  const track = { label: 'Fixture', kind: 'audio', readyState: 'live', enabled: true, muted: false, stop() { stopped++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const link = () => ({ connect() {}, disconnect() {} });
  class Context {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.audioWorklet = { async addModule() {} }; }
    async resume() {} async close() {} async decodeAudioData() { return {}; }
    createMediaStreamSource() { return link(); }
    createGain() { return { ...link(), gain: { value: 0 } }; }
    createBuffer(channels, length, rate) { const samples = new Float32Array(length); return { duration: length / rate, getChannelData: () => samples }; }
    createBufferSource() { const output = { ...link(), start() { events.push('play'); }, stop() { events.push('stop'); } }; outputs.push(output); return output; }
  }
  class Worklet { constructor() { node = this; this.port = { close() {} }; } connect() {} disconnect() {} }
  const globals = {
    window: { AudioContext: Context, AudioWorkletNode: Worklet }, AudioContext: Context, AudioWorkletNode: Worklet,
    navigator: { mediaDevices: { getUserMedia() {} } }, performance: { now: () => now },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ text: '준호, 겨울이 더 좋아' }), arrayBuffer: async () => new ArrayBuffer(8) };
    },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const voice = new ApiVoice({ captureMicrophone: async () => stream, onStart: () => events.push('user'), onActivity() {},
    onText: text => texts.push(text), onPreview() {}, onEmpty() {}, onError: error => errors.push(error), onLevel() {}, onStatus() {} });
  voice.session = { id: 'test-session', token: 'session-token' };
  return { voice, requests, outputs, texts, events, errors, stopped: () => stopped,
    frames(level, count) { for (let i = 0; i < count; i++) { now += 2048 / 48; node.port.onmessage?.({ data: new Float32Array(2048).fill(level) }); } },
    cleanup() { voice.stop(); for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    } },
  };
}

test('without SpeechRecognition, PCM speech interrupts actual playback then commits one API transcript', async () => {
  const f = fixture();
  try {
    await f.voice.start('ko'); assert.equal(f.voice.running, true);
    let finished = 0;
    await f.voice.play({ id: 'a1', speaker: 'a' }, () => finished++, error => f.errors.push(error));
    const lateEnd = f.outputs[0].onended;
    f.frames(0, 10); f.frames(.02, 12);
    assert.ok(f.events.indexOf('stop') < f.events.indexOf('user'));
    lateEnd(); assert.equal(finished, 0);
    f.frames(0, 40); await tick(); await tick();
    assert.deepEqual(f.texts, ['준호, 겨울이 더 좋아']); assert.equal(f.voice.userSpeaking, false);
    assert.equal(f.requests.filter(request => request.url.endsWith('/transcriptions')).length, 1);
    assert.equal(f.requests.at(-1).options.headers['X-Session-Token'], 'session-token');
    assert.deepEqual(f.errors, []);
    f.voice.stop(); assert.equal(f.stopped(), 1);
  } finally { f.cleanup(); }
});

test('streaming API plays before download completion, and interruption cancels queued audio and read', async () => {
  const f = fixture(); let controller, finished = 0;
  const body = new ReadableStream({ start(c) { controller = c; c.enqueue(new Uint8Array(4800)); } });
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'audio/pcm' }), body });
  try {
    await f.voice.start('ko');
    const pending = f.voice.play({ id: 'a1' }, () => finished++, error => f.errors.push(error));
    await tick();
    assert.equal(f.outputs.length, 1); // EOF has not arrived yet.
    f.frames(.02, 12);
    assert.equal(f.voice.pcm, null);
    assert.ok(f.events.includes('stop'));
    controller.enqueue(new Uint8Array(4800)); controller.close(); await pending;
    assert.equal(f.outputs.length, 1); assert.equal(finished, 0); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('failed partial audio stops scheduled speech and cannot report successful playback', async () => {
  const f = fixture(); let controller, finished = 0;
  const body = new ReadableStream({ start(c) { controller = c; c.enqueue(new Uint8Array(4800)); } });
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'audio/pcm' }), body });
  try {
    await f.voice.start('ko');
    const pending = f.voice.play({ id: 'a1' }, () => finished++, error => f.errors.push(error));
    await tick(); controller.error(new Error('provider body must not be exposed')); await pending;
    assert.ok(f.events.includes('stop')); assert.equal(finished, 0);
    assert.equal(f.errors.length, 1); assert.doesNotMatch(f.errors[0], /provider body/);
  } finally { f.cleanup(); }
});

test('a late transcription after stop cannot submit text or restart the conversation', async () => {
  const f = fixture(); let resolve;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  try {
    await f.voice.start('ko'); f.frames(.02, 12); f.frames(0, 40);
    f.voice.stop(); resolve({ ok: true, json: async () => ({ text: 'obsolete' }) }); await tick();
    assert.deepEqual(f.texts, []); assert.deepEqual(f.errors, []);
  } finally { f.cleanup(); }
});

test('a cancelled speech download cannot play late audio', async () => {
  const f = fixture(); let resolve;
  globalThis.fetch = () => new Promise(done => { resolve = done; });
  try {
    await f.voice.start('ko');
    const playing = f.voice.play({ id: 'a1' }, () => f.events.push('finished'), () => f.events.push('error'));
    f.voice.cancelPlayback(); resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); await playing;
    assert.equal(f.outputs.length, 0); assert.deepEqual(f.events, []);
  } finally { f.cleanup(); }
});
