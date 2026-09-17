<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="720"
  >
    <v-card>
      <v-card-title>Preferences</v-card-title>
      <v-card-text>
        <v-tabs v-model="tab" color="primary">
          <v-tab value="general">General</v-tab>
          <v-tab value="filters">Filters</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-4">
          <v-window-item value="general">
            <div v-if="loadingPrefs" class="text-center py-6">
              <v-progress-circular indeterminate color="primary" />
            </div>
            <v-list v-else lines="one">
              <v-list-item v-for="pref in editablePrefs" :key="pref.name">
                <v-checkbox
                  v-if="pref.type === 'bool'"
                  :model-value="pref.value === '1' || pref.value === 'true'"
                  :label="prefText(pref.name)"
                  hide-details
                  @update:model-value="(checked: boolean) => savePref(pref.name, checked ? '1' : '0')"
                />
                <v-text-field
                  v-else
                  :model-value="pref.value"
                  :label="prefText(pref.name)"
                  density="compact"
                  hide-details
                  @change="(value: string) => savePref(pref.name, value)"
                />
              </v-list-item>
            </v-list>
            <p class="text-caption text-grey mt-4">
              Changes are saved immediately to the backend.
            </p>
          </v-window-item>

          <v-window-item value="filters">
            <div v-if="loadingFilters" class="text-center py-6">
              <v-progress-circular indeterminate color="primary" />
            </div>
            <v-list v-else lines="two">
              <v-list-item v-for="filter in filters" :key="filterId(filter)">
                <v-list-item-title>{{ filterTitle(filter) }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ filter.enabled !== false ? 'Enabled' : 'Disabled' }}
                </v-list-item-subtitle>
                <template #append>
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="deleteFilter(filter)"
                  />
                </template>
              </v-list-item>
              <v-list-item v-if="filters.length === 0">
                <v-list-item-title>No filters defined</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-window-item>
        </v-window>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
          {{ message }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="closeDialog">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import api from '../../api/client';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const tab = ref('general');
const loadingPrefs = ref(false);
const loadingFilters = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

interface EditablePref {
  name: string;
  value: string;
  type: 'bool' | 'string';
}

// The subset of TT-RSS user preferences surfaced in the UI
const prefDefinitions: Array<{ name: string; type: EditablePref['type']; label: string }> = [
  { name: 'PURGE_UNREAD_ON_DAYS', type: 'string', label: 'Purge unread articles older than (days)' },
  { name: 'PURGE_READ_ON_DAYS', type: 'string', label: 'Purge read articles older than (days)' },
  { name: 'UPDATE_POST_ON_CHECK', type: 'bool', label: 'Update articles in background' },
  { name: 'ENABLE_FEED_ICONS', type: 'bool', label: 'Show feed icons' },
  { name: 'HIDE_READ_FEEDS', type: 'bool', label: 'Hide read feeds in the feed list' },
  { name: 'SORT_FEEDS_UNREAD', type: 'bool', label: 'Sort feeds by unread count' },
  { name: 'SHOW_CONTENT_PREVIEW', type: 'bool', label: 'Show content preview in headlines' },
  { name: 'STRIP_UNSAFE_IMAGES', type: 'bool', label: 'Strip unsafe images from articles' },
];

const editablePrefs = ref<EditablePref[]>([]);
const filters = ref<Array<Record<string, unknown>>>([]);

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      message.value = '';
      tab.value = 'general';
      await Promise.all([loadPrefs(), loadFilters()]);
    }
  }
);

// Helper to get preference label
const prefText = (name: string) =>
  prefDefinitions.find(d => d.name === name)?.label ?? name;

async function loadPrefs() {
  loadingPrefs.value = true;
  const result: EditablePref[] = [];
  for (const def of prefDefinitions) {
    try {
      const response = await api.getPref(def.name);
      result.push({
        name: def.name,
        type: def.type,
        value: response.status === 0 ? String((response.content as { Value?: unknown })?.Value ?? '') : '',
      });
    } catch {
      result.push({ name: def.name, type: def.type, value: '' });
    }
  }
  editablePrefs.value = result;
  loadingPrefs.value = false;
}

async function savePref(name: string, value: string) {
  try {
    const response = await api.setPref(name, value);
    notify(
      response.status === 0 ? 'Preference saved' : 'Failed to save preference',
      response.status === 0 ? 'success' : 'error'
    );
  } catch {
    notify('Failed to save preference', 'error');
  }
}

async function loadFilters() {
  loadingFilters.value = true;
  try {
    const response = await api.getFilters();
    if (response.status === 0) {
      const content = response.content as { content?: unknown };
      const list = Array.isArray(content) ? content : content?.content;
      filters.value = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
    }
  } catch {
    notify('Failed to load filters', 'error');
  } finally {
    loadingFilters.value = false;
  }
}

// Filter records come in differing shapes depending on backend version
const filterId = (filter: Record<string, unknown>) => Number(filter.id ?? filter.filter_id ?? 0);
const filterTitle = (filter: Record<string, unknown>) =>
  String(filter.title ?? filter.name ?? `Filter #${filterId(filter)}`);

async function deleteFilter(filter: Record<string, unknown>) {
  try {
    const response = await api.deleteFilter(filterId(filter));
    if (response.status === 0) {
      filters.value = filters.value.filter(f => filterId(f) !== filterId(filter));
      notify('Filter deleted');
    } else {
      notify('Failed to delete filter', 'error');
    }
  } catch {
    notify('Failed to delete filter', 'error');
  }
}

function notify(text: string, type: 'success' | 'error' = 'success') {
  message.value = text;
  messageType.value = type;
}

// Close dialog
function closeDialog() {
  emit('update:modelValue', false);
}
</script>

