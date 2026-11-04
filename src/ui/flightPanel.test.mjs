import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightPanel } from './flightPanel.js';
import { normalizeFlightFilters } from '../data/flightDisplayFilters.js';
import { createOwners } from './stores/owners.js';

test('flight panel refreshes only while open/visible, saves each feed separately and detaches cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owners = createOwners();
  const store = {
    feed: 'flights',
    visible: false,
    search: '',
    connect: owners.connect,
    detach: owners.detach,
  };
  let reads = 0;
  const subscribers = new Set();
  const enabledFeeds = new Set(['flights']);
  const settings = {
    flights: normalizeFlightFilters(),
    military: normalizeFlightFilters(),
  };
  const callbacks = {};
  const storage = new Map();
  const doc = {
    hidden: false,
    addEventListener(name, fn) {
      callbacks[name] = fn;
    },
    removeEventListener(name) {
      delete callbacks[name];
    },
  };
  const layers = new Map(
    ['flights', 'military'].map((id) => [
      id,
      {
        module: {
          getParams: () => ({ displayFilters: settings[id] }),
          getFlightList: () => {
            reads++;
            return { rows: [], total: 120, matching: 120, page: 0, pages: 3 };
          },
          attachFlightPanel(fn) {
            callbacks[id] = fn;
          },
          trackById: (target) => `${id}:${target}`,
        },
      },
    ]),
  );
  const manager = {
    layers,
    isEnabled: (id) => enabledFeeds.has(id),
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    setLayerParams(id, params) {
      settings[id] = normalizeFlightFilters(
        params.displayFilters,
        settings[id],
      );
      for (const fn of subscribers)
        fn({ type: 'params', layerId: id, requestedParams: params });
    },
  };
  let reveals = 0;
  const panel = createFlightPanel({
    store,
    doc,
    reveal: () => reveals++,
    storage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  });
  panel.connect(manager);
  assert.equal(store.available, true);
  const initial = reads;
  t.mock.timers.tick(10000);
  assert.equal(reads, initial, 'collapsed panel runs no list timer');
  store.visible = true;
  owners.act('visibility');
  t.mock.timers.tick(1000);
  assert.equal(reads, initial + 2);
  owners.act('filter', { airborneOnly: true });
  assert.equal(settings.flights.airborneOnly, true);
  assert.equal(settings.military.airborneOnly, false);
  assert.equal(JSON.parse([...storage.values()][0]).flights.airborneOnly, true);
  callbacks.military('military');
  assert.equal(store.feed, 'military');
  assert.equal(reveals, 1);
  enabledFeeds.add('military');
  assert.equal(owners.act('select', 'abc123'), 'military:abc123');
  const visibility = (id, enabled) => {
    if (enabled) enabledFeeds.add(id);
    else enabledFeeds.delete(id);
    for (const fn of subscribers)
      fn({ type: 'visibility', layerId: id, enabled });
  };
  visibility('flights', false);
  assert.equal(
    store.available,
    true,
    'military alone keeps the panel available',
  );
  visibility('military', false);
  assert.equal(store.available, false, 'both flight feeds off hide the panel');
  const stoppedReads = reads;
  t.mock.timers.tick(10000);
  assert.equal(reads, stoppedReads, 'unavailable panel stops its roster timer');
  store.visible = false;
  visibility('flights', true);
  assert.equal(
    store.available,
    true,
    'a closed panel reappears when civilian flights turn on',
  );
  doc.hidden = true;
  callbacks.visibilitychange();
  const hiddenReads = reads;
  t.mock.timers.tick(10000);
  assert.equal(reads, hiddenReads);
  panel.destroy();
  assert.equal(subscribers.size, 0);
  assert.equal(callbacks.visibilitychange, undefined);
  assert.equal(callbacks.flights, null);
});
