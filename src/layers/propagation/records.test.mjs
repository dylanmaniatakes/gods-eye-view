import test from 'node:test';
import assert from 'node:assert/strict';
import {
  locatorCenter,
  normalizePropagationReport,
  mergePropagationPath,
  prunePropagationPaths,
  PROPAGATION_WINDOW_MS,
} from './records.js';
import { propagationArc, createPropagationLayer } from './index.js';
import * as Cesium from 'cesium';

const now = Date.UTC(2026, 10, 4, 15);
const report = (patch = {}) => ({
  band: '20m',
  tx: 'N0TEST',
  rx: 'G0TEST',
  txGrid: 'FN20',
  rxGrid: 'IO91wm',
  observedAt: now - 120000,
  frequencyHz: 14097100,
  snrDb: -12,
  ...patch,
});

test('Maidenhead positions are grid centres at supported precision', () => {
  assert.deepEqual(locatorCenter('FN20'), {
    lon: -75,
    lat: 40.5,
    grid: 'FN20',
  });
  const fine = locatorCenter('fn20ab12');
  assert.ok(Math.abs(fine.lon - (-76 + 1.5 / 120)) < 1e-10);
  assert.ok(Math.abs(fine.lat - (40 + 1 / 24 + 2.5 / 240)) < 1e-10);
  for (const grid of [
    'ZZ99',
    'FN20yy',
    'FN2',
    '',
    null,
    'FN20<script>',
    'FN20aa0000',
  ])
    assert.equal(locatorCenter(grid), null);
});

test('reports reject missing locations, impossible times, corrupt calls and band mismatches', () => {
  const row = normalizePropagationReport(report(), now);
  assert.ok(row.distanceKm > 5000 && row.distanceKm < 6000);
  for (const patch of [
    { observedAt: now - PROPAGATION_WINDOW_MS - 1 },
    { observedAt: now + 60001 },
    { frequencyHz: 144174000 },
    { frequencyHz: NaN },
    { tx: '<script>' },
    { rx: 'N0TEST' },
    { rxGrid: 'ZZ99' },
    { txGrid: null },
    { band: '6m' },
  ])
    assert.equal(
      normalizePropagationReport(report(patch), now),
      null,
      JSON.stringify(patch),
    );
  assert.equal(
    normalizePropagationReport(report({ snrDb: Infinity }), now).snrDb,
    null,
  );
});

test('paths deduplicate directional station pairs and expire within a fixed memory budget', () => {
  const paths = new Map();
  const older = normalizePropagationReport(report(), now);
  const newer = normalizePropagationReport(
    report({ observedAt: now - 60000 }),
    now,
  );
  mergePropagationPath(paths, older);
  mergePropagationPath(paths, newer);
  mergePropagationPath(paths, older);
  assert.equal(paths.size, 1);
  assert.equal([...paths.values()][0], newer);
  mergePropagationPath(
    paths,
    normalizePropagationReport(report({ rx: 'M0TEST' }), now),
  );
  prunePropagationPaths(paths, now, 1);
  assert.equal(paths.size, 1);
  prunePropagationPaths(paths, now + PROPAGATION_WINDOW_MS);
  assert.equal(paths.size, 0);
});

test('illustrative arcs remain finite across the date line, poles and antipodes', () => {
  for (const [from, to] of [
    [
      { lon: 179, lat: 40 },
      { lon: -179, lat: 42 },
    ],
    [
      { lon: 0, lat: 89 },
      { lon: 179, lat: 89 },
    ],
    [
      { lon: 0, lat: 0 },
      { lon: 180, lat: 0 },
    ],
  ]) {
    const arc = propagationArc({ from, to, distanceKm: 20000 });
    assert.equal(arc.length, 33);
    assert.ok(arc.every((p) => [p.x, p.y, p.z].every(Number.isFinite)));
    for (const [index, expected] of [
      [0, from],
      [32, to],
    ]) {
      const actual = Cesium.Cartographic.fromCartesian(arc[index]);
      const delta = Math.abs(
        Cesium.Math.toDegrees(actual.longitude) - expected.lon,
      );
      assert.ok(Math.min(delta, 360 - delta) < 1e-6);
      assert.ok(
        Math.abs(Cesium.Math.toDegrees(actual.latitude) - expected.lat) < 1e-6,
      );
    }
  }
});

function fixture(source) {
  const owned = [];
  const viewer = {
    dataSources: {
      add: (ds) => {
        owned.push(ds);
      },
      remove: (ds) => {
        owned.splice(owned.indexOf(ds), 1);
      },
    },
    scene: { requestRender() {} },
  };
  let time = now;
  const layer = createPropagationLayer({ source, now: () => time });
  layer.init(viewer);
  return {
    layer,
    owned,
    advance: (ms) => {
      time += ms;
    },
  };
}

test('filters update the same entities, preserve fresh data through failure and clear on empty / expiry', async () => {
  let fails = false,
    empty = false;
  const f = fixture({
    getSnapshot: async () => {
      if (fails) throw new Error('offline');
      return {
        rows: empty ? [] : [normalizePropagationReport(report(), now)],
        fetchedAt: now,
      };
    },
  });
  assert.equal(f.layer.getStats().count, 0);
  f.layer.enable();
  await f.layer.update();
  const original = f.owned[0].entities.values[0];
  assert.ok(original.properties);
  f.layer.setParams({ band20m: false });
  assert.equal(f.owned[0].entities.values.length, 0);
  assert.equal(f.layer.getStats().totalCount, 1);
  f.layer.setParams({ band20m: true });
  const retained = f.owned[0].entities.values[0];
  await f.layer.update();
  assert.equal(f.owned[0].entities.values[0], retained);
  fails = true;
  assert.equal(await f.layer.update(), false);
  assert.equal(f.layer.getStats().stale, true);
  f.advance(PROPAGATION_WINDOW_MS);
  await f.layer.update();
  assert.equal(f.owned[0].entities.values.length, 0);
  fails = false;
  empty = true;
  await f.layer.update();
  assert.equal(f.layer.getStats().error, null);
  f.layer.destroy();
  assert.equal(f.owned.length, 0);
});

test('disable aborts both subscription and pending fetch; a late result cannot redraw', async () => {
  let started, resolve;
  const f = fixture({
    start: ({ signal }) => {
      started = signal;
    },
    getSnapshot: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  f.layer.enable();
  const pending = f.layer.update();
  f.layer.disable();
  assert.equal(started.aborted, true);
  resolve({
    rows: [normalizePropagationReport(report(), now)],
    fetchedAt: now,
  });
  assert.equal(await pending, false);
  assert.equal(f.owned[0].entities.values.length, 0);
  assert.equal(f.owned[0].show, false);
  f.layer.destroy();
});
