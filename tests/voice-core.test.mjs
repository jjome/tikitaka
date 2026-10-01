import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptBuffer, PlaybackGuard, ActivityGate } from '../apps/pc/voice-core.mjs';

function bufferHarness() {
  let timer = null;
  const committed = [], previews = [], empty = [];
  const buffer = new TranscriptBuffer({
    onCommit: text => committed.push(text), onPreview: text => previews.push(text), onEmpty: () => empty.push(true),
    schedule: callback => { timer = callback; return 1; }, unschedule: () => { timer = null; },
  });
  const tick = () => { const callback = timer; timer = null; callback?.(); };
  return { buffer, committed, previews, empty, tick };
}

test('interim transcript is never committed even after speech end', () => {
  const h = bufferHarness();
  h.buffer.feed([{ key: '1:0', text: '나는', final: false }]);
  h.buffer.speechEnded(); h.tick();
  assert.deepEqual(h.committed, []);
  assert.equal(h.previews.at(-1), '나는');
});
test('final chunks are merged into one utterance', () => {
  const h = bufferHarness();
  h.buffer.feed([{ key: '1:0', text: '나는 짜장', final: true }]);
  h.buffer.activity();
  h.buffer.feed([{ key: '1:1', text: '그게 더 좋아', final: true }]);
  h.tick();
  assert.deepEqual(h.committed, ['나는 짜장 그게 더 좋아']);
});
test('repeated browser result does not create a duplicate message', () => {
  const h = bufferHarness();
  const item = { key: '1:0', text: '안녕', final: true };
  h.buffer.feed([item]); h.tick();
  h.buffer.feed([item]); h.tick();
  assert.deepEqual(h.committed, ['안녕']);
});
test('speech activity cancels an early endpoint timer', () => {
  const h = bufferHarness();
  h.buffer.feed([{ key: '1:0', text: '그런데', final: true }]);
  h.buffer.activity(); h.tick();
  assert.deepEqual(h.committed, []);
});
test('pause clears pending transcript instead of committing later', () => {
  const h = bufferHarness();
  h.buffer.feed([{ key: '1:0', text: '멈춰', final: true }]);
  h.buffer.reset(); h.tick();
  assert.deepEqual(h.committed, []);
});
test('noise with no transcript can release the user turn', () => {
  const h = bufferHarness();
  h.buffer.speechEnded(); h.tick();
  assert.equal(h.empty.length, 1);
});
test('new recognition cycle uses a distinct result identity', () => {
  const h = bufferHarness();
  h.buffer.feed([{ key: '1:0', text: '안녕', final: true }]); h.tick();
  h.buffer.feed([{ key: '2:0', text: '안녕', final: true }]); h.tick();
  assert.deepEqual(h.committed, ['안녕', '안녕']);
});
test('late completion after playback cancellation is ignored', () => {
  const utterances = [], finishes = [], errors = [];
  const synth = { cancel() {}, speak(u) { utterances.push(u); } };
  const player = new PlaybackGuard(synth, text => ({ text }));
  player.play({ id: 'a', text: '안녕', speaker: 'a' }, { language: 'ko', onFinish: x => finishes.push(x), onError: e => errors.push(e) });
  player.cancel();
  utterances[0].onend(); utterances[0].onerror({ error: 'cancelled' });
  assert.deepEqual(finishes, []); assert.deepEqual(errors, []);
});
test('replacing playback invalidates the previous utterance', () => {
  const utterances = [], finishes = [];
  const player = new PlaybackGuard({ cancel() {}, speak(u) { utterances.push(u); } }, text => ({ text }));
  const options = { language: 'en', onFinish: x => finishes.push(x.id), onError() {} };
  player.play({ id: 'a', text: 'Hello', speaker: 'a' }, options);
  player.play({ id: 'b', text: 'Hi', speaker: 'b' }, options);
  utterances[0].onend(); utterances[1].onend();
  assert.deepEqual(finishes, ['b']);
});

test('brief noise spike does not interrupt playback', () => {
  let starts = 0;
  const gate = new ActivityGate({ onStart: () => starts++, onEnd() {} });
  gate.process(.1, 0); gate.process(.1, 50); gate.process(0, 80);
  assert.equal(starts, 0);
});
test('sustained microphone energy triggers one immediate local interruption', () => {
  let starts = 0, ends = 0;
  const gate = new ActivityGate({ onStart: () => starts++, onEnd: () => ends++ });
  gate.process(.1, 0); gate.process(.1, 120); gate.process(.1, 150);
  assert.equal(starts, 1);
  gate.process(0, 250); assert.equal(ends, 0);
  gate.process(0, 350); assert.equal(ends, 1);
});
test('activity detector resets its state when microphone stops', () => {
  let starts = 0;
  const gate = new ActivityGate({ onStart: () => starts++, onEnd() {} });
  gate.process(.1, 0); gate.process(.1, 200); gate.reset();
  gate.process(.1, 400); gate.process(.1, 600);
  assert.equal(starts, 2);
});

