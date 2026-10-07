import { BrowserVoice } from './voice.mjs?v=20261007-microphone';
import { ApiVoice } from './api-voice.mjs';

export class ConversationVoice {
  constructor(callbacks) { this.callbacks = callbacks; this.adapter = new BrowserVoice(callbacks); }
  configure(config, session) {
    const Adapter = config.voice_transport === 'api' ? ApiVoice : BrowserVoice;
    if (!(this.adapter instanceof Adapter)) { this.adapter.stop(); this.adapter = new Adapter(this.callbacks); }
    this.adapter.session = session;
  }
  get running() { return this.adapter.running; }
  get userSpeaking() { return this.adapter.userSpeaking; }
  get player() { return this.adapter.player; }
  get supported() { return this.adapter.supported; }
  start(language) { return this.adapter.start(language); }
  stop() { return this.adapter.stop(); }
  play(...args) { return this.adapter.play(...args); }
}
