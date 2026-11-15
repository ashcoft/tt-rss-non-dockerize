<template>
  <div>
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">Content filters</v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 mb-3 flex-wrap">
          <v-btn color="primary" prepend-icon="mdi-plus" @click="createFilter">Create filter</v-btn>
          <v-btn variant="tonal" :disabled="selected.length !== 1" @click="cloneSelected">Clone</v-btn>
          <v-btn variant="tonal" :disabled="selected.length < 2" @click="joinSelected">Combine</v-btn>
          <v-btn variant="tonal" color="error" :disabled="selected.length === 0" @click="removeSelected">Remove</v-btn>
          <v-btn variant="text" prepend-icon="mdi-sort" @click="resetOrder">Reset sort order</v-btn>
        </div>

        <v-list density="compact">
          <v-list-item v-for="(filter, index) in filtersStore.filters" :key="filter.id">
            <template #prepend>
              <v-checkbox
                :model-value="selected.includes(filter.id)"
                hide-details
                density="compact"
                @update:model-value="(checked: boolean) => toggleSelected(filter.id, checked)"
              />
            </template>
            <v-list-item-title>
              <span :class="{ 'text-grey': !filter.enabled }">{{ filter.title || '[No caption]' }}</span>
            </v-list-item-title>
            <v-list-item-subtitle>{{ filter.summary }}</v-list-item-subtitle>
            <template #append>
              <v-btn
                icon="mdi-arrow-up"
                size="small"
                variant="text"
                :disabled="index === 0"
                @click="move(filter.id, -1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                size="small"
                variant="text"
                :disabled="index === filtersStore.filters.length - 1"
                @click="move(filter.id, 1)"
              />
              <v-btn icon="mdi-pencil" size="small" variant="text" @click="editFilter(filter.id)" />
              <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeFilter(filter.id)" />
            </template>
          </v-list-item>

          <v-list-item v-if="filtersStore.filters.length === 0">
            <v-list-item-title class="text-grey">No filters defined.</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <FilterEditorDialog v-model="editorOpen" :filter-id="editingId" @saved="onSaved" />

    <PluginPrefsSection tab-id="prefFilters" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { runDetached } from '../../utils/runDetached';
import { useFiltersStore } from '../../stores/filters';
import { usePrefsNotifier } from './notify';
import FilterEditorDialog from '../dialogs/FilterEditorDialog.vue';
import PluginPrefsSection from './PluginPrefsSection.vue';

const notify = usePrefsNotifier();
const filtersStore = useFiltersStore();
const selected = ref<number[]>([]);
const editorOpen = ref(false);
const editingId = ref(0);

function toggleSelected(id: number, checked: boolean) {
  selected.value = checked
    ? [...selected.value, id]
    : selected.value.filter(entry => entry !== id);
}

function createFilter() {
  editingId.value = 0;
  editorOpen.value = true;
}

function editFilter(id: number) {
  editingId.value = id;
  editorOpen.value = true;
}

async function removeFilter(id: number) {
  if (await filtersStore.removeFilters([id])) {
    selected.value = selected.value.filter(entry => entry !== id);
    notify('Filter removed', 'success');
  } else {
    notify(filtersStore.error ?? 'Failed to remove filter', 'error');
  }
}

async function removeSelected() {
  if (await filtersStore.removeFilters(selected.value)) {
    selected.value = [];
    notify('Filters removed', 'success');
  } else {
    notify(filtersStore.error ?? 'Failed to remove filters', 'error');
  }
}

async function cloneSelected() {
  if (await filtersStore.cloneFilters(selected.value)) notify('Filter cloned', 'success');
  else notify(filtersStore.error ?? 'Failed to clone filter', 'error');
}

async function joinSelected() {
  if (await filtersStore.joinFilters(selected.value)) {
    selected.value = [];
    notify('Filters combined', 'success');
  } else {
    notify(filtersStore.error ?? 'Failed to combine filters', 'error');
  }
}

async function resetOrder() {
  if (await filtersStore.resetOrder()) notify('Sort order reset', 'success');
  else notify(filtersStore.error ?? 'Failed to reset order', 'error');
}

/** Swap a filter with its neighbour and persist the new order. */
function move(id: number, delta: number) {
  const order = filtersStore.filters.map(f => f.id);
  const index = order.indexOf(id);
  const target = index + delta;
  if (target < 0 || target >= order.length) return;

  [order[index], order[target]] = [order[target], order[index]];
  runDetached(filtersStore.saveOrder(order), 'save filter order');
}

function onSaved() {
  selected.value = [];
}

onMounted(() => {
  runDetached(filtersStore.loadFilters(), 'load filters');
});
</script>
