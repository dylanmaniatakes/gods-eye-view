import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import SavedViews from './views/panels/SavedViews.vue';
import { useSavedViewsStore } from './stores/savedViews.js';

test('bookmark controls save, recall, update, delete and expose selection mode', async (t) => {
  document.body.replaceChildren();
  const pinia = createPinia();
  const store = useSavedViewsStore(pinia);
  const calls = [];
  const token = store.connect(
    Object.fromEntries(
      ['save', 'restore', 'remove', 'undo', 'selectionMode'].map((name) => [
        name,
        (...args) => calls.push([name, ...args]),
      ]),
    ),
  );
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp(SavedViews).use(pinia);
  app.mount(host);
  t.after(() => {
    app.unmount();
    store.detach(token);
  });
  document.querySelector('#saved-views-toggle').click();
  await nextTick();
  const input = document.querySelector('form input');
  input.value = 'Home';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  store.publish({ rows: [{ name: 'Home' }], canUndo: true });
  await nextTick();
  for (const button of document.querySelectorAll('li button')) button.click();
  document.querySelector('.saved-views-panel > button').click();
  const checkbox = document.querySelector('input[type=checkbox]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(calls, [
    ['save', 'Home'],
    ['restore', 'Home'],
    ['save', 'Home', true],
    ['remove', 'Home'],
    ['undo'],
    ['selectionMode', true],
  ]);
});
