# ChanceCart

A lightweight proof of concept for choosing a percentage chance of being allowed to continue a food order. Built as a desktop Chrome extension: no database, backend, account, dependencies, build step, or provider API credentials.

## Try it

1. Download or clone this repository.
2. Open `chrome://extensions` in desktop Chrome or Chromium.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the `extension/` directory.
4. Open ChanceCart from the browser toolbar, choose a percentage, and save it.
5. Choose **Open demo** to browse the fictional menu and build a cart.
6. Click **Place order**. The gate pauses the action and offers one random draw.
7. A blocked result leaves checkout paused. An allowed result lets you return and click the normal checkout button yourself. The built-in demo records only simulated orders; it cannot charge money.

For predictable demonstrations, set **0%** to always block or **100%** to always allow. Use **Reset demo session** in the popup between demonstrations. Reset preserves the selected percentage and allows you to change it again.

## What is implemented

- User-selected whole-number probability from 0 through 100.
- Browser cryptographic randomness with unbiased sampling.
- One persisted result for the demo session, shared across tabs and retained on refresh and browser restart.
- Settings lock after a draw, until an explicit reset.
- A local service worker serializes requests so simultaneous clicks share the same result.
- A popup, fictional menu/cart, and a narrow English-language Uber Eats website adapter.
- Capture of recognized checkout button clicks, keyboard activation, and form submissions.
- A gate that stays closed if local state cannot be loaded or saved.
- No synthetic purchase clicks, direct ordering requests, tracking, or collection of payment credentials.

## Website adapter status

The fictional checkout is the supported test environment. The Uber Eats adapter is **experimental and has not been validated against a logged-in live checkout**. It recognizes visible English button labels such as `Place order`, `Place your order`, `Confirm and pay`, and `Pay now` on `https://www.ubereats.com/`.

This is a voluntary UI gate, not a security boundary. Other labels, custom event handlers, programmatic form submission, frames, native mobile apps, a disabled extension, and website changes can bypass it. An allowed result stays allowed until reset; this POC does not track completed real orders or enforce a purchase limit. Do not rely on it to prevent a real charge. Review the delivery service's terms and obtain any required permission before distributing or using an integration commercially.

ChanceCart never submits an order or cancels one. A successful draw grants permission to use the provider's normal checkout; it does not promise payment success, restaurant acceptance, or delivery.

## Local data and permissions

The only permission is `storage`; a content script runs on `https://www.ubereats.com/*`. The extension stores a single `chancecart` object in `chrome.storage.local`: its schema version, percentage, random session ID, and optional result/timestamp. No data leaves the browser. No menus, addresses, provider passwords, or payment information are saved. Uninstalling the extension removes its local data.

The service worker owns local state. Provider content scripts use internal messages rather than accessing the data directly. There is no external messaging interface.

## Development

Chrome/Chromium 102+ is required. Node.js 20+ is only needed to run development checks:

```sh
npm test
npm run check
```

There is nothing to install and no build to run. Reload the extension at `chrome://extensions` after editing files, then refresh any open provider/demo tabs.

```text
extension/
  manifest.json   Chrome MV3 configuration
  core.mjs        Probability and serialized local state
  background.js   Internal message handling
  content.js      Website checkout gate and result dialog
  popup.*        Settings and demo launcher
  demo.*         Fictional menu and simulated checkout
  ui.css         Local popup/demo styles
tests/
  core.test.mjs        Deterministic state and concurrency tests
  background.test.mjs  Message and invalidation tests
  content.test.mjs     Delayed-response and reset regression tests
```

The 15 dependency-free automated tests pass. Chromium UI checks with a simulated Chrome runtime and the real state engine also passed for the popup, 0% blocking, 100% allowing, refresh persistence, explicit final checkout, keyboard/form interception, and cross-tab reset. A real unpacked-extension install could not be tested in the development environment because its managed browser policy prohibits unpacked extensions. A live logged-in Uber Eats checkout remains unverified.

## Manual acceptance checks

1. At 0%, attempt checkout and draw: checkout must remain blocked and the demo submitted-order count must stay at zero.
2. Refresh and open another demo tab: the same blocked result must remain.
3. Reset, set 100%, and draw: the gate itself must leave the submitted-order count at zero. Only a separate click on the normal checkout button should record a simulated order.
4. Try keyboard activation and form submission: both must pass through the gate while undecided or blocked.
5. Reset from the popup while another tab is allowed: that tab must become gated again.
6. At 50%, repeated draw requests within one session must reuse the same result. Independent sessions need not alternate outcomes.
