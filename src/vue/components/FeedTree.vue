<template>
  <div class="feed-tree">
    <v-text-field
      v-model="searchQuery"
      placeholder="Search feeds..."
      prepend-inner-icon="mdi-magnify"
      variant="outlined"
      density="compact"
      hide-details
      class="search-input"
    />

    <v-list nav density="compact" class="feed-list">
      <!-- Special Feeds -->
      <v-list-group value="special">
        <template #activator="{ props }">
          <v-list-item v-bind="props" title="Special">
            <template #prepend>
              <v-icon>mdi-star</v-icon>
            </template>
          </v-list-item>
        </template>

        <v-list-item
          v-for="special in specialFeeds"
          :key="special.id"
          :title="special.name"
          :value="String(special.id)"
          @click="handleSelect(String(special.id))"
        >
          <template #prepend>
            <v-icon>{{ special.icon }}</v-icon>
          </template>
          <template #append>
            <v-chip
              v-if="special.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ special.unread }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list-group>

      <!-- Labels -->
      <v-list-group value="labels" v-if="filteredLabels.length > 0">
        <template #activator="{ props }">
          <v-list-item v-bind="props" title="Labels">
            <template #prepend>
              <v-icon>mdi-label</v-icon>
            </template>
          </v-list-item>
        </template>

        <v-list-item
          v-for="label in filteredLabels"
          :key="'label-' + label.id"
          :title="label.caption"
          :value="'label-' + label.id"
          @click="handleSelect('label-' + label.id)"
        >
          <template #prepend>
            <div
              class="label-indicator"
              :style="{ backgroundColor: label.bg_color || '#1976d2' }"
            ></div>
          </template>
          <template #append>
            <v-chip
              v-if="label.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ label.unread }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list-group>

      <!-- Categories -->
      <v-list-group
        v-for="category in categories"
        :key="'cat-' + category.id"
        :value="'cat-' + category.id"
      >
        <template #activator="{ props }">
                    <v-list-item v-bind="props" :title="category.title">
            <template #prepend>
              <v-icon>mdi-folder</v-icon>
            </template>
            <template #append>
              <v-chip
                v-if="category.unread > 0"
                size="x-small"
                color="primary"
                variant="flat"
              >
                {{ category.unread }}
              </v-chip>
            </template>
          </v-list-item>
        </template>

        <v-list-item
          v-for="feed in getFeedsByCategory(category.id)"
          :key="feed.id"
          :title="feed.title"
          :value="String(feed.id)"
          @click="handleSelect(String(feed.id))"
        >
          <template #append>
            <v-chip
              v-if="feed.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ feed.unread }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list-group>

      <!-- Uncategorized Feeds -->
      <v-list-group value="uncategorized" v-if="filteredUncategorizedFeeds.length > 0">
        <template #activator="{ props }">
          <v-list-item v-bind="props" title="Feeds">
            <template #prepend>
              <v-icon>mdi-rss</v-icon>
            </template>
          </v-list-item>
        </template>

        <v-list-item
          v-for="feed in filteredUncategorizedFeeds"
          :key="feed.id"
          :title="feed.title"
          :value="String(feed.id)"
          @click="handleSelect(String(feed.id))"
        >
          <template #append>
            <v-chip
              v-if="feed.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ feed.unread }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list-group>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Feed, Category, Label } from '../types';

interface Props {
  feeds: Feed[];
  categories: Category[];
  labels?: Label[];
}

const props = withDefaults(defineProps<Props>(), {
  labels: () => []
});

const emit = defineEmits<{
  (e: 'select', feedId: number | string, isCat: boolean): void;
  (e: 'feed-action', action: string, feedId: number): void;
}>();

// State
const searchQuery = ref('');

// Special feeds (built-in)
const specialFeeds = [
  { id: -1, name: 'All Articles', icon: 'mdi-newspaper', unread: 0 },
  { id: -2, name: 'Fresh Articles', icon: 'mdi-weather-sunny', unread: 0 },
  { id: -3, name: 'Starred', icon: 'mdi-star', unread: 0 },
  { id: -4, name: 'Published', icon: 'mdi-publish', unread: 0 },
  { id: -5, name: 'Recently Read', icon: 'mdi-history', unread: 0 },
  { id: -6, name: 'Archived', icon: 'mdi-archive', unread: 0 },
];

// Computed
/**
 * Computes the list of labels filtered by the current search query.
 * @returns The filtered array of labels.
 */
const filteredLabels = computed(() => {
  if (!searchQuery.value) return props.labels;
  const query = searchQuery.value.toLowerCase();
  return props.labels.filter(label =>
    label.caption.toLowerCase().includes(query)
  );
});

/**
 * Computes the list of uncategorized feeds filtered by the current search query.
 * @returns The filtered array of uncategorized feeds.
 */
const filteredUncategorizedFeeds = computed(() => {
  const feeds = props.feeds.filter(f => !f.cat_id);
  if (!searchQuery.value) return feeds;
  const query = searchQuery.value.toLowerCase();
  return feeds.filter(feed => feed.title.toLowerCase().includes(query));
});

/**
 * Filters feeds by the given category ID and current search query.
 * @param {number} categoryId - The ID of the category to filter feeds by.
 * @returns The filtered array of feeds belonging to the specified category.
 */
const getFeedsByCategory = (categoryId: number) => {
  const feeds = props.feeds.filter(f => f.cat_id === categoryId);
  if (!searchQuery.value) return feeds;
  const query = searchQuery.value.toLowerCase();
  return feeds.filter(feed => feed.title.toLowerCase().includes(query));
};

// Handlers
/**
 * Handles selection events from the feed tree.
 * @param {string} index - The index string indicating the selected item (label-, cat-, or feed ID).
 */
const handleSelect = (index: string) => {
  const isLabel = index.startsWith('label-');
  const isCategory = index.startsWith('cat-');

  if (isLabel) {
    const labelId = Number.parseInt(index.replace('label-', ''));
    emit('select', labelId, false);
  } else if (isCategory) {
    const catId = Number.parseInt(index.replace('cat-', ''));
    emit('select', catId, true);
  } else {
    const feedId = Number.parseInt(index);
    emit('select', feedId, false);
  }
};
</script>

<style scoped>
.feed-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.search-input {
  padding: 0.5rem;
}

.feed-list {
  flex: 1;
  overflow-y: auto;
}

.label-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 0.5rem;
}
</style>
