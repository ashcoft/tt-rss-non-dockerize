<template>
  <div class="feed-tree">
    <v-text-field
      v-model="searchQuery"
      placeholder="Search feeds..."
      prepend-inner-icon="mdi-magnify"
      variant="underlined"
      density="compact"
      hide-details
      class="search-input"
    />

    <v-list v-model:opened="openedGroups" nav density="compact" class="feed-list">
      <!-- Special Feeds -->
      <v-list-group value="special">
        <template #activator="{ props }">
          <v-list-item v-bind="props" title="Special">
            <template #prepend>
              <v-icon>{{ groupIcon('special') }}</v-icon>
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
          <!-- Clicking the category row selects it (is_cat=1); the group toggle
               is handled by v-list-group's own activator binding. -->
          <v-list-item
            v-bind="props"
            :title="category.title"
            @click="handleSelect('cat-' + category.id)"
          >
            <template #prepend>
              <v-icon>{{ groupIcon('cat-' + category.id) }}</v-icon>
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
              <v-btn
                icon="mdi-chevron-up"
                size="x-small"
                variant="text"
                title="Move category up"
                @click.stop="emit('reorder', 'category', category.id, -1)"
              />
              <v-btn
                icon="mdi-chevron-down"
                size="x-small"
                variant="text"
                title="Move category down"
                @click.stop="emit('reorder', 'category', category.id, 1)"
              />
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
          <template #prepend>
            <img
              v-if="!iconFailed.has(feed.id)"
              :src="feedIconUrl(feed.id)"
              class="feed-icon"
              width="16"
              height="16"
              alt=""
              @error="iconFailed.add(feed.id)"
            />
            <v-icon v-else size="16">mdi-rss</v-icon>
          </template>
          <template #append>
            <v-chip
              v-if="feed.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ feed.unread }}
            </v-chip>
            <v-btn
              icon="mdi-check"
              size="x-small"
              variant="text"
              title="Mark feed as read"
              @click.stop="emit('feed-action', 'mark_read', feed.id)"
            />
            <v-btn
              icon="mdi-pencil"
              size="x-small"
              variant="text"
              title="Edit feed"
              @click.stop="emit('feed-action', 'edit', feed.id)"
            />
            <v-btn
              icon="mdi-chevron-up"
              size="x-small"
              variant="text"
              title="Move feed up"
              @click.stop="emit('reorder', 'feed', feed.id, -1)"
            />
            <v-btn
              icon="mdi-chevron-down"
              size="x-small"
              variant="text"
              title="Move feed down"
              @click.stop="emit('reorder', 'feed', feed.id, 1)"
            />
          </template>
        </v-list-item>
      </v-list-group>

      <!-- Uncategorized Feeds -->
      <v-list-group value="uncategorized" v-if="filteredUncategorizedFeeds.length > 0">
        <template #activator="{ props }">
          <v-list-item v-bind="props" title="Uncategorized">
            <template #prepend>
              <v-icon>{{ groupIcon('uncategorized') }}</v-icon>
            </template>
            <template #append>
              <v-chip
                v-if="uncategorizedUnread > 0"
                size="x-small"
                color="primary"
                variant="flat"
              >
                {{ uncategorizedUnread }}
              </v-chip>
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
          <template #prepend>
            <img
              v-if="!iconFailed.has(feed.id)"
              :src="feedIconUrl(feed.id)"
              class="feed-icon"
              width="16"
              height="16"
              alt=""
              @error="iconFailed.add(feed.id)"
            />
            <v-icon v-else size="16">mdi-rss</v-icon>
          </template>
          <template #append>
            <v-chip
              v-if="feed.unread > 0"
              size="x-small"
              color="primary"
              variant="flat"
            >
              {{ feed.unread }}
            </v-chip>
            <v-btn
              icon="mdi-chevron-up"
              size="x-small"
              variant="text"
              title="Move feed up"
              @click.stop="emit('reorder', 'feed', feed.id, -1)"
            />
            <v-btn
              icon="mdi-chevron-down"
              size="x-small"
              variant="text"
              title="Move feed down"
              @click.stop="emit('reorder', 'feed', feed.id, 1)"
            />
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
  /** Hide feeds with no unread articles (HIDE_READ_FEEDS). */
  hideRead?: boolean;
  /** Currently selected feed, kept visible while hiding read feeds. */
  activeFeedId?: number | string | null;
  /** Base URL of public.php, which streams each feed's icon. */
  iconsUrl?: string;
  /** Unread counters for the virtual feeds, keyed by feed id. */
  specialCounters?: Record<number, number>;
  /** HIDE_READ_SHOWS_SPECIAL: keep virtual feeds visible while hiding read ones. */
  hideReadShowsSpecial?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  labels: () => [],
  hideRead: false,
  activeFeedId: null,
  iconsUrl: '/public.php',
  specialCounters: () => ({}),
  hideReadShowsSpecial: true
});

const emit = defineEmits<{
  (e: 'select', feedId: number | string, isCat: boolean): void;
  (e: 'feed-action', action: string, feedId: number): void;
  (e: 'reorder', kind: 'feed' | 'category', id: number, delta: -1 | 1): void;
}>();

// Matches LABEL_BASE_INDEX in include/functions.php. Feed ids below it are
// labels; a label's feed id is LABEL_BASE_INDEX - 1 - labelId.
const LABEL_BASE_INDEX = -1024;

// State
const searchQuery = ref('');
// The virtual feed group starts expanded, like the legacy tree.
const openedGroups = ref<string[]>(['special']);
// Feeds whose icon 404s fall back to the RSS glyph; tracked per feed so one
// broken icon does not hide the rest.
const iconFailed = ref(new Set<number>());

/** URL that streams a feed's cached icon (public.php?op=feed_icon). */
const feedIconUrl = (feedId: number): string =>
  `${props.iconsUrl}?op=feed_icon&id=${feedId}`;

// Special feeds (built-in). IDs mirror the Feeds::FEED_* constants in
// classes/Feeds.php and must not be renumbered. Order and icons match the
// legacy sidebar.
const SPECIAL_FEEDS = [
  { id: -4, name: 'All articles', icon: 'mdi-inbox' },
  { id: -3, name: 'Fresh articles', icon: 'mdi-whatshot' },
  { id: -1, name: 'Starred articles', icon: 'mdi-star' },
  { id: -2, name: 'Published articles', icon: 'mdi-rss' },
  { id: 0, name: 'Archived articles', icon: 'mdi-archive' },
  { id: -6, name: 'Recently read', icon: 'mdi-restore' },
];

/**
 * Special feeds with their unread counters. HIDE_READ_FEEDS hides empty
 * virtual feeds unless HIDE_READ_SHOWS_SPECIAL keeps them visible; the active
 * one always stays so the selection is not lost.
 */
const specialFeeds = computed(() => {
  return SPECIAL_FEEDS.map(feed => ({
    ...feed,
    unread: props.specialCounters[feed.id] ?? 0,
  })).filter(feed => {
    if (!props.hideRead || props.hideReadShowsSpecial) return true;
    return feed.unread > 0 || feed.id === props.activeFeedId;
  });
});

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
 * Whether a feed should appear given HIDE_READ_FEEDS. A feed with unread
 * articles always shows; the active feed stays visible so hiding read feeds
 * does not deselect what the user is reading.
 */
const visible = (feed: Feed): boolean => {
  if (!props.hideRead) return true;
  return (feed.unread ?? 0) > 0 || feed.id === props.activeFeedId;
};

/** +/- toggle glyph for an expandable group, matching the legacy tree. */
const groupIcon = (value: string): string =>
  openedGroups.value.includes(value) ? 'mdi-minus' : 'mdi-plus';

/** Unread articles across all uncategorized feeds, shown on the group row. */
const uncategorizedUnread = computed(() =>
  props.feeds.filter(feed => !feed.cat_id).reduce((sum, feed) => sum + (feed.unread ?? 0), 0)
);

/**
 * Computes the list of uncategorized feeds filtered by the current search query.
 * @returns The filtered array of uncategorized feeds.
 */
const filteredUncategorizedFeeds = computed(() => {
  const feeds = props.feeds.filter(f => !f.cat_id && visible(f));
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
  const feeds = props.feeds.filter(f => f.cat_id === categoryId && visible(f));
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
    // Labels are selected through a synthetic negative feed id: the backend
    // (Feeds::view) treats feed ids below LABEL_BASE_INDEX (-1024) as labels.
    // The label tree reports the raw positive id, so derive the feed id the
    // same way Labels::label_to_feed_id() does: LABEL_BASE_INDEX - 1 - id.
    const labelId = Number.parseInt(index.replace('label-', ''));
    emit('select', LABEL_BASE_INDEX - 1 - Math.abs(labelId), false);
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
  flex: 0 0 auto;
  padding: 0.5rem;
}

.feed-list {
  flex: 1;
  overflow-y: auto;
  background: transparent;
}

.feed-list :deep(.v-list-item--active) {
  background: rgba(0, 0, 0, 0.06);
  color: rgb(var(--v-theme-on-background));
}

/* The +/- prepend glyph replaces Vuetify's chevron, as in the legacy tree. */
.feed-list :deep(.v-list-group__header > .v-list-item__append > .v-icon) {
  display: none;
}

/* Row actions appear on hover, like the legacy tree icons. */
.feed-list :deep(.v-btn) {
  opacity: 0;
  transition: opacity 0.15s;
}

.feed-list :deep(.v-list-item:hover .v-btn),
.feed-list :deep(.v-list-item:focus-within .v-btn),
.feed-list :deep(.v-list-item--active .v-btn) {
  opacity: 1;
}

.label-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 0.5rem;
}

.feed-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}
</style>
