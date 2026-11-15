/**
 * Shared notifier for the preferences tabs.
 *
 * The tabs are rendered by PrefsApp inside a v-window and do not share a
 * component tree deep enough to prop-drill a snackbar, so the app provides a
 * callback through `provide`/`inject` and each tab reports through it.
 */

import { inject, provide, type InjectionKey } from 'vue';

export type PrefsNotify = (text: string, color?: 'success' | 'error' | 'info') => void;

const PREFS_NOTIFY: InjectionKey<PrefsNotify> = Symbol('prefs-notify');

export function providePrefsNotifier(notify: PrefsNotify): void {
  provide(PREFS_NOTIFY, notify);
}

export function usePrefsNotifier(): PrefsNotify {
  return inject(PREFS_NOTIFY, (text: string) => {
    // Falls back to the console when no provider is mounted (e.g. in tests).
    console.warn('[prefs]', text);
  });
}
