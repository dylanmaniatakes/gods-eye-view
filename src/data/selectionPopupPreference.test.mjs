import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSelectionPopupPreference,
  SELECTION_POPUPS_KEY,
} from './selectionPopupPreference.js';

test('popup preference persists across reloads and notifies active owners only on change', () => {
  const disk = new Map();
  const storage = () => ({
    getItem: (key) => disk.get(key),
    setItem: (key, value) => disk.set(key, value),
  });
  const preference = createSelectionPopupPreference({ storage });
  const seen = [];
  const detach = preference.subscribe((visible) => seen.push(visible));
  assert.equal(preference.get(), true);
  preference.set(false);
  preference.set(false);
  assert.deepEqual(seen, [false]);
  assert.equal(disk.get(SELECTION_POPUPS_KEY), 'hidden');
  assert.equal(createSelectionPopupPreference({ storage }).get(), false);
  detach();
  preference.set(true);
  assert.deepEqual(seen, [false]);
  assert.equal(createSelectionPopupPreference({ storage }).get(), true);
});

test('blocked storage leaves popup visibility usable for the current session', () => {
  const preference = createSelectionPopupPreference({
    storage: () => {
      throw new Error('denied');
    },
  });
  assert.equal(preference.get(), true);
  assert.equal(preference.set(false), false);
  assert.equal(preference.get(), false);
  assert.equal(preference.set(true), true);
});
