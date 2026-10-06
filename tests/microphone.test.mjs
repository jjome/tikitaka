import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireMicrophone, rememberMicrophone } from '../apps/pc/microphone.mjs';

function setup({ cookieLabel, localId = '', localLabel = '', profileLabel, devices = [] } = {}) {
  const originals = new Map(['window', 'document', 'navigator', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const store = new Map([['tikitaka_microphone', localId], ['tikitaka_microphone_label', localLabel]]);
  const requests = [], streams = [];
  const media = {
    async enumerateDevices() { return devices; },
    async getUserMedia(options) {
      requests.push(options);
      const stream = { stopped: 0, getTracks() { return [{ stop: () => stream.stopped++ }]; } };
      streams.push(stream); return stream;
    },
  };
  const globals = {
    window: { location: { hostname: '127.0.0.1' }, localStorage: { getItem: key => store.get(key) || '', setItem: (key, value) => store.set(key, value) } },
    document: { cookie: cookieLabel === undefined ? '' : `tikitaka_microphone_choice=${encodeURIComponent(JSON.stringify({ label: cookieLabel }))}` },
    navigator: { mediaDevices: media },
    fetch: async () => ({ ok: profileLabel !== undefined, json: async () => ({ label: profileLabel }) }),
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { requests, streams, store, media, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  } };
}
const usb = { kind: 'audioinput', deviceId: 'new-origin-usb-id', label: 'USB microphone' };
const realtek = { kind: 'audioinput', deviceId: 'wrong-input', label: 'Realtek' };

test('a choice shared across ports resolves the current device ID rather than the old origin ID', async () => {
  const f = setup({ cookieLabel: usb.label, localId: 'old-origin-id', localLabel: usb.label,
    devices: [realtek, { ...usb, deviceId: 'default' }, usb] });
  try {
    await acquireMicrophone({ echoCancellation: true });
    assert.deepEqual(f.requests, [{ audio: { echoCancellation: true, deviceId: { exact: usb.deviceId } } }]);
    assert.equal(f.store.get('tikitaka_microphone'), usb.deviceId);
    assert.equal(f.streams[0].stopped, 0);
    assert.ok(!document.cookie.includes('old-origin-id'));
    assert.ok(!document.cookie.includes(usb.deviceId));
  } finally { f.restore(); }
});

test('this PC recovery preference replaces a legacy wrong microphone', async () => {
  const f = setup({ localId: realtek.deviceId, profileLabel: usb.label, devices: [realtek, usb] });
  try {
    await acquireMicrophone({});
    assert.equal(f.requests[0].audio.deviceId.exact, usb.deviceId);
  } finally { f.restore(); }
});

test('a newer explicit choice takes priority over the PC recovery preference', async () => {
  const f = setup({ cookieLabel: realtek.label, profileLabel: usb.label, devices: [realtek, usb] });
  try {
    await acquireMicrophone({});
    assert.equal(f.requests[0].audio.deviceId.exact, realtek.deviceId);
  } finally { f.restore(); }
});

test('hidden labels are revealed by permission, then the default capture is released before selecting USB', async () => {
  const f = setup({ cookieLabel: usb.label });
  let enumerations = 0;
  f.media.enumerateDevices = async () => ++enumerations === 1 ? [{ ...usb, label: '' }] : [usb];
  try {
    const stream = await acquireMicrophone({});
    assert.deepEqual(f.requests.map(r => r.audio.deviceId?.exact || ''), ['', usb.deviceId]);
    assert.equal(f.streams[0].stopped, 1);
    assert.equal(stream.stopped, 0);
  } finally { f.restore(); }
});

test('a missing or ambiguous microphone cannot silently start on the wrong input', async () => {
  for (const devices of [[realtek], [usb, { ...usb, deviceId: 'duplicate' }]]) {
    const f = setup({ cookieLabel: usb.label, devices });
    try {
      await assert.rejects(acquireMicrophone({}), /저장한 마이크를 찾을 수 없습니다/);
      assert.equal(f.requests.length, 1);
      assert.equal(f.streams[0].stopped, 1);
    } finally { f.restore(); }
  }
});

test('cancellation closes a late permission capture and never opens the preferred microphone', async () => {
  const f = setup({ cookieLabel: usb.label });
  let current = true, grant;
  const stream = { stopped: 0, getTracks() { return [{ stop: () => stream.stopped++ }]; } };
  f.media.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  try {
    const capture = acquireMicrophone({}, () => current);
    await new Promise(resolve => setTimeout(resolve, 0));
    current = false; grant(stream);
    assert.equal(await capture, null);
    assert.equal(stream.stopped, 1);
  } finally { f.restore(); }
});

test('choosing default explicitly clears the previous microphone across ports', async () => {
  const f = setup({ localId: 'old-origin-id', profileLabel: usb.label, devices: [usb] });
  try {
    rememberMicrophone('');
    await acquireMicrophone({});
    assert.deepEqual(f.requests, [{ audio: {} }]);
  } finally { f.restore(); }
});
