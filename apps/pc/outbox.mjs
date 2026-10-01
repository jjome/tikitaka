/** Stable IDs make reconnect retries safe with the server's idempotent message handler. */
export class MessageOutbox {
  constructor(sessionId, storage) {
    this.key = `tikitaka_outbox_${sessionId}`;
    this.storage = storage;
    this.items = new Map();
    try {
      const saved = JSON.parse(storage.getItem(this.key) || '[]');
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (typeof item.id === 'string' && typeof item.text === 'string') this.items.set(item.id, item);
        }
      }
    } catch { /* A malformed local cache must not prevent opening the app. */ }
  }
  save() { this.storage.setItem(this.key, JSON.stringify([...this.items.values()])); }
  enqueue(id, text) {
    if (!this.items.has(id)) this.items.set(id, { id, text });
    this.save();
    return this.items.get(id);
  }
  acknowledge(id) {
    const item = this.items.get(id);
    if (this.items.delete(id)) this.save();
    return item;
  }
  reconcile(messages) {
    for (const message of messages) {
      if (message.speaker === 'user') this.acknowledge(message.client_message_id);
    }
  }
  pending() { return [...this.items.values()]; }
}
