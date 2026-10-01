// Runs the actual PC controller against the local API; only mic/STT/TTS and DOM are simulated.
import assert from 'node:assert/strict';
import { fixture } from './helpers/pc-harness.mjs';
const base = 'http://127.0.0.1:8100';
const realFetch = globalThis.fetch;
const interimOnly = process.argv.includes('--interim-only');
const health = await (await realFetch(`${base}/api/health`)).json();
assert.equal(health.mode, 'demo', 'This test must never make paid model calls.');
const waitFor = async predicate => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Conversation did not advance within 10 seconds.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const f = await fixture(null, { liveServer: base });
try {
  f.node('talk').click();
  await waitFor(() => f.voices.length === 1);
  const first = f.voices[0];
  const recognizer = f.recognitions[0];
  const userText = '준호, 나는 겨울이 더 좋아. 여름은 너무 더워.';
  recognizer.finalText = interimOnly ? '' : userText;
  const interim = [{ transcript: userText }]; interim.isFinal = false;
  recognizer.onspeechstart(); recognizer.onresult({ results: [interim] }); recognizer.onspeechend();
  first.onend(); // This late callback must not acknowledge interrupted AI audio.
  await waitFor(() => f.voices.length === 2);
  assert.ok(f.voices[1].text.includes(userText));
  const userCommands = f.records.filter(r => r.type === 'user_message');
  assert.equal(userCommands.length, 1);
  assert.equal(f.records.filter(r => r.type === 'playback_finished').length, 0);
  f.voices[1].onend();
  await waitFor(() => f.voices.length === 3);
  f.voices[2].onend();
  await waitFor(() => f.voices.length === 4);
  if (interimOnly) {
    await waitFor(() => recognizer.startCalls >= 2);
    const next = [{ transcript: '민지, 나는 가을도 좋아.' }]; next.isFinal = false;
    recognizer.onspeechstart(); recognizer.onresult({ results: [next] }); recognizer.onspeechend();
    f.voices[3].onend(); // Ignore completion of the second interrupted AI utterance too.
    await waitFor(() => f.voices.length === 5);
    assert.ok(f.voices[4].text.includes(next[0].transcript));
  }
  const session = f.session();
  const response = await realFetch(`${base}/api/sessions/${session.id}`, { headers: { 'X-Session-Token': session.token } });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.deepEqual(report.messages.map(m => m.speaker), interimOnly ? ['a', 'user', 'b', 'a', 'b', 'user', 'a'] : ['a', 'user', 'b', 'a', 'b']);
  assert.equal(report.messages[0].delivery, 'interrupted');
  assert.equal(report.messages[1].text, userText);
  assert.equal(f.records.filter(r => r.type === 'user_message').length, interimOnly ? 2 : 1);
  assert.equal(report.state, 'speaking');
  assert.equal(f.node('talk').textContent, '대화 끝내기');
  console.log(JSON.stringify({ result: 'passed', user_text: userCommands[0].text,
    ai_utterances: f.voices.length, forced_finalizations: recognizer.stopCalls,
    user_messages: f.records.filter(r => r.type === 'user_message').length, recognizer_final_results: !interimOnly,
    interrupted_callback_ignored: true, provider: health.mode }));
} finally { await f.cleanup(); }
