/**
 * Compatibility layer for plugin scripts.
 *
 * Plugins ship small scripts (`get_js`) that were written against the legacy
 * client: they register callbacks with `PluginHost`, call `App.getPhArgs` to
 * build a PluginHandler request, use `xhr` for transport and `Notify` for
 * messages, and open dialogs with `fox.SingleUseDialog`. Rewriting every plugin
 * would be a much larger change than the migration itself, so this module
 * installs the minimal versions of those globals and then runs the plugin
 * scripts.
 *
 * The scripts are stashed by the PHP shell in `window.__plugin_scripts` rather
 * than executed inline, so they run only after these globals exist. Each script
 * is still wrapped in try/catch so one broken plugin cannot take the app down.
 *
 * This layer deliberately implements only what the bundled plugins use. It is
 * not a general reimplementation of the legacy client.
 */

import { runDetached } from '../utils/runDetached';

/** A legacy `xhr.post`/`xhr.json` replacement over fetch. */
function postForm(url: string, params: Record<string, unknown>): Promise<string> {
  const body = new URLSearchParams();

  // The legacy helper injected the session token from the shell global; the
  // plugin handlers validate it, so it must be carried here too.
  const csrf = (window as unknown as Record<string, unknown>).__csrf_token;
  if (typeof csrf === 'string' && csrf !== '') {
    body.append('csrf_token', csrf);
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.append(key, String(value));
  }

  return fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).then((response) => response.text());
}

/** The subset of the legacy `Notify` helper the plugins call. */
function installNotify(): void {
  const host = () => document.getElementById('vue-notify') ?? createNotifyHost();

  const show = (text: string, kind: string) => {
    const node = host();
    node.className = `vue-notify vue-notify-${kind}`;
    node.textContent = text;
    node.style.display = '';
  };

  (window as unknown as Record<string, unknown>).Notify = {
    info: (text: string) => show(text, 'info'),
    error: (text: string) => show(text, 'error'),
    progress: (text: string) => show(text, 'info'),
    close: () => {
      const node = document.getElementById('vue-notify');
      if (node) node.style.display = 'none';
    },
  };
}

function createNotifyHost(): HTMLElement {
  const node = document.createElement('div');
  node.id = 'vue-notify';
  node.style.display = 'none';
  document.body.appendChild(node);
  return node;
}

/**
 * A stand-in for `fox.SingleUseDialog`. It renders the content into a simple
 * overlay and exposes the same `attr('content')`/`show()`/`hide()` surface the
 * plugin scripts use.
 */
class SimpleDialog {
  readonly domNode: HTMLElement;
  private overlay: HTMLElement;
  private contentNode: HTMLElement;
  private readonly onShowHandlers: Array<() => void> = [];
  private readonly onExecute?: () => void;

  constructor(options: { title?: string; content?: string; execute?: () => void } = {}) {
    this.onExecute = options.execute;
    this.overlay = document.createElement('div');
    this.overlay.className = 'vue-simple-dialog-overlay';

    this.domNode = document.createElement('div');
    this.domNode.className = 'vue-simple-dialog';

    const title = document.createElement('div');
    title.className = 'vue-simple-dialog-title';
    title.textContent = options.title ?? '';

    this.contentNode = document.createElement('div');
    this.contentNode.className = 'vue-simple-dialog-content';
    this.contentNode.innerHTML = options.content ?? '';

    // The legacy dialog ran its `execute` callback when a form inside was
    // submitted; the plugin scripts depend on that (e.g. note editing).
    this.contentNode.addEventListener('submit', (event) => {
      event.preventDefault();
      this.onExecute?.();
    });

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.className = 'vue-simple-dialog-close';
    close.onclick = () => this.hide();

    this.domNode.append(title, this.contentNode, close);
    this.overlay.appendChild(this.domNode);
  }

  attr(name: string, value?: string): unknown {
    if (name === 'content' && value !== undefined) {
      this.contentNode.innerHTML = value;
      return this;
    }
    if (name === 'value') {
      // The plugin dialogs read their form values through this call; collect
      // the named fields in the dialog body.
      const values: Record<string, string> = {};
      this.contentNode
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[name]')
        .forEach((field) => {
          values[field.name] = field.value;
        });
      return values;
    }
    return this;
  }

  show(): void {
    document.body.appendChild(this.overlay);
    this.onShowHandlers.forEach((handler) => handler());
  }

  hide(): void {
    this.overlay.remove();
  }

  connect(event: string, handler: () => void): void {
    if (event === 'onShow') this.onShowHandlers.push(handler);
  }

  validate(): boolean {
    return true;
  }
}

/** Install `PluginHost`, the hook registry the plugin scripts register into. */
function installPluginHost(): Record<number, Array<(arg: unknown) => unknown>> {
  const hooks: Record<number, Array<(arg: unknown) => unknown>> = {};

  (window as unknown as Record<string, unknown>).PluginHost = {
    HOOK_ARTICLE_RENDERED: 1,
    HOOK_ARTICLE_RENDERED_CDM: 2,
    HOOK_ARTICLE_SET_ACTIVE: 3,
    HOOK_FEED_SET_ACTIVE: 4,
    HOOK_FEED_LOADED: 5,
    HOOK_ARTICLE_EXPANDED: 6,
    HOOK_ARTICLE_COLLAPSED: 7,
    HOOK_PARAMS_LOADED: 8,
    HOOK_RUNTIME_INFO_LOADED: 9,
    HOOK_FLOATING_TITLE: 10,
    HOOK_INIT_COMPLETE: 11,
    HOOK_HEADLINE_RENDERED: 12,
    HOOK_COUNTERS_RECEIVED: 13,
    HOOK_COUNTERS_PROCESSED: 14,
    HOOK_HEADLINE_MUTATIONS: 15,
    HOOK_HEADLINE_MUTATIONS_SYNCED: 16,
    HOOK_HEADLINES_RENDERED: 17,
    HOOK_HEADLINES_SCROLL_HANDLER: 18,
    HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2: 19,
    hooks,
    register(name: number, callback: (arg: unknown) => unknown) {
      (hooks[name] ??= []).push(callback);
    },
    unregister(name: number, callback: (arg: unknown) => unknown) {
      const list = hooks[name];
      if (!list) return;
      const index = list.indexOf(callback);
      if (index !== -1) list.splice(index, 1);
    },
    run(name: number, args: unknown) {
      (hooks[name] ?? []).forEach((callback) => callback(args));
    },
  };

  return hooks;
}

/**
 * Run every registered callback for a hook. The Vue components call this at the
 * same points the legacy client did (article rendered, headlines rendered).
 */
export function runPluginHook(name: number, arg: unknown): void {
  // `window` is absent outside a browser (the Node test runner), where there
  // are no plugin scripts to run either.
  if (typeof window === 'undefined') return;

  const host = (window as unknown as Record<string, { run?: (n: number, a: unknown) => void }>)
    .PluginHost;
  host?.run?.(name, arg);
}

/** The numeric hook ids, mirrored from the PluginHost shim above. */
export const HOOKS = {
  HOOK_ARTICLE_RENDERED: 1,
  HOOK_ARTICLE_RENDERED_CDM: 2,
  HOOK_HEADLINES_RENDERED: 17,
} as const;

/**
 * Install the compatibility globals and execute the plugin scripts the shell
 * stashed. Safe to call once, before the app mounts.
 */
export function installPluginCompat(): void {
  const win = window as unknown as Record<string, unknown>;

  win.__pluginHooks = installPluginHost();
  installNotify();

  win.xhr = {
    post: (url: string, params: Record<string, unknown>, complete?: (reply: string) => void) => {
      const promise = postForm(url, params);
      if (complete) runDetached(promise.then(complete), 'plugin xhr.post');
      return promise;
    },
    json: (url: string, params: Record<string, unknown>, complete?: (reply: unknown) => void) => {
      const promise = postForm(url, params).then((text) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      });
      if (complete) runDetached(promise.then(complete), 'plugin xhr.json');
      return promise;
    },
  };

  win.fox = { SingleUseDialog: SimpleDialog };

  // The legacy App object the plugin scripts reach into. Only the pieces the
  // bundled plugins use are provided.
  win.App = {
    getPhArgs: (plugin: string, method: string, extra: Record<string, unknown> = {}) => ({
      op: 'PluginHandler',
      plugin,
      method,
      ...extra,
    }),
    FormFields: {
      icon: (name: string) => `<i class="material-icons">${name}</i>`,
    },
    escapeHtml: (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  };

  // `dojo.parser.parse` and `dojo.connect` are no-ops now: nothing needs the
  // parser, and dialogs expose their own onShow hooks.
  win.dojo = {
    parser: { parse: () => undefined },
    connect: (obj: SimpleDialog, event: string, _ctx: unknown, handler: () => void) => {
      obj.connect(event, handler);
      return handler;
    },
    disconnect: () => undefined,
  };

  // Minimal AMD `require` for the plugin scripts that wrap their body in one.
  win.require = (_deps: unknown, callback?: (...args: unknown[]) => void) => {
    if (typeof callback === 'function') callback({}, () => undefined);
  };

  const scripts = (win.__plugin_scripts as string[] | undefined) ?? [];
  for (const script of scripts) {
    try {
      // Executes the plugin's own script, shipped by this deployment.
      new Function(script)();
    } catch (error) {
      console.warn('failed to initialize plugin JS', error);
    }
  }
}
