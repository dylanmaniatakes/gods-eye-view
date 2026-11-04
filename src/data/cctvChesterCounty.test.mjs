import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';
import { normalizeSourceItem } from '../../server/providers/cctv/normalize.js';
import {
  loadChesterCountySources,
  createChesterCountyStreamResolver,
} from '../../server/providers/cctv/chesterCounty.js';
import {
  createHlsPuller,
  HLS_LIMITS,
} from '../../server/providers/cctv/stream.js';

const [camera] = loadChesterCountySources();
const player = (url) => new Response(`var vurl = '${url}';`);

test('Chester County camera is HLS with an explicitly unconfirmed pose', () => {
  assert.equal(camera.feedType, 'hls');
  assert.equal(camera.cityId, 'west-chester-pa');
  assert.match(camera.name, /Courthouse/);
  assert.match(camera.credit, /Approximate/);
  assert.equal(camera.headingConfidence, 'unknown');
  assert.equal(camera.headingDeg, undefined);
  assert.equal(camera.poseSource, undefined);
  assert.equal(camera.snapshotUrl, undefined);
  assert.ok(camera.lat > 39.95 && camera.lat < 39.97);
  assert.ok(camera.lon > -75.61 && camera.lon < -75.6);
});

test('built-in catalog includes Chester County by default and honors its kill switch', async (t) => {
  const saved = { ...process.env };
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline fixture');
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  try {
    process.env.CCTV_FORCE_AUSTIN = '1';
    process.env.CCTV_SOURCES_FILE = '/nonexistent/cctv.json';
    delete process.env.CCTV_SOURCES_JSON;
    delete process.env.CCTV_CHESTER_COUNTY_ENABLED;
    const enabled = (await createCctvCatalog()()).find(
      (item) => item.id === camera.id,
    );
    assert.equal(enabled.pack, 'chester-county');
    assert.equal(enabled.url, camera.url);
    const courts = (await createCctvCatalog()()).filter(
      (item) => item.groupId === 'bounce-pickleball-malvern',
    );
    assert.equal(
      courts.length,
      8,
      'venue grouping survives catalog normalization',
    );
    process.env.CCTV_CHESTER_COUNTY_ENABLED = '0';
    assert.equal(
      (await createCctvCatalog()()).some((item) => item.id === camera.id),
      false,
    );
    assert.deepEqual(
      loadChesterCountySources({ sourceRoot: '/nonexistent' }),
      [],
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('court catalog refuses unrelated origins, paths and mismatched thumbnails', () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-webcam-'));
  const court = loadChesterCountySources().find((item) => item.groupId);
  fs.mkdirSync(path.join(sourceRoot, 'config'));
  try {
    for (const patch of [
      {
        url: court.url.replace('getrealtime.com', 'getrealtime.com.evil.test'),
      },
      { url: court.url.replace('/index.m3u8', '/other.m3u8') },
      { url: court.url.replace('https://', 'https://user@') },
      { url: `${court.url}?redirect=https://evil.test` },
      { snapshotUrl: 'https://evil.test/thumb.jpg' },
    ]) {
      fs.writeFileSync(
        path.join(sourceRoot, 'config/cctv_sources.chester-county.json'),
        JSON.stringify([{ ...court, ...patch }]),
      );
      assert.deepEqual(loadChesterCountySources({ sourceRoot }), []);
    }
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('regional webcams include both new FOX 29 locations and all eight named Bounce views', async () => {
  const cameras = loadChesterCountySources();
  const alloy = cameras.find(
    (item) => item.id === 'pa-king-of-prussia-the-alloy',
  );
  const airport = cameras.find(
    (item) => item.id === 'pa-philadelphia-international-airport',
  );
  assert.match(alloy.url, /\/207-13-01\/playlist\.m3u8$/);
  assert.match(airport.url, /\/207-12-01\/playlist\.m3u8$/);
  const courts = cameras.filter(
    (item) => item.groupId === 'bounce-pickleball-malvern',
  );
  assert.deepEqual(
    courts.map((item) => item.name.replace('Bounce Pickleball — ', '')),
    [
      'Court 1',
      'Court 2',
      'Court 3',
      'Courts 4-7',
      'Court 8',
      'Court 9',
      'Court 10',
      'Courts 11-14',
    ],
  );
  assert.equal(new Set(courts.map((item) => item.url)).size, 8);
  for (const item of [...courts, alloy, airport]) {
    assert.equal(item.headingConfidence, 'unknown');
    assert.equal(item.headingDeg, undefined);
    assert.match(item.credit, /Approximate/);
    assert.equal(item.widgetUrl, undefined, 'player URLs stay server-side');
  }
  const resolve = createChesterCountyStreamResolver({
    fetchImpl: async () => {
      assert.fail(
        'unsigned public court streams must not fetch a signed player',
      );
    },
  });
  for (const court of courts) {
    assert.equal(
      court.snapshotUrl,
      court.url.replace('/index.m3u8', '/thumb.jpg'),
    );
    assert.equal(normalizeSourceItem(court).groupId, court.groupId);
    assert.equal(await resolve(court.url), court.url);
  }
});

test('each FOX 29 feed resolves only its own registered public player stream', async () => {
  const cameras = loadChesterCountySources().filter(
    (item) => item.provider === 'FOX 29 / WMVision',
  );
  const expected = new Map([
    ['207-02-01', '03c793d2cc56746d5a7f622d90f6a4c9'],
    ['207-13-01', 'd3d711ce335d2b25881b6fe86c03941f'],
    ['207-12-01', 'cfdfdf22dd0486e385d3b6c5650c4a8a'],
  ]);
  for (const item of cameras) {
    const channel = item.url.split('/').at(-2);
    const resolve = createChesterCountyStreamResolver({
      fetchImpl: async (url) => {
        assert.equal(
          new URL(url).searchParams.get('uid'),
          expected.get(channel),
        );
        return player(`${item.url}?wmsAuthSign=fixture`);
      },
    });
    assert.equal(await resolve(item.url), `${item.url}?wmsAuthSign=fixture`);
  }
});

test('player URL resolution is singleflight, cached and renewed before expiration', async () => {
  let clock = 0;
  let calls = 0;
  const resolve = createChesterCountyStreamResolver({
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(new URL(url).hostname, 'api.wetmet.net');
      assert.equal(init.redirect, 'error');
      return player(`${camera.url}?wmsAuthSign=token${calls}`);
    },
  });
  const [first, concurrent] = await Promise.all([
    resolve(camera.url),
    resolve(camera.url),
  ]);
  assert.equal(first, concurrent);
  assert.equal(calls, 1);
  clock = 19 * 60 * 1000;
  assert.equal(await resolve(camera.url), first);
  clock = 20 * 60 * 1000;
  assert.notEqual(await resolve(camera.url), first);
  assert.equal(calls, 2);
  const other = 'https://unrelated.example/live.m3u8';
  assert.equal(await resolve(other), other);
  assert.equal(calls, 2);
});

test('player parser refuses off-host, wrong-camera, unsigned and oversized responses', async () => {
  for (const value of [
    'https://evil.example/live/207-02-01/playlist.m3u8?wmsAuthSign=x',
    camera.url.replace('207-02-01', 'other') + '?wmsAuthSign=x',
    camera.url.replace('https://', 'http://') + '?wmsAuthSign=x',
    camera.url.replace('https://', 'https://user@') + '?wmsAuthSign=x',
    camera.url,
  ]) {
    const resolve = createChesterCountyStreamResolver({
      fetchImpl: async () => player(value),
    });
    await assert.rejects(resolve(camera.url));
  }
  for (const response of [
    new Response('No camera'),
    new Response('x'.repeat(128 * 1024 + 1)),
    new Response('', {
      status: 302,
      headers: { location: 'https://evil.example' },
    }),
  ]) {
    const resolve = createChesterCountyStreamResolver({
      fetchImpl: async () => response,
    });
    await assert.rejects(resolve(camera.url));
  }
});

test('failed player fetch can retry; session cancellation aborts player download', async () => {
  let calls = 0;
  const resolve = createChesterCountyStreamResolver({
    fetchImpl: async () => {
      if (++calls === 1) throw new Error('offline');
      return player(`${camera.url}?wmsAuthSign=ok`);
    },
  });
  await assert.rejects(resolve(camera.url));
  assert.match(await resolve(camera.url), /wmsAuthSign=ok/);
  let started;
  const ready = new Promise((r) => {
    started = r;
  });
  const controller = new AbortController();
  const pendingResolve = createChesterCountyStreamResolver({
    fetchImpl: async (_url, { signal }) => {
      started();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        }),
      );
    },
  });
  const pending = pendingResolve(camera.url, controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(pending, /aborted/);
});

test('signed URL rotates inside an active HLS session without resetting local sequence', async () => {
  let signed = `${camera.url}?wmsAuthSign=one`;
  const seen = [];
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, pollMs: 5 },
    resolveUrl: async () => signed,
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response(
        url.includes('.m3u8')
          ? `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\na.ts?${new URL(url).searchParams}\n#EXTINF:2,\nb.ts?${new URL(url).searchParams}\n`
          : 'segment',
      );
    },
  });
  try {
    const entry = await manager.ensure(camera.id, camera.url);
    await entry.polling;
    const token = entry.token;
    signed = `${camera.url}?wmsAuthSign=two`;
    for (let i = 0; i < 100 && !seen.includes(signed); i++)
      await new Promise((r) => setTimeout(r, 5));
    await entry.polling;
    assert.ok(seen.includes(signed));
    assert.equal(entry.token, token);
    const playlist = await manager.buildPlaylist(entry, camera.id);
    assert.match(playlist, /seg_3\.ts/);
    assert.match(playlist, /#EXT-X-DISCONTINUITY/);
    assert.doesNotMatch(playlist, /wmsAuthSign/);
  } finally {
    await manager.shutdown();
  }
});
