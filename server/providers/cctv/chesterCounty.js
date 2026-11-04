import fs from 'node:fs';
import path from 'node:path';
import { isPlausibleLatLon } from './normalize.js';
import { fetchHlsBytes } from './stream.js';

function registeredStream(item) {
  if (typeof item.url !== 'string') return false;
  if (item.widgetUrl) {
    return (
      /^https:\/\/wms-prod-\d+\.wetmet\.net\/live\/[\d-]+\/playlist\.m3u8$/.test(
        item.url,
      ) &&
      typeof item.widgetUrl === 'string' &&
      /^https:\/\/api\.wetmet\.net\/widgets\/stream\/frame\.php\?uid=[a-f0-9]{32}$/.test(
        item.widgetUrl,
      )
    );
  }
  // Bounce's public player supplies these unsigned HLS and thumbnail pairs.
  return (
    /^https:\/\/w00[1-3]\.cdn\.getrealtime\.com\/[a-f0-9]{24}\/index\.m3u8$/.test(
      item.url,
    ) && item.snapshotUrl === item.url.replace('/index.m3u8', '/thumb.jpg')
  );
}

/** Regional public webcams. Coordinates are approximate until mounts are confirmed. */
function readCatalog(sourceRoot) {
  try {
    const rows = JSON.parse(
      fs.readFileSync(
        path.resolve(sourceRoot, 'config/cctv_sources.chester-county.json'),
        'utf8',
      ),
    );
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        item.id.trim() &&
        typeof item.lat === 'number' &&
        typeof item.lon === 'number' &&
        isPlausibleLatLon(item.lat, item.lon) &&
        registeredStream(item),
    );
  } catch {
    return [];
  }
}

export function loadChesterCountySources({ sourceRoot = process.cwd() } = {}) {
  return readCatalog(sourceRoot).map(({ widgetUrl, ...camera }) => ({
    ...camera,
    feedType: 'hls',
  }));
}

/** Refresh the player's 30-minute signed URL on demand, before it expires.
 * Only registered stream/widget pairs are fetched; player JavaScript is never run.
 */
export function createChesterCountyStreamResolver({
  sourceRoot = process.cwd(),
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const cameras = readCatalog(sourceRoot).filter((camera) => camera.widgetUrl);
  const cache = new Map();
  const inflight = new Map();
  return async (url, signal) => {
    const camera = cameras.find((item) => item.url === url);
    if (!camera) return url;
    signal?.throwIfAborted();
    const cached = cache.get(url);
    if (cached && now() < cached.expiresAt) return cached.url;
    if (inflight.has(url)) return inflight.get(url);
    const pending = (async () => {
      const html = (
        await fetchHlsBytes(camera.widgetUrl, {
          fetchImpl,
          signal,
          maxBytes: 128 * 1024,
          timeoutMs: 8000,
        })
      ).toString('utf8');
      const match = html.match(/\bvar\s+vurl\s*=\s*(['"])([^'"\r\n]+)\1\s*;/);
      if (!match) throw new Error('Camera player has no stream URL');
      const signed = new URL(match[2]);
      const registered = new URL(url);
      if (
        signed.origin !== registered.origin ||
        signed.pathname !== registered.pathname ||
        signed.username ||
        signed.password ||
        signed.hash ||
        !signed.searchParams.get('wmsAuthSign')
      )
        throw new Error(
          'Camera player stream does not match registered camera',
        );
      signal?.throwIfAborted();
      cache.set(url, { url: signed.href, expiresAt: now() + 20 * 60 * 1000 });
      return signed.href;
    })().finally(() => inflight.delete(url));
    inflight.set(url, pending);
    return pending;
  };
}
