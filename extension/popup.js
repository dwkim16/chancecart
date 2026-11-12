/* Settings are local to this browser. No provider credentials are read. */
(() => {
  'use strict';
  const form = document.querySelector('#chance-form');
  const number = document.querySelector('#probability');
  const range = document.querySelector('#probability-range');
  const save = document.querySelector('#save');
  const reset = document.querySelector('#reset');
  const feedback = document.querySelector('#feedback');
  let state = null;
  let busy = false;

  function showFeedback(message, error = false) {
    feedback.textContent = message;
    feedback.classList.toggle('is-error', error);
  }

  function render() {
    const locked = Boolean(state?.decision);
    number.disabled = busy || locked || !state;
    range.disabled = number.disabled;
    save.disabled = busy || locked || !state;
    reset.disabled = busy;
    if (!state) return;
    number.value = state.probability;
    range.value = state.probability;
    document.querySelector('#setting-help').textContent = locked
      ? 'Chance is locked for this session. Reset the demo to try again.'
      : 'One draw per demo session. Refreshing keeps the result.';
    const heading = document.querySelector('#session-heading');
    const detail = document.querySelector('#session-detail');
    const dot = document.querySelector('#status-dot');
    dot.dataset.result = !locked ? 'ready' : state.decision.allowed ? 'allowed' : 'blocked';
    heading.textContent = !locked ? 'Ready for your first draw' : state.decision.allowed ? 'Checkout allowed' : 'Checkout blocked';
    detail.textContent = !locked
      ? `${state.probability}% chance. Nothing has been decided yet.`
      : state.decision.allowed
        ? 'Normal checkout is unlocked for this demo session.'
        : 'The gate remains closed until you reset the demo.';
  }

  async function request(message, successMessage = '') {
    busy = true;
    render();
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response?.ok) throw new Error(response?.error || 'The extension could not load its settings.');
      state = response.state;
      if (successMessage) showFeedback(successMessage);
    } catch (error) {
      showFeedback(error.message || 'Please reopen the extension and try again.', true);
    } finally {
      busy = false;
      render();
    }
  }

  number.addEventListener('input', () => {
    if (number.validity.valid) range.value = number.value;
  });
  range.addEventListener('input', () => { number.value = range.value; });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const probability = Number(number.value);
    if (!Number.isInteger(probability)) return showFeedback('Choose a whole percentage from 0 to 100.', true);
    request({ type: 'SET_PROBABILITY', probability }, 'Chance saved for this session.');
  });
  reset.addEventListener('click', () => {
    if (!busy) request({ type: 'RESET' }, 'New demo session. Your previous result has been cleared.');
  });
  document.querySelector('#open-demo').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('demo.html') });
  });
  document.querySelector('#open-uber').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.ubereats.com/' });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'chancecart')) request({ type: 'GET_STATE' });
  });
  render();
  request({ type: 'GET_STATE' });
})();
