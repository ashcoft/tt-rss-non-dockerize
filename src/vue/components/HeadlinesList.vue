<template>
  <div ref="listRef" class="headlines-list">
    <div v-if="loading" class="headlines-loading">
      <v-progress-circular indeterminate color="primary" />
      <span>Loading headlines...</span>
    </div>

    <div v-else-if="headlines.length === 0" class="headlines-empty">
      <p>No headlines to display</p>
    </div>

    <div v-else>
      <!-- Bulk actions appear once articles are selected from the top bar. -->
      <div v-if="selectedIds.size > 0" class="bulk-bar">
        <span class="bulk-count">{{ selectedIds.size }} selected</span>
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

      <div
        class="headlines-list-content"
        :class="{ 'headlines-grid': combined && grid, cdm: combined }"
      >
        <div
          v-for="headline in headlines"
          :key="headline.id"
          class="v-list-item"
          :class="[
            combined ? 'cdm' : 'hl',
            {
              Unread: !headline.is_read,
              'headline-read': headline.is_read,
              'headline-active': headline.id === activeId,
              expanded: combined && isExpanded(headline),
              expandable: combined && !isExpanded(headline),
              marked: headline.is_marked,
              published: headline.is_published,
              'grid-span': gridSpanIds.has(headline.id),
            },
          ]"
          :data-headline-id="headline.id"
          @click="selectHeadline(headline)"
          @contextmenu.prevent="contextMenuId = headline.id"
        >
          <v-menu
            :model-value="contextMenuId === headline.id"
            activator="parent"
            :open-on-click="false"
            location="cursor"
            @update:model-value="(open: boolean) => { if (!open && contextMenuId === headline.id) contextMenuId = null; }"
          >
            <v-list density="compact">
              <v-list-item @click="openOriginal(headline)">Open original</v-list-item>
              <v-list-item @click="emit('action', headline, 'toggle_read')">
                {{ headline.is_read ? 'Mark as unread' : 'Mark as read' }}
              </v-list-item>
              <v-list-item @click="emit('action', headline, 'toggle_star')">
                {{ headline.is_marked ? 'Unstar' : 'Star' }}
              </v-list-item>
              <v-list-item @click="emit('action', headline, 'toggle_publish')">
                {{ headline.is_published ? 'Unpublish' : 'Publish' }}
              </v-list-item>
              <v-list-item @click="emit('action', headline, 'label')">Assign labels...</v-list-item>
              <v-list-item @click="emit('action', headline, 'open_feed')">Open feed</v-list-item>
              <v-divider />
              <v-list-item @click="emit('action', headline, 'delete')">Delete article</v-list-item>
            </v-list>
          </v-menu>

          <!-- Left icon strip: checkbox, star, publish. Mirrors the legacy
               .hl/.cdm header. -->
          <div class="hl-left">
            <v-checkbox
              :model-value="selectedIds.has(headline.id)"
              hide-details
              density="compact"
              title="Select article"
              @click.stop
              @update:model-value="(checked: boolean) => emit('toggle-select', headline.id, checked)"
            />
            <button
              type="button"
              class="hl-icon"
              :class="{ active: headline.is_marked }"
              :title="headline.is_marked ? 'Unstar' : 'Star'"
              @click.stop="emit('action', headline, 'toggle_star')"
            >
              <v-icon size="18">{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
            </button>
            <button
              type="button"
              class="hl-icon"
              :class="{ active: headline.is_published }"
              :title="headline.is_published ? 'Unpublish' : 'Publish'"
              @click.stop="emit('action', headline, 'toggle_publish')"
            >
              <v-icon size="18">mdi-rss</v-icon>
            </button>
            <button
              v-if="headline.is_read"
              type="button"
              class="hl-icon"
              title="Mark as unread"
              @click.stop="emit('action', headline, 'toggle_read')"
            >
              <v-icon size="16">mdi-circle-outline</v-icon>
            </button>
          </div>

          <!-- Title, author, labels and the inline excerpt. -->
          <div class="hl-title v-list-item-title headline-title">
            <a
              class="hl-title-link"
              :href="headline.link"
              :title="headline.title"
              @click.prevent.stop="selectHeadline(headline)"
            >{{ headline.title }}</a>
            <span v-if="headline.author" class="headline-author">{{ headline.author }}</span>
            <span
              v-if="headline.excerpt && (!combined || !isExpanded(headline)) && showPreview !== false"
              class="headline-preview"
              v-html="sanitize(headline.excerpt)"
            ></span>
          </div>

          <!-- Tags sit on their own row below the title, not inline with it. -->
          <div v-if="headline.tags.length > 0" class="hl-tags">
            <v-icon size="14">mdi-tag-outline</v-icon>
            <span v-for="tag in headline.tags" :key="tag" class="hl-tag">{{ tag }}</span>
            <a
              href="#"
              class="headline-label-add"
              title="Assign labels"
              @click.prevent.stop="emit('action', headline, 'label')"
            >(+)</a>
          </div>

          <!-- Feed pill and date, right-aligned as in the legacy row. -->
          <a
            class="hl-feed headline-feed-label"
            :style="{ backgroundColor: headline.feed_bg_color || undefined }"
            :href="feedSiteUrl || '#'"
            :target="feedSiteUrl ? '_blank' : undefined"
            :rel="feedSiteUrl ? 'noopener noreferrer' : undefined"
            :title="feedSiteUrl ? 'Open site' : 'Open feed'"
            @click="onFeedPillClick($event, headline)"
          >{{ headline.feed_title }}</a>
          <span v-if="headline.updated" class="hl-updated headline-date">
            {{ formatDate(headline.updated) }}
          </span>

          <div class="hl-right">
            <v-icon
              :icon="headline.score > 0 ? 'mdi-trending-up' : headline.score < 0 ? 'mdi-trending-down' : 'mdi-trending-neutral'"
              :color="headline.score > 0 ? 'green' : headline.score < 0 ? 'red' : undefined"
              size="16"
              :title="`Score: ${headline.score}`"
            />
            <button
              v-if="combined && grid"
              type="button"
              class="hl-icon"
              :class="{ active: gridSpanIds.has(headline.id) }"
              title="Span all columns"
              @click.stop="toggleGridSpan(headline.id)"
            >
              <v-icon size="16">mdi-arrow-expand-horizontal</v-icon>
            </button>
            <button
              type="button"
              class="hl-icon"
              title="Open original"
              @click.stop="openOriginal(headline)"
            >
              <v-icon size="16">mdi-arrow-right</v-icon>
            </button>
            <button
              type="button"
              class="hl-icon"
              title="Open feed"
              @click.stop="emit('action', headline, 'open_feed')"
            >
              <v-icon size="16">mdi-rss</v-icon>
            </button>
          </div>

          <!-- Combined mode: full body only when the row is expanded. -->
          <div
            v-if="combined && isExpanded(headline)"
            class="headline-content"
            @click="onContentClick($event, headline)"
          >
            <img
              v-if="headline.image_preview"
              class="headline-image-preview"
              :src="headline.image_preview"
              alt=""
              loading="lazy"
            />
            <div class="cdm-content-inner" v-html="sanitize(headline.content)"></div>
            <div v-if="headline.comments_link" class="cdm-footer">
              <a
                class="headline-comments-link"
                :href="headline.comments_link"
                target="_blank"
                rel="noopener noreferrer"
                @click.stop
              >({{ headline.comments_count }} {{ headline.comments_count === 1 ? 'comment' : 'comments' }})</a>
            </div>
          </div>
        </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
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
  /** CDM_EXPANDED: expand every combined row instead of only the active one. */
  cdmExpanded?: boolean;
  /** The current feed's site URL, for the feed pill link. */
  feedSiteUrl?: string;
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
// marked read. An IntersectionObserver is more reliable than scroll math and
// also fires for programmatic scrolling and after new pages are appended.
let autoCatchupObserver: IntersectionObserver | null = null;
let observedRows = new WeakSet<Element>();
const pendingCatchup = new Set<number>();

const emitAutoCatchup = (ids: number[]) => {
  const fresh = ids.filter(id => !pendingCatchup.has(id));
  if (fresh.length === 0) return;
  fresh.forEach(id => pendingCatchup.add(id));
  emit('auto-catchup', fresh);
  // Let the store mark the rows read before allowing the same id again.
  window.setTimeout(() => {
    fresh.forEach(id => pendingCatchup.delete(id));
  }, 2000);
};

const observeAutoCatchupRows = () => {
  if (!props.autoCatchup || !props.combined) return;
  const container = listRef.value;
  if (!container) return;

  if (!autoCatchupObserver) {
    autoCatchupObserver = new IntersectionObserver((entries) => {
      if (!props.autoCatchup || !props.combined) return;
      const rootTop = entries[0]?.rootBounds?.top ?? container.getBoundingClientRect().top;
      const ids: number[] = [];
      for (const entry of entries) {
        if (entry.isIntersecting) continue;
        if (entry.boundingClientRect.bottom > rootTop) continue;
        const row = entry.target as HTMLElement;
        if (row.classList.contains('headline-read')) continue;
        const id = Number(row.dataset.headlineId);
        if (Number.isFinite(id)) ids.push(id);
      }
      if (ids.length > 0) emitAutoCatchup(ids);
    }, { root: container, threshold: 0 });
  }

  container.querySelectorAll<HTMLElement>('.v-list-item[data-headline-id]').forEach((row) => {
    if (observedRows.has(row)) return;
    observedRows.add(row);
    autoCatchupObserver!.observe(row);
  });
};

// Scroll fallback: marks rows whose midpoint is already above the viewport.
// The observer handles rows that leave the viewport, while this catches rows
// skipped by a fast jump (e.g. Home/End or a large wheel scroll).
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
    if (ids.length > 0) emitAutoCatchup(ids);
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
  observeAutoCatchupRows();
});

watch(
  () => [props.headlines.length, props.combined, props.autoCatchup] as const,
  () => {
    if (!props.autoCatchup || !props.combined) {
      autoCatchupObserver?.disconnect();
      autoCatchupObserver = null;
      observedRows = new WeakSet<Element>();
      return;
    }
    void nextTick(observeAutoCatchupRows);
  }
);

onUnmounted(() => {
  autoCatchupObserver?.disconnect();
  autoCatchupObserver = null;
});


const contextMenuId = ref<number | null>(null);
const gridSpanIds = ref<Set<number>>(new Set());

const toggleGridSpan = (id: number) => {
  const next = new Set(gridSpanIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  gridSpanIds.value = next;
};

/** The feed pill opens the feed site; fall back to selecting the feed. */
const onFeedPillClick = (event: MouseEvent, headline: Headline) => {
  event.stopPropagation();
  if (!props.feedSiteUrl) {
    event.preventDefault();
    emit('action', headline, 'open_feed');
  }
};

/** Clicking the inline body/image opens the original article, not the row. */
const onContentClick = (event: MouseEvent, headline: Headline) => {
  const target = event.target as HTMLElement;
  if (target.closest('a')) return;
  if (window.getSelection()?.toString()) return;
  event.stopPropagation();
  openOriginal(headline);
};

/** In combined mode, only the active row is expanded unless CDM_EXPANDED is on. */
const isExpanded = (headline: Headline): boolean => {
  return Boolean(props.combined) && (Boolean(props.cdmExpanded) || headline.id === props.activeId);
};

/** Clicking a row selects it; App marks it read and moves the cursor. */
const selectHeadline = (headline: Headline) => {
  emit('select', headline);
};

const openOriginal = (headline: Headline) => {
  window.open(headline.link, '_blank', 'noopener,noreferrer');
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
  background: rgb(var(--v-theme-surface));
}

.headlines-loading,
.headlines-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 1rem;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.875rem;
}

.headlines-list-content {
  background: transparent;
  padding: 0;
}

/* Rows mirror the legacy .hl / .cdm header: compact, separated by rules, not
   cards. */
.headlines-list-content > .v-list-item {
  display: grid;
  grid-template-areas:
    "left title feed updated right"
    "left tags tags tags tags";
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  min-height: 32px;
  margin: 0;
  padding: 1px 8px;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-background), 0.09);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}

.headlines-list-content > .v-list-item:hover {
  background: rgba(var(--v-theme-on-background), 0.035);
}

.headlines-list-content > .v-list-item.Unread {
  background: rgb(var(--v-theme-surface));
}

.headlines-list-content > .v-list-item.headline-active {
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-success));
}

.hl-left {
  grid-area: left;
  display: flex;
  align-items: center;
  gap: 1px;
}

.hl-left :deep(.v-selection-control) {
  min-height: 20px;
}

.hl-left :deep(.v-checkbox .v-icon) {
  font-size: 18px;
}

.hl-left :deep(.v-input__details) {
  display: none;
}

.hl-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-background), 0.45);
  cursor: pointer;
  opacity: 0.45;
  transition: opacity 0.12s ease;
}

.v-list-item:hover .hl-icon,
.hl-icon.active,
.hl-icon:focus-visible {
  opacity: 1;
}

.hl-icon.active {
  color: rgb(var(--v-theme-primary));
}

.hl-title {
  grid-area: title;
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 0.95rem;
  line-height: 1.35;
}

.hl-title-link {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: rgb(var(--v-theme-on-background)) !important;
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
}

.hl-title-link:hover {
  text-decoration: underline;
}

.headline-read .hl-title-link {
  font-weight: 400;
  color: rgba(var(--v-theme-on-background), 0.72);
}

.headline-author {
  flex: 0 0 auto;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.8125rem;
  font-weight: 400;
}

.hl-tags {
  grid-area: tags;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 2px;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.75rem;
}

.hl-tag {
  color: rgba(var(--v-theme-on-background), 0.55);
}

.headline-preview {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-background), 0.58);
  font-size: 0.8125rem;
  font-weight: 400;
  text-overflow: ellipsis;
}

.headline-preview :deep(img) {
  display: none;
}

.hl-feed {
  grid-area: feed;
  justify-self: end;
  max-width: 180px;
  margin: 0 4px;
  padding: 0 6px;
  overflow: hidden;
  border: 0;
  border-radius: 99px;
  color: rgb(var(--v-theme-on-background));
  font-size: 0.75rem;
  line-height: 1.35;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hl-updated {
  grid-area: updated;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.75rem;
  white-space: nowrap;
}

.hl-right {
  grid-area: right;
  display: flex;
  align-items: center;
  gap: 1px;
}

/* Combined mode: the body spans the full row below the header. */
.cdm > .headline-content {
  grid-column: 1 / -1;
  grid-row: 3;
  padding: 8px 8px 14px 42px;
  border-top: 1px solid rgba(var(--v-theme-on-background), 0.09);
}

.cdm-content-inner {
  font-size: 0.9rem;
  line-height: 1.55;
  white-space: normal;
  word-wrap: break-word;
}

.cdm-content-inner :deep(img) {
  max-width: 100%;
  height: auto;
}

.headline-image-preview {
  display: block;
  max-width: min(100%, 480px);
  max-height: 280px;
  margin-bottom: 8px;
  object-fit: contain;
}

.cdm-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.75rem;
}

.hl-tag {
  color: rgb(var(--v-theme-primary));
}

.headline-label-add,
.headline-comments-link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.headline-label-add:hover,
.headline-comments-link:hover {
  text-decoration: underline;
}

/* Grid view: tile the inline articles on wide screens (combined mode only). */
.headlines-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
  gap: 12px;
  padding: 12px;
}

.headlines-grid > .v-list-item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border: 1px solid rgba(var(--v-theme-on-background), 0.12);
  border-radius: 4px;
}

.headlines-grid > .v-list-item.grid-span {
  grid-column: 1 / -1;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-background), 0.09);
}

.bulk-count {
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-background), 0.65);
}

.load-more {
  display: flex;
  justify-content: center;
  padding: 16px;
}

/* Phone layout: compact rows without the right-hand metadata strip. */
@media (max-width: 900px) {
  .headlines-list-content > .v-list-item {
    grid-template-areas:
      "left title"
      "left tags";
    grid-template-columns: auto minmax(0, 1fr);
    padding: 4px 6px;
  }

  .hl-title {
    white-space: normal;
  }

  .hl-feed,
  .hl-updated,
  .hl-right {
    display: none;
  }

  .hl-icon {
    opacity: 1;
  }

  .cdm > .headline-content {
    padding-left: 8px;
  }

  .bulk-bar {
    overflow-x: auto;
  }

  .bulk-bar .v-btn {
    flex: 0 0 auto;
  }
}
</style>
