let fixtureId = 0;
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export async function fixture(createSession, { waitForRecognition = false, microphone = '', liveServer = '' } = {}) {
  const names = ['window', 'document', 'navigator', 'location', 'sessionStorage', 'WebSocket', 'fetch',
    'AudioContext', 'SpeechSynthesisUtterance', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, hidden: true, disabled: true,
      classList: { toggle() {} }, addEventListener(type, handler) { this[type] = handler; } });
    return nodes.get(id);
  }
  const records = [], voices = [], recognitions = [], sinks = [], reports = [], constraints = [], sockets = [], storage = new Map(), page = {};
  let streamsStopped = 0;
  let microphoneLevel = 0, cancelled = 0;
  const track = { label: 'Test microphone', enabled: true, muted: false, kind: 'audio', readyState: 'live', stop() { streamsStopped++; } };
  const globals = {
    document: { getElementById: node, addEventListener() {} },
    window: { SpeechRecognition: class {
      constructor() { recognitions.push(this); }
      start(input) { this.input = input; this.startCalls = (this.startCalls || 0) + 1; if (!waitForRecognition) this.onstart?.(); } abort() {}
      stop() {
        this.stopCalls = (this.stopCalls || 0) + 1;
        queueMicrotask(() => {
          if (this.finalText) {
            const result = [{ transcript: this.finalText }]; result.isFinal = true;
            this.onresult?.({ results: [result] });
          }
          this.onend?.();
        });
      }
    },
      localStorage: { getItem: key => key === 'tikitaka_microphone' ? microphone : '' },
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
      constructor() { sockets.push(this); this.readyState = 0; queueMicrotask(() => { if (this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } }); }
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
  if (liveServer) {
    const realFetch = originals.get('fetch').value, RealWebSocket = originals.get('WebSocket').value;
    globals.location = { protocol: new URL(liveServer).protocol, host: new URL(liveServer).host };
    globals.fetch = (url, options) => realFetch(new URL(url, liveServer), options);
    globals.WebSocket = class extends RealWebSocket {
      send(raw) { records.push(JSON.parse(raw)); super.send(raw); }
    };
  }
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  await import(`../../apps/pc/simple.mjs?fixture=${++fixtureId}`);
  await tick();
  return { node, records, voices, recognitions, sinks, reports, constraints, track, stopped: () => streamsStopped,
    emit: event => sockets.at(-1).onmessage({ data: JSON.stringify(event) }),
    session: () => JSON.parse(storage.get('tikitaka_simple_session')),
    audioLevel: value => { microphoneLevel = value; }, cancelled: () => cancelled,
    async cleanup() {
      if (node('talk').dataset.active === 'true') node('talk').click();
      page.pagehide?.(); await tick();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    } };
}

