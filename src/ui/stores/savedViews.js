import { defineStore } from 'pinia';
import { ref } from 'vue';
import { createOwners } from './owners.js';

/** Saved camera views and the actions answered by the active shell. */
export const useSavedViewsStore = defineStore('gev-saved-views', () => {
  const owners = createOwners();
  const rows = ref([]);
  const canUndo = ref(false);
  const focusOnClick = ref(false);
  const error = ref('');
  const open = ref(false);
  function publish(state) {
    rows.value = state.rows;
    canUndo.value = state.canUndo;
  }
  async function act(name, ...args) {
    error.value = '';
    try {
      return await owners.act(name, ...args);
    } catch (failure) {
      error.value = failure.message;
    }
  }
  return {
    rows,
    canUndo,
    focusOnClick,
    error,
    open,
    publish,
    act,
    connect: owners.connect,
    detach: owners.detach,
  };
});
