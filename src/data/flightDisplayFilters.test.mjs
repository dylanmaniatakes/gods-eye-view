import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFlightFilters,
  flightMatchesFilters,
  flightIdentityHash,
  selectFlightDisplay,
} from './flightDisplayFilters.js';

test('flight filters combine ground, type and reported aviation altitude without changing records', () => {
  const filters = normalizeFlightFilters({
    airborneOnly: true,
    typeFilterEnabled: true,
    classes: ['helicopter'],
    altitudeFilterEnabled: true,
    minAltitudeFt: 1000,
    maxAltitudeFt: 5000,
  });
  const info = Object.freeze({
    klass: 'helicopter',
    altitude: 1000,
    onGround: false,
  });
  assert.equal(flightMatchesFilters(info, filters), true);
  assert.equal(
    flightMatchesFilters({ ...info, onGround: true }, filters),
    false,
  );
  assert.equal(
    flightMatchesFilters({ ...info, klass: 'airliner' }, filters),
    false,
  );
  assert.equal(
    flightMatchesFilters({ ...info, altitude: 2000 }, filters),
    false,
  );
  assert.equal(
    flightMatchesFilters({ ...info, altitude: null }, filters),
    false,
  );
  assert.equal(flightMatchesFilters(info, normalizeFlightFilters()), true);
});

test('filter normalization bounds stored/input values and preserves disabled filter choices', () => {
  const f = normalizeFlightFilters({
    typeFilterEnabled: true,
    classes: ['helicopter', 'injected'],
    minAltitudeFt: 40000,
    maxAltitudeFt: 10000,
  });
  assert.deepEqual(f.classes, ['helicopter']);
  assert.equal(f.minAltitudeFt, 10000);
  assert.equal(f.maxAltitudeFt, 40000);
  assert.deepEqual(
    normalizeFlightFilters({ typeFilterEnabled: false }, f).classes,
    ['helicopter'],
  );
  assert.deepEqual(normalizeFlightFilters(null), normalizeFlightFilters());
  const bounded = normalizeFlightFilters({
    minAltitudeFt: -1e9,
    maxAltitudeFt: 1e9,
    density: 'invalid',
  });
  assert.equal(bounded.minAltitudeFt, -2000);
  assert.equal(bounded.maxAltitudeFt, 100000);
  assert.equal(bounded.density, 'balanced');
});

test('wide-view decluttering is stable under record reordering, protects selections and reveals the full close view', () => {
  const candidates = Array.from({ length: 1000 }, (_, i) => ({
    id: `plane-${i}`,
    info: { klass: 'airliner' },
    position: {
      x: 6370000 + (i % 10) * 100,
      y: (i % 20) * 100,
      z: (i % 30) * 100,
    },
    hash: flightIdentityHash(`plane-${i}`),
    protected: i === 999,
  }));
  const args = {
    filters: normalizeFlightFilters(),
    altitudeM: 500000,
    metresPerPixel: 500,
  };
  const shown = selectFlightDisplay(candidates, args);
  assert.ok(shown.size < 50, `${shown.size} of 1000 shown`);
  assert.ok(shown.has('plane-999'));
  assert.deepEqual(
    [...selectFlightDisplay([...candidates].reverse(), args)].sort(),
    [...shown].sort(),
  );
  assert.equal(
    selectFlightDisplay(candidates, { ...args, altitudeM: 5000 }).size,
    1000,
  );
  assert.equal(
    selectFlightDisplay(candidates, {
      ...args,
      filters: normalizeFlightFilters({ declutterEnabled: false }),
    }).size,
    1000,
  );
  assert.equal(candidates.length, 1000, 'the underlying feed is untouched');
});

test('protected emergency/selected aircraft bypass manual filters without consuming an ambient slot', () => {
  const candidates = [
    {
      id: 'selected',
      protected: true,
      info: { onGround: true },
      position: { x: 0, y: 0, z: 0 },
      hash: 1,
    },
    {
      id: 'other',
      protected: false,
      info: { onGround: true },
      position: { x: 0, y: 0, z: 0 },
      hash: 2,
    },
  ];
  assert.deepEqual(
    [
      ...selectFlightDisplay(candidates, {
        filters: normalizeFlightFilters({ airborneOnly: true }),
        altitudeM: 1e6,
        metresPerPixel: 500,
      }),
    ],
    ['selected'],
  );
});
