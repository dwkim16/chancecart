import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, createInitialState, createStateStore, drawDecision, randomPercent,
  validateProbability,
} from '../extension/core.mjs';

function memoryStorage(initial) {
  let values = initial === undefined ? {} : { [STORAGE_KEY]: structuredClone(initial) };
  return {
    writes: 0,
    async get() { return structuredClone(values); },
    async set(next) {
      this.writes += 1;
      values = { ...values, ...structuredClone(next) };
    },
  };
}

function fixture(initial, overrides = {}) {
  let ids = 0;
  const storage = memoryStorage(initial);
  const store = createStateStore({
    storage, sample: () => 49, now: () => 1234, uuid: () => `session-${++ids}`, ...overrides,
  });
  return { storage, store };
}

test('percentages must be whole numbers within the inclusive bounds', () => {
  for (const value of [0, 50, 100]) assert.equal(validateProbability(value), value);
  for (const value of [-1, 101, 0.5, NaN, Infinity, '50', null, undefined]) {
    assert.throws(() => validateProbability(value), /whole-number/);
  }
});

test('secure sampling rejects the biased tail before returning an integer', () => {
  const sequence = [0xffffffff, 4294967200, 4294967199];
  let calls = 0;
  const result = randomPercent({ getRandomValues(bytes) { bytes[0] = sequence[calls++]; } });
  assert.equal(result, 99);
  assert.equal(calls, 3);
});

test('0% always blocks and 100% always allows without sampling', () => {
  const mustNotRun = () => { throw new Error('No sampling needed at a boundary.'); };
  for (const probability of [0, 100]) {
    const state = createInitialState(probability, () => 'boundary');
    assert.equal(drawDecision(state, mustNotRun, () => 1234).decision.allowed,
      probability === 100);
  }
});

test('50% includes 49 and excludes 50; a recorded draw is never sampled again', () => {
  const state = createInitialState(50, () => 'boundary');
  assert.equal(drawDecision(state, () => 49, () => 1234).decision.allowed, true);
  const blocked = drawDecision(state, () => 50, () => 1234);
  assert.equal(blocked.decision.allowed, false);
  assert.deepEqual(drawDecision(blocked, () => { throw new Error('reroll'); }), blocked);
});

test('first use persists a default session and subsequent reads do not mutate it', async () => {
  const { storage, store } = fixture();
  const state = await store.dispatch({ type: 'GET_STATE' });
  assert.deepEqual(state, {
    version: 1, probability: 50, sessionId: 'session-1', decision: null,
  });
  state.probability = 100;
  assert.equal((await store.dispatch({ type: 'GET_STATE' })).probability, 50);
  assert.equal(storage.writes, 1);
});

test('concurrent tab requests share one persisted random decision', async () => {
  let samples = 0;
  const { storage, store } = fixture(undefined, { sample: () => { samples += 1; return 50; } });
  const results = await Promise.all(Array.from({ length: 20 }, () => store.dispatch({ type: 'DRAW' })));
  assert.equal(samples, 1);
  assert.equal(storage.writes, 2);
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].decision.allowed, false);
});

test('service worker restart reuses the saved draw', async () => {
  const { storage, store } = fixture();
  const first = await store.dispatch({ type: 'DRAW' });
  const restarted = createStateStore({ storage, sample: () => { throw new Error('reroll'); } });
  assert.deepEqual(await restarted.dispatch({ type: 'DRAW' }), first);
});

test('settings lock after a decision and explicit reset unlocks a new session', async () => {
  const { store } = fixture();
  await store.dispatch({ type: 'SET_PROBABILITY', probability: 25 });
  const first = await store.dispatch({ type: 'DRAW' });
  await assert.rejects(store.dispatch({ type: 'SET_PROBABILITY', probability: 100 }), /already decided/);
  const reset = await store.dispatch({ type: 'RESET' });
  assert.equal(reset.probability, 25);
  assert.equal(reset.decision, null);
  assert.notEqual(reset.sessionId, first.sessionId);
  assert.equal((await store.dispatch({ type: 'SET_PROBABILITY', probability: 100 })).probability, 100);
});

test('corrupt saved sessions fail closed until the user explicitly resets', async () => {
  const corruptStates = [null, {}, { version: 2 },
    { version: 1, probability: 50, sessionId: 'saved' },
    { version: 1, probability: 50, sessionId: 'saved', decision: { allowed: 'yes' } },
    { version: 1, probability: 0, sessionId: 'saved', decision: { allowed: true, probability: 0, decidedAt: 1 } },
  ];
  for (const corrupt of corruptStates) {
    const { store } = fixture(corrupt, { sample: () => { throw new Error('reroll'); } });
    await assert.rejects(store.dispatch({ type: 'GET_STATE' }), /Saved session is invalid/);
    await assert.rejects(store.dispatch({ type: 'DRAW' }), /Saved session is invalid/);
    const reset = await store.dispatch({ type: 'RESET' });
    assert.equal(reset.decision, null);
    assert.equal(typeof reset.sessionId, 'string');
  }
});

test('bad messages and invalid settings do not poison later requests', async () => {
  const { store } = fixture();
  await assert.rejects(store.dispatch(null), /Invalid extension message/);
  await assert.rejects(store.dispatch({ type: 'UNRECOGNIZED' }), /Unknown extension message/);
  await assert.rejects(store.dispatch({ type: 'SET_PROBABILITY', probability: '100' }), /whole-number/);
  assert.equal((await store.dispatch({ type: 'GET_STATE' })).probability, 50);
});

test('a failed persistence operation never returns an allowed result', async () => {
  const storage = memoryStorage(createInitialState(100, () => 'saved'));
  storage.set = async () => { throw new Error('Storage is unavailable.'); };
  const store = createStateStore({ storage });
  await assert.rejects(store.dispatch({ type: 'DRAW' }), /Storage is unavailable/);
});
