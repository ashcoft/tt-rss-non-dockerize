<template>
  <v-app>
    <!-- Login gate (Phase 3) -->
    <LoginForm v-if="!authStore.loggedIn" @logged-in="onLoggedIn" />

    <div v-else class="ttrss-app" :class="{ 'wide-screen': feedsStore.wideScreen }">
      <div v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false" />
      <aside class="sidebar" :class="{ open: sidebarOpen }" :style="sidebarStyle">
        <PluginSurface v-if="pluginFeedTreeHtml" :html="pluginFeedTreeHtml" class="plugin-feed-tree" />
        <FeedTree
          :feeds="feedsStore.feeds"
          :categories="feedsStore.categories"
          :labels="labelsStore.labels"
          :hide-read="feedsStore.hideReadFeeds"
          :active-feed-id="feedsStore.currentFeedId"
          :icons-url="feedsStore.iconsUrl"
          :special-counters="feedsStore.specialCounters"
          :hide-read-shows-special="feedsStore.hideReadShowsSpecial"
          :sort-by-unread="feedsStore.feedsSortByUnread"
          @select="handleFeedSelect"
          @feed-action="handleFeedAction"
          @reorder="handleFeedReorder"
          @move-feed="handleFeedMove"
          @category-action="handleCategoryAction"
        />
      </aside>
      <div class="sidebar-splitter" title="Resize feed tree" @pointerdown="startSidebarResize" />

      <div class="app-content">
        <header class="app-header">
          <v-btn icon="mdi-menu" class="nav-toggle" variant="text" @click="sidebarOpen = !sidebarOpen" title="Toggle sidebar" />
          <Toolbar
            :feed-info="feedsStore.currentFeed"
            :feed-error="headlinesStore.feedError"
            :model-view-mode="headlinesStore.viewMode"
            :model-order-by="headlinesStore.orderBy"
            :plugin-main-html="pluginMainHtml"
            :plugin-toolbar-html="pluginToolbarHtml"
            :plugin-action-html="pluginActionHtml"
            :custom-sort-map="pluginCustomSortMap"
            :update-url="updateUrl"
            :plugin-updates="pluginUpdatesAvailable"
            :cdm-expanded="feedsStore.cdmExpanded"
            :wide-screen="feedsStore.wideScreen"
            @action="handleToolbarAction"
          />
        </header>

        <section class="content">
          <v-alert
            v-if="headlinesStore.notice && headlinesStore.headlines.length === 0"
            type="info"
            variant="tonal"
            density="compact"
            class="mx-2"
          >
            {{ headlinesStore.notice }}
          </v-alert>

          <v-alert
            v-if="headlinesStore.error || feedsStore.error"
            type="error"
            variant="tonal"
            density="compact"
            closable
            class="mx-2"
            @click:close="clearErrors"
          >
            {{ headlinesStore.error || feedsStore.error }}
          </v-alert>

          <HeadlinesList
            :headlines="headlinesStore.headlines"
            :loading="headlinesStore.loading"
            :loading-more="headlinesStore.loadingMore"
            :has-more="headlinesStore.hasMore"
            :active-id="headlinesStore.cursorId"
            :combined="feedsStore.combinedMode"
            :grid="feedsStore.gridEnabled"
            :show-preview="feedsStore.showContentPreview"
            :group-by-feed="feedsStore.vfeedGroupByFeed"
            :debug-ids="feedsStore.debugHeadlineIds"
            :selected-ids="headlinesStore.selectedHeadlineIds"
            :cdm-expanded="feedsStore.cdmExpanded"
            :auto-catchup="feedsStore.cdmAutoCatchup"
            :feed-site-url="headlinesStore.feedSiteUrl"
            @toggle-select="headlinesStore.toggleHeadlineSelected"
            @auto-catchup="handleAutoCatchup"
            @select="handleHeadlineSelect"
            @action="handleHeadlineAction"
            @load-more="handleLoadMore"
            @bulk-action="handleBulkAction"
            @next-unread="handleNextUnread"
          />
        </section>

        <!-- In combined mode the content is inline in the list, so no panel. -->
        <div
          v-if="headlinesStore.selectedArticle && !feedsStore.combinedMode"
          class="article-splitter"
          title="Resize article pane"
          @pointerdown="startArticleResize"
        />
        <aside
          class="article-panel"
          :style="articleStyle"
          v-if="headlinesStore.selectedArticle && !feedsStore.combinedMode"
        >
          <ArticleView
            :article="headlinesStore.selectedArticle"
            :feed-site-url="headlinesStore.feedSiteUrl"
            @close="handleArticleClose"
            @mark-relative="handleMarkRelative"
          />
        </aside>
      </div>
    </div>

    <!-- Dialogs (Phase 3/4) -->
    <ManageFeedsDialog v-model="feedsDialogOpen" />
    <LabelsDialog v-model="labelsDialogOpen" :article-id="labelArticleId" />
    <PreferencesDialog v-model="prefsOpen" />
    <HotkeyHelpDialog v-model="hotkeyHelpOpen" />

    <!-- Legacy "Search..." dialog: the toolbar has no permanent search box. -->
    <v-dialog v-model="searchDialogOpen" max-width="520">
      <v-card>
        <v-card-title>Search articles</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="searchDraft"
            placeholder="Search articles..."
            autofocus
            hide-details
            @keyup.enter="submitSearch"
          />
          <v-select
            v-if="searchLanguages.length > 1"
            v-model="searchLanguageDraft"
            :items="searchLanguages"
            label="Language"
            title="Used for word stemming"
            density="compact"
            hide-details
            class="mt-3"
          />
          <a
            v-if="showSearchSyntaxHelp"
            class="search-syntax-link"
            href="https://tt-rss.org/wiki/SearchSyntax"
            target="_blank"
            rel="noopener noreferrer"
          >Search syntax help</a>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="searchDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="submitSearch">Search</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Legacy "Search feeds..." dialog. -->
    <v-dialog v-model="feedSearchOpen" max-width="520">
      <v-card>
        <v-card-title>Search feeds</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="feedSearchDraft"
            placeholder="Search feeds..."
            autofocus
            hide-details
          />
          <v-list class="mt-2 overflow-y-auto" density="compact" max-height="360">
            <v-list-item
              v-for="item in feedSearchResults"
              :key="`${item.isCat ? 'cat' : 'feed'}-${item.id}`"
              @click="selectFeedSearchResult(item)"
            >
              <v-list-item-title>{{ item.title }}</v-list-item-title>
              <template #append>
                <span class="feed-search-counter">{{ item.unread }}</span>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-snackbar
      v-model="snackbar"
      :color="snackbarColor"
      :timeout="3000"
    >
      {{ snackbarText }}
      <template #actions>
        <v-btn variant="text" @click="snackbar = false">Close</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>


<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTheme } from 'vuetify';
import api from './api/client';
import { useFeedsStore, useHeadlinesStore, useAuthStore, useLabelsStore, type Headline } from './stores';
import FeedTree from './components/FeedTree.vue';
import Toolbar from './components/Toolbar.vue';
import HeadlinesList from './components/HeadlinesList.vue';
import ArticleView from './components/ArticleView.vue';
import LoginForm from './components/LoginForm.vue';
import ManageFeedsDialog from './components/dialogs/ManageFeedsDialog.vue';
import LabelsDialog from './components/dialogs/LabelsDialog.vue';
import PreferencesDialog from './components/dialogs/PreferencesDialog.vue';
import HotkeyHelpDialog from './components/dialogs/HotkeyHelpDialog.vue';
import { useKeyboard } from './composables/useKeyboard';
import { runDetached } from './utils/runDetached';
import { FEED_ALL, FEED_FRESH } from './api/legacyEndpoints';

const feedsStore = useFeedsStore();
const headlinesStore = useHeadlinesStore();
const authStore = useAuthStore();
const labelsStore = useLabelsStore();
const theme = useTheme();

// UI State
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<'success' | 'error' | 'info' | 'warning'>('info');
const sidebarOpen = ref(false);
const feedsDialogOpen = ref(false);
const labelsDialogOpen = ref(false);
// prefs.php serves this shell with __open_preferences=true so the dialog opens
// on mount.
const prefsOpen = ref(
  typeof window !== 'undefined' &&
    (window as unknown as { __open_preferences?: boolean }).__open_preferences === true
);
const hotkeyHelpOpen = ref(false);
const searchDialogOpen = ref(false);
const searchDraft = ref('');
const searchLanguageDraft = ref(headlinesStore.searchLanguage);
const feedSearchOpen = ref(false);
const feedSearchDraft = ref('');

// Splitter sizes are persisted locally, mirroring the legacy draggable panes.
const SIDEBAR_WIDTH_KEY = 'ttrss.sidebarWidth';
const ARTICLE_HEIGHT_KEY = 'ttrss.articleHeight';
const sidebarWidth = ref(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 0);
const articleHeight = ref(Number(localStorage.getItem(ARTICLE_HEIGHT_KEY)) || 0);
const sidebarStyle = computed(() =>
  sidebarWidth.value > 0
    ? { flexBasis: `${sidebarWidth.value}px`, width: `${sidebarWidth.value}px` }
    : {}
);
const articleStyle = computed(() =>
  articleHeight.value > 0 ? { flexBasis: `${articleHeight.value}px` } : {}
);

const startSidebarResize = (event: PointerEvent) => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth =
    sidebarWidth.value ||
    document.querySelector<HTMLElement>('.sidebar')?.getBoundingClientRect().width ||
    300;
  const onMove = (moveEvent: PointerEvent) => {
    const width = Math.min(
      Math.max(startWidth + moveEvent.clientX - startX, 200),
      Math.min(window.innerWidth * 0.5, 600)
    );
    sidebarWidth.value = Math.round(width);
  };
  const onUp = () => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
};

const startArticleResize = (event: PointerEvent) => {
  event.preventDefault();
  const startY = event.clientY;
  const startHeight =
    articleHeight.value ||
    document.querySelector<HTMLElement>('.article-panel')?.getBoundingClientRect().height ||
    400;
  const onMove = (moveEvent: PointerEvent) => {
    const height = Math.min(
      Math.max(startHeight - (moveEvent.clientY - startY), 150),
      window.innerHeight - 150
    );
    articleHeight.value = Math.round(height);
  };
  const onUp = () => {
    localStorage.setItem(ARTICLE_HEIGHT_KEY, String(articleHeight.value));
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
};
const labelArticleId = ref<number | null>(null);

/** Feed/category matches for the "Search feeds..." dialog. */
const feedSearchResults = computed(() => {
  const query = feedSearchDraft.value.trim().toLowerCase();
  const specialFeeds = [
    { id: -4, title: 'All articles' },
    { id: -3, title: 'Fresh articles' },
    { id: -1, title: 'Starred articles' },
    { id: -2, title: 'Published articles' },
    { id: 0, title: 'Archived articles' },
    { id: -6, title: 'Recently read' },
  ].map(feed => ({
    ...feed,
    unread: feedsStore.specialCounters[feed.id] ?? 0,
    isCat: false,
  }));
  const items = [
    ...specialFeeds,
    ...feedsStore.categories.map(cat => ({ id: cat.id, title: cat.title, unread: cat.unread ?? 0, isCat: true })),
    ...feedsStore.feeds.map(feed => ({ id: feed.id, title: feed.title, unread: feed.unread ?? 0, isCat: false })),
  ];
  return query ? items.filter(item => item.title.toLowerCase().includes(query)) : items;
});
const searchLanguages = ref<string[]>([]);
const showSearchSyntaxHelp = ref(true);
const pluginMainHtml = ref('');
const pluginToolbarHtml = ref('');
const pluginFeedTreeHtml = ref('');
const pluginActionHtml = ref('');
const pluginCustomSortMap = ref<Record<string, string>>({});
const updateUrl = ref('');
const pluginUpdatesAvailable = ref(false);

// Auto-refresh polling (Phase 5)
const POLL_INTERVAL_MS = 5 * 60 * 1000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const showMessage = (text: string, color: 'success' | 'error' | 'info' | 'warning' = 'info') => {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
};

const clearErrors = () => {
  headlinesStore.error = null;
  feedsStore.error = null;
};

// Theme toggle (Phase 5: light/dark support)
let themeChosenByUser = false;

const toggleTheme = () => {
  themeChosenByUser = true;
  theme.global.name.value = theme.global.current.value.dark ? 'feedly' : 'feedlyNight';
};

/** Match the Vuetify palette to a night/light USER_CSS_THEME. */
const applyThemePalette = () => {
  // Do not overwrite an explicit toggle while the initial preferences load.
  if (themeChosenByUser) return;

  theme.global.name.value = /(night|dark)/i.test(feedsStore.currentTheme)
    ? 'feedlyNight'
    : 'feedly';
};

// Polling (Phase 5: real-time updates)
/** Reload the current feed and its counters. */
const refreshCurrentFeed = async () => {
  if (feedsStore.currentFeedId === null) return;

  await headlinesStore.loadHeadlines(feedsStore.currentFeedId, feedsStore.currentIsCat);
  await feedsStore.loadFeeds();
};

/** Start the periodic refresh of the current feed and its counters. */
const startPolling = () => {
  stopPolling();
  pollTimer = setInterval(() => {
    // currentFeedId is null when nothing is selected; 0 is the Archived feed.
    if (feedsStore.currentFeedId === null) return;
    runDetached(refreshCurrentFeed(), 'polling refresh');
  }, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * The legacy client opens the "Fresh articles" view when the URL has no
 * selection; the hash is `#f=<id>&c=<0|1>`, the same format Dojo used.
 */
const DEFAULT_FEED_ID = FEED_FRESH;

const parseFeedHash = (): { feedId: number; isCat: boolean } | null => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = params.get('f');
  if (raw === null) return null;

  const feedId = Number.parseInt(raw, 10);
  if (!Number.isFinite(feedId)) return null;

  return { feedId, isCat: params.get('c') === '1' };
};

const syncFeedHash = (feedId: number | string, isCat: boolean) => {
  const hash = `#f=${feedId}&c=${isCat ? 1 : 0}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash);
  }
};

/** Open the hash-selected view, falling back to Fresh articles. */
const openInitialFeed = async () => {
  if (feedsStore.currentFeedId !== null) return;

  const target = parseFeedHash() ?? { feedId: DEFAULT_FEED_ID, isCat: false };
  feedsStore.selectFeed(target.feedId, target.isCat);
  syncFeedHash(target.feedId, target.isCat);
  await headlinesStore.loadHeadlines(target.feedId, target.isCat);
};

// Auth flow (Phase 3)
const onLoggedIn = async () => {
  authStore.setLoggedIn(true);
  showMessage('Welcome back!', 'success');

  // A failing secondary request (plugin hooks, update check) must not prevent
  // the initial feed from opening.
  const results = await Promise.allSettled([
    feedsStore.loadFeeds(),
    feedsStore.loadDisplayPrefs(),
    labelsStore.loadLabels(),
    loadSearchLanguages(),
    loadPluginButtons(),
    loadUpdates(),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Startup load failed:', result.reason);
    }
  }

  applyThemePalette();

  try {
    await openInitialFeed();
  } catch (err) {
    console.error('Could not open the initial feed:', err);
    showMessage('Could not load headlines', 'error');
  }

  startPolling();
};

/** Load the plugin-provided toolbar button fragments for this session. */
const loadPluginButtons = async () => {
  const response = await api.getPluginButtons();
  if (response.status === 0) {
    pluginMainHtml.value = response.content.mainToolbar;
    pluginToolbarHtml.value = response.content.toolbar;
    pluginFeedTreeHtml.value = response.content.feedTree;
    pluginActionHtml.value = response.content.actionItems;
    pluginCustomSortMap.value = response.content.customSortMap;
  }
};

/** Check for a newer core release and updated local plugins (admins only). */
const loadUpdates = async () => {
  const response = await api.checkForUpdates();
  if (response.status === 0) {
    updateUrl.value = response.content.changeset?.compare_url ?? '';
    pluginUpdatesAvailable.value = response.content.plugins.length > 0;
  }
};

/** Fetch the search stemming languages once the session is available. */
const loadSearchLanguages = async () => {
  const { allLanguages, showSyntaxHelp } = await headlinesStore.loadSearchOptions();
  searchLanguages.value = allLanguages;
  showSearchSyntaxHelp.value = showSyntaxHelp;
};

const onLogout = async () => {
  stopPolling();
  headlinesStore.reset();
  feedsStore.reset();
  labelsStore.reset();
  await authStore.logout();
};

/**
 * Mark a feed, category or special view as read.
 * Special feed ids mirror Feeds::FEED_* in classes/Feeds.php:
 * -1 starred, -2 published, -3 fresh, -4 all, -6 recently read, 0 archived.
 */
const markFeedRead = async (feedId: number) => {
  if (feedId > 0 && feedsStore.confirmFeedCatchup && !window.confirm('Mark this feed as read?')) {
    return;
  }

  if (feedId === -4 || feedId === -3) {
    // "All articles" / "Fresh": there is no per-feed catchup for virtual
    // feeds, so use the global mark-all-read handler.
    await headlinesStore.catchupAll();
    showMessage('All headlines marked as read', 'success');
  } else if (feedId < 0) {
    // Other special views (Starred/Published) use the normal mark-read path.
    const ids = headlinesStore.headlines.map(h => h.id);
    await headlinesStore.markAsRead(ids);
    showMessage('Headlines marked as read', 'success');
  } else {
    // A regular feed or category: the backend catchup clears its counters.
    const ok = await feedsStore.catchupFeed(feedId, false);
    showMessage(
      ok ? 'Feed marked as read' : feedsStore.error ?? 'Failed to mark feed as read',
      ok ? 'success' : 'error'
    );
    if (ok) await headlinesStore.loadHeadlines(feedId, false);
  }
};

/** Feed tree context actions (Phase 3). */
const handleFeedAction = async (action: string, feedId: number) => {
  if (action === 'mark_read') {
    await markFeedRead(feedId);
  } else if (action === 'edit') {
    feedsDialogOpen.value = true;
  } else if (action === 'delete') {
    if (!window.confirm('Unsubscribe from this feed?')) return;
    const ok = await feedsStore.removeFeed(feedId);
    if (ok) {
      await feedsStore.loadFeeds();
      await headlinesStore.loadHeadlines(feedsStore.currentFeedId ?? FEED_ALL, feedsStore.currentIsCat);
    } else {
      showMessage(feedsStore.error ?? 'Failed to unsubscribe', 'error');
    }
  }
};

/** Category context actions. */
const handleCategoryAction = async (action: string, categoryId: number) => {
  if (action === 'mark_read') {
    await catchupCurrentFeed(categoryId, true);
  }
};

// Handlers
const handleFeedSelect = async (feedId: number | string, isCat: boolean) => {
  sidebarOpen.value = false;
  pendingAutoCatchup.clear();
  feedsStore.selectFeed(feedId, isCat);
  syncFeedHash(feedId, isCat);
  await headlinesStore.loadHeadlines(feedId, isCat);
};

/** Drag-and-drop feed ordering: move a feed next to another feed. */
const handleFeedMove = async (feedId: number, targetFeedId: number) => {
  const ok = await feedsStore.moveFeedTo(feedId, targetFeedId);
  if (ok) {
    await feedsStore.loadFeeds();
  } else if (feedsStore.error) {
    showMessage(feedsStore.error, 'error');
  }
};

/** Move a feed or category one position and persist the new order. */
const handleFeedReorder = async (kind: 'feed' | 'category', id: number, delta: -1 | 1) => {
  const ok =
    kind === 'category'
      ? await feedsStore.moveCategory(id, delta)
      : await feedsStore.moveFeed(id, delta);
  if (ok) {
    await feedsStore.loadFeeds();
  } else if (feedsStore.error) {
    showMessage(feedsStore.error, 'error');
  }
};

/** The toolbar's search payload, when the action carries one. */
interface SearchPayload {
  query?: string;
  language?: string;
}

/** Narrow the toolbar payload to the search shape it sends. */
function asSearchPayload(payload: unknown): SearchPayload {
  if (typeof payload !== 'object' || payload === null) {
    return { query: typeof payload === 'string' ? payload : undefined };
  }

  return payload as SearchPayload;
}

/** Mark the current feed (or category) as read and refresh the list. */
const catchupCurrentFeed = async (feedId: number | string, isCat: boolean, mode = 'all') => {
  const numericId = typeof feedId === 'number' ? feedId : Number(feedId);
  if (feedsStore.confirmFeedCatchup && (isCat || numericId > 0) && !window.confirm('Mark this feed as read?')) {
    return;
  }

  showMessage('Marking feed as read...', 'info');

  if (!(await feedsStore.catchupFeed(feedId, isCat, mode))) {
    showMessage('Failed to mark feed as read', 'error');
    return;
  }

  await headlinesStore.loadHeadlines(feedId, isCat);
  showMessage('Feed marked as read', 'success');
};

/**
 * Run a search. The toolbar sends {query, language} so the stemming language
 * always reaches the backend (an empty one matches nothing); an empty query
 * clears the search instead.
 */
const runSearch = async (
  payload: string | number | object | undefined,
  feedId: number | string | null,
  isCat: boolean
) => {
  const { query, language } = asSearchPayload(payload);

  if (typeof query === 'string' && query.trim()) {
    // Nothing selected yet: search across all feeds, which is what the legacy
    // client does (a null feed id would reach the backend as `feed=null`).
    const target = feedId ?? FEED_ALL;
    await headlinesStore.search(query.trim(), target, isCat, language);
    showMessage(`Searching for "${query}"`, 'info');
    return;
  }

  headlinesStore.setSearchQuery('');
  await headlinesStore.loadHeadlines(feedId ?? FEED_ALL, isCat);
};

const handleHeadlineSelect = async (headline: Headline) => {
  // Keep the cursor on the clicked row so combined mode expands it.
  headlinesStore.setCursor(headline.id);
  // loadArticle promotes the loaded headline and persists the read state,
  // updating feed counters itself.
  await headlinesStore.loadArticle(headline.id);
};

const handleHeadlineAction = async (headline: Headline, action: string) => {
  switch (action) {
    case 'toggle_read':
      if (headline.is_read) {
        await headlinesStore.markAsUnread([headline.id]);
      } else {
        await headlinesStore.markAsRead([headline.id]);
      }
      break;
    case 'mark_read':
      await headlinesStore.markAsRead([headline.id]);
      break;
    case 'mark_unread':
      await headlinesStore.markAsUnread([headline.id]);
      break;
    case 'toggle_star':
      await headlinesStore.toggleStar(headline.id);
      break;
    case 'toggle_publish':
      await headlinesStore.togglePublish(headline.id);
      break;
    case 'label':
      labelArticleId.value = headline.id;
      labelsDialogOpen.value = true;
      break;
    case 'open_feed':
      await handleFeedSelect(headline.feed_id, false);
      break;
    case 'delete':
      try {
        await headlinesStore.deleteArticle(headline.id);
        showMessage('Article deleted', 'success');
      } catch {
        showMessage('Failed to delete article', 'error');
      }
      break;
    default:
      showMessage(`Unknown action: ${action}`, 'warning');
  }
};

const handleArticleClose = () => {
  headlinesStore.clearSelection();
};

/** Mark the unread articles above/below one article as read. */
const handleMarkRelative = async (articleId: number, above: boolean) => {
  const ids = headlinesStore.unreadRelativeTo(articleId, above);
  if (ids.length === 0) {
    showMessage('No unread articles to mark', 'info');
    return;
  }
  await headlinesStore.markAsRead(ids);
  showMessage(`Marked ${ids.length} article(s) as read`, 'success');
};

// Read-on-scroll must not shrink the backend result set while the next page is
// being fetched: the offset is computed from the still-unread loaded rows.
const pendingAutoCatchup = new Set<number>();

/** Mark articles that scrolled past the viewport read (CDM_AUTO_CATCHUP). */
const handleAutoCatchup = async (ids: number[]) => {
  if (ids.length === 0) return;

  if (headlinesStore.loadingMore) {
    ids.forEach(id => pendingAutoCatchup.add(id));
    return;
  }

  ids.forEach(id => pendingAutoCatchup.delete(id));
  await headlinesStore.markAsRead(ids);
};

/** Flush read-on-scroll ids queued while a page was loading. */
const flushPendingAutoCatchup = async () => {
  if (pendingAutoCatchup.size === 0) return;

  const ids = [...pendingAutoCatchup];
  pendingAutoCatchup.clear();
  await headlinesStore.markAsRead(ids);
};

/** Bulk actions from the headlines selection bar. */
const handleBulkAction = async (action: string, ids: number[]) => {
  if (ids.length === 0) return;
  switch (action) {
    case 'mark_read':
      await headlinesStore.markAsRead(ids);
      showMessage(`${ids.length} article(s) marked as read`, 'success');
      break;
    case 'toggle_unread':
      await headlinesStore.toggleUnread(ids);
      showMessage(`${ids.length} article(s) toggled unread`, 'success');
      break;
    case 'toggle_starred':
      await headlinesStore.toggleStarred(ids);
      showMessage(`${ids.length} article(s) toggled starred`, 'success');
      break;
    case 'toggle_published':
      await headlinesStore.togglePublished(ids);
      showMessage(`${ids.length} article(s) toggled published`, 'success');
      break;
    case 'open_original':
      // Open each selected article's link in a new tab (the legacy behaviour).
      for (const id of ids) {
        const headline = headlinesStore.headlines.find(h => h.id === id);
        if (headline?.link) window.open(headline.link, '_blank', 'noopener,noreferrer');
      }
      break;
    case 'set_score': {
      const input = window.prompt('New score for the selected articles:', '0');
      if (input === null) break;
      const score = Number.parseInt(input, 10);
      if (Number.isNaN(score)) {
        showMessage('Score must be a number', 'warning');
        break;
      }
      await headlinesStore.setScoreFor(ids, score);
      showMessage(`Score set on ${ids.length} article(s)`, 'success');
      break;
    }
    case 'delete':
      await headlinesStore.deleteArticles(ids);
      showMessage(`${ids.length} article(s) deleted`, 'success');
      break;
    default:
      showMessage(`Unknown bulk action: ${action}`, 'warning');
  }

  headlinesStore.clearHeadlineSelection();
};

const handleLoadMore = async () => {
  const feedId = feedsStore.currentFeedId;
  const isCat = feedsStore.currentIsCat;
  await headlinesStore.loadMore(feedId, isCat);
  await flushPendingAutoCatchup();
};

/** Open the next feed/category with unread articles, as the legacy end link does. */
const handleNextUnread = async () => {
  const next = feedsStore.nextUnreadFeed();
  if (!next) {
    showMessage('No unread feed found', 'info');
    return;
  }
  await handleFeedSelect(next.id, next.isCat);
};

/** Open the headline under the cursor, if there is one. */
const openCursorHeadline = async () => {
  const headline = headlinesStore.cursorHeadline;
  if (headline) await handleHeadlineSelect(headline);
};

/** Toggle the read state of the headline under the cursor. */
const toggleCursorRead = async () => {
  const headline = headlinesStore.cursorHeadline;
  if (!headline) return;
  await handleHeadlineAction(headline, 'toggle_read');
};

/** Open the legacy Search... dialog. */
const openArticleSearch = () => {
  searchDraft.value = '';
  searchLanguageDraft.value = headlinesStore.searchLanguage;
  searchDialogOpen.value = true;
};

/** Run the dialog's search against the current view. */
const submitSearch = async () => {
  const term = searchDraft.value.trim();
  if (!term) return;
  searchDialogOpen.value = false;
  await runSearch(
    { query: term, language: searchLanguageDraft.value },
    feedsStore.currentFeedId,
    feedsStore.currentIsCat
  );
};

const openFeedSearch = () => {
  feedSearchDraft.value = '';
  feedSearchOpen.value = true;
};

const selectFeedSearchResult = async (item: { id: number; isCat: boolean }) => {
  feedSearchOpen.value = false;
  await handleFeedSelect(item.id, item.isCat);
};

/** Dispatch a toolbar action (refresh, catchup, search, view mode, sort). */
const handleToolbarAction = async (action: string, payload?: string | number | object) => {
  const feedId = feedsStore.currentFeedId;
  const isCat = feedsStore.currentIsCat;

  switch (action) {
    case 'refresh':
      await Promise.all([feedsStore.loadFeeds(), headlinesStore.loadHeadlines(feedId, isCat)]);
      break;
    case 'catchup':
      // The toolbar may send a time window ('1day'/'1week'/'2week'); the
      // keyboard shortcut sends none, which means "all".
      await catchupCurrentFeed(feedId, isCat, typeof payload === 'string' ? payload : 'all');
      break;
    case 'search':
      await runSearch(payload, feedId, isCat);
      break;
    case 'searchLanguage':
      if (typeof payload === 'string') headlinesStore.searchLanguage = payload;
      break;
    case 'viewMode':
      if (typeof payload === 'string') {
        headlinesStore.setViewMode(payload);
        await headlinesStore.loadHeadlines(feedId, isCat);
      }
      break;
    case 'orderBy':
      if (typeof payload === 'string') {
        headlinesStore.setOrderBy(payload);
        await headlinesStore.loadHeadlines(feedId, isCat);
      }
      break;
    case 'selectBy':
      if (typeof payload === 'string') headlinesStore.selectHeadlinesBy(payload);
      break;
    case 'edit':
    case 'delete':
      feedsDialogOpen.value = true;
      break;
    case 'toggleHideRead':
      await feedsStore.toggleHideRead();
      showMessage(
        feedsStore.hideReadFeeds ? 'Hiding read feeds' : 'Showing read feeds',
        'info'
      );
      break;
    case 'toggleCombinedMode':
      await feedsStore.toggleCombinedMode();
      showMessage(
        feedsStore.combinedMode ? 'Combined mode on' : 'Combined mode off',
        'info'
      );
      break;
    case 'toggleCdmExpanded':
      await feedsStore.toggleCdmExpanded();
      showMessage(
        feedsStore.cdmExpanded ? 'Expanding all articles' : 'Expanding the selected article only',
        'info'
      );
      break;
    case 'toggleWideScreen':
      await feedsStore.toggleWideScreen();
      showMessage(
        feedsStore.wideScreen ? 'Widescreen mode on' : 'Widescreen mode off',
        'info'
      );
      break;
    case 'focusSearch':
      openArticleSearch();
      break;
    case 'searchFeeds':
      openFeedSearch();
      break;
    case 'hotkeyHelp':
      hotkeyHelpOpen.value = true;
      break;
    case 'preferences':
      prefsOpen.value = true;
      break;
    case 'manageFeeds':
      feedsDialogOpen.value = true;
      break;
    case 'toggleTheme':
      toggleTheme();
      break;
    case 'logout':
      await onLogout();
      break;
    default:
      showMessage(`Unknown action: ${action}`, 'warning');
  }
};

// Keyboard shortcuts. Mirrors the legacy Dojo hotkeys that map cleanly onto the
// three-pane layout (see js/App.js get_hotkeys_map): j/k or arrows move the
// cursor, o/Enter opens, r toggles read, s stars, f publishes, g then u
// refreshes the current feed.
/** Dispatch a legacy hotkey action. */
const handleHotkey = (action: string): void => {
  const cursor = headlinesStore.cursorHeadline;
  const currentFeed = feedsStore.currentFeedId ?? FEED_ALL;
  const currentIsCat = feedsStore.currentIsCat;

  switch (action) {
    case 'next_feed':
    case 'prev_feed': {
      const next = feedsStore.nextFeed(action === 'next_feed' ? 1 : -1);
      if (next) runDetached(handleFeedSelect(next.id, next.isCat), 'feed navigation');
      break;
    }
    case 'next_unread_feed':
    case 'prev_unread_feed': {
      const next = feedsStore.nextUnreadFeed(action === 'next_unread_feed' ? 1 : -1);
      if (next) runDetached(handleFeedSelect(next.id, next.isCat), 'unread feed navigation');
      break;
    }
    case 'open_article':
      runDetached(openCursorHeadline(), 'open article');
      break;
    case 'next_article':
    case 'next_article_noscroll':
      headlinesStore.moveCursor(1);
      break;
    case 'prev_article':
    case 'prev_article_noscroll':
      headlinesStore.moveCursor(-1);
      break;
    case 'article_page_down':
      document.querySelector('.headlines-list')?.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
      break;
    case 'article_page_up':
      document.querySelector('.headlines-list')?.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
      break;
    case 'search_dialog':
      openArticleSearch();
      break;
    case 'cancel_search':
      headlinesStore.setSearchQuery('');
      runDetached(headlinesStore.loadHeadlines(currentFeed, currentIsCat), 'cancel search');
      break;
    case 'toggle_mark':
      if (cursor) runDetached(headlinesStore.toggleStar(cursor.id), 'toggle star');
      break;
    case 'toggle_publ':
      if (cursor) runDetached(headlinesStore.togglePublish(cursor.id), 'toggle publish');
      break;
    case 'toggle_unread':
      if (cursor) runDetached(toggleCursorRead(), 'toggle unread');
      break;
    case 'edit_tags':
    case 'create_label':
      if (cursor) labelArticleId.value = cursor.id;
      labelsDialogOpen.value = true;
      break;
    case 'open_in_new_window':
      if (cursor?.link) window.open(cursor.link, '_blank', 'noopener,noreferrer');
      break;
    case 'catchup_below':
      if (cursor) runDetached(handleMarkRelative(cursor.id, false), 'catchup below');
      break;
    case 'catchup_above':
      if (cursor) runDetached(handleMarkRelative(cursor.id, true), 'catchup above');
      break;
    case 'toggle_widescreen':
      runDetached(handleToolbarAction('toggleWideScreen'), 'toggle widescreen');
      break;
    case 'toggle_full_text':
    case 'toggle_cdm_expanded':
      runDetached(handleToolbarAction('toggleCdmExpanded'), 'toggle expanded');
      break;
    case 'email_article':
      if (cursor) {
        window.location.href = `mailto:?subject=${encodeURIComponent(cursor.title)}&body=${encodeURIComponent(cursor.link)}`;
      }
      break;
    case 'close_article':
      handleArticleClose();
      break;
    case 'article_span_grid':
    case 'cat_toggle_collapse':
      break;
    case 'select_all':
    case 'select_unread':
    case 'select_marked':
    case 'select_published':
    case 'select_invert':
    case 'select_none':
      headlinesStore.selectHeadlinesBy(action.replace('select_', ''));
      break;
    case 'feed_refresh':
      runDetached(handleToolbarAction('refresh'), 'refresh');
      break;
    case 'feed_unhide_read':
      runDetached(handleToolbarAction('toggleHideRead'), 'toggle hide read');
      break;
    case 'feed_subscribe':
    case 'feed_edit':
      feedsDialogOpen.value = true;
      break;
    case 'feed_catchup':
      runDetached(handleToolbarAction('catchup'), 'catchup');
      break;
    case 'feed_reverse':
      runDetached(
        handleToolbarAction(
          'orderBy',
          headlinesStore.orderBy === 'date_reverse' ? 'feed_dates' : 'date_reverse'
        ),
        'reverse order'
      );
      break;
    case 'feed_toggle_vgroup':
      runDetached(feedsStore.toggleVfeedGroup(), 'toggle group by feed');
      break;
    case 'feed_toggle_grid':
      runDetached(feedsStore.toggleGrid(), 'toggle grid');
      break;
    case 'toggle_combined_mode':
      runDetached(handleToolbarAction('toggleCombinedMode'), 'toggle combined');
      break;
    case 'catchup_all':
      runDetached(handleToolbarAction('catchup'), 'catchup all');
      break;
    case 'goto_all':
      runDetached(handleFeedSelect(FEED_ALL, false), 'goto all');
      break;
    case 'goto_fresh':
      runDetached(handleFeedSelect(FEED_FRESH, false), 'goto fresh');
      break;
    case 'goto_marked':
      runDetached(handleFeedSelect(-1, false), 'goto starred');
      break;
    case 'goto_published':
      runDetached(handleFeedSelect(-2, false), 'goto published');
      break;
    case 'goto_read':
      runDetached(handleFeedSelect(-6, false), 'goto recently read');
      break;
    case 'goto_prefs':
      prefsOpen.value = true;
      break;
    case 'select_article_cursor':
      if (headlinesStore.cursorId === null && headlinesStore.headlines.length > 0) {
        headlinesStore.setCursor(headlinesStore.headlines[0].id);
      }
      break;
    case 'create_filter':
      prefsOpen.value = true;
      break;
    case 'collapse_sidebar':
      sidebarOpen.value = false;
      break;
    case 'help_dialog':
      hotkeyHelpOpen.value = true;
      break;
    default:
      break;
  }
};

useKeyboard({ onAction: handleHotkey });

// Lifecycle
onMounted(async () => {
  // The legacy shell only serves this page to an authenticated session, so a
  // readable CSRF token means we are already logged in.
  const authenticated = await api.checkSession();
  if (authenticated) {
    authStore.setLoggedIn(true);

    const results = await Promise.allSettled([
      feedsStore.loadFeeds(),
      feedsStore.loadDisplayPrefs(),
      labelsStore.loadLabels(),
      loadSearchLanguages(),
      loadPluginButtons(),
      loadUpdates(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Startup load failed:', result.reason);
      }
    }

    applyThemePalette();

    try {
      await openInitialFeed();
    } catch (err) {
      console.error('Could not open the initial feed:', err);
      showMessage('Could not load headlines', 'error');
    }

    startPolling();
  }
});

onUnmounted(stopPolling);
</script>

<style scoped>
.ttrss-app {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: rgb(var(--v-theme-background));
}

.sidebar-splitter {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
}

.sidebar-splitter:hover {
  background: rgba(var(--v-theme-primary), 0.25);
}

.article-splitter {
  flex: 0 0 4px;
  cursor: row-resize;
  background: transparent;
}

.article-splitter:hover {
  background: rgba(var(--v-theme-primary), 0.25);
}

.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.app-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: 0;
  background: rgb(var(--v-theme-background));
}

/* The toolbar is the header's main row, like the legacy shell. */
.app-header .toolbar {
  flex: 1;
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

/* Desktop keeps the tree visible; the toggle is only for the phone drawer. */
.nav-toggle {
  display: none;
}

.sidebar {
  flex: 0 0 20%;
  width: 20%;
  min-width: 200px;
  max-width: 50vw;
  overflow-y: auto;
  border-right: 1px solid rgba(var(--v-theme-on-background), 0.09);
  background: rgba(var(--v-theme-on-background), 0.03);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

/* Status alerts must keep their height; the list below takes the rest. */
.content > .v-alert {
  flex: 0 0 auto;
}

.article-panel {
  flex: 0 0 50%;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid rgba(var(--v-theme-on-background), 0.12);
  background: rgb(var(--v-theme-surface));
}

/* WIDESCREEN_MODE: hide the tree and let the list use the full width. The
   header toggle still opens it as a drawer so the feed list is never lost. */
@media (min-width: 901px) {
  .wide-screen .sidebar:not(.open) {
    display: none;
  }

  .wide-screen .sidebar.open {
    display: block;
    position: fixed;
    top: 44px;
    bottom: 0;
    left: 0;
    z-index: 1000;
    width: min(85vw, 320px);
    background: rgb(var(--v-theme-surface));
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
  }

  .wide-screen .nav-toggle {
    display: inline-flex;
  }

  .wide-screen .sidebar-splitter {
    display: none;
  }

  .wide-screen .sidebar-scrim {
    display: block;
    position: fixed;
    inset: 44px 0 0 0;
    z-index: 999;
    background: rgba(0, 0, 0, 0.35);
  }
}

.search-syntax-link {
  display: inline-block;
  margin-top: 8px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.8125rem;
  text-decoration: none;
}

.search-syntax-link:hover {
  text-decoration: underline;
}

.feed-search-counter {
  color: rgba(var(--v-theme-on-background), 0.55);
  font-size: 0.75rem;
}

.sidebar-scrim {
  display: none;
}

/* Phone layout, mirroring the legacy client: the feed tree is a drawer and
   the reading pane covers the screen instead of sitting beside the list. */
@media (max-width: 900px) {
  .app-header {
    min-height: 52px;
    padding: 0.125rem 0.25rem;
  }

  .nav-toggle {
    display: inline-flex;
  }

  .sidebar-splitter,
  .article-splitter {
    display: none;
  }

  .sidebar {
    position: fixed;
    top: 52px;
    bottom: 0;
    left: 0;
    z-index: 1000;
    width: min(85vw, 320px) !important;
    flex-basis: auto !important;
    min-width: 0;
    max-width: none;
    background: rgb(var(--v-theme-surface));
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .sidebar-scrim {
    display: block;
    position: fixed;
    inset: 52px 0 0 0;
    z-index: 999;
    background: rgba(0, 0, 0, 0.35);
  }

  .content {
    width: 100%;
  }

  .article-panel {
    position: fixed;
    inset: 52px 0 0 0;
    z-index: 1001;
    width: auto;
    max-width: none;
    border-top: 0;
  }
}
</style>
