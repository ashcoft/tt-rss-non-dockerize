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
  /** Set when login stopped at the auth_internal OTP step. */
  otpRequired?: boolean;
}

export type {
  AdaptedFeed as Feed,
  AdaptedCategory as Category,
  AdaptedLabel as Label,
  AdaptedHeadline as Headline,
  HeadlinesPage,
  FilterDetails,
  FilterRule,
  FilterAction,
  PluginInfo,
  PluginsList,
  AdaptedCounters,
  AdaptedRuntimeInfo,
} from './legacyEndpoints';

/**
 * Solve the server's SHA-256 proof-of-work challenge. The loop yields on every
 * digest, so the login button stays responsive while it runs.
 */
async function solveProofOfWork(challenge: string, difficulty: number): Promise<number> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser does not support the login security check.');
  }

  const encoder = new TextEncoder();
  const bitsRequired = Math.max(12, Math.min(24, Number(difficulty) || 18));
  const maxNonce = 10_000_000;

  for (let nonce = 0; nonce < maxNonce; nonce++) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${challenge}:${nonce}`));
    const bytes = new Uint8Array(digest);
    let bits = 0;

    for (const byte of bytes) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(byte) - 24;
      break;
    }

    if (bits >= bitsRequired) return nonce;
  }

  throw new Error('Login security check timed out. Reload and try again.');
}

/** Fetch and solve one login challenge. */
async function createLoginProof(): Promise<{ challenge: string; nonce: string }> {
  const response = await fetch('/public.php?op=loginpowchallenge', {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Could not start the login security check.');
  }

  const data = (await response.json()) as { challenge?: string; difficulty?: number };
  if (!data.challenge) {
    throw new Error('Could not start the login security check.');
  }

  const nonce = await solveProofOfWork(data.challenge, Number(data.difficulty));
  return { challenge: data.challenge, nonce: String(nonce) };
}

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
  async login(
    username: string,
    password: string,
    options: {
      rememberMe?: boolean;
      safeMode?: boolean;
      bwLimit?: boolean;
      otp?: string;
      honeypot?: string;
      altcha?: string;
    } = {}
  ): Promise<ApiResponse<boolean>> {
    const body = new URLSearchParams({ login: username, password });
    if (options.rememberMe) body.set('remember_me', '1');
    if (options.safeMode) body.set('safe_mode', '1');
    if (options.bwLimit) body.set('bw_limit', '1');
    if (options.otp) body.set('otp', options.otp);
    if (options.honeypot) body.set('website', options.honeypot);
    if (options.altcha) body.set('altcha', options.altcha);

    // The Vue login form uses the built-in proof-of-work challenge. An
    // Altcha payload is still accepted when another client supplies one.
    // The OTP step is already gated by the second factor; the server skips
    // the challenge check when an OTP is present.
    if (!options.otp && !options.altcha) {
      try {
        const proof = await createLoginProof();
        body.set('challenge', proof.challenge);
        body.set('nonce', proof.nonce);
      } catch (err) {
        return {
          status: 1,
          content: false,
          error: err instanceof Error ? err.message : 'Login security check failed.',
        };
      }
    }
    const response = await fetch('/public.php?op=login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      return { status: 1, content: false, error: `Login failed (HTTP ${response.status}).` };
    }

    // auth_internal answers with an OTP form instead of a redirect when the
    // account has two-factor auth enabled. Do not treat that as a success.
    const text = await response.text();
    if (/class=["'][^"']*otpform|name=["']otp["']/.test(text)) {
      return { status: 2, content: false, otpRequired: true };
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
    ApiResponse<{
      feeds: endpoints.AdaptedFeed[];
      categories: endpoints.AdaptedCategory[];
      special: Record<number, number>;
      runtime: endpoints.AdaptedRuntimeInfo | null;
    }>
  > {
    return this.wrap(() => endpoints.getFeedTree(legacyBackend), {
      feeds: [],
      categories: [],
      special: {},
      runtime: null,
    });
  }

  async getCounters(): Promise<ApiResponse<endpoints.AdaptedCounters>> {
    return this.wrap(() => endpoints.getCounters(legacyBackend), {
      special: {},
      feeds: {},
      categories: {},
      runtime: null,
    });
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

  async uploadFeedIcon(
    feedId: number,
    file: Blob
  ): Promise<ApiResponse<endpoints.IconUploadResult | null>> {
    return this.wrap(() => endpoints.uploadFeedIcon(legacyBackend, feedId, file), null);
  }

  async removeFeedIcon(feedId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeFeedIcon(legacyBackend, feedId);
      return true;
    }, false);
  }

  async saveFeedOrder(
    categories: Array<{ id: number }>,
    feeds: Array<{ id: number; cat_id?: number | null }>
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFeedOrder(legacyBackend, categories, feeds);
      return true;
    }, false);
  }

  async catchupFeed(
    feedId: number | string,
    isCat = false,
    mode = 'all'
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.catchupFeed(legacyBackend, feedId, isCat, mode);
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
      firstId?: number;
    } = {}
  ): Promise<ApiResponse<endpoints.HeadlinesPage>> {
    return this.wrap(() => endpoints.getHeadlines(legacyBackend, feedId, options), {
      headlines: [],
      count: 0,
      first_id: 0,
      message: null,
      feedError: null,
      feedSiteUrl: '',
      firstIdChanged: false,
      pluginMenuItems: [],
      isVfeed: false,
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

  /** Rename a label; resolves to the caption the backend actually stored. */
  async renameLabel(labelId: number, caption: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.renameLabel(legacyBackend, labelId, caption), '');
  }

  async setLabelColors(
    labelId: number,
    fgColor: string,
    bgColor: string
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setLabelColors(legacyBackend, labelId, fgColor, bgColor);
      return true;
    }, false);
  }

  async resetLabelColors(labelId: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetLabelColors(legacyBackend, labelId);
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

  async getFilterDetails(filterId: number): Promise<ApiResponse<endpoints.FilterDetails | null>> {
    return this.wrap(() => endpoints.getFilterDetails(legacyBackend, filterId), null);
  }

  async saveFilter(details: endpoints.FilterDetails): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFilter(legacyBackend, details);
      return true;
    }, false);
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
    ApiResponse<{ showLanguage: boolean; showSyntaxHelp: boolean; defaultLanguage: string; allLanguages: string[] }>
  > {
    return this.wrap(() => endpoints.getSearchOptions(legacyBackend), {
      showLanguage: false,
      showSyntaxHelp: true,
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
  // OPML
  // ============================================

  /** Import an OPML file; resolves to the backend's plain-text import log. */
  async importOpml(file: Blob): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.importOpml(legacyBackend, file), '');
  }

  /** URL that streams an OPML export (navigate to it to download). */
  opmlExportUrl(includeSettings: boolean): string {
    return endpoints.opmlExportUrl(includeSettings);
  }

  // ============================================
  // Plugins
  // ============================================

  /** Run a plugin's article-button handler; resolves to its HTML fragment. */
  async invokePluginHandler(
    plugin: string,
    method: string,
    params: Record<string, string | number> = {}
  ): Promise<ApiResponse<string>> {
    return this.wrap(
      () => endpoints.invokePluginHandler(legacyBackend, plugin, method, params),
      ''
    );
  }

  /** Full article text from the af_readability plugin. */
  async getFullText(articleId: number): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getFullText(legacyBackend, articleId), '');
  }

  /** Keyboard-shortcuts help as an HTML fragment (sanitize before display). */
  async getHotkeyHelp(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getHotkeyHelp(legacyBackend), '');
  }

  /** Plugin-provided toolbar button HTML (main and action toolbar). */
  async getPluginButtons(
    feedId?: number,
    isCat?: boolean
  ): Promise<ApiResponse<endpoints.PluginSurfaces>> {
    return this.wrap(() => endpoints.getPluginButtons(legacyBackend, feedId, isCat), {
      mainToolbar: '',
      toolbar: '',
      feedTree: '',
      actionItems: '',
      headlineToolbar: '',
      headlineMenuItems: '',
      customSortMap: {},
    });
  }

  /** HOOK_LOGINFORM_ADDITIONAL_BUTTONS HTML for the login screen. */
  async getLoginFormButtons(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getLoginFormButtons(), '');
  }

  /** Plugin-provided preferences section HTML. */
  async getPluginPrefsSection(section: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getPluginPrefsSection(legacyBackend, section), '');
  }

  // ============================================
  // Plugins
  // ============================================

  async getPluginsList(): Promise<ApiResponse<endpoints.PluginsList>> {
    return this.wrap(() => endpoints.getPluginsList(legacyBackend), {
      plugins: [],
      isAdmin: false,
    });
  }

  async setEnabledPlugins(names: string[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.setEnabledPlugins(legacyBackend, names);
      return true;
    }, false);
  }

  // ============================================
  // Account
  // ============================================

  /** Change the current user's password; resolves to the backend's message. */
  async changePassword(
    oldPassword: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<ApiResponse<endpoints.PrefsActionResult>> {
    return this.wrap(
      () => endpoints.changePassword(legacyBackend, oldPassword, newPassword, confirmPassword),
      { ok: false, message: '' }
    );
  }

  // ============================================
  // Administration: users
  // ============================================

  async getUsers(search = '', sort = 'login'): Promise<ApiResponse<endpoints.UsersList>> {
    return this.wrap(() => endpoints.getUsers(legacyBackend, search, sort), {
      users: [],
      accessLevelNames: {},
    });
  }

  async getUserDetails(id: number): Promise<ApiResponse<endpoints.UserDetails | null>> {
    return this.wrap(() => endpoints.getUserDetails(legacyBackend, id), null);
  }

  async addUser(login: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.addUser(legacyBackend, login), '');
  }

  async removeUsers(ids: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeUsers(legacyBackend, ids);
      return true;
    }, false);
  }

  async saveUser(user: endpoints.UserEdit): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveUser(legacyBackend, user);
      return true;
    }, false);
  }

  async resetUserPassword(id: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetUserPassword(legacyBackend, id);
      return true;
    }, false);
  }

  // ============================================
  // Administration: system
  // ============================================

  async getSystemLog(page = 0, severity = 512): Promise<ApiResponse<endpoints.SystemLog>> {
    return this.wrap(() => endpoints.getSystemLog(legacyBackend, page, severity), {
      entries: [],
      page: 0,
      pages: 1,
      total: 0,
      severity,
      enabled: true,
    });
  }

  async clearSystemLog(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.clearSystemLog(legacyBackend);
      return true;
    }, false);
  }

  async sendTestEmail(address: string): Promise<ApiResponse<endpoints.TestEmailResult>> {
    return this.wrap(() => endpoints.sendTestEmail(legacyBackend, address), {
      ok: false,
      error: '',
    });
  }

  async getScheduledTasks(): Promise<ApiResponse<endpoints.ScheduledTask[]>> {
    return this.wrap(() => endpoints.getScheduledTasks(legacyBackend), []);
  }

  async getPhpInfo(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.getPhpInfo(legacyBackend), '');
  }

  // ============================================
  // Account: personal data, OTP, app passwords
  // ============================================

  async getPersonalData(): Promise<ApiResponse<endpoints.PersonalData | null>> {
    return this.wrap(() => endpoints.getPersonalData(legacyBackend), null);
  }

  async changePersonalData(email: string, fullName: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.changePersonalData(legacyBackend, email, fullName), '');
  }

  async enableOtp(password: string, otp: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.enableOtp(legacyBackend, password, otp), '');
  }

  async disableOtp(password: string): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.disableOtp(legacyBackend, password), '');
  }

  async getAppPasswords(): Promise<ApiResponse<endpoints.AppPassword[]>> {
    return this.wrap(() => endpoints.getAppPasswords(legacyBackend), []);
  }

  async createAppPassword(title: string): Promise<ApiResponse<endpoints.AppPasswordResult>> {
    return this.wrap(() => endpoints.createAppPassword(legacyBackend, title), {
      password: '',
      error: null,
    });
  }

  async deleteAppPasswords(ids: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.deleteAppPasswords(legacyBackend, ids);
      return true;
    }, false);
  }

  // ============================================
  // Account: profiles, custom CSS, digest
  // ============================================

  async getProfiles(): Promise<ApiResponse<Array<{ id: number; title: string; active: boolean }>>> {
    return this.wrap(() => endpoints.getProfiles(legacyBackend), []);
  }

  async activateProfile(id: number): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.activateProfile(legacyBackend, id);
      return true;
    }, false);
  }

  async cloneProfile(oldProfile: number, newTitle: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.cloneProfile(legacyBackend, oldProfile, newTitle);
      return true;
    }, false);
  }

  async addProfile(title: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.addProfile(legacyBackend, title);
      return true;
    }, false);
  }

  async saveProfile(id: number, title: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveProfile(legacyBackend, id, title);
      return true;
    }, false);
  }

  async removeProfiles(ids: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.removeProfiles(legacyBackend, ids);
      return true;
    }, false);
  }

  async customizeCss(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.customizeCss(legacyBackend), '');
  }

  async previewDigest(): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.previewDigest(legacyBackend), '');
  }

  async resetConfig(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetConfig(legacyBackend);
      return true;
    }, false);
  }

  // ============================================
  // Feeds: sharing, maintenance, batch operations
  // ============================================

  async getInactiveFeeds(): Promise<ApiResponse<endpoints.InactiveFeed[]>> {
    return this.wrap(() => endpoints.getInactiveFeeds(legacyBackend), []);
  }

  async getFeedsWithErrors(): Promise<ApiResponse<endpoints.FeedWithError[]>> {
    return this.wrap(() => endpoints.getFeedsWithErrors(legacyBackend), []);
  }

  async getSharedUrl(
    id: number,
    isCat: boolean,
    search = ''
  ): Promise<ApiResponse<endpoints.FeedSharingUrl | null>> {
    return this.wrap(() => endpoints.getSharedUrl(legacyBackend, id, isCat, search), null);
  }

  async regenFeedKey(id: number, isCat: boolean): Promise<ApiResponse<string>> {
    return this.wrap(() => endpoints.regenFeedKey(legacyBackend, id, isCat), '');
  }

  async clearFeedKeys(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.clearFeedKeys(legacyBackend);
      return true;
    }, false);
  }

  async batchAddFeeds(
    feeds: string,
    catId: number,
    login = '',
    pass = ''
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.batchAddFeeds(legacyBackend, feeds, catId, login, pass);
      return true;
    }, false);
  }

  async batchEditFeeds(
    ids: number[],
    fields: Record<string, string>
  ): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.batchEditFeeds(legacyBackend, ids, fields);
      return true;
    }, false);
  }

  async resetFeedOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetFeedOrder(legacyBackend);
      return true;
    }, false);
  }

  async resetCategoryOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetCategoryOrder(legacyBackend);
      return true;
    }, false);
  }

  // ============================================
  // Plugins: installer and updates
  // ============================================

  async getAvailablePlugins(): Promise<ApiResponse<endpoints.AvailablePlugin[]>> {
    return this.wrap(() => endpoints.getAvailablePlugins(legacyBackend), []);
  }

  async installPlugin(name: string): Promise<ApiResponse<Record<string, unknown>>> {
    return this.wrap(() => endpoints.installPlugin(legacyBackend, name), {});
  }

  async uninstallPlugin(name: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.uninstallPlugin(legacyBackend, name);
      return true;
    }, false);
  }

  async checkForPluginUpdates(): Promise<ApiResponse<unknown[]>> {
    return this.wrap(() => endpoints.checkForPluginUpdates(legacyBackend), []);
  }

  async updateLocalPlugins(plugins: string[]): Promise<ApiResponse<unknown[]>> {
    return this.wrap(() => endpoints.updateLocalPlugins(legacyBackend, plugins), []);
  }

  async clearPluginData(name: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.clearPluginData(legacyBackend, name);
      return true;
    }, false);
  }

  /** Plugin-provided preference tabs (`HOOK_PREFS_TAB`). */
  async getPluginPrefsTabs(): Promise<ApiResponse<endpoints.PluginPrefsTab[]>> {
    return this.wrap(() => endpoints.getPluginPrefsTabs(legacyBackend), []);
  }

  async cloneFilter(ids: number[], newTitle: string): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.cloneFilter(legacyBackend, ids, newTitle);
      return true;
    }, false);
  }

  async saveFilterOrder(ids: number[]): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.saveFilterOrder(legacyBackend, ids);
      return true;
    }, false);
  }

  async resetFilterOrder(): Promise<ApiResponse<boolean>> {
    return this.wrap(async () => {
      await endpoints.resetFilterOrder(legacyBackend);
      return true;
    }, false);
  }

  async testFilter(
    rules: Array<Record<string, unknown>>,
    matchAny: boolean,
    inverse: boolean
  ): Promise<ApiResponse<endpoints.FilterTestResult>> {
    return this.wrap(() => endpoints.testFilter(legacyBackend, rules, matchAny, inverse), {
      pre_filtering_count: 0,
      items: [],
    });
  }

  async checkForUpdates(): Promise<ApiResponse<endpoints.UpdateInfo>> {
    return this.wrap(() => endpoints.checkForUpdates(legacyBackend), {
      changeset: null,
      plugins: [],
    });
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
