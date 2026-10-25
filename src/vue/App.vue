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
        <v-btn icon="mdi-keyboard" variant="text" @click="helpOpen = true" title="Keyboard shortcuts" />
        <v-btn icon="mdi-cog" variant="text" @click="openPreferences" title="Preferences" />
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
            @move-feed="handleMoveFeed"
          />
        </aside>

        <section class="content">
          <Toolbar
            :feed-info="feedsStore.currentFeed"
            :search-languages="searchLanguages"
            :model-search-language="headlinesStore.searchLanguage"
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
    <PreferencesDialog
      v-model="prefsOpen"
      :initial-tab="prefsTab"
      :initial-feed-id="prefsFeedId"
    />
    <HotkeysHelpDialog v-model="helpOpen" />

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
import HotkeysHelpDialog from './components/dialogs/HotkeysHelpDialog.vue';
import { useKeyboard } from './composables/useKeyboard';
import type { FeedDetails } from './api/legacyEndpoints';

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
const prefsTab = ref('general');
const prefsFeedId = ref<number | null>(null);
const helpOpen = ref(false);
const labelArticleId = ref<number | null>(null);
const searchLanguages = ref<string[]>([]);
const selectedIndex = ref(-1);

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
const startPolling = () => {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!feedsStore.currentFeedId) return;
    await headlinesStore.loadHeadlines(feedsStore.currentFeedId, feedsStore.currentIsCat);
    await feedsStore.loadFeeds();
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
    } else if (feedId > 0) {
      if (await feedsStore.catchupFeed(feedId, false)) {
        await headlinesStore.loadHeadlines(feedsStore.currentFeedId, feedsStore.currentIsCat);
        showMessage('Feed marked as read', 'success');
      } else {
        showMessage('Failed to mark feed as read', 'error');
      }
    }
  } else if (action === 'edit') {
    openPreferences('feeds', feedId);
  } else if (action === 'delete') {
    const title = feedsStore.feeds.find((feed) => feed.id === feedId)?.title ?? `feed ${feedId}`;
    if (!window.confirm(`Unsubscribe from ${title}?`)) return;
    if (await feedsStore.removeFeed(feedId)) {
      showMessage('Feed removed', 'success');
      if (feedsStore.currentFeedId === feedId) {
        feedsStore.selectFeed(0, false);
        headlinesStore.reset();
      }
    } else {
      showMessage(feedsStore.error ?? 'Failed to remove feed', 'error');
    }
  }
};

/** Open the preferences dialog on a given tab (and optionally a feed). */
const openPreferences = (tab = 'general', feedId: number | null = null) => {
  prefsTab.value = tab;
  prefsFeedId.value = feedId;
  prefsOpen.value = true;
};

/**
 * Drag and drop feed -> category. `Pref_Feeds/editSave` updates the whole feed
 * row, so read it first and only change `cat_id`.
 */
const handleMoveFeed = async (feedId: number, categoryId: number) => {
  try {
    const response = await api.getFeedDetails(feedId);
    if (response.status !== 0 || !response.content) {
      showMessage(response.error ?? 'Failed to load feed', 'error');
      return;
    }
    const details: FeedDetails = response.content;
    if ((details.cat_id ?? 0) === categoryId) return;
    const saved = await api.saveFeedDetails(feedId, {
      title: details.title,
      feed_url: details.feed_url,
      site_url: details.site_url,
      cat_id: categoryId === 0 ? null : categoryId,
      update_interval: details.update_interval,
      purge_interval: details.purge_interval,
      auth_login: details.auth_login,
      auth_pass: details.auth_pass,
      private: details.private,
      include_in_digest: details.include_in_digest,
      cache_images: details.cache_images,
      hide_images: details.hide_images,
      always_display_enclosures: details.always_display_enclosures,
      mark_unread_on_update: details.mark_unread_on_update,
      feed_language: details.feed_language,
    });
    if (saved.status === 0) {
      await feedsStore.loadFeeds();
      showMessage('Feed moved', 'success');
    } else {
      showMessage(saved.error ?? 'Failed to move feed', 'error');
    }
  } catch {
    showMessage('Failed to move feed', 'error');
  }
};

// Handlers
const handleFeedSelect = async (feedId: number | string, isCat: boolean) => {
  sidebarOpen.value = false;
  feedsStore.selectFeed(feedId, isCat);
  await headlinesStore.loadHeadlines(feedId, isCat);
};

const handleToolbarAction = async (action: string, payload?: string | number | object) => {
  const feedId = feedsStore.currentFeedId;
  const isCat = feedsStore.currentIsCat;

  switch (action) {
    case 'refresh':
      await Promise.all([feedsStore.loadFeeds(), headlinesStore.loadHeadlines(feedId, isCat)]);
      break;
    case 'catchup':
      showMessage('Marking feed as read...', 'info');
      if (await feedsStore.catchupFeed(feedId, isCat)) {
        await headlinesStore.loadHeadlines(feedId, isCat);
        showMessage('Feed marked as read', 'success');
      } else {
        showMessage('Failed to mark feed as read', 'error');
      }
      break;
    case 'search': {
      // The toolbar sends {query, language} so the stemming language always
      // reaches the backend (an empty one matches nothing).
      const query = typeof payload === 'string' ? payload : payload?.query;
      const language = typeof payload === 'object' && payload !== null ? payload.language : undefined;
      if (typeof query === 'string' && query.trim()) {
        await headlinesStore.search(query.trim(), feedId, isCat, language);
        showMessage(`Searching for "${query}"`, 'info');
      } else {
        headlinesStore.setSearchQuery('');
        await headlinesStore.loadHeadlines(feedId, isCat);
      }
      break;
    }
    case 'searchLanguage':
      if (typeof payload === 'string') headlinesStore.searchLanguage = payload;
      break;
    case 'viewMode':
      if (typeof payload === 'string') {
        headlinesStore.setViewMode(payload as 'adaptive' | 'all_articles' | 'unread');
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

const handleHeadlineSelect = async (headline: Headline) => {
  selectedIndex.value = headlinesStore.headlines.findIndex((entry) => entry.id === headline.id);
  // loadArticle promotes the loaded headline and persists the read state,
  // updating feed counters itself.
  await headlinesStore.loadArticle(headline.id);
};

/** Keyboard navigation over the currently loaded headlines. */
const currentHeadline = computed<Headline | null>(
  () => headlinesStore.headlines[selectedIndex.value] ?? null
);

const moveSelection = (delta: number) => {
  const count = headlinesStore.headlines.length;
  if (count === 0) return;
  const next = Math.min(count - 1, Math.max(0, selectedIndex.value + delta));
  selectedIndex.value = next;
};

const focusSearch = () => {
  const input = document.querySelector<HTMLInputElement>('.toolbar .search-input input');
  input?.focus();
  input?.select();
};

const openCurrent = async () => {
  const headline = currentHeadline.value;
  if (headline) await handleHeadlineSelect(headline);
};

const toggleCurrent = async (action: 'read' | 'star' | 'publish') => {
  const headline = currentHeadline.value;
  if (!headline) return;
  if (action === 'read') {
    await handleHeadlineAction(headline, 'toggle_read');
  } else if (action === 'star') {
    await handleHeadlineAction(headline, 'toggle_star');
  } else {
    await handleHeadlineAction(headline, 'toggle_publish');
  }
};

useKeyboard({
  onNext: () => moveSelection(1),
  onPrevious: () => moveSelection(-1),
  onSelect: () => void openCurrent(),
  onOpenArticle: () => void openCurrent(),
  onToggleRead: () => void toggleCurrent('read'),
  onToggleStar: () => void toggleCurrent('star'),
  onTogglePublish: () => void toggleCurrent('publish'),
  onRefresh: () => void handleToolbarAction('refresh'),
  onSearch: focusSearch,
  onCatchup: () => void handleToolbarAction('catchup'),
  onHelp: () => {
    helpOpen.value = true;
  },
});

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

// Lifecycle
onMounted(async () => {
  // The PHP shell only serves this page to an authenticated session, so a
  // readable CSRF token means we are already logged in. The shell also passes
  // the login name and the requested view (index.php vs prefs.php).
  const authenticated = await api.checkSession();
  if (authenticated) {
    authStore.setLoggedIn(true, window.__ttrss_user ?? '');
    await Promise.all([feedsStore.loadFeeds(), labelsStore.loadLabels(), loadSearchLanguages()]);
    startPolling();

    if (window.__ttrss_view === 'preferences') {
      openPreferences(window.__ttrss_prefs_tab || 'general');
    }
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
