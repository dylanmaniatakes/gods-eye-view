<script setup>
import { ref } from 'vue';
import { t } from '../../../i18n/index.js';
import { useSavedViewsStore } from '../../stores/savedViews.js';
import UiButton from '../../kit/UiButton.vue';
const views = useSavedViewsStore();
const name = ref('');
</script>

<template>
  <UiButton id="saved-views-toggle" :pressed="views.open" :label="t('Saved views')" :aria-expanded="String(views.open)" aria-controls="saved-views-panel" :title="t('Saved views')" @click="views.open = !views.open"><span class="material-symbols-outlined" aria-hidden="true">bookmarks</span></UiButton>
  <Teleport to="body">
  <section v-if="views.open" id="saved-views-panel" class="saved-views-panel" :aria-label="t('Saved views')">
    <label><input type="checkbox" :checked="views.focusOnClick" @change="views.act('selectionMode', $event.target.checked)" />{{ t('Focus map on selection') }}</label>
    <form @submit.prevent="views.act('save', name)">
      <input v-model="name" maxlength="80" :aria-label="t('View name')" :placeholder="t('View name')" required />
      <UiButton type="submit">{{ t('Save view') }}</UiButton>
    </form>
    <p>{{ t('Saves camera position and orientation in this browser.') }}</p>
    <ul>
      <li v-for="view in views.rows" :key="view.name">
        <UiButton @click="views.act('restore', view.name)">{{ view.name }}</UiButton>
        <UiButton :title="t('Update saved view')" @click="views.act('save', view.name, true)">{{ t('Update') }}</UiButton>
        <UiButton :title="t('Delete saved view')" @click="views.act('remove', view.name)">{{ t('Delete') }}</UiButton>
      </li>
    </ul>
    <UiButton :disabled="!views.canUndo" @click="views.act('undo')">{{ t('Return to previous view') }}</UiButton>
    <p v-if="views.error" role="alert">{{ views.error }}</p>
  </section>
  </Teleport>
</template>

<style scoped>
.saved-views-panel { position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 120; width: min(390px, 90vw); max-height: 65vh; overflow: auto; padding: 14px; background: var(--panel-bg, #07131f); color: var(--text-primary, #fff); border: 1px solid currentColor; pointer-events: auto; }
form, li { display: flex; gap: 6px; margin: 8px 0; }
ul { list-style: none; padding: 0; }
input { min-width: 0; }
li > :first-child { flex: 1; overflow-wrap: anywhere; }
p { font-size: 12px; }
.saved-views-panel :deep(button) { padding: 6px 9px; border: 1px solid var(--glass-border, #4d6475); border-radius: 4px; background: var(--glass-bg, #102331); color: inherit; cursor: pointer; }
.saved-views-panel :deep(button:disabled) { opacity: 0.5; }
:global(body.ui-clean-view .saved-views-panel), :global(body.recording-mode .saved-views-panel) { display: none; }
</style>
