/**
 * Labels Store - Pinia store for label management and assignment state
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../api/client';

export interface LabelInfo {
  id: number;
  caption: string;
  fg_color: string;
  bg_color: string;
  unread: number;
}

export const useLabelsStore = defineStore('labels', () => {
  const labels = ref<LabelInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const unreadCount = computed(() =>
    labels.value.reduce((sum, l) => sum + (l.unread ?? 0), 0)
  );

  async function loadLabels(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.getLabels();
      if (response.status === 0) {
        labels.value = (response.content ?? []) as unknown as LabelInfo[];
      } else {
        error.value = 'Failed to load labels';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  function reset(): void {
    labels.value = [];
    error.value = null;
  }

  return { labels, loading, error, unreadCount, loadLabels, reset };
});
