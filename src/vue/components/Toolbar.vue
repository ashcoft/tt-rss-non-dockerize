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
    </div>

    <div class="toolbar-center">
      <span class="feed-title" v-if="feedInfo">{{ feedInfo.title }}</span>
    </div>

    <div class="toolbar-right">
      <v-btn-toggle
        :model-value="viewMode"
        @update:model-value="setViewMode"
      >
        <v-btn
          value="list"
          icon="mdi-view-list"
          title="List view"
        />
        <v-btn
          value="grid"
          icon="mdi-view-grid"
          title="Grid view"
        />
        <v-btn
          value="expanded"
          icon="mdi-view-sequential"
          title="Expanded view"
        />
      </v-btn-toggle>

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
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'action', action: string, payload?: string | number | object): void;
}>();

// State
const searchQuery = ref('');
const viewMode = ref<'list' | 'grid' | 'expanded'>('list');
const sortBy = ref('date');
const sortOrder = ref<'asc' | 'desc'>('desc');

const sortOptions = [
  { title: 'Date', value: 'date' },
  { title: 'Feed', value: 'feed' },
  { title: 'Title', value: 'title' }
];

const actionOptions = [
  { title: 'Edit Feed', value: 'edit', icon: 'mdi-pencil' },
  { title: 'Delete Feed', value: 'delete', icon: 'mdi-delete' },
  { title: 'Mark All Read', value: 'catchup', icon: 'mdi-check-all' }
];

// Computed
const sortLabel = computed(() => {
  const labels: Record<string, string> = {
    date: 'Date',
    feed: 'Feed',
    title: 'Title'
  };
  return labels[sortBy.value] || 'Date';
});

// Methods
/**
 * Sets the view mode and emits an action event.
 * @param mode - The view mode to set ('list', 'grid', or 'expanded').
 */
const setViewMode = (mode: 'list' | 'grid' | 'expanded') => {
  viewMode.value = mode;
  emit('action', 'viewMode', mode);
};

/**
 * Handles sorting by updating sortBy and emitting a sort action.
 * @param command - The command indicating the sort criterion.
 */
const handleSort = (command: string) => {
  sortBy.value = command;
  emit('action', 'sort', { by: command, order: sortOrder.value });
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
