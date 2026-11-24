/**
 * Response adapters for the legacy `backend.php` handlers.
 *
 * Each function maps a verified legacy payload onto the shapes the Vue stores
 * expect. The mappings were derived from live responses captured against a
 * real tt-rss instance (PHP 8.4 + PostgreSQL); see VITE_MIGRATION.md.
 *
 * Nothing here invents data: when a handler does not return a field the client
 * needs, the adapter either derives it from another real field or reports a
 * `LegacyProtocolError` so the caller fails loudly instead of silently showing
 * an empty UI.
 */

import {
  expectArray,
  expectObject,
  LegacyApiError,
  LegacyProtocolError,
  LegacyUnsupportedOperation,
  type LegacyBackend,
  type LegacyParams,
  type LegacyResponse,
} from './legacy';

// Legacy handler constants (classes/Feeds.php).
export const FEED_ARCHIVED = 0;
export const FEED_STARRED = -1;
export const FEED_PUBLISHED = -2;
export const FEED_FRESH = -3;
export const FEED_ALL = -4;
export const FEED_RECENTLY_READ = -6;

export const CATEGORY_UNCATEGORIZED = 0;
export const CATEGORY_SPECIAL = -1;
export const CATEGORY_LABELS = -2;

/** Feeds::view hardcodes its page size; `limit` is not honoured. */
export const HEADLINES_PAGE_SIZE = 30;

export interface AdaptedFeed {
  id: number;
  title: string;
  unread: number;
  cat_id: number | null;
  feed_url: string;
  site_url: string;
  /** True when the backend has a cached favicon for this feed. */
  has_icon: boolean;
  /** The feed's last update error, or "". */
  error: string;
  /** The feed's last update time as the backend formatted it. */
  updated: string;
}

export interface AdaptedCategory {
  id: number;
  title: string;
  unread: number;
  parent_id: number | null;
}

export interface AdaptedEnclosure {
  content_url: string;
  content_type: string;
  title: string;
  duration: string;
  width: number;
  height: number;
}

export interface AdaptedHeadline {
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
  /** Attachments the backend reports as `enclosures.entries`. */
  enclosures: AdaptedEnclosure[];
  /** Thumbnail URL for the article (from its first image enclosure), or ''. */
  image_preview: string;
  /** The feed's background colour, used to tint its label in combined mode. */
  feed_bg_color: string;
  /** Plugin-provided article buttons (parsed from the backend's HTML). */
  pluginButtons: AdaptedPluginButton[];
  /** Plugin-provided buttons rendered on the left of the headline row. */
  pluginLeftButtons: AdaptedPluginButton[];
  /** The headline's feed site URL, for the row's feed icon/pill. */
  feed_site_url: string;
  /** True when the headline's feed has a cached icon. */
  feed_has_icon: boolean;
  /** Content language from the backend. */
  lang: string;
  /** Localized import date shown as the row tooltip. */
  imported: string;
}

/** One plugin-provided entry in the headlines Select menu. */
export interface AdaptedPluginSelectItem {
  value: string;
  title: string;
  /** `<option></option>` separators from the plugin markup. */
  separator: boolean;
}

/**
 * A plugin article button. The backend emits raw HTML with an inline
 * `onclick="Plugins.<Class>.<method>(<id>)"`; the plugin name and method are
 * extracted so the Vue side can invoke the same handler through its own
 * registry instead of relying on a Dojo global.
 */
export interface AdaptedPluginButton {
  plugin: string;
  method: string;
  icon: string;
  title: string;
}

export interface AdaptedLabel {
  id: number;
  caption: string;
  fg_color: string;
  bg_color: string;
  unread: number;
}

interface LegacyCounters {
  feeds: Map<number, number>;
  categories: Map<number, number>;
  runtime: AdaptedRuntimeInfo | null;
}

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects/arrays have no meaningful string form; the backend sometimes sends
  // null-ish placeholders for absent fields, which fall back instead.
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function requireBody(response: LegacyResponse, context: string): Record<string, unknown> {
  if (response.body === null) {
    throw new LegacyProtocolError(`${context}: backend returned an empty or non-JSON body.`);
  }
  return response.body;
}

/**
 * `RPC/getAllCounters` returns the authoritative unread/marked/published
 * counters. `Pref_Feeds/getfeedtree` deliberately reports `unread: -1` for
 * every entry, so counters must be merged in separately.
 */
async function loadCounters(backend: LegacyBackend): Promise<LegacyCounters> {
  const response = await backend.call('RPC', 'getAllCounters');
  const body = requireBody(response, 'RPC/getAllCounters');
  const counters = expectArray(body.counters, 'RPC/getAllCounters.counters');

  const feeds = new Map<number, number>();
  const categories = new Map<number, number>();

  for (const entry of counters) {
    const record = expectObject(entry, 'RPC/getAllCounters.counter');
    const id = asNumber(record.id, Number.NaN);
    if (!Number.isFinite(id)) continue;
    const unread = asNumber(record.counter, 0);
    if (record.kind === 'cat') {
      categories.set(id, unread);
    } else {
      feeds.set(id, unread);
    }
  }

  return { feeds, categories, runtime: adaptRuntimeInfo(body['runtime-info']) };
}

export interface AdaptedRuntimeInfo {
  /** Recent error-log entries; only present for admins using SQL logging. */
  recentLogEvents: number;
  /** False when the update daemon is known to be stopped. */
  daemonIsRunning: boolean | null;
  /** False when the daemon is running but its update stamp is stale. */
  daemonStampOk: boolean | null;
}

function adaptRuntimeInfo(raw: unknown): AdaptedRuntimeInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const info = raw as Record<string, unknown>;

  return {
    recentLogEvents: asNumber(info.recent_log_events, 0),
    daemonIsRunning: 'daemon_is_running' in info ? asBoolean(info.daemon_is_running) : null,
    daemonStampOk: 'daemon_stamp_ok' in info ? asBoolean(info.daemon_stamp_ok) : null,
  };
}

/** The unread counters for the virtual ("special") feeds. */
function specialCounters(counters: LegacyCounters): Record<number, number> {
  const special: Record<number, number> = {};

  for (const id of [FEED_ALL, FEED_FRESH, FEED_STARRED, FEED_PUBLISHED, FEED_ARCHIVED]) {
    special[id] = counters.feeds.get(id) ?? 0;
  }

  return special;
}

export interface AdaptedCounters {
  /** Unread counters keyed by virtual feed id (negative ids and 0). */
  special: Record<number, number>;
  feeds: Record<number, number>;
  categories: Record<number, number>;
  /** Daemon/log health piggybacked on the counters poll. */
  runtime: AdaptedRuntimeInfo | null;
}

/** Read the authoritative counters, e.g. after an article action. */
export async function getCounters(backend: LegacyBackend): Promise<AdaptedCounters> {
  const counters = await loadCounters(backend);

  return {
    special: specialCounters(counters),
    feeds: Object.fromEntries(counters.feeds),
    categories: Object.fromEntries(counters.categories),
    runtime: counters.runtime,
  };
}

/**
 * `Pref_Feeds/getfeedtree` with `mode=2` returns the root's `items` array: one
 * entry per category (Special `-1`, Labels `-2`, user categories, and
 * Uncategorized `0`), each with a nested `items` array of feeds.
 */
/**
 * Whether a tree node is a feed.
 *
 * Node shape is not consistent: feeds emitted by `feedlist_init_feed` (the
 * Special/Labels categories) carry `type: 'feed'`, while feeds nested inside a
 * user category are built inline by `get_category_items` and carry no `type`
 * at all. The `id` prefix is present in both, so classification uses that.
 */
function isFeedNode(node: Record<string, unknown>): boolean {
  if (node.type === 'feed') {
    return true;
  }

  return typeof node.id === 'string' && node.id.startsWith('FEED:');
}

/** Convert one `getfeedtree` feed node, or null when it is not a feed. */
function adaptTreeNode(
  raw: unknown,
  catId: number | null,
  counters: LegacyCounters
): AdaptedFeed | null {
  const node = expectObject(raw, 'Pref_Feeds/getfeedtree.feed');

  if (!isFeedNode(node)) {
    return null;
  }

  const feedId = asNumber(node.bare_id, Number.NaN);

  if (!Number.isFinite(feedId)) {
    return null;
  }

  return {
    id: feedId,
    title: asString(node.name),
    unread: counters.feeds.get(feedId) ?? 0,
    cat_id: catId,
    // getfeedtree does not return feed_url/site_url; these are only available
    // from Pref_Feeds/editfeed. Leave them empty rather than fabricating.
    feed_url: '',
    site_url: '',
    has_icon: asString(node.icon) !== '',
    error: asString(node.error),
    updated: asString(node.updated),
  };
}

/**
 * Walk the tree, collecting feeds at every level.
 *
 * With categories enabled the root holds one node per category, each with a
 * nested `items` array. With categories disabled the root holds the feeds
 * directly, so a root entry may itself be a feed.
 */
function collectTree(
  items: unknown[],
  catId: number | null,
  counters: LegacyCounters,
  feeds: AdaptedFeed[],
  categories: AdaptedCategory[]
): void {
  for (const raw of items) {
    const node = expectObject(raw, 'Pref_Feeds/getfeedtree.node');

    if (isFeedNode(node)) {
      const feed = adaptTreeNode(node, catId, counters);

      if (feed) {
        feeds.push(feed);
      }

      continue;
    }

    const categoryId = asNumber(node.bare_id, Number.NaN);

    if (!Number.isFinite(categoryId)) {
      continue;
    }

    // Special and Labels are rendered from dedicated sources (hardcoded
    // special feeds, labels store); skip them to avoid duplicates.
    if (categoryId === CATEGORY_SPECIAL || categoryId === CATEGORY_LABELS) {
      continue;
    }

    if (categoryId !== CATEGORY_UNCATEGORIZED) {
      categories.push({
        id: categoryId,
        title: asString(node.name),
        unread: counters.categories.get(categoryId) ?? 0,
        parent_id: node.parent_id === undefined ? null : asNumber(node.parent_id, 0),
      });
    }

    const childItems = Array.isArray(node.items) ? node.items : [];
    const childCatId = categoryId === CATEGORY_UNCATEGORIZED ? null : categoryId;

    collectTree(childItems, childCatId, counters, feeds, categories);
  }
}

/**
 * Build the feed tree and category list from `Pref_Feeds/getfeedtree`.
 *
 * Counters are merged in from `RPC/getAllCounters`, because the tree itself
 * reports `unread: -1` for every entry.
 */
export async function getFeedTree(
  backend: LegacyBackend
): Promise<{
  feeds: AdaptedFeed[];
  categories: AdaptedCategory[];
  special: Record<number, number>;
  /** Daemon/log health piggybacked on the counters request. */
  runtime: AdaptedRuntimeInfo | null;
}> {
  const [treeResponse, counters] = await Promise.all([
    backend.call('Pref_Feeds', 'getfeedtree', { mode: 2 }),
    loadCounters(backend),
  ]);

  const body = requireBody(treeResponse, 'Pref_Feeds/getfeedtree');
  const rootItems = expectArray(body.items, 'Pref_Feeds/getfeedtree.items');

  const feeds: AdaptedFeed[] = [];
  const categories: AdaptedCategory[] = [];

  collectTree(rootItems, null, counters, feeds, categories);

  return { feeds, categories, special: specialCounters(counters), runtime: counters.runtime };
}

export interface HeadlinesPage {
  headlines: AdaptedHeadline[];
  count: number;
  first_id: number;
  /** Set when the backend refused to render a list (e.g. "Feed not found."). */
  message: string | null;
  /** Feed update error reported by the toolbar payload, or null. */
  feedError: string | null;
  /** Feed site URL reported by the toolbar payload, or "". */
  feedSiteUrl: string;
  /** Set when the first article changed while paging through a feed. */
  firstIdChanged: boolean;
  /** Plugin entries for the headlines Select menu. */
  pluginMenuItems: AdaptedPluginSelectItem[];
  /** True when the list mixes several feeds (a virtual feed). */
  isVfeed: boolean;
}

/**
 * Parse the backend's plugin-button HTML fragment.
 *
 * Each button is `<i ... onclick="Plugins.<Class>.<method>(<id>)" title="...">icon</i>`.
 * Only the handler name and presentation are extracted; the id comes from the
 * headline, so a button is not tied to a single article. Buttons whose onclick
 * does not match the `Plugins.*` contract are skipped (a plugin may emit
 * arbitrary markup the Vue side cannot dispatch).
 */
function adaptPluginButtons(html: string): AdaptedPluginButton[] {
  if (!html) return [];

  const buttons: AdaptedPluginButton[] = [];
  for (const match of html.matchAll(/<i\b[^>]*>([^<]*)<\/i>/g)) {
    const tag = match[0];
    const handler = /onclick="Plugins\.(\w+)\.(\w+)\(/.exec(tag);
    if (!handler) continue;
    const title = /title="([^"]*)"/.exec(tag);
    buttons.push({
      plugin: handler[1],
      method: handler[2],
      icon: match[1] || 'extension',
      title: title ? title[1] : '',
    });
  }
  return buttons;
}

/** Decode the handful of entities the backend emits inside `<option>`. */
function decodeOptionText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'");
}

/**
 * Parse the plugin `<option>` list for the headlines Select menu
 * (`HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2`). Plugins may emit separators as
 * an empty `<option>`, which the Vue menu renders as a divider.
 */
function adaptPluginSelectMenu(html: string): AdaptedPluginSelectItem[] {
  if (!html) return [];

  const items: AdaptedPluginSelectItem[] = [];

  for (const match of html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const attrs = match[1];
    const valueMatch = /\bvalue\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const value = valueMatch ? (valueMatch[2] ?? valueMatch[3] ?? '') : '';
    const title = decodeOptionText(match[2].replace(/<[^>]*>/g, '').trim());

    if (value === '') {
      items.push({ value: '', title, separator: true });
      continue;
    }

    items.push({ value, title: title || value, separator: false });
  }

  return items;
}

function adaptHeadline(raw: unknown): AdaptedHeadline {
  const line = expectObject(raw, 'Feeds/view.headline');
  const unread = asBoolean(line.unread);
  const comments = asString(line.comments);

  // `enclosures` is `{formatted, entries, preview_entries}`; the entries are the
  // attachment list the reading pane offers.
  const enclosuresRaw = line.enclosures;
  const enclosureEntries =
    typeof enclosuresRaw === 'object' && enclosuresRaw !== null && Array.isArray((enclosuresRaw as Record<string, unknown>).entries)
      ? ((enclosuresRaw as Record<string, unknown>).entries as unknown[])
      : [];

  return {
    id: asNumber(line.id),
    // The legacy list does not return `guid`; it is dropped from the payload.
    guid: '',
    title: asString(line.title),
    link: asString(line.link),
    content: asString(line.content),
    excerpt: asString(line.content_preview),
    // Feeds/view replaces the raw `updated` epoch with a localized string.
    updated: asString(line.updated),
    updated_long: asString(line.updated_long),
    is_marked: asBoolean(line.marked),
    is_read: !unread,
    is_published: asBoolean(line.published),
    tags: Array.isArray(line.tags) ? line.tags.map((tag) => asString(tag)) : [],
    labels: Array.isArray(line.labels) ? line.labels : [],
    feed_id: asNumber(line.feed_id, FEED_ARCHIVED),
    feed_title: asString(line.feed_title),
    comments_count: asNumber(line.num_comments),
    comments_link: comments,
    author: asString(line.author),
    score: asNumber(line.score),
    note: asString(line.note),
    enclosures: enclosureEntries.map((raw) => {
      const enc = expectObject(raw, 'Feeds/view.headline.enclosure');
      return {
        content_url: asString(enc.content_url),
        content_type: asString(enc.content_type),
        title: asString(enc.title),
        duration: asString(enc.duration),
        width: asNumber(enc.width),
        height: asNumber(enc.height),
      };
    }),
    image_preview: asString(line.image_preview),
    feed_bg_color: asString(line.feed_bg_color),
    pluginButtons: adaptPluginButtons(asString(line.buttons)),
    pluginLeftButtons: adaptPluginButtons(asString(line.buttons_left)),
    feed_site_url: asString(line.site_url),
    feed_has_icon: asBoolean(line.has_icon),
    lang: asString(line.lang),
    imported: asString(line.imported),
  };
}

/**
 * `Feeds/view` returns `{headlines: {...}, "headlines-info": {...}}` where
 * `headlines.content` is either an array of article rows or an HTML string
 * describing an empty/error state.
 */
export async function getHeadlines(
  backend: LegacyBackend,
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
): Promise<HeadlinesPage> {
  // A search without a language makes PostgreSQL raise "invalid name syntax",
  // which the backend turns into a query matching nothing. Resolve the
  // configured default before searching so results are never silently empty.
  let searchLanguage = options.searchLanguage ?? '';
  if (options.search && !searchLanguage) {
    searchLanguage = (await getSearchOptions(backend)).defaultLanguage;
  }

  const response = await backend.call('Feeds', 'view', {
    feed: feedId,
    cat: options.isCat ? 1 : 0,
    view_mode: options.viewMode ?? 'adaptive',
    skip: options.skip ?? 0,
    // Feeds/view reads the search term from `query`, not `search`.
    query: options.search ?? '',
    search_language: searchLanguage,
    order_by: options.orderBy ?? '',
    // "ForceUpdate" makes the backend refresh the feed before listing.
    m: options.forceUpdate ? 'ForceUpdate' : '',
    fid: options.firstId ?? 0,
  });

  const body = requireBody(response, 'Feeds/view');
  const headlines = expectObject(body.headlines, 'Feeds/view.headlines');
  const info = expectObject(body['headlines-info'], 'Feeds/view.headlines-info');

  const content = headlines.content;
  const count = asNumber(info.count);
  const firstId = asNumber(headlines.first_id);

  // The toolbar payload carries the feed's last update error (shown as an
  // icon next to the title in the legacy UI); `error` is "" when there is none.
  const toolbar = typeof headlines.toolbar === 'object' && headlines.toolbar !== null
    ? (headlines.toolbar as Record<string, unknown>)
    : {};
  const feedError = asString(toolbar.error).trim() || null;
  const feedSiteUrl = asString(toolbar.site_url);
  const firstIdChanged = headlines.first_id_changed === true;
  const pluginMenuItems = adaptPluginSelectMenu(asString(toolbar.plugin_menu_items));
  const isVfeed = asBoolean(headlines.is_vfeed);

  if (typeof content === 'string') {
    // A string body is the legacy empty/error marker.
    return { headlines: [], count, first_id: firstId, message: stripTags(content), feedError, feedSiteUrl, firstIdChanged, pluginMenuItems, isVfeed };
  }

  const rows = expectArray(content, 'Feeds/view.headlines.content');
  return {
    headlines: rows.map(adaptHeadline),
    count,
    first_id: firstId,
    message: null,
    feedError,
    feedSiteUrl,
    firstIdChanged,
    pluginMenuItems,
    isVfeed,
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * `Pref_Labels/getlabeltree` returns `{items: [{items: [{type:'label', ...}]}]}`.
 */
export async function getLabels(backend: LegacyBackend): Promise<AdaptedLabel[]> {
  const response = await backend.call('Pref_Labels', 'getlabeltree');
  const body = requireBody(response, 'Pref_Labels/getlabeltree');
  const roots = expectArray(body.items, 'Pref_Labels/getlabeltree.items');

  const labels: AdaptedLabel[] = [];
  for (const rawRoot of roots) {
    const root = expectObject(rawRoot, 'Pref_Labels/getlabeltree.root');
    if (!Array.isArray(root.items)) continue;
    for (const rawLabel of root.items) {
      const label = expectObject(rawLabel, 'Pref_Labels/getlabeltree.label');
      if (label.type !== 'label') continue;
      labels.push({
        id: asNumber(label.bare_id),
        caption: asString(label.name),
        fg_color: asString(label.fg_color),
        bg_color: asString(label.bg_color),
        unread: asNumber(label.unread),
      });
    }
  }
  return labels;
}

/**
 * `Pref_Filters/getfiltertree` returns `{items: [{items: [{bare_id, name, ...}]}]}`.
 */
export async function getFilters(backend: LegacyBackend): Promise<Array<Record<string, unknown>>> {
  const response = await backend.call('Pref_Filters', 'getfiltertree');
  const body = requireBody(response, 'Pref_Filters/getfiltertree');
  const roots = expectArray(body.items, 'Pref_Filters/getfiltertree.items');

  const filters: Array<Record<string, unknown>> = [];
  for (const rawRoot of roots) {
    const root = expectObject(rawRoot, 'Pref_Filters/getfiltertree.root');
    if (!Array.isArray(root.items)) continue;
    for (const rawFilter of root.items) {
      const filter = expectObject(rawFilter, 'Pref_Filters/getfiltertree.filter');
      filters.push({
        id: asNumber(filter.bare_id),
        title: asString(filter.bare_name, asString(filter.name)),
        enabled: filter.enabled !== false,
      });
    }
  }
  return filters;
}

/** `Pref_Prefs/getProfiles` returns a top-level JSON array. */
export async function getProfiles(
  backend: LegacyBackend
): Promise<Array<{ id: number; title: string; active: boolean }>> {
  const response = await backend.call('Pref_Prefs', 'getProfiles');
  const body = requireBody(response, 'Pref_Prefs/getProfiles');
  const rows = expectArray(body.data, 'Pref_Prefs/getProfiles');

  return rows.map((raw) => {
    const profile = expectObject(raw, 'Pref_Prefs/getProfiles.profile');
    return {
      id: asNumber(profile.id),
      title: asString(profile.title),
      active: asBoolean(profile.active),
    };
  });
}

/**
 * `RPC/sanityCheck` is the legacy equivalent of a bootstrap call: it returns
 * `init-params` (the values the Dojo client caches at startup), `runtime-info`
 * and the translation table. There is no per-preference read endpoint.
 */
export async function getInitParams(
  backend: LegacyBackend
): Promise<Record<string, unknown>> {
  const response = await backend.call('RPC', 'sanityCheck', {
    clientTzOffset: new Date().getTimezoneOffset() * 60,
    hasSandbox: 'sandbox' in document.createElement('iframe'),
    clientLocation: window.location.href,
  });
  const body = requireBody(response, 'RPC/sanityCheck');
  return expectObject(body['init-params'], 'RPC/sanityCheck.init-params');
}

/**
 * `Feeds/search` returns the options the search dialog needs: whether to show
 * the language selector, the language list, and the default to preselect.
 *
 * The language matters for correctness, not just presentation: `Feeds/view`
 * passes it to PostgreSQL `to_tsquery()`, and an empty value raises
 * "invalid name syntax", which the backend converts into a match-nothing
 * query. The legacy client therefore always submits a language.
 */
export async function getSearchOptions(
  backend: LegacyBackend
): Promise<{ showLanguage: boolean; showSyntaxHelp: boolean; defaultLanguage: string; allLanguages: string[] }> {
  const response = await backend.call('Feeds', 'search');
  const body = requireBody(response, 'Feeds/search');
  const allLanguages = Array.isArray(body.all_languages)
    ? body.all_languages.map((lang) => asString(lang)).filter((lang) => lang !== '')
    : [];
  const defaultLanguage = asString(body.default_language);

  return {
    showLanguage: body.show_language === true,
    showSyntaxHelp: body.show_syntax_help === true,
    // Never hand back an empty language; fall back to the first available one
    // so a search cannot silently return nothing.
    defaultLanguage: defaultLanguage || allLanguages[0] || 'english',
    allLanguages,
  };
}

/**
 * Feeds::add reports success through a nested result code rather than an HTTP
 * status. Codes 0 (already subscribed) and 1 (added) are both successes.
 */
export async function addFeed(
  backend: LegacyBackend,
  feedUrl: string,
  categoryId = 0
): Promise<{ code: number; message?: string }> {
  const response = await backend.call('Feeds', 'add', { feed: feedUrl, cat: categoryId });
  const body = requireBody(response, 'Feeds/add');
  const result = expectObject(body.result, 'Feeds/add.result');
  const code = asNumber(result.code, Number.NaN);

  if (code !== 0 && code !== 1) {
    throw new LegacyApiError('E_FEED_SUBSCRIBE_FAILED', {
      code,
      message: asString(result.message, 'Feed subscription failed.'),
    });
  }
  return { code, message: asString(result.message, undefined as unknown as string) };
}

/** Delete a feed: `Pref_Feeds/remove` takes a comma-delimited `ids` list. */
export async function removeFeed(backend: LegacyBackend, feedId: number): Promise<void> {
  await backend.call('Pref_Feeds', 'remove', { ids: feedId });
}

export async function removeCategory(backend: LegacyBackend, categoryId: number): Promise<void> {
  await backend.call('Pref_Feeds', 'removeCat', { ids: categoryId });
}

export async function addCategory(backend: LegacyBackend, title: string): Promise<void> {
  await backend.call('Pref_Feeds', 'addCat', { cat: title });
}

export async function renameCategory(
  backend: LegacyBackend,
  categoryId: number,
  title: string
): Promise<void> {
  await backend.call('Pref_Feeds', 'renameCat', { id: categoryId, title });
}

export async function createLabel(backend: LegacyBackend, caption: string): Promise<void> {
  await backend.call('Pref_Labels', 'add', { caption, output: 1 });
}

export async function removeLabel(backend: LegacyBackend, labelId: number): Promise<void> {
  await backend.call('Pref_Labels', 'remove', { ids: labelId });
}

/**
 * Rename a label. `Pref_Labels/save` echoes the caption it actually stored:
 * the new one on success, or the unchanged old one when the new caption is
 * empty or already taken. It prints nothing when the id does not belong to the
 * user, so the caller cannot distinguish that from a silent success.
 */
export async function renameLabel(
  backend: LegacyBackend,
  labelId: number,
  caption: string
): Promise<string> {
  const response = await backend.call('Pref_Labels', 'save', { id: labelId, caption });
  return response.raw.trim();
}

/**
 * Set a label's foreground and background colours. `Pref_Labels/colorset`
 * takes `kind: 'fg'` or `'bg'` with a single `color`, or any other kind with
 * `fg` and `bg` together; the latter is used here so both update in one call.
 */
export async function setLabelColors(
  backend: LegacyBackend,
  labelId: number,
  fgColor: string,
  bgColor: string
): Promise<void> {
  await backend.call('Pref_Labels', 'colorset', {
    ids: labelId,
    fg: fgColor,
    bg: bgColor,
  });
}

/** Clear a label's custom colours, restoring the theme defaults. */
export async function resetLabelColors(backend: LegacyBackend, labelId: number): Promise<void> {
  await backend.call('Pref_Labels', 'colorreset', { ids: labelId });
}

export async function setArticleLabel(
  backend: LegacyBackend,
  labelId: number,
  articleIds: number[],
  assign: 0 | 1
): Promise<void> {
  await backend.call('Article', assign ? 'assignToLabel' : 'removeFromLabel', {
    ids: articleIds.join(','),
    lid: labelId,
  });
}

export async function removeFilter(backend: LegacyBackend, filterId: number): Promise<void> {
  await backend.call('Pref_Filters', 'remove', { ids: filterId });
}

/** One match rule. `feed_id` holds feed ids, `CAT:<id>` category ids or `0`. */
export interface FilterRule {
  reg_exp: string;
  filter_type: number;
  feed_id: string[];
  inverse: boolean;
}

/**
 * One action. `action_param_label` is what the label action (7) stores, and
 * `action_param` is what every other parameterised action stores.
 */
export interface FilterAction {
  action_id: number;
  action_param: string;
  action_param_label: string;
}

export interface FilterDetails {
  id: number;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  title: string;
  rules: FilterRule[];
  actions: FilterAction[];
  /** Filter type id -> localized description (Title, Content, ...). */
  filterTypes: Record<string, string>;
  /** Action id -> localized description (Delete article, ...). */
  actionTypes: Record<string, string>;
  /** Plugin action key ("Class:action") -> description. */
  pluginActions: Record<string, string>;
  labels: Array<{ id: number; caption: string }>;
}

/**
 * `Pref_Filters/edit` returns the filter's editable record. With `id: 0` it
 * returns an empty template (rule/action vocabularies and labels) used to
 * create a new filter.
 */
export async function getFilterDetails(
  backend: LegacyBackend,
  filterId: number
): Promise<FilterDetails> {
  const response = await backend.call('Pref_Filters', 'edit', { id: filterId });
  const body = requireBody(response, 'Pref_Filters/edit');

  const stringMap = (value: unknown): Record<string, string> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = asString(entry);
    }
    return result;
  };

  const rules = (Array.isArray(body.rules) ? body.rules : []).map((raw) => {
    const rule = expectObject(raw, 'Pref_Filters/edit.rule');
    const feedIds = Array.isArray(rule.feed_id) ? rule.feed_id : [rule.feed_id];
    return {
      reg_exp: asString(rule.reg_exp),
      filter_type: asNumber(rule.filter_type, 1),
      feed_id: feedIds.map((id) => asString(id)),
      inverse: rule.inverse === true || rule.inverse === 1 || rule.inverse === '1',
    } satisfies FilterRule;
  });

  const actions = (Array.isArray(body.actions) ? body.actions : []).map((raw) => {
    const action = expectObject(raw, 'Pref_Filters/edit.action');
    return {
      action_id: asNumber(action.action_id),
      action_param: asString(action.action_param),
      action_param_label: asString(action.action_param_label, asString(action.action_param)),
    } satisfies FilterAction;
  });

  const labels = (Array.isArray(body.labels) ? body.labels : []).map((raw) => {
    const label = expectObject(raw, 'Pref_Filters/edit.label');
    return { id: asNumber(label.id), caption: asString(label.caption) };
  });

  return {
    id: asNumber(body.id),
    enabled: body.enabled !== false,
    match_any_rule: body.match_any_rule === true,
    inverse: body.inverse === true,
    title: asString(body.title),
    rules,
    actions,
    filterTypes: stringMap(body.filter_types),
    actionTypes: stringMap(body.action_types),
    pluginActions: stringMap(body.plugin_actions),
    labels,
  };
}

/**
 * Create (`id: 0`) or update a filter. Rules and actions are sent as repeated
 * `rule[]`/`action[]` JSON strings, which is what `_save_rules_and_actions()`
 * parses. Checkboxes go through `checkbox_to_sql_bool()`, so the checked value
 * is the literal string "on".
 */
export async function saveFilter(
  backend: LegacyBackend,
  details: FilterDetails
): Promise<void> {
  const params: LegacyParams = {
    enabled: checkboxValue(details.enabled),
    match_any_rule: checkboxValue(details.match_any_rule),
    inverse: checkboxValue(details.inverse),
    title: details.title,
    rule: details.rules.map((rule) =>
      JSON.stringify({
        reg_exp: rule.reg_exp,
        filter_type: rule.filter_type,
        feed_id: rule.feed_id,
        inverse: rule.inverse,
      })
    ),
    action: details.actions.map((action) =>
      JSON.stringify({
        action_id: action.action_id,
        action_param: action.action_param,
        action_param_label: action.action_param_label,
      })
    ),
  };

  if (details.id > 0) {
    await backend.call('Pref_Filters', 'editSave', { ...params, id: details.id });
  } else {
    await backend.call('Pref_Filters', 'add', params);
  }
}

/** RPC article mutations share the `{ids, cmode}` contract. */
async function articleSelection(
  backend: LegacyBackend,
  method: 'markSelected' | 'publishSelected' | 'catchupSelected',
  articleIds: number[],
  cmode: number
): Promise<void> {
  if (articleIds.length === 0) return;
  await backend.call('RPC', method, { ids: articleIds.join(','), cmode });
}

export function markArticles(backend: LegacyBackend, ids: number[], mode: 0 | 2): Promise<void> {
  return articleSelection(backend, 'markSelected', ids, mode);
}

export function publishArticles(backend: LegacyBackend, ids: number[], mode: 0 | 2): Promise<void> {
  return articleSelection(backend, 'publishSelected', ids, mode);
}

export function catchupArticles(backend: LegacyBackend, ids: number[], mode: 0 | 1): Promise<void> {
  return articleSelection(backend, 'catchupSelected', ids, mode);
}

export async function deleteArticles(backend: LegacyBackend, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await backend.call('RPC', 'delete', { ids: ids.join(',') });
}

export async function catchupFeed(
  backend: LegacyBackend,
  feedId: number | string,
  isCat: boolean,
  mode = 'all',
  searchQuery = '',
  searchLanguage = ''
): Promise<void> {
  await backend.call('RPC', 'catchupFeed', {
    feed_id: feedId,
    is_cat: isCat ? 1 : 0,
    mode,
    search_query: searchQuery,
    search_lang: searchLanguage,
  });
}

export async function catchupAll(backend: LegacyBackend): Promise<void> {
  await backend.call('Feeds', 'catchupAll');
}

/** `RPC/setpref` writes a single user preference. */
export async function setPref(backend: LegacyBackend, key: string, value: string): Promise<void> {
  await backend.call('RPC', 'setpref', { key, value });
}

/**
 * Article notes are provided by the `note` plugin, not core. The call is made
 * through `PluginHandler`; when the plugin is not enabled the backend answers
 * `E_UNKNOWN_PLUGIN`, which surfaces as a `LegacyApiError`.
 */
export async function setArticleNote(
  backend: LegacyBackend,
  articleId: number,
  note: string
): Promise<void> {
  await backend.call('PluginHandler', 'setnote', { plugin: 'note', id: articleId, note });
}

/** Feed purge/update interval choices, mirroring the maps in backend.php. */
export const FEED_UPDATE_INTERVALS: Array<{ title: string; value: number }> = [
  { title: 'Default interval', value: 0 },
  { title: 'Disable updates', value: -1 },
  { title: '15 minutes', value: 15 },
  { title: '30 minutes', value: 30 },
  { title: 'Hourly', value: 60 },
  { title: '4 hours', value: 240 },
  { title: '12 hours', value: 720 },
  { title: 'Daily', value: 1440 },
  { title: 'Weekly', value: 10080 },
];

export const FEED_PURGE_INTERVALS: Array<{ title: string; value: number }> = [
  { title: 'Use default', value: 0 },
  { title: 'Never purge', value: -1 },
  { title: '1 week old', value: 7 },
  { title: '2 weeks old', value: 14 },
  { title: '1 month old', value: 31 },
  { title: '2 months old', value: 60 },
  { title: '3 months old', value: 90 },
];

/**
 * Every field `Pref_Feeds/editSave` writes. They are all round-tripped through
 * a save because the handler assigns each one unconditionally; omitting any of
 * them would silently reset that setting.
 */
export interface FeedDetails {
  id: number;
  title: string;
  feed_url: string;
  site_url: string;
  cat_id: number | null;
  update_interval: number;
  purge_interval: number;
  auth_login: string;
  auth_pass: string;
  private: boolean;
  cache_images: boolean;
  hide_images: boolean;
  feed_language: string;
  include_in_digest: boolean;
  always_display_enclosures: boolean;
  mark_unread_on_update: boolean;
}

/** `Pref_Feeds/editfeed` returns `{feed: {...}, cats: {...}, intervals: {...}}`. */
export async function getFeedDetails(backend: LegacyBackend, feedId: number): Promise<FeedDetails> {
  const response = await backend.call('Pref_Feeds', 'editfeed', { id: feedId });
  const body = requireBody(response, 'Pref_Feeds/editfeed');
  const feed = expectObject(body.feed, 'Pref_Feeds/editfeed.feed');

  return {
    id: asNumber(feed.id),
    title: asString(feed.title),
    feed_url: asString(feed.feed_url),
    site_url: asString(feed.site_url),
    cat_id: feed.cat_id === null || feed.cat_id === undefined ? null : asNumber(feed.cat_id, 0),
    update_interval: asNumber(feed.update_interval),
    purge_interval: asNumber(feed.purge_interval),
    auth_login: asString(feed.auth_login),
    // editfeed returns the decrypted password; editSave re-encrypts it.
    auth_pass: asString(feed.auth_pass),
    private: asBoolean(feed.private),
    cache_images: asBoolean(feed.cache_images),
    hide_images: asBoolean(feed.hide_images),
    feed_language: asString(feed.feed_language),
    include_in_digest: asBoolean(feed.include_in_digest),
    always_display_enclosures: asBoolean(feed.always_display_enclosures),
    mark_unread_on_update: asBoolean(feed.mark_unread_on_update),
  };
}

/**
 * `Pref_Feeds/editSave` unconditionally writes every field it manages, so a
 * partial request clears the fields it omits (including `feed_url`, `site_url`
 * and the per-feed HTTP auth). It must therefore always be given a complete
 * record: the current settings are re-read and the requested changes merged
 * over them before saving.
 */
export async function saveFeed(
  backend: LegacyBackend,
  feedId: number,
  changes: Partial<Omit<FeedDetails, 'id'>>
): Promise<void> {
  const current = await getFeedDetails(backend, feedId);
  const merged: FeedDetails = { ...current, ...changes, id: feedId };

  // The checkbox fields go through checkbox_to_sql_bool(), which returns 1 only
  // for the literal string "on" and 0 for everything else. Sending 1/0 (or
  // true/false) would silently disable every flag, so the checked value is "on".
  await backend.call('Pref_Feeds', 'editSave', {
    id: merged.id,
    title: merged.title,
    feed_url: merged.feed_url,
    site_url: merged.site_url,
    update_interval: merged.update_interval,
    purge_interval: merged.purge_interval,
    cat_id: merged.cat_id ?? 0,
    auth_login: merged.auth_login,
    auth_pass: merged.auth_pass,
    private: checkboxValue(merged.private),
    cache_images: checkboxValue(merged.cache_images),
    hide_images: checkboxValue(merged.hide_images),
    feed_language: merged.feed_language,
    include_in_digest: checkboxValue(merged.include_in_digest),
    always_display_enclosures: checkboxValue(merged.always_display_enclosures),
    mark_unread_on_update: checkboxValue(merged.mark_unread_on_update),
  });
}

/** The value `checkbox_to_sql_bool()` recognises as checked. */
function checkboxValue(checked: boolean): string {
  return checked ? 'on' : '';
}

/**
 * Invoke a plugin's article-button handler through `PluginHandler`.
 *
 * The backend dispatches `op=PluginHandler&plugin=<Class>&pmethod=<method>`;
 * the handler answers with an HTML fragment (a dialog body) that the caller
 * renders. Returns the raw body.
 */
export async function invokePluginHandler(
  backend: LegacyBackend,
  plugin: string,
  method: string,
  params: LegacyParams = {}
): Promise<string> {
  // PluginHandler::catchall($method) dispatches on the standard `method`
  // field and reads `plugin`; it validates the CSRF token itself (the transport
  // supplies it), so no `pmethod` is involved here.
  const response = await backend.call('PluginHandler', method, {
    plugin: plugin.toLowerCase(),
    ...params,
  });
  return response.raw;
}

/**
 * Fetch the full article text through the `af_readability` plugin.
 *
 * The plugin's `embed` method prints `{content: "..."}`; when the plugin is
 * disabled the backend answers E_UNKNOWN_PLUGIN and the transport throws.
 */
export async function getFullText(backend: LegacyBackend, articleId: number): Promise<string> {
  const response = await backend.call('PluginHandler', 'embed', {
    plugin: 'af_readability',
    id: articleId,
  });

  let body = response.body;
  if (!body) {
    try {
      body = JSON.parse(response.raw) as Record<string, unknown>;
    } catch {
      throw new LegacyProtocolError('af_readability returned a non-JSON response.');
    }
  }

  return asString(body.content);
}

/** Article tags are stored comma-separated; `tags_str` is what the handler reads. */
export async function setArticleTags(
  backend: LegacyBackend,
  articleId: number,
  tags: string[]
): Promise<string[]> {
  const response = await backend.call('Article', 'setArticleTags', {
    id: articleId,
    tags_str: tags.join(','),
  });
  const body = requireBody(response, 'Article/setArticleTags');
  return Array.isArray(body.tags) ? body.tags.map((tag) => asString(tag)) : [];
}

/** Tag autocomplete; the handler expects `search` and returns a plain array. */
export async function completeTags(backend: LegacyBackend, search: string): Promise<string[]> {
  const response = await backend.call('Article', 'completeTags', { search });
  const body = requireBody(response, 'Article/completeTags');
  return Array.isArray(body.data) ? body.data.map((tag) => asString(tag)) : [];
}

/** Set an article's score; `ids` is a comma-delimited list. */
export async function setArticleScore(
  backend: LegacyBackend,
  articleIds: number[],
  score: number
): Promise<void> {
  if (articleIds.length === 0) return;
  await backend.call('Article', 'setScore', { ids: articleIds.join(','), score });
}

/**
 * There is no legacy endpoint that returns a preference value; the Dojo client
 * receives the ones it needs through `RPC/sanityCheck` init-params.
 */
export function getPref(): never {
  throw new LegacyUnsupportedOperation(
    'reading a preference (use RPC/sanityCheck init-params instead)'
  );
}

/** No legacy handler fetches a single article; content arrives with the list. */
export function getArticle(): never {
  throw new LegacyUnsupportedOperation(
    'fetching a single article (use the content already returned by Feeds/view)'
  );
}

/** Feed purging is a scheduled/CLI operation, not a backend.php method. */
export function purgeFeed(): never {
  throw new LegacyUnsupportedOperation('purging a feed (run update.php --purge-feed)');
}

/**
 * Import an OPML file. `Pref_Feeds/importOpml` prints a plain-text (HTML
 * fragment) log of what it did, so the raw body is returned for display.
 */
export async function importOpml(backend: LegacyBackend, file: Blob): Promise<string> {
  const response = await backend.upload(
    'Pref_Feeds',
    'importOpml',
    {},
    'opml_file',
    file,
    'import.opml'
  );
  return response.raw;
}

/**
 * Build the URL that streams an OPML export.
 *
 * `OPML/export` is a GET that sets `Content-Disposition: attachment`, so it
 * must be navigated to rather than fetched (fetch would return the bytes as a
 * string). It is in `csrf_ignore()`, so no token is needed.
 */
export function opmlExportUrl(includeSettings: boolean): string {
  const params = new URLSearchParams({ op: 'OPML', method: 'export' });
  if (includeSettings) {
    params.set('include_settings', '1');
  }
  return `/backend.php?${params.toString()}`;
}

/** Result codes `Pref_Feeds/uploadIcon` returns. */
export const ICON_UPLOAD_SUCCESS = 'E_ICON_UPLOAD_SUCCESS';
export const ICON_UPLOAD_FAILED = 'E_ICON_UPLOAD_FAILED';
export const ICON_FILE_TOO_LARGE = 'E_ICON_FILE_TOO_LARGE';
export const ICON_RENAME_FAILED = 'E_ICON_RENAME_FAILED';

export interface IconUploadResult {
  rc: string;
  /** Cache-busted URL for the stored icon; empty when the upload failed. */
  iconUrl: string;
}

/**
 * Upload a custom feed icon. `Pref_Feeds/uploadIcon` returns
 * `{rc, icon_url}`; the URL carries a `?ts=` cache-buster so the browser
 * re-fetches the new image.
 */
export async function uploadFeedIcon(
  backend: LegacyBackend,
  feedId: number,
  file: Blob
): Promise<IconUploadResult> {
  const response = await backend.upload(
    'Pref_Feeds',
    'uploadIcon',
    { feed_id: feedId },
    'icon_file',
    file,
    'icon'
  );
  const body = requireBody(response, 'Pref_Feeds/uploadIcon');
  return { rc: asString(body.rc), iconUrl: asString(body.icon_url) };
}

/** Remove a feed's custom icon, restoring the auto-detected favicon. */
export async function removeFeedIcon(backend: LegacyBackend, feedId: number): Promise<void> {
  await backend.call('Pref_Feeds', 'removeIcon', { feed_id: feedId });
}

/**
 * The keyboard-shortcuts help. `RPC/hotkeyHelp` prints an HTML fragment
 * (the hotkey map formatted as a list), so the raw body is returned for the
 * caller to sanitize and display.
 */
export async function getHotkeyHelp(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('RPC', 'hotkeyHelp');
  return response.raw;
}

export interface PluginInfo {
  name: string;
  is_local: boolean;
  system_enabled: boolean;
  user_enabled: boolean;
  has_data: boolean;
  is_system: boolean;
  version: string;
  author: string;
  description: string;
  more_info: string;
}

export interface PluginsList {
  plugins: PluginInfo[];
  /** Whether the current user may install/update/uninstall plugins. */
  isAdmin: boolean;
}

/**
 * `Pref_Prefs/getPluginsList` returns every plugin with its enabled state.
 * System plugins are enabled by config and cannot be toggled per user.
 */
export async function getPluginsList(backend: LegacyBackend): Promise<PluginsList> {
  const response = await backend.call('Pref_Prefs', 'getPluginsList');
  const body = requireBody(response, 'Pref_Prefs/getPluginsList');
  const rows = expectArray(body.plugins, 'Pref_Prefs/getPluginsList.plugins');

  const plugins = rows.map((raw) => {
    const plugin = expectObject(raw, 'Pref_Prefs/getPluginsList.plugin');
    return {
      name: asString(plugin.name),
      is_local: asBoolean(plugin.is_local),
      system_enabled: asBoolean(plugin.system_enabled),
      user_enabled: asBoolean(plugin.user_enabled),
      has_data: asBoolean(plugin.has_data),
      is_system: asBoolean(plugin.is_system),
      version: asString(plugin.version),
      author: asString(plugin.author),
      description: asString(plugin.description),
      more_info: asString(plugin.more_info),
    } satisfies PluginInfo;
  });

  return { plugins, isAdmin: asBoolean(body.is_admin) };
}

/**
 * Persist the user's enabled-plugin list. `Pref_Prefs/setplugins` replaces the
 * stored list with the names given; system plugins are managed by config and
 * must not be included.
 */
export async function setEnabledPlugins(
  backend: LegacyBackend,
  names: string[]
): Promise<void> {
  await backend.call('Pref_Prefs', 'setplugins', { plugins: names });
}

/**
 * Build the tree payload `Pref_Feeds/savefeedorder` expects.
 *
 * The handler walks `items` keyed by node id: the root node lists the
 * uncategorized feeds and the categories in display order, and each category
 * node lists its feeds. Every leaf is a `{_reference}` pointing at a
 * `FEED:<id>` or `CAT:<id>`.
 */
export function buildFeedOrderPayload(
  categories: Array<{ id: number }>,
  feeds: Array<{ id: number; cat_id?: number | null }>
): { items: Array<Record<string, unknown>> } {
  const rootItems: Array<Record<string, unknown>> = [];
  const catItems = new Map<number, Array<Record<string, unknown>>>();

  for (const category of categories) {
    catItems.set(category.id, []);
  }

  for (const feed of feeds) {
    const reference = { _reference: `FEED:${feed.id}` };
    const bucket = feed.cat_id != null ? catItems.get(feed.cat_id) : undefined;
    if (bucket) {
      bucket.push(reference);
    } else {
      rootItems.push(reference);
    }
  }

  // The backend indexes `items` by node id at the top level, so categories
  // must be siblings of root (root references them) rather than nested.
  const categoryNodes = categories.map(category => ({
    id: `CAT:${category.id}`,
    _reference: `CAT:${category.id}`,
    items: catItems.get(category.id) ?? [],
  }));

  for (const category of categories) {
    rootItems.push({ _reference: `CAT:${category.id}` });
  }

  return { items: [{ id: 'root', items: rootItems }, ...categoryNodes] };
}

/** Persist the feed/category tree order and category membership. */
export async function saveFeedOrder(
  backend: LegacyBackend,
  categories: Array<{ id: number }>,
  feeds: Array<{ id: number; cat_id?: number | null }>
): Promise<void> {
  const payload = JSON.stringify(buildFeedOrderPayload(categories, feeds));
  await backend.call('Pref_Feeds', 'savefeedorder', { payload });
}

export interface PrefsActionResult {
  /** False when the handler returned a `format_error()` block. */
  ok: boolean;
  /** The handler's message with its HTML wrapper stripped. */
  message: string;
}

/**
 * Interpret a preferences handler that answers with an HTML fragment.
 *
 * Handlers such as `Pref_Prefs/changepassword` print `format_notice()` on
 * success and `format_error()` on failure, both as `<div class="alert ...">`
 * blocks. The class is the only machine-readable signal, so success is "no
 * `alert-danger`" and the message is the tag-stripped body.
 */
function parsePrefsResult(raw: string): PrefsActionResult {
  const message = stripTags(raw);
  return { ok: raw.trim() !== '' && !raw.includes('alert-danger'), message };
}

/**
 * Change the current user's password.
 *
 * `Pref_Prefs/changepassword` validates the inputs server-side (blank, equal,
 * mismatched, disallowed characters) and delegates to the authentication
 * module. It answers with an HTML fragment, parsed by `parsePrefsResult`.
 */
export async function changePassword(
  backend: LegacyBackend,
  oldPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<PrefsActionResult> {
  const response = await backend.call('Pref_Prefs', 'changepassword', {
    old_password: oldPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  });
  return parsePrefsResult(response.raw);
}

export interface PluginSurfaces {
  /** HTML for HOOK_MAIN_TOOLBAR_BUTTON (left side of the main toolbar). */
  mainToolbar: string;
  /** HTML for HOOK_TOOLBAR_BUTTON (the toolbar action menu). */
  toolbar: string;
  /** HTML for HOOK_FEED_TREE (above the feed tree). */
  feedTree: string;
  /** HTML for HOOK_ACTION_ITEM (inside the actions menu). */
  actionItems: string;
  /** HTML for HOOK_HEADLINE_TOOLBAR_BUTTON (per-feed headline toolbar). */
  headlineToolbar: string;
  /** `<option>` markup for HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2. */
  headlineMenuItems: string;
  /** Extra sort options from HOOK_HEADLINES_CUSTOM_SORT_MAP. */
  customSortMap: Record<string, string>;
}

/**
 * Fetch the HTML fragments plugins provide for the main toolbar.
 *
 * The legacy shell rendered this markup directly and let the plugin's own JS
 * run. The Vue app cannot execute that JS, so the fragments are only useful
 * for handlers that follow the `Plugins.<Class>.<method>()` convention; see
 * `preparePluginSurfaceHtml`.
 */
export async function getPluginButtons(
  backend: LegacyBackend,
  feedId?: number,
  isCat?: boolean
): Promise<PluginSurfaces> {
  const response = await backend.call('RPC', 'getPluginButtons', {
    feed: feedId ?? 0,
    is_cat: isCat ? 1 : 0,
  });
  const body = requireBody(response, 'RPC/getPluginButtons');

  const customSortMap: Record<string, string> = {};
  if (body.custom_sort_map && typeof body.custom_sort_map === 'object') {
    for (const [key, value] of Object.entries(body.custom_sort_map as Record<string, unknown>)) {
      customSortMap[key] = asString(value);
    }
  }

  return {
    mainToolbar: asString(body.main_toolbar),
    toolbar: asString(body.toolbar),
    feedTree: asString(body.feed_tree),
    actionItems: asString(body.action_items),
    headlineToolbar: asString(body.headline_toolbar),
    headlineMenuItems: asString(body.headline_menu_items),
    customSortMap,
  };
}

/**
 * Fetch HOOK_LOGINFORM_ADDITIONAL_BUTTONS for the Vue login screen.
 *
 * `public.php` is the unauthenticated entry point (the same one the legacy
 * login form used), so this bypasses the backend.php transport.
 */
export async function getLoginFormButtons(): Promise<string> {
  const response = await fetch('public.php?op=loginformbuttons', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new LegacyProtocolError(`public.php answered ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  return asString(body.html);
}

/** Fetch one plugin-provided preferences section (`HOOK_PREFS_TAB_SECTION`). */
export async function getPluginPrefsSection(
  backend: LegacyBackend,
  section: string
): Promise<string> {
  const response = await backend.call('RPC', 'getPluginPrefsSection', { section });
  const body = requireBody(response, 'RPC/getPluginPrefsSection');
  return asString(body.html);
}

const PLUGIN_HANDLER_ATTR =
  /onclick=(["'])\s*(?:return\s+)?Plugins\.(\w+)\.(\w+)\(\s*\)\s*;?\s*\1/gi;

/**
 * Rewrite a plugin's inline handler into data attributes the Vue host can
 * dispatch, and strip every other inline event handler.
 *
 * Only no-argument `Plugins.<Class>.<method>()` calls can be forwarded to
 * `PluginHandler`; calls that need arguments relied on the plugin's deleted JS
 * to build the request, so their onclick is removed rather than run.
 */
export function preparePluginSurfaceHtml(html: string): string {
  if (!html) return '';

  return html
    .replace(PLUGIN_HANDLER_ATTR, 'data-plugin="$2" data-method="$3"')
    .replace(/\son[a-z]+=("[^"]*"|'[^']*')/gi, '');
}

// ============================================
// Administration: users
// ============================================

export interface UserRow {
  id: number;
  login: string;
  access_level: number;
  access_level_name: string;
  email: string;
  full_name: string;
  otp_enabled: boolean;
  num_feeds: number;
  created: string;
  last_login: string;
}

export interface UsersList {
  users: UserRow[];
  accessLevelNames: Record<string, string>;
}

export async function getUsers(
  backend: LegacyBackend,
  search = '',
  sort = 'login'
): Promise<UsersList> {
  const response = await backend.call('Pref_Users', 'getUsers', { search, sort });
  const body = requireBody(response, 'Pref_Users/getUsers');
  const rows = expectArray(body.users, 'Pref_Users/getUsers.users');

  const users = rows.map((raw) => {
    const user = expectObject(raw, 'Pref_Users/getUsers.user');
    return {
      id: asNumber(user.id),
      login: asString(user.login),
      access_level: asNumber(user.access_level),
      access_level_name: asString(user.access_level_name),
      email: asString(user.email),
      full_name: asString(user.full_name),
      otp_enabled: asBoolean(user.otp_enabled),
      num_feeds: asNumber(user.num_feeds),
      created: asString(user.created),
      last_login: asString(user.last_login),
    };
  });

  const names: Record<string, string> = {};
  const rawNames = expectObject(body.access_level_names, 'Pref_Users/getUsers.access_level_names');
  for (const [key, value] of Object.entries(rawNames)) {
    names[key] = asString(value);
  }

  return { users, accessLevelNames: names };
}

export interface UserDetails {
  login: string;
  access_level: number;
  created: string;
  last_login: string;
  stored_articles: number;
  feeds: Array<{ id: number; title: string; site_url: string; icon_url: string }>;
}

export async function getUserDetails(backend: LegacyBackend, id: number): Promise<UserDetails> {
  const response = await backend.call('Pref_Users', 'getUserDetails', { id });
  const body = requireBody(response, 'Pref_Users/getUserDetails');

  const feeds = expectArray(body.feeds, 'Pref_Users/getUserDetails.feeds').map((raw) => {
    const feed = expectObject(raw, 'Pref_Users/getUserDetails.feed');
    return {
      id: asNumber(feed.id),
      title: asString(feed.title),
      site_url: asString(feed.site_url),
      icon_url: asString(feed.icon_url),
    };
  });

  return {
    login: asString(body.login),
    access_level: asNumber(body.access_level),
    created: asString(body.created),
    last_login: asString(body.last_login),
    stored_articles: asNumber(body.stored_articles),
    feeds,
  };
}

/** `Pref_Users/add` answers with a plain-text message (it may contain the password). */
export async function addUser(backend: LegacyBackend, login: string): Promise<string> {
  const response = await backend.call('Pref_Users', 'add', { login });
  return response.raw;
}

export async function removeUsers(backend: LegacyBackend, ids: number[]): Promise<void> {
  await backend.call('Pref_Users', 'remove', { ids: ids.join(',') });
}

export interface UserEdit {
  id: number;
  login: string;
  access_level: number;
  email: string;
  full_name: string;
  otp_enabled: boolean;
  password?: string;
}

export async function saveUser(backend: LegacyBackend, user: UserEdit): Promise<void> {
  await backend.call('Pref_Users', 'editSave', {
    id: user.id,
    login: user.login,
    access_level: user.access_level,
    email: user.email,
    full_name: user.full_name,
    otp_enabled: checkboxValue(user.otp_enabled),
    password: user.password ?? '',
  });
}

export async function resetUserPassword(backend: LegacyBackend, id: number): Promise<void> {
  await backend.call('Pref_Users', 'resetPass', { id });
}

// ============================================
// Administration: system
// ============================================

export interface SystemLogEntry {
  errno: number;
  errno_name: string;
  filename: string;
  message: string;
  context: string;
  login: string;
  date: string;
}

export interface SystemLog {
  entries: SystemLogEntry[];
  page: number;
  pages: number;
  total: number;
  severity: number;
  enabled: boolean;
}

export async function getSystemLog(
  backend: LegacyBackend,
  page = 0,
  severity = 512
): Promise<SystemLog> {
  const response = await backend.call('Pref_System', 'getLog', { page, severity });
  const body = requireBody(response, 'Pref_System/getLog');

  const entries = expectArray(body.entries, 'Pref_System/getLog.entries').map((raw) => {
    const entry = expectObject(raw, 'Pref_System/getLog.entry');
    return {
      errno: asNumber(entry.errno),
      errno_name: asString(entry.errno_name),
      filename: asString(entry.filename),
      message: asString(entry.message),
      context: asString(entry.context),
      login: asString(entry.login),
      date: asString(entry.date),
    };
  });

  return {
    entries,
    page: asNumber(body.page),
    pages: asNumber(body.pages, 1),
    total: asNumber(body.total),
    severity: asNumber(body.severity, severity),
    enabled: body.enabled === undefined ? true : asBoolean(body.enabled),
  };
}

export async function clearSystemLog(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_System', 'clearLog');
}

export interface TestEmailResult {
  ok: boolean;
  error: string;
}

export async function sendTestEmail(
  backend: LegacyBackend,
  address: string
): Promise<TestEmailResult> {
  const response = await backend.call('Pref_System', 'sendTestEmail', { mail_address: address });
  const body = requireBody(response, 'Pref_System/sendTestEmail');
  return { ok: asBoolean(body.rc), error: asString(body.error) };
}

export interface ScheduledTask {
  task_name: string;
  schedule: string;
  last_run: string;
  duration: number;
  rc: number;
}

export async function getScheduledTasks(backend: LegacyBackend): Promise<ScheduledTask[]> {
  const response = await backend.call('Pref_System', 'getScheduledTasksList');
  const body = requireBody(response, 'Pref_System/getScheduledTasksList');
  return expectArray(body.tasks, 'Pref_System/getScheduledTasksList.tasks').map((raw) => {
    const task = expectObject(raw, 'Pref_System/getScheduledTasksList.task');
    return {
      task_name: asString(task.task_name),
      schedule: asString(task.schedule),
      last_run: asString(task.last_run),
      duration: asNumber(task.duration),
      rc: asNumber(task.rc),
    };
  });
}

export async function getPhpInfo(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('Pref_System', 'getphpinfo');
  return response.raw;
}

// ============================================
// Account: personal data, OTP, app passwords
// ============================================

export interface PersonalData {
  email: string;
  full_name: string;
  otp_enabled: boolean;
  otp_qrcode: string | null;
}

export async function getPersonalData(backend: LegacyBackend): Promise<PersonalData> {
  const response = await backend.call('Pref_Prefs', 'getPersonalData');
  const body = requireBody(response, 'Pref_Prefs/getPersonalData');
  return {
    email: asString(body.email),
    full_name: asString(body.full_name),
    otp_enabled: asBoolean(body.otp_enabled),
    otp_qrcode: typeof body.otp_qrcode === 'string' && body.otp_qrcode ? body.otp_qrcode : null,
  };
}

export async function changePersonalData(
  backend: LegacyBackend,
  email: string,
  fullName: string
): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'changePersonalData', {
    email,
    full_name: fullName,
  });
  return response.raw;
}

export async function enableOtp(
  backend: LegacyBackend,
  password: string,
  otp: string
): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'otpenable', { password, otp });
  return response.raw;
}

export async function disableOtp(backend: LegacyBackend, password: string): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'otpdisable', { password });
  return response.raw;
}

export interface AppPassword {
  id: number;
  title: string;
  created: string;
  last_used: string;
}

export async function getAppPasswords(backend: LegacyBackend): Promise<AppPassword[]> {
  const response = await backend.call('Pref_Prefs', 'getAppPasswords');
  const body = requireBody(response, 'Pref_Prefs/getAppPasswords');
  return expectArray(body.passwords, 'Pref_Prefs/getAppPasswords.passwords').map((raw) => {
    const pass = expectObject(raw, 'Pref_Prefs/getAppPasswords.password');
    return {
      id: asNumber(pass.id),
      title: asString(pass.title),
      created: asString(pass.created),
      last_used: asString(pass.last_used),
    };
  });
}

export interface AppPasswordResult {
  password: string;
  error: string | null;
}

export async function createAppPassword(
  backend: LegacyBackend,
  title: string
): Promise<AppPasswordResult> {
  const response = await backend.call('Pref_Prefs', 'createAppPassword', { title });
  const body = requireBody(response, 'Pref_Prefs/createAppPassword');
  return {
    password: asString(body.password),
    error: body.error ? asString(body.error) : null,
  };
}

export async function deleteAppPasswords(backend: LegacyBackend, ids: number[]): Promise<void> {
  await backend.call('Pref_Prefs', 'deleteAppPasswords', { ids });
}

// ============================================
// Account: profiles, custom CSS, digest
// ============================================

export async function activateProfile(backend: LegacyBackend, id: number): Promise<void> {
  await backend.call('Pref_Prefs', 'activateprofile', { id });
}

export async function cloneProfile(
  backend: LegacyBackend,
  oldProfile: number,
  newTitle: string
): Promise<void> {
  await backend.call('Pref_Prefs', 'cloneprofile', {
    old_profile: oldProfile,
    new_title: newTitle,
  });
}

export async function addProfile(backend: LegacyBackend, title: string): Promise<void> {
  await backend.call('Pref_Prefs', 'addprofile', { title });
}

export async function saveProfile(
  backend: LegacyBackend,
  id: number,
  title: string
): Promise<void> {
  await backend.call('Pref_Prefs', 'saveprofile', { id, value: title });
}

export async function removeProfiles(backend: LegacyBackend, ids: number[]): Promise<void> {
  await backend.call('Pref_Prefs', 'remprofiles', { ids });
}

export async function customizeCss(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'customizeCSS');
  const body = requireBody(response, 'Pref_Prefs/customizeCSS');
  return asString(body.value);
}

/** The digest preview is `[html, count, affected_ids, text]`. */
export async function previewDigest(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'previewDigest');
  const body = requireBody(response, 'Pref_Prefs/previewDigest');
  const data = expectArray(body.data, 'Pref_Prefs/previewDigest');
  return asString(data[0]);
}

export async function resetConfig(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Prefs', 'resetconfig');
}

// ============================================
// Feeds: sharing, maintenance, batch operations
// ============================================

export interface FeedSharingUrl {
  title: string;
  link: string;
}

export async function getSharedUrl(
  backend: LegacyBackend,
  id: number,
  isCat: boolean,
  search = ''
): Promise<FeedSharingUrl> {
  const response = await backend.call('Pref_Feeds', 'getSharedURL', {
    id,
    is_cat: isCat ? 1 : 0,
    search,
  });
  const body = requireBody(response, 'Pref_Feeds/getSharedURL');
  return { title: asString(body.title), link: asString(body.link) };
}

export async function regenFeedKey(
  backend: LegacyBackend,
  id: number,
  isCat: boolean
): Promise<string> {
  const response = await backend.call('Pref_Feeds', 'regenFeedKey', {
    id,
    is_cat: isCat ? 1 : 0,
  });
  const body = requireBody(response, 'Pref_Feeds/regenFeedKey');
  return asString(body.link);
}

export async function clearFeedKeys(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Feeds', 'clearKeys');
}

export interface InactiveFeed {
  id: number;
  title: string;
  site_url: string;
  feed_url: string;
  last_article: string;
}

export async function getInactiveFeeds(backend: LegacyBackend): Promise<InactiveFeed[]> {
  const response = await backend.call('Pref_Feeds', 'inactiveFeeds');
  const body = requireBody(response, 'Pref_Feeds/inactiveFeeds');
  return expectArray(body.data, 'Pref_Feeds/inactiveFeeds').map((raw) => {
    const feed = expectObject(raw, 'Pref_Feeds/inactiveFeeds.feed');
    return {
      id: asNumber(feed.id),
      title: asString(feed.title),
      site_url: asString(feed.site_url),
      feed_url: asString(feed.feed_url),
      last_article: asString(feed.last_article),
    };
  });
}

export interface FeedWithError {
  id: number;
  title: string;
  feed_url: string;
  last_error: string;
  site_url: string;
}

export async function getFeedsWithErrors(backend: LegacyBackend): Promise<FeedWithError[]> {
  const response = await backend.call('Pref_Feeds', 'feedsWithErrors');
  const body = requireBody(response, 'Pref_Feeds/feedsWithErrors');
  return expectArray(body.data, 'Pref_Feeds/feedsWithErrors').map((raw) => {
    const feed = expectObject(raw, 'Pref_Feeds/feedsWithErrors.feed');
    return {
      id: asNumber(feed.id),
      title: asString(feed.title),
      feed_url: asString(feed.feed_url),
      last_error: asString(feed.last_error),
      site_url: asString(feed.site_url),
    };
  });
}

export async function batchAddFeeds(
  backend: LegacyBackend,
  feeds: string,
  catId: number,
  login = '',
  pass = ''
): Promise<void> {
  await backend.call('Pref_Feeds', 'batchAddFeeds', {
    cat: catId || '',
    feeds,
    login,
    pass,
  });
}

export async function batchEditFeeds(
  backend: LegacyBackend,
  ids: number[],
  fields: Record<string, string>
): Promise<void> {
  await backend.call('Pref_Feeds', 'batchEditSave', {
    ids: ids.join(','),
    ...fields,
  });
}

export async function resetFeedOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Feeds', 'feedsortreset');
}

export async function resetCategoryOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Feeds', 'catsortreset');
}

// ============================================
// Plugins: installer and updates
// ============================================

export interface AvailablePlugin {
  name: string;
  description: string;
  topics: string[];
  html_url: string;
  clone_url: string;
  last_update: string;
}

export async function getAvailablePlugins(backend: LegacyBackend): Promise<AvailablePlugin[]> {
  const response = await backend.call('Pref_Prefs', 'getAvailablePlugins');
  const body = requireBody(response, 'Pref_Prefs/getAvailablePlugins');
  return expectArray(body.data, 'Pref_Prefs/getAvailablePlugins').map((raw) => {
    const plugin = expectObject(raw, 'Pref_Prefs/getAvailablePlugins.plugin');
    return {
      name: asString(plugin.name),
      description: asString(plugin.description),
      topics: Array.isArray(plugin.topics) ? plugin.topics.map((topic) => asString(topic)) : [],
      html_url: asString(plugin.html_url),
      clone_url: asString(plugin.clone_url),
      last_update: asString(plugin.last_update),
    };
  });
}

export async function installPlugin(
  backend: LegacyBackend,
  name: string
): Promise<Record<string, unknown>> {
  const response = await backend.call('Pref_Prefs', 'installPlugin', { plugin: name });
  return requireBody(response, 'Pref_Prefs/installPlugin');
}

export async function uninstallPlugin(backend: LegacyBackend, name: string): Promise<void> {
  await backend.call('Pref_Prefs', 'uninstallPlugin', { plugin: name });
}

export async function checkForPluginUpdates(backend: LegacyBackend): Promise<unknown[]> {
  const response = await backend.call('Pref_Prefs', 'checkForPluginUpdates');
  const body = requireBody(response, 'Pref_Prefs/checkForPluginUpdates');
  return expectArray(body.data, 'Pref_Prefs/checkForPluginUpdates');
}

export async function updateLocalPlugins(
  backend: LegacyBackend,
  plugins: string[]
): Promise<unknown[]> {
  const response = await backend.call('Pref_Prefs', 'updateLocalPlugins', {
    plugins: plugins.join(','),
  });
  const body = requireBody(response, 'Pref_Prefs/updateLocalPlugins');
  return expectArray(body.data, 'Pref_Prefs/updateLocalPlugins');
}

export async function clearPluginData(backend: LegacyBackend, name: string): Promise<void> {
  await backend.call('Pref_Prefs', 'clearplugindata', { name });
}

export interface PluginPrefsTab {
  id: string;
  section: string;
  plugin: string;
  title: string;
  html: string;
}

/** Fetch the plugin-provided preference tabs (`HOOK_PREFS_TAB`). */
export async function getPluginPrefsTabs(backend: LegacyBackend): Promise<PluginPrefsTab[]> {
  const response = await backend.call('RPC', 'getPluginPrefsTabs');
  const body = requireBody(response, 'RPC/getPluginPrefsTabs');
  return expectArray(body.tabs, 'RPC/getPluginPrefsTabs.tabs').map((raw) => {
    const tab = expectObject(raw, 'RPC/getPluginPrefsTabs.tab');
    return {
      id: asString(tab.id),
      section: asString(tab.section),
      plugin: asString(tab.plugin),
      title: asString(tab.title),
      html: asString(tab.html),
    };
  });
}

/** Clone one or more filters. */
export async function cloneFilter(
  backend: LegacyBackend,
  ids: number[],
  newTitle: string
): Promise<void> {
  await backend.call('Pref_Filters', 'clone', {
    ids: ids.join(','),
    new_filter_title: newTitle,
  });
}

/** Persist the filter order; the handler expects the legacy tree payload. */
export async function saveFilterOrder(backend: LegacyBackend, ids: number[]): Promise<void> {
  const payload = JSON.stringify({
    items: [{ items: ids.map((id) => ({ _reference: `FILTER:${id}` })) }],
  });
  await backend.call('Pref_Filters', 'savefilterorder', { payload });
}

export async function resetFilterOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Filters', 'filtersortreset');
}

export interface FilterTestItem {
  title: string;
  feed_title: string;
  date: string;
  content_preview: string;
  rules: string[];
}

export interface FilterTestResult {
  pre_filtering_count: number;
  items: FilterTestItem[];
}

/** Run a filter against recent articles without saving it. */
export async function testFilter(
  backend: LegacyBackend,
  rules: Array<Record<string, unknown>>,
  matchAny: boolean,
  inverse: boolean,
  offset = 0,
  limit = 100
): Promise<FilterTestResult> {
  const response = await backend.call('Pref_Filters', 'testFilterDo', {
    offset,
    limit,
    match_any_rule: checkboxValue(matchAny),
    inverse: checkboxValue(inverse),
    rule: rules.map((rule) => JSON.stringify(rule)),
  });
  const body = requireBody(response, 'Pref_Filters/testFilterDo');
  const items = expectArray(body.items, 'Pref_Filters/testFilterDo.items').map((raw) => {
    const item = expectObject(raw, 'Pref_Filters/testFilterDo.item');
    return {
      title: asString(item.title),
      feed_title: asString(item.feed_title),
      date: asString(item.date),
      content_preview: asString(item.content_preview),
      rules: Array.isArray(item.rules) ? item.rules.map((rule) => asString(rule)) : [],
    };
  });

  return { pre_filtering_count: asNumber(body.pre_filtering_count), items };
}

export interface UpdateInfo {
  /** Version currently running. */
  current_version: string;
  /** Latest published release, when the check is enabled and succeeded. */
  latest_release: { tag_name: string; html_url: string; published_at: string } | null;
  /** Set only when the latest release is newer than the running version. */
  changeset: { id: string; timestamp: number; compare_url: string } | null;
  /** Local plugin names that have updates. */
  plugins: string[];
  /** Unix time of this check. */
  checked_at: number;
}

/** Check for a newer core release and updated local plugins (admins only). */
export async function checkForUpdates(backend: LegacyBackend): Promise<UpdateInfo> {
  const response = await backend.call('RPC', 'checkforupdates');
  const body = requireBody(response, 'RPC/checkforupdates');

  const raw = body.changeset;
  const changeset =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? {
          id: asString((raw as Record<string, unknown>).id),
          timestamp: asNumber((raw as Record<string, unknown>).timestamp),
          compare_url: asString((raw as Record<string, unknown>).compare_url),
        }
      : null;

  const releaseRaw = body.latest_release;
  const latestRelease =
    releaseRaw && typeof releaseRaw === 'object' && !Array.isArray(releaseRaw)
      ? {
          tag_name: asString((releaseRaw as Record<string, unknown>).tag_name),
          html_url: asString((releaseRaw as Record<string, unknown>).html_url),
          published_at: asString((releaseRaw as Record<string, unknown>).published_at),
        }
      : null;

  const plugins = Array.isArray(body.plugins)
    ? body.plugins
        .map((item) =>
          typeof item === 'string'
            ? item
            : asString((item as Record<string, unknown>)?.plugin)
        )
        .filter((name) => name !== '')
    : [];

  return {
    current_version: asString(body.current_version),
    latest_release: latestRelease,
    changeset,
    plugins,
    checked_at: asNumber(body.checked_at),
  };
}
