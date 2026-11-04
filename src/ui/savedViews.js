const KEY = 'gev-saved-views-v1';
const MAX_VIEWS = 50;

/** Validate camera snapshots before storage or navigation. */
export function validCamera(camera) {
  return (
    camera &&
    ['lat', 'lon', 'alt', 'heading', 'pitch', 'roll'].every(
      (key) => typeof camera[key] === 'number' && Number.isFinite(camera[key]),
    ) &&
    Math.abs(camera.lat) <= 90 &&
    Math.abs(camera.lon) <= 180 &&
    camera.alt >= -10000 &&
    camera.alt <= 1e9
  );
}

/** Browser-local named camera bookmarks; a failed write never reports success. */
export function createSavedViews({
  storage,
  capture,
  restore,
  publish = () => {},
}) {
  let rows = [];
  let previous = null;
  function refresh() {
    try {
      const raw = storage?.getItem(KEY) || '[]';
      const value = raw.length <= 65536 ? JSON.parse(raw) : [];
      const seen = new Set();
      rows = Array.isArray(value)
        ? value
            .filter((row) => {
              if (
                typeof row?.name !== 'string' ||
                !row.name.trim() ||
                row.name.length > 80 ||
                !validCamera(row.camera) ||
                seen.has(row.name)
              )
                return false;
              seen.add(row.name);
              return true;
            })
            .slice(0, MAX_VIEWS)
        : [];
    } catch {
      rows = [];
    }
  }
  const list = () => {
    refresh();
    return structuredClone(rows);
  };
  const notify = () => publish({ rows: list(), canUndo: Boolean(previous) });
  function commit(next) {
    if (!storage) throw new Error('Browser storage is unavailable');
    storage.setItem(KEY, JSON.stringify(next));
    rows = next;
    notify();
  }
  function nameOf(name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
      throw new Error('Use a view name between 1 and 80 characters');
    return name.trim();
  }
  function save(name, overwrite = false) {
    refresh();
    name = nameOf(name);
    const camera = capture();
    if (!validCamera(camera)) throw new Error('Camera is unavailable');
    const existing = rows.some((row) => row.name === name);
    if (existing && !overwrite)
      throw new Error('A view with that name already exists');
    if (!existing && rows.length >= MAX_VIEWS)
      throw new Error('Saved view limit reached (50)');
    commit([
      ...rows.filter((row) => row.name !== name),
      { name, camera: { ...camera } },
    ]);
    return { name, camera };
  }
  function recall(name) {
    refresh();
    const row = rows.find((row) => row.name === nameOf(name));
    if (!row) throw new Error('Saved view not found');
    const current = capture();
    restore(structuredClone(row.camera));
    previous = validCamera(current) ? current : null;
    notify();
    return structuredClone(row);
  }
  function undo() {
    if (!previous) throw new Error('No previous view to restore');
    const camera = previous;
    const current = capture();
    restore(structuredClone(camera));
    previous = validCamera(current) ? current : null;
    notify();
    return { camera };
  }
  function remove(name) {
    refresh();
    name = nameOf(name);
    if (!rows.some((row) => row.name === name))
      throw new Error('Saved view not found');
    commit(rows.filter((row) => row.name !== name));
    return { name };
  }
  notify();
  return { list, save, restore: recall, undo, remove };
}
