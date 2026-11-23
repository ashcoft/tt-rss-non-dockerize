<template>
  <v-app>
    <!-- Login gate (Phase 3) -->
    <LoginForm v-if="!authStore.loggedIn" @logged-in="onLoggedIn" />

    <div v-else class="ttrss-app">
      <header class="app-header">
        <v-btn icon="mdi-menu" class="nav-toggle" variant="text" @click="sidebarOpen = !sidebarOpen" title="Toggle sidebar" />
        <Toolbar
          :feed-info="feedsStore.currentFeed"
          :feed-error="headlinesStore.feedError"
          :search-languages="searchLanguages"
          :model-search-language="headlinesStore.searchLanguage"
          :model-view-mode="headlinesStore.viewMode"
          :model-order-by="headlinesStore.orderBy"
          :plugin-main-html="pluginMainHtml"
          :plugin-toolbar-html="pluginToolbarHtml"
          :update-url="updateUrl"
          :plugin-updates="pluginUpdatesAvailable"
          @action="handleToolbarAction"
        />
        <!-- Kept visible for quick access; the rest of the account actions live
             in the toolbar's overflow menu, as in the legacy shell. -->
        <v-btn icon="mdi-cog" class="prefs-button" variant="text" @click="prefsOpen = true" title="Preferences" />
      </header>

      <main class="app-main">
        <div v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen = false" />
                <aside class="sidebar" :class="{ open: sidebarOpen }">
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
          />
        </aside>

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
            :selected-ids="headlinesStore.selectedHeadlineIds"
            :auto-catchup="feedsStore.cdmAutoCatchup"
            @toggle-select="headlinesStore.toggleHeadlineSelected"
            @auto-catchup="handleAutoCatchup"
            @select="handleHeadlineSelect"
            @action="handleHeadlineAction"
            @load-more="handleLoadMore"
            @bulk-action="handleBulkAction"
                    />
        </section>

        <!-- In combined mode the content is inline in the list, so no panel. -->
        <aside
          class="article-panel"
          v-if="headlinesStore.selectedArticle && !feedsStore.combinedMode"
        >
          <ArticleView
            :article="headlinesStore.selectedArticle"
            @close="handleArticleClose"
            @mark-relative="handleMarkRelative"
          />
        </aside>
      </main>

      <!-- Feedly-style floating feed-tree button on phones. -->
      <v-btn
        class="mobile-fab"
        icon="mdi-rss"
        color="primary"
        size="large"
        elevation="6"
        title="Toggle feed tree"
        @click="sidebarOpen = !sidebarOpen"
      />

      <footer class="app-footer">
        <span class="status">{{ statusMessage }}</span>
        <v-spacer />
        <span v-if="pollingActive" class="status">
          <v-icon size="14" icon="mdi-sync" class="mr-1" />Auto-refresh on
        </span>
      </footer>
    </div>

    <!-- Dialogs (Phase 3/4) -->
    <ManageFeedsDialog v-model="feedsDialogOpen" />
    <LabelsDialog v-model="labelsDialogOpen" :article-id="labelArticleId" />
    <PreferencesDialog v-model="prefsOpen" />
    <HotkeyHelpDialog v-model="hotkeyHelpOpen" />

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
const labelArticleId = ref<number | null>(null);
const searchLanguages = ref<string[]>([]);
const pluginMainHtml = ref('');
const pluginToolbarHtml = ref('');
const updateUrl = ref('');
const pluginUpdatesAvailable = ref(false);

// Auto-refresh polling (Phase 5)
const POLL_INTERVAL_MS = 5 * 60 * 1000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const pollingActive = computed(() => pollTimer !== null);

const statusMessage = computed(() => {
  return `${headlinesStore.headlines.length} articles, ${headlinesStore.unreadCount} unread`;
});

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
const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'feedly' : 'feedlyNight';
};

/** Match the Vuetify palette to a night/light USER_CSS_THEME. */
const applyThemePalette = () => {
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
  showMessage('Welcome back!', 'success');
  await Promise.all([
    feedsStore.loadFeeds(),
    feedsStore.loadDisplayPrefs(),
    labelsStore.loadLabels(),
    loadSearchLanguages(),
    loadPluginButtons(),
    loadUpdates(),
  ]);
  applyThemePalette();
  await openInitialFeed();
  startPolling();
};

/** Load the plugin-provided toolbar button fragments for this session. */
const loadPluginButtons = async () => {
  const response = await api.getPluginButtons();
  if (response.status === 0) {
    pluginMainHtml.value = response.content.mainToolbar;
    pluginToolbarHtml.value = response.content.toolbar;
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
  const { allLanguages } = await headlinesStore.loadSearchOptions();
  searchLanguages.value = allLanguages;
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
  } else if (action === 'edit' || action === 'delete') {
    feedsDialogOpen.value = true;
  }
};

// Handlers
const handleFeedSelect = async (feedId: number | string, isCat: boolean) => {
  sidebarOpen.value = false;
  feedsStore.selectFeed(feedId, isCat);
  syncFeedHash(feedId, isCat);
  await headlinesStore.loadHeadlines(feedId, isCat);
};

/** Move a feed or category one position and persist the new order. */
const handleFeedReorder = async (kind: 'feed' | 'category', id: number, delta: -1 | 1) => {
  const ok =
    kind === 'category'
      ? await feedsStore.moveCategory(id, delta)
      : await feedsStore.moveFeed(id, delta);
  if (!ok && feedsStore.error) {
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

/** Mark articles that scrolled past the viewport read (CDM_AUTO_CATCHUP). */
const handleAutoCatchup = async (ids: number[]) => {
  if (ids.length === 0) return;
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
useKeyboard({
  onNext: () => headlinesStore.moveCursor(1),
  onPrevious: () => headlinesStore.moveCursor(-1),
  onSelect: () => {
    runDetached(openCursorHeadline(), 'open headline');
  },
  onOpenArticle: () => {
    runDetached(openCursorHeadline(), 'open headline');
  },
  onToggleRead: () => {
    runDetached(toggleCursorRead(), 'toggle read');
  },
  onToggleStar: () => {
    const headline = headlinesStore.cursorHeadline;
    if (headline) runDetached(headlinesStore.toggleStar(headline.id), 'toggle star');
  },
  onTogglePublish: () => {
    const headline = headlinesStore.cursorHeadline;
    if (headline) runDetached(headlinesStore.togglePublish(headline.id), 'toggle publish');
  },
  onRefresh: () => {
    runDetached(handleToolbarAction('refresh'), 'refresh');
  },
  onCatchup: () => {
    runDetached(handleToolbarAction('catchup'), 'catchup');
  },
  onHelp: () => {
    hotkeyHelpOpen.value = true;
  },
});

// Lifecycle
onMounted(async () => {
  // The legacy shell only serves this page to an authenticated session, so a
  // readable CSRF token means we are already logged in.
  const authenticated = await api.checkSession();
  if (authenticated) {
    authStore.setLoggedIn(true);
    await Promise.all([
      feedsStore.loadFeeds(),
      feedsStore.loadDisplayPrefs(),
      labelsStore.loadLabels(),
      loadSearchLanguages(),
      loadPluginButtons(),
      loadUpdates(),
    ]);
    applyThemePalette();
    await openInitialFeed();
    startPolling();
  }
});

onUnmounted(stopPolling);
</script>

<style scoped>
.ttrss-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: rgb(var(--v-theme-background));
}

.app-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: rgb(var(--v-theme-background));
}

/* The toolbar is the header's main row, like the legacy shell. */
.app-header .toolbar {
  flex: 1;
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 290px;
  overflow-y: auto;
  background: rgb(var(--v-theme-background));
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Status alerts must keep their height; the list below takes the rest. */
.content > .v-alert {
  flex: 0 0 auto;
}

.article-panel {
  width: 400px;
  overflow-y: auto;
  margin: 16px 16px 16px 0;
  background: rgb(var(--v-theme-surface));
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.app-footer {
  padding: 0.5rem 1rem;
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-background), 0.6);
  font-size: 0.8125rem;
}

.status {
  color: #666;
}

.sidebar-scrim {
  display: none;
}

.mobile-fab {
  display: none;
}

/* Phone layout, mirroring the legacy client: the feed tree is a drawer and
   the reading pane covers the screen instead of sitting beside the list. */
@media (max-width: 900px) {
  .app-header {
    min-height: 52px;
    padding: 0.125rem 0.25rem;
  }

  .prefs-button {
    display: none;
  }

  .sidebar {
    position: fixed;
    top: 52px;
    bottom: 0;
    left: 0;
    z-index: 1000;
    width: min(85vw, 320px);
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
    margin: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .app-footer {
    display: none;
  }

  .mobile-fab {
    display: inline-flex;
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 998;
  }
}
</style>
