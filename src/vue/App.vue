<template>
  <v-app>
    <!-- Login gate (Phase 3) -->
    <LoginForm v-if="!authStore.loggedIn" @logged-in="onLoggedIn" />

    <div v-else class="ttrss-app">
      <header class="app-header">
        <v-btn icon="mdi-menu" class="nav-toggle" variant="text" @click="sidebarOpen = !sidebarOpen" title="Toggle sidebar" />
        <h1>Tiny Tiny RSS</h1>
        <v-spacer />
        <span class="subtitle">{{ authStore.username }}</span>
        <v-btn icon="mdi-theme-light-dark" variant="text" @click="toggleTheme" title="Toggle light/dark theme" />
        <v-btn icon="mdi-cog" variant="text" @click="prefsOpen = true" title="Preferences" />
        <v-btn icon="mdi-plus-box" variant="text" @click="feedsDialogOpen = true" title="Manage feeds" />
        <v-btn icon="mdi-logout" variant="text" @click="onLogout" title="Log out" />
      </header>

      <main class="app-main">
                <aside class="sidebar" :class="{ open: sidebarOpen }">
          <FeedTree
            :feeds="feedsStore.feeds"
            :categories="feedsStore.categories"
            :labels="labelsStore.labels"
            @select="handleFeedSelect"
            @feed-action="handleFeedAction"
          />
        </aside>

        <section class="content">
          <Toolbar
            :feed-info="feedsStore.currentFeed"
            :search-languages="searchLanguages"
            :model-search-language="headlinesStore.searchLanguage"
            :model-view-mode="headlinesStore.viewMode"
            :model-order-by="headlinesStore.orderBy"
            @action="handleToolbarAction"
          />

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
            @select="handleHeadlineSelect"
            @action="handleHeadlineAction"
            @load-more="handleLoadMore"
                    />
        </section>

        <aside class="article-panel" v-if="headlinesStore.selectedArticle">
          <ArticleView
            :article="headlinesStore.selectedArticle"
            @close="handleArticleClose"
          />
        </aside>
      </main>

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
import { useKeyboard } from './composables/useKeyboard';

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
const prefsOpen = ref(false);
const labelArticleId = ref<number | null>(null);
const searchLanguages = ref<string[]>([]);

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
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark';
};

// Polling (Phase 5: real-time updates)
/** Reload the current feed and its counters. */
const refreshCurrentFeed = async () => {
  if (feedsStore.currentFeedId === null) return;

  await headlinesStore.loadHeadlines(feedsStore.currentFeedId, feedsStore.currentIsCat);
  await feedsStore.loadFeeds();
};

const startPolling = () => {
  stopPolling();
  pollTimer = setInterval(() => {
    // currentFeedId is null when nothing is selected; 0 is the Archived feed.
    if (feedsStore.currentFeedId === null) return;
    void refreshCurrentFeed();
  }, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

// Auth flow (Phase 3)
const onLoggedIn = async () => {
  showMessage('Welcome back!', 'success');
  await Promise.all([feedsStore.loadFeeds(), labelsStore.loadLabels(), loadSearchLanguages()]);
  startPolling();
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
 * Feed tree context actions (Phase 3).
 * Special feed ids mirror Feeds::FEED_* in classes/Feeds.php:
 * -1 starred, -2 published, -3 fresh, -4 all, -6 recently read, 0 archived.
 */
const handleFeedAction = async (action: string, feedId: number) => {
  if (action === 'mark_read') {
    if (feedId === -4 || feedId === -3) {
      // "All articles" / "Fresh": there is no per-feed catchup for virtual
      // feeds, so use the global mark-all-read handler.
      await headlinesStore.catchupAll();
      showMessage('All headlines marked as read', 'success');
    } else if (feedId === -1 || feedId === -2) {
      // Starred/published special views use the normal mark-read path
      const ids = headlinesStore.headlines.map(h => h.id);
      await headlinesStore.markAsRead(ids);
    }
  } else if (action === 'edit') {
    feedsDialogOpen.value = true;
  } else if (action === 'delete') {
    feedsDialogOpen.value = true;
  }
};

// Handlers
const handleFeedSelect = async (feedId: number | string, isCat: boolean) => {
  sidebarOpen.value = false;
  feedsStore.selectFeed(feedId, isCat);
  await headlinesStore.loadHeadlines(feedId, isCat);
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

const handleToolbarAction = async (action: string, payload?: string | number | object) => {
  const feedId = feedsStore.currentFeedId;
  const isCat = feedsStore.currentIsCat;

  switch (action) {
    case 'refresh':
      await Promise.all([feedsStore.loadFeeds(), headlinesStore.loadHeadlines(feedId, isCat)]);
      break;
    case 'catchup':
      await catchupCurrentFeed(feedId, isCat);
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
    case 'edit':
    case 'delete':
      feedsDialogOpen.value = true;
      break;
    default:
      showMessage(`Unknown action: ${action}`, 'warning');
  }
};

/** Mark the current feed (or category) as read and refresh the list. */
const catchupCurrentFeed = async (feedId: number | string, isCat: boolean) => {
  showMessage('Marking feed as read...', 'info');

  if (!(await feedsStore.catchupFeed(feedId, isCat))) {
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
  feedId: number | string,
  isCat: boolean
) => {
  const { query, language } = asSearchPayload(payload);

  if (typeof query === 'string' && query.trim()) {
    await headlinesStore.search(query.trim(), feedId, isCat, language);
    showMessage(`Searching for "${query}"`, 'info');
    return;
  }

  headlinesStore.setSearchQuery('');
  await headlinesStore.loadHeadlines(feedId, isCat);
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

// Keyboard shortcuts. Mirrors the legacy Dojo hotkeys that map cleanly onto the
// three-pane layout (see js/App.js get_hotkeys_map): j/k or arrows move the
// cursor, o/Enter opens, r toggles read, s stars, f publishes, g then u
// refreshes the current feed.
useKeyboard({
  onNext: () => headlinesStore.moveCursor(1),
  onPrevious: () => headlinesStore.moveCursor(-1),
  onSelect: () => void openCursorHeadline(),
  onOpenArticle: () => void openCursorHeadline(),
  onToggleRead: () => void toggleCursorRead(),
  onToggleStar: () => {
    const headline = headlinesStore.cursorHeadline;
    if (headline) void headlinesStore.toggleStar(headline.id);
  },
  onTogglePublish: () => {
    const headline = headlinesStore.cursorHeadline;
    if (headline) void headlinesStore.togglePublish(headline.id);
  },
  onRefresh: () => void handleToolbarAction('refresh'),
  onCatchup: () => void handleToolbarAction('catchup'),
});

// Lifecycle
onMounted(async () => {
  // The legacy shell only serves this page to an authenticated session, so a
  // readable CSRF token means we are already logged in.
  const authenticated = await api.checkSession();
  if (authenticated) {
    authStore.setLoggedIn(true);
    await Promise.all([feedsStore.loadFeeds(), labelsStore.loadLabels(), loadSearchLanguages()]);
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
  background: var(--ttrss-bg, #f5f5f5);
}

.app-header {
  padding: 1rem;
  background: var(--ttrss-header-bg, #fff);
  border-bottom: 1px solid var(--ttrss-border, #ddd);
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--ttrss-primary, #1976d2);
}

.app-header .subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #666;
}

.app-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 250px;
  overflow-y: auto;
  background: var(--ttrss-sidebar-bg, #fff);
  border-right: 1px solid var(--ttrss-border, #ddd);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.article-panel {
  width: 400px;
  overflow-y: auto;
  background: var(--ttrss-article-bg, #fff);
  border-left: 1px solid var(--ttrss-border, #ddd);
}

.app-footer {
  padding: 0.5rem 1rem;
  background: var(--ttrss-footer-bg, #f0f0f0);
  border-top: 1px solid var(--ttrss-border, #ddd);
  font-size: 0.875rem;
}

.status {
  color: #666;
}
</style>
