<template>
  <v-dialog
    :model-value="modelValue"
    max-width="960"
    scrollable
    @update:model-value="onDialogToggle"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>Preferences</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="closeDialog" />
      </v-card-title>

      <v-tabs v-model="tab" color="primary" density="compact">
        <v-tab value="general">General</v-tab>
        <v-tab value="feeds">Feeds</v-tab>
        <v-tab value="filters">Filters</v-tab>
        <v-tab value="labels">Labels</v-tab>
        <v-tab value="plugins">Plugins</v-tab>
      </v-tabs>

      <v-divider />

      <v-card-text class="prefs-body">
        <v-window v-model="tab">
        <!-- General: built from Pref_Prefs/getprefs metadata. -->
        <v-window-item value="general">
          <div v-if="loadingPrefs" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <template v-else>
            <v-alert
              v-if="prefsSchema?.profile"
              type="info"
              variant="tonal"
              density="compact"
              class="mb-4"
            >
              Some preferences are only available in the default profile.
            </v-alert>
            <v-expansion-panels variant="accordion" multiple>
              <v-expansion-panel
                v-for="section in prefsSchema?.sections ?? []"
                :key="section.title"
                :value="section.title"
              >
                <v-expansion-panel-title>{{ section.title }}</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <template v-for="(item, index) in section.items" :key="item.name ?? 'sep-' + index">
                    <v-divider v-if="item.type === 'separator'" class="my-3" />
                    <div v-else-if="item.name" class="pref-row">
                      <v-checkbox
                        v-if="item.type === 'bool'"
                        v-model="prefValues[item.name]"
                        :label="item.label"
                        :disabled="item.disabled"
                        hide-details
                        density="compact"
                        @update:model-value="(value: string | boolean) => savePref(item.name, value)"
                      />
                      <template v-else>
                        <div class="pref-label">
                          {{ item.label }}
                          <div v-if="item.help" class="text-caption text-medium-emphasis" v-html="item.help" />
                        </div>
                        <v-select
                          v-if="item.type === 'select'"
                          v-model="prefValues[item.name]"
                          :items="item.options ?? []"
                          item-title="title"
                          item-value="value"
                          density="compact"
                          hide-details
                          :disabled="item.disabled"
                          class="pref-control"
                          @update:model-value="(value: string | boolean) => savePref(item.name, value)"
                        />
                        <v-textarea
                          v-else-if="item.type === 'textarea'"
                          v-model="prefValues[item.name]"
                          density="compact"
                          rows="3"
                          variant="outlined"
                          hide-details
                          :disabled="item.disabled"
                          class="pref-control"
                          @blur="savePref(item.name)"
                        />
                        <v-text-field
                          v-else
                          v-model="prefValues[item.name]"
                          :type="item.type === 'int' ? 'number' : item.type === 'time' ? 'time' : 'text'"
                          density="compact"
                          variant="outlined"
                          hide-details
                          :disabled="item.disabled"
                          class="pref-control"
                          @blur="savePref(item.name)"
                        />
                      </template>
                    </div>
                  </template>
                  <p v-if="section.items.length === 0" class="text-caption text-medium-emphasis">
                    No preferences available.
                  </p>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
            <p class="text-caption text-medium-emphasis mt-4">
              Changes are saved immediately.
            </p>
          </template>
        </v-window-item>

        <!-- Per-feed preferences. -->
        <v-window-item value="feeds">
          <v-select
            v-model="selectedFeedId"
            :items="feedStore.feeds"
            item-title="title"
            item-value="id"
            label="Feed"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-4"
            @update:model-value="loadFeed"
          />
          <div v-if="loadingFeed" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <template v-else-if="feed">
            <v-row dense>
              <v-col cols="12" md="6">
                <v-text-field v-model="feed.title" label="Title" density="compact" variant="outlined" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="feed.cat_id"
                  :items="categoryOptions"
                  item-title="title"
                  item-value="value"
                  label="Category"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12">
                <v-text-field v-model="feed.feed_url" label="Feed URL" density="compact" variant="outlined" />
              </v-col>
              <v-col cols="12">
                <v-text-field v-model="feed.site_url" label="Site URL" density="compact" variant="outlined" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="feed.update_interval"
                  :items="intervalOptions(feed.update_intervals)"
                  item-title="title"
                  item-value="value"
                  label="Update interval"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="feed.purge_interval"
                  :items="intervalOptions(feed.purge_intervals)"
                  item-title="title"
                  item-value="value"
                  label="Purge interval"
                  density="compact"
                  variant="outlined"
                  :disabled="feed.force_purge !== 0"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-select
                  v-model="feed.feed_language"
                  :items="languageOptions"
                  item-title="title"
                  item-value="value"
                  label="Feed language"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="feed.auth_login" label="HTTP login" density="compact" variant="outlined" />
              </v-col>
              <v-col cols="12">
                <v-text-field
                  v-model="feed.auth_pass"
                  label="HTTP password"
                  type="password"
                  density="compact"
                  variant="outlined"
                />
              </v-col>
            </v-row>

            <v-checkbox v-model="feed.private" label="Hide from other users" density="compact" hide-details />
            <v-checkbox
              v-model="feed.include_in_digest"
              label="Include in digest"
              density="compact"
              hide-details
            />
            <v-checkbox v-model="feed.cache_images" label="Cache images" density="compact" hide-details />
            <v-checkbox v-model="feed.hide_images" label="Do not embed media" density="compact" hide-details />
            <v-checkbox
              v-model="feed.always_display_enclosures"
              label="Always display enclosures"
              density="compact"
              hide-details
            />
            <v-checkbox
              v-model="feed.mark_unread_on_update"
              label="Mark unread on update"
              density="compact"
              hide-details
            />

            <div class="d-flex gap-2 mt-4">
              <v-btn color="primary" :loading="savingFeed" @click="saveFeed">Save feed</v-btn>
              <v-btn color="error" variant="tonal" :loading="savingFeed" @click="removeFeed">Unsubscribe</v-btn>
            </div>
          </template>
          <p v-else class="text-caption text-medium-emphasis">Select a feed to edit its preferences.</p>
        </v-window-item>

        <!-- Filters. -->
        <v-window-item value="filters">
          <div class="d-flex mb-2">
            <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" @click="openFilterEditor(null)">
              New filter
            </v-btn>
          </div>
          <div v-if="loadingFilters" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <v-list v-else lines="three">
            <v-list-item v-for="filter in filters" :key="filter.id">
              <v-list-item-title>{{ filter.title }}</v-list-item-title>
              <v-list-item-subtitle>
                <div v-for="(rule, index) in filter.rules" :key="index">{{ rule }}</div>
                <span v-if="filter.rules.length === 0" class="text-medium-emphasis">No rules</span>
              </v-list-item-subtitle>
              <template #append>
                <v-chip size="small" :color="filter.enabled ? 'success' : 'grey'" variant="tonal" class="mr-2">
                  {{ filter.enabled ? 'Enabled' : 'Disabled' }}
                </v-chip>
                <span v-if="filter.last_triggered" class="text-caption text-medium-emphasis mr-2">
                  {{ filter.last_triggered }}
                </span>
                <v-btn
                  icon="mdi-pencil"
                  size="small"
                  variant="text"
                  title="Edit filter"
                  @click="openFilterEditor(filter.id)"
                />
                <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="deleteFilter(filter)" />
              </template>
            </v-list-item>
            <v-list-item v-if="filters.length === 0">
              <v-list-item-title>No filters defined</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-window-item>

        <!-- Labels and their colours. -->
        <v-window-item value="labels">
          <div class="d-flex align-center gap-2 mb-4">
            <v-text-field v-model="newLabelCaption" label="New label" density="compact" variant="outlined" hide-details />
            <v-btn color="primary" :disabled="!newLabelCaption" :loading="busy" @click="createLabel">Create</v-btn>
          </div>
          <v-list density="compact">
            <v-list-item v-for="label in labels" :key="label.id">
              <v-list-item-title>{{ label.caption }}</v-list-item-title>
              <template #append>
                <div class="label-colors">
                  <label class="text-caption mr-1">Text</label>
                  <input
                    type="color"
                    :value="label.fg_color || '#000000'"
                    class="color-input"
                    @change="(event) => saveLabelColors(label, 'fg', event)"
                  />
                  <label class="text-caption ml-2 mr-1">Background</label>
                  <input
                    type="color"
                    :value="label.bg_color || '#fff7d5'"
                    class="color-input"
                    @change="(event) => saveLabelColors(label, 'bg', event)"
                  />
                  <v-btn
                    icon="mdi-restore"
                    size="small"
                    variant="text"
                    title="Reset colours"
                    @click="resetLabelColors(label)"
                  />
                  <v-btn
                    icon="mdi-delete"
                    size="small"
                    variant="text"
                    color="error"
                    @click="deleteLabel(label)"
                  />
                </div>
              </template>
            </v-list-item>
            <v-list-item v-if="labels.length === 0">
              <v-list-item-title>No labels defined</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-window-item>

        <!-- Plugins. -->
        <v-window-item value="plugins">
          <div v-if="loadingPlugins" class="text-center py-6">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <template v-else>
            <v-list density="compact">
              <v-list-item v-for="plugin in plugins" :key="plugin.name">
                <v-list-item-title>{{ plugin.name }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ plugin.description || plugin.version }}
                  <span v-if="plugin.author"> — {{ plugin.author }}</span>
                </v-list-item-subtitle>
                <template #append>
                  <v-chip v-if="plugin.is_system" size="small" variant="tonal" class="mr-2">System</v-chip>
                  <v-switch
                    v-else
                    v-model="pluginSelection[plugin.name]"
                    color="primary"
                    density="compact"
                    hide-details
                  />
                </template>
              </v-list-item>
            </v-list>
            <v-btn color="primary" class="mt-2" :loading="busy" @click="savePlugins">Save plugins</v-btn>
          </template>
        </v-window-item>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
          {{ message }}
        </v-alert>
        </v-window>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="closeDialog">Close</v-btn>
      </v-card-actions>

      <FilterEditorDialog
        v-model="filterEditorOpen"
        :filter-id="filterEditorId"
        @saved="loadFilters"
      />
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import api from '../../api/client';
import { useFeedsStore, useLabelsStore } from '../../stores/index';
import FilterEditorDialog from './FilterEditorDialog.vue';
import type { AdaptedFilter, FeedDetails, PluginRecord, PrefsSchema } from '../../api/legacyEndpoints';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  initialTab?: string;
  initialFeedId?: number | null;
}>(), {
  initialTab: 'general',
  initialFeedId: null,
});
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const feedStore = useFeedsStore();
const labelsStore = useLabelsStore();

// Legacy tabs used these names; map them onto the view's tabs.
const TAB_ALIASES: Record<string, string> = {
  prefs: 'general',
  general: 'general',
  feeds: 'feeds',
  filters: 'filters',
  labels: 'labels',
  plugins: 'plugins',
};

const tab = ref('general');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

// General preferences
const loadingPrefs = ref(false);
const prefsSchema = ref<PrefsSchema | null>(null);
const prefValues = reactive<Record<string, string | boolean>>({});

// Feed preferences
const selectedFeedId = ref<number | null>(null);
const loadingFeed = ref(false);
const savingFeed = ref(false);
const feed = ref<FeedDetails | null>(null);

// Filters
const loadingFilters = ref(false);
const filters = ref<AdaptedFilter[]>([]);
const filterEditorOpen = ref(false);
const filterEditorId = ref<number | null>(null);

// Labels
const newLabelCaption = ref('');
const labels = computed(() => labelsStore.labels);

// Plugins
const loadingPlugins = ref(false);
const plugins = ref<PluginRecord[]>([]);
const pluginSelection = reactive<Record<string, boolean>>({});

const categoryOptions = computed(() => [
  { title: 'Uncategorized', value: 0 },
  ...feedStore.categories.map((category) => ({ title: category.title, value: category.id })),
]);

const languageOptions = computed(() => [
  { title: 'Default', value: '' },
  ...(feed.value?.search_languages ?? []).map((language) => ({ title: language, value: language })),
]);

const intervalOptions = (intervals: Record<string, string>) =>
  Object.entries(intervals).map(([value, title]) => ({ value: Number(value), title }));

function notify(text: string, type: 'success' | 'error' = 'success') {
  message.value = text;
  messageType.value = type;
}

function normalizeTab(name: string): string {
  return TAB_ALIASES[name] ?? 'general';
}

async function loadPrefs() {
  loadingPrefs.value = true;
  try {
    const response = await api.getPrefsSchema();
    if (response.status !== 0) {
      notify(response.error ?? 'Failed to load preferences', 'error');
      return;
    }
    prefsSchema.value = response.content;
    for (const section of response.content.sections) {
      for (const item of section.items) {
        if (!item.name) continue;
        const value = item.value;
        prefValues[item.name] = item.type === 'bool'
          ? value === true || value === 1 || value === '1'
          : value === null || value === undefined ? '' : String(value);
      }
    }
  } catch {
    notify('Failed to load preferences', 'error');
  } finally {
    loadingPrefs.value = false;
  }
}

async function savePref(name: string, value_override?: string | boolean) {
  const raw = value_override === undefined ? prefValues[name] : value_override;
  const value = typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw ?? '');
  try {
    const response = await api.setPref(name, value);
    notify(
      response.status === 0 ? 'Preference saved' : response.error ?? 'Failed to save preference',
      response.status === 0 ? 'success' : 'error'
    );
  } catch {
    notify('Failed to save preference', 'error');
  }
}

async function loadFeed(feedId: number | null) {
  if (!feedId) {
    feed.value = null;
    return;
  }
  loadingFeed.value = true;
  try {
    const response = await api.getFeedDetails(feedId);
    if (response.status === 0 && response.content) {
      // `cat_id` is null for uncategorized feeds; the select uses 0 for that
      // item so the current value is visible.
      feed.value = { ...response.content, cat_id: response.content.cat_id ?? 0 };
    } else {
      notify(response.error ?? 'Failed to load feed', 'error');
    }
  } catch {
    notify('Failed to load feed', 'error');
  } finally {
    loadingFeed.value = false;
  }
}

async function saveFeed() {
  const current = feed.value;
  if (!current) return;
  savingFeed.value = true;
  try {
    const response = await api.saveFeedDetails(current.id, {
      title: current.title,
      feed_url: current.feed_url,
      site_url: current.site_url,
      cat_id: current.cat_id || null,
      update_interval: current.update_interval,
      purge_interval: current.purge_interval,
      auth_login: current.auth_login,
      auth_pass: current.auth_pass,
      private: current.private,
      include_in_digest: current.include_in_digest,
      cache_images: current.cache_images,
      hide_images: current.hide_images,
      always_display_enclosures: current.always_display_enclosures,
      mark_unread_on_update: current.mark_unread_on_update,
      feed_language: current.feed_language,
    });
    notify(
      response.status === 0 ? 'Feed saved' : response.error ?? 'Failed to save feed',
      response.status === 0 ? 'success' : 'error'
    );
    if (response.status === 0) await feedStore.loadFeeds();
  } catch {
    notify('Failed to save feed', 'error');
  } finally {
    savingFeed.value = false;
  }
}

async function removeFeed() {
  const current = feed.value;
  if (!current) return;
  if (!window.confirm(`Unsubscribe from ${current.title}?`)) return;
  savingFeed.value = true;
  try {
    const removed = await feedStore.removeFeed(current.id);
    if (removed) {
      feed.value = null;
      selectedFeedId.value = null;
      notify('Feed removed');
    } else {
      notify(feedStore.error ?? 'Failed to remove feed', 'error');
    }
  } finally {
    savingFeed.value = false;
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
  } catch {
    notify('Failed to load filters', 'error');
  } finally {
    loadingFilters.value = false;
  }
}

function openFilterEditor(filterId: number | null) {
  filterEditorId.value = filterId;
  filterEditorOpen.value = true;
}

async function deleteFilter(filter: AdaptedFilter) {
  if (!window.confirm(`Delete filter "${filter.title}"?`)) return;
  const response = await api.deleteFilter(filter.id);
  if (response.status === 0) {
    filters.value = filters.value.filter((entry) => entry.id !== filter.id);
    notify('Filter deleted');
  } else {
    notify(response.error ?? 'Failed to delete filter', 'error');
  }
}

async function createLabel() {
  busy.value = true;
  try {
    const response = await api.createLabel(newLabelCaption.value);
    if (response.status === 0) {
      newLabelCaption.value = '';
      await labelsStore.loadLabels();
      notify('Label created');
    } else {
      notify(response.error ?? 'Failed to create label', 'error');
    }
  } finally {
    busy.value = false;
  }
}

async function deleteLabel(label: { id: number; caption: string }) {
  if (!window.confirm(`Delete label "${label.caption}"?`)) return;
  const response = await api.removeLabel(label.id);
  if (response.status === 0) {
    await labelsStore.loadLabels();
    notify('Label removed');
  } else {
    notify(response.error ?? 'Failed to remove label', 'error');
  }
}

async function saveLabelColors(
  label: { id: number; fg_color: string; bg_color: string },
  kind: 'fg' | 'bg',
  event: Event
) {
  const input = event.target as HTMLInputElement;
  const fg = kind === 'fg' ? input.value : label.fg_color || '#000000';
  const bg = kind === 'bg' ? input.value : label.bg_color || '#fff7d5';
  const response = await api.setLabelColors(label.id, fg, bg);
  if (response.status === 0) {
    await labelsStore.loadLabels();
    notify('Label colours updated');
  } else {
    notify(response.error ?? 'Failed to update label colours', 'error');
  }
}

async function resetLabelColors(label: { id: number }) {
  const response = await api.resetLabelColors(label.id);
  if (response.status === 0) {
    await labelsStore.loadLabels();
    notify('Label colours reset');
  } else {
    notify(response.error ?? 'Failed to reset label colours', 'error');
  }
}

async function loadPlugins() {
  loadingPlugins.value = true;
  try {
    const response = await api.getPlugins();
    if (response.status === 0) {
      plugins.value = response.content.plugins;
      for (const plugin of response.content.plugins) {
        pluginSelection[plugin.name] = plugin.user_enabled;
      }
    } else {
      notify(response.error ?? 'Failed to load plugins', 'error');
    }
  } finally {
    loadingPlugins.value = false;
  }
}

async function savePlugins() {
  busy.value = true;
  try {
    const enabled = plugins.value
      .filter((plugin) => !plugin.is_system && pluginSelection[plugin.name])
      .map((plugin) => plugin.name);
    const response = await api.setPlugins(enabled);
    notify(
      response.status === 0 ? 'Plugins saved' : response.error ?? 'Failed to save plugins',
      response.status === 0 ? 'success' : 'error'
    );
  } finally {
    busy.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    message.value = '';
    tab.value = normalizeTab(props.initialTab);
    void loadPrefs();
    void loadFilters();
    void labelsStore.loadLabels();
    if (tab.value === 'plugins') void loadPlugins();
    if (props.initialFeedId) {
      tab.value = 'feeds';
      selectedFeedId.value = props.initialFeedId;
      void loadFeed(props.initialFeedId);
    }
  }
);

watch(tab, (value) => {
  if (value === 'plugins' && plugins.value.length === 0) void loadPlugins();
});

function onDialogToggle(value: boolean) {
  emit('update:modelValue', value);
}

function closeDialog() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.prefs-body {
  min-height: 360px;
}

.pref-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.25rem 0;
}

.pref-label {
  flex: 1;
  min-width: 220px;
}

.pref-control {
  flex: 0 0 320px;
  max-width: 320px;
}

.label-colors {
  display: flex;
  align-items: center;
}

.color-input {
  width: 32px;
  height: 24px;
  border: none;
  padding: 0;
  background: transparent;
}
</style>
