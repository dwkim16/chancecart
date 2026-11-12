import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const allowed = {
  version: 1, probability: 50, sessionId: 'old-session',
  decision: { allowed: true, probability: 50, decidedAt: 1 },
};
const undecided = {
  version: 1, probability: 50, sessionId: 'reset-session', decision: null,
};

function gateFixture() {
  const listeners = new Map();
  const pending = [];
  let onRuntimeMessage;
  class Element {
    innerText = 'Place order';
    closest() { return this; }
    getAttribute() { return null; }
  }
  const chrome = {
    runtime: {
      sendMessage(message) {
        return new Promise((resolve) => pending.push({ message, resolve }));
      },
      onMessage: { addListener(callback) { onRuntimeMessage = callback; } },
    },
    storage: { onChanged: { addListener() {} } },
  };
  // A missing body deliberately skips UI mounting. These tests exercise the
  // actual content-script event gate and asynchronous state handling, not DOM
  // rendering, so no DOM library or extension-enabled browser is necessary.
  const document = { body: null, readyState: 'complete' };
  const window = { addEventListener(type, callback) { listeners.set(type, callback); } };
  vm.runInNewContext(source, {
    chrome, window, document, Element, HTMLFormElement: class {},
  });
  return {
    pending,
    invalidate() { onRuntimeMessage({ type: 'CHANCECART_STATE_CHANGED' }); },
    checkoutBlocked() {
      let prevented = false;
      listeners.get('click')({
        composedPath: () => [new Element()],
        preventDefault() { prevented = true; },
        stopImmediatePropagation() {},
      });
      return prevented;
    },
  };
}

test('a delayed old allowed response cannot reopen a reset session', async () => {
  const gate = gateFixture();
  assert.equal(gate.pending[0].message.type, 'GET_STATE');
  gate.invalidate();
  gate.pending[1].resolve({ ok: true, state: undecided });
  await setImmediate();
  gate.pending[0].resolve({ ok: true, state: allowed });
  await setImmediate();
  assert.equal(gate.checkoutBlocked(), true);
});

test('a delayed old error cannot overwrite newer successful state', async () => {
  const gate = gateFixture();
  gate.invalidate();
  gate.pending[1].resolve({ ok: true, state: allowed });
  await setImmediate();
  gate.pending[0].resolve({ ok: false, error: 'An obsolete request failed.' });
  await setImmediate();
  assert.equal(gate.checkoutBlocked(), false);
});

test('invalidation immediately closes allowed checkout while its refresh is pending', async () => {
  const gate = gateFixture();
  gate.pending[0].resolve({ ok: true, state: allowed });
  await setImmediate();
  assert.equal(gate.checkoutBlocked(), false);
  gate.invalidate();
  assert.equal(gate.checkoutBlocked(), true);
  gate.pending[1].resolve({ ok: true, state: undecided });
  await setImmediate();
  assert.equal(gate.checkoutBlocked(), true);
});
