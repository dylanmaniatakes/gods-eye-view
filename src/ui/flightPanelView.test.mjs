import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import FlightPanel from './views/panels/FlightPanel.vue';
import { useFlightPanelStore } from './stores/flightPanel.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { normalizeFlightFilters } from '../data/flightDisplayFilters.js';

test('Flights panel renders independent filter toggles, aircraft choices, altitude inputs and the searchable list', async (t) => {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useFlightPanelStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const chromeToken = chrome.connect({});
  chrome.publish(chromeToken, 'flight-panel', { collapsed: false });
  store.enabled = true;
  store.available = true;
  store.list = {
    rows: [
      {
        id: 'abc123',
        label: '<b>TEST123</b>',
        altitudeFt: 10000,
        klass: 'helicopter',
        visible: false,
      },
    ],
    total: 120,
    matching: 51,
    page: 0,
    pages: 2,
  };
  const calls = [];
  const token = store.connect({
    filter(patch) {
      calls.push(patch);
      store.filters = normalizeFlightFilters(patch, store.filters);
    },
    select: (id) => calls.push(id),
    search: (value) => calls.push(value),
  });
  const app = createApp(FlightPanel).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => {
    app.unmount();
    store.detach(token);
    chrome.detach(chromeToken);
  });
  assert.equal(store.visible, true);
  document.querySelector('#flight-airborne').click();
  document.querySelector('#flight-type-enabled').click();
  await nextTick();
  assert.equal(
    document.querySelector('[data-flight-class=helicopter]').disabled,
    false,
  );
  document.querySelector('[data-flight-class=helicopter]').click();
  document.querySelector('#flight-altitude-enabled').click();
  await nextTick();
  const min = document.querySelector('#flight-min-altitude');
  assert.equal(min.disabled, false);
  min.value = '5000';
  min.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-flight-id=abc123]').click();
  await nextTick();
  assert.ok(store.filters.airborneOnly);
  assert.ok(store.filters.classes.includes('helicopter'));
  assert.equal(store.filters.minAltitudeFt, 5000);
  assert.ok(calls.includes('abc123'));
  assert.equal(
    document.querySelector('.flight-roster b'),
    null,
    'source names stay plain text',
  );
  assert.ok(document.body.textContent.includes('Hidden on map'));
  store.available = false;
  await nextTick();
  assert.equal(document.getElementById('flight-panel').hidden, true);
  assert.equal(store.visible, false);
  store.available = true;
  await nextTick();
  assert.equal(document.getElementById('flight-panel').hidden, false);
  assert.equal(store.visible, true);
  chrome.publish(chromeToken, 'flight-panel', { collapsed: true });
  await nextTick();
  assert.equal(store.visible, false);
});
