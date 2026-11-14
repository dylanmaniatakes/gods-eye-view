/** Observed amateur-radio bands; colours identify bands rather than quality. */
export const PROPAGATION_BANDS = Object.freeze([
  { id: '10m', wspr: 28, color: '#ffb454', minHz: 28e6, maxHz: 29.7e6 },
  { id: '20m', wspr: 14, color: '#54d8ff', minHz: 14e6, maxHz: 14.35e6 },
  { id: '40m', wspr: 7, color: '#7de997', minHz: 7e6, maxHz: 7.3e6 },
  { id: '80m', wspr: 3, color: '#c59bff', minHz: 3.5e6, maxHz: 4e6 },
  { id: '160m', wspr: 1, color: '#ff7eaa', minHz: 1.8e6, maxHz: 2e6 },
  { id: '2m', wspr: 144, color: '#55e2be', minHz: 144e6, maxHz: 148e6 },
]);
export const PROPAGATION_WINDOW_MS = 30 * 60 * 1000;
export const PROPAGATION_MAX_PATHS = 1500;

/** Centre of a reported Maidenhead locator, never a precise antenna position. */
export function locatorCenter(value) {
  if (typeof value !== 'string') return null;
  const grid = value.trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}(?:[A-X]{2}(?:\d{2})?)?$/.test(grid)) return null;
  let lon = -180 + (grid.charCodeAt(0) - 65) * 20 + Number(grid[2]) * 2;
  let lat = -90 + (grid.charCodeAt(1) - 65) * 10 + Number(grid[3]);
  let width = 2,
    height = 1;
  if (grid.length >= 6) {
    width /= 24;
    height /= 24;
    lon += (grid.charCodeAt(4) - 65) * width;
    lat += (grid.charCodeAt(5) - 65) * height;
  }
  if (grid.length === 8) {
    width /= 10;
    height /= 10;
    lon += Number(grid[6]) * width;
    lat += Number(grid[7]) * height;
  }
  return { lon: lon + width / 2, lat: lat + height / 2, grid };
}

/** Short great-circle distance; this does not identify the RF propagation mode. */
export function pathDistanceKm(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Reject corrupt, old, future, out-of-band or unlocated reception reports. */
export function normalizePropagationReport(report, now = Date.now()) {
  if (!report || typeof report !== 'object') return null;
  const band = PROPAGATION_BANDS.find((entry) => entry.id === report.band);
  const observedAt = report.observedAt;
  const frequencyHz = report.frequencyHz;
  const tx = String(report.tx || '')
    .trim()
    .toUpperCase();
  const rx = String(report.rx || '')
    .trim()
    .toUpperCase();
  const callPattern = /^[A-Z0-9][A-Z0-9/.-]{1,23}$/;
  const from = locatorCenter(report.txGrid);
  const to = locatorCenter(report.rxGrid);
  if (
    !band ||
    !callPattern.test(tx) ||
    !callPattern.test(rx) ||
    tx === rx ||
    !from ||
    !to ||
    !Number.isFinite(observedAt) ||
    observedAt < now - PROPAGATION_WINDOW_MS ||
    observedAt > now + 60000 ||
    !Number.isFinite(frequencyHz) ||
    frequencyHz < band.minHz ||
    frequencyHz > band.maxHz
  )
    return null;
  const distanceKm = pathDistanceKm(from, to);
  if (distanceKm < 1) return null;
  return {
    id: `${band.id}:${tx}:${from.grid}:${rx}:${to.grid}`,
    band: band.id,
    tx,
    rx,
    from,
    to,
    observedAt,
    frequencyHz,
    distanceKm,
    snrDb:
      Number.isFinite(report.snrDb) &&
      report.snrDb >= -100 &&
      report.snrDb <= 100
        ? report.snrDb
        : null,
    reports:
      Number.isSafeInteger(report.reports) && report.reports > 0
        ? report.reports
        : 1,
    source: report.source === 'PSK Reporter' ? 'PSK Reporter' : 'WSPR Live',
    mode: /^[A-Z0-9-]{1,16}$/.test(report.mode || '')
      ? report.mode
      : 'WSPR/FST4W',
  };
}

/** Keep only fresh directional paths, with a fixed memory ceiling. */
export function prunePropagationPaths(
  paths,
  now = Date.now(),
  limit = PROPAGATION_MAX_PATHS,
) {
  for (const [id, row] of paths) {
    if (row.observedAt < now - PROPAGATION_WINDOW_MS) paths.delete(id);
  }
  while (paths.size > limit) paths.delete(paths.keys().next().value);
}

/** Bin repeat reports by station pair and band, preserving the newest evidence. */
export function mergePropagationPath(paths, row) {
  if (!row) return;
  const previous = paths.get(row.id);
  if (previous && previous.observedAt >= row.observedAt) return;
  paths.delete(row.id);
  paths.set(row.id, row);
}
