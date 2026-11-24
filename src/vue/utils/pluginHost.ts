/**
 * Bridge to the legacy `PluginHost` registry.
 *
 * Plugin JS is still emitted by the PHP shell and registers callbacks against
 * `window.PluginHost` (the shim lives in include/vue_shell.php). The Vue app
 * cannot run the Dojo widgets those callbacks build, but dispatching the
 * registry lets plugin-provided Select-menu actions and runtime hooks run
 * their own logic.
 */

interface LegacyPluginHost {
  run_until: (name: number | string, check: unknown, ...args: unknown[]) => boolean;
  run: (name: number | string, args?: unknown) => void;
}

/** Mirrors js/PluginHost.js. */
export const HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2 = 19;
export const HOOK_RUNTIME_INFO_LOADED = 9;

function pluginHost(): LegacyPluginHost | null {
  const host = (window as unknown as { PluginHost?: LegacyPluginHost }).PluginHost;
  return host && typeof host.run_until === 'function' ? host : null;
}

/** Dispatch a Select-menu value to plugin JS; true when a handler took it. */
export function runPluginSelectMenuAction(action: string): boolean {
  return pluginHost()?.run_until(HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2, true, action) ?? false;
}

/** Forward runtime info to plugin JS (HOOK_RUNTIME_INFO_LOADED). */
export function runPluginRuntimeInfo(info: Record<string, unknown>): void {
  pluginHost()?.run(HOOK_RUNTIME_INFO_LOADED, info);
}
