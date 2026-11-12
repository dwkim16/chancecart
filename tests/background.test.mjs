import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

test('persisted mutations notify tab IDs without waiting for missing receivers', async () => {
  let listener;
  let onStorageChanged;
  let values = {};
  let queries = 0;
  const notifications = [];
  globalThis.chrome = {
    runtime: {
      id: 'chancecart-test',
      onMessage: { addListener(callback) { listener = callback; } },
    },
    storage: {
      onChanged: { addListener(callback) { onStorageChanged = callback; } },
      local: {
        async setAccessLevel() {},
        async get() { return structuredClone(values); },
        async set(next) {
          const changes = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, {
            oldValue: values[key], newValue: structuredClone(value),
          }]));
          values = { ...values, ...structuredClone(next) };
          onStorageChanged(changes, 'local');
        },
      },
    },
    tabs: {
      async query(query) { assert.deepEqual(query, {}); queries += 1; return [{ id: 1 }, { id: 2 }, {}]; },
      sendMessage(id, message) {
        notifications.push({ id, message });
        return id === 1 ? Promise.reject(new Error('No receiver.')) : new Promise(() => {});
      },
    },
  };
  try {
    await import(`../extension/background.js?test=${crypto.randomUUID()}`);
    const send = (message, sender = { id: 'chancecart-test' }) => new Promise((resolve) => {
      listener(message, sender, resolve);
    });
    const initialized = await send({ type: 'GET_STATE' });
    assert.equal(initialized.ok, true);
    await setImmediate();
    assert.equal(queries, 1);
    assert.deepEqual(notifications.map((entry) => entry.id), [1, 2]);
    assert.ok(notifications.every(({ message }) => message.type === 'CHANCECART_STATE_CHANGED'));

    const drawn = await send({ type: 'DRAW' });
    assert.equal(drawn.ok, true);
    await setImmediate();
    assert.equal(queries, 2);
    const repeated = await send({ type: 'DRAW' });
    assert.deepEqual(repeated, drawn);
    await setImmediate();
    assert.equal(queries, 2, 'reusing a draw does not write or broadcast');

    const reset = await send({ type: 'RESET' });
    assert.equal(reset.ok, true);
    await setImmediate();
    assert.equal(queries, 3);
    const stranger = await send({ type: 'RESET' }, { id: 'another-extension' });
    assert.equal(stranger.ok, false);
    assert.equal(queries, 3);
  } finally {
    delete globalThis.chrome;
  }
});
