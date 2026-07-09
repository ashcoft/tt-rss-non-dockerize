<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <v-btn-toggle>
        <v-btn
          icon="mdi-refresh"
          @click="handleAction('refresh')"
          title="Refresh"
        />
        <v-btn
          icon="mdi-check-all"
          @click="handleAction('catchup')"
          title="Mark all as read"
        />
      </v-btn-toggle>

      <v-text-field
        v-model="searchQuery"
        placeholder="Search articles..."
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        class="search-input"
        @keyup.enter="handleAction('search', searchQuery)"
      />

      <!-- Word stemming language. Required by the backend: an empty value
           makes PostgreSQL reject the query and matches nothing. -->
      <v-select
        v-if="searchLanguages.length > 1"
        v-model="searchLanguage"
        :items="searchLanguages"
        label="Language"
        density="compact"
        variant="outlined"
        hide-details
        class="search-language"
        title="Used for word stemming"
        @update:model-value="onLanguageChange"
      />
    </div>

    <div class="toolbar-center">
      <span class="feed-title" v-if="feedInfo">{{ feedInfo.title }}</span>
    </div>

    <div class="toolbar-right">
      <!-- Values must match the backend's accepted view_mode set. -->
      <v-select
        v-model="viewMode"
        :items="viewModeOptions"
        label="Show"
        density="compact"
        variant="outlined"
        hide-details
        class="view-mode"
        @update:model-value="setViewMode"
      />

      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props">
            Sort: {{ sortLabel }}
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

      <v-menu>
        <template #activator="{ props }">
          <v-btn icon="mdi-dots-vertical" v-bind="props" />
        </template>
        <v-list>
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

interface Props {
  feedInfo: Feed | null;
  searchLanguages?: string[];
  modelSearchLanguage?: string;
  modelViewMode?: string;
  modelOrderBy?: string;
}

const props = withDefaults(defineProps<Props>(), {
  searchLanguages: () => [],
  modelSearchLanguage: 'english',
  modelViewMode: 'adaptive',
  modelOrderBy: 'default',
});

const emit = defineEmits<{
  (e: 'action', action: string, payload?: string | number | object): void;
}>();

// State
const searchQuery = ref('');
const searchLanguage = ref(props.modelSearchLanguage);
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

const sortOptions = [
  { title: 'Default', value: 'default' },
  { title: 'Newest first', value: 'feed_dates' },
  { title: 'Oldest first', value: 'date_reverse' },
  { title: 'Title', value: 'title' },
];

const actionOptions = [
  { title: 'Edit Feed', value: 'edit', icon: 'mdi-pencil' },
  { title: 'Delete Feed', value: 'delete', icon: 'mdi-delete' },
  { title: 'Mark All Read', value: 'catchup', icon: 'mdi-check-all' }
];

// Computed
const sortLabel = computed(() => {
  return sortOptions.find(o => o.value === sortBy.value)?.title ?? 'Default';
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
  // Searches must carry the stemming language, so pass it alongside the term.
  if (command === 'search') {
    emit('action', 'search', { query: payload, language: searchLanguage.value });
    return;
  }
  emit('action', command, payload);
};

/**
 * Notifies the parent when the stemming language changes so it can be stored.
 * @param language - The newly selected language.
 */
const onLanguageChange = (language: string) => {
  searchLanguage.value = language;
  emit('action', 'searchLanguage', language);
};
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: var(--ttrss-toolbar-bg, #fff);
  border-bottom: 1px solid var(--ttrss-border, #ddd);
  gap: 1rem;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-center {
  flex: 1;
  text-align: center;
}

.feed-title {
  font-weight: 600;
  color: var(--ttrss-primary, #1976d2);
}

.search-input {
  max-width: 200px;
}
</style>
