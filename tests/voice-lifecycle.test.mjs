import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserVoice } from '../apps/pc/voice.mjs';

test('cancelling an unanswered microphone prompt releases start and closes a late stream', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let grant;
  let stopped = 0;
  globalThis.window = { SpeechRecognition: class {}, speechSynthesis: { cancel() {} } };
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) },
  } });
  const noop = () => {};
  const voice = new BrowserVoice({ onStart: noop, onActivity: noop, onText: noop,
    onPreview: noop, onEmpty: noop, onError: noop, onLevel: noop, onStatus: noop });
  try {
    const starting = voice.start('ko');
    voice.stop();
    await starting;
    assert.equal(voice.starting, false);
    assert.equal(voice.running, false);
    grant({ getTracks: () => [{ stop: () => stopped++ }] });
    await Promise.resolve();
    assert.equal(stopped, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    delete globalThis.window;
    delete globalThis.cancelAnimationFrame;
  }
});

test('always-on recognition interrupts TTS, commits final speech, and releases microphone', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const utterances = [], texts = [];
  let cancelled = 0, starts = 0, stopped = 0;
  class Recognition { start() { this.onstart?.(); } abort() {} }
  globalThis.window = { SpeechRecognition: Recognition, speechSynthesis: {
    cancel() { cancelled++; }, speak(u) { utterances.push(u); }, getVoices: () => [],
  } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.AudioContext = class {
    async resume() {} async close() {}
    createAnalyser() { return { fftSize: 512, getFloatTimeDomainData(values) { values.fill(0); }, connect() {}, disconnect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { async getUserMedia() { return { getTracks: () => [{ stop: () => stopped++ }] }; } },
  } });
  const noop = () => {};
  const voice = new BrowserVoice({ onStart: () => starts++, onActivity: noop, onText: text => texts.push(text),
    onPreview: noop, onEmpty: noop, onError: noop, onLevel: noop, onStatus: noop });
  voice.buffer.silenceMs = 0;
  try {
    await voice.start('ko');
    assert.equal(voice.running, true);
    let finished = 0;
    voice.play({ text: 'AI 말하는 중', speaker: 'a' }, () => finished++, noop);
    const before = cancelled;
    voice.recognition.onspeechstart();
    assert.equal(starts, 1);
    assert.equal(cancelled, before + 1);
    utterances[0].onend();
    assert.equal(finished, 0);
    const result = [{ transcript: '나는 반대야' }]; result.isFinal = true;
    voice.recognition.onresult({ results: [result] });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(texts, ['나는 반대야']);
    voice.stop();
    assert.equal(stopped, 1);
    assert.equal(voice.running, false);
  } finally {
    voice.stop();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    for (const name of ['window', 'AudioContext', 'SpeechSynthesisUtterance', 'requestAnimationFrame', 'cancelAnimationFrame']) delete globalThis[name];
  }
});
