<template>
  <div ref="listRef" class="headlines-list">
    <div v-if="loading" class="headlines-loading">
      <v-progress-circular indeterminate color="primary" />
      <span>Loading headlines...</span>
    </div>

    <div v-else-if="headlines.length === 0" class="headlines-empty">
      <v-icon size="64" color="grey">mdi-newspaper-variant-outline</v-icon>
      <p>No headlines to display</p>
    </div>

    <div v-else>
      <!-- Bulk selection bar: shown when at least one article is checked. -->
      <div class="bulk-bar">
        <v-checkbox
          :model-value="allSelected"
          :indeterminate="someSelected && !allSelected"
          hide-details
          density="compact"
          class="bulk-select-all"
          title="Select all"
          @update:model-value="toggleAll"
        />
        <span v-if="selectedIds.size > 0" class="bulk-count">
          {{ selectedIds.size }} selected
        </span>
        <v-spacer />
        <template v-if="selectedIds.size > 0">
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'mark_read', [...selectedIds])">
            Mark read
          </v-btn>
          <v-btn size="small" variant="text" color="error" @click="emit('bulk-action', 'delete', [...selectedIds])">
            Delete
          </v-btn>
        </template>
      </div>

      <v-list class="headlines-list-content" lines="three">
        <v-list-item
          v-for="headline in headlines"
          :key="headline.id"
          :class="{
            'headline-read': headline.is_read,
            'headline-active': headline.id === activeId,
          }"
          @click="emit('select', headline)"
        >
          <template #prepend>
            <v-checkbox
              :model-value="selectedIds.has(headline.id)"
              hide-details
              density="compact"
              title="Select article"
              @click.stop
              @update:model-value="(checked: boolean) => toggleSelected(headline.id, checked)"
            />
            <v-checkbox
              :model-value="headline.is_read"
              hide-details
              density="compact"
              title="Mark as read"
              @click.stop
              @update:model-value="toggleRead(headline)"
            />
          </template>

        <v-list-item-title class="headline-title">
          {{ headline.title }}
        </v-list-item-title>

        <v-list-item-subtitle class="headline-meta">
          <span v-if="headline.author" class="headline-author">
            {{ headline.author }}
          </span>
          <span v-if="headline.updated" class="headline-date">
            {{ formatDate(headline.updated) }}
          </span>
        </v-list-item-subtitle>

        <template #append>
          <div class="headline-actions">
            <v-btn
              icon
              variant="text"
              size="small"
              :color="headline.is_marked ? 'amber' : 'grey'"
              @click.stop="emit('action', headline, 'toggle_star')"
            >
              <v-icon>{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
            </v-btn>

                        <v-btn
              icon
              variant="text"
              size="small"
              :color="headline.is_published ? 'blue' : 'grey'"
              @click.stop="emit('action', headline, 'toggle_publish')"
            >
              <v-icon>{{ headline.is_published ? 'mdi-share' : 'mdi-share-outline' }}</v-icon>
            </v-btn>

            <v-btn
              icon
              variant="text"
              size="small"
              color="grey"
              @click.stop="emit('action', headline, 'label')"
              title="Assign labels"
            >
              <v-icon>mdi-label</v-icon>
            </v-btn>
          </div>
        </template>
      </v-list-item>
        </v-list>
      </div>

    <div v-if="hasMore && !loading" class="load-more">
      <v-btn
        color="primary"
        variant="flat"
        :loading="loadingMore"
        @click="emit('load-more')"
      >
        Load more
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Headline } from '@/types';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';

const props = defineProps<{
  headlines: Headline[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  /** Id of the headline under the keyboard cursor, highlighted in the list. */
  activeId?: number | null;
}>();

const emit = defineEmits<{
  select: [headline: Headline];
  action: [headline: Headline, action: string];
  'load-more': [];
  'bulk-action': [action: string, ids: number[]];
}>();

// Bulk selection: a set of headline ids checked via the selection checkbox.
const selectedIds = ref(new Set<number>());

const allSelected = computed(
  () => props.headlines.length > 0 && props.headlines.every(h => selectedIds.value.has(h.id))
);
const someSelected = computed(() => selectedIds.value.size > 0);

// Reassign so the ref triggers reactivity when the set mutates.
const toggleSelected = (id: number, checked: boolean) => {
  const next = new Set(selectedIds.value);
  if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selectedIds.value = next;
};

const toggleAll = (checked: boolean) => {
  selectedIds.value = checked ? new Set(props.headlines.map(h => h.id)) : new Set();
};

// Infinite scroll wiring (Phase 5)
const listRef = ref<HTMLElement | null>(null);
const { setupScrollListener } = useInfiniteScroll({
  enabled: computed(() => Boolean(props.hasMore) && !props.loading && !props.loadingMore),
  onLoadMore: () => {
    emit('load-more');
  },
});

onMounted(() => {
  if (listRef.value) setupScrollListener(listRef.value);
});


const toggleRead = (headline: Headline) => {
  emit('action', headline, 'toggle_read');
};

// Feeds/view returns pre-localised date strings ("14:05", "Mar 03, 9:12",
// "Never"), not Unix timestamps, so they are rendered as-is.
const formatDate = (updated: string): string => updated;
</script>

<style scoped>
.headlines-list {
  height: 100%;
  overflow-y: auto;
}

.headlines-loading,
.headlines-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 1rem;
  color: grey;
}

.headlines-list-content {
  padding: 0;
}

.headline-read {
  opacity: 0.6;
}

/* Keyboard cursor highlight; matches the legacy .hl.active treatment. */
.headline-active {
  background: rgba(37, 122, 167, 0.12);
}

.headline-title {
  font-weight: 500;
  white-space: normal;
  line-height: 1.3;
}

.headline-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: grey;
}

.headline-actions {
  display: flex;
  gap: 0.25rem;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #eee;
}

.bulk-select-all {
  flex: 0 0 auto;
}

.bulk-count {
  font-size: 0.8125rem;
  color: #666;
}
</style>
