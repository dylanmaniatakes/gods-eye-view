/** Display-only aircraft filters. Source records and analyst queries stay intact. */
export const FLIGHT_CLASSES = Object.freeze([
  'airliner',
  'widebody',
  'quadjet',
  'bizjet',
  'turboprop',
  'light',
  'helicopter',
  'fastjet',
  'glider',
  'uav',
  'unknown',
]);
export const DEFAULT_FLIGHT_FILTERS = Object.freeze({
  declutterEnabled: true,
  density: 'balanced',
  airborneOnly: false,
  typeFilterEnabled: false,
  classes: Object.freeze(['airliner', 'widebody', 'quadjet']),
  altitudeFilterEnabled: false,
  minAltitudeFt: 0,
  maxAltitudeFt: 60000,
});

export function normalizeFlightFilters(
  input = {},
  previous = DEFAULT_FLIGHT_FILTERS,
) {
  if (!input || typeof input !== 'object') input = {};
  const next = { ...previous };
  for (const key of [
    'declutterEnabled',
    'airborneOnly',
    'typeFilterEnabled',
    'altitudeFilterEnabled',
  ])
    if (typeof input[key] === 'boolean') next[key] = input[key];
  if (['balanced', 'sparse'].includes(input.density))
    next.density = input.density;
  if (Array.isArray(input.classes))
    next.classes = FLIGHT_CLASSES.filter((klass) =>
      input.classes.includes(klass),
    );
  for (const key of ['minAltitudeFt', 'maxAltitudeFt'])
    if (typeof input[key] === 'number' && Number.isFinite(input[key]))
      next[key] = Math.round(Math.max(-2000, Math.min(100000, input[key])));
  if (next.minAltitudeFt > next.maxAltitudeFt)
    [next.minAltitudeFt, next.maxAltitudeFt] = [
      next.maxAltitudeFt,
      next.minAltitudeFt,
    ];
  return { ...next, classes: [...next.classes] };
}

export function flightMatchesFilters(
  info = {},
  filters = DEFAULT_FLIGHT_FILTERS,
) {
  if (filters.airborneOnly && info.onGround === true) return false;
  const klass = FLIGHT_CLASSES.includes(info.klass) ? info.klass : 'unknown';
  if (filters.typeFilterEnabled && !filters.classes.includes(klass))
    return false;
  if (filters.altitudeFilterEnabled) {
    if (!Number.isFinite(info.altitude)) return false;
    const feet = info.altitude / 0.3048;
    if (feet < filters.minAltitudeFt || feet > filters.maxAltitudeFt)
      return false;
  }
  return true;
}

export function flightIdentityHash(id) {
  let value = 0x811c9dc5;
  for (let i = 0; i < id.length; i++)
    value = Math.imul(value ^ id.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

/** One stable winner per Earth-fixed cell. Camera pans cannot shuffle winners.
 * Cell size follows ground pixel scale in power-of-two steps. Close views show
 * every matching contact, and selected/emergency contacts bypass the grid.
 */
export function selectFlightDisplay(
  candidates,
  { filters, altitudeM, metresPerPixel },
) {
  const selected = new Set();
  const cells = new Map();
  const thin =
    filters.declutterEnabled && altitudeM >= 100000 && metresPerPixel > 0;
  const spacing = filters.density === 'sparse' ? 80 : 44;
  const cellM = thin
    ? Math.max(1000, 2 ** Math.round(Math.log2(metresPerPixel * spacing)))
    : 0;
  for (const candidate of candidates) {
    const { id, info, position, protected: protectedContact } = candidate;
    if (protectedContact) {
      selected.add(id);
      continue;
    }
    if (!flightMatchesFilters(info, filters)) continue;
    if (!thin) {
      selected.add(id);
      continue;
    }
    const key = `${Math.floor(position.x / cellM)}:${Math.floor(position.y / cellM)}:${Math.floor(position.z / cellM)}`;
    const previous = cells.get(key);
    if (
      !previous ||
      candidate.hash < previous.hash ||
      (candidate.hash === previous.hash && id < previous.id)
    )
      cells.set(key, candidate);
  }
  for (const candidate of cells.values()) selected.add(candidate.id);
  return selected;
}
