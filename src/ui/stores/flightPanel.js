import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { createOwners } from './owners.js';
import { normalizeFlightFilters } from '../../data/flightDisplayFilters.js';

export const useFlightPanelStore = defineStore('gev-flight-panel', () => {
  const owners = createOwners();
  const feed = ref('flights');
  const visible = ref(false);
  const available = ref(false);
  const enabled = ref(false);
  const filters = shallowRef(normalizeFlightFilters());
  const list = shallowRef({
    rows: [],
    total: 0,
    matching: 0,
    page: 0,
    pages: 1,
  });
  const search = ref('');
  const error = ref('');
  async function act(name, ...args) {
    error.value = '';
    if (name === 'visibility') visible.value = Boolean(args[0]);
    try {
      return await owners.act(name, ...args);
    } catch (failure) {
      error.value = failure.message;
    }
  }
  return {
    feed,
    visible,
    available,
    enabled,
    filters,
    list,
    search,
    error,
    act,
    connect: owners.connect,
    detach: owners.detach,
  };
});
