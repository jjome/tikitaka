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
    this.gate = new ActivityGate({ onStart: () => this.beginSpeech(), onEnd: () => this.buffer.speechEnded() });
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
      this.context = new AudioContext();
      await Promise.race([this.context.resume(), cancelled]);
      if (generation !== this.generation) return;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.context.createMediaStreamSource(stream).connect(this.analyser);
      this.running = true;
      this.readLevel();
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new Recognition();
      this.recognition.lang = language === 'ko' ? 'ko-KR' : 'en-US';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.onstart = () => { this.cycle += 1; this.onStatus('마이크 켜짐'); };
      this.recognition.onspeechstart = () => {
        if (!this.running) return;
        this.beginSpeech();
        this.buffer.activity();
        this.onActivity();
      };
      this.recognition.onspeechend = () => {
        if (this.running) this.buffer.speechEnded();
      };
      this.recognition.onresult = event => {
        if (!this.running) return;
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
        if (!this.running || event.error === 'aborted' || event.error === 'no-speech') return;
        const messages = {
          'not-allowed': '마이크 권한을 허용해주세요.',
          'service-not-allowed': '이 브라우저의 음성 인식 서비스를 사용할 수 없습니다.',
          'network': '음성 인식 연결에 실패했습니다. 인터넷 연결과 브라우저를 확인해주세요.',
          'audio-capture': '마이크를 찾을 수 없습니다. PC 입력 장치를 확인해주세요.',
        };
        this.stop();
        this.onError(messages[event.error] || `음성 인식이 중단됐습니다 (${event.error}).`);
      };
      this.recognition.onend = () => {
        if (!this.running || generation !== this.generation) return;
        this.restartTimer = setTimeout(() => {
          if (!this.running || generation !== this.generation) return;
          try { this.recognition.start(); }
          catch { this.stop(); this.onError('음성 인식을 다시 시작하지 못했습니다. 재개해주세요.'); }
        }, 250);
      };
      this.recognition.start();
    } catch (error) {
      this.stop();
      throw new Error(error.name === 'NotAllowedError' ? '마이크 권한을 허용해주세요.' : error.message);
    } finally {
      this.starting = false;
    }
  }
  beginSpeech() {
    if (!this.userSpeaking) {
      this.userSpeaking = true;
      this.player.cancel(); // Local cancellation never waits for the server round trip.
      this.onStart();
    }
  }
  readLevel() {
    if (!this.running) return;
    const values = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(values);
    const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    this.onLevel(Math.min(1, rms * 12));
    const now = performance.now();
    if (this.gate.process(rms, now)) {
      this.buffer.activity();
      if (now - this.lastActivitySignal >= 500) {
        this.lastActivitySignal = now;
        this.onActivity();
      }
    }
    this.frame = requestAnimationFrame(() => this.readLevel());
  }
  play(message, onFinish, onError) {
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith(this.language));
    this.player.play(message, { language: this.language,
      voice: voices[message.speaker === 'a' ? 0 : 1] || voices[0], onFinish, onError });
  }
  stop() {
    this.generation += 1;
    this.running = false;
    this.cancelStart?.();
    this.cancelStart = null;
    this.userSpeaking = false;
    this.gate.reset();
    clearTimeout(this.restartTimer);
    cancelAnimationFrame(this.frame);
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
    }
    this.recognition = null;
    this.buffer.reset();
    this.player?.cancel();
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.context?.close().catch(() => {});
    this.context = null;
    this.onLevel(0);
    this.onStatus('마이크 꺼짐');
  }
}

