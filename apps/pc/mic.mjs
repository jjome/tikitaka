import { acquireMicrophone, rememberMicrophone } from './microphone.mjs';

const device = document.getElementById('device'), button = document.getElementById('check');
const meter = document.getElementById('level'), result = document.getElementById('result'), source = document.getElementById('source');
let resources = null, intent = 0, active = false, cancel = null, savedDevice = '', explicitSelection = false, deviceListVersion = 0;
let diagnosticSession = null;
try { savedDevice = localStorage.getItem('tikitaka_microphone') || ''; } catch {}

async function prepareReportSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('tikitaka_simple_session') || 'null');
    if (saved && typeof saved.id === 'string' && typeof saved.token === 'string') { diagnosticSession = saved; return; }
    const response = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) return;
    const data = await response.json();
    diagnosticSession = { id: data.id, token: data.token, language: data.snapshot.language };
    sessionStorage.setItem('tikitaka_simple_session', JSON.stringify(diagnosticSession));
  } catch {}
}
function report(r) {
  if (!diagnosticSession) return;
  const track = r.stream.getAudioTracks()[0];
  fetch(`/api/sessions/${encodeURIComponent(diagnosticSession.id)}/audio-diagnostics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': diagnosticSession.token },
    body: JSON.stringify({ build: '2026-10-02-mic-probe-1', source: (track.label || '').slice(0, 160),
      context_state: r.context.state, track_state: track.readyState, muted: track.muted, enabled: track.enabled,
      peak: Math.min(1, r.peak), frames: r.frames, speech_starts: 0, results: 0, recognition_error: '' }),
  }).catch(() => {});
}

function stop() {
  intent++; active = false; cancel?.(); cancel = null;
  if (resources) {
    report(resources);
    clearTimeout(resources.timer);
    resources.source?.disconnect(); resources.analyser?.disconnect(); resources.sink?.disconnect();
    resources.stream?.getTracks().forEach(track => track.stop());
    resources.context?.close().catch(() => {});
    resources = null;
  }
  meter.value = 0; button.textContent = '마이크 확인 시작';
}
async function listDevices(selected, label = '') {
  const version = ++deviceListVersion;
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  if (version !== deviceListVersion) return;
  device.replaceChildren(new Option('Chrome 기본 마이크', ''), ...inputs
    .filter(d => !['default', 'communications'].includes(d.deviceId))
    .map((d, i) => new Option(d.label || `마이크 ${i + 1}`, d.deviceId)));
  if ([...device.options].some(option => option.value === selected)) device.value = selected;
  if (label) {
    const matched = inputs.filter(d => !['default', 'communications'].includes(d.deviceId) && d.label === label);
    if (matched.length === 1) device.value = matched[0].deviceId;
  }
}
async function start() {
  stop();
  const attempt = intent;
  active = true; button.textContent = '점검 끝내기'; result.textContent = '마이크를 준비하고 있어요…'; source.textContent = '';
  const selected = device.value;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저에서 마이크를 사용할 수 없습니다.');
    const capture = acquireMicrophone({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    }, () => attempt === intent, explicitSelection ? selected : undefined);
    capture.then(stream => { if (stream && attempt !== intent) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
    const cancelled = new Promise(resolve => { cancel = () => resolve(null); });
    const stream = await Promise.race([capture, cancelled]);
    if (!stream || attempt !== intent) return;
    const r = { stream, context: new AudioContext(), peak: 0, frames: 0, lastReport: -Infinity };
    resources = r;
    await Promise.race([r.context.resume(), cancelled]);
    if (attempt !== intent) return;
    r.source = r.context.createMediaStreamSource(stream);
    r.analyser = r.context.createAnalyser(); r.analyser.fftSize = 1024;
    r.sink = r.context.createGain(); r.sink.gain.value = 0;
    r.source.connect(r.analyser); r.analyser.connect(r.sink); r.sink.connect(r.context.destination);
    const values = new Float32Array(r.analyser.fftSize), track = stream.getAudioTracks()[0];
    if (explicitSelection && selected && track.label) rememberMicrophone(selected, track.label);
    const poll = () => {
      if (attempt !== intent) return;
      r.analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
      r.peak = Math.max(r.peak, rms); meter.value = Math.min(1, rms * 70);
      r.frames++;
      if (performance.now() - r.lastReport > 1000) { r.lastReport = performance.now(); report(r); }
      result.textContent = r.peak > .0001 ? '마이크 신호가 들어오고 있어요. 말할 때 막대가 움직이는지 확인하세요.' : '입력 신호를 기다리고 있어요. 평소 목소리로 말해주세요.';
      source.textContent = `현재 입력: ${track.label || '이름 확인 불가'}\n${track.muted ? '장치 신호 없음' : '장치 연결됨'} · ${r.context.state === 'running' ? '입력 분석 중' : '입력 분석 정지'} · 최대 입력 ${r.peak.toFixed(5)}`;
      r.timer = setTimeout(poll, 30);
    };
    poll();
    prepareReportSession();
    listDevices(selected, track.label).catch(() => {});
  } catch (error) {
    if (attempt !== intent) return;
    stop();
    result.textContent = error.name === 'NotAllowedError' ? '이 주소의 마이크 권한을 허용해주세요.' :
      error.name === 'OverconstrainedError' ? '이 마이크를 찾을 수 없습니다. 기본 마이크를 선택해주세요.' : error.message;
    listDevices('').catch(() => {});
  }
}
button.addEventListener('click', () => { if (active) { stop(); result.textContent = '점검 종료'; } else start(); });
device.addEventListener('change', () => {
  explicitSelection = true; deviceListVersion++;
  rememberMicrophone(device.value, device.selectedOptions[0]?.textContent || '');
  if (active) start();
});
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
listDevices(savedDevice).catch(() => {});
