/**
 * Filters Store - Pinia store for content filter management.
 *
 * Filters are list-based (not nested like the Dojo tree): the backend returns
 * them ordered by `order_id`, and reordering is expressed by sending the new
 * id sequence to `savefilterorder`.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../api/client';
import type { FilterDetails, FilterRule, FilterAction } from '../api/legacyEndpoints';

export interface FilterSummary {
  id: number;
  /** Short caption (`bare_name`); may be empty for uncaptioned filters. */
  title: string;
  /** Longer summary, e.g. "My filter (2 rules), matches any rule". */
  summary: string;
  /** Rendered action list as an HTML fragment (legacy `param`). */
  actionsHtml: string;
  enabled: boolean;
  lastTriggered: string | null;
}

/** The fields the editor submits; rules/actions are the full records. */
export interface FilterDraft {
  title: string;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  rules: FilterRule[];
  actions: FilterAction[];
}

function adaptFilter(raw: Record<string, unknown>): FilterSummary {
  return {
    id: Number(raw.bare_id ?? raw.id ?? 0),
    title: String(raw.bare_name ?? raw.name ?? ''),
    summary: String(raw.name ?? ''),
    actionsHtml: String(raw.param ?? ''),
    enabled: raw.enabled !== false,
    lastTriggered: raw.last_triggered === null || raw.last_triggered === undefined
      ? null
      : String(raw.last_triggered),
  };
}

export const useFiltersStore = defineStore('filters', () => {
  const filters = ref<FilterSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const selectedIds = computed(() => filters.value.filter(f => f.enabled).map(f => f.id));

  async function loadFilters(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.getFilters();
      if (response.status === 0) {
        filters.value = response.content.map(adaptFilter);
      } else {
        error.value = response.error ?? 'Failed to load filters';
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading.value = false;
    }
  }

  /** Load a filter's full definition for the editor; `id=0` means "new". */
  async function loadDetails(filterId: number): Promise<FilterDetails | null> {
    const response = await api.getFilterDetails(filterId);
    if (response.status === 0) return response.content;
    error.value = response.error ?? 'Failed to load filter';
    return null;
  }

  async function saveFilter(filterId: number, draft: FilterDraft): Promise<boolean> {
    const response = filterId
      ? await api.saveFilter(filterId, draft)
      : await api.addFilter(draft);

    if (response.status === 0) {
      await loadFilters();
      return true;
    }
    error.value = response.error ?? 'Failed to save filter';
    return false;
  }

  async function removeFilters(filterIds: number[]): Promise<boolean> {
    const response = await api.deleteFilters(filterIds);
    if (response.status === 0) {
      filters.value = filters.value.filter(f => !filterIds.includes(f.id));
      return true;
    }
    error.value = response.error ?? 'Failed to remove filters';
    return false;
  }

  async function cloneFilters(filterIds: number[], newTitle?: string): Promise<boolean> {
    const response = await api.cloneFilters(filterIds, newTitle);
    if (response.status === 0) {
      await loadFilters();
      return true;
    }
    error.value = response.error ?? 'Failed to clone filters';
    return false;
  }

  async function joinFilters(filterIds: number[]): Promise<boolean> {
    const response = await api.joinFilters(filterIds);
    if (response.status === 0) {
      await loadFilters();
      return true;
    }
    error.value = response.error ?? 'Failed to combine filters';
    return false;
  }

  async function resetOrder(): Promise<boolean> {
    const response = await api.resetFilterOrder();
    if (response.status === 0) {
      await loadFilters();
      return true;
    }
    error.value = response.error ?? 'Failed to reset filter order';
    return false;
  }

  /** Persist a new ordering of filter ids. */
  async function saveOrder(order: number[]): Promise<boolean> {
    const response = await api.saveFilterOrder(order);
    if (response.status === 0) {
      // Reorder locally so the UI reflects the drop without a round trip.
      const byId = new Map(filters.value.map(f => [f.id, f]));
      filters.value = order.map(id => byId.get(id)).filter((f): f is FilterSummary => f !== undefined);
      return true;
    }
    error.value = response.error ?? 'Failed to save filter order';
    return false;
  }

  function reset(): void {
    filters.value = [];
    error.value = null;
  }

  return {
    filters,
    loading,
    error,
    selectedIds,
    loadFilters,
    loadDetails,
    saveFilter,
    removeFilters,
    cloneFilters,
    joinFilters,
    resetOrder,
    saveOrder,
    reset,
  };
});
