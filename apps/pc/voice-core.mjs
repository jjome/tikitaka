/** Provider-neutral turn boundaries and stale playback protection. */
export class TranscriptBuffer {
  constructor({ onCommit, onPreview = () => {}, onEmpty = () => {}, onNeedsFinal = () => {}, silenceMs = 1200,
                schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { onCommit, onPreview, onEmpty, onNeedsFinal, silenceMs, schedule, unschedule });
    this.items = new Map();
    this.consumed = new Set();
    this.timer = null;
  }
  activity() {
    if (this.timer !== null) this.unschedule(this.timer);
    this.timer = null;
  }
  feed(items) {
    this.activity();
    for (const item of items) {
      if (!this.consumed.has(item.key) && item.text.trim()) this.items.set(item.key, item);
    }
    this.onPreview([...this.items.values()].map(item => item.text.trim()).join(' '));
    if (this.items.size && [...this.items.values()].every(item => item.final)) this.arm();
  }
  speechEnded() {
    this.arm();
  }
  get hasInterim() { return [...this.items.values()].some(item => !item.final); }
  arm() {
    this.activity();
    this.timer = this.schedule(() => {
      this.timer = null;
      if (this.hasInterim) { this.onNeedsFinal(); return; }
      this.commitAtEndpoint();
    }, this.silenceMs);
  }
  // Explicit app endpoint after the recognizer has ended. This does not change isFinal.
  commitAtEndpoint() {
    this.activity();
    const items = [...this.items.values()];
    if (!items.length) { this.onEmpty(); return; }
    const text = items.map(item => item.text.trim()).join(' ');
    for (const item of items) this.consumed.add(item.key);
    this.items.clear();
    this.onPreview('');
    this.onCommit(text);
  }
  reset() {
    this.activity();
    this.items.clear();
    this.consumed.clear();
    this.onPreview('');
  }
}

export class PlaybackGuard {
  constructor(synth, makeUtterance) {
    this.synth = synth;
    this.makeUtterance = makeUtterance;
    this.token = 0;
    this.current = null;
  }
  cancel() {
    this.token += 1;
    this.current = null;
    this.synth.cancel();
  }
  play(message, { language, voice, onFinish, onError }) {
    this.cancel();
    const token = this.token;
    const utterance = this.makeUtterance(message.text);
    utterance.lang = language === 'ko' ? 'ko-KR' : 'en-US';
    if (voice) utterance.voice = voice;
    utterance.rate = message.speaker === 'a' ? .94 : 1.02;
    utterance.pitch = message.speaker === 'a' ? 1.08 : .92;
    this.current = message;
    utterance.onend = () => {
      if (token !== this.token) return;
      this.current = null;
      onFinish(message);
    };
    utterance.onerror = (event) => {
      if (token !== this.token) return;
      this.current = null;
      onError(event.error || 'speech_failed');
    };
    this.synth.speak(utterance);
  }
}

/** Fast local energy gate. This detects activity, not semantic speech. */
export class ActivityGate {
  constructor({ threshold = .035, onsetMs = 120, offsetMs = 180, adaptive = false, onStart, onEnd }) {
    Object.assign(this, { threshold, minimumThreshold: threshold, onsetMs, offsetMs, adaptive, onStart, onEnd });
    this.reset();
  }
  reset() {
    this.active = false; this.aboveSince = null; this.lastAbove = null;
    this.threshold = this.minimumThreshold; this.samples = []; this.startedAt = null;
  }
  process(rms, now) {
    if (this.adaptive && !this.active) {
      if (this.startedAt === null) this.startedAt = now;
      this.samples.push({ rms, at: now });
      this.samples = this.samples.filter(sample => now - sample.at < 2000);
      const levels = this.samples.map(sample => sample.rms).sort((a, b) => a - b);
      const floor = levels[Math.floor((levels.length - 1) * .2)];
      this.threshold = Math.max(this.minimumThreshold, floor * 3);
      // Estimate ambient input automatically; do not require a calibration screen.
      if (now - this.startedAt < 200) return false;
    }
    if (rms >= this.threshold) {
      this.lastAbove = now;
      if (this.aboveSince === null) this.aboveSince = now;
      if (!this.active && now - this.aboveSince >= this.onsetMs) {
        this.active = true; this.onStart();
      }
    } else {
      this.aboveSince = null;
      if (this.active && now - this.lastAbove >= this.offsetMs) {
        this.active = false; this.onEnd();
      }
    }
    return this.active;
  }
}

