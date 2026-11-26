<template>
  <div
    ref="listRef"
    id="headlines-frame"
    class="headlines-list"
    :class="{ cdm: combined }"
    :data-enable-grid="grid ? 'true' : 'false'"
    :data-is-cdm-expanded="cdmExpanded ? 'true' : 'false'"
    :data-auto-catchup="autoCatchup ? 'true' : 'false'"
    :is-vfeed="isVfeed ? '1' : '0'"
    :data-is-vfeed="isVfeed ? 'true' : 'false'"
  >
    <div
      v-if="refreshing || pullDistance > 0"
      class="pull-refresh"
      :class="{ ready: pullDistance >= 64, spinning: refreshing }"
      :style="{
        transform: `translate(-50%, ${pullDistance}px)`,
        opacity: refreshing ? 1 : Math.min(1, pullDistance / 64),
      }"
    >
      <v-progress-circular v-if="refreshing" indeterminate size="18" width="2" />
      <v-icon v-else size="20">mdi-refresh</v-icon>
    </div>

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
        :class="{ 'headlines-grid': combined && grid }"
      >
        <template v-for="(headline, headlineIndex) in displayHeadlines" :key="headline.id">
        <div
          v-if="groupByFeed && (headlineIndex === 0 || displayHeadlines[headlineIndex - 1].feed_id !== headline.feed_id)"
          class="feed-title"
        >
          <span class="title">{{ headline.feed_title }}</span>
          <a
            href="#"
            class="catchup"
            title="Mark feed as read"
            @click.prevent.stop="emit('action', headline, 'catchup_feed')"
          ><v-icon size="14">mdi-done-all</v-icon></a>
        </div>
        <div
          class="v-list-item"
          :class="[
            combined ? 'cdm' : 'hl',
            {
              Unread: !headline.is_read,
              'headline-read': headline.is_read,
              'headline-active': headline.id === activeId,
              active: headline.id === activeId,
              expanded: combined && isExpanded(headline),
              expandable: combined && !isExpanded(headline),
              marked: headline.is_marked,
              published: headline.is_published,
              'grid-span': gridSpanIds.has(headline.id),
            },
          ]"
          :id="`RROW-${headline.id}`"
          :data-headline-id="headline.id"
          :data-article-id="headline.id"
          :data-orig-feed-id="headline.feed_id"
          :data-orig-feed-title="headline.feed_title"
          :data-score="headline.score"
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

          <!-- Combined rows use the legacy .cdm/.header markup; three-panel
               rows use the legacy single .hl grid. Both keep the Vue classes
               the E2E suite and the app's own styles rely on. -->
          <template v-if="combined">
            <div class="header-sticky-guard"></div>
            <div class="header">
              <div class="left hl-left">
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
                  class="hl-icon marked-pic"
                  :class="{ active: headline.is_marked }"
                  :title="headline.is_marked ? 'Unstar' : 'Star'"
                  @click.stop="emit('action', headline, 'toggle_star')"
                >
                  <v-icon size="18">{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
                </button>
                <button
                  type="button"
                  class="hl-icon pub-pic"
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
                <span v-if="!headline.is_read" class="unread-dot" title="Unread"></span>
              </div>

              <span
                class="titleWrap hl-title v-list-item-title headline-title"
                @click.stop="selectHeadline(headline)"
              >
                <span v-if="debugIds" class="hl-debug">{{ headline.id }}/{{ headline.feed_id }}</span>
                <a
                  class="title hl-title-link"
                  :href="headline.link"
                  :title="headline.title"
                  @click.prevent.stop="selectHeadline(headline)"
                >{{ headline.title }}</a>
                <span v-if="headline.author" class="author headline-author">{{ headline.author }}</span>
                <span
                  v-if="headline.excerpt && !isExpanded(headline) && showPreview !== false"
                  class="preview headline-preview"
                  v-html="sanitize(headline.excerpt)"
                ></span>
                <span v-if="headline.tags.length > 0" class="tags hl-tags">
                  <v-icon size="14">mdi-tag-outline</v-icon>
                  <span v-for="tag in headline.tags" :key="tag" class="hl-tag">{{ tag }}</span>
                  <a
                    href="#"
                    class="headline-label-add"
                    title="Assign labels"
                    @click.prevent.stop="emit('action', headline, 'label')"
                  >(+)</a>
                </span>
              </span>

              <a
                class="feed hl-feed headline-feed-label"
                :style="{ backgroundColor: headline.feed_bg_color || undefined }"
                :href="feedSiteUrl || '#'"
                :target="feedSiteUrl ? '_blank' : undefined"
                :rel="feedSiteUrl ? 'noopener noreferrer' : undefined"
                :title="feedSiteUrl ? 'Open site' : 'Open feed'"
                @click="onFeedPillClick($event, headline)"
              >{{ headline.feed_title }}</a>

              <span v-if="headline.updated" class="updated hl-updated headline-date">
                {{ formatDate(headline.updated) }}
              </span>

              <div class="right hl-right">
                <v-icon
                  class="icon-score"
                  :icon="headline.score > 0 ? 'mdi-trending-up' : headline.score < 0 ? 'mdi-trending-down' : 'mdi-trending-neutral'"
                  :color="headline.score > 0 ? 'green' : headline.score < 0 ? 'red' : undefined"
                  size="16"
                  :title="String(headline.score)"
                />
                <button
                  v-if="combined && grid"
                  type="button"
                  class="hl-icon icon-grid-span"
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
                <span class="icon-feed" :title="headline.feed_title" @click.stop="emit('action', headline, 'open_feed')">
                  <img
                    v-if="headline.feed_has_icon && !iconFailed.has(headline.feed_id)"
                    :src="feedIconUrl(headline.feed_id)"
                    class="feed-icon"
                    width="16"
                    height="16"
                    alt=""
                    @error="iconFailed.add(headline.feed_id)"
                  />
                  <v-icon v-else size="16">mdi-rss</v-icon>
                </span>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="left hl-left">
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
                class="hl-icon marked-pic"
                :class="{ active: headline.is_marked }"
                :title="headline.is_marked ? 'Unstar' : 'Star'"
                @click.stop="emit('action', headline, 'toggle_star')"
              >
                <v-icon size="18">{{ headline.is_marked ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
              </button>
              <button
                type="button"
                class="hl-icon pub-pic"
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
              <span v-if="!headline.is_read" class="unread-dot" title="Unread"></span>
              <button
                v-for="button in headline.pluginLeftButtons ?? []"
                :key="`left-${button.plugin}.${button.method}`"
                type="button"
                class="hl-icon"
                :title="button.title"
                @click.stop="runPluginLeftButton(headline, button)"
              >
                <v-icon size="16">{{ pluginIcon(button.icon) }}</v-icon>
              </button>
            </div>

            <div class="title hl-title v-list-item-title headline-title" @click.stop="selectHeadline(headline)">
              <span class="hl-content">
                <span v-if="debugIds" class="hl-debug">{{ headline.id }}/{{ headline.feed_id }}</span>
                <a
                  class="title hl-title-link"
                  :href="headline.link"
                  :title="headline.title"
                  @click.prevent.stop="selectHeadline(headline)"
                >{{ headline.title }}</a>
                <span v-if="headline.author" class="author headline-author">{{ headline.author }}</span>
                <span
                  v-if="headline.excerpt && showPreview !== false"
                  class="preview headline-preview"
                  v-html="sanitize(headline.excerpt)"
                ></span>
                <span v-if="headline.tags.length > 0" class="tags hl-tags">
                  <v-icon size="14">mdi-tag-outline</v-icon>
                  <span v-for="tag in headline.tags" :key="tag" class="hl-tag">{{ tag }}</span>
                  <a
                    href="#"
                    class="headline-label-add"
                    title="Assign labels"
                    @click.prevent.stop="emit('action', headline, 'label')"
                  >(+)</a>
                </span>
              </span>
            </div>

            <span class="feed hl-feed headline-feed-label">
              <a
                :style="{ backgroundColor: headline.feed_bg_color || undefined }"
                :href="feedSiteUrl || '#'"
                :target="feedSiteUrl ? '_blank' : undefined"
                :rel="feedSiteUrl ? 'noopener noreferrer' : undefined"
                :title="feedSiteUrl ? 'Open site' : 'Open feed'"
                @click="onFeedPillClick($event, headline)"
              >{{ headline.feed_title }}</a>
            </span>

            <div class="updated-wrap">
              <span v-if="headline.updated" class="updated hl-updated headline-date">
                {{ formatDate(headline.updated) }}
              </span>
            </div>

            <div class="right hl-right">
              <v-icon
                class="icon-score"
                :icon="headline.score > 0 ? 'mdi-trending-up' : headline.score < 0 ? 'mdi-trending-down' : 'mdi-trending-neutral'"
                :color="headline.score > 0 ? 'green' : headline.score < 0 ? 'red' : undefined"
                size="16"
                :title="String(headline.score)"
              />
              <button
                type="button"
                class="hl-icon"
                title="Open original"
                @click.stop="openOriginal(headline)"
              >
                <v-icon size="16">mdi-arrow-right</v-icon>
              </button>
              <span class="icon-feed" :title="headline.feed_title" @click.stop="emit('action', headline, 'open_feed')">
                <img
                  v-if="headline.feed_has_icon && !iconFailed.has(headline.feed_id)"
                  :src="feedIconUrl(headline.feed_id)"
                  class="feed-icon"
                  width="16"
                  height="16"
                  alt=""
                  @error="iconFailed.add(headline.feed_id)"
                />
                <v-icon v-else size="16">mdi-rss</v-icon>
              </span>
            </div>
          </template>

          <!-- Combined mode: full body only when the row is expanded. -->
          <div
            v-if="combined && isExpanded(headline)"
            class="content headline-content"
            @click="onContentClick($event, headline)"
          >
            <img
              v-if="headline.image_preview"
              class="headline-image-preview"
              :src="headline.image_preview"
              alt=""
              loading="lazy"
            />
            <div
              class="content-inner cdm-content-inner"
              :lang="headline.lang || 'en'"
              v-html="sanitize(headline.content)"
            ></div>
            <div class="footer cdm-footer">
              <div class="left">
                <button
                  v-for="button in headline.pluginLeftButtons ?? []"
                  :key="`footer-${button.plugin}.${button.method}`"
                  type="button"
                  class="hl-icon"
                  :title="button.title"
                  @click.stop="runPluginLeftButton(headline, button)"
                >
                  <v-icon size="16">{{ pluginIcon(button.icon) }}</v-icon>
                </button>
                <span v-if="headline.tags.length > 0" class="tags hl-tags">
                  <v-icon size="14">mdi-tag-outline</v-icon>
                  <span v-for="tag in headline.tags" :key="tag" class="hl-tag">{{ tag }}</span>
                </span>
                <a
                  href="#"
                  class="headline-label-add"
                  title="Assign labels"
                  @click.prevent.stop="emit('action', headline, 'label')"
                >(+)</a>
                <a
                  v-if="headline.comments_link"
                  class="comments headline-comments-link"
                  :href="headline.comments_link"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop
                >({{ headline.comments_count }} {{ headline.comments_count === 1 ? 'comment' : 'comments' }})</a>
              </div>
              <div class="right">
                <button
                  v-for="button in headline.pluginButtons ?? []"
                  :key="`${button.plugin}.${button.method}`"
                  type="button"
                  class="hl-icon"
                  :title="button.title"
                  @click.stop="runPluginLeftButton(headline, button)"
                >
                  <v-icon size="16">{{ pluginIcon(button.icon) }}</v-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
        </template>
      </div>

      <div v-if="firstIdChanged && !loading" class="headlines-end">
        <a href="#" @click.prevent="emit('reload-current')">New articles found, reload feed to continue.</a>
      </div>

      <div v-if="!hasMore && !loading && headlines.length > 0" class="headlines-end">
        <a href="#" @click.prevent="emit('next-unread')">Click to open next unread feed.</a>
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

    <!-- Plugin article-button output, sanitized before rendering. -->
    <v-dialog :model-value="pluginDialog !== null" max-width="640" @update:model-value="(open: boolean) => { if (!open) pluginDialog = null; }">
      <v-card>
        <v-card-title>{{ pluginDialog?.title || 'Plugin' }}</v-card-title>
        <v-card-text>
          <div v-if="pluginBusy" class="text-center py-4">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <div v-else class="plugin-dialog-html" v-html="sanitizedPluginHtml" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pluginDialog = null">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import DOMPurify from 'dompurify';
import type { Headline } from '@/types';
import { useInfiniteScroll } from '@/composables/useInfiniteScroll';
import { usePullAndSwipe } from '@/composables/usePullAndSwipe';
import { useLongPressContextMenu } from '@/composables/useLongPressContextMenu';
import { pluginIcon } from '../utils/pluginIcons';
import api from '@/api/client';

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
  /** VFEED_GROUP_BY_FEED: insert feed headings in virtual-feed lists. */
  groupByFeed?: boolean;
  /** DEBUG_HEADLINE_IDS: show article/feed ids in the row. */
  debugIds?: boolean;
  /** CDM_EXPANDED: expand every combined row instead of only the active one. */
  cdmExpanded?: boolean;
  /** The current feed's site URL, for the feed pill link. */
  feedSiteUrl?: string;
  /** Feeds/view reports that the first article changed while paging. */
  firstIdChanged?: boolean;
  /** Ids currently checked for bulk actions. */
  selectedIds?: Set<number>;
  /** CDM_AUTO_CATCHUP: mark articles read as they scroll past. */
  autoCatchup?: boolean;
  /** Base URL for public.php feed icons. */
  iconsUrl?: string;
  /** True when the list mixes several feeds. */
  isVfeed?: boolean;
}>();

const emit = defineEmits<{
  select: [headline: Headline];
  action: [headline: Headline, action: string];
  'toggle-select': [id: number, checked: boolean];
  'auto-catchup': [ids: number[]];
  'load-more': [];
  'bulk-action': [action: string, ids: number[]];
  'next-unread': [];
  'reload-current': [];
  'pull-refresh': [];
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

// CDM sticky header: the guard above the header tells us when the header has
// scrolled past, and the content observer parks the header while the body is
// still visible (mirrors Headlines.sticky_*_observer).
let stickyHeaderObserver: IntersectionObserver | null = null;
let stickyContentObserver: IntersectionObserver | null = null;
let observedSticky = new WeakSet<Element>();

const observeStickyRows = () => {
  const container = listRef.value;
  if (!container || !props.combined) return;

  if (!stickyHeaderObserver) {
    stickyHeaderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const header = entry.target.closest('.cdm')?.querySelector('.header');
          if (!header) continue;
          if (entry.isIntersecting) header.removeAttribute('data-is-stuck');
          else header.setAttribute('data-is-stuck', 'true');
        }
      },
      { threshold: [0, 1], root: container }
    );

    stickyContentObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const header = entry.target.closest('.cdm')?.querySelector<HTMLElement>('.header');
          if (header) header.style.position = entry.isIntersecting ? 'sticky' : 'unset';
        }
      },
      { threshold: [0, 1], root: container }
    );
  }

  container.querySelectorAll('.cdm .header-sticky-guard').forEach((guard) => {
    if (observedSticky.has(guard)) return;
    observedSticky.add(guard);
    stickyHeaderObserver!.observe(guard);
  });
  container.querySelectorAll('.cdm .content').forEach((content) => {
    if (observedSticky.has(content)) return;
    observedSticky.add(content);
    stickyContentObserver!.observe(content);
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
  observeStickyRows();
});

watch(
  () => [props.headlines.length, props.combined, props.autoCatchup, props.cdmExpanded] as const,
  () => {
    if (!props.autoCatchup || !props.combined) {
      autoCatchupObserver?.disconnect();
      autoCatchupObserver = null;
      observedRows = new WeakSet<Element>();
    } else {
      void nextTick(observeAutoCatchupRows);
    }

    if (!props.combined) {
      stickyHeaderObserver?.disconnect();
      stickyContentObserver?.disconnect();
      stickyHeaderObserver = null;
      stickyContentObserver = null;
      observedSticky = new WeakSet<Element>();
    } else {
      void nextTick(observeStickyRows);
    }
  }
);

onUnmounted(() => {
  autoCatchupObserver?.disconnect();
  autoCatchupObserver = null;
  stickyHeaderObserver?.disconnect();
  stickyContentObserver?.disconnect();
  stickyHeaderObserver = null;
  stickyContentObserver = null;
});


const contextMenuId = ref<number | null>(null);
/** Feed ids whose icon failed to load, so the RSS glyph is used instead. */
const iconFailed = ref<Set<number>>(new Set());

/** Feed icon URL, matching FeedTree's public.php?op=feed_icon form. */
const feedIconUrl = (feedId: number): string =>
  `${props.iconsUrl ?? '/public.php'}?op=feed_icon&id=${feedId}`;

// Plugin buttons on the left of a row run through PluginHandler; the returned
// fragment is shown in a sanitized dialog, like the reading pane does.
const pluginDialog = ref<{ title: string; html: string } | null>(null);
const pluginBusy = ref(false);
const sanitizedPluginHtml = computed(() =>
  pluginDialog.value ? DOMPurify.sanitize(pluginDialog.value.html) : ''
);

async function runPluginLeftButton(
  headline: Headline,
  button: { plugin: string; method: string; title: string }
): Promise<void> {
  if (button.plugin.toLowerCase() === 'af_readability' && button.method === 'embed') {
    emit('action', headline, 'toggle_full_text');
    return;
  }

  pluginBusy.value = true;
  try {
    const response = await api.invokePluginHandler(button.plugin, button.method, {
      id: headline.id,
    });
    pluginDialog.value = {
      title: button.title,
      html: response.status === 0 ? response.content : `<p>${response.error ?? 'Plugin handler failed.'}</p>`,
    };
  } finally {
    pluginBusy.value = false;
  }
}
/** Rows swiped away on the phone layout, hidden until the list reloads. */
const swipedIds = ref<Set<number>>(new Set());

/** VFEED_GROUP_BY_FEED groups all rows of a feed together under one heading. */
const displayHeadlines = computed(() => {
  const visible = props.headlines.filter(headline => !swipedIds.value.has(headline.id));
  if (!props.groupByFeed) return visible;
  const groups = new Map<number, Headline[]>();
  for (const headline of visible) {
    const group = groups.get(headline.feed_id) ?? [];
    group.push(headline);
    groups.set(headline.feed_id, group);
  }
  return [...groups.values()].flat();
});

const gridSpanIds = ref<Set<number>>(new Set());

const { pullDistance, refreshing, stopRefreshing } = usePullAndSwipe(listRef, {
  onRefresh: () => emit('pull-refresh'),
  onSwipeRead: (articleId) => {
    swipedIds.value = new Set([...swipedIds.value, articleId]);
    const headline = props.headlines.find(item => item.id === articleId);
    if (headline) emit('action', headline, 'mark_read');
  },
});

useLongPressContextMenu(listRef);

watch(
  () => props.loading,
  (loading) => {
    if (loading) {
      swipedIds.value = new Set();
    } else {
      stopRefreshing();
    }
  }
);

const toggleGridSpan = (id: number) => {
  const next = new Set(gridSpanIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  gridSpanIds.value = next;
};

defineExpose({ toggleGridSpan });

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

// Legacy Article.cdmMoveToId(): when a collapsed row expands, scroll it to the
// top if it does not already fit in the viewport.
watch(
  () => props.activeId,
  async (id) => {
    if (!id || !props.combined || props.cdmExpanded) return;
    await nextTick();
    const container = listRef.value;
    const row = container?.querySelector<HTMLElement>(`[data-headline-id="${id}"]`);
    if (!container || !row) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
      container.scrollTop += rowRect.top - containerRect.top;
    }
  }
);

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

/* Pull-to-refresh badge (phone layout only). */
.pull-refresh {
  position: fixed;
  top: 56px;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(var(--v-theme-on-background), 0.15);
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
  color: rgb(var(--v-theme-primary));
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.pull-refresh.ready {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.pull-refresh.spinning {
  color: rgb(var(--v-theme-primary));
}

/* Swipe-to-read: the row follows the finger and the affordance rides in. */
.headlines-list-content > .v-list-item.swiping {
  position: relative;
  overflow: hidden;
}

.headlines-list-content > .v-list-item.swipe-anim {
  transition: transform 0.2s ease, height 0.2s ease, opacity 0.2s ease,
    margin 0.2s ease, padding 0.2s ease;
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

/* Combined rows keep the legacy .cdm/.header shape: the row itself is a
   block, and the controls sit in a single-row header grid. */
.headlines-list-content > .cdm {
  display: block;
  padding: 0;
}

.headlines-list-content > .cdm > .header {
  display: grid;
  grid-template-areas: "left title feed updated right";
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  align-items: center;
  min-height: 32px;
  padding: 1px 8px;
}

.updated-wrap {
  grid-area: updated;
}

.hl-content {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.hl-feed a {
  color: inherit;
  text-decoration: none;
}

.hl-feed a:hover {
  text-decoration: underline;
}

.feed-icon {
  vertical-align: middle;
}

.icon-feed {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
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
  /* Some local plugins (card_view) hide .titleWrap and render the title inside
     .content-inner instead. Their JS does not run in the Vue app, so keep the
     Vue title visible even when that CSS is loaded. */
  opacity: 1 !important;
  visibility: visible;
  font-size: 0.95rem;
  line-height: 1.35;
}

.hl-title-link {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: rgb(var(--v-theme-on-background));
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
}

.hl-title-link:hover {
  text-decoration: underline;
}

/* The legacy theme styles `.hl div.title a` directly; this selector has
   enough specificity to keep read rows visibly muted. */
.headlines-list-content .hl-title .hl-title-link {
  color: rgb(var(--v-theme-on-background));
}

.headlines-list-content .headline-read .hl-title .hl-title-link {
  color: rgba(var(--v-theme-on-background), 0.5);
  font-weight: 400;
}

.headlines-list-content > .v-list-item.headline-read {
  background: rgba(var(--v-theme-on-background), 0.035);
}

.unread-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin: 0 2px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}

.headline-author {
  flex: 0 0 auto;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.8125rem;
  font-weight: 400;
}

.feed-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 8px 4px;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.feed-title .catchup {
  color: rgb(var(--v-theme-primary));
  opacity: 0.7;
}

.feed-title .catchup:hover {
  opacity: 1;
}

.hl-debug {
  color: rgba(var(--v-theme-on-background), 0.35);
  font-family: monospace;
  font-size: 0.6875rem;
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
  /* The title link keeps its content width, so without a floor the preview
     collapses to a few pixels on long titles. */
  min-width: 10ch;
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

.headlines-end {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: calc(100vh - 44px);
  padding: 24px 16px;
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.8125rem;
  text-align: center;
}

.headlines-end a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.headlines-end a:hover {
  text-decoration: underline;
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

  .headlines-list-content > .cdm > .header {
    grid-template-areas: "left title";
    grid-template-columns: auto minmax(0, 1fr);
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
