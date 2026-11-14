import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createWsprPropagationSource,
  createVhfPropagationSource,
  propagationQuery,
} from './source.js';
import { PROPAGATION_MAX_PATHS, PROPAGATION_WINDOW_MS } from './records.js';

const now = Date.UTC(2026, 10, 4, 15);
const raw = {
  band: 14,
  tx_sign: 'N0TEST',
  tx_loc: 'FN20',
  rx_sign: 'G0TEST',
  rx_loc: 'IO91',
  observed: now / 1000 - 120,
  frequency: 14097100,
  snr: -12,
  reports: 2,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('WSPR query always bounds time, bands and each band’s sample', () => {
  const query = propagationQuery(['10m', '20m', '40m', '80m', '160m']);
  assert.match(query, /INTERVAL 30 MINUTE/);
  assert.match(query, /band IN \(28,14,7,3,1\)/);
  assert.match(query, /LIMIT 300 BY band LIMIT 1500/);
  assert.throws(() => propagationQuery(['anything']), TypeError);
});

test('WSPR uses fixed HTTPS, caches for two minutes, excludes invalid rows and honours aborts', async () => {
  let count = 0,
    time = now;
  const source = createWsprPropagationSource({
    now: () => time,
    fetchImpl: async (url, options) => {
      count++;
      assert.equal(new URL(url).origin, 'https://db1.wspr.live');
      assert.equal(options.credentials, 'omit');
      return Response.json({
        data: [raw, { ...raw, band: 144 }, { ...raw, tx_loc: 'ZZ99' }],
      });
    },
  });
  assert.equal((await source.getSnapshot()).rows.length, 1);
  await source.getSnapshot();
  assert.equal(count, 1);
  time += 120001;
  await source.getSnapshot();
  assert.equal(count, 2);
  const c = new AbortController();
  c.abort();
  await assert.rejects(source.getSnapshot({ signal: c.signal }), {
    name: 'AbortError',
  });
});

test('WSPR failures and malformed / oversized payloads are not healthy empty feeds', async () => {
  for (const response of [
    new Response('down', { status: 503 }),
    Response.json({ rows: [] }),
    new Response('{}', { headers: { 'content-length': '3000000' } }),
  ]) {
    const source = createWsprPropagationSource({
      fetchImpl: async () => response,
    });
    await assert.rejects(source.getSnapshot());
  }
  const source = createWsprPropagationSource({
    fetchImpl: async () => Response.json({ data: [] }),
  });
  assert.deepEqual((await source.getSnapshot()).rows, []);
});

function streamFixture({ seedFails = false, denied = false } = {}) {
  let time = now,
    closed = 0;
  const client = new EventEmitter();
  client.subscribe = (topic, options, done) => {
    assert.equal(topic, 'pskr/filter/v2/2m/#');
    assert.equal(options.qos, 0);
    done(null, [{ qos: denied ? 128 : 0 }]);
  };
  client.end = () => {
    closed++;
  };
  const source = createVhfPropagationSource({
    now: () => time,
    seed: {
      getSnapshot: async () => {
        if (seedFails) throw new Error('offline');
        return { rows: [] };
      },
    },
    loadMqtt: async () => ({
      connect: (url) => {
        assert.equal(url, 'wss://mqtt.pskreporter.info:1886/mqtt');
        return client;
      },
    }),
  });
  const controller = new AbortController();
  return {
    source,
    client,
    controller,
    start: () => source.start({ signal: controller.signal }),
    closed: () => closed,
    advance: (ms) => {
      time += ms;
    },
  };
}
const spot = (patch = {}) => ({
  b: '2m',
  sc: 'N0TEST',
  sl: 'FN20',
  rc: 'G0TEST',
  rl: 'IO91',
  t: now / 1000 - 15,
  t_tx: now / 1000 - 30,
  f: 144174000,
  rp: -12,
  md: 'FT8',
  ...patch,
});

test('VHF stays inert until started, subscribes only to 2 m, validates and deduplicates reports', async () => {
  const f = streamFixture();
  assert.equal(f.source.getSnapshot().connected, false);
  f.start();
  await tick();
  f.client.emit('connect');
  assert.equal(f.source.getSnapshot().connected, true);
  for (const data of [spot(), spot(), spot({ b: '20m' }), spot({ sl: 'ZZ99' })])
    f.client.emit(
      'message',
      'pskr/filter/v2/2m/FT8',
      Buffer.from(JSON.stringify(data)),
    );
  f.client.emit('message', 'pskr/filter/v2/2m/FT8', Buffer.from('bad-json'));
  assert.equal(f.source.getSnapshot().rows.length, 1);
  assert.equal(f.source.getSnapshot().rows[0].observedAt, now - 30000);
  f.advance(PROPAGATION_WINDOW_MS);
  assert.equal(f.source.getSnapshot().rows.length, 0);
  f.controller.abort();
  assert.equal(f.closed(), 1);
  f.client.emit(
    'message',
    'pskr/filter/v2/2m/FT8',
    Buffer.from(JSON.stringify(spot())),
  );
  assert.equal(f.source.getSnapshot().rows.length, 0);
});

test('VHF bounds memory, labels loss and subscription refusal, and closes after disable', async () => {
  const f = streamFixture();
  f.start();
  await tick();
  f.client.emit('connect');
  for (let i = 0; i < PROPAGATION_MAX_PATHS + 100; i++)
    f.client.emit(
      'message',
      'pskr/filter/v2/2m/FT8',
      Buffer.from(JSON.stringify(spot({ sc: `N${i}TEST` }))),
    );
  assert.equal(f.source.getSnapshot().rows.length, PROPAGATION_MAX_PATHS);
  assert.equal(f.source.getSnapshot().truncated, true);
  f.client.emit('close');
  assert.equal(f.source.getSnapshot().streamUnavailable, true);
  assert.equal(f.source.getSnapshot().rows.length, PROPAGATION_MAX_PATHS);
  f.client.emit('connect');
  assert.equal(f.source.getSnapshot().degraded, false);
  f.controller.abort();
  const denied = streamFixture({ denied: true });
  denied.start();
  await tick();
  denied.client.emit('connect');
  assert.equal(denied.source.getSnapshot().connected, false);
  assert.equal(denied.source.getSnapshot().streamUnavailable, true);
  denied.controller.abort();
});

test('an aborted lazy import never opens MQTT', async () => {
  let complete,
    opened = false;
  const source = createVhfPropagationSource({
    seed: { getSnapshot: async () => ({ rows: [] }) },
    loadMqtt: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const c = new AbortController();
  source.start({ signal: c.signal });
  c.abort();
  complete({
    connect: () => {
      opened = true;
    },
  });
  await tick();
  assert.equal(opened, false);
});
