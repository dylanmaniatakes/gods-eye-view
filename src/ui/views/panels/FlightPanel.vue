<script setup>
import { computed, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { FLIGHT_CLASSES } from '../../../data/flightDisplayFilters.js';
import { AIRCRAFT_CLASS_LABELS as CLASS_LABELS } from '../../../data/aircraftClass.js';
import { useFlightPanelStore } from '../../stores/flightPanel.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import RailPanel from '../../rail/RailPanel.vue';
import UiButton from '../../kit/UiButton.vue';

const flights = useFlightPanelStore();
const chrome = usePanelChromeStore();
const filters = computed(() => flights.filters);
watch(() => flights.available && !(chrome.panels['flight-panel']?.collapsed ?? true),
  (visible) => flights.act('visibility', visible), { immediate: true });
const change = (patch) => flights.act('filter', patch);
function toggleClass(klass, checked) {
  change({ classes: checked ? [...filters.value.classes, klass] : filters.value.classes.filter((value) => value !== klass) });
}
</script>

<template>
  <RailPanel id="flight-panel" :hidden="!flights.available" start-collapsed :title="t('FLIGHTS')" sideways>
    <div class="cyber-panel-body ui-scroll flight-panel-body" data-rail-scroller>
      <div class="flight-feed-tabs">
        <UiButton :pressed="flights.feed === 'flights'" @click="flights.act('feed', 'flights')">{{ t('Live Flights') }}</UiButton>
        <UiButton :pressed="flights.feed === 'military'" @click="flights.act('feed', 'military')">{{ t('Military Flights') }}</UiButton>
      </div>
      <UiButton id="flight-feed-toggle" :pressed="flights.enabled" @click="flights.act('enable')">{{ flights.enabled ? t('ON') : t('OFF') }}</UiButton>
      <fieldset>
        <legend>{{ t('Map filters') }}</legend>
        <label><input id="flight-declutter" type="checkbox" :checked="filters.declutterEnabled" @change="change({ declutterEnabled: $event.target.checked })">{{ t('Declutter') }}</label>
        <label class="flight-select-label">{{ t('Density') }}
          <select id="flight-density" :disabled="!filters.declutterEnabled" :value="filters.density" @change="change({ density: $event.target.value })">
            <option value="balanced">{{ t('Balanced') }}</option><option value="sparse">{{ t('Sparse') }}</option>
          </select>
        </label>
        <label><input id="flight-airborne" type="checkbox" :checked="filters.airborneOnly" @change="change({ airborneOnly: $event.target.checked })">{{ t('Airborne only') }}</label>
        <p>{{ t('Decluttering reduces icons in wide views. Zoom in to reveal more aircraft.') }}</p>
      </fieldset>
      <fieldset>
        <legend><label><input id="flight-type-enabled" type="checkbox" :checked="filters.typeFilterEnabled" @change="change({ typeFilterEnabled: $event.target.checked })">{{ t('Aircraft types') }}</label></legend>
        <div class="flight-type-grid">
          <label v-for="klass in FLIGHT_CLASSES" :key="klass"><input type="checkbox" :data-flight-class="klass" :disabled="!filters.typeFilterEnabled" :checked="filters.classes.includes(klass)" @change="toggleClass(klass, $event.target.checked)">{{ t(CLASS_LABELS[klass] || 'Unknown') }}</label>
        </div>
        <div class="flight-feed-tabs">
          <UiButton :disabled="!filters.typeFilterEnabled" @click="change({ classes: [...FLIGHT_CLASSES] })">{{ t('All types') }}</UiButton>
          <UiButton :disabled="!filters.typeFilterEnabled" @click="change({ classes: [] })">{{ t('Clear types') }}</UiButton>
        </div>
      </fieldset>
      <fieldset>
        <legend><label><input id="flight-altitude-enabled" type="checkbox" :checked="filters.altitudeFilterEnabled" @change="change({ altitudeFilterEnabled: $event.target.checked })">{{ t('Altitude range') }}</label></legend>
        <div class="flight-altitude-inputs">
          <label>{{ t('Minimum altitude (ft)') }}<input id="flight-min-altitude" type="number" min="-2000" max="100000" step="500" :disabled="!filters.altitudeFilterEnabled" :value="filters.minAltitudeFt" @change="change({ minAltitudeFt: Number($event.target.value) })"></label>
          <label>{{ t('Maximum altitude (ft)') }}<input id="flight-max-altitude" type="number" min="-2000" max="100000" step="500" :disabled="!filters.altitudeFilterEnabled" :value="filters.maxAltitudeFt" @change="change({ maxAltitudeFt: Number($event.target.value) })"></label>
        </div>
      </fieldset>
      <p>{{ t('Selected and emergency aircraft remain visible. Filters are saved in this browser.') }}</p>
      <UiButton id="flight-reset-filters" @click="flights.act('reset')">{{ t('Reset filters') }}</UiButton>
      <div class="flight-roster">
        <label>{{ t('Flight list') }}<input id="flight-search" type="search" :value="flights.search" :placeholder="t('Search callsign, registration or aircraft type')" @input="flights.act('search', $event.target.value)"></label>
        <p role="status">{{ t('{matching} matching · {total} loaded', { matching: flights.list.matching, total: flights.list.total }) }}</p>
        <p>{{ t('The list includes matching aircraft hidden by decluttering. Select a flight to inspect it.') }}</p>
        <ul>
          <li v-for="flight in flights.list.rows" :key="flight.id">
            <UiButton :pressed="flight.selected" :disabled="!flights.enabled" :data-flight-id="flight.id" @click="flights.act('select', flight.id)">
              <strong>{{ flight.label }}</strong><span>{{ flight.registration || flight.id }} · {{ flight.typeCode || t(CLASS_LABELS[flight.klass] || 'Unknown') }}</span>
              <span>{{ flight.onGround ? t('On ground') : flight.altitudeFt === null ? '—' : `${flight.altitudeFt.toLocaleString()} ft` }} · {{ flight.visible ? t('On map') : t('Hidden on map') }}</span>
            </UiButton>
          </li>
        </ul>
        <p v-if="!flights.list.rows.length">{{ t('No matching flights') }}</p>
        <div class="flight-pagination">
          <UiButton :disabled="flights.list.page === 0" @click="flights.act('page', flights.list.page - 1)">{{ t('Previous') }}</UiButton>
          <span>{{ flights.list.page + 1 }} / {{ flights.list.pages }}</span>
          <UiButton :disabled="flights.list.page + 1 >= flights.list.pages" @click="flights.act('page', flights.list.page + 1)">{{ t('Next') }}</UiButton>
        </div>
      </div>
      <p v-if="flights.error" role="alert">{{ flights.error }}</p>
    </div>
  </RailPanel>
</template>

<style scoped>
:deep(.flight-panel-inner) { display: flex; flex-direction: column; padding: 0; background: var(--panel-bg, rgba(5,15,24,.94)); border: 1px solid var(--glass-border); border-radius: 12px; max-height: inherit; overflow: hidden; box-sizing: border-box; }
:deep(.flight-panel-inner > .panel-header) { flex: none; margin: 0; padding: 12px 14px; }
.collapsed .flight-panel-body { display: none; }
.flight-panel-body { display: block; flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; font-size: 12px; }
.flight-feed-tabs, .flight-pagination { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
fieldset { min-width: 0; border: 1px solid var(--glass-border, #354b5a); margin: 12px 0; padding: 10px; }
label { display: flex; align-items: center; gap: 6px; margin: 5px 0; }
input[type=checkbox] { flex: none; }
select, input[type=number], input[type=search] { min-width: 0; width: 100%; color: inherit; background: var(--glass-bg, #0c1c26); border: 1px solid var(--glass-border, #354b5a); padding: 6px; border-radius: 4px; }
.flight-type-grid, .flight-altitude-inputs { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4px; }
.flight-altitude-inputs label, .flight-roster > label { display: block; }
.flight-select-label { justify-content: space-between; }
.flight-select-label select { width: auto; }
p { opacity: .78; line-height: 1.45; margin: 8px 0; }
ul { list-style: none; margin: 10px 0; padding: 0; }
li { margin: 5px 0; }
li :deep(button) { width: 100%; text-align: left; display: grid; gap: 3px; }
li span { font-size: 11px; opacity: .8; }
:deep(button) { padding: 7px 9px; border: 1px solid var(--glass-border, #354b5a); background: var(--glass-bg, #0c1c26); color: inherit; border-radius: 4px; cursor: pointer; }
:deep(button[aria-pressed=true]) { border-color: var(--display-accent, #69cbd1); }
:deep(button:disabled), input:disabled, select:disabled { opacity: .45; cursor: default; }
.flight-pagination { justify-content: space-between; }
</style>
