/**
 * Feeds Store - Pinia store for feed and category management
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../api/client';
import { HOOKS, runPluginHook } from '../utils/pluginHost';
import { syncLegacyCounters, syncLegacyInitParams } from '../utils/legacyPlugins';

export interface Feed {
  id: number;
  title: string;
  unread: number;
  cat_id: number | null;
  feed_url: string;
  site_url: string;
}

export interface Category {
  id: number;
  title: string;
  unread: number;
  parent_id: number | null;
}

export type FeedsByCategoryMap = Map<string, Feed[]>;

/** Titles of the virtual feeds, matching the legacy sidebar. */
const SPECIAL_FEED_TITLES: Record<number, string> = {
  [-4]: 'All articles',
  [-3]: 'Fresh articles',
  [-1]: 'Starred articles',
  [-2]: 'Published articles',
  [0]: 'Archived articles',
  [-6]: 'Recently read',
};

export const useFeedsStore = defineStore('feeds', () => {
  // State
  const feeds = ref<Feed[]>([]);
  const categories = ref<Category[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** null means nothing is selected; 0 is the valid Archived feed. */
  const currentFeedId = ref<number | string | null>(null);
  const currentIsCat = ref(false);
  /** HIDE_READ_FEEDS: hide feeds with no unread articles in the tree. */
  const hideReadFeeds = ref(false);
  /** HIDE_READ_SHOWS_SPECIAL: keep special feeds visible while hiding read. */
  const hideReadShowsSpecial = ref(true);
  /** COMBINED_DISPLAY_MODE: show article content inline instead of a panel. */
  const combinedMode = ref(false);
  /** CDM_ENABLE_GRID: tile the inline articles in a grid on wide screens. */
  const gridEnabled = ref(false);
  /** CDM_EXPANDED: expand every combined-mode row instead of only the active one. */
  const cdmExpanded = ref(true);
  /** WIDESCREEN_MODE: hide the feed tree and let the content use the full width. */
  const wideScreen = ref(false);
  /** SHOW_CONTENT_PREVIEW: show the content preview in headline rows. */
  const showContentPreview = ref(true);
  /** VFEED_GROUP_BY_FEED: insert feed headings in virtual-feed lists. */
  const vfeedGroupByFeed = ref(false);
  /** DEBUG_HEADLINE_IDS: show article/feed ids in the headline row. */
  const debugHeadlineIds = ref(false);
  /** FEEDS_SORT_BY_UNREAD: sort feeds by unread count. */
  const feedsSortByUnread = ref(false);
  /** CONFIRM_FEED_CATCHUP: ask before marking a feed/category read. */
  const confirmFeedCatchup = ref(true);
  /** CDM_AUTO_CATCHUP: mark combined-mode articles read as they scroll past. */
  const cdmAutoCatchup = ref(false);
  /** USER_CSS_THEME currently selected for this user. */
  const currentTheme = ref('');
  /** Theme paths the backend can serve (relative to themes/). */
  const availableThemes = ref<string[]>([]);
  /** Base URL of public.php, from init-params; used for feed icons. */
  const iconsUrl = ref('/public.php');
  /** Unread counters for the virtual ("special") feeds, keyed by feed id. */
  const specialCounters = ref<Record<number, number>>({});
  /** Legacy _DEFAULT_VIEW_MODE from init-params. */
  const defaultViewMode = ref('adaptive');
  /** Legacy _DEFAULT_VIEW_ORDER_BY from init-params. */
  const defaultViewOrderBy = ref('default');
  /** Hotkey prefixes from the backend map (a, c, f, g, plus plugin ones). */
  const hotkeyPrefixes = ref<string[]>([]);
  /** Backend hotkey map, plugin remaps included; sequences without `|`. */
  const hotkeyMap = ref<Record<string, string>>({});
  /** Recent error-log entries, piggybacked on the counters poll. */
  const recentLogEvents = ref(0);
  /** Daemon health, piggybacked on the counters poll. */
  const daemonIsRunning = ref<boolean | null>(null);
  const daemonStampOk = ref<boolean | null>(null);

  // Getters
  const feedsByCategory = computed((): FeedsByCategoryMap => {
    const result = new Map<string, Feed[]>();
    result.set('uncategorized', []);

    for (const feed of feeds.value) {
      if (feed.cat_id != null) {
        const catKey = String(feed.cat_id);
        const existing = result.get(catKey);
        if (existing) {
          existing.push(feed);
        } else {
          result.set(catKey, [feed]);
        }
      } else {
        const uncategorized = result.get('uncategorized');
        if (uncategorized) {
          uncategorized.push(feed);
        }
      }
    }

    return result;
  });

  const totalUnread = computed(() => {
    return feeds.value.reduce((sum, feed) => sum + feed.unread, 0);
  });

  const currentFeed = computed(() => {
    const id = currentFeedId.value;

    if (typeof id !== 'number') return null;

    if (id <= 0) {
      const title = SPECIAL_FEED_TITLES[id];
      if (!title) return null;

      return {
        id,
        title,
        unread: specialCounters.value[id] ?? 0,
        cat_id: null,
        feed_url: '',
        site_url: '',
      };
    }

    if (currentIsCat.value) {
      return categories.value.find(c => c.id === id);
    }
    return feeds.value.find(f => f.id === id);
  });

  // Actions
  async function loadFeeds() {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.getFeedTree();

      if (response.status === 0) {
        feeds.value = response.content.feeds;
        categories.value = response.content.categories;
        specialCounters.value = response.content.special ?? {};

        const runtime = response.content.runtime;
        if (runtime) {
          recentLogEvents.value = runtime.recentLogEvents;
          daemonIsRunning.value = runtime.daemonIsRunning;
          daemonStampOk.value = runtime.daemonStampOk;
        }
      } else {
        error.value = response.error ?? 'Failed to load feeds';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to load feeds:', err);
    } finally {
      loading.value = false;
    }
  }

  function selectFeed(feedId: number | string, isCat: boolean = false) {
    currentFeedId.value = feedId;
    currentIsCat.value = isCat;
  }

  function updateFeedUnread(feedId: number, delta: number) {
    const feed = feeds.value.find(f => f.id === feedId);
    if (feed) {
      feed.unread = Math.max(0, feed.unread + delta);
    }

    // Update category unread (cat_id can be 0 for uncategorized)
    const catId = feed?.cat_id;
    if (catId != null) {
      const cat = categories.value.find(c => c.id === catId);
      if (cat) {
        cat.unread = Math.max(0, cat.unread + delta);
      }
    }
  }

  /** Re-read every counter, e.g. after an article action changed unread state. */
  async function refreshCounters(): Promise<void> {
    try {
      const response = await api.getCounters();

      if (response.status !== 0) return;

      // The Dojo client fed plugin JS a flat list of counters before and after
      // applying them; plugins (favicon badges, for one) still expect that.
      const globalUnread = feeds.value.reduce((total, feed) => total + (feed.unread ?? 0), 0);
      const legacyCounters = [
        { id: 'global-unread', kind: '', counter: globalUnread },
        ...feeds.value.map((feed) => ({
          id: feed.id,
          kind: 'feed',
          counter: feed.unread ?? 0,
          auxcounter: 0,
          markedcounter: 0,
          publishedcounter: 0,
          error: '',
          ts: 0,
          updated: '',
        })),
        ...categories.value.map((category) => ({
          id: category.id,
          kind: 'cat',
          counter: category.unread ?? 0,
        })),
      ];
      runPluginHook(HOOKS.COUNTERS_RECEIVED, legacyCounters);

      specialCounters.value = response.content.special;

      for (const feed of feeds.value) {
        const unread = response.content.feeds[feed.id];
        if (typeof unread === 'number') feed.unread = unread;
      }

      for (const category of categories.value) {
        const unread = response.content.categories[category.id];
        if (typeof unread === 'number') category.unread = unread;
      }

      const runtime = response.content.runtime;
      if (runtime) {
        recentLogEvents.value = runtime.recentLogEvents;
        daemonIsRunning.value = runtime.daemonIsRunning;
        daemonStampOk.value = runtime.daemonStampOk;
      }

      syncLegacyCounters(
        Object.fromEntries(feeds.value.map((feed) => [feed.id, feed.unread ?? 0])),
        globalUnread
      );
      runPluginHook(HOOKS.COUNTERS_PROCESSED, legacyCounters);
    } catch (err) {
      console.error('Failed to refresh counters:', err);
    }
  }

  function updateCategoryUnread(catId: number, delta: number) {
    const cat = categories.value.find(c => c.id === catId);
    if (cat) {
      cat.unread = Math.max(0, cat.unread + delta);
    }
  }

  function reset() {
    feeds.value = [];
    categories.value = [];
    currentFeedId.value = null;
    currentIsCat.value = false;
    specialCounters.value = {};
    error.value = null;
  }

  // ============================================
  // Feed & category management (Phase 3)
  // ============================================

  /**
   * Subscribe to a feed URL. The backend follows a page's `link rel=alternate`
   * and subscribes by itself when exactly one feed is advertised; when several
   * are, nothing is added and `feeds` lists them for the caller to choose from.
   */
  async function addFeed(
    feedUrl: string,
    categoryId?: number
  ): Promise<{ ok: boolean; feeds: Array<{ url: string; title: string }> }> {
    try {
      // Feeds/add does not accept a custom title; the feed keeps its own title.
      const response = await api.addFeed(feedUrl, categoryId ?? 0);
      if (response.status === 0) {
        if (response.content.feeds.length > 0) {
          return { ok: false, feeds: response.content.feeds };
        }
        await loadFeeds();
        return { ok: true, feeds: [] };
      }
      error.value = response.error ?? 'Failed to add feed';
      return { ok: false, feeds: [] };
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to add feed';
      return { ok: false, feeds: [] };
    }
  }

  async function removeFeed(feedId: number): Promise<boolean> {
    try {
      const response = await api.deleteFeed(feedId);
      if (response.status === 0) {
        feeds.value = feeds.value.filter(f => f.id !== feedId);
        if (currentFeedId.value === feedId && !currentIsCat.value) {
          currentFeedId.value = null;
        }
        return true;
      }
      error.value = response.error ?? 'Failed to delete feed';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete feed';
      return false;
    }
  }

  /** Load a single feed's editable settings. */
  async function loadFeedDetails(feedId: number) {
    try {
      const response = await api.getFeedDetails(feedId);
      return response.status === 0 ? response.content : null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load feed';
      return null;
    }
  }

  /** Persist changes to a feed's settings, then refresh the tree. */
  async function saveFeed(
    feedId: number,
    changes: Partial<Omit<import('../api/legacyEndpoints').FeedDetails, 'id'>>
  ): Promise<boolean> {
    try {
      const response = await api.saveFeed(feedId, changes);
      if (response.status === 0) {
        await loadFeeds();
        return true;
      }
      error.value = response.error ?? 'Failed to save feed';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save feed';
      return false;
    }
  }

  async function purgeFeed(): Promise<boolean> {
    try {
      // Purging is a scheduled/CLI operation; there is no backend.php method.
      const response = await api.purgeFeed();
      return response.status === 0;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to purge feed';
      return false;
    }
  }

  async function createCategory(title: string): Promise<boolean> {
    try {
      const response = await api.createCategory(title);
      if (response.status === 0) {
        await loadFeeds();
        return true;
      }
      error.value = response.error ?? 'Failed to create category';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create category';
      return false;
    }
  }

  async function deleteCategory(categoryId: number): Promise<boolean> {
    try {
      const response = await api.deleteCategory(categoryId);
      if (response.status === 0) {
        categories.value = categories.value.filter(c => c.id !== categoryId);
        if (currentFeedId.value === categoryId && currentIsCat.value) {
          currentFeedId.value = null;
          currentIsCat.value = false;
        }
        return true;
      }
      error.value = response.error ?? 'Failed to delete category';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete category';
      return false;
    }
  }

  async function renameCategory(categoryId: number, title: string): Promise<boolean> {
    try {
      const response = await api.renameCategory(categoryId, title);
      if (response.status === 0) {
        const cat = categories.value.find(c => c.id === categoryId);
        if (cat) cat.title = title;
        return true;
      }
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to rename category';
      return false;
    }
  }

  /**
   * Mark everything in a feed/category as read.
   *
   * `mode` mirrors the legacy "Mark as read" dropdown: 'all' (default) or a
   * time window ('1day'/'1week'/'2week') that only marks older articles.
   */
  async function catchupFeed(
    feedId: number | string,
    isCat: boolean = false,
    mode: string = 'all'
  ): Promise<boolean> {
    try {
      const response = await api.catchupFeed(feedId, isCat, mode);
      if (response.status === 0) {
        // Optimistically clear unread counters
        if (isCat) {
          const cat = categories.value.find(c => c.id === feedId);
          if (cat) cat.unread = 0;
        } else {
          const feed = feeds.value.find(f => f.id === feedId);
          if (feed) feed.unread = 0;
        }
        return true;
      }
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to mark feed as read';
      return false;
    }
  }

  /**
   * Persist the current feed/category order and category membership.
   *
   * The tree is sent to `Pref_Feeds/savefeedorder`; on success the server order
   * is authoritative, so the feed list is reloaded.
   */
  async function saveOrder(): Promise<boolean> {
    try {
      const response = await api.saveFeedOrder(categories.value, feeds.value);
      if (response.status === 0) {
        await loadFeeds();
        return true;
      }
      error.value = response.error ?? 'Failed to save feed order';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save feed order';
      return false;
    }
  }

  /** Toggle the HIDE_READ_FEEDS preference and persist it. */
  async function toggleHideRead(): Promise<boolean> {
    const next = !hideReadFeeds.value;
    try {
      const response = await api.setPref('HIDE_READ_FEEDS', next ? '1' : '0');
      if (response.status === 0) {
        hideReadFeeds.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /** Read the display preferences the tree needs from RPC/sanityCheck. */
  async function loadDisplayPrefs(): Promise<void> {
    try {
      const response = await api.getInitParams();
      if (response.status !== 0) return;
      const params = response.content;

      // Plugins read the same init-params through App.getInitParam() and the
      // HOOK_PARAMS_LOADED hook.
      syncLegacyInitParams(params as Record<string, unknown>);
      runPluginHook(HOOKS.PARAMS_LOADED, params);

      hideReadFeeds.value = Number(params.hide_read_feeds) === 1;
      hideReadShowsSpecial.value = Number(params.hide_read_shows_special) === 1;
      combinedMode.value = Number(params.combined_display_mode) === 1;
      gridEnabled.value = Number(params.cdm_enable_grid) === 1;
      cdmExpanded.value =
        params.cdm_expanded === undefined ||
        params.cdm_expanded === '' ||
        Number(params.cdm_expanded) !== 0;
      wideScreen.value = Number(params.widescreen) === 1;
      showContentPreview.value = Number(params.show_content_preview) !== 0;
      vfeedGroupByFeed.value = Number(params.vfeed_group_by_feed) === 1;
      debugHeadlineIds.value = Number(params.debug_headline_ids) === 1;
      feedsSortByUnread.value = Number(params.feeds_sort_by_unread) === 1;
      if (typeof params.default_view_mode === 'string' && params.default_view_mode !== '') {
        defaultViewMode.value = params.default_view_mode;
      }
      if (typeof params.default_view_order_by === 'string' && params.default_view_order_by !== '') {
        defaultViewOrderBy.value = params.default_view_order_by;
      }
      confirmFeedCatchup.value = Number(params.confirm_feed_catchup) !== 0;
      cdmAutoCatchup.value = Number(params.cdm_auto_catchup) === 1;
      currentTheme.value = typeof params.theme === 'string' ? params.theme : '';
      availableThemes.value = Array.isArray(params.available_themes)
        ? params.available_themes.filter((theme): theme is string => typeof theme === 'string')
        : [];
      // public.php streams a feed's icon; the backend tells us the base URL so
      // the app works behind a sub-path install.
      if (typeof params.icons_url === 'string' && params.icons_url !== '') {
        iconsUrl.value = params.icons_url;
      }

      // `hotkeys` is [prefixes, map]; the map is plugin-merged. Drop the
      // "|mnemonic" suffix the help panel uses so lookup can compare sequences.
      const hotkeys = params.hotkeys;
      if (Array.isArray(hotkeys) && hotkeys.length === 2 && Array.isArray(hotkeys[0])) {
        hotkeyPrefixes.value = hotkeys[0].map((prefix) => String(prefix));
        const rawMap = hotkeys[1];
        if (typeof rawMap === 'object' && rawMap !== null) {
          const normalized: Record<string, string> = {};
          for (const [sequence, action] of Object.entries(rawMap as Record<string, unknown>)) {
            normalized[sequence.replace(/\|.*$/, '')] = String(action);
          }
          hotkeyMap.value = normalized;
        }
      }
    } catch (err) {
      console.error('Failed to load display preferences:', err);
    }
  }

  /** Toggle COMBINED_DISPLAY_MODE (inline article content) and persist it. */
  async function toggleCombinedMode(): Promise<boolean> {
    const next = !combinedMode.value;
    try {
      const response = await api.setPref('COMBINED_DISPLAY_MODE', next ? '1' : '0');
      if (response.status === 0) {
        combinedMode.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /** Toggle CDM_EXPANDED (expand all combined rows vs. only the active one). */
  async function toggleCdmExpanded(): Promise<boolean> {
    const next = !cdmExpanded.value;
    try {
      const response = await api.setPref('CDM_EXPANDED', next ? '1' : '0');
      if (response.status === 0) {
        cdmExpanded.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /** Toggle WIDESCREEN_MODE and persist it. */
  async function toggleWideScreen(): Promise<boolean> {
    const next = !wideScreen.value;
    try {
      const response = await api.setPref('WIDESCREEN_MODE', next ? '1' : '0');
      if (response.status === 0) {
        wideScreen.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /**
   * Move a feed one position up/down within its category group, then persist.
   *
   * `delta` is -1 or 1. The move is bounded to the feed's own category so it
   * cannot be dragged across categories by accident.
   */
  async function moveFeed(feedId: number, delta: -1 | 1): Promise<boolean> {
    const feed = feeds.value.find(f => f.id === feedId);
    if (!feed) return false;

    const group = feeds.value.filter(f => (f.cat_id ?? null) === (feed.cat_id ?? null));
    const groupIndex = group.findIndex(f => f.id === feedId);
    const target = groupIndex + delta;
    if (target < 0 || target >= group.length) return false;

    // Indices into the full feeds array, so the swap works in place.
    const from = feeds.value.indexOf(feed);
    const to = feeds.value.indexOf(group[target]);
    const [moved] = feeds.value.splice(from, 1);
    feeds.value.splice(to, 0, moved);

    return saveOrder();
  }

  /** Sidebar order: special feeds, categories, then feeds. */
  function navigationEntries(): Array<{ id: number; isCat: boolean; unread: number }> {
    const entries: Array<{ id: number; isCat: boolean; unread: number }> = [];
    for (const id of [-4, -3, -1, -2, 0, -6]) {
      entries.push({ id, isCat: false, unread: specialCounters.value[id] ?? 0 });
    }
    for (const category of categories.value) {
      entries.push({ id: category.id, isCat: true, unread: category.unread ?? 0 });
    }
    for (const feed of feeds.value) {
      entries.push({ id: feed.id, isCat: false, unread: feed.unread ?? 0 });
    }
    return entries;
  }

  /** Next/previous feed or category in sidebar order, wrapping around. */
  function nextFeed(direction: 1 | -1 = 1): { id: number; isCat: boolean } | null {
    const entries = navigationEntries();
    if (entries.length === 0) return null;
    const currentIndex = entries.findIndex(
      entry => entry.id === currentFeedId.value && entry.isCat === currentIsCat.value
    );
    const start = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    for (let step = 1; step <= entries.length; step++) {
      const entry = entries[(start + direction * step + entries.length * 2) % entries.length];
      if (!(entry.id === currentFeedId.value && entry.isCat === currentIsCat.value)) {
        return { id: entry.id, isCat: entry.isCat };
      }
    }
    return null;
  }

  /** Next feed/category with unread articles in the requested direction. */
  function nextUnreadFeed(direction: 1 | -1 = 1): { id: number; isCat: boolean } | null {
    const entries = navigationEntries();
    if (entries.length === 0) return null;
    const currentIndex = entries.findIndex(
      entry => entry.id === currentFeedId.value && entry.isCat === currentIsCat.value
    );
    const start = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    for (let step = 1; step <= entries.length; step++) {
      const entry = entries[(start + direction * step + entries.length * 2) % entries.length];
      if (
        entry.unread > 0 &&
        !(entry.id === currentFeedId.value && entry.isCat === currentIsCat.value)
      ) {
        return { id: entry.id, isCat: entry.isCat };
      }
    }
    return null;
  }

  /** Toggle VFEED_GROUP_BY_FEED and persist it. */
  async function toggleVfeedGroup(): Promise<boolean> {
    const next = !vfeedGroupByFeed.value;
    try {
      const response = await api.setPref('VFEED_GROUP_BY_FEED', next ? '1' : '0');
      if (response.status === 0) {
        vfeedGroupByFeed.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /** Toggle CDM_ENABLE_GRID and persist it. */
  async function toggleGrid(): Promise<boolean> {
    const next = !gridEnabled.value;
    try {
      const response = await api.setPref('CDM_ENABLE_GRID', next ? '1' : '0');
      if (response.status === 0) {
        gridEnabled.value = next;
        return true;
      }
      error.value = response.error ?? 'Failed to save preference';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to save preference';
      return false;
    }
  }

  /** Move a feed next to another feed in the same category, then persist. */
  async function moveFeedTo(feedId: number, targetFeedId: number): Promise<boolean> {
    if (feedId === targetFeedId) return false;

    const feed = feeds.value.find(f => f.id === feedId);
    const target = feeds.value.find(f => f.id === targetFeedId);
    if (!feed || !target) return false;
    if ((feed.cat_id ?? null) !== (target.cat_id ?? null)) return false;

    const from = feeds.value.indexOf(feed);
    const to = feeds.value.indexOf(target);
    feeds.value.splice(from, 1);
    feeds.value.splice(to, 0, feed);
    return saveOrder();
  }

  /** Move a category one position up/down, then persist. */
  async function moveCategory(categoryId: number, delta: -1 | 1): Promise<boolean> {
    const index = categories.value.findIndex(c => c.id === categoryId);
    if (index === -1) return false;
    const target = index + delta;
    if (target < 0 || target >= categories.value.length) return false;

    const [moved] = categories.value.splice(index, 1);
    categories.value.splice(target, 0, moved);

    return saveOrder();
  }

  return {
    // State
    feeds,
    categories,
    loading,
    error,
    currentFeedId,
    currentIsCat,
    hideReadFeeds,
    hideReadShowsSpecial,
    combinedMode,
    gridEnabled,
    cdmExpanded,
    wideScreen,
    showContentPreview,
    vfeedGroupByFeed,
    debugHeadlineIds,
    feedsSortByUnread,
    confirmFeedCatchup,
    cdmAutoCatchup,
    currentTheme,
    availableThemes,
    iconsUrl,
    specialCounters,
    defaultViewMode,
    defaultViewOrderBy,
    hotkeyPrefixes,
    hotkeyMap,
    recentLogEvents,
    daemonIsRunning,
    daemonStampOk,

    // Getters
    feedsByCategory,
    totalUnread,
    currentFeed,

    // Actions
    loadFeeds,
    selectFeed,
    updateFeedUnread,
    updateCategoryUnread,
    refreshCounters,
    addFeed,
    loadFeedDetails,
    saveFeed,
    removeFeed,
    purgeFeed,
    createCategory,
    deleteCategory,
    renameCategory,
    catchupFeed,
    saveOrder,
    moveFeed,
    moveFeedTo,
    nextFeed,
    nextUnreadFeed,
    toggleVfeedGroup,
    toggleGrid,
    moveCategory,
    toggleCdmExpanded,
    toggleWideScreen,
    toggleHideRead,
    toggleCombinedMode,
    loadDisplayPrefs,
    reset,
  };
});
