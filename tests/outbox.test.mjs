import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageOutbox } from '../apps/pc/outbox.mjs';
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
};
test('unacknowledged voice text survives reload with the same message ID', () => {
  const s = storage(), first = new MessageOutbox('s1', s);
  first.enqueue('u1', '난 반대야');
  assert.deepEqual(new MessageOutbox('s1', s).pending(), [{ id: 'u1', text: '난 반대야' }]);
});
test('acknowledged user text is not retried', () => {
  const box = new MessageOutbox('s', storage());
  box.enqueue('u', '안녕'); box.acknowledge('u');
  assert.deepEqual(box.pending(), []);
});
test('reconnect snapshot clears already committed messages', () => {
  const box = new MessageOutbox('s', storage());
  box.enqueue('u1', '하나'); box.enqueue('u2', '둘');
  box.reconcile([{ speaker: 'user', client_message_id: 'u1' }]);
  assert.deepEqual(box.pending(), [{ id: 'u2', text: '둘' }]);
});
test('outbox records are isolated between conversations', () => {
  const s = storage(); new MessageOutbox('s1', s).enqueue('u', '안녕');
  assert.deepEqual(new MessageOutbox('s2', s).pending(), []);
});
