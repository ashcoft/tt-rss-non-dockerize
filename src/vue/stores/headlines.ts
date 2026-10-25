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

  // Getters
  const unreadCount = computed(() => {
    return headlines.value.filter(h => !h.is_read).length;
  });

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

  // Actions
  async function loadHeadlines(feedId: number | string, isCat: boolean = false) {
    loading.value = true;
    error.value = null;
    skip.value = 0;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        skip: 0,
        search: searchQuery.value,
        searchLanguage: searchLanguage.value,
        orderBy: orderBy.value,
      });

      if (response.status === 0) {
        headlines.value = response.content.headlines;
        // A fresh page invalidates any previous cursor position.
        cursorId.value = headlines.value[0]?.id ?? null;
        // Feeds/view hardcodes a page size of 30 and does not accept `limit`.
        hasMore.value = response.content.headlines.length >= pageSize;
        if (response.content.message) error.value = response.content.message;
      } else {
        error.value = response.error ?? 'Failed to load headlines';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to load headlines:', err);
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(feedId: number | string, isCat: boolean = false) {
    if (loadingMore.value || !hasMore.value) return;

    loadingMore.value = true;
    skip.value += pageSize;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        skip: skip.value,
        search: searchQuery.value,
        searchLanguage: searchLanguage.value,
        orderBy: orderBy.value,
      });

      if (response.status === 0) {
        const newHeadlines = response.content.headlines;
        headlines.value.push(...newHeadlines);
        // Only continue if we got a full page of results
        hasMore.value = newHeadlines.length >= pageSize;
      } else {
        console.warn('Load more returned non-success status:', response.status);
        skip.value -= pageSize; // Revert skip on failure status
        hasMore.value = false; // Stop pagination on failure
      }
    } catch (err) {
      console.error('Failed to load more headlines:', err);
      skip.value -= pageSize; // Revert skip on error
    } finally {
      loadingMore.value = false;
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

      selectedArticle.value = { ...headline };

      if (!headline.is_read) {
        const feedsStore = useFeedsStore();
        // Optimistically update local state first
        headline.is_read = true;
        selectedArticle.value.is_read = true;
        feedsStore.updateFeedUnread(headline.feed_id, -1);

        try {
          await markAsRead([articleId]);
        } catch {
          // Revert optimistic update if API fails
          headline.is_read = false;

          if (selectedArticle.value !== null) {
            if (selectedArticle.value.id === articleId) {
              selectedArticle.value.is_read = false;
            }
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
    } catch (err) {
      console.error('Failed to toggle publish:', err);
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
    } catch (err) {
      console.error('Failed to delete article:', err);
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
  async function loadSearchOptions(): Promise<{ defaultLanguage: string; allLanguages: string[] }> {
    const response = await api.getSearchOptions();
    if (response.status === 0) {
      searchLanguage.value = response.content.defaultLanguage;
      return {
        defaultLanguage: response.content.defaultLanguage,
        allLanguages: response.content.allLanguages,
      };
    }
    return { defaultLanguage: searchLanguage.value, allLanguages: [] };
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
    searchQuery.value = '';
    hasMore.value = false;
    skip.value = 0;
    cursorId.value = null;
  }

  return {
    // State
    headlines,
    selectedArticle,
    loading,
    loadingMore,
    error,
    viewMode,
    searchQuery,
    searchLanguage,
    orderBy,
    hasMore,
    cursorId,

    // Getters
    unreadCount,
    selectedHeadline,
    cursorIndex,
    cursorHeadline,
    moveCursor,
    setCursor,
    
    // Actions
    loadHeadlines,
    loadMore,
    loadArticle,
    markAsRead,
    markAsUnread,
    toggleStar,
    togglePublish,
    deleteArticle,
    updateNote,
    updateTags,
    suggestTags,
    setScore,
    setViewMode,
    setOrderBy,
    setSearchQuery,
    clearSelection,
    catchupAll,
    search,
    loadSearchOptions,
    assignLabel,
    reset,
  };
});
