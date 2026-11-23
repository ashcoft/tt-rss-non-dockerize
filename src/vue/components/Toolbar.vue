<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <v-icon v-if="feedInfo" icon="mdi-rss" size="18" class="feed-icon" />
      <span v-if="feedInfo" class="feed-title">{{ feedInfo.title }}</span>
      <span class="toolbar-center">
        <!-- Feed update error, mirroring the legacy toolbar's error icon. -->
        <v-icon
          v-if="feedError"
          icon="mdi-alert-circle"
          color="error"
          size="18"
          class="ml-2"
          :title="feedError"
        />
      </span>

      <!-- Plugin-provided main toolbar buttons (HOOK_MAIN_TOOLBAR_BUTTON). -->
      <PluginSurface v-if="pluginMainHtml" :html="pluginMainHtml" class="plugin-main-toolbar" />

      <a
        v-if="updateUrl"
        :href="updateUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="update-link"
        title="A newer release is available"
      >
        <v-icon icon="mdi-new-releases" color="primary" />
      </a>
      <v-btn
        v-if="pluginUpdates"
        icon="mdi-puzzle"
        variant="text"
        title="Plugin updates are available"
        @click="handleAction('preferences')"
      />
    </div>

    <div class="toolbar-right">


      <!-- Legacy Select menu; bulk actions appear in the list bar. -->
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" class="select-button" variant="text">
            Select
            <v-icon end>mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item
            v-for="item in selectOptions"
            :key="item.value"
            @click="handleAction('selectBy', item.value)"
          >
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- Values must match the backend's accepted view_mode set. -->
      <v-select
        v-model="viewMode"
        :items="viewModeOptions"
        aria-label="Show"
        density="compact"
        variant="plain"
        hide-details
        class="view-mode"
        @update:model-value="setViewMode"
      />

      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" class="sort-button" variant="text" title="Order by">
            {{ sortLabel }}
            <v-icon end>mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item
            v-for="item in sortOptions"
            :key="item.value"
            :value="item.value"
            @click="handleSort(item.value)"
          >
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- Mark as read: the default marks everything; the menu items carry the
           time window the backend accepts (1day/1week/2week). -->
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" class="catchup-button" variant="text" prepend-icon="mdi-check-all" title="Mark as read">
            Mark as read
            <v-icon end>mdi-chevron-down</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item
            v-for="item in catchupOptions"
            :key="item.value"
            @click="handleAction('catchup', item.value)"
          >
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-menu>
        <template #activator="{ props }">
          <v-btn icon="mdi-menu" v-bind="props" title="Actions" />
        </template>
        <v-list>
          <!-- Plugin-provided action-menu buttons (HOOK_TOOLBAR_BUTTON). -->
          <PluginSurface
            v-if="pluginToolbarHtml"
            :html="pluginToolbarHtml"
            class="plugin-toolbar-buttons"
          />
          <v-divider v-if="pluginToolbarHtml" />
          <PluginSurface
            v-if="pluginActionHtml"
            :html="pluginActionHtml"
            class="plugin-action-items"
          />
          <v-divider v-if="pluginActionHtml" />
          <v-list-item
            v-for="item in actionOptions"
            :key="item.value"
            :value="item.value"
            @click="handleAction(item.value)"
          >
            <template #prepend>
              <v-icon>{{ item.icon }}</v-icon>
            </template>
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Feed } from '../types';
import PluginSurface from './PluginSurface.vue';

interface Props {
  feedInfo: Feed | null;
  /** The current feed's last update error, shown as an icon when set. */
  feedError?: string | null;
  modelViewMode?: string;
  modelOrderBy?: string;
  /** Plugin HTML for HOOK_MAIN_TOOLBAR_BUTTON. */
  pluginMainHtml?: string;
  /** Plugin HTML for HOOK_TOOLBAR_BUTTON. */
  pluginToolbarHtml?: string;
  /** Plugin HTML for HOOK_ACTION_ITEM. */
  pluginActionHtml?: string;
  /** Extra sort options from HOOK_HEADLINES_CUSTOM_SORT_MAP. */
  customSortMap?: Record<string, string>;
  /** Link to a newer core release, when one is available. */
  updateUrl?: string;
  /** True when one or more local plugins have updates. */
  pluginUpdates?: boolean;
  /** CDM_EXPANDED: every combined row is expanded. */
  cdmExpanded?: boolean;
  /** WIDESCREEN_MODE: the feed tree is hidden. */
  wideScreen?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  feedError: null,
  modelViewMode: 'adaptive',
  modelOrderBy: 'default',
  pluginMainHtml: '',
  pluginToolbarHtml: '',
  pluginActionHtml: '',
  customSortMap: () => ({}),
  updateUrl: '',
  pluginUpdates: false,
  cdmExpanded: true,
  wideScreen: false,
});

const emit = defineEmits<{
  (e: 'action', action: string, payload?: string | number | object): void;
}>();

// State
// These mirror the <select> values in index.php and the strings Feeds/view
// understands; arbitrary values are silently ignored by the backend.
const viewMode = ref(props.modelViewMode);
const sortBy = ref(props.modelOrderBy);

const viewModeOptions = [
  { title: 'Adaptive', value: 'adaptive' },
  { title: 'All Articles', value: 'all_articles' },
  { title: 'Starred', value: 'marked' },
  { title: 'Published', value: 'published' },
  { title: 'Unread', value: 'unread' },
  { title: 'With Note', value: 'has_note' },
];

const selectOptions = [
  { title: 'All', value: 'all' },
  { title: 'Unread', value: 'unread' },
  { title: 'Invert', value: 'invert' },
  { title: 'None', value: 'none' },
];

const sortOptions = computed(() => [
  { title: 'Default', value: 'default' },
  { title: 'Newest first', value: 'feed_dates' },
  { title: 'Oldest first', value: 'date_reverse' },
  { title: 'Title', value: 'title' },
  ...Object.entries(props.customSortMap ?? {}).map(([value, title]) => ({ value, title })),
]);

// Mirrors the legacy actions menu (index.php #toolbar .action-button). Labels
// that depend on state are computed so they describe the next action.
const actionOptions = computed(() => [
  { title: 'Preferences...', value: 'preferences', icon: 'mdi-cog' },
  { title: 'Refresh', value: 'refresh', icon: 'mdi-refresh' },
  { title: 'Search...', value: 'focusSearch', icon: 'mdi-magnify' },
  { title: 'Search feeds...', value: 'searchFeeds', icon: 'mdi-filter-outline' },
  { title: 'Subscribe to feed...', value: 'manageFeeds', icon: 'mdi-plus-box' },
  { title: 'Edit this feed...', value: 'edit', icon: 'mdi-pencil' },
  { title: 'Unsubscribe', value: 'delete', icon: 'mdi-delete' },
  { title: 'Mark as read', value: 'catchup', icon: 'mdi-check-all' },
  { title: '(Un)hide read feeds', value: 'toggleHideRead', icon: 'mdi-eye-off-outline' },
  { title: 'Toggle combined mode', value: 'toggleCombinedMode', icon: 'mdi-view-agenda-outline' },
  {
    title: props.wideScreen ? 'Disable widescreen mode' : 'Enable widescreen mode',
    value: 'toggleWideScreen',
    icon: 'mdi-arrow-expand-horizontal',
  },
  {
    title: props.cdmExpanded ? 'Expand selected article only' : 'Expand all articles',
    value: 'toggleCdmExpanded',
    icon: 'mdi-unfold-more-horizontal',
  },
  { title: 'Keyboard shortcuts help', value: 'hotkeyHelp', icon: 'mdi-keyboard' },
  { title: 'Toggle light/dark theme', value: 'toggleTheme', icon: 'mdi-theme-light-dark' },
  { title: 'Logout', value: 'logout', icon: 'mdi-logout' },
]);

// Mirrors the legacy #main-catchup-dropdown: the empty value marks everything,
// the others only articles older than the window.
const catchupOptions = [
  { title: 'All articles', value: 'all' },
  { title: 'Older than one day', value: '1day' },
  { title: 'Older than one week', value: '1week' },
  { title: 'Older than two weeks', value: '2week' },
];

// Computed
const sortLabel = computed(() => {
  return sortOptions.value.find(o => o.value === sortBy.value)?.title ?? 'Default';
});

// Methods
/**
 * Sets the view mode and emits an action event.
 * @param mode - The view mode to set ('list', 'grid', or 'expanded').
 */
const setViewMode = (mode: string) => {
  viewMode.value = mode;
  emit('action', 'viewMode', mode);
};

/**
 * Handles sorting by updating sortBy and emitting a sort action.
 * @param command - The command indicating the sort criterion.
 */
const handleSort = (command: string) => {
  sortBy.value = command;
  emit('action', 'orderBy', command);
};

/**
 * Handles a generic action by emitting an action event.
 * @param command - The action command to emit.
 */
const handleAction = (command: string, payload?: string | number | object) => {
  emit('action', command, payload);
};

</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 8px;
  background: rgb(var(--v-theme-background));
  border-bottom: 1px solid rgba(var(--v-theme-on-background), 0.09);
  gap: 8px;
}

.toolbar-left {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-center {
  display: inline-flex;
  align-items: center;
}

.feed-icon {
  margin-left: 4px;
  color: rgba(var(--v-theme-on-background), 0.55);
}

.toolbar-right :deep(.v-btn) {
  font-size: 0.8125rem;
  text-transform: none;
}

.view-mode :deep(.v-field__outline) {
  display: none;
}

.view-mode :deep(.v-field) {
  background: transparent;
}

.feed-title {
  overflow: hidden;
  color: rgb(var(--v-theme-on-background));
  font-size: 0.95rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-mode {
  min-width: 130px;
  max-width: 150px;
}

/* Phone layout: keep the feed title, view/sort and overflow menu; the rest of
   the toolbar lives behind the menu, as in the legacy client. */
@media (max-width: 900px) {
  .toolbar {
    flex: 1 1 auto;
    min-width: 0;
    gap: 2px;
    padding: 0;
  }

  .toolbar-left {
    gap: 2px;
  }

  .catchup-button,
  .update-link,
  .plugin-main-toolbar,
  .select-button {
    display: none;
  }

  .toolbar-center {
    min-width: 0;
  }

  .feed-title {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-right {
    gap: 2px;
  }

  .view-mode {
    min-width: 112px;
    max-width: 112px;
  }

  .view-mode :deep(.v-field__input) {
    padding-left: 4px;
    padding-right: 0;
  }

  .view-mode :deep(.v-select__selection-text) {
    font-size: 13px;
  }

  .sort-button {
    min-width: 0;
    padding: 0 6px;
    font-size: 12px;
  }
}
</style>
