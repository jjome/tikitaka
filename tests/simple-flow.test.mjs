import test from 'node:test';
import assert from 'node:assert/strict';

let fixtureId = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function fixture(createSession, { waitForRecognition = false, microphone = '' } = {}) {
  const names = ['window', 'document', 'navigator', 'location', 'sessionStorage', 'WebSocket', 'fetch',
    'AudioContext', 'SpeechSynthesisUtterance', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, hidden: true, disabled: true,
      classList: { toggle() {} }, addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(id);
  }
  const records = [], voices = [], recognitions = [], sinks = [], reports = [], constraints = [], storage = new Map(), page = {};
  let streamsStopped = 0;
  let microphoneLevel = 0, cancelled = 0;
  const track = { label: 'Test microphone', enabled: true, muted: false, kind: 'audio', readyState: 'live', stop() { streamsStopped++; } };
  const globals = {
    document: { getElementById: node, addEventListener() {} },
    window: { SpeechRecognition: class {
      constructor() { recognitions.push(this); }
      start(input) { this.input = input; if (!waitForRecognition) this.onstart?.(); } abort() {}
    },
      localStorage: { getItem: () => microphone },
      speechSynthesis: { cancel() { cancelled++; }, getVoices: () => [], speak(u) { voices.push(u); } },
      addEventListener(type, handler) { page[type] = handler; } },
    navigator: { mediaDevices: { async getUserMedia(options) { constraints.push(options); return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    location: { protocol: 'http:', host: 'localhost' },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    AudioContext: class { async resume() {} async close() {}
      createAnalyser() { return { fftSize: 512, getFloatTimeDomainData(v) { v.fill(microphoneLevel); }, connect() {}, disconnect() {} }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { const sink = { gain: { value: 1 }, connect() {}, disconnect() {} }; sinks.push(sink); return sink; } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch: async (url, options) => url.endsWith('/audio-diagnostics') ? (reports.push(JSON.parse(options.body)), { ok: true })
      : url === '/api/config'
      ? { ok: true, json: async () => ({ mode: 'demo', default_language: 'ko' }) }
      : createSession(url, options),
    WebSocket: class {
      static OPEN = 1;
      constructor() { this.readyState = 0; queueMicrotask(() => { if (this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } }); }
      send(raw) {
        const data = JSON.parse(raw); records.push(data);
        const emit = event => queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(event) }); });
        if (data.type === 'authenticate') emit({ type: 'snapshot', state: 'paused', messages: [] });
        if (data.type === 'resume') {
          emit({ type: 'state', state: 'speaking' });
          emit({ type: 'message', message: { id: 'm1', revision: 1, speaker: 'a', delivery: 'pending', text: '먼저 이야기할게요.' } });
        }
        if (data.type === 'end') emit({ type: 'state', state: 'ended' });
      }
      close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
    },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  await import(`../apps/pc/simple.mjs?fixture=${++fixtureId}`);
  await tick();
  return { node, records, voices, recognitions, sinks, reports, constraints, track, stopped: () => streamsStopped,
    audioLevel: value => { microphoneLevel = value; }, cancelled: () => cancelled,
    async cleanup() {
      if (node('talk').dataset.active === 'true') node('talk').click();
      page.pagehide?.(); await tick();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    } };
}

test('one click selects a topic automatically, opens voice, and starts the AI; same button ends', async () => {
  const requests = [];
  const f = await fixture(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: 's1', token: 'token', snapshot: { language: 'ko' } }) };
  });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.deepEqual(requests, [{ language: 'ko', topic_id: 'auto' }]);
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices[0].text, '먼저 이야기할게요.');
    assert.equal(f.node('talk').textContent, '대화 끝내기');
    f.node('talk').click(); await tick();
    assert.equal(f.records.filter(r => r.type === 'end').length, 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
    assert.equal(f.stopped(), 1);
  } finally { await f.cleanup(); }
});

test('cancelled preparation cannot overwrite a restarted session or start late audio', async () => {
  let resolveFirst;
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return { ok: true, json: async () => ({ id: 'new', token: 'new-token', snapshot: { language: 'ko' } }) };
  });
  try {
    f.node('talk').click(); await tick();
    f.node('talk').click();
    f.node('talk').click(); await tick(); await tick();
    resolveFirst({ ok: true, json: async () => ({ id: 'obsolete', token: 'old-token', snapshot: { language: 'ko' } }) });
    await tick();
    assert.deepEqual(f.records.filter(r => r.type === 'authenticate').map(r => r.token), ['new-token']);
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices.length, 1);
    assert.equal(f.node('talk').textContent, '대화 끝내기');
  } finally { await f.cleanup(); }
});

const sessionResponse = async () => ({ ok: true, json: async () => ({ id: 's1', token: 'token', snapshot: { language: 'ko' } }) });

test('AI must wait for actual recognition readiness, not just microphone access', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    f.recognitions[0].onstart(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices.length, 1);
  } finally { await f.cleanup(); }
});

test('embedded recognition network failure prevents AI start and releases capture', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    f.recognitions[0].onerror({ error: 'network' }); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    assert.equal(f.stopped(), 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
    assert.equal(f.node('error').hidden, false);
    assert.match(f.node('error').textContent, /별도 Google Chrome/);
  } finally { await f.cleanup(); }
});

test('cancel while recognition connects cannot start AI on a late ready event', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    const recognizer = f.recognitions[0];
    f.node('talk').click(); await tick();
    recognizer.onstart(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    assert.equal(f.stopped(), 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
  } finally { await f.cleanup(); }
});

test('quiet microphone audio alone stops AI immediately without waiting for STT or server', async () => {
  const f = await fixture(sessionResponse);
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.equal(f.recognitions[0].input, f.track);
    assert.equal(f.sinks[0].gain.value, 0); // Never play the user's microphone back through speakers.
    await new Promise(resolve => setTimeout(resolve, 250)); // Silent ambient estimation.
    const before = f.cancelled();
    f.audioLevel(.012); // Below the previous fixed .035 threshold.
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.ok(f.cancelled() > before);
    assert.equal(f.records.filter(r => r.type === 'speech_started').length, 1);
    assert.equal(f.node('status').textContent, '당신의 이야기를 듣고 있어요');
    f.voices[0].onend(); // An interrupted browser utterance must not advance AI.
    assert.equal(f.records.filter(r => r.type === 'playback_finished').length, 0);
  } finally { await f.cleanup(); }
});

test('microphone chosen in the check page is used by conversation; diagnostics omit audio and device IDs', async () => {
  const f = await fixture(sessionResponse, { microphone: 'chosen-device' });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.deepEqual(f.constraints[0].audio.deviceId, { exact: 'chosen-device' });
    const report = f.reports[0];
    assert.equal(report.source, 'Test microphone');
    assert.equal(report.enabled, true);
    assert.equal(report.muted, false);
    assert.match(report.build, /mic-diagnostics/);
    for (const key of ['audio', 'deviceId', 'text', 'token']) assert.equal(key in report, false);
  } finally { await f.cleanup(); }
});
