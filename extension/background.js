import { createStateStore, STORAGE_KEY } from './core.mjs';

const store = createStateStore({ storage: chrome.storage.local });
const ready = Promise.resolve().then(() => {
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    return chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
});

// Trusted storage changes remain visible to this worker even when content
// scripts cannot subscribe to local storage. Notify them without reading URLs
// or waiting for tabs that have no receiver.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !Object.hasOwn(changes, STORAGE_KEY)
    || !chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
  Promise.resolve().then(() => chrome.tabs.query({})).then((tabs) => {
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      Promise.resolve().then(() => chrome.tabs.sendMessage(tab.id, {
        type: 'CHANCECART_STATE_CHANGED',
      })).catch(() => {});
    }
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'This message is not from ChanceCart.' });
    return false;
  }
  ready.then(() => store.dispatch(message))
    .then((state) => sendResponse({ ok: true, state }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read the saved session.',
    }));
  // Keep the response channel alive through the serialized storage operation.
  return true;
});
