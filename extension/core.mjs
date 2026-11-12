/** The extension's entire state model. No network, account, or database. */
export const STORAGE_KEY = 'chancecart';
export const STATE_VERSION = 1;

export function validateProbability(probability) {
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
    throw new Error('Choose a whole-number percentage from 0 to 100.');
  }
  return probability;
}

export function createInitialState(probability = 50, uuid = () => crypto.randomUUID()) {
  return {
    version: STATE_VERSION,
    probability: validateProbability(probability),
    sessionId: uuid(),
    decision: null,
  };
}

export function validateState(state) {
  const invalid = () => {
    throw new Error('Saved session is invalid. Use Reset demo to start a new session.');
  };
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || state.version !== STATE_VERSION
    || !Number.isInteger(state.probability) || state.probability < 0 || state.probability > 100
    || typeof state.sessionId !== 'string' || !state.sessionId.trim()
    || !Object.hasOwn(state, 'decision')) invalid();

  if (state.decision !== null) {
    const decision = state.decision;
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)
      || typeof decision.allowed !== 'boolean'
      || decision.probability !== state.probability
      || !Number.isFinite(decision.decidedAt) || decision.decidedAt < 0
      || (state.probability === 0 && decision.allowed)
      || (state.probability === 100 && !decision.allowed)) invalid();
  }
  return state;
}

/** Uniform integer in [0, 99], avoiding modulo bias with rejection sampling. */
export function randomPercent(cryptoSource = crypto) {
  const bytes = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / 100) * 100;
  do {
    cryptoSource.getRandomValues(bytes);
  } while (bytes[0] >= limit);
  return bytes[0] % 100;
}

export function drawDecision(state, sample = randomPercent, now = Date.now) {
  validateState(state);
  if (state.decision !== null) return structuredClone(state);
  const allowed = state.probability === 100
    || (state.probability !== 0 && sample() < state.probability);
  return {
    ...state,
    decision: { allowed, probability: state.probability, decidedAt: now() },
  };
}

/**
 * One service worker owns all reads/writes. The queue ensures simultaneous tabs
 * share a single persisted draw rather than racing to create separate outcomes.
 */
export function createStateStore({ storage, sample = randomPercent, now = Date.now,
  uuid = () => crypto.randomUUID() }) {
  let queue = Promise.resolve();

  async function load() {
    const values = await storage.get(STORAGE_KEY);
    const saved = values[STORAGE_KEY];
    if (saved !== undefined) return validateState(saved);
    const initial = createInitialState(50, uuid);
    await save(initial);
    return initial;
  }

  async function save(state) {
    await storage.set({ [STORAGE_KEY]: structuredClone(state) });
  }

  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('Invalid extension message.');
    }
    // Reset remains available even when an old or damaged saved state is invalid.
    if (message.type === 'RESET') {
      const values = await storage.get(STORAGE_KEY);
      const previous = values[STORAGE_KEY];
      const probability = Number.isInteger(previous?.probability)
        && previous.probability >= 0 && previous.probability <= 100
        ? previous.probability : 50;
      const state = createInitialState(probability, uuid);
      await save(state);
      return state;
    }
    if (!['GET_STATE', 'SET_PROBABILITY', 'DRAW'].includes(message.type)) {
      throw new Error('Unknown extension message.');
    }
    const state = await load();
    if (message.type === 'GET_STATE') return structuredClone(state);
    if (message.type === 'SET_PROBABILITY') {
      validateProbability(message.probability);
      if (state.decision !== null) {
        throw new Error('This session is already decided. Reset demo before changing the chance.');
      }
      const next = { ...state, probability: message.probability };
      await save(next);
      return structuredClone(next);
    }
    if (state.decision !== null) return structuredClone(state);
    const next = drawDecision(state, sample, now);
    await save(next);
    return structuredClone(next);
  }

  return {
    dispatch(message) {
      const result = queue.then(() => handle(message));
      // A rejected operation must not poison subsequent requests, especially reset.
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
