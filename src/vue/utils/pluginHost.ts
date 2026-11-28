/**
 * Bridge to the legacy `PluginHost` registry.
 *
 * Plugin JS is still emitted by the PHP shell and registers callbacks against
 * `window.PluginHost` (the shim lives in include/vue_shell.php). The Vue app
 * cannot run the Dojo widgets those callbacks build, but dispatching the same
 * hooks the Dojo client fired lets plugin logic (card views, favicon badges,
 * hotkey actions, Select-menu entries) run unchanged.
 */

interface LegacyPluginHost {
  run: (name: number | string, args?: unknown) => void;
  run_until: (name: number | string, check: unknown, ...args: unknown[]) => boolean;
}

/** Hook numbers from js/PluginHost.js; keep in step with the shell shim. */
export const HOOKS = {
  ARTICLE_RENDERED: 1,
  ARTICLE_RENDERED_CDM: 2,
  ARTICLE_SET_ACTIVE: 3,
  FEED_SET_ACTIVE: 4,
  FEED_LOADED: 5,
  ARTICLE_EXPANDED: 6,
  ARTICLE_COLLAPSED: 7,
  PARAMS_LOADED: 8,
  RUNTIME_INFO_LOADED: 9,
  FLOATING_TITLE: 10,
  INIT_COMPLETE: 11,
  HEADLINE_RENDERED: 12,
  COUNTERS_RECEIVED: 13,
  COUNTERS_PROCESSED: 14,
  HEADLINE_MUTATIONS: 15,
  HEADLINE_MUTATIONS_SYNCED: 16,
  HEADLINES_RENDERED: 17,
  HEADLINES_SCROLL_HANDLER: 18,
  HEADLINE_TOOLBAR_SELECT_MENU_ITEM2: 19,
} as const;

export const HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2 = HOOKS.HEADLINE_TOOLBAR_SELECT_MENU_ITEM2;
export const HOOK_RUNTIME_INFO_LOADED = HOOKS.RUNTIME_INFO_LOADED;

function pluginHost(): LegacyPluginHost | null {
  const host = (window as unknown as { PluginHost?: LegacyPluginHost }).PluginHost;
  return host && typeof host.run === 'function' ? host : null;
}

/**
 * Fire a hook. A plugin callback that throws must not take the app down, so
 * each dispatch is guarded (the Dojo client did not guard, but it also could
 * not be reached from a render pass).
 */
export function runPluginHook(hook: number, args?: unknown): void {
  const host = pluginHost();
  if (!host) return;

  try {
    host.run(hook, args);
  } catch (err) {
    console.warn(`plugin hook ${hook} failed`, err);
  }
}

/** Fire a hook until a callback returns `check`; true when one did. */
export function runPluginHookUntil(hook: number, check: unknown, ...args: unknown[]): boolean {
  const host = pluginHost();
  if (!host) return false;

  try {
    return host.run_until(hook, check, ...args);
  } catch (err) {
    console.warn(`plugin hook ${hook} failed`, err);
    return false;
  }
}

/** Dispatch a Select-menu value to plugin JS; true when a handler took it. */
export function runPluginSelectMenuAction(action: string): boolean {
  return runPluginHookUntil(HOOKS.HEADLINE_TOOLBAR_SELECT_MENU_ITEM2, true, action);
}

/** Forward runtime info to plugin JS (HOOK_RUNTIME_INFO_LOADED). */
export function runPluginRuntimeInfo(info: Record<string, unknown>): void {
  runPluginHook(HOOKS.RUNTIME_INFO_LOADED, info);
}
