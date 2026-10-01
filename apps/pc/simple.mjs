import { BrowserVoice } from './voice.mjs?v=20261002-mic1';
import { MessageOutbox } from './outbox.mjs';

const nodes = Object.fromEntries(['talk', 'status', 'speaker', 'caption', 'error', 'level', 'build', 'friend-a', 'friend-b']
  .map(id => [id, document.getElementById(id)]));
const cacheKey = 'tikitaka_simple_session';
let config, session, outbox, socket, heartbeat, startup;
let state = 'paused', active = false, starting = false, intent = 0;

function showError(message) { nodes.error.textContent = message; nodes.error.hidden = false; }
function render() {
  nodes.talk.textContent = active ? '대화 끝내기' : '대화 시작';
  nodes.talk.dataset.active = String(active);
  nodes.status.textContent = !active ? '버튼 한 번으로, 바로 대화해요.' : starting ? '대화를 준비하고 있어요…' :
    ({ generating: '친구가 생각하고 있어요', speaking: '편하게 듣다가, 언제든 말하세요',
      pacing: '언제든 끼어들어도 좋아요', listening: '당신의 이야기를 듣고 있어요' })[state] || '대화를 시작하고 있어요…';
  if (!active || state !== 'speaking') highlight(null);
}
function highlight(speaker) {
  nodes['friend-a'].classList.toggle('active', speaker === 'a');
  nodes['friend-b'].classList.toggle('active', speaker === 'b');
}
function caption(message) {
  nodes.speaker.textContent = message.speaker === 'user' ? '나' : message.speaker === 'a' ? '민지 · AI' : '준호 · AI';
  nodes.caption.textContent = message.text;
  highlight(message.speaker);
}
function send(command) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(command)); return true;
}
function stop(command = 'end') {
  const wasStarting = starting;
  intent++;
  active = false;
  starting = false;
  voice.stop();
  send({ type: command });
  startup?.abort();
  if (wasStarting) { const ws = socket; socket = null; ws?.close(); clearInterval(heartbeat); }
  render();
}

const voice = new BrowserVoice({
  onDiagnostics: report => {
    if (!session) return;
    fetch(`/api/sessions/${session.id}/audio-diagnostics`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': session.token },
      body: JSON.stringify(report) }).catch(() => {});
  },
  onStart: () => { if (active) { state = 'listening'; render(); send({ type: 'speech_started' }); } },
  onActivity: () => { if (active) send({ type: 'speech_activity' }); },
  onText: text => {
    if (!active || !outbox) return;
    if (!text.trim() || text.length > 1000) {
      showError('짧게 나눠 말씀해주세요.'); stop('pause'); return;
    }
    const item = outbox.enqueue(crypto.randomUUID(), text);
    caption({ speaker: 'user', text });
    send({ type: 'user_message', text: item.text, client_message_id: item.id });
  },
  onPreview: text => { if (active && text) caption({ speaker: 'user', text }); },
  onEmpty: () => { if (active) send({ type: 'speech_cancelled' }); },
  onError: message => { showError(message); stop('pause'); },
  onLevel: value => { nodes.level.value = value; },
  onStatus: () => {},
});

function updateState(next) {
  state = next;
  if (next === 'ended' || (next === 'paused' && !starting)) {
    active = false; starting = false; intent++;
    voice.stop();
  }
  render();
}

async function connect(signal) {
  if (socket?.readyState === WebSocket.OPEN) return;
  socket?.close();
  clearInterval(heartbeat);
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/sessions/${session.id}/events`);
  socket = ws;
  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const fail = message => { cleanup(); if (!settled) reject(new Error(message)); };
    const abort = () => { fail('대화 준비가 취소되었습니다.'); ws.close(); };
    const timer = setTimeout(() => { fail('서버에 연결하지 못했습니다. 다시 시작해주세요.'); ws.close(); }, 7000);
    signal.addEventListener('abort', abort, { once: true });
    ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', token: session.token }));
    ws.onmessage = event => {
      if (socket !== ws) return;
      const data = JSON.parse(event.data);
      if (data.type === 'snapshot') {
        outbox.reconcile(data.messages);
        updateState(data.state);
        settled = true; cleanup(); resolve();
      } else if (data.type === 'state') updateState(data.state);
      else if (data.type === 'interrupt') voice.player?.cancel();
      else if (data.type === 'error') showError(data.message);
      else if (data.type === 'message') {
        const message = data.message;
        if (message.speaker === 'user') outbox.acknowledge(message.client_message_id);
        if (!active) return;
        if (message.speaker === 'user') { caption(message); return; }
        if (!voice.running || voice.userSpeaking || message.delivery !== 'pending') return;
        caption(message);
        voice.play(message,
          () => send({ type: 'playback_finished', message_id: message.id, revision: message.revision }),
          () => send({ type: 'playback_failed', message_id: message.id, revision: message.revision }));
      }
    };
    ws.onerror = () => fail('서버에 연결하지 못했습니다. 다시 시작해주세요.');
    ws.onclose = () => {
      fail('연결이 끊겼습니다. 다시 시작해주세요.');
      if (socket !== ws) return;
      clearInterval(heartbeat);
      if (active) showError('연결이 끊겼습니다. 다시 시작해주세요.');
      active = false; starting = false; intent++;
      voice.stop(); render();
    };
  });
  heartbeat = setInterval(() => { if (socket === ws) send({ type: 'heartbeat' }); }, 10000);
  for (const item of outbox.pending()) send({ type: 'user_message', text: item.text, client_message_id: item.id });
}

async function loadConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('대화를 준비하지 못했습니다. 다시 시작해주세요.');
  config = await response.json();
  nodes.build.textContent = config.mode === 'demo' ? '개발용 · 대본 데모' : '개발용 · AI 연결';
}
async function ensureSession(signal) {
  if (session && session.language === config.default_language) {
    const result = await fetch(`/api/sessions/${session.id}`, { signal, headers: { 'X-Session-Token': session.token } });
    const snapshot = result.ok ? await result.json() : null;
    signal.throwIfAborted();
    if (!snapshot || snapshot.state === 'ended' || Date.now() / 1000 - snapshot.created_at >= snapshot.policy.max_session_seconds) session = null;
  } else session = null;
  if (!session) {
    socket?.close(); socket = null; clearInterval(heartbeat);
    const response = await fetch('/api/sessions', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: config.default_language, topic_id: 'auto' }) });
    if (!response.ok) throw new Error('대화를 준비하지 못했습니다. 다시 시작해주세요.');
    const data = await response.json();
    signal.throwIfAborted();
    session = { id: data.id, token: data.token, language: data.snapshot.language };
    sessionStorage.setItem(cacheKey, JSON.stringify(session));
  }
  outbox = new MessageOutbox(session.id, sessionStorage);
  signal.throwIfAborted();
  await connect(signal);
}
async function start() {
  const attempt = ++intent;
  const controller = new AbortController();
  startup = controller;
  active = true; starting = true;
  nodes.error.hidden = true;
  render();
  try {
    if (!config) await loadConfig();
    if (attempt !== intent) return;
    await ensureSession(controller.signal);
    if (attempt !== intent) return;
    await voice.start(session.language);
    if (attempt !== intent) return;
    if (!voice.running) { stop('pause'); return; }
    if (!send({ type: 'resume' })) throw new Error('연결이 끊겼습니다. 다시 시작해주세요.');
    if (voice.userSpeaking) send({ type: 'speech_started' });
  } catch (error) {
    if (attempt === intent) { showError(error.message); stop('pause'); }
  } finally {
    if (attempt === intent) { starting = false; render(); }
  }
}

nodes.talk.addEventListener('click', () => active ? stop() : start());
document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop('pause'); });
window.addEventListener('pagehide', () => { voice.stop(); socket?.close(); });

try {
  const saved = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
  if (saved && typeof saved.id === 'string' && typeof saved.token === 'string') session = saved;
} catch { sessionStorage.removeItem(cacheKey); }
loadConfig().catch(error => showError(error.message)).finally(() => { nodes.talk.disabled = false; render(); });
