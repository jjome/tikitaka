import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmPlayer } from '../apps/pc/pcm-player.mjs';

function fixture() {
  const sources = []; let started = 0, finished = 0;
  const context = { currentTime: 1, destination: {},
    createBuffer(channels, length, rate) {
      const values = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => values };
    },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  const player = new PcmPlayer(context, { onStart: () => started++, onFinish: () => finished++ });
  return { player, sources, context, started: () => started, finished: () => finished };
}

test('PCM starts before EOF, preserves odd packet boundaries, and finishes only after last audio ends', () => {
  const f = fixture();
  const data = new Uint8Array(9600);
  const view = new DataView(data.buffer);
  for (let i = 0; i < 4800; i++) view.setInt16(i * 2, i % 2 ? 32767 : -32768, true);
  f.player.push(data.slice(0, 4801));
  assert.equal(f.started(), 1); assert.equal(f.finished(), 0);
  assert.equal(f.sources[0].at, 1.1);
  f.player.push(data.slice(4801));
  assert.deepEqual([...f.sources.flatMap(source => [...source.buffer.getChannelData(0)])],
    Array.from({ length: 4800 }, (_, i) => i % 2 ? 32767 / 32768 : -1));
  assert.equal(f.sources[1].at, f.sources[0].at + .1);
  f.sources[0].onended(); assert.equal(f.finished(), 0);
  f.player.end(); assert.equal(f.finished(), 0);
  f.sources[1].onended(); assert.equal(f.finished(), 1);
});

test('interruption stops all scheduled chunks and late callbacks cannot finish playback', () => {
  const f = fixture(); f.player.push(new Uint8Array(4800)); f.player.push(new Uint8Array(4800));
  const late = f.sources[1].onended;
  f.player.cancel(); f.player.push(new Uint8Array(4800)); late();
  assert.ok(f.sources.every(source => source.stopped));
  assert.equal(f.sources.length, 2); assert.equal(f.finished(), 0);
});

test('empty or truncated PCM is rejected, and short valid audio is played', () => {
  for (const size of [0, 3]) {
    const f = fixture(); f.player.push(new Uint8Array(size));
    assert.throws(() => f.player.end()); assert.equal(f.finished(), 0);
  }
  const f = fixture(); f.player.push(new Uint8Array(100)); f.player.end();
  assert.equal(f.sources.length, 1); assert.equal(f.finished(), 0);
  f.sources[0].onended(); assert.equal(f.finished(), 1);
});
