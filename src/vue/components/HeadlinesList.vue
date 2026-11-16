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
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" size="small" variant="text" prepend-icon="mdi-checkbox-multiple-outline">
              Select
              <v-icon end>mdi-chevron-down</v-icon>
            </v-btn>
          </template>
          <v-list>
            <v-list-item
              v-for="item in selectOptions"
              :key="item.value"
              @click="selectBy(item.value)"
            >
              <v-list-item-title>{{ item.title }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
        <span v-if="selectedIds.size > 0" class="bulk-count">
          {{ selectedIds.size }} selected
        </span>
        <v-spacer />
        <template v-if="selectedIds.size > 0">
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'open_original', [...selectedIds])">
            Open original
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'mark_read', [...selectedIds])">
            Mark read
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'toggle_unread', [...selectedIds])">
            Toggle unread
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'toggle_starred', [...selectedIds])">
            Toggle starred
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'toggle_published', [...selectedIds])">
            Toggle published
          </v-btn>
          <v-btn size="small" variant="text" @click="emit('bulk-action', 'set_score', [...selectedIds])">
            Set score
          </v-btn>
          <v-btn size="small" variant="text" color="error" @click="emit('bulk-action', 'delete', [...selectedIds])">
            Delete
          </v-btn>
        </template>
      </div>

      <v-list
        class="headlines-list-content"
        :class="{ 'headlines-grid': combined && grid }"
        lines="three"
      >
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

        <!-- Combined mode: the article body is shown inline in the list. -->
        <div
          v-if="combined"
          class="headline-content"
          v-html="sanitize(headline.content)"
        ></div>

        <template #append>
          <div class="headline-actions">
            <v-btn
              icon
              variant="text"
              size="small"
              :color="headline.is_marked ? 'amber' : 'grey'"
              :title="headline.is_marked ? 'Unstar' : 'Star'"
              @click.stop="emit('action', headline, 'toggle_star')"
            >
              <v-icon>{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
            </v-btn>

                        <v-btn
              icon
              variant="text"
              size="small"
              :color="headline.is_published ? 'blue' : 'grey'"
              :title="headline.is_published ? 'Unpublish' : 'Publish'"
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
import DOMPurify from 'dompurify';
import type { Headline } from '@/types';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';

const props = defineProps<{
  headlines: Headline[];
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  /** Id of the headline under the keyboard cursor, highlighted in the list. */
  activeId?: number | null;
  /** Combined mode: render each article's content inline instead of a panel. */
  combined?: boolean;
  /** Grid: tile the inline articles on wide screens (only meaningful with combined). */
  grid?: boolean;
}>();

const emit = defineEmits<{
  select: [headline: Headline];
  action: [headline: Headline, action: string];
  'load-more': [];
  'bulk-action': [action: string, ids: number[]];
}>();

// Bulk selection: a set of headline ids checked via the selection checkbox.
const selectedIds = ref(new Set<number>());

// Mirrors the legacy headline toolbar's Select menu.
const selectOptions = [
  { title: 'All', value: 'all' },
  { title: 'Unread', value: 'unread' },
  { title: 'Invert', value: 'invert' },
  { title: 'None', value: 'none' },
];

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

/** Apply one of the Select-menu operations to the current list. */
const selectBy = (mode: string) => {
  if (mode === 'all') {
    selectedIds.value = new Set(props.headlines.map(h => h.id));
  } else if (mode === 'none') {
    selectedIds.value = new Set();
  } else if (mode === 'unread') {
    selectedIds.value = new Set(props.headlines.filter(h => !h.is_read).map(h => h.id));
  } else if (mode === 'invert') {
    const next = new Set<number>();
    for (const h of props.headlines) {
      if (!selectedIds.value.has(h.id)) next.add(h.id);
    }
    selectedIds.value = next;
  }
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

// Combined mode renders article HTML inline; sanitize it client-side, matching
// ArticleView (content is also sanitized server-side).
const sanitize = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
  });
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

/* Combined mode: the article body rendered inline under the headline. */
.headline-content {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: normal;
}

.headline-content :deep(img) {
  max-width: 100%;
}

/* Grid view: tile the inline articles on wide screens (combined mode only).
   Mirrors the legacy #headlines-frame[data-enable-grid] rule. */
.headlines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
  gap: 8px;
  padding: 8px;
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
