/**
 * Live implementations of the legacy plugin globals.
 *
 * Plugins written for the Dojo client call `App.escapeHtml()`, read
 * `Headlines.headlines[id]`, use `Notify`/`xhr.json`, and build `dijit`
 * dialogs. The shell defines inert placeholders before the plugin scripts run;
 * this module points them at the running app so those plugins work again.
 */
import legacyBackend from '../api/legacy';
import type { LegacyParams } from '../api/legacy';

/** The fields the legacy `Headlines.headlines[id]` rows exposed. */
export interface LegacyHeadlineRow {
  id: number;
  title: string;
  link: string;
  content_preview: string;
  image_preview: string;
}

interface Bridge {
  isCombined: () => boolean;
  selectArticle: (id: number) => void;
  notify: (text: string, type?: 'info' | 'error') => void;
}

type AnyRecord = Record<string, unknown>;

let bridge: Bridge | null = null;
let initParams: AnyRecord = {};
const unreadByFeed = new Map<number, number>();

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function legacyApp(): AnyRecord {
  const scope = window as unknown as { App?: AnyRecord };
  scope.App = scope.App ?? {};
  return scope.App;
}

function legacyNamespace(name: 'Headlines' | 'Feeds' | 'Article' | 'Notify' | 'xhr'): AnyRecord {
  const scope = window as unknown as Record<string, AnyRecord | undefined>;
  scope[name] = scope[name] ?? {};
  return scope[name] as AnyRecord;
}

/** Point the placeholders at the running app. Safe to call more than once. */
export function installLegacyPluginBridge(next: Bridge): void {
  bridge = next;

  const app = legacyApp();
  app.hotkey_actions = app.hotkey_actions ?? {};
  app.global_unread = app.global_unread ?? 0;
  app.global_fresh = app.global_fresh ?? 0;
  app.escapeHtml = (text: unknown) =>
    String(text ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
  app.isCombinedMode = () => bridge?.isCombined() ?? false;
  app.getInitParam = (name: string) => initParams[name];
  app.getPhArgs = (plugin: string, method: string, params: AnyRecord = {}) => ({
    op: 'PluginHandler',
    plugin,
    method,
    ...params,
  });
  app.updateTitle = () => {};

  const headlines = legacyNamespace('Headlines');
  headlines.headlines = headlines.headlines ?? {};
  headlines.click = (_event: Event, id: number) => {
    bridge?.selectArticle(Number(id));
    return false;
  };

  const feeds = legacyNamespace('Feeds');
  feeds.getUnread = (id: number) => unreadByFeed.get(Number(id)) ?? 0;

  const article = legacyNamespace('Article');
  article.cdmMoveToId = () => {};

  Object.assign(legacyNamespace('Notify'), {
    progress: (text: string) => bridge?.notify(text),
    close: () => {},
    error: (text: string) => bridge?.notify(text, 'error'),
    warning: (text: string) => bridge?.notify(text, 'error'),
    info: (text: string) => bridge?.notify(text),
  });

  Object.assign(legacyNamespace('xhr'), {
    json: (url: string, params: AnyRecord, callback: (data: unknown) => void) => {
      const op = typeof params.op === 'string' ? params.op : 'PluginHandler';
      const method = typeof params.method === 'string' ? params.method : 'index';
      const rest: AnyRecord = { ...params };
      delete rest.op;
      delete rest.method;

      void legacyBackend
        .call(op, method, rest as LegacyParams)
        .then((response) => callback(response.body ?? {}))
        .catch((err: unknown) => bridge?.notify(String(err), 'error'));
    },
  });
}

/** Keep `App.getInitParam()` in step with RPC/sanityCheck. */
export function syncLegacyInitParams(params: AnyRecord): void {
  initParams = params;
}

/** Keep `App.global_unread` and `Feeds.getUnread()` in step with the counters. */
export function syncLegacyCounters(unread: Record<number, number>, globalUnread: number): void {
  unreadByFeed.clear();
  for (const [id, value] of Object.entries(unread)) {
    unreadByFeed.set(Number(id), Number(value));
  }
  legacyApp().global_unread = globalUnread;
}

/** Keep `Headlines.headlines` in step with the loaded rows (card-view plugins). */
export function syncLegacyHeadlines(rows: LegacyHeadlineRow[]): void {
  const headlines = legacyNamespace('Headlines');
  const map: Record<string, unknown> = {};

  for (const row of rows) {
    map[String(row.id)] = {
      id: row.id,
      title: row.title,
      link: row.link,
      content_preview: row.content_preview,
      flavor: { image: row.image_preview },
    };
  }
  headlines.headlines = map;
}
