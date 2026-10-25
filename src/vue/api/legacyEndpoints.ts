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
  return typeof value === 'string' ? value : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asBoolean(value: unknown): boolean {
  // PostgreSQL returns booleans as 't'/'f' through PDO; legacy handlers also
  // emit 1/0, '1'/'0' and the checkbox literal 'on'.
  return value === true || value === 1 || value === '1' || value === 'true'
    || value === 't' || value === 'on';
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

  for (const rawCategory of rootItems) {
    const category = expectObject(rawCategory, 'Pref_Feeds/getfeedtree.category');
    const categoryId = asNumber(category.bare_id, Number.NaN);
    if (!Number.isFinite(categoryId)) continue;

    const childItems = Array.isArray(category.items)
      ? category.items
      : [];

    // Special and Labels are rendered from dedicated sources (hardcoded
    // special feeds, labels store); skip them here to avoid duplicates.
    if (categoryId === CATEGORY_SPECIAL || categoryId === CATEGORY_LABELS) {
      continue;
    }

    if (categoryId !== CATEGORY_UNCATEGORIZED) {
      categories.push({
        id: categoryId,
        title: asString(category.name),
        unread: counters.categories.get(categoryId) ?? 0,
        parent_id: category.parent_id === undefined ? null : asNumber(category.parent_id, 0),
      });
    }

    for (const rawFeed of childItems) {
      const feed = expectObject(rawFeed, 'Pref_Feeds/getfeedtree.feed');
      if (feed.type !== 'feed') continue;
      const feedId = asNumber(feed.bare_id, Number.NaN);
      if (!Number.isFinite(feedId)) continue;

      feeds.push({
        id: feedId,
        title: asString(feed.name),
        unread: counters.feeds.get(feedId) ?? 0,
        cat_id: categoryId === CATEGORY_UNCATEGORIZED ? null : categoryId,
        // getfeedtree does not return feed_url/site_url; these are only
        // available from Pref_Feeds/editfeed. Leave them empty rather than
        // fabricating values.
        feed_url: '',
        site_url: '',
      });
    }
  }

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
    viewMode?: 'adaptive' | 'all_articles' | 'unread';
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
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
 * `Pref_Filters/getfiltertree` returns `{items: [{items: [{bare_id, name,
 * rules, ...}]}]}`.
 */
export interface AdaptedFilter {
  id: number;
  title: string;
  enabled: boolean;
  last_triggered: string | null;
  /** Human-readable rules, one per line. */
  rules: string[];
}

export async function getFilters(backend: LegacyBackend): Promise<AdaptedFilter[]> {
  const response = await backend.call('Pref_Filters', 'getfiltertree');
  const body = requireBody(response, 'Pref_Filters/getfiltertree');
  const roots = expectArray(body.items, 'Pref_Filters/getfiltertree.items');

  const filters: AdaptedFilter[] = [];
  for (const rawRoot of roots) {
    const root = expectObject(rawRoot, 'Pref_Filters/getfiltertree.root');
    if (!Array.isArray(root.items)) continue;
    for (const rawFilter of root.items) {
      const filter = expectObject(rawFilter, 'Pref_Filters/getfiltertree.filter');
      filters.push({
        id: asNumber(filter.bare_id),
        title: asString(filter.bare_name, asString(filter.name)),
        enabled: filter.enabled !== false,
        last_triggered: filter.last_triggered ? asString(filter.last_triggered) : null,
        // `_get_rules_list()` returns a <ul> of <li> lines. Turn it into plain
        // text lines so the client never has to render backend HTML.
        rules: asString(filter.rules)
          .replace(/<li[^>]*>/gi, '')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== ''),
      });
    }
  }
  return filters;
}

export interface FilterRule {
  reg_exp: string;
  filter_type: number;
  /** Feed ids, or `CAT:<id>` entries, or `0` for all feeds. */
  feed_id: string[];
  inverse: boolean;
  name?: string;
}

export interface FilterAction {
  action_id: number;
  action_param: string;
  action_param_label: string;
  name?: string;
}

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
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asString(raw);
  }
  return result;
}

/** `Pref_Filters/edit` with id 0 returns the option lists for a new filter. */
export async function getFilterDetails(backend: LegacyBackend, filterId = 0): Promise<FilterDetails> {
  const response = await backend.call('Pref_Filters', 'edit', { id: filterId });
  const body = requireBody(response, 'Pref_Filters/edit');
  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  const rawActions = Array.isArray(body.actions) ? body.actions : [];

  return {
    id: asNumber(body.id, filterId),
    enabled: asBoolean(body.enabled ?? true),
    match_any_rule: asBoolean(body.match_any_rule),
    inverse: asBoolean(body.inverse),
    title: asString(body.title),
    rules: rawRules.map((rawRule) => {
      const rule = expectObject(rawRule, 'Pref_Filters/edit.rule');
      return {
        reg_exp: asString(rule.reg_exp),
        filter_type: asNumber(rule.filter_type, 1),
        feed_id: Array.isArray(rule.feed_id) ? rule.feed_id.map((id) => asString(id)) : ['0'],
        inverse: asBoolean(rule.inverse),
        name: rule.name === undefined ? undefined : asString(rule.name),
      };
    }),
    actions: rawActions.map((rawAction) => {
      const action = expectObject(rawAction, 'Pref_Filters/edit.action');
      return {
        action_id: asNumber(action.action_id, 8),
        action_param: asString(action.action_param),
        action_param_label: asString(action.action_param_label),
        name: action.name === undefined ? undefined : asString(action.name),
      };
    }),
    filter_types: stringMap(body.filter_types),
    action_types: stringMap(body.action_types),
  };
}

export interface FilterPayload {
  title: string;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  rules: FilterRule[];
  actions: FilterAction[];
}

/**
 * `Pref_Filters/editSave` replaces the rule/action rows, so both lists are
 * always sent. `rule[]`/`action[]` are JSON-encoded strings by contract.
 */
function filterParams(id: number | null, payload: FilterPayload): Record<string, string | number | string[]> {
  const params: Record<string, string | number | string[]> = {
    title: payload.title,
    enabled: payload.enabled ? 'on' : '',
    match_any_rule: payload.match_any_rule ? 'on' : '',
    inverse: payload.inverse ? 'on' : '',
    rule: payload.rules.map((rule) => JSON.stringify({
      reg_exp: rule.reg_exp,
      filter_type: rule.filter_type,
      feed_id: rule.feed_id,
      ...(rule.inverse ? { inverse: 1 } : {}),
    })),
    action: payload.actions.map((action) => JSON.stringify({
      action_id: action.action_id,
      action_param: action.action_param,
      action_param_label: action.action_param_label,
    })),
  };
  if (id !== null) params.id = id;
  return params;
}

export async function saveFilter(
  backend: LegacyBackend,
  filterId: number,
  payload: FilterPayload
): Promise<void> {
  await backend.call('Pref_Filters', 'editSave', filterParams(filterId, payload));
}

export async function createFilter(
  backend: LegacyBackend,
  payload: FilterPayload
): Promise<void> {
  await backend.call('Pref_Filters', 'add', filterParams(null, payload));
}

export interface PrefOption {
  value: string;
  title: string;
}

export interface PrefItem {
  /** Absent on separators. */
  name?: string;
  type: 'separator' | 'bool' | 'int' | 'string' | 'select' | 'textarea' | 'time';
  value?: string | number | boolean | null;
  label?: string;
  help?: string;
  options?: PrefOption[] | null;
  disabled?: boolean;
}

export interface PrefSection {
  title: string;
  items: PrefItem[];
}

export interface PrefsSchema {
  profile: number | null;
  sections: PrefSection[];
}

/**
 * `Pref_Prefs/getprefs` (added for the Vue client) returns the same preference
 * definitions the legacy page renders, as JSON. Returning metadata rather than
 * markup is what removes the dijit form from the preferences page.
 */
export async function getPrefsSchema(backend: LegacyBackend): Promise<PrefsSchema> {
  const response = await backend.call('Pref_Prefs', 'getprefs');
  const body = requireBody(response, 'Pref_Prefs/getprefs');
  const sections = expectArray(body.sections, 'Pref_Prefs/getprefs.sections');

  return {
    profile: body.profile === null || body.profile === undefined ? null : asNumber(body.profile),
    sections: sections.map((rawSection) => {
      const section = expectObject(rawSection, 'Pref_Prefs/getprefs.section');
      const items = Array.isArray(section.items) ? section.items : [];
      return {
        title: asString(section.title),
        items: items.map((rawItem) => {
          const item = expectObject(rawItem, 'Pref_Prefs/getprefs.item');
          return {
            name: item.name === undefined ? undefined : asString(item.name),
            type: asString(item.type, 'string') as PrefItem['type'],
            value: (item.value ?? null) as PrefItem['value'],
            label: asString(item.label),
            help: asString(item.help),
            options: Array.isArray(item.options)
              ? item.options.map((rawOption) => {
                  const option = expectObject(rawOption, 'Pref_Prefs/getprefs.option');
                  return { value: asString(option.value), title: asString(option.title) };
                })
              : null,
            disabled: item.disabled === true,
          };
        }),
      };
    }),
  };
}

export interface FeedDetails {
  id: number;
  title: string;
  feed_url: string;
  site_url: string;
  cat_id: number | null;
  update_interval: number;
  purge_interval: number;
  auth_login: string;
  /** Decrypted by `Pref_Feeds/editfeed`; empty when unset. */
  auth_pass: string;
  private: boolean;
  include_in_digest: boolean;
  cache_images: boolean;
  hide_images: boolean;
  always_display_enclosures: boolean;
  mark_unread_on_update: boolean;
  feed_language: string;
  /** interval id => label */
  update_intervals: Record<string, string>;
  purge_intervals: Record<string, string>;
  force_purge: number;
  default_search_language: string;
  search_languages: string[];
}

function intervalMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asString(raw);
  }
  return result;
}

/**
 * `Pref_Feeds/editfeed` returns the feed row plus interval/language lists. Its
 * `cats.select` field is legacy dijit HTML and is deliberately ignored: the
 * Vue client already has the category tree.
 */
export async function getFeedDetails(backend: LegacyBackend, feedId: number): Promise<FeedDetails> {
  const response = await backend.call('Pref_Feeds', 'editfeed', { id: feedId });
  const body = requireBody(response, 'Pref_Feeds/editfeed');
  const feed = expectObject(body.feed, 'Pref_Feeds/editfeed.feed');
  const intervals = expectObject(body.intervals ?? {}, 'Pref_Feeds/editfeed.intervals');
  const lang = expectObject(body.lang ?? {}, 'Pref_Feeds/editfeed.lang');

  return {
    id: asNumber(feed.id, feedId),
    title: asString(feed.title),
    feed_url: asString(feed.feed_url),
    site_url: asString(feed.site_url),
    cat_id: feed.cat_id === null || feed.cat_id === undefined ? null : asNumber(feed.cat_id),
    update_interval: asNumber(feed.update_interval),
    purge_interval: asNumber(feed.purge_interval),
    auth_login: asString(feed.auth_login),
    auth_pass: asString(feed.auth_pass),
    private: asBoolean(feed.private),
    include_in_digest: asBoolean(feed.include_in_digest),
    cache_images: asBoolean(feed.cache_images),
    hide_images: asBoolean(feed.hide_images),
    always_display_enclosures: asBoolean(feed.always_display_enclosures),
    mark_unread_on_update: asBoolean(feed.mark_unread_on_update),
    feed_language: asString(feed.feed_language),
    update_intervals: intervalMap(intervals.update),
    purge_intervals: intervalMap(intervals.purge),
    force_purge: asNumber(body.force_purge),
    default_search_language: asString(lang.default),
    search_languages: Array.isArray(lang.all) ? lang.all.map((item) => asString(item)) : [],
  };
}

export interface FeedUpdate {
  title: string;
  feed_url: string;
  site_url: string;
  cat_id: number | null;
  update_interval: number;
  purge_interval: number;
  auth_login: string;
  auth_pass: string;
  private: boolean;
  include_in_digest: boolean;
  cache_images: boolean;
  hide_images: boolean;
  always_display_enclosures: boolean;
  mark_unread_on_update: boolean;
  feed_language: string;
}

/**
 * `Pref_Feeds/editSave` reads checkboxes as the literal string `on` (see
 * `checkbox_to_sql_bool()`), so unchecked boxes send an empty value rather
 * than `false`/`0`.
 */
export async function saveFeedDetails(
  backend: LegacyBackend,
  feedId: number,
  update: FeedUpdate
): Promise<void> {
  await backend.call('Pref_Feeds', 'editSave', {
    id: feedId,
    title: update.title,
    feed_url: update.feed_url,
    site_url: update.site_url,
    cat_id: update.cat_id ?? 0,
    update_interval: update.update_interval,
    purge_interval: update.purge_interval,
    auth_login: update.auth_login,
    auth_pass: update.auth_pass,
    private: update.private ? 'on' : '',
    include_in_digest: update.include_in_digest ? 'on' : '',
    cache_images: update.cache_images ? 'on' : '',
    hide_images: update.hide_images ? 'on' : '',
    always_display_enclosures: update.always_display_enclosures ? 'on' : '',
    mark_unread_on_update: update.mark_unread_on_update ? 'on' : '',
    feed_language: update.feed_language,
  });
}

/** `Pref_Labels/colorset` with both colours stored in one request. */
export async function setLabelColors(
  backend: LegacyBackend,
  labelId: number,
  fg: string,
  bg: string
): Promise<void> {
  await backend.call('Pref_Labels', 'colorset', {
    kind: 'both',
    ids: labelId,
    fg,
    bg,
    color: '',
  });
}

export async function resetLabelColors(backend: LegacyBackend, labelId: number): Promise<void> {
  await backend.call('Pref_Labels', 'colorreset', { ids: labelId });
}

export interface PluginRecord {
  name: string;
  is_local: boolean;
  system_enabled: boolean;
  user_enabled: boolean;
  is_system: boolean;
  has_data: boolean;
  version: string;
  author: string;
  description: string;
  more_info: string;
}

/** `Pref_Prefs/getPluginsList` already answers JSON (`{plugins, is_admin}`). */
export async function getPlugins(
  backend: LegacyBackend
): Promise<{ plugins: PluginRecord[]; isAdmin: boolean }> {
  const response = await backend.call('Pref_Prefs', 'getPluginsList');
  const body = requireBody(response, 'Pref_Prefs/getPluginsList');
  const plugins = expectArray(body.plugins, 'Pref_Prefs/getPluginsList.plugins');

  return {
    isAdmin: body.is_admin === true,
    plugins: plugins.map((rawPlugin) => {
      const plugin = expectObject(rawPlugin, 'Pref_Prefs/getPluginsList.plugin');
      return {
        name: asString(plugin.name),
        is_local: plugin.is_local === true,
        system_enabled: plugin.system_enabled === true,
        user_enabled: plugin.user_enabled === true,
        is_system: plugin.is_system === true,
        has_data: plugin.has_data === true,
        version: asString(plugin.version),
        author: asString(plugin.author),
        description: asString(plugin.description),
        more_info: asString(plugin.more_info),
      };
    }),
  };
}

/** `Pref_Prefs/setplugins` expects the full list of user-enabled plugins. */
export async function setPlugins(backend: LegacyBackend, pluginNames: string[]): Promise<void> {
  await backend.call('Pref_Prefs', 'setplugins', { plugins: pluginNames });
}

/** Pref_Prefs/getProfiles returns a top-level JSON array. */
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
