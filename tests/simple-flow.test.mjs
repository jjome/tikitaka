import test from 'node:test';
import assert from 'node:assert/strict';

import { fixture, tick } from './helpers/pc-harness.mjs';

test('one click selects a topic automatically, opens voice, and starts the AI; same button ends', async () => {
  const requests = [];
  const f = await fixture(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: 's1', token: 'token', snapshot: { language: 'ko' } }) };
  });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.deepEqual(requests, [{ language: 'ko', topic_id: 'auto' }]);
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices[0].text, '먼저 이야기할게요.');
    assert.equal(f.node('talk').textContent, '대화 끝내기');
    f.node('talk').click(); await tick();
    assert.equal(f.records.filter(r => r.type === 'end').length, 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
    assert.equal(f.stopped(), 1);
  } finally { await f.cleanup(); }
});

test('cancelled preparation cannot overwrite a restarted session or start late audio', async () => {
  let resolveFirst;
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return { ok: true, json: async () => ({ id: 'new', token: 'new-token', snapshot: { language: 'ko' } }) };
  });
  try {
    f.node('talk').click(); await tick();
    f.node('talk').click();
    f.node('talk').click(); await tick(); await tick();
    resolveFirst({ ok: true, json: async () => ({ id: 'obsolete', token: 'old-token', snapshot: { language: 'ko' } }) });
    await tick();
    assert.deepEqual(f.records.filter(r => r.type === 'authenticate').map(r => r.token), ['new-token']);
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices.length, 1);
    assert.equal(f.node('talk').textContent, '대화 끝내기');
  } finally { await f.cleanup(); }
});

const sessionResponse = async () => ({ ok: true, json: async () => ({ id: 's1', token: 'token', snapshot: { language: 'ko' } }) });

test('AI must wait for actual recognition readiness, not just microphone access', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    f.recognitions[0].onstart(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 1);
    assert.equal(f.voices.length, 1);
  } finally { await f.cleanup(); }
});

test('embedded recognition network failure prevents AI start and releases capture', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    f.recognitions[0].onerror({ error: 'network' }); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    assert.equal(f.stopped(), 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
    assert.equal(f.node('error').hidden, false);
    assert.match(f.node('error').textContent, /별도 Google Chrome/);
  } finally { await f.cleanup(); }
});

test('cancel while recognition connects cannot start AI on a late ready event', async () => {
  const f = await fixture(sessionResponse, { waitForRecognition: true });
  try {
    f.node('talk').click(); await tick(); await tick();
    const recognizer = f.recognitions[0];
    f.node('talk').click(); await tick();
    recognizer.onstart(); await tick();
    assert.equal(f.records.filter(r => r.type === 'resume').length, 0);
    assert.equal(f.voices.length, 0);
    assert.equal(f.stopped(), 1);
    assert.equal(f.node('talk').textContent, '대화 시작');
  } finally { await f.cleanup(); }
});

test('quiet microphone audio alone stops AI immediately without waiting for STT or server', async () => {
  const f = await fixture(sessionResponse);
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.equal(f.recognitions[0].input, f.track);
    assert.equal(f.sinks[0].gain.value, 0); // Never play the user's microphone back through speakers.
    await new Promise(resolve => setTimeout(resolve, 250)); // Silent ambient estimation.
    const before = f.cancelled();
    f.audioLevel(.012); // Below the previous fixed .035 threshold.
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.ok(f.cancelled() > before);
    assert.equal(f.records.filter(r => r.type === 'speech_started').length, 1);
    assert.equal(f.node('status').textContent, '당신의 이야기를 듣고 있어요');
    f.voices[0].onend(); // An interrupted browser utterance must not advance AI.
    assert.equal(f.records.filter(r => r.type === 'playback_finished').length, 0);
  } finally { await f.cleanup(); }
});

test('microphone chosen in the check page is used by conversation; diagnostics omit audio and device IDs', async () => {
  const f = await fixture(sessionResponse, { microphone: 'chosen-device' });
  try {
    f.node('talk').click(); await tick(); await tick();
    assert.deepEqual(f.constraints[0].audio.deviceId, { exact: 'chosen-device' });
    const report = f.reports[0];
    assert.equal(report.source, 'Test microphone');
    assert.equal(report.enabled, true);
    assert.equal(report.muted, false);
    assert.match(report.build, /endpoint/);
    for (const key of ['audio', 'deviceId', 'text', 'token']) assert.equal(key in report, false);
  } finally { await f.cleanup(); }
});

test('interim words shown on screen are finalized after silence and sent once', async () => {
  const f = await fixture(sessionResponse);
  try {
    f.node('talk').click(); await tick(); await tick();
    const recognizer = f.recognitions[0]; recognizer.finalText = '나는 겨울이 더 좋아';
    const interim = [{ transcript: recognizer.finalText }]; interim.isFinal = false;
    recognizer.onspeechstart(); recognizer.onresult({ results: [interim] }); recognizer.onspeechend();
    assert.equal(f.node('caption').textContent, '나는 겨울이 더 좋아');
    assert.equal(f.records.filter(r => r.type === 'user_message').length, 0);
    await new Promise(resolve => setTimeout(resolve, 2600));
    assert.equal(recognizer.stopCalls, 1);
    assert.deepEqual(f.records.filter(r => r.type === 'user_message').map(r => r.text), ['나는 겨울이 더 좋아']);
  } finally { await f.cleanup(); }
});

test('stable interim text can finish even if the recognizer never emits speechend', async () => {
  const f = await fixture(sessionResponse);
  try {
    f.node('talk').click(); await tick(); await tick();
    await new Promise(resolve => setTimeout(resolve, 250));
    f.audioLevel(.012); // Steady residual input must not keep the final text waiting forever.
    const recognizer = f.recognitions[0]; // No final result even when stop() is requested.
    const interim = [{ transcript: '나는 반대야' }]; interim.isFinal = false;
    recognizer.onresult({ results: [interim] });
    await new Promise(resolve => setTimeout(resolve, 3900));
    assert.equal(recognizer.stopCalls, 1);
    assert.equal(f.records.filter(r => r.type === 'user_message').length, 1);
    assert.equal(f.records.find(r => r.type === 'user_message').text, '나는 반대야');
  } finally { await f.cleanup(); }
});

test('recognition ending without isFinal sends the last text once and keeps the conversation active', async () => {
  const f = await fixture(sessionResponse);
  try {
    f.node('talk').click(); await tick(); await tick();
    const recognizer = f.recognitions[0];
    const interim = [{ transcript: '안녕 내 말이 들려 들려' }]; interim.isFinal = false;
    recognizer.onresult({ results: [interim] }); recognizer.onspeechend();
    await new Promise(resolve => setTimeout(resolve, 1400));
    assert.equal(recognizer.stopCalls, 1);
    assert.deepEqual(f.records.filter(r => r.type === 'user_message').map(r => r.text), ['안녕 내 말이 들려 들려']);
    assert.equal(f.node('talk').textContent, '대화 끝내기');
    assert.equal(f.node('error').hidden, true);
    assert.equal(f.stopped(), 0);
  } finally { await f.cleanup(); }
});
