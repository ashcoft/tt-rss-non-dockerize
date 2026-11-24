/**
 * Headlines Store - Pinia store for headlines and articles management
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../api/client';
import { useFeedsStore } from './feeds';

export interface Headline {
  id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  excerpt: string;
  updated: string;
  updated_long: string;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  labels: unknown[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  comments_link: string;
  author: string;
  score: number;
  note: string;
  feed_site_url?: string;
  feed_has_icon?: boolean;
  lang?: string;
  imported?: string;
  pluginLeftButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
}

export interface Article {
  id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  excerpt: string;
  updated: string;
  updated_long: string;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  labels: unknown[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  comments_link: string;
  author: string;
  score: number;
  note: string;
  feed_site_url?: string;
  feed_has_icon?: boolean;
  lang?: string;
  imported?: string;
  pluginLeftButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
  pluginButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
  enclosures?: Array<{
    content_url: string;
    content_type: string;
    title: string;
    duration: string;
    width: number;
    height: number;
  }>;
  image_preview?: string;
  feed_bg_color?: string;
}

/**
 * Where the cursor should land. With no current position, a forward move starts
 * at the first entry and a backward move at the last; otherwise it is clamped
 * to the list bounds.
 */
function resolveCursorTarget(current: number, delta: number, length: number): number {
  if (current === -1) {
    return delta > 0 ? 0 : length - 1;
  }

  return Math.min(length - 1, Math.max(0, current + delta));
}

/**
 * Tag autocomplete suggestions for the tag editor. Stateless, so it lives
 * outside the store.
 */
async function suggestTags(search: string): Promise<string[]> {
  const response = await api.completeTags(search);
  return response.status === 0 ? response.content : [];
}

/** Assign or unassign a label on a single article. Stateless. */
async function assignLabel(labelId: number, articleId: number, assign: 0 | 1): Promise<void> {
  try {
    await api.setLabelForArticles(labelId, [articleId], assign);
  } catch (err) {
    console.error('Failed to assign label:', err);
    throw err;
  }
}

export const useHeadlinesStore = defineStore('headlines', () => {
  // State
  const headlines = ref<Headline[]>([]);
  const selectedArticle = ref<Article | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  /** Empty-state text from Feeds/view (not an error, e.g. "No articles found"). */
  const notice = ref<string | null>(null);
  /** The current feed's last update error, from the toolbar payload. */
  const feedError = ref<string | null>(null);
  /** The current feed's site URL, from the toolbar payload. */
  const feedSiteUrl = ref('');
  /** Plugin entries for the headlines Select menu. */
  const pluginMenuItems = ref<Array<{ value: string; title: string; separator: boolean }>>([]);
  /** True when the list mixes several feeds (a virtual feed). */
  const isVfeed = ref(false);
  /** Feeds/view reports that the first article changed while paging. */
  const firstIdChanged = ref(false);
  const viewMode = ref<string>('adaptive');
  /** Feeds/view `order_by`; must be one of default/feed_dates/date_reverse/title. */
  const orderBy = ref<string>('default');
  const searchQuery = ref('');
  // Search needs a PostgreSQL text-search config name; the backend turns an
  // empty one into a query that matches nothing. Populated from Feeds/search.
  const searchLanguage = ref('english');
  const hasMore = ref(false);
  const skip = ref(0);
  const pageSize = 30;
  /** Id of the headline under the keyboard cursor, if any. */
  const cursorId = ref<number | null>(null);
  /** Ids checked via the per-row selection checkbox. */
  const selectedHeadlineIds = ref<Set<number>>(new Set());
  /** Original content saved while af_readability full text is shown. */
  const fullTextOriginal = new Map<number, string>();

  // Getters
  const unreadCount = computed(() => {
    return headlines.value.filter(h => !h.is_read).length;
  });

  const selectionCount = computed(() => selectedHeadlineIds.value.size);

  const selectedHeadline = computed(() => {
    return headlines.value.find(h => h.id === selectedArticle.value?.id);
  });

  const cursorIndex = computed(() => {
    if (cursorId.value === null) return -1;
    return headlines.value.findIndex(h => h.id === cursorId.value);
  });

  const cursorHeadline = computed(() => {
    if (cursorId.value === null) return null;
    return headlines.value.find(h => h.id === cursorId.value) ?? null;
  });

  /** Move the keyboard cursor by `delta` entries, clamped to the list. */
  function moveCursor(delta: number): Headline | null {
    if (headlines.value.length === 0) return null;

    const next = resolveCursorTarget(cursorIndex.value, delta, headlines.value.length);
    const target = headlines.value.at(next);

    if (target === undefined) {
      return null;
    }

    cursorId.value = target.id;
    return cursorHeadline.value;
  }

  function setCursor(articleId: number | null) {
    cursorId.value = articleId;
  }

  /**
   * Ids of the unread headlines strictly above (`above = true`) or below the
   * given article, mirroring the legacy "Mark above/below as read" action.
   */
  function unreadRelativeTo(articleId: number, above: boolean): number[] {
    const index = headlines.value.findIndex(h => h.id === articleId);
    if (index === -1) return [];
    const slice = above ? headlines.value.slice(0, index) : headlines.value.slice(index + 1);
    return slice.filter(h => !h.is_read).map(h => h.id);
  }

  // Actions
  function toggleHeadlineSelected(id: number, checked: boolean): void {
    const next = new Set(selectedHeadlineIds.value);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    selectedHeadlineIds.value = next;
  }

  /** Apply the legacy Select menu's All/Unread/Invert/None modes. */
  function selectHeadlinesBy(mode: string): void {
    if (mode === 'all') {
      selectedHeadlineIds.value = new Set(headlines.value.map(h => h.id));
    } else if (mode === 'none') {
      selectedHeadlineIds.value = new Set();
    } else if (mode === 'unread') {
      selectedHeadlineIds.value = new Set(
        headlines.value.filter(h => !h.is_read).map(h => h.id)
      );
    } else if (mode === 'marked') {
      selectedHeadlineIds.value = new Set(
        headlines.value.filter(h => h.is_marked).map(h => h.id)
      );
    } else if (mode === 'published') {
      selectedHeadlineIds.value = new Set(
        headlines.value.filter(h => h.is_published).map(h => h.id)
      );
    } else if (mode === 'invert') {
      const next = new Set<number>();
      for (const headline of headlines.value) {
        if (!selectedHeadlineIds.value.has(headline.id)) next.add(headline.id);
      }
      selectedHeadlineIds.value = next;
    }
  }

  function clearHeadlineSelection(): void {
    selectedHeadlineIds.value = new Set();
  }

  // Selecting feeds quickly can leave an older Feeds/view request in flight;
  // only the newest request may write the list.
  let loadSequence = 0;

  async function loadHeadlines(feedId: number | string, isCat: boolean = false, forceUpdate: boolean = false) {
    const sequence = ++loadSequence;
    loading.value = true;
    error.value = null;
    notice.value = null;
    skip.value = 0;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        skip: 0,
        search: searchQuery.value,
        searchLanguage: searchLanguage.value,
        orderBy: orderBy.value,
        firstId: headlines.value[0]?.id,
        forceUpdate,
      });

      if (sequence !== loadSequence) return;

      if (response.status === 0) {
        headlines.value = response.content.headlines;
        fullTextOriginal.clear();
        // A fresh page invalidates any previous cursor position and selection.
        cursorId.value = headlines.value[0]?.id ?? null;
        selectedHeadlineIds.value = new Set();
        // Feeds/view hardcodes a page size of 30 and does not accept `limit`.
        hasMore.value = response.content.headlines.length >= pageSize;
        notice.value = response.content.message;
        feedError.value = response.content.feedError;
        feedSiteUrl.value = response.content.feedSiteUrl;
        pluginMenuItems.value = response.content.pluginMenuItems;
        isVfeed.value = response.content.isVfeed;
        firstIdChanged.value = response.content.firstIdChanged;
      } else {
        error.value = response.error ?? 'Failed to load headlines';
      }
    } catch (err) {
      if (sequence !== loadSequence) return;
      error.value = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to load headlines:', err);
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }

  async function loadMore(feedId: number | string, isCat: boolean = false) {
    if (loadingMore.value || !hasMore.value) return;

    const sequence = loadSequence;
    loadingMore.value = true;

    // Unread-only views drop rows from the result set as they are marked read
    // (including read-on-scroll), so the next offset must be the number of
    // loaded rows that still match the view, not a fixed page counter.
    const unreadOnly = viewMode.value === 'adaptive' || viewMode.value === 'unread';
    const offset = unreadOnly
      ? headlines.value.filter(headline => !headline.is_read).length
      : headlines.value.length;
    skip.value = offset;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        skip: offset,
        search: searchQuery.value,
        searchLanguage: searchLanguage.value,
        orderBy: orderBy.value,
        firstId: headlines.value[0]?.id,
      });

      if (sequence !== loadSequence) return;

      if (response.status === 0) {
        const newHeadlines = response.content.headlines;
        const existing = new Set(headlines.value.map(headline => headline.id));
        const unique = newHeadlines.filter(headline => !existing.has(headline.id));

        headlines.value.push(...unique);
        firstIdChanged.value = response.content.firstIdChanged;
        // Only continue if we got a full page of results.
        hasMore.value = newHeadlines.length >= pageSize;
      } else {
        console.warn('Load more returned non-success status:', response.status);
        hasMore.value = false;
      }
    } catch (err) {
      console.error('Failed to load more headlines:', err);
    } finally {
      if (sequence === loadSequence) loadingMore.value = false;
    }
  }

  async function loadArticle(articleId: number) {
    error.value = null;

    try {
      // The legacy backend returns full article content with the headline
      // list, so there is no per-article fetch. Promote the already-loaded
      // headline into the selected article and persist the read state.
      const headline = headlines.value.find(h => h.id === articleId);
      if (!headline) {
        error.value = 'Article is not loaded in the current headline list.';
        return;
      }

      const article: Article = { ...headline };
      selectedArticle.value = article;

      if (!headline.is_read) {
        const feedsStore = useFeedsStore();
        // Optimistically update local state first
        headline.is_read = true;
        article.is_read = true;
        feedsStore.updateFeedUnread(headline.feed_id, -1);

        try {
          await markAsRead([articleId]);
        } catch {
          // Revert the optimistic update if the API rejects. Compare against
          // the captured reference: the user may have opened another article
          // while this request was in flight.
          headline.is_read = false;

          if (selectedArticle.value === article) {
            article.is_read = false;
          }

          feedsStore.updateFeedUnread(headline.feed_id, 1);
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to load article:', err);
    }
  }

  async function markAsRead(articleIds: number[]) {
    try {
      await api.catchupArticles(articleIds, 0);
      
      const feedsStore = useFeedsStore();
      const feedUnreadDeltas = new Map<number, number>();
      
      // Update local state and track feed unread changes
      articleIds.forEach(id => {
        const headline = headlines.value.find(h => h.id === id);
        if (headline && !headline.is_read) {
          headline.is_read = true;
          const delta = feedUnreadDeltas.get(headline.feed_id) || 0;
          feedUnreadDeltas.set(headline.feed_id, delta - 1);
        }
      });
      
      // Update feed unread counts
      feedUnreadDeltas.forEach((delta, feedId) => {
        feedsStore.updateFeedUnread(feedId, delta);
      });
      void feedsStore.refreshCounters();
    } catch (err) {
      console.error('Failed to mark as read:', err);
      throw err;
    }
  }

  async function markAsUnread(articleIds: number[]) {
    try {
      await api.catchupArticles(articleIds, 1);
      
      const feedsStore = useFeedsStore();
      const feedUnreadDeltas = new Map<number, number>();
      
      articleIds.forEach(id => {
        const headline = headlines.value.find(h => h.id === id);
        if (headline && headline.is_read) {
          headline.is_read = false;
          const delta = feedUnreadDeltas.get(headline.feed_id) || 0;
          feedUnreadDeltas.set(headline.feed_id, delta + 1);
        }
      });
      
      // Update feed unread counts
      feedUnreadDeltas.forEach((delta, feedId) => {
        feedsStore.updateFeedUnread(feedId, delta);
      });
      void feedsStore.refreshCounters();
    } catch (err) {
      console.error('Failed to mark as unread:', err);
      throw err;
    }
  }

  async function toggleStar(articleId: number) {
    const headline = headlines.value.find(h => h.id === articleId);
    if (!headline) return;

    const newValue = !headline.is_marked;

    try {
      await api.markArticles([articleId], newValue ? 2 : 0);
      headline.is_marked = newValue;
      
      if (selectedArticle.value?.id === articleId) {
        selectedArticle.value.is_marked = newValue;
      }
      void useFeedsStore().refreshCounters();
    } catch (err) {
      console.error('Failed to toggle star:', err);
    }
  }

  async function togglePublish(articleId: number) {
    const headline = headlines.value.find(h => h.id === articleId);
    if (!headline) return;

    const newValue = !headline.is_published;

    try {
      await api.publishArticles([articleId], newValue ? 2 : 0);
      headline.is_published = newValue;
      
      if (selectedArticle.value?.id === articleId) {
        selectedArticle.value.is_published = newValue;
      }
      void useFeedsStore().refreshCounters();
    } catch (err) {
      console.error('Failed to toggle publish:', err);
    }
  }

  /** Toggle af_readability full text for an article, caching the original. */
  async function toggleFullText(articleId: number): Promise<void> {
    const headline = headlines.value.find(h => h.id === articleId);
    if (!headline) return;

    const original = fullTextOriginal.get(articleId);
    if (original !== undefined) {
      headline.content = original;
      fullTextOriginal.delete(articleId);
    } else {
      const response = await api.getFullText(articleId);
      if (response.status !== 0 || !response.content) {
        throw new Error(response.error ?? 'af_readability did not return any content.');
      }
      fullTextOriginal.set(articleId, headline.content);
      headline.content = response.content;
    }

    if (selectedArticle.value?.id === articleId) {
      selectedArticle.value.content = headline.content;
    }
  }

  async function deleteArticle(articleId: number) {
    try {
      await api.deleteArticles([articleId]);
      
      const feedsStore = useFeedsStore();
      const headline = headlines.value.find(h => h.id === articleId);
      
      // Update feed unread count if deleting an unread article
      if (headline && !headline.is_read) {
        feedsStore.updateFeedUnread(headline.feed_id, -1);
      }
      
      // Remove from headlines
      const index = headlines.value.findIndex(h => h.id === articleId);
      if (index > -1) {
        headlines.value.splice(index, 1);
      }
      
      // Clear selected if same article
      if (selectedArticle.value?.id === articleId) {
        selectedArticle.value = null;
      }
      void feedsStore.refreshCounters();
    } catch (err) {
      console.error('Failed to delete article:', err);
      throw err;
    }
  }

  /**
   * Toggle the starred flag on each given article, based on its current state.
   *
   * `RPC/markSelected` applies one mode to the whole id list, so a mixed
   * selection is split into the ids to star and the ids to unstar.
   */
  async function toggleStarred(articleIds: number[]): Promise<void> {
    const ids = new Set(articleIds);
    const toStar = headlines.value.filter(h => ids.has(h.id) && !h.is_marked).map(h => h.id);
    const toUnstar = headlines.value.filter(h => ids.has(h.id) && h.is_marked).map(h => h.id);
    try {
      if (toStar.length > 0) await api.markArticles(toStar, 2);
      if (toUnstar.length > 0) await api.markArticles(toUnstar, 0);
      for (const headline of headlines.value) {
        if (ids.has(headline.id)) headline.is_marked = !headline.is_marked;
      }
      if (selectedArticle.value && ids.has(selectedArticle.value.id)) {
        selectedArticle.value.is_marked = !selectedArticle.value.is_marked;
      }
      void useFeedsStore().refreshCounters();
    } catch (err) {
      console.error('Failed to toggle starred:', err);
      throw err;
    }
  }

  /** Toggle the published flag on each given article, based on its state. */
  async function togglePublished(articleIds: number[]): Promise<void> {
    const ids = new Set(articleIds);
    const toPublish = headlines.value.filter(h => ids.has(h.id) && !h.is_published).map(h => h.id);
    const toUnpublish = headlines.value.filter(h => ids.has(h.id) && h.is_published).map(h => h.id);
    try {
      if (toPublish.length > 0) await api.publishArticles(toPublish, 2);
      if (toUnpublish.length > 0) await api.publishArticles(toUnpublish, 0);
      for (const headline of headlines.value) {
        if (ids.has(headline.id)) headline.is_published = !headline.is_published;
      }
      if (selectedArticle.value && ids.has(selectedArticle.value.id)) {
        selectedArticle.value.is_published = !selectedArticle.value.is_published;
      }
      void useFeedsStore().refreshCounters();
    } catch (err) {
      console.error('Failed to toggle published:', err);
      throw err;
    }
  }

  /**
   * Toggle the unread flag on each given article, based on its current state.
   * A mixed selection is split so each article flips individually.
   */
  async function toggleUnread(articleIds: number[]): Promise<void> {
    const ids = new Set(articleIds);
    const toRead = headlines.value.filter(h => ids.has(h.id) && !h.is_read).map(h => h.id);
    const toUnread = headlines.value.filter(h => ids.has(h.id) && h.is_read).map(h => h.id);
    if (toRead.length > 0) await markAsRead(toRead);
    if (toUnread.length > 0) await markAsUnread(toUnread);
  }

  /** Permanently delete several articles in one request. */
  async function deleteArticles(articleIds: number[]): Promise<void> {
    if (articleIds.length === 0) return;
    try {
      await api.deleteArticles(articleIds);

      const feedsStore = useFeedsStore();
      const ids = new Set(articleIds);

      // Adjust feed unread counts for the unread articles being removed.
      const deltas = new Map<number, number>();
      for (const headline of headlines.value) {
        if (!ids.has(headline.id) || headline.is_read) continue;
        deltas.set(headline.feed_id, (deltas.get(headline.feed_id) ?? 0) - 1);
      }
      deltas.forEach((delta, feedId) => feedsStore.updateFeedUnread(feedId, delta));

      headlines.value = headlines.value.filter(h => !ids.has(h.id));

      if (selectedArticle.value && ids.has(selectedArticle.value.id)) {
        selectedArticle.value = null;
      }
      void feedsStore.refreshCounters();
    } catch (err) {
      console.error('Failed to delete articles:', err);
      throw err;
    }
  }

  async function updateNote(articleId: number, note: string) {
    try {
      await api.updateArticleNote(articleId, note);
      
      const headline = headlines.value.find(h => h.id === articleId);
      if (headline) {
        headline.note = note;
      }
      
      if (selectedArticle.value?.id === articleId) {
        selectedArticle.value.note = note;
      }
    } catch (err) {
      console.error('Failed to update note:', err);
      throw err;
    }
  }

  function setViewMode(mode: string) {
    viewMode.value = mode;
  }

  function setOrderBy(order: string) {
    orderBy.value = order;
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query;
  }

  function clearSelection() {
    selectedArticle.value = null;
  }

  /**
   * Mark every loaded headline as read (Phase 3).
   */
  async function catchupAll(): Promise<void> {
    try {
      const response = await api.catchupAll();
      if (response.status !== 0) {
        throw new Error(response.error ?? 'Failed to mark all articles as read');
      }
      for (const h of headlines.value) h.is_read = true;
      if (selectedArticle.value) selectedArticle.value.is_read = true;
      void useFeedsStore().refreshCounters();
    } catch (err) {
      console.error('Failed to catch up all:', err);
      throw err;
    }
  }

  /**
   * Execute a search against the currently selected feed (Phase 3).
   */
  async function search(
    query: string,
    feedId: number | string,
    isCat: boolean = false,
    language?: string
  ): Promise<void> {
    searchQuery.value = query;
    if (language) searchLanguage.value = language;
    await loadHeadlines(feedId, isCat);
  }

  /** Load the available search languages from the backend. */
  async function loadSearchOptions(): Promise<{ defaultLanguage: string; allLanguages: string[]; showSyntaxHelp: boolean }> {
    const response = await api.getSearchOptions();
    if (response.status === 0) {
      searchLanguage.value = response.content.defaultLanguage;
      return {
        defaultLanguage: response.content.defaultLanguage,
        allLanguages: response.content.allLanguages,
        showSyntaxHelp: response.content.showSyntaxHelp,
      };
    }
    return { defaultLanguage: searchLanguage.value, allLanguages: [], showSyntaxHelp: true };
  }

  /**
   * Assign or unassign a label to an article (Phase 3).
   */
  /** Replace an article's tag list; the backend normalises and returns it. */
  async function updateTags(articleId: number, tags: string[]): Promise<void> {
    try {
      const response = await api.setArticleTags(articleId, tags);
      if (response.status !== 0) throw new Error(response.error ?? 'Failed to update tags');

      const saved = response.content;
      const headline = headlines.value.find(h => h.id === articleId);
      if (headline) headline.tags = saved;
      if (selectedArticle.value?.id === articleId) selectedArticle.value.tags = saved;
    } catch (err) {
      console.error('Failed to update tags:', err);
      throw err;
    }
  }

  /** Set the score for an article. */
  /** Set the score on several articles at once (one RPC/setArticleScore). */
  async function setScoreFor(articleIds: number[], score: number): Promise<void> {
    if (articleIds.length === 0) return;
    const ids = new Set(articleIds);
    try {
      await api.setArticleScore(articleIds, score);
      for (const headline of headlines.value) {
        if (ids.has(headline.id)) headline.score = score;
      }
      if (selectedArticle.value && ids.has(selectedArticle.value.id)) {
        selectedArticle.value.score = score;
      }
    } catch (err) {
      console.error('Failed to set score:', err);
      throw err;
    }
  }

  async function setScore(articleId: number, score: number): Promise<void> {
    try {
      await api.setArticleScore([articleId], score);
      const headline = headlines.value.find(h => h.id === articleId);
      if (headline) headline.score = score;
      if (selectedArticle.value?.id === articleId) selectedArticle.value.score = score;
    } catch (err) {
      console.error('Failed to set score:', err);
      throw err;
    }
  }

  function reset() {
    headlines.value = [];
    selectedArticle.value = null;
    error.value = null;
    notice.value = null;
    pluginMenuItems.value = [];
    isVfeed.value = false;
    searchQuery.value = '';
    hasMore.value = false;
    skip.value = 0;
    cursorId.value = null;
    selectedHeadlineIds.value = new Set();
    fullTextOriginal.clear();
  }

  return {
    // State
    headlines,
    selectedArticle,
    loading,
    loadingMore,
    error,
    notice,
    feedError,
    feedSiteUrl,
    pluginMenuItems,
    isVfeed,
    firstIdChanged,
    viewMode,
    searchQuery,
    searchLanguage,
    orderBy,
    hasMore,
    cursorId,
    selectedHeadlineIds,

    // Getters
    unreadCount,
    selectionCount,
    selectedHeadline,
    cursorIndex,
    cursorHeadline,
    moveCursor,
    setCursor,
    unreadRelativeTo,
    
    // Actions
    loadHeadlines,
    loadMore,
    loadArticle,
    markAsRead,
    markAsUnread,
    toggleStar,
    togglePublish,
    toggleFullText,
    deleteArticle,
    deleteArticles,
    toggleStarred,
    togglePublished,
    toggleUnread,
    updateNote,
    updateTags,
    suggestTags,
    setScore,
    setScoreFor,
    setViewMode,
    setOrderBy,
    setSearchQuery,
    clearSelection,
    toggleHeadlineSelected,
    selectHeadlinesBy,
    clearHeadlineSelection,
    catchupAll,
    search,
    loadSearchOptions,
    assignLabel,
    reset,
  };
});
