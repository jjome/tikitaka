import { TranscriptBuffer, PlaybackGuard, ActivityGate } from './voice-core.mjs';

export class BrowserVoice {
  constructor({ onStart, onActivity, onText, onPreview, onEmpty, onError, onLevel, onStatus }) {
    Object.assign(this, { onStart, onActivity, onText, onPreview, onEmpty, onError, onLevel, onStatus });
    this.running = false;
    this.starting = false;
    this.generation = 0;
    this.userSpeaking = false;
    this.cycle = 0;
    this.lastActivitySignal = 0;
    this.gate = new ActivityGate({ threshold: .006, adaptive: true,
      onStart: () => this.beginSpeech(), onEnd: () => this.buffer.speechEnded() });
    this.buffer = new TranscriptBuffer({
      onCommit: text => { this.userSpeaking = false; this.onText(text); },
      onPreview,
      onEmpty: () => { this.userSpeaking = false; this.onEmpty(); },
    });
    this.player = window.speechSynthesis
      ? new PlaybackGuard(window.speechSynthesis, text => new SpeechSynthesisUtterance(text)) : null;
  }
  get supported() {
    return Boolean((window.SpeechRecognition || window.webkitSpeechRecognition) && this.player && navigator.mediaDevices);
  }
  async start(language) {
    if (this.running || this.starting) return;
    if (!this.supported) throw new Error('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome에서 열어주세요.');
    const generation = ++this.generation;
    this.starting = true;
    this.language = language;
    try {
      const capture = navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      // A permission prompt may stay pending forever. Cancellation must release the UI,
      // and a stream granted after cancellation must be closed immediately.
      capture.then(stream => {
        if (generation !== this.generation) stream.getTracks().forEach(t => t.stop());
      }).catch(() => {});
      const cancelled = new Promise(resolve => { this.cancelStart = () => resolve(null); });
      const stream = await Promise.race([capture, cancelled]);
      if (!stream) return;
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.inputTrack = stream.getAudioTracks?.()[0];
      if (this.inputTrack) {
        this.inputTrack.onended = () => {
          if (generation !== this.generation) return;
          this.stop(); this.onError('마이크 연결이 끊겼습니다. 입력 장치를 확인하고 다시 시작해주세요.');
        };
      }
      this.context = new AudioContext();
      await Promise.race([this.context.resume(), cancelled]);
      if (generation !== this.generation) return;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.source = this.context.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      // Retain every node and keep the capture graph rendering without mic loopback.
      this.silentSink = this.context.createGain();
      this.silentSink.gain.value = 0;
      this.analyser.connect(this.silentSink);
      this.silentSink.connect(this.context.destination);
      this.levelSamples = new Float32Array(this.analyser.fftSize);
      this.running = true;
      this.readLevel();
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new Recognition();
      this.recognition.lang = language === 'ko' ? 'ko-KR' : 'en-US';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      const alive = () => this.running && generation === this.generation;
      let ready = false, resolveReady, rejectReady;
      const recognitionReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      this.cancelRecognitionStart = () => resolveReady(false);
      const readyTimer = setTimeout(() => rejectReady(new Error(
        '음성 인식 서비스가 응답하지 않습니다. 이 주소를 별도 Google Chrome 창에서 열어주세요.')), 8000);
      this.recognition.onstart = () => {
        if (!alive()) return;
        ready = true; clearTimeout(readyTimer);
        this.cycle += 1; this.onStatus('마이크 켜짐'); resolveReady(true);
      };
      this.recognition.onspeechstart = () => {
        if (!alive()) return;
        this.beginSpeech();
        this.buffer.activity();
        this.onActivity();
      };
      this.recognition.onspeechend = () => {
        if (alive()) this.buffer.speechEnded();
      };
      this.recognition.onresult = event => {
        if (!alive()) return;
        const items = [];
        for (let i = 0; i < event.results.length; i++) {
          const item = { key: `${this.cycle}:${i}`, text: event.results[i][0].transcript, final: event.results[i].isFinal };
          if (!this.buffer.consumed.has(item.key) && item.text.trim()) items.push(item);
        }
        if (!items.length) return;
        this.beginSpeech();
        this.onActivity();
        this.buffer.feed(items);
      };
      this.recognition.onerror = event => {
        if (!alive() || event.error === 'aborted' || event.error === 'no-speech') return;
        const messages = {
          'not-allowed': '마이크 권한을 허용해주세요.',
          'service-not-allowed': '이 브라우저의 음성 인식 서비스를 사용할 수 없습니다. 별도 Google Chrome 창에서 열어주세요.',
          'network': '브라우저의 음성 인식 서비스에 연결하지 못했습니다. 내장 브라우저라면 이 주소를 별도 Google Chrome 창에서 열어주세요. Chrome에서도 실패하면 인터넷 연결을 확인해주세요.',
          'audio-capture': '마이크를 찾을 수 없습니다. PC 입력 장치를 확인해주세요.',
        };
        const message = messages[event.error] || `음성 인식이 중단됐습니다 (${event.error}).`;
        if (!ready) { clearTimeout(readyTimer); rejectReady(new Error(message)); }
        else { this.stop(); this.onError(message); }
      };
      this.recognition.onend = () => {
        if (!alive()) return;
        if (!ready) {
          clearTimeout(readyTimer);
          rejectReady(new Error('음성 인식을 시작하지 못했습니다. 별도 Google Chrome 창에서 열어주세요.'));
          return;
        }
        this.restartTimer = setTimeout(() => {
          if (!this.running || generation !== this.generation) return;
          try { this.startRecognition(); }
          catch { this.stop(); this.onError('음성 인식을 다시 시작하지 못했습니다. 재개해주세요.'); }
        }, 250);
      };
      try {
        this.startRecognition();
        await recognitionReady;
      } finally {
        clearTimeout(readyTimer);
        this.cancelRecognitionStart = null;
      }
    } catch (error) {
      this.stop();
      throw new Error(error.name === 'NotAllowedError' ? '마이크 권한을 허용해주세요.' : error.message);
    } finally {
      this.starting = false;
    }
  }
  beginSpeech() {
    const wasPlaying = Boolean(this.player.current);
    this.player.cancel(); // Stop locally before any callback or server round trip.
    if (!this.userSpeaking || wasPlaying) {
      this.userSpeaking = true;
      this.onStart();
    }
  }
  startRecognition() {
    if (this.inputTrack?.kind === 'audio' && this.inputTrack.readyState === 'live') {
      // Current Chrome accepts an explicit track. Older engines may ignore it.
      try { this.recognition.start(this.inputTrack); return; }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
    }
    this.recognition.start();
  }
  readLevel() {
    if (!this.running) return;
    const values = this.levelSamples;
    this.analyser.getFloatTimeDomainData(values);
    const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    this.onLevel(Math.min(1, rms / Math.max(.018, this.gate.threshold * 3)));
    const now = performance.now();
    if (this.gate.process(rms, now)) {
      if (!this.userSpeaking || this.player.current) this.beginSpeech();
      this.buffer.activity();
      if (now - this.lastActivitySignal >= 500) {
        this.lastActivitySignal = now;
        this.onActivity();
      }
    }
    this.levelTimer = setTimeout(() => this.readLevel(), 20);
  }
  play(message, onFinish, onError) {
    if (!this.running || this.userSpeaking) return;
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith(this.language));
    this.player.play(message, { language: this.language,
      voice: voices[message.speaker === 'a' ? 0 : 1] || voices[0], onFinish, onError });
  }
  stop() {
    this.generation += 1;
    this.running = false;
    this.cancelStart?.();
    this.cancelStart = null;
    this.cancelRecognitionStart?.();
    this.cancelRecognitionStart = null;
    this.userSpeaking = false;
    this.gate.reset();
    clearTimeout(this.restartTimer);
    clearTimeout(this.levelTimer);
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
    }
    this.recognition = null;
    this.buffer.reset();
    this.player?.cancel();
    if (this.inputTrack) this.inputTrack.onended = null;
    this.inputTrack = null;
    this.source?.disconnect(); this.source = null;
    this.analyser?.disconnect(); this.analyser = null;
    this.silentSink?.disconnect(); this.silentSink = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.context?.close().catch(() => {});
    this.context = null;
    this.onLevel(0);
    this.onStatus('마이크 꺼짐');
  }
}

