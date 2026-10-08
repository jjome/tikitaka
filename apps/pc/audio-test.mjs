import { ApiVoice } from './api-voice.mjs';

const file = document.getElementById('fixture'), run = document.getElementById('run');
const stopButton = document.getElementById('stop'), status = document.getElementById('status'), reportNode = document.getElementById('report');
let voice, socket, session, inputContext, inputSource, timer, heartbeat, injectionTimer, finished = true, report;
const show = () => { reportNode.textContent = JSON.stringify(report, null, 2); };
const send = command => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command)); };
function stop(error = '') {
  if (finished) return;
  finished = true; clearTimeout(timer); clearTimeout(injectionTimer); clearInterval(heartbeat);
  voice?.stop(); send({ type: 'end' }); socket?.close(); inputContext?.close().catch(() => {});
  run.disabled = false; stopButton.disabled = true;
  report.status = error ? 'failed' : 'passed'; if (error) report.error = error;
  status.textContent = error ? `점검 중단: ${error}` : report.provider === 'demo' ?
    '모의 API 통과 · 끼어들기와 준호·민지 재생 완료 (실제 음성 인식·GPT 검증 아님)' :
    '통과 · 음성 인식, 끼어들기, 준호와 민지 응답 및 재생 완료'; show();
}
run.addEventListener('click', async () => {
  if (!finished) return;
  const fixture = file.files[0];
  const language = document.getElementById('language').value;
  if (!fixture) { status.textContent = '합성 음성 WAV 파일을 선택해주세요.'; return; }
  finished = false; run.disabled = true; stopButton.disabled = false;
  report = { status: 'running', language, source: 'synthetic_audio_file', transcript: '', speakers: [], played: [], interruptions: 0, cancelled_audio_stayed_stopped: false };
  show(); status.textContent = '음성 시험을 준비하고 있어요';
  timer = setTimeout(() => stop('90초 안에 완료하지 못했습니다.'), 90000);
  try {
    const config = await (await fetch('/api/config')).json();
    report.provider = config.mode; show();
    if (config.voice_transport !== 'api') throw new Error('API 음성 서버가 필요합니다.');
    inputContext = new AudioContext({ sampleRate: 48000 }); await inputContext.resume();
    const decoded = await inputContext.decodeAudioData(await fixture.arrayBuffer());
    if (decoded.duration > 15) throw new Error('15초 이하의 점검 파일을 사용해주세요.');
    const destination = inputContext.createMediaStreamDestination();
    inputSource = inputContext.createBufferSource(); inputSource.buffer = decoded; inputSource.connect(destination);
    const response = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: 'food', language }) });
    if (!response.ok) throw new Error('테스트 세션을 만들지 못했습니다.');
    session = await response.json();
    if (finished) return;
    voice = new ApiVoice({
      captureMicrophone: async () => destination.stream,
      onStart: () => {
        report.interruptions++; report.cancelled_audio_stayed_stopped = voice.player.current === null && voice.playingSource === null;
        send({ type: 'speech_started' }); show();
      },
      onActivity: () => send({ type: 'speech_activity' }),
      onText: text => {
        report.transcript = text; show();
        send({ type: 'user_message', text, client_message_id: crypto.randomUUID() });
      },
      onPreview() {}, onLevel() {}, onEmpty: () => stop('점검 음성을 인식하지 못했습니다.'),
      onError: error => stop(error), onStatus: text => { if (!finished) status.textContent = text; },
      onOutputStart: message => {
        if (report.speakers.length === 1) {
          injectionTimer = setTimeout(() => { if (!finished) inputSource.start(); }, 300);
        }
      },
    });
    voice.session = session;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/sessions/${session.id}/events`);
    await new Promise((resolve, reject) => {
      socket.onopen = () => send({ type: 'authenticate', token: session.token });
      socket.onerror = () => { reject(new Error('서버 연결 실패')); stop('서버 연결 실패'); };
      socket.onmessage = event => {
        const data = JSON.parse(event.data);
        if (finished) return;
        if (data.type === 'snapshot') resolve();
        else if (data.type === 'error') stop(data.message);
        else if (data.type === 'message' && data.message.speaker !== 'user') {
          const message = data.message; report.speakers.push(message.speaker); show();
          if (report.speakers.length > 3) { stop('AI 응답 상한을 넘었습니다.'); return; }
          voice.play(message, () => {
            report.played.push(message.speaker); show();
            if (report.speakers.length === 3) {
              const passed = report.speakers.join(',') === 'a,b,a' && report.played.join(',') === 'b,a' &&
                report.transcript.toLowerCase().includes(language === 'ko' ? '겨울' : 'winter') && report.interruptions > 0 && report.cancelled_audio_stayed_stopped;
              stop(passed ? '' : '발화 순서 또는 끼어들기 결과를 확인해주세요.');
            } else send({ type: 'playback_finished', message_id: message.id, revision: message.revision });
          }, error => stop(error));
        }
      };
    });
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10000);
    await voice.start(language);
    if (!finished) send({ type: 'resume' });
  } catch (error) { stop(error.message); }
});
stopButton.addEventListener('click', () => stop('사용자가 중지했습니다.'));
window.addEventListener('pagehide', () => stop('화면을 닫았습니다.'));
