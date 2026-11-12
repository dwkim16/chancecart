(() => {
  "use strict";

  if (window.__chanceCartLoaded) return;
  window.__chanceCartLoaded = true;

  // This is a deliberately narrow English-language website adapter, not an API.
  // Never invoke the provider's order button or call its purchase endpoints.
  const labels = /^(?:place (?:your )?order|confirm and pay|pay now)(?:\s*[-–—·•:]?\s*[$£€]\s*[\d,.]+)?$/i;
  let state = null;
  let host;
  let dialog;
  let badge;
  let busy = false;
  let previousFocus;
  let stateGeneration = 0;
  let stateError = "";

  async function request(type) {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.error || "The extension could not load its local settings.");
    return response.state;
  }

  function orderButton(element) {
    if (!(element instanceof Element)) return null;
    const button = element.closest("button, [role='button'], input[type='submit']");
    if (!button || host?.contains(button)) return null;
    const text = (button.getAttribute("aria-label") || button.innerText || button.value || "").replace(/\s+/g, " ").trim();
    return labels.test(text) ? button : null;
  }

  function findOrderButton(event) {
    for (const element of event.composedPath()) {
      const button = orderButton(element);
      if (button) return button;
    }
    return null;
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement("div");
    host.id = "chancecart-gate";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; font-family: system-ui, sans-serif; color-scheme: light; }
        * { box-sizing: border-box; }
        .badge { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; border: 1px solid #b9cabd; border-radius: 30px; padding: 11px 17px; background: #f6f8ef; color: #234b35; box-shadow: 0 3px 20px #0002; font: 600 13px system-ui; cursor: pointer; }
        dialog { margin: auto; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 30px; border: 1px solid #d3dccb; border-radius: 24px; background: #fbfcf6; color: #22362a; font: 15px/1.6 system-ui; box-shadow: 0 25px 90px #0003; }
        dialog::backdrop { background: #10281988; }
        .eyebrow { margin: 0 0 15px; color: #52765b; letter-spacing: .16em; font-size: 10px; font-weight: 800; text-transform: uppercase; }
        h2 { margin: 0 0 12px; font-size: 27px; letter-spacing: -.04em; line-height: 1.2; }
        p { margin: 0 0 18px; }
        .detail { padding: 14px; background: #eef2e6; border-radius: 12px; font-size: 13px; }
        .status { min-height: 24px; font-size: 13px; color: #9c3427; }
        .actions { display: grid; gap: 9px; }
        button { border: 1px solid #c7d3bf; border-radius: 11px; padding: 12px 16px; cursor: pointer; background: transparent; color: #234b35; font: 600 14px system-ui; }
        button.primary { background: #28583b; color: white; border-color: #28583b; }
        button:focus-visible { outline: 3px solid #7da978; outline-offset: 3px; }
        button:disabled { opacity: .65; cursor: wait; }
        [hidden] { display: none !important; }
        .foot { font-size: 11px; color: #617264; margin: 16px 0 0; }
      </style>
      <button class="badge" type="button" aria-label="Open ChanceCart checkout gate">ChanceCart · loading</button>
      <dialog aria-labelledby="cc-title" aria-describedby="cc-description">
        <p class="eyebrow">ChanceCart · your choice, with a pause</p>
        <h2 id="cc-title">Pause before ordering.</h2>
        <p id="cc-description">Loading your local settings…</p>
        <p class="detail" id="cc-detail">Nothing has been submitted by this gate.</p>
        <p class="status" role="status" aria-live="polite" id="cc-status"></p>
        <div class="actions">
          <button class="primary" id="cc-draw" type="button" disabled>Loading…</button>
          <button id="cc-close" type="button">Continue shopping</button>
        </div>
        <p class="foot">One saved result until you reset the demo in the extension popup. ChanceCart never clicks the order button for you.</p>
      </dialog>`;
    document.body.append(host);
    dialog = root.querySelector("dialog");
    badge = root.querySelector(".badge");
    badge.addEventListener("click", () => openGate(badge));
    root.querySelector("#cc-close").addEventListener("click", () => dialog.close());
    root.querySelector("#cc-draw").addEventListener("click", draw);
    dialog.addEventListener("close", () => previousFocus?.focus?.());
    dialog.addEventListener("cancel", () => { /* Escape dismisses the UI, not the gate. */ });
    render();
  }

  function render(error = stateError) {
    stateError = error;
    if (!host) return;
    const root = host.shadowRoot;
    const title = root.querySelector("#cc-title");
    const description = root.querySelector("#cc-description");
    const detail = root.querySelector("#cc-detail");
    const drawButton = root.querySelector("#cc-draw");
    const closeButton = root.querySelector("#cc-close");
    root.querySelector("#cc-status").textContent = error || "";
    drawButton.hidden = Boolean(state?.decision);
    drawButton.disabled = busy || !state || Boolean(error);
    if (error) {
      badge.textContent = "ChanceCart · unavailable";
      title.textContent = "Checkout stays paused.";
      description.textContent = "Local settings could not be loaded. Open the extension popup to retry or explicitly reset the demo.";
      detail.textContent = "This gate has not submitted an order. It will not unlock checkout while its state is unknown.";
      return;
    }
    if (!state) {
      badge.textContent = "ChanceCart · loading";
      title.textContent = "Pause before ordering.";
      description.textContent = "Loading your local settings…";
      detail.textContent = "Checkout stays paused while the current session is checked.";
      drawButton.textContent = "Loading…";
      closeButton.textContent = "Continue shopping";
      return;
    }
    if (state.decision?.allowed) {
      badge.textContent = "ChanceCart · checkout allowed";
      title.textContent = "You can continue.";
      description.textContent = "Your saved result allows checkout for this demo session.";
      detail.textContent = "No order was placed by ChanceCart. Return to the website and click its normal order button yourself if you still want to buy.";
      closeButton.textContent = "Return to checkout";
    } else if (state.decision) {
      badge.textContent = "ChanceCart · checkout blocked";
      title.textContent = "No order this time.";
      description.textContent = "Your saved result keeps checkout paused. You can still browse the menu.";
      detail.textContent = "The intercepted checkout action was stopped. Refreshing or opening another tab will keep this same result.";
      closeButton.textContent = "Keep browsing";
    } else {
      badge.textContent = `ChanceCart · ${state.probability}% chance`;
      title.textContent = "A little room to decide.";
      description.textContent = `You chose a ${state.probability}% chance of being allowed to continue to checkout.`;
      detail.textContent = "Try once to reveal the result. An allowed result unlocks normal checkout; a blocked result leaves your cart unsubmitted.";
      drawButton.textContent = busy ? "Saving your result…" : `Try ${state.probability}% chance`;
      closeButton.textContent = "Continue shopping";
    }
  }

  async function refreshState(type = "GET_STATE") {
    const generation = ++stateGeneration;
    try {
      const next = await request(type);
      if (generation !== stateGeneration) return;
      state = next;
      render("");
    } catch (error) {
      if (generation !== stateGeneration) return;
      state = null;
      render(error.message);
    }
  }

  async function openGate(origin) {
    mount();
    if (!dialog) return;
    previousFocus = origin || document.activeElement;
    if (!dialog.open) dialog.showModal();
    await refreshState();
  }

  async function draw() {
    if (busy) return;
    busy = true;
    render();
    await refreshState("DRAW");
    busy = false;
    render();
  }

  function intercept(event, button) {
    if (!button || state?.decision?.allowed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openGate(button);
  }

  // Install at document_start, before most page handlers. The second click after
  // an allowed result goes through naturally; we never replay purchase events.
  window.addEventListener("click", event => intercept(event, findOrderButton(event)), true);
  window.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") intercept(event, findOrderButton(event));
  }, true);
  window.addEventListener("submit", event => {
    const button = orderButton(event.submitter) || (event.target instanceof HTMLFormElement
      ? [...event.target.querySelectorAll("button, input[type='submit']")].map(orderButton).find(Boolean)
      : null);
    intercept(event, button);
  }, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.chancecart) return;
    // Never trust a raw storage event as authorization: ask the state engine.
    state = null;
    render("");
    refreshState();
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "CHANCECART_STATE_CHANGED") return;
    // Background messages also reach provider tabs whose storage access is
    // restricted to trusted extension pages.
    state = null;
    render("");
    refreshState();
  });

  function start() {
    mount();
    refreshState();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
