// Internal diagnostics, intentionally separate from the one-button product screen.
import { BrowserVoice } from './voice.mjs?v=20261002-endpoint2';
import { MessageOutbox } from './outbox.mjs';

const $ = id => document.getElementById(id);
const nodes = Object.fromEntries(['language', 'topic', 'mode', 'state', 'messages', 'empty', 'room-title',
  'demo-note', 'start', 'pause', 'end', 'text-start', 'interrupt', 'text-form', 'text-input', 'send',
  'mic-dot', 'mic-status', 'level', 'transcript', 'error', 'latest', 'calls', 'cancelled', 'discarded'].map(id => [id, $(id)]));
const stateLabels = { paused: '대화 준비 · 정지', generating: '친구가 생각 중', speaking: '친구가 말하는 중',
  pacing: '다음 이야기를 기다리는 중', listening: '당신의 말을 듣는 중', ended: '대화 종료' };

let config, session = null, socket = null, heartbeat = null;
let state = 'paused', mode = 'voice', busy = false;
let diagnosticTimer = null;
const messageNodes = new Map();
let diagnosticToken = 0;
let outbox = null, inputPendingId = null;

function submitText(text, fromInput = false) {
  if (!session || !outbox || !text.trim() || text.length > 1000) {
    showError('1~1000자의 발화만 전송할 수 있습니다. 짧게 나눠 말씀해주세요.'); return;
  }
  const existing = fromInput ? outbox.pending().find(item => item.text === text) : null;
  const entry = outbox.enqueue(existing?.id || crypto.randomUUID(), text);
  if (fromInput) inputPendingId = entry.id;
  send({ type: 'user_message', text: entry.text, client_message_id: entry.id });
}

function send(command) {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(command)); return true; }
  showError('서버 연결이 끊겼습니다. 시작 버튼으로 다시 연결해주세요.');
  return false;
}

function showError(message) {
  nodes.error.textContent = message;
  nodes.error.hidden = false;
}
function clearError() { nodes.error.hidden = true; }
function stopPlayback() {
  diagnosticToken += 1;
  clearTimeout(diagnosticTimer);
  voice.player?.cancel();
}

const voice = new BrowserVoice({
  onStart: () => {
    stopPlayback();
    send({ type: 'speech_started' });
  },
  onActivity: () => send({ type: 'speech_activity' }),
  onText: text => submitText(text),
  onPreview: text => { nodes.transcript.textContent = text; },
  onEmpty: () => send({ type: 'speech_cancelled' }),
  onError: message => {
    showError(message);
    send({ type: 'pause' });
  },
  onLevel: value => { nodes.level.value = value; },
  onStatus: text => {
    nodes['mic-status'].textContent = text;
    nodes['mic-dot'].classList.toggle('active', voice.running);
  },
});

function updateStats(stats) {
  for (const key of ['calls', 'cancelled', 'discarded']) nodes[key].textContent = stats?.[key] ?? 0;
}
function updateState(next, stats) {
  state = next;
  nodes.state.textContent = stateLabels[state] || state;
  if (stats) updateStats(stats);
  if (state === 'paused' || state === 'ended') {
    stopPlayback();
    voice.stop();
  }
  updateControls();
}
function updateControls() {
  const active = !['paused', 'ended'].includes(state);
  const connected = socket?.readyState === WebSocket.OPEN;
  nodes.start.disabled = busy || !config || active;
  nodes['text-start'].disabled = busy || !config || active;
  nodes.start.innerHTML = '<span aria-hidden="true">◉</span> ' +
    (busy ? '준비 중…' : session && state === 'paused' ? '음성 대화 재개' : '음성 대화 시작');
  nodes['text-start'].textContent = session && state === 'paused' ? '텍스트 진단 재개' : '텍스트 진단 시작';
  nodes.pause.disabled = (!active && !busy) || !connected;
  nodes.end.disabled = !session || state === 'ended' || !connected;
  nodes.interrupt.disabled = !active || !connected;
  nodes.send.disabled = !connected || state === 'ended';
  nodes.language.disabled = busy || active;
  nodes.topic.disabled = busy || active || !config;
}

function updateDelivery(id, delivery) {
  const item = messageNodes.get(id);
  if (!item) return;
  item.article.classList.toggle('interrupted', delivery === 'interrupted');
  item.status.textContent = ({ interrupted: '발화 중단', played: '재생 완료', pending: '발화 준비' })[delivery] || '';
}

function addMessage(message) {
  if (messageNodes.has(message.id)) { updateDelivery(message.id, message.delivery); return; }
  nodes.empty.hidden = true;
  const nearBottom = nodes.messages.scrollHeight - nodes.messages.scrollTop - nodes.messages.clientHeight < 90;
  const article = document.createElement('article');
  article.className = `message ${message.speaker}`;
  const main = document.createElement('div'); main.className = 'message-main';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const name = document.createElement('span');
  name.textContent = message.speaker === 'user' ? '나' : message.speaker === 'a' ? '민지 · AI' : '준호 · AI';
  const status = document.createElement('span'); status.className = 'delivery';
  meta.append(name, status);
  const text = document.createElement('div'); text.className = 'message-text'; text.textContent = message.text;
  main.append(meta, text);
  if (message.speaker !== 'user') {
    const avatar = document.createElement('span');
    avatar.className = `avatar ${message.speaker === 'a' ? 'minji' : 'junho'}`;
    avatar.textContent = message.speaker === 'a' ? 'M' : 'J';
    avatar.setAttribute('aria-hidden', 'true');
    article.append(avatar);
  }
  article.append(main);
  nodes.messages.append(article);
  messageNodes.set(message.id, { article, status });
  updateDelivery(message.id, message.delivery);
  if (nearBottom || message.speaker === 'user') scrollToLatest();
  else nodes.latest.hidden = false;
}

function scrollToLatest() {
  nodes.messages.scrollTop = nodes.messages.scrollHeight;
  nodes.latest.hidden = true;
}
nodes.latest.addEventListener('click', scrollToLatest);
nodes.messages.addEventListener('scroll', () => {
  if (nodes.messages.scrollHeight - nodes.messages.scrollTop - nodes.messages.clientHeight < 50) nodes.latest.hidden = true;
});

function renderSnapshot(snapshot) {
  outbox?.reconcile(snapshot.messages);
  for (const { article } of messageNodes.values()) article.remove();
  messageNodes.clear();
  nodes.empty.hidden = false;
  snapshot.messages.forEach(addMessage);
  nodes.language.value = snapshot.language;
  nodes.topic.value = snapshot.topic_id;
  for (const option of nodes.topic.options) option.textContent = config.topics.find(t => t.id === option.value)[snapshot.language];
  updateTitle();
  updateStats(snapshot.stats);
  updateState(snapshot.state);
  scrollToLatest();
}

function playMessage(message) {
  if (message.speaker === 'user' || message.delivery !== 'pending') return;
  // Messages from a just-interrupted generation may already be in the socket buffer.
  if (mode === 'voice' && (!voice.running || voice.userSpeaking)) return;
  const finish = () => send({ type: 'playback_finished', message_id: message.id, revision: message.revision });
  if (mode === 'voice') {
    voice.play(message, finish, () => send({ type: 'playback_failed', message_id: message.id, revision: message.revision }));
  } else {
    const token = ++diagnosticToken;
    clearTimeout(diagnosticTimer);
    diagnosticTimer = setTimeout(() => { if (token === diagnosticToken) finish(); }, 1200);
  }
}

async function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;
  const previous = socket;
  previous?.close();
  clearInterval(heartbeat);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/api/sessions/${session.id}/events`);
  socket = ws;
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { ws.close(); reject(new Error('서버 연결 시간이 초과되었습니다.')); }
    }, 7000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', token: session.token }));
    ws.onmessage = event => {
      if (socket !== ws) return;
      const data = JSON.parse(event.data);
      if (data.type === 'snapshot') {
        renderSnapshot(data);
        settled = true; clearTimeout(timeout); resolve();
      } else if (data.type === 'state') updateState(data.state, data.stats);
      else if (data.type === 'message') {
        if (data.message.speaker === 'user') {
          const acknowledged = outbox?.acknowledge(data.message.client_message_id);
          if (data.message.client_message_id === inputPendingId) {
            if (nodes['text-input'].value.trim() === acknowledged?.text) nodes['text-input'].value = '';
            inputPendingId = null;
          }
        }
        addMessage(data.message); playMessage(data.message);
      }
      else if (data.type === 'delivery') updateDelivery(data.message_id, data.delivery);
      else if (data.type === 'interrupt') stopPlayback();
      else if (data.type === 'error') showError(data.message);
    };
    ws.onerror = () => {
      if (!settled) { clearTimeout(timeout); reject(new Error('로컬 서버에 연결하지 못했습니다.')); }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      clearTimeout(timeout); clearInterval(heartbeat);
      stopPlayback(); voice.stop();
      state = state === 'ended' ? 'ended' : 'paused';
      nodes.state.textContent = '연결 끊김 · 정지';
      updateControls();
      if (!settled) reject(new Error('세션 연결이 종료되었습니다. 새 대화를 시작해주세요.'));
    };
  });
  heartbeat = setInterval(() => {
    if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' }));
  }, 10000);
  for (const entry of outbox?.pending() || []) send({ type: 'user_message', text: entry.text, client_message_id: entry.id });
}

async function ensureSession() {
  const language = nodes.language.value, topic_id = nodes.topic.value;
  if (session && session.language === language && session.topic_id === topic_id && state !== 'ended') {
    await connect(); return;
  }
  socket?.close(); socket = null;
  clearInterval(heartbeat);
  const response = await fetch('/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language, topic_id }),
  });
  if (!response.ok) throw new Error('새 대화를 만들지 못했습니다. 서버를 확인해주세요.');
  const data = await response.json();
  session = { id: data.id, token: data.token, language, topic_id };
  outbox = new MessageOutbox(session.id, sessionStorage);
  sessionStorage.setItem('tikitaka_session', JSON.stringify(session));
  await connect();
}

async function start(selectedMode) {
  if (busy) return;
  busy = true; updateControls(); clearError();
  try {
    await ensureSession();
    mode = selectedMode;
    if (mode === 'voice') {
      await voice.start(session.language);
      if (!voice.running) return;
    }
    send({ type: 'resume' });
    if (mode === 'voice' && voice.userSpeaking) send({ type: 'speech_started' });
  } catch (error) { voice.stop(); showError(error.message); }
  finally { busy = false; updateControls(); }
}

nodes.start.addEventListener('click', () => start('voice'));
nodes['text-start'].addEventListener('click', () => start('text'));
nodes.pause.addEventListener('click', () => { stopPlayback(); voice.stop(); send({ type: 'pause' }); });
nodes.end.addEventListener('click', () => { stopPlayback(); voice.stop(); send({ type: 'end' }); });
nodes.interrupt.addEventListener('click', () => { stopPlayback(); send({ type: 'speech_started' }); });
nodes['text-form'].addEventListener('submit', event => {
  event.preventDefault();
  const text = nodes['text-input'].value.trim();
  if (!text || !session) return;
  clearError(); stopPlayback();
  submitText(text, true);
});

function updateTitle() {
  const topic = config?.topics.find(t => t.id === nodes.topic.value);
  nodes['room-title'].textContent = topic?.[nodes.language.value] || '오늘의 대화';
}
function resetForNewSetup() {
  if (session && (session.language !== nodes.language.value || session.topic_id !== nodes.topic.value)) {
    if (outbox?.pending().length) {
      nodes.language.value = session.language;
      nodes.topic.value = session.topic_id;
      for (const option of nodes.topic.options) option.textContent = config.topics.find(t => t.id === option.value)[session.language];
      showError('전송 대기 중인 말이 있습니다. 대화를 재개해 서버 수신을 확인한 뒤 주제를 바꿔주세요.');
      return;
    }
    socket?.close(); socket = null;
    clearInterval(heartbeat);
    stopPlayback(); voice.stop();
    session = null;
    outbox = null; inputPendingId = null;
    sessionStorage.removeItem('tikitaka_session');
    for (const { article } of messageNodes.values()) article.remove();
    messageNodes.clear();
    nodes.empty.hidden = false;
    nodes.latest.hidden = true;
    updateStats({});
    updateState('paused');
  }
  updateTitle();
}
nodes.topic.addEventListener('change', resetForNewSetup);
nodes.language.addEventListener('change', () => {
  for (const option of nodes.topic.options) option.textContent = config.topics.find(t => t.id === option.value)[nodes.language.value];
  resetForNewSetup();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !['paused', 'ended'].includes(state)) {
    stopPlayback(); voice.stop(); send({ type: 'pause' });
  }
});
window.addEventListener('pagehide', () => { voice.stop(); socket?.close(); });

async function init() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('서버 설정을 불러오지 못했습니다.');
    config = await response.json();
    nodes.mode.textContent = config.mode === 'demo' ? '대본 데모' : '실제 AI';
    nodes['demo-note'].textContent = config.mode === 'demo'
      ? '대본 기반 데모로 대화 흐름을 시험해요. 실제 AI 대화는 서버 설정으로 연결할 수 있어요.'
      : '연결한 AI 모델과 대화합니다. 생성 요청에 API 사용료가 발생할 수 있어요.';
    nodes.topic.replaceChildren(...config.topics.map(topic => {
      const option = document.createElement('option'); option.value = topic.id; option.textContent = topic.ko; return option;
    }));
    updateTitle(); updateControls();
    const saved = sessionStorage.getItem('tikitaka_session');
    if (saved) {
      const candidate = JSON.parse(saved);
      const result = await fetch(`/api/sessions/${candidate.id}`, { headers: { 'X-Session-Token': candidate.token } });
      if (result.ok) { session = candidate; outbox = new MessageOutbox(session.id, sessionStorage); await connect(); }
      else sessionStorage.removeItem('tikitaka_session');
    }
  } catch (error) { showError(error.message); updateControls(); }
}
init();

