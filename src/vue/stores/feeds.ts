/**
 * Feeds Store - Pinia store for feed and category management
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../api/client';

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

export const useFeedsStore = defineStore('feeds', () => {
  // State
  const feeds = ref<Feed[]>([]);
  const categories = ref<Category[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentFeedId = ref<number | string>(0);
  const currentIsCat = ref(false);

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
    if (typeof currentFeedId.value === 'number' && currentFeedId.value > 0) {
      if (currentIsCat.value) {
        return categories.value.find(c => c.id === currentFeedId.value);
      }
      return feeds.value.find(f => f.id === currentFeedId.value);
    }
    return null;
  });

  // Actions
  async function loadFeeds() {
    loading.value = true;
    error.value = null;
    
    try {
      const response = await api.getFeedTree();
      
      if (response.status === 0) {
        // TypeScript type narrowing - content is guaranteed when status is 0
        const content = response.content;
        const feedData = (content as { feeds?: Feed[]; categories?: Category[] });
        feeds.value = feedData.feeds ?? [];
        categories.value = feedData.categories ?? [];
      } else {
        error.value = 'Failed to load feeds';
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

  function updateCategoryUnread(catId: number, delta: number) {
    const cat = categories.value.find(c => c.id === catId);
    if (cat) {
      cat.unread = Math.max(0, cat.unread + delta);
    }
  }

  function reset() {
    feeds.value = [];
    categories.value = [];
    currentFeedId.value = 0;
    currentIsCat.value = false;
    error.value = null;
  }

  // ============================================
  // Feed & category management (Phase 3)
  // ============================================

  async function addFeed(feedUrl: string, categoryId?: number, title?: string): Promise<boolean> {
    try {
      const response = await api.addFeed(feedUrl, categoryId, title);
      if (response.status === 0) {
        await loadFeeds();
        return true;
      }
      error.value = 'Failed to add feed';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to add feed';
      return false;
    }
  }

  async function removeFeed(feedId: number): Promise<boolean> {
    try {
      const response = await api.deleteFeed(feedId);
      if (response.status === 0) {
        feeds.value = feeds.value.filter(f => f.id !== feedId);
        if (currentFeedId.value === feedId && !currentIsCat.value) {
          currentFeedId.value = 0;
        }
        return true;
      }
      error.value = 'Failed to delete feed';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete feed';
      return false;
    }
  }

  async function purgeFeed(feedId: number): Promise<boolean> {
    try {
      const response = await api.purgeFeed(feedId);
      return response.status === 0;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to purge feed';
      return false;
    }
  }

  async function createCategory(title: string, parentId?: number): Promise<boolean> {
    try {
      const response = await api.createCategory(title, parentId);
      if (response.status === 0) {
        await loadFeeds();
        return true;
      }
      error.value = 'Failed to create category';
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
          currentFeedId.value = 0;
          currentIsCat.value = false;
        }
        return true;
      }
      error.value = 'Failed to delete category';
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
   */
  async function catchupFeed(feedId: number | string, isCat: boolean = false): Promise<boolean> {
    try {
      const response = await api.catchupFeed(feedId, isCat);
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

  return {
    // State
    feeds,
    categories,
    loading,
    error,
    currentFeedId,
    currentIsCat,
    
    // Getters
    feedsByCategory,
    totalUnread,
    currentFeed,
    
    // Actions
    loadFeeds,
    selectFeed,
    updateFeedUnread,
    updateCategoryUnread,
    addFeed,
    removeFeed,
    purgeFeed,
    createCategory,
    deleteCategory,
    renameCategory,
    catchupFeed,
    reset,
  };
});
