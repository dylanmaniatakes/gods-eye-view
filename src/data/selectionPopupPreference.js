export const SELECTION_POPUPS_KEY = 'gev:selection-popups:v1';

/** Browser-local popup visibility; selection and inspection remain layer-owned. */
export function createSelectionPopupPreference({
  storage = () => globalThis.window?.localStorage,
} = {}) {
  let visible;
  const listeners = new Set();
  function get() {
    if (visible === undefined) {
      try {
        visible = storage()?.getItem(SELECTION_POPUPS_KEY) !== 'hidden';
      } catch {
        visible = true;
      }
    }
    return visible;
  }
  function set(next) {
    const changed = get() !== Boolean(next);
    visible = Boolean(next);
    try {
      storage()?.setItem(SELECTION_POPUPS_KEY, visible ? 'shown' : 'hidden');
    } catch {
      // The toggle still works for this session when storage is unavailable.
    }
    if (changed) for (const listener of listeners) listener(visible);
    return visible;
  }
  return {
    get,
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const selectionPopupPreference = createSelectionPopupPreference();
