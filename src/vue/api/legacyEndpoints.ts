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
}

export interface AdaptedCategory {
  id: number;
  title: string;
  unread: number;
  parent_id: number | null;
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
  /** Plugin-provided article buttons (HOOK_ARTICLE_BUTTON), as an HTML fragment. */
  buttons: string;
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

  return { feeds, categories };
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
): Promise<{ feeds: AdaptedFeed[]; categories: AdaptedCategory[] }> {
  const [treeResponse, counters] = await Promise.all([
    backend.call('Pref_Feeds', 'getfeedtree', { mode: 2 }),
    loadCounters(backend),
  ]);

  const body = requireBody(treeResponse, 'Pref_Feeds/getfeedtree');
  const rootItems = expectArray(body.items, 'Pref_Feeds/getfeedtree.items');

  const feeds: AdaptedFeed[] = [];
  const categories: AdaptedCategory[] = [];

  collectTree(rootItems, null, counters, feeds, categories);

  return { feeds, categories };
}

export interface HeadlinesPage {
  headlines: AdaptedHeadline[];
  count: number;
  first_id: number;
  /** Set when the backend refused to render a list (e.g. "Feed not found."). */
  message: string | null;
}

function adaptHeadline(raw: unknown): AdaptedHeadline {
  const line = expectObject(raw, 'Feeds/view.headline');
  const unread = asBoolean(line.unread);
  const comments = asString(line.comments);

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
    // Plugin article buttons (HOOK_ARTICLE_BUTTON). Feeds/view emits them as an
    // HTML fragment with the plugin class on each element; the client renders
    // the fragment and lets each button's inline handler call into the plugin.
    buttons: asString(line.buttons),
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
  });

  const body = requireBody(response, 'Feeds/view');
  const headlines = expectObject(body.headlines, 'Feeds/view.headlines');
  const info = expectObject(body['headlines-info'], 'Feeds/view.headlines-info');

  const content = headlines.content;
  const count = asNumber(info.count);
  const firstId = asNumber(headlines.first_id);

  if (typeof content === 'string') {
    // A string body is the legacy empty/error marker.
    return { headlines: [], count, first_id: firstId, message: stripTags(content) };
  }

  const rows = expectArray(content, 'Feeds/view.headlines.content');
  return {
    headlines: rows.map(adaptHeadline),
    count,
    first_id: firstId,
    message: null,
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

/**
 * `Pref_Prefs/getProfiles` returns a top-level JSON array of the user's
 * settings profiles, each with an `active` flag and an `initialized` flag
 * (whether it overrides any preference yet).
 */
export async function getProfiles(
  backend: LegacyBackend
): Promise<Array<{ id: number; title: string; active: boolean; initialized: boolean }>> {
  const response = await backend.call('Pref_Prefs', 'getProfiles');
  const body = requireBody(response, 'Pref_Prefs/getProfiles');
  const rows = expectArray(body.data, 'Pref_Prefs/getProfiles');

  return rows.map((raw) => {
    const profile = expectObject(raw, 'Pref_Prefs/getProfiles.profile');
    return {
      id: asNumber(profile.id),
      title: asString(profile.title),
      active: asBoolean(profile.active),
      initialized: asBoolean(profile.initialized),
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
): Promise<{ showLanguage: boolean; defaultLanguage: string; allLanguages: string[] }> {
  const response = await backend.call('Feeds', 'search');
  const body = requireBody(response, 'Feeds/search');
  const allLanguages = Array.isArray(body.all_languages)
    ? body.all_languages.map((lang) => asString(lang)).filter((lang) => lang !== '')
    : [];
  const defaultLanguage = asString(body.default_language);

  return {
    showLanguage: body.show_language === true,
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

/**
 * A node of the raw `Pref_Feeds/getfeedtree` tree, used by the preferences feed
 * tab where order matters. Feeds and categories are distinguished by the `id`
 * prefix ("FEED:"/"CAT:"), matching `isFeedNode`.
 */
export interface RawTreeNode {
  id: string;
  bare_id: number;
  name: string;
  type: 'feed' | 'category';
  children: RawTreeNode[];
}

/**
 * The preferences feed tree, preserving ids and nesting so the UI can reorder
 * feeds and categories. Unlike `getFeedTree` this does not merge counters or
 * flatten the structure; it is the shape `savefeedorder` round-trips.
 */
export async function getRawFeedTree(backend: LegacyBackend): Promise<RawTreeNode[]> {
  const response = await backend.call('Pref_Feeds', 'getfeedtree', { mode: 2 });
  const body = requireBody(response, 'Pref_Feeds/getfeedtree');
  const rootItems = expectArray(body.items, 'Pref_Feeds/getfeedtree.items');

  return rootItems.map(adaptRawNode).filter((node): node is RawTreeNode => node !== null);
}

function adaptRawNode(raw: unknown): RawTreeNode | null {
  const node = expectObject(raw, 'Pref_Feeds/getfeedtree.node');
  const id = asString(node.id);
  const bareId = asNumber(node.bare_id, Number.NaN);

  if (!Number.isFinite(bareId)) return null;

  const isFeed = node.type === 'feed' || id.startsWith('FEED:');
  const childItems = Array.isArray(node.items) ? node.items : [];

  return {
    id,
    bare_id: bareId,
    name: asString(node.name),
    type: isFeed ? 'feed' : 'category',
    children: childItems
      .map(adaptRawNode)
      .filter((child): child is RawTreeNode => child !== null),
  };
}

/**
 * Persist the feed/category tree.
 *
 * `savefeedorder` decodes `payload` into `{items: [...]}` and builds a map from
 * it: every entry's `id` maps to its own `items` array, and the entry whose id
 * is `root` becomes the starting point. `process_category_order` then walks
 * that map, reading each entry's `_reference` ("FEED:<id>"/"CAT:<id>") to set
 * `order_id`, recursing into categories via `data_map[cat_reference]`.
 *
 * So the payload must contain one entry per node that has children (the root
 * plus every category) and every child must carry a `_reference`.
 */
export async function saveFeedOrder(backend: LegacyBackend, tree: RawTreeNode[]): Promise<void> {
  const entries: Array<{ id: string; items: Array<{ _reference: string }> }> = [];

  const collect = (nodes: RawTreeNode[]): Array<{ _reference: string }> => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        entries.push({ id: node.id, items: node.children.map(child => ({ _reference: child.id })) });
        collect(node.children);
      }
    }
    return nodes.map(node => ({ _reference: node.id }));
  };

  const rootItems = collect(tree);
  const payload = { items: [{ id: 'root', items: rootItems }, ...entries] };

  await backend.call('Pref_Feeds', 'savefeedorder', { payload: JSON.stringify(payload) });
}

/** `Pref_Feeds/feedsortreset` clears per-feed manual ordering. */
export async function resetFeedSortOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Feeds', 'feedsortreset');
}

/** `Pref_Feeds/catsortreset` clears per-category manual ordering. */
export async function resetCatSortOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Feeds', 'catsortreset');
}

/** `Pref_Feeds/removeIcon` deletes a feed's cached favicon. */
export async function removeFeedIcon(backend: LegacyBackend, feedId: number): Promise<void> {
  await backend.call('Pref_Feeds', 'removeIcon', { feed_id: feedId });
}

/** The result codes `Pref_Feeds/uploadIcon` answers with. */
export const ICON_UPLOAD_SUCCESS = 'E_ICON_UPLOAD_SUCCESS';

/**
 * `Pref_Feeds/uploadIcon` accepts a multipart upload and answers with
 * `{rc, icon_url}`. The transport posts JSON, so this call bypasses it and
 * sends `FormData` directly with the CSRF token in the body.
 */
export async function uploadFeedIcon(
  backend: LegacyBackend,
  feedId: number,
  file: File
): Promise<{ rc: string; icon_url: string }> {
  const form = new FormData();
  form.append('op', 'Pref_Feeds');
  form.append('method', 'uploadIcon');
  form.append('feed_id', String(feedId));
  form.append('icon_file', file);
  form.append('csrf_token', await backend.ensureCsrfToken());

  const response = await fetch('/backend.php', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!response.ok) {
    throw new LegacyProtocolError(`Pref_Feeds/uploadIcon returned HTTP ${response.status}.`);
  }

  const body = await response.json() as Record<string, unknown>;
  return { rc: asString(body.rc), icon_url: asString(body.icon_url) };
}

/**
 * `OPML/export` streams an XML document, so it is a navigation rather than a
 * parsed call. These are the query options `Pref_Feeds`'s export form exposes.
 */
export function opmlExportUrl(options: { hidePrivate?: boolean; includeSettings?: boolean } = {}): string {
  const params = new URLSearchParams({ op: 'OPML', method: 'export' });
  if (options.hidePrivate) params.set('hide_private', '1');
  if (options.includeSettings === false) params.set('include_settings', '0');
  return `/backend.php?${params.toString()}`;
}

/**
 * `Pref_Feeds/importOpml` consumes a multipart upload of an OPML file and
 * prints an HTML summary. Like `uploadFeedIcon` it bypasses the JSON transport.
 */
export async function importOpml(backend: LegacyBackend, file: File): Promise<string> {
  const form = new FormData();
  form.append('op', 'Pref_Feeds');
  form.append('method', 'importOpml');
  form.append('opml_file', file);
  form.append('csrf_token', await backend.ensureCsrfToken());

  const response = await fetch('/backend.php', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!response.ok) {
    throw new LegacyProtocolError(`Pref_Feeds/importOpml returned HTTP ${response.status}.`);
  }

  return response.text();
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
 * `Pref_Labels/colorset` sets a label's colours. With `kind` "fg"/"bg" it
 * writes just that channel from `color`; otherwise it writes both from `fg`
 * and `bg`. The handler clears the cached label data as a side effect.
 */
export async function setLabelColor(
  backend: LegacyBackend,
  labelId: number,
  kind: 'fg' | 'bg',
  color: string
): Promise<void> {
  await backend.call('Pref_Labels', 'colorset', { ids: labelId, kind, color });
}

/** `Pref_Labels/colorreset` clears the given labels' colours. */
export async function resetLabelColors(
  backend: LegacyBackend,
  labelIds: number[]
): Promise<void> {
  if (labelIds.length === 0) return;
  await backend.call('Pref_Labels', 'colorreset', { ids: labelIds.join(',') });
}

/** `Pref_Labels/save` renames a label; it echoes the resulting caption. */
export async function renameLabel(
  backend: LegacyBackend,
  labelId: number,
  caption: string
): Promise<string> {
  const response = await backend.call('Pref_Labels', 'save', { id: labelId, caption });
  return response.raw.trim();
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

/** One filter rule, as `Pref_Filters/edit` and `editSave` exchange it. */
export interface FilterRule {
  reg_exp: string;
  filter_type: number;
  /** Feed ids (numbers) and category references ("CAT:<id>"); "0" is all feeds. */
  feed_id: Array<number | string>;
  inverse?: boolean;
  /** Human-readable summary; supplied by the backend, not sent back on save. */
  name?: string;
}

/** One filter action, as `Pref_Filters/edit` and `editSave` exchange it. */
export interface FilterAction {
  action_id: number;
  action_param: string;
  /** Only present for label actions; `editSave` reads it for ACTION_LABEL. */
  action_param_label?: string;
  name?: string;
}

/**
 * The filter editor's payload from `Pref_Filters/edit`. `filter_types`,
 * `action_types` and `plugin_actions` are id→description maps used to populate
 * the rule and action dropdowns; `labels` feeds the label action's selector.
 */
export interface FilterDetails {
  id: number;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  title: string;
  rules: FilterRule[];
  actions: FilterAction[];
  filter_types: Record<string, string>;
  action_types: Record<string, string>;
  plugin_actions: Record<string, string>;
  labels: Array<{ id: number; caption: string }>;
}

/**
 * `Pref_Filters/edit` returns the filter's current state plus the option maps
 * the editor needs. `id=0` yields a blank filter (the "create" case).
 */
export async function getFilterDetails(
  backend: LegacyBackend,
  filterId: number
): Promise<FilterDetails> {
  const response = await backend.call('Pref_Filters', 'edit', { id: filterId });
  const body = requireBody(response, 'Pref_Filters/edit');

  const rules = Array.isArray(body.rules) ? body.rules : [];
  const actions = Array.isArray(body.actions) ? body.actions : [];

  return {
    id: asNumber(body.id),
    enabled: asBoolean(body.enabled),
    match_any_rule: asBoolean(body.match_any_rule),
    inverse: asBoolean(body.inverse),
    title: asString(body.title),
    rules: rules.map(adaptFilterRule),
    actions: actions.map(adaptFilterAction),
    filter_types: asStringMap(body.filter_types),
    action_types: asStringMap(body.action_types),
    plugin_actions: asStringMap(body.plugin_actions),
    labels: adaptFilterLabels(body.labels),
  };
}

function adaptFilterRule(raw: unknown): FilterRule {
  const rule = expectObject(raw, 'Pref_Filters/edit.rule');
  const feedIds = Array.isArray(rule.feed_id)
    ? rule.feed_id.map((id) => (typeof id === 'number' ? id : asString(id)))
    : [];

  return {
    reg_exp: asString(rule.reg_exp),
    filter_type: asNumber(rule.filter_type, 1),
    feed_id: feedIds,
    // The backend omits `inverse` entirely for the "false" case (see edit()).
    inverse: rule.inverse === undefined ? false : asBoolean(rule.inverse),
    name: asString(rule.name),
  };
}

function adaptFilterAction(raw: unknown): FilterAction {
  const action = expectObject(raw, 'Pref_Filters/edit.action');
  return {
    action_id: asNumber(action.action_id),
    action_param: asString(action.action_param),
    action_param_label: asString(action.action_param_label),
    name: asString(action.name),
  };
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = asString(entry);
  }
  return out;
}

function adaptFilterLabels(value: unknown): Array<{ id: number; caption: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const label = expectObject(raw, 'Pref_Filters/edit.label');
    return { id: asNumber(label.id), caption: asString(label.caption) };
  });
}

/**
 * `Pref_Filters/editSave` rewrites the filter and replaces its rules/actions.
 * Checkbox fields follow `checkbox_to_sql_bool()`, which recognises only the
 * literal "on". Rules and actions are sent as a repeated list of JSON strings,
 * matching the Dojo form's `rule[]`/`action[]` encoding.
 */
export async function saveFilter(
  backend: LegacyBackend,
  filterId: number,
  details: {
    title: string;
    enabled: boolean;
    match_any_rule: boolean;
    inverse: boolean;
    rules: FilterRule[];
    actions: FilterAction[];
  }
): Promise<void> {
  await backend.call('Pref_Filters', 'editSave', {
    id: filterId,
    title: details.title,
    enabled: checkboxValue(details.enabled),
    match_any_rule: checkboxValue(details.match_any_rule),
    inverse: checkboxValue(details.inverse),
    rule: details.rules.map((rule) => JSON.stringify(rule)),
    action: details.actions.map((action) => JSON.stringify(action)),
  });
}

/**
 * `Pref_Filters/add` creates a filter. The handler reads the same fields as
 * `editSave` (it calls the shared rule/action saver), so the encoding matches.
 */
export async function addFilter(
  backend: LegacyBackend,
  details: {
    title: string;
    enabled: boolean;
    match_any_rule: boolean;
    inverse: boolean;
    rules: FilterRule[];
    actions: FilterAction[];
  }
): Promise<void> {
  await backend.call('Pref_Filters', 'add', {
    title: details.title,
    enabled: checkboxValue(details.enabled),
    match_any_rule: checkboxValue(details.match_any_rule),
    inverse: checkboxValue(details.inverse),
    rule: details.rules.map((rule) => JSON.stringify(rule)),
    action: details.actions.map((action) => JSON.stringify(action)),
  });
}

/** `Pref_Filters/remove` takes a comma-delimited id list. */
export async function removeFilters(backend: LegacyBackend, filterIds: number[]): Promise<void> {
  if (filterIds.length === 0) return;
  await backend.call('Pref_Filters', 'remove', { ids: filterIds.join(',') });
}

/** `Pref_Filters/clone` duplicates filters; a single id may be retitled. */
export async function cloneFilters(
  backend: LegacyBackend,
  filterIds: number[],
  newTitle?: string
): Promise<void> {
  if (filterIds.length === 0) return;
  const params: Record<string, string | number> = { ids: filterIds.join(',') };
  if (filterIds.length === 1 && newTitle) params.new_filter_title = newTitle;
  await backend.call('Pref_Filters', 'clone', params);
}

/**
 * `Pref_Filters/join` merges several filters into the first one (the handler
 * shifts the base id off the list). Fewer than two ids is a no-op there.
 */
export async function joinFilters(backend: LegacyBackend, filterIds: number[]): Promise<void> {
  if (filterIds.length < 2) return;
  await backend.call('Pref_Filters', 'join', { ids: filterIds.join(',') });
}

/** `Pref_Filters/filtersortreset` clears the manual ordering of all filters. */
export async function resetFilterOrder(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Filters', 'filtersortreset');
}

/**
 * Persist filter order. The handler walks a nested tree of `_reference` ids
 * ("FILTER:<id>") grouped by their parent folder id, so the payload mirrors the
 * structure the Dojo tree sent.
 */
export async function saveFilterOrder(backend: LegacyBackend, order: number[]): Promise<void> {
  const payload = {
    items: [
      {
        id: 'root',
        items: order.map((id) => ({ _reference: `FILTER:${id}` })),
      },
    ],
  };
  await backend.call('Pref_Filters', 'savefilterorder', { payload: JSON.stringify(payload) });
}

/**
 * `Pref_Filters/testFilterDo` previews which articles a rule set would match.
 * It answers with `{pre_filtering_count, items}`; the caller pages by `offset`.
 */
export async function testFilter(
  backend: LegacyBackend,
  params: {
    match_any_rule: boolean;
    inverse: boolean;
    rules: FilterRule[];
    offset: number;
    limit: number;
  }
): Promise<{ pre_filtering_count: number; items: Array<Record<string, unknown>> }> {
  const response = await backend.call('Pref_Filters', 'testFilterDo', {
    match_any_rule: checkboxValue(params.match_any_rule),
    inverse: checkboxValue(params.inverse),
    rule: params.rules.map((rule) => JSON.stringify(rule)),
    offset: params.offset,
    limit: params.limit,
  });
  const body = requireBody(response, 'Pref_Filters/testFilterDo');

  return {
    pre_filtering_count: asNumber(body.pre_filtering_count),
    items: Array.isArray(body.items)
      ? body.items.map((item) => expectObject(item, 'Pref_Filters/testFilterDo.item'))
      : [],
  };
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
 * `Pref_Prefs/saveconfig` saves a batch of preferences at once. It reads the
 * posted field names directly, so the payload is a plain name→value map; the
 * `boolean_prefs` field lists which of them are checkboxes so the handler can
 * default unchecked ones to "false".
 */
export async function saveConfig(
  backend: LegacyBackend,
  values: Record<string, string>,
  booleanPrefs: string[]
): Promise<{ reload: boolean; message: string }> {
  const response = await backend.call('Pref_Prefs', 'saveconfig', {
    ...values,
    boolean_prefs: booleanPrefs.join(','),
  });

  // The handler answers "PREFS_NEED_RELOAD" when a theme/language change means
  // the page must reload, otherwise a human-readable confirmation string.
  const raw = response.raw.trim();
  return { reload: raw === 'PREFS_NEED_RELOAD', message: stripTags(raw) };
}

/** `Pref_Prefs/resetconfig` restores a user's preferences to their defaults. */
export async function resetConfig(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_Prefs', 'resetconfig');
}

/** `Pref_Prefs/changepassword` changes the current user's password. */
export async function changePassword(
  backend: LegacyBackend,
  oldPassword: string,
  newPassword: string,
  confirmPassword: string
): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'changepassword', {
    old_password: oldPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  });
  return stripTags(response.raw.trim());
}

/** `Pref_Prefs/changePersonalData` updates the full name and email address. */
export async function changePersonalData(
  backend: LegacyBackend,
  fullName: string,
  email: string
): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'changePersonalData', {
    full_name: fullName,
    email,
  });
  return stripTags(response.raw.trim());
}

/** One plugin row from `Pref_Prefs/getPluginsList`. */
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

/**
 * `Pref_Prefs/getPluginsList` returns `{plugins: [...], is_admin}`. The list is
 * the same one the Dojo plugin manager renders.
 */
export async function getPluginsList(
  backend: LegacyBackend
): Promise<{ plugins: PluginInfo[]; isAdmin: boolean }> {
  const response = await backend.call('Pref_Prefs', 'getPluginsList');
  const body = requireBody(response, 'Pref_Prefs/getPluginsList');
  const rows = Array.isArray(body.plugins) ? body.plugins : [];

  return {
    isAdmin: asBoolean(body.is_admin),
    plugins: rows.map((raw) => {
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
      };
    }),
  };
}

/** `Pref_Prefs/setplugins` enables or disables the current user's plugins. The
 * handler reads the enabled set as `plugins[]` and takes `csrf_token` in the
 * body like every other call.
 */
export async function setPlugins(backend: LegacyBackend, enabled: string[]): Promise<void> {
  await backend.call('Pref_Prefs', 'setplugins', { plugins: enabled });
}

export interface PrefItem {
  name: string;
  kind: 'bool' | 'int' | 'text' | 'textarea' | 'select' | 'separator';
  label: string;
  help_text: string;
  value: string;
  /** Present for `select`; a value→caption map. */
  options?: Record<string, string>;
}

export interface PrefSection {
  title: string;
  items: PrefItem[];
}

/** The control kinds that post a boolean (`boolean_prefs` list). */
export const BOOLEAN_PREF_KIND = 'bool';

/**
 * The `saveconfig` field names for the given sections: every control except
 * separators. Boolean controls must be listed in `boolean_prefs` so an
 * unchecked box (absent from the form) still saves as "false".
 */
export function prefFormFields(sections: PrefSection[]): {
  values: Record<string, string>;
  booleanPrefs: string[];
} {
  const values: Record<string, string> = {};
  const booleanPrefs: string[] = [];

  for (const section of sections) {
    for (const item of section.items) {
      if (item.kind === 'separator') continue;
      values[item.name] = item.value;
      if (item.kind === BOOLEAN_PREF_KIND) booleanPrefs.push(item.name);
    }
  }

  return { values, booleanPrefs };
}

/**
 * `Pref_Prefs/getprefsjson` returns the preference form as data: the same
 * sections and controls `index_prefs_list()` renders server-side, with the
 * resolved values and select options included.
 */
export async function getPrefsJson(
  backend: LegacyBackend
): Promise<{ sections: PrefSection[]; isProfile: boolean }> {
  const response = await backend.call('Pref_Prefs', 'getprefsjson');
  const body = requireBody(response, 'Pref_Prefs/getprefsjson');
  const sections = Array.isArray(body.sections) ? body.sections : [];

  return {
    isProfile: asBoolean(body.is_profile),
    sections: sections.map((rawSection) => {
      const section = expectObject(rawSection, 'Pref_Prefs/getprefsjson.section');
      const items = Array.isArray(section.items) ? section.items : [];
      return {
        title: asString(section.title),
        items: items.map(adaptPrefItem),
      };
    }),
  };
}

function adaptPrefItem(raw: unknown): PrefItem {
  const item = expectObject(raw, 'Pref_Prefs/getprefsjson.item');
  const options = item.options;

  return {
    name: asString(item.name),
    kind: asString(item.kind, 'text') as PrefItem['kind'],
    label: asString(item.label),
    help_text: asString(item.help_text),
    value: asString(item.value),
    options:
      typeof options === 'object' && options !== null && !Array.isArray(options)
        ? asStringMap(options)
        : undefined,
  };
}

/** One user row for the administration users tab (`Pref_Users/getusersjson`). */
export interface UserInfo {
  id: number;
  login: string;
  access_level: number;
  access_level_name: string;
  num_feeds: number;
  created: string;
  last_login: string;
}

/** `Pref_Users/getusersjson` returns the user table plus the level names. */
export async function getUsers(
  backend: LegacyBackend,
  options: { search?: string; sort?: string } = {}
): Promise<{ users: UserInfo[]; accessLevelNames: Record<string, string> }> {
  const response = await backend.call('Pref_Users', 'getusersjson', {
    ...(options.search !== undefined ? { search: options.search } : {}),
    ...(options.sort !== undefined ? { sort: options.sort } : {}),
  });
  const body = requireBody(response, 'Pref_Users/getusersjson');
  const rows = Array.isArray(body.users) ? body.users : [];

  return {
    accessLevelNames: asStringMap(body.access_level_names),
    users: rows.map((raw) => {
      const user = expectObject(raw, 'Pref_Users/getusersjson.user');
      return {
        id: asNumber(user.id),
        login: asString(user.login),
        access_level: asNumber(user.access_level),
        access_level_name: asString(user.access_level_name),
        num_feeds: asNumber(user.num_feeds),
        created: asString(user.created),
        last_login: asString(user.last_login),
      };
    }),
  };
}

/** One event-log row from `Pref_System/getlogjson`. */
export interface LogEntry {
  errno: number;
  errno_name: string;
  filename: string;
  lineno: number;
  errstr: string;
  context: string;
  login: string;
  created_at: string;
}

/** `Pref_System/getlogjson` pages the event log by severity. */
export async function getEventLog(
  backend: LegacyBackend,
  options: { page?: number; severity?: number } = {}
): Promise<{ page: number; totalPages: number; severity: number; entries: LogEntry[] }> {
  const response = await backend.call('Pref_System', 'getlogjson', {
    ...(options.page !== undefined ? { page: options.page } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
  });
  const body = requireBody(response, 'Pref_System/getlogjson');
  const rows = Array.isArray(body.entries) ? body.entries : [];

  return {
    page: asNumber(body.page),
    totalPages: asNumber(body.total_pages),
    severity: asNumber(body.severity),
    entries: rows.map((raw) => {
      const entry = expectObject(raw, 'Pref_System/getlogjson.entry');
      return {
        errno: asNumber(entry.errno),
        errno_name: asString(entry.errno_name),
        filename: asString(entry.filename),
        lineno: asNumber(entry.lineno),
        errstr: asString(entry.errstr),
        context: asString(entry.context),
        login: asString(entry.login),
        created_at: asString(entry.created_at),
      };
    }),
  };
}

/** `Pref_System/clearLog` empties the event log. */
export async function clearEventLog(backend: LegacyBackend): Promise<void> {
  await backend.call('Pref_System', 'clearLog');
}

/** `Pref_System/sendTestEmail` sends a test message to the given address. */
export async function sendTestEmail(
  backend: LegacyBackend,
  address: string
): Promise<{ rc: boolean; error: string }> {
  const response = await backend.call('Pref_System', 'sendTestEmail', { mail_address: address });
  const body = requireBody(response, 'Pref_System/sendTestEmail');

  return { rc: asBoolean(body.rc), error: asString(body.error) };
}

/** `Pref_System/getphpinfo` returns a phpinfo() HTML fragment. */
export async function getPhpInfo(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('Pref_System', 'getphpinfo');
  return response.raw;
}

/** One app password row from `Pref_Prefs/getauthjson`. */
export interface AppPassword {
  id: number;
  title: string;
  created: string;
  last_used: string;
}

/** The Personal data / Authentication payload from `Pref_Prefs/getauthjson`. */
export interface AuthInfo {
  full_name: string;
  email: string;
  can_change_password: boolean;
  auth_module: string;
  app_passwords: AppPassword[];
  otp_enabled: boolean;
  otp_available: boolean;
  /** Data-URI SVG QR code; only present while OTP is disabled. */
  otp_qrcode: string | null;
  /** Space-grouped provisioning secret; only present while OTP is disabled. */
  otp_secret: string | null;
}

/** `Pref_Prefs/getauthjson` returns the Personal data / Authentication state. */
export async function getAuthInfo(backend: LegacyBackend): Promise<AuthInfo> {
  const response = await backend.call('Pref_Prefs', 'getauthjson');
  const body = requireBody(response, 'Pref_Prefs/getauthjson');
  const passwords = Array.isArray(body.app_passwords) ? body.app_passwords : [];

  return {
    full_name: asString(body.full_name),
    email: asString(body.email),
    can_change_password: asBoolean(body.can_change_password),
    auth_module: asString(body.auth_module),
    otp_enabled: asBoolean(body.otp_enabled),
    otp_available: asBoolean(body.otp_available),
    otp_qrcode: body.otp_qrcode === null || body.otp_qrcode === undefined ? null : asString(body.otp_qrcode),
    otp_secret: body.otp_secret === null || body.otp_secret === undefined ? null : asString(body.otp_secret),
    app_passwords: passwords.map((raw) => {
      const pass = expectObject(raw, 'Pref_Prefs/getauthjson.app_password');
      return {
        id: asNumber(pass.id),
        title: asString(pass.title),
        created: asString(pass.created),
        last_used: asString(pass.last_used),
      };
    }),
  };
}

/** `Pref_Prefs/generateAppPassword` creates a named API password. */
export async function generateAppPassword(
  backend: LegacyBackend,
  title: string
): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'generateAppPassword', { title });
  return stripTags(response.raw);
}

/** `Pref_Prefs/deleteAppPasswords` removes app passwords by id. */
export async function deleteAppPasswords(
  backend: LegacyBackend,
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  await backend.call('Pref_Prefs', 'deleteAppPasswords', { ids });
}

/**
 * `Pref_Prefs/otpenable` / `otpdisable` answer "OK" on success or an
 * "ERROR:..." string. They are surfaced verbatim so the caller can show it.
 */
export async function setOtp(
  backend: LegacyBackend,
  enable: boolean,
  params: { password: string; otp?: string }
): Promise<string> {
  const response = await backend.call('Pref_Prefs', enable ? 'otpenable' : 'otpdisable', {
    password: params.password,
    ...(params.otp !== undefined ? { otp: params.otp } : {}),
  });
  return response.raw.trim();
}

/** `Pref_Prefs/previewDigest` returns the digest HTML fragment. */
export async function previewDigest(backend: LegacyBackend): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'previewDigest');
  const body = requireBody(response, 'Pref_Prefs/previewDigest');
  return typeof body.data === 'string' ? body.data : response.raw;
}

/** `Pref_Prefs/customizeCSS` writes the user's custom stylesheet. */
export async function customizeCSS(backend: LegacyBackend, value: string): Promise<string> {
  const response = await backend.call('Pref_Prefs', 'customizeCSS', { value });
  const body = requireBody(response, 'Pref_Prefs/customizeCSS');
  return asString(body.value);
}

/**
 * `Pref_Prefs/getprefstabs` captures each plugin's HOOK_PREFS_TAB output as an
 * HTML fragment keyed by the tab it belongs to (prefPrefs, prefFeeds, ...).
 */
export async function getPluginPrefsTabs(
  backend: LegacyBackend
): Promise<Record<string, string>> {
  const response = await backend.call('Pref_Prefs', 'getprefstabs');
  const body = requireBody(response, 'Pref_Prefs/getprefstabs');
  return asStringMap(body.tabs);
}

/**
 * `Pref_Users/edit` returns a single user's editable fields. It is used to
 * populate the user editor dialog.
 */
export async function getUserDetails(
  backend: LegacyBackend,
  userId: number
): Promise<{ id: number; login: string; access_level: number; email: string; otp_enabled: boolean }> {
  const response = await backend.call('Pref_Users', 'edit', { id: userId });
  const body = requireBody(response, 'Pref_Users/edit');
  // edit() answers {user: {...}, access_level_names: {...}}.
  const user = expectObject(body.user, 'Pref_Users/edit.user');

  return {
    id: asNumber(user.id),
    login: asString(user.login),
    access_level: asNumber(user.access_level),
    email: asString(user.email),
    otp_enabled: asBoolean(user.otp_enabled),
  };
}

/** `Pref_Users/editSave` writes a user's login, access level, email and OTP. */
export async function saveUser(
  backend: LegacyBackend,
  user: {
    id: number;
    login: string;
    access_level: number;
    email: string;
    otp_enabled: boolean;
    password?: string;
  }
): Promise<void> {
  await backend.call('Pref_Users', 'editSave', {
    id: user.id,
    login: user.login,
    access_level: user.access_level,
    email: user.email,
    otp_enabled: checkboxValue(user.otp_enabled),
    ...(user.password ? { password: user.password } : {}),
  });
}

/** `Pref_Users/add` creates a user with the given login and password. */
export async function addUser(
  backend: LegacyBackend,
  login: string,
  password: string,
  accessLevel: number
): Promise<void> {
  await backend.call('Pref_Users', 'add', { login, password, access_level: accessLevel });
}

/** `Pref_Users/remove` deletes users by id. */
export async function removeUsers(backend: LegacyBackend, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  await backend.call('Pref_Users', 'remove', { ids: userIds.join(',') });
}

/** `Pref_Users/resetPass` resets a user's password. */
export async function resetUserPassword(
  backend: LegacyBackend,
  userId: number,
  password: string
): Promise<void> {
  await backend.call('Pref_Users', 'resetPass', { id: userId, password });
}

/**
 * `Pref_Prefs/addprofile` creates a settings profile.
 */
export async function addProfile(
  backend: LegacyBackend,
  title: string,
  activate = false
): Promise<void> {
  await backend.call('Pref_Prefs', 'addprofile', {
    title,
    ...(activate ? { activate: 'on' } : {}),
  });
}

/** `Pref_Prefs/remprofiles` deletes settings profiles. */
export async function removeProfiles(backend: LegacyBackend, profileIds: number[]): Promise<void> {
  if (profileIds.length === 0) return;
  await backend.call('Pref_Prefs', 'remprofiles', { ids: profileIds.join(',') });
}

/** `Pref_Prefs/activateprofile` switches the active settings profile. */
export async function activateProfile(backend: LegacyBackend, profileId: number): Promise<void> {
  await backend.call('Pref_Prefs', 'activateprofile', { id: profileId });
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
