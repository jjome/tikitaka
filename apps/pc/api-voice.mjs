import { acquireMicrophone } from './microphone.mjs';
import { AudioTurns } from './audio-turns.mjs';
import { PcmPlayer } from './pcm-player.mjs';

export class ApiVoice {
  constructor(callbacks) {
    Object.assign(this, { onDiagnostics: () => {}, onOutputStart: () => {}, captureMicrophone: acquireMicrophone, ...callbacks });
    this.generation = 0; this.playback = 0; this.running = false; this.starting = false;
    this.userSpeaking = false; this.player = { current: null, cancel: () => this.cancelPlayback() };
  }
  get supported() { return Boolean(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode); }
  async start(language) {
    if (this.running || this.starting) return;
    if (!this.supported) throw new Error('이 브라우저에서 음성 입력을 사용할 수 없습니다. 브라우저를 업데이트해주세요.');
    const generation = ++this.generation, alive = () => generation === this.generation;
    this.starting = true; this.language = language; this.queue = []; this.texts = []; this.processing = false;
    this.diagnostics = { build: '2026-10-07-api-audio-1', peak: 0, frames: 0, speech_starts: 0, results: 0, recognition_error: '' };
    const cancelled = new Promise(resolve => { this.cancelStart = () => resolve(null); });
    try {
      const capture = this.captureMicrophone({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, alive);
      capture.then(stream => { if (stream && !alive()) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
      const stream = await Promise.race([capture, cancelled]);
      if (!stream || !alive()) return;
      this.stream = stream; this.inputTrack = stream.getAudioTracks()[0];
      this.inputTrack.onended = () => { if (alive()) this.fail('마이크 연결이 끊겼습니다. 다시 시작해주세요.'); };
      this.context = new AudioContext({ sampleRate: 48000 });
      await Promise.race([this.context.resume(), cancelled]);
      if (!alive()) return;
      await Promise.race([this.context.audioWorklet.addModule('/assets/pcm-worklet.mjs'), cancelled]);
      if (!alive()) return;
      this.turns = new AudioTurns({ rate: this.context.sampleRate,
        onStart: () => {
          this.cancelPlayback(); this.userSpeaking = true; this.diagnostics.speech_starts++;
          this.onStart(); this.onStatus('듣고 있어요');
        },
        onTurn: wav => {
          if (this.queue.length >= 2) { this.fail('음성 처리가 밀렸습니다. 잠시 후 다시 시작해주세요.'); return; }
          this.queue.push(wav); this.drain(generation);
        },
      });
      this.source = this.context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(this.context, 'microphone-frames', { channelCount: 1 });
      this.sink = this.context.createGain(); this.sink.gain.value = 0;
      this.source.connect(this.processor); this.processor.connect(this.sink); this.sink.connect(this.context.destination);
      this.processor.port.onmessage = event => {
        if (!alive() || !this.running) return;
        const rms = this.turns.push(event.data, performance.now());
        if (!alive() || !this.running) return;
        this.diagnostics.peak = Math.max(this.diagnostics.peak, Math.min(1, rms)); this.diagnostics.frames++;
        this.onLevel(Math.min(1, rms / .03));
      };
      this.running = true; this.onStatus('마이크 켜짐');
      this.activityTimer = setInterval(() => { if (this.userSpeaking) this.onActivity(); this.reportDiagnostics(); }, 500);
    } catch (error) {
      if (alive()) { this.stop(); throw new Error(error.name === 'NotAllowedError' ? '마이크 권한을 허용해주세요.' : error.message); }
    } finally { if (alive()) { this.starting = false; this.cancelStart = null; } }
  }
  async request(path, { body, signal, type, accept } = {}) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(this.session.id)}/${path}`, {
      method: 'POST', signal, body,
      headers: { 'X-Session-Token': this.session.token, ...(type ? { 'Content-Type': type } : {}), ...(accept ? { Accept: accept } : {}) },
    });
    if (!response.ok) {
      let message = '음성 연결에 실패했습니다. 다시 시작해주세요.';
      try { const result = await response.json(); if (typeof result.detail === 'string') message = result.detail; } catch {}
      throw new Error(message);
    }
    return response;
  }
  async drain(generation) {
    if (this.processing || !this.running) return;
    this.processing = true;
    try {
      while (this.queue.length && generation === this.generation) {
        const controller = new AbortController(); this.transcription = controller;
        this.onStatus('말을 인식하고 있어요');
        const timeout = setTimeout(() => controller.abort(), 25000);
        let data;
        try {
          const response = await this.request('transcriptions', { body: this.queue.shift(),
            signal: controller.signal, type: 'audio/wav' });
          data = await response.json();
        } finally { clearTimeout(timeout); }
        if (generation !== this.generation) return;
        if (typeof data.text !== 'string' || data.text.length > 1000) throw new Error('인식 결과를 확인하지 못했습니다.');
        if (data.text.trim()) { this.texts.push(data.text.trim()); this.diagnostics.results++; }
        this.onPreview(this.texts.join(' '));
      }
      if (generation !== this.generation) return;
      this.processing = false;
      if (!this.turns.recording) {
        const text = this.texts.join(' '); this.texts = []; this.userSpeaking = false;
        this.onPreview(''); this.onStatus('마이크 켜짐');
        if (text) this.onText(text); else this.onEmpty();
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error.name === 'AbortError' ? '음성 인식 응답이 늦습니다. 다시 시작해주세요.' : error.message);
    }
  }
  async play(message, onFinish, onError) {
    if (!this.running || this.userSpeaking) return;
    this.cancelPlayback();
    const playback = this.playback, generation = this.generation;
    const alive = () => playback === this.playback && generation === this.generation && this.running;
    this.player.current = message; const controller = new AbortController(); this.speechRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await this.request(`speech/${encodeURIComponent(message.id)}`, { signal: controller.signal, accept: 'audio/pcm' });
      if (!alive()) return;
      if (response.headers?.get('content-type')?.startsWith('audio/pcm')) {
        const pcm = new PcmPlayer(this.context, {
          onStart: () => { if (alive()) this.onOutputStart(message); },
          onFinish: () => { if (alive()) { this.player.current = null; this.pcm = null; onFinish(message); } },
        });
        this.pcm = pcm;
        const reader = response.body.getReader();
        try {
          while (alive()) {
            const { value, done } = await reader.read();
            if (!alive()) return;
            if (done) { pcm.end(); break; }
            pcm.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        return;
      }
      const bytes = await response.arrayBuffer();
      if (!alive()) return;
      const audio = await this.context.decodeAudioData(bytes);
      if (!alive()) return;
      const source = this.context.createBufferSource(); source.buffer = audio;
      source.connect(this.context.destination); this.playingSource = source;
      source.onended = () => { source.disconnect(); if (alive()) { this.player.current = null; this.playingSource = null; onFinish(message); } };
      source.start();
      this.onOutputStart(message);
    } catch (error) {
      if (alive()) { this.cancelPlayback(); onError('AI 음성을 재생하지 못했습니다. 다시 시작해주세요.'); }
    } finally { clearTimeout(timeout); }
  }
  cancelPlayback() {
    this.pcm?.cancel(); this.pcm = null;
    this.playback++; this.player.current = null; this.speechRequest?.abort(); this.speechRequest = null;
    if (this.playingSource) { this.playingSource.onended = null; try { this.playingSource.stop(); } catch {} this.playingSource.disconnect(); }
    this.playingSource = null;
  }
  fail(message) {
    if (this.diagnostics) this.diagnostics.recognition_error = 'audio_api_error';
    this.stop(); this.onError(message);
  }
  reportDiagnostics() {
    if (!this.diagnostics || !this.inputTrack) return;
    this.onDiagnostics({ ...this.diagnostics, source: (this.inputTrack.label || '').slice(0, 160),
      context_state: this.context?.state || '', track_state: this.inputTrack.readyState,
      muted: this.inputTrack.muted, enabled: this.inputTrack.enabled });
  }
  stop() {
    this.reportDiagnostics(); this.generation++; this.running = false; this.starting = false;
    this.cancelStart?.(); this.cancelStart = null; this.cancelPlayback(); this.transcription?.abort();
    clearInterval(this.activityTimer); this.queue = []; this.texts = []; this.processing = false;
    this.turns?.reset(); this.userSpeaking = false;
    if (this.processor) { this.processor.port.onmessage = null; this.processor.port.close(); this.processor.disconnect(); }
    this.processor = null; this.source?.disconnect(); this.source = null; this.sink?.disconnect(); this.sink = null;
    if (this.inputTrack) this.inputTrack.onended = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.inputTrack = null;
    this.context?.close().catch(() => {}); this.context = null;
    this.onLevel(0); this.onPreview(''); this.onStatus('마이크 꺼짐');
  }
}
