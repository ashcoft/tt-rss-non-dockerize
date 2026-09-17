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

    <v-list v-else class="headlines-list-content" lines="three">
      <v-list-item
        v-for="headline in headlines"
        :key="headline.id"
        :class="{ 'headline-read': headline.is_read }"
        @click="emit('select', headline)"
      >
        <template #prepend>
          <v-checkbox
            :model-value="headline.is_read"
            hide-details
            density="compact"
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
}>();

const emit = defineEmits<{
  select: [headline: Headline];
  action: [headline: Headline, action: string];
  'load-more': [];
}>();

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

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};
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
</style>
