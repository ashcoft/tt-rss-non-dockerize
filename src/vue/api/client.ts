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

  async setLabelColor(labelId: number, kind: 'fg' | 'bg', color: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setLabelColor(legacyBackend, labelId, kind, color);
      return true;
    }, false);
  }

  async resetLabelColors(labelIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetLabelColors(legacyBackend, labelIds);
      return true;
    }, false);
  }

  async renameLabel(labelId: number, caption: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.renameLabel(legacyBackend, labelId, caption), '');
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

  async getFilterDetails(filterId: number): Promise<ApiResponse<endpoints.FilterDetails | null>> {
    return this.wrap(() => endpoints.getFilterDetails(legacyBackend, filterId), null);
  }

  async saveFilter(
    filterId: number,
    details: Parameters<typeof endpoints.saveFilter>[2]
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFilter(legacyBackend, filterId, details);
      return true;
    }, false);
  }

  async addFilter(
    details: Parameters<typeof endpoints.addFilter>[1]
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.addFilter(legacyBackend, details);
      return true;
    }, false);
  }

  async deleteFilters(filterIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeFilters(legacyBackend, filterIds);
      return true;
    }, false);
  }

  async cloneFilters(filterIds: number[], newTitle?: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.cloneFilters(legacyBackend, filterIds, newTitle);
      return true;
    }, false);
  }

  async joinFilters(filterIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.joinFilters(legacyBackend, filterIds);
      return true;
    }, false);
  }

  async resetFilterOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetFilterOrder(legacyBackend);
      return true;
    }, false);
  }

  async saveFilterOrder(order: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFilterOrder(legacyBackend, order);
      return true;
    }, false);
  }

  async testFilter(
    params: Parameters<typeof endpoints.testFilter>[1]
  ): Promise<ApiResponse<{ pre_filtering_count: number; items: Array<Record<string, unknown>> }>> {
    return this.wrap(() => endpoints.testFilter(legacyBackend, params), {
      pre_filtering_count: 0,
      items: [],
    });
  }

  // ============================================
  // Feeds: ordering, icons, OPML
  // ============================================

  async getRawFeedTree(): Promise<ApiResponse<endpoints.RawTreeNode[]>> {
    return this.wrap(() => endpoints.getRawFeedTree(legacyBackend), []);
  }

  async saveFeedOrder(tree: endpoints.RawTreeNode[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFeedOrder(legacyBackend, tree);
      return true;
    }, false);
  }

  async resetFeedSortOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetFeedSortOrder(legacyBackend);
      return true;
    }, false);
  }

  async resetCatSortOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetCatSortOrder(legacyBackend);
      return true;
    }, false);
  }

  async removeFeedIcon(feedId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeFeedIcon(legacyBackend, feedId);
      return true;
    }, false);
  }

  async uploadFeedIcon(
    feedId: number,
    file: File
  ): Promise<ApiResponse<{ rc: string; icon_url: string }>> {
    return this.wrap(() => endpoints.uploadFeedIcon(legacyBackend, feedId, file), {
      rc: '',
      icon_url: '',
    });
  }

  async importOpml(file: File): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.importOpml(legacyBackend, file), '');
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

  async saveConfig(
    values: Record<string, string>,
    booleanPrefs: string[]
  ): Promise<ApiResponse<{ reload: boolean; message: string }>> {
    return this.wrap(() => endpoints.saveConfig(legacyBackend, values, booleanPrefs), {
      reload: false,
      message: '',
    });
  }

  async resetConfig(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetConfig(legacyBackend);
      return true;
    }, false);
  }

  async changePassword(
    oldPassword: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<ApiResponse<string>> {
    return this.wrap(
      () => endpoints.changePassword(legacyBackend, oldPassword, newPassword, confirmPassword),
      ''
    );
  }

  async changePersonalData(fullName: string, email: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.changePersonalData(legacyBackend, fullName, email), '');
  }

  async getProfiles(): Promise<ApiResponse<Array<{ id: number; title: string; active: boolean; initialized: boolean }>>> {
    return this.wrap(() => endpoints.getProfiles(legacyBackend), []);
  }

  async addProfile(title: string, activate = false): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.addProfile(legacyBackend, title, activate);
      return true;
    }, false);
  }

  async removeProfiles(profileIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeProfiles(legacyBackend, profileIds);
      return true;
    }, false);
  }

  async activateProfile(profileId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.activateProfile(legacyBackend, profileId);
      return true;
    }, false);
  }

  async getPluginsList(): Promise<ApiResponse<{ plugins: endpoints.PluginInfo[]; isAdmin: boolean }>> {
    return this.wrap(() => endpoints.getPluginsList(legacyBackend), { plugins: [], isAdmin: false });
  }

  async getPrefsJson(): Promise<ApiResponse<{ sections: endpoints.PrefSection[]; isProfile: boolean }>> {
    return this.wrap(() => endpoints.getPrefsJson(legacyBackend), { sections: [], isProfile: false });
  }

  async getPluginPrefsTabs(): Promise<ApiResponse<Record<string, string>>> {
    return this.wrap(() => endpoints.getPluginPrefsTabs(legacyBackend), {});
  }

  async getUsers(options: { search?: string; sort?: string } = {}): Promise<ApiResponse<{ users: endpoints.UserInfo[]; accessLevelNames: Record<string, string> }>> {
    return this.wrap(() => endpoints.getUsers(legacyBackend, options), { users: [], accessLevelNames: {} });
  }

  async getEventLog(options: { page?: number; severity?: number } = {}): Promise<ApiResponse<{ page: number; totalPages: number; severity: number; entries: endpoints.LogEntry[] }>> {
    return this.wrap(() => endpoints.getEventLog(legacyBackend, options), {
      page: 0,
      totalPages: 0,
      severity: 0,
      entries: [],
    });
  }

  async clearEventLog(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.clearEventLog(legacyBackend);
      return true;
    }, false);
  }

  async sendTestEmail(address: string): Promise<ApiResponse<{ rc: boolean; error: string }>> {
    return this.wrap(() => endpoints.sendTestEmail(legacyBackend, address), { rc: false, error: '' });
  }

  async getPhpInfo(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getPhpInfo(legacyBackend), '');
  }

  async getAuthInfo(): Promise<ApiResponse<endpoints.AuthInfo>> {
    return this.wrap(() => endpoints.getAuthInfo(legacyBackend), {
      full_name: '',
      email: '',
      can_change_password: false,
      auth_module: '',
      app_passwords: [],
      otp_enabled: false,
      otp_available: false,
      otp_qrcode: null,
      otp_secret: null,
    });
  }

  async generateAppPassword(title: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.generateAppPassword(legacyBackend, title), '');
  }

  async deleteAppPasswords(ids: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.deleteAppPasswords(legacyBackend, ids);
      return true;
    }, false);
  }

  async setOtp(enable: boolean, params: { password: string; otp?: string }): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.setOtp(legacyBackend, enable, params), '');
  }

  async previewDigest(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.previewDigest(legacyBackend), '');
  }

  async customizeCSS(value: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.customizeCSS(legacyBackend, value), '');
  }

  async setPlugins(enabled: string[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setPlugins(legacyBackend, enabled);
      return true;
    }, false);
  }

  // ============================================
  // User administration
  // ============================================

  async getUserDetails(userId: number): Promise<ApiResponse<{ id: number; login: string; access_level: number; email: string; otp_enabled: boolean } | null>> {
    return this.wrap(() => endpoints.getUserDetails(legacyBackend, userId), null);
  }

  async saveUser(user: Parameters<typeof endpoints.saveUser>[1]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveUser(legacyBackend, user);
      return true;
    }, false);
  }

  async addUser(login: string, password: string, accessLevel: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.addUser(legacyBackend, login, password, accessLevel);
      return true;
    }, false);
  }

  async removeUsers(userIds: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeUsers(legacyBackend, userIds);
      return true;
    }, false);
  }

  async resetUserPassword(userId: number, password: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetUserPassword(legacyBackend, userId, password);
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
