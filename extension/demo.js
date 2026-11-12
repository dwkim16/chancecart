(() => {
  'use strict';
  const items = [
    { id: 'bowl', name: 'The garden bowl', description: 'Roasted vegetables, herby rice, avocado & lemon tahini.', price: 1395, art: '🥗', quantity: 1 },
    { id: 'burger', name: 'The weekend burger', description: 'A classic burger, crisp lettuce, house sauce & golden fries.', price: 1595, art: '🍔', quantity: 0 },
    { id: 'ramen', name: 'A very good ramen', description: 'Miso broth, springy noodles, mushrooms & a jammy egg.', price: 1495, art: '🍜', quantity: 0 }
  ];
  const formatMoney = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  const menu = document.querySelector('#menu');
  const cart = document.querySelector('#cart-items');
  const tip = document.querySelector('#tip');
  const result = document.querySelector('#demo-result');
  let submissions = 0;

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'food-card';
    const art = document.createElement('div');
    art.className = 'food-art';
    art.setAttribute('aria-hidden', 'true');
    art.textContent = item.art;
    const copy = document.createElement('div');
    copy.className = 'food-copy';
    const title = document.createElement('h3');
    title.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = item.description;
    const price = document.createElement('span');
    price.className = 'food-price';
    price.textContent = formatMoney(item.price);
    copy.append(title, description, price);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add-button';
    add.dataset.add = item.id;
    add.textContent = '+';
    add.setAttribute('aria-label', `Add ${item.name}`);
    add.addEventListener('click', () => {
      if (item.quantity < 10) item.quantity += 1;
      renderCart();
    });
    card.append(art, copy, add);
    menu.append(card);
  }

  function renderCart() {
    cart.replaceChildren();
    let subtotal = 0;
    for (const item of items.filter((entry) => entry.quantity > 0)) {
      subtotal += item.price * item.quantity;
      const row = document.createElement('div');
      row.className = 'cart-item';
      const detail = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = item.name;
      const quantity = document.createElement('div');
      quantity.className = 'quantity-control';
      for (const delta of [-1, 1]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = delta < 0 ? '−' : '+';
        button.setAttribute('aria-label', `${delta < 0 ? 'Remove one' : 'Add one'} ${item.name}`);
        button.disabled = delta > 0 && item.quantity >= 10;
        button.addEventListener('click', () => {
          item.quantity = Math.max(0, Math.min(10, item.quantity + delta));
          renderCart();
        });
        quantity.append(button);
        if (delta < 0) {
          const count = document.createElement('span');
          count.textContent = item.quantity;
          count.setAttribute('aria-label', `Quantity ${item.quantity}`);
          quantity.append(count);
        }
      }
      detail.append(label, quantity);
      const price = document.createElement('span');
      price.textContent = formatMoney(item.price * item.quantity);
      row.append(detail, price);
      cart.append(row);
    }
    if (!subtotal) {
      const empty = document.createElement('p');
      empty.className = 'empty-cart';
      empty.textContent = 'Pick something from the menu to get started.';
      cart.append(empty);
    }
    const fees = subtotal ? 399 : 0;
    const tax = Math.round(subtotal * 0.09);
    const tipValue = subtotal ? Number(tip.value) : 0;
    document.querySelector('#subtotal').textContent = formatMoney(subtotal);
    document.querySelector('#fees').textContent = formatMoney(fees);
    document.querySelector('#tax').textContent = formatMoney(tax);
    document.querySelector('#total').textContent = formatMoney(subtotal + fees + tax + tipValue);
    document.querySelector('#place-order').disabled = !subtotal;
    tip.disabled = !subtotal;
  }

  async function loadSession() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (!response?.ok) throw new Error(response?.error || 'Settings could not be loaded.');
      const { probability, decision } = response.state;
      document.querySelector('#demo-chance').textContent = `${probability}% chance of allowing checkout`;
      document.querySelector('#demo-session').textContent = !decision
        ? 'One draw. Your result stays until you reset.'
        : decision.allowed ? 'Checkout allowed for this session. You still click to continue.' : 'Checkout blocked for this session. No purchase was made.';
    } catch (error) {
      document.querySelector('#demo-chance').textContent = 'Settings unavailable';
      document.querySelector('#demo-session').textContent = error.message;
    }
  }

  document.querySelector('#checkout-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!items.some((item) => item.quantity > 0)) return;
    submissions += 1;
    document.querySelector('#demo-submissions').textContent = submissions;
    result.textContent = 'Demo checkout completed. This was a simulation; no purchase or charge was made.';
  });
  document.querySelector('#demo-reset').addEventListener('click', async () => {
    const button = document.querySelector('#demo-reset');
    button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'RESET' });
      if (!response?.ok) throw new Error(response?.error || 'The demo could not be reset.');
      result.textContent = 'New demo session. Your cart is still here.';
      await loadSession();
    } catch (error) {
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, 'chancecart')) loadSession();
  });
  tip.addEventListener('change', renderCart);
  renderCart();
  loadSession();
})();
