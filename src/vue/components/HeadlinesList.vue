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
      <!-- Bulk actions appear once articles are selected from the top bar. -->
      <div v-if="selectedIds.size > 0" class="bulk-bar">
        <span class="bulk-count">
          {{ selectedIds.size }} selected
        </span>
        <v-spacer />
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
      </div>

      <v-list
        class="headlines-list-content"
        :class="{ 'headlines-grid': combined && grid }"
        lines="three"
      >
        <v-list-item
          v-for="headline in headlines"
          :key="headline.id"
          :data-headline-id="headline.id"
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
              @update:model-value="(checked: boolean) => emit('toggle-select', headline.id, checked)"
            />
            <!-- Star and read state sit in the left icon strip, as in main. -->
            <v-btn
              icon
              variant="text"
              size="x-small"
              :color="headline.is_marked ? 'amber' : 'grey'"
              :title="headline.is_marked ? 'Unstar' : 'Star'"
              @click.stop="emit('action', headline, 'toggle_star')"
            >
              <v-icon>{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
            </v-btn>
            <v-btn
              :icon="headline.is_read ? 'mdi-circle-outline' : 'mdi-circle'"
              :color="headline.is_read ? 'grey' : 'primary'"
              size="x-small"
              variant="text"
              :title="headline.is_read ? 'Mark as unread' : 'Mark as read'"
              @click.stop="toggleRead(headline)"
            />
          </template>

          <!-- Phone-only meta line: feed, date and score above the title. -->
          <div class="headline-mobile-meta">
            <a
              class="headline-mobile-feed"
              :style="{ backgroundColor: headline.feed_bg_color || undefined }"
              :href="headline.link"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ headline.feed_title }}
            </a>
            <span class="headline-mobile-meta-right">
              <span v-if="headline.updated" class="headline-date">
                {{ formatDate(headline.updated) }}
              </span>
              <v-icon
                v-if="headline.score !== 0"
                :icon="headline.score > 0 ? 'mdi-trending-up' : 'mdi-trending-down'"
                :color="headline.score > 0 ? 'green' : 'red'"
                size="14"
                :title="`Score: ${headline.score}`"
              />
            </span>
          </div>

          <v-list-item-title class="headline-title">
            {{ headline.title }}
            <span v-if="headline.author" class="headline-author">{{ headline.author }}</span>
            <!-- Excerpt, as in the legacy row's title preview (an HTML fragment). -->
            <span
              v-if="headline.excerpt && !combined && showPreview !== false"
              class="headline-preview"
              v-html="sanitize(headline.excerpt)"
            ></span>
          </v-list-item-title>

          <!-- Legacy row metadata: tags with the (+) label action, comments link. -->
          <div class="headline-tags">
            <v-icon size="14">mdi-tag-outline</v-icon>
            <template v-if="headline.tags.length > 0">
              <v-chip
                v-for="tag in headline.tags"
                :key="tag"
                size="x-small"
                variant="tonal"
              >
                {{ tag }}
              </v-chip>
            </template>
            <span v-else class="headline-no-tags">no tags</span>
            <a
              href="#"
              class="headline-label-add"
              title="Assign labels"
              @click.prevent.stop="emit('action', headline, 'label')"
            >(+)</a>
            <a
              v-if="headline.comments_link"
              class="headline-comments-link"
              :href="headline.comments_link"
              target="_blank"
              rel="noopener noreferrer"
              @click.stop
            >(comments)</a>
          </div>

          <!-- Combined mode: the article body is shown inline in the list. -->
          <div v-if="combined" class="headline-content">
            <img
              v-if="headline.image_preview"
              class="headline-image-preview"
              :src="headline.image_preview"
              alt=""
              loading="lazy"
            />
            <div v-html="sanitize(headline.content)"></div>
          </div>

          <template #append>
            <div class="headline-side">
              <div class="headline-side-meta">
                <a
                  class="headline-feed-label"
                  :style="{ backgroundColor: headline.feed_bg_color || undefined }"
                  :href="headline.link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ headline.feed_title }}
                </a>
                <span v-if="headline.updated" class="headline-date">
                  {{ formatDate(headline.updated) }}
                </span>
                <!-- Score indicator, matching the legacy icon-score. -->
                <v-icon
                  v-if="headline.score !== 0"
                  :icon="headline.score > 0 ? 'mdi-trending-up' : 'mdi-trending-down'"
                  :color="headline.score > 0 ? 'green' : 'red'"
                  size="14"
                  :title="`Score: ${headline.score}`"
                />
              </div>
              <div class="headline-actions">
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
                  :href="headline.link"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open original"
                  @click.stop
                >
                  <v-icon>mdi-arrow-right</v-icon>
                </v-btn>
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  color="grey"
                  title="Open feed"
                  @click.stop="emit('action', headline, 'open_feed')"
                >
                  <v-icon>mdi-rss</v-icon>
                </v-btn>
              </div>
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
  /** SHOW_CONTENT_PREVIEW: render the content preview under the title. */
  showPreview?: boolean;
  /** Ids currently checked for bulk actions. */
  selectedIds?: Set<number>;
  /** CDM_AUTO_CATCHUP: mark articles read as they scroll past. */
  autoCatchup?: boolean;
}>();

const emit = defineEmits<{
  select: [headline: Headline];
  action: [headline: Headline, action: string];
  'toggle-select': [id: number, checked: boolean];
  'auto-catchup': [ids: number[]];
  'load-more': [];
  'bulk-action': [action: string, ids: number[]];
}>();

// Infinite scroll wiring (Phase 5)
const listRef = ref<HTMLElement | null>(null);

// Legacy CDM_AUTO_CATCHUP: rows that have scrolled above the viewport are
// marked read. Only applies to the combined (inline) layout.
let catchupScheduled = false;
const autoCatchupOnScroll = () => {
  if (!props.autoCatchup || !props.combined || catchupScheduled) return;

  catchupScheduled = true;
  requestAnimationFrame(() => {
    catchupScheduled = false;

    const container = listRef.value;
    if (!container) return;

    const top = container.getBoundingClientRect().top;
    const ids: number[] = [];
    container
      .querySelectorAll<HTMLElement>('.v-list-item[data-headline-id]:not(.headline-read)')
      .forEach((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.top + rect.height / 2 < top) {
          const id = Number(row.dataset.headlineId);
          if (Number.isFinite(id)) ids.push(id);
        }
      });

    if (ids.length > 0) emit('auto-catchup', ids);
  });
};

const { setupScrollListener } = useInfiniteScroll({
  enabled: computed(() => Boolean(props.hasMore) && !props.loading && !props.loadingMore),
  onScroll: autoCatchupOnScroll,
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
  background: transparent;
  padding: 8px 24px;
}

/* Feedly renders each article as a white card on the page background. */
.headlines-list-content :deep(.v-list-item) {
  margin: 16px 0;
  padding: 20px 24px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.headline-mobile-meta {
  display: none;
}

.headline-mobile-feed {
  display: inline-block;
  padding: 0 0.4rem;
  border-radius: 3px;
  font-size: 0.75rem;
  color: inherit;
  text-decoration: none;
}

.headlines-list-content :deep(.v-list-item__overlay),
.headlines-list-content :deep(.v-list-item__underlay) {
  display: none;
}

.headline-read {
  opacity: 0.7;
}

.headline-read .headline-title {
  font-weight: 500;
}

/* Keyboard cursor highlight: a ring instead of a tinted row. */
.headline-active {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

.headline-title {
  font-size: 1.15rem;
  font-weight: 600;
  white-space: normal;
  line-height: 1.3;
  color: rgb(var(--v-theme-on-surface));
}

.headline-preview {
  display: block;
  margin-top: 0.25rem;
  font-weight: 400;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.headline-author {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  font-weight: 400;
  color: #666;
}

.headline-tags {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.headline-no-tags {
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.headline-label-add,
.headline-comments-link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.headline-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.headline-side-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #666;
}

.headline-date {
  white-space: nowrap;
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

.headline-image-preview {
  display: block;
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
  margin-bottom: 0.5rem;
}

.headline-feed-label {
  display: inline-block;
  padding: 0 0.4rem;
  border-radius: 3px;
  font-size: 0.75rem;
  color: inherit;
  text-decoration: none;
}

/* Grid view: tile the inline articles on wide screens (combined mode only).
   Mirrors the legacy #headlines-frame[data-enable-grid] rule. */
.headlines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
  gap: 16px;
  padding: 16px 24px;
}

.headlines-grid :deep(.v-list-item) {
  margin: 0;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 24px;
}

.bulk-select-all {
  flex: 0 0 auto;
}

.bulk-count {
  font-size: 0.8125rem;
  color: #666;
}

/* Phone layout: full-width cards, no left icon strip (as in the legacy
   client), and horizontal scrolling for the bulk action row. */
@media (max-width: 900px) {
  .headlines-list-content {
    padding: 8px;
  }

  .headlines-list-content :deep(.v-list-item) {
    margin: 8px 0;
    padding: 12px 14px;
    border-radius: 6px;
  }

  .headlines-list-content :deep(.v-list-item__prepend) {
    display: none;
  }

  .headline-title {
    font-size: 1rem;
  }

  .headline-actions,
  .headline-side {
    display: none;
  }

  .headline-mobile-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
  }

  .headline-mobile-meta-right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: rgba(var(--v-theme-on-surface), 0.6);
    white-space: nowrap;
  }

  .headline-tags {
    flex-wrap: wrap;
  }

  .bulk-bar {
    padding: 0.25rem 8px;
    overflow-x: auto;
  }

  .bulk-bar .v-btn {
    flex: 0 0 auto;
  }
}
</style>
