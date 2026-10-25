/**
 * Tiny Tiny RSS API client.
 *
 * This client targets the legacy `backend.php` dispatch used by the Dojo UI,
 * not the external JSON API under `/api/`. See `legacy.ts` for the transport
 * rules (POST-only, CSRF in the body, non-uniform responses) and
 * `legacyEndpoints.ts` for the per-handler response mappings.
 *
 * Every method resolves to the `{status, content}` envelope the stores were
 * written against: `status === 0` means success. Backend-reported and
 * transport errors come back as `status === 1` with an `error` message, so the
 * stores' existing `status` checks keep working. Unsupported operations throw
 * so they surface as bugs rather than silent failures.
 */

import legacyBackend, {
  LegacyApiError,
  LegacyProtocolError,
  fetchCsrfToken,
} from './legacy';
import * as endpoints from './legacyEndpoints';

export interface ApiResponse<T = unknown> {
  status: number;
  content: T;
  error?: string;
}

export type {
  AdaptedFeed as Feed,
  AdaptedCategory as Category,
  AdaptedLabel as Label,
  AdaptedHeadline as Headline,
  HeadlinesPage,
} from './legacyEndpoints';

class ApiClient {
  /**
   * Capture the session CSRF token from the shell (or the `__csrf_token`
   * global). Safe to call repeatedly.
   */
  async initCsrfToken(): Promise<string> {
    return legacyBackend.ensureCsrfToken();
  }

  /** True when a usable, authenticated session is present. */
  async checkSession(): Promise<boolean> {
    try {
      await fetchCsrfToken();
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Authentication
  // ============================================

  /**
   * Sign in through the legacy public handler. The endpoint answers with a
   * redirect rather than JSON, so success is inferred from the resulting
   * session: the CSRF token is re-read from the shell afterwards.
   */
  async login(username: string, password: string): Promise<ApiResponse<boolean>> {
    const body = new URLSearchParams({ login: username, password });
    const response = await fetch('/public.php?op=login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      return { status: 1, content: false, error: `Login failed (HTTP ${response.status}).` };
    }

    try {
      const token = await fetchCsrfToken();
      legacyBackend.setCsrfToken(token);
      return { status: 0, content: true };
    } catch {
      return { status: 1, content: false, error: 'Invalid username or password' };
    }
  }

  async logout(): Promise<ApiResponse<boolean>> {
    const token = await legacyBackend.ensureCsrfToken();
    const body = new URLSearchParams({ op: 'logout', csrf_token: token });
    const response = await fetch('/public.php', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return { status: response.ok ? 0 : 1, content: response.ok };
  }

  // ============================================
  // Feeds & categories
  // ============================================

  async getFeedTree(): Promise<
    ApiResponse<{ feeds: endpoints.AdaptedFeed[]; categories: endpoints.AdaptedCategory[] }>
  > {
    return this.wrap(() => endpoints.getFeedTree(legacyBackend), { feeds: [], categories: [] });
  }

  async addFeed(feedUrl: string, categoryId = 0): Promise<ApiResponse<{ code: number }>> {
    return this.wrap(async () => {
      const result = await endpoints.addFeed(legacyBackend, feedUrl, categoryId);
      return { code: result.code };
    }, { code: -1 });
  }

  async deleteFeed(feedId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeFeed(legacyBackend, feedId);
      return true;
    }, false);
  }

  async getFeedDetails(feedId: number): Promise<ApiResponse<endpoints.FeedDetails | null>> {
    return this.wrap(() => endpoints.getFeedDetails(legacyBackend, feedId), null);
  }

  async saveFeed(
    feedId: number,
    changes: Partial<Omit<endpoints.FeedDetails, 'id'>>
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFeed(legacyBackend, feedId, changes);
      return true;
    }, false);
  }

  purgeFeed(): Promise<ApiResponse<boolean>> {
    // Always rejects: purging is a CLI operation (see legacyEndpoints.purgeFeed).
    return this.wrap(() => Promise.resolve(endpoints.purgeFeed()), false);
  }

  async catchupFeed(feedId: number | string, isCat = false): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.catchupFeed(legacyBackend, feedId, isCat);
      return true;
    }, false);
  }

  async catchupAll(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.catchupAll(legacyBackend);
      return true;
    }, false);
  }

  async createCategory(title: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.addCategory(legacyBackend, title);
      return true;
    }, false);
  }

  async deleteCategory(categoryId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeCategory(legacyBackend, categoryId);
      return true;
    }, false);
  }

  async renameCategory(categoryId: number, title: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.renameCategory(legacyBackend, categoryId, title);
      return true;
    }, false);
  }

  // ============================================
  // Headlines
  // ============================================

  async getHeadlines(
    feedId: number | string,
    options: {
      isCat?: boolean;
      // Feeds/view accepts adaptive, all_articles, marked, published, unread,
      // has_note; see the <select name="view_mode"> options in index.php.
      viewMode?: string;
      skip?: number;
      search?: string;
      searchLanguage?: string;
      orderBy?: string;
      forceUpdate?: boolean;
    } = {}
  ): Promise<ApiResponse<endpoints.HeadlinesPage>> {
    return this.wrap(() => endpoints.getHeadlines(legacyBackend, feedId, options), {
      headlines: [],
      count: 0,
      first_id: 0,
      message: null,
    });
  }

  // ============================================
  // Article actions
  // ============================================

  async catchupArticles(articleIds: number[], mode: 0 | 1): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.catchupArticles(legacyBackend, articleIds, mode);
      return true;
    }, false);
  }

  async markArticles(articleIds: number[], mode: 0 | 2): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.markArticles(legacyBackend, articleIds, mode);
      return true;
    }, false);
  }

  async publishArticles(articleIds: number[], mode: 0 | 2): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.publishArticles(legacyBackend, articleIds, mode);
      return true;
    }, false);
  }

  async deleteArticles(articleIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.deleteArticles(legacyBackend, articleIds);
      return true;
    }, false);
  }

  async updateArticleNote(articleId: number, note: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setArticleNote(legacyBackend, articleId, note);
      return true;
    }, false);
  }

  async setArticleTags(articleId: number, tags: string[]): Promise<ApiResponse<string[]>> {
    return this.wrap(() => endpoints.setArticleTags(legacyBackend, articleId, tags), []);
  }

  async completeTags(search: string): Promise<ApiResponse<string[]>> {
    return this.wrap(() => endpoints.completeTags(legacyBackend, search), []);
  }

  async setArticleScore(articleIds: number[], score: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setArticleScore(legacyBackend, articleIds, score);
      return true;
    }, false);
  }

  // ============================================
  // Labels
  // ============================================

  async getLabels(): Promise<ApiResponse<endpoints.AdaptedLabel[]>> {
    return this.wrap(() => endpoints.getLabels(legacyBackend), []);
  }

  async createLabel(caption: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.createLabel(legacyBackend, caption);
      return true;
    }, false);
  }

  async removeLabel(labelId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeLabel(legacyBackend, labelId);
      return true;
    }, false);
  }

  async setLabelForArticles(
    labelId: number,
    articleIds: number[],
    assign: 0 | 1
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setArticleLabel(legacyBackend, labelId, articleIds, assign);
      return true;
    }, false);
  }

  // ============================================
  // Filters
  // ============================================

  async getFilters(): Promise<ApiResponse<Array<Record<string, unknown>>>> {
    return this.wrap(() => endpoints.getFilters(legacyBackend), []);
  }

  async deleteFilter(filterId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeFilter(legacyBackend, filterId);
      return true;
    }, false);
  }

  // ============================================
  // Preferences
  // ============================================

  async getInitParams(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.wrap(() => endpoints.getInitParams(legacyBackend), {});
  }

  async getSearchOptions(): Promise<
    ApiResponse<{ showLanguage: boolean; defaultLanguage: string; allLanguages: string[] }>
  > {
    return this.wrap(() => endpoints.getSearchOptions(legacyBackend), {
      showLanguage: false,
      defaultLanguage: 'english',
      allLanguages: [],
    });
  }

  async setPref(prefName: string, value: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setPref(legacyBackend, prefName, value);
      return true;
    }, false);
  }

  // ============================================
  // Internal
  // ============================================

  /**
   * Run an adapter call and normalise the outcome to `{status, content}`.
   *
   * A `LegacyApiError` (structured backend error) or `LegacyProtocolError`
   * becomes `status: 1`; the latter usually means the session expired
   * mid-flight. Unsupported operations propagate so they are not mistaken for
   * a successful no-op.
   */
  private async wrap<T>(operation: () => Promise<T>, fallback: T): Promise<ApiResponse<T>> {
    try {
      return { status: 0, content: await operation() };
    } catch (error) {
      if (error instanceof LegacyApiError || error instanceof LegacyProtocolError) {
        return { status: 1, content: fallback, error: error.message };
      }
      throw error;
    }
  }
}

export const api = new ApiClient();
export default api;
