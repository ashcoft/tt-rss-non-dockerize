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
  updated: number;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
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
  updated: number;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  author: string;
  note: string;
}

export const useHeadlinesStore = defineStore('headlines', () => {
  // State
  const headlines = ref<Headline[]>([]);
  const selectedArticle = ref<Article | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const viewMode = ref<'adaptive' | 'all_articles' | 'unread'>('adaptive');
  const searchQuery = ref('');
  const hasMore = ref(false);
  const skip = ref(0);
  const limit = 30;

  // Getters
  const unreadCount = computed(() => {
    return headlines.value.filter(h => !h.is_read).length;
  });

  const selectedHeadline = computed(() => {
    return headlines.value.find(h => h.id === selectedArticle.value?.id);
  });

  // Actions
  async function loadHeadlines(feedId: number | string, isCat: boolean = false) {
    loading.value = true;
    error.value = null;
    skip.value = 0;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        limit,
        skip: 0,
        search: searchQuery.value,
      });

      if (response.status === 0) {
        // TypeScript type narrowing - content is guaranteed when status is 0
        const content = response.content;
        const headlineData = (content as { headlines?: Headline[] });
        headlines.value = headlineData.headlines ?? [];
        hasMore.value = headlines.value.length >= limit;
      } else {
        error.value = 'Failed to load headlines';
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
    skip.value += limit;

    try {
      const response = await api.getHeadlines(feedId, {
        isCat,
        viewMode: viewMode.value,
        limit,
        skip: skip.value,
        search: searchQuery.value,
      });

      if (response.status === 0) {
        // TypeScript type narrowing - content is guaranteed when status is 0
        const content = response.content;
        const headlineData = (content as { headlines?: Headline[] });
        const newHeadlines = headlineData.headlines ?? [];
        headlines.value.push(...newHeadlines);
        // Only continue if we got a full page of results
        hasMore.value = newHeadlines.length === limit;
      } else {
        console.warn('Load more returned non-success status:', response.status);
        skip.value -= limit; // Revert skip on failure status
        hasMore.value = false; // Stop pagination on failure
      }
    } catch (err) {
      console.error('Failed to load more headlines:', err);
      skip.value -= limit; // Revert skip on error
    } finally {
      loadingMore.value = false;
    }
  }

  async function loadArticle(articleId: number) {
    error.value = null;

    try {
      const response = await api.getArticle(articleId);

                  if (response.status === 0) {
        // Map API's article shape onto the store Article type.
        // Backend returns `is_starred`; the store uses `is_marked`.
        const data = response.content as unknown as {
          id: number;
          guid: string;
          title: string;
          link: string;
          content: string;
          excerpt: string;
          updated: number;
          is_marked: boolean;
          is_read: boolean;
          is_published: boolean;
          tags: string[];
          feed_id: number;
          feed_title: string;
          comments_count: number;
          author: string;
          note: string;
          score?: number;
        };
        selectedArticle.value = {
          ...data,
                    is_marked: data.is_marked ?? false,
        };
        
        // Mark as read on backend when an unread headline is opened
        const headline = headlines.value.find(h => h.id === articleId);
        if (headline && !headline.is_read) {
          // Optimistically update local state first
          headline.is_read = true;
          const feedsStore = useFeedsStore();
          feedsStore.updateFeedUnread(headline.feed_id, -1);
          
          // Then persist to backend
          try {
            await markAsRead([articleId]);
          } catch {
            // Revert optimistic update if API fails
            headline.is_read = false;
            feedsStore.updateFeedUnread(headline.feed_id, 1);
          }
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

  function setViewMode(mode: 'adaptive' | 'all_articles' | 'unread') {
    viewMode.value = mode;
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
    const ids = headlines.value.filter(h => !h.is_read).map(h => h.id);
    if (ids.length === 0) return;
    try {
      await api.catchupArticles(ids, 1);
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
  async function search(query: string, feedId: number | string, isCat: boolean = false): Promise<void> {
    searchQuery.value = query;
    await loadHeadlines(feedId, isCat);
  }

  /**
   * Assign or unassign a label to an article (Phase 3).
   */
  async function assignLabel(labelId: number, articleId: number, assign: 0 | 1): Promise<void> {
    try {
      await api.setLabelForArticles(labelId, [articleId], assign);
    } catch (err) {
      console.error('Failed to assign label:', err);
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
    hasMore,
    
    // Getters
    unreadCount,
    selectedHeadline,
    
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
    setViewMode,
    setSearchQuery,
    clearSelection,
    catchupAll,
    search,
    assignLabel,
    reset,
  };
});
