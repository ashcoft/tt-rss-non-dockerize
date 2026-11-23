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
          <v-tab value="advanced">Advanced</v-tab>
          <v-tab value="filters">Filters</v-tab>
          <v-tab value="password">Password</v-tab>
          <v-tab value="plugins">Plugins</v-tab>
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
                  @update:model-value="(value: string) => savePref(pref.name, value)"
                />
              </v-list-item>
            </v-list>
            <p class="text-caption text-grey mt-4">
              Changes are saved immediately to the backend.
            </p>
          </v-window-item>

          <v-window-item value="advanced">
            <div v-if="loadingPrefs" class="text-center py-6">
              <v-progress-circular indeterminate color="primary" />
            </div>
            <v-list v-else lines="one">
              <v-list-item v-for="pref in advancedPrefs" :key="pref.name">
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
                  @update:model-value="(value: string) => savePref(pref.name, value)"
                />
              </v-list-item>
            </v-list>
          </v-window-item>

          <v-window-item value="filters">
            <div class="d-flex justify-end mb-2">
              <v-btn
                size="small"
                prepend-icon="mdi-plus"
                variant="tonal"
                @click="openFilterEditor(null)"
              >
                New filter
              </v-btn>
            </div>
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
                    icon="mdi-pencil"
                    size="small"
                    variant="text"
                    title="Edit filter"
                    @click="openFilterEditor(filterId(filter))"
                  />
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="runDetached(deleteFilter(filter), 'delete filter')"
                  />
                </template>
              </v-list-item>
              <v-list-item v-if="filters.length === 0">
                <v-list-item-title>No filters defined</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-window-item>

          <v-window-item value="password">
            <v-text-field
              v-model="oldPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              density="compact"
            />
            <v-text-field
              v-model="newPassword"
              label="New password"
              type="password"
              autocomplete="new-password"
              density="compact"
            />
            <v-text-field
              v-model="confirmPassword"
              label="Confirm new password"
              type="password"
              autocomplete="new-password"
              density="compact"
            />
            <v-btn
              color="primary"
              :loading="busy"
              :disabled="!canChangePassword"
              @click="runDetached(changePassword(), 'change password')"
            >
              Change password
            </v-btn>
            <p class="text-caption text-grey mt-2">
              Password rules are enforced by the backend and the active
              authentication module.
            </p>
          </v-window-item>

          <v-window-item value="plugins">
            <PluginManagerPanel v-if="tab === 'plugins'" />

            <!-- Plugin-provided preference sections (HOOK_PREFS_TAB_SECTION).
                 The legacy shell hosted these inside the feeds and preferences
                 tabs; the Vue dialog has no such tabs, so they live with the
                 plugin controls. -->
            <PluginSurface section="prefPrefsPrefsInside" />
            <PluginSurface section="prefPrefsPrefsOutside" />
            <PluginSurface section="prefFeedsPublishedGenerated" />
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

    <FilterEditorDialog
      v-model="filterEditorOpen"
      :filter-id="editingFilterId"
      @saved="onFilterSaved"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { runDetached } from '../../utils/runDetached';
import api from '../../api/client';
import FilterEditorDialog from './FilterEditorDialog.vue';
import PluginManagerPanel from './PluginManagerDialog.vue';
import PluginSurface from '../PluginSurface.vue';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const tab = ref('general');
const loadingPrefs = ref(false);
const loadingFilters = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

// Filter editor dialog state
const filterEditorOpen = ref(false);
const editingFilterId = ref<number | null>(null);

// Change-password form state
const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const canChangePassword = computed(
  () =>
    oldPassword.value !== '' &&
    newPassword.value !== '' &&
    newPassword.value === confirmPassword.value
);

interface EditablePref {
  name: string;
  value: string;
  type: 'bool' | 'string';
}

// The subset of TT-RSS user preferences surfaced in the UI. The keys are the
// lowercased Prefs::* names as they appear in RPC/sanityCheck init-params.
const prefDefinitions: Array<{ name: string; type: EditablePref['type']; label: string }> = [
  { name: 'combined_display_mode', type: 'bool', label: 'Combined mode (flat list instead of separate panels)' },
  { name: 'cdm_enable_grid', type: 'bool', label: 'Grid view on wider screens (if always expanded)' },
  { name: 'purge_old_days', type: 'string', label: 'Purge articles older than (days)' },
  { name: 'purge_unread_articles', type: 'bool', label: 'Purge unread articles' },
  { name: 'enable_feed_cats', type: 'bool', label: 'Enable feed categories' },
  { name: 'show_content_preview', type: 'bool', label: 'Show content preview in headlines' },
  { name: 'hide_read_feeds', type: 'bool', label: 'Hide read feeds in the feed list' },
  { name: 'hide_read_shows_special', type: 'bool', label: 'Always show special feeds while hiding read feeds' },
  { name: 'feeds_sort_by_unread', type: 'bool', label: 'Sort feeds by unread count' },
  { name: 'confirm_feed_catchup', type: 'bool', label: 'Confirm before marking a feed as read' },
  { name: 'on_catchup_show_next_feed', type: 'bool', label: 'Automatically show next feed after marking one as read' },
  { name: 'cdm_auto_catchup', type: 'bool', label: 'Automatically mark articles as read in combined mode' },
  { name: 'vfeed_group_by_feed', type: 'bool', label: 'Group headlines by feed' },
  { name: 'fresh_article_max_age', type: 'string', label: 'Maximum age of fresh articles (hours)' },
  { name: 'recently_read_max_age', type: 'string', label: 'Maximum age of recently read articles (hours)' },
  { name: 'debug_headline_ids', type: 'bool', label: 'Show article and feed IDs in the headlines buffer' },
  { name: 'digest_enable', type: 'bool', label: 'Enable digest (daily email of new/unread headlines)' },
  { name: 'digest_catchup', type: 'bool', label: 'Mark digest articles as read when sent' },
  { name: 'digest_preferred_time', type: 'string', label: 'Try to send the digest around this time (UTC, HH:MM)' },
  { name: 'digest_min_score', type: 'string', label: 'Only include articles with at least this score' },
];

/** Map a UI pref key back to the Prefs::* name `RPC/setpref` expects. */
const prefConstant = (name: string) => name.toUpperCase();

const editablePrefs = ref<EditablePref[]>([]);
// Preferences the backend exposes that have no curated label; shown on the
// Advanced tab so the whole set is editable.
const advancedPrefs = ref<EditablePref[]>([]);
const filters = ref<Array<Record<string, unknown>>>([]);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    message.value = '';
    tab.value = 'general';
    // Both loaders report failures through `message`; the explicit void keeps
    // the watcher callback synchronous.
    runDetached(Promise.all([loadPrefs(), loadFilters()]), 'load preferences');
  }
);

// Helper to get preference label
const prefText = (name: string) =>
  prefDefinitions.find(d => d.name === name)?.label ?? name;

async function loadPrefs() {
  loadingPrefs.value = true;
  try {
    // Preference values are only readable through the RPC/sanityCheck
    // init-params payload; there is no per-preference read endpoint. The
    // payload's `prefs` map carries every user preference with its type.
    const response = await api.getInitParams();
    const params = response.status === 0 ? response.content : {};
    const backendPrefs = (params.prefs ?? {}) as Record<string, { value: unknown; type: number }>;

    const labelled = new Set(prefDefinitions.map(d => d.name));
    editablePrefs.value = prefDefinitions.map(def => ({
      name: def.name,
      type: def.type,
      value: params[def.name] === undefined ? '' : String(params[def.name]),
    }));

    // Every remaining backend preference (types: 1 bool, 2 string, 3 int);
    // skip internal bookkeeping names.
    advancedPrefs.value = Object.entries(backendPrefs)
      .filter(([name]) => !name.startsWith('_'))
      .map(([name]) => name.toLowerCase())
      .filter(name => !labelled.has(name))
      .map(name => ({
        name,
        type: backendPrefs[name.toUpperCase()]?.type === 1 ? 'bool' : 'string',
        value:
          backendPrefs[name.toUpperCase()]?.value === undefined
            ? ''
            : String(backendPrefs[name.toUpperCase()].value),
      }));
  } catch (err) {
    console.error('Failed to load preferences:', err);
    notify('Failed to load preferences', 'error');
  } finally {
    loadingPrefs.value = false;
  }
}

async function savePref(name: string, value: string) {
  try {
    const response = await api.setPref(prefConstant(name), value);
    notify(
      response.status === 0 ? 'Preference saved' : response.error ?? 'Failed to save preference',
      response.status === 0 ? 'success' : 'error'
    );
  } catch (err) {
    console.error('Failed to save preference:', err);
    notify('Failed to save preference', 'error');
  }
}

async function loadFilters() {
  loadingFilters.value = true;
  try {
    const response = await api.getFilters();
    if (response.status === 0) {
      filters.value = response.content;
    } else {
      notify(response.error ?? 'Failed to load filters', 'error');
    }
  } catch (err) {
    console.error('Failed to load filters:', err);
    notify('Failed to load filters', 'error');
  } finally {
    loadingFilters.value = false;
  }
}

// Filter records come in differing shapes depending on backend version
const filterId = (filter: Record<string, unknown>) => Number(filter.id ?? filter.filter_id ?? 0);
const filterTitle = (filter: Record<string, unknown>) =>
  String(filter.title ?? filter.name ?? `Filter #${filterId(filter)}`);

function openFilterEditor(id: number | null): void {
  editingFilterId.value = id;
  filterEditorOpen.value = true;
}

function onFilterSaved(): void {
  notify('Filter saved');
  runDetached(loadFilters(), 'reload filters');
}

async function changePassword(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.changePassword(
      oldPassword.value,
      newPassword.value,
      confirmPassword.value
    );
    const result = response.content;
    if (response.status === 0 && result.ok) {
      notify(result.message || 'Password changed');
      oldPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
    } else {
      notify(result.message || response.error || 'Failed to change password', 'error');
    }
  } finally {
    busy.value = false;
  }
}

async function deleteFilter(filter: Record<string, unknown>) {
  try {
    const response = await api.deleteFilter(filterId(filter));
    if (response.status === 0) {
      filters.value = filters.value.filter(f => filterId(f) !== filterId(filter));
      notify('Filter deleted');
    } else {
      notify('Failed to delete filter', 'error');
    }
  } catch (err) {
    console.error('Failed to delete filter:', err);
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

