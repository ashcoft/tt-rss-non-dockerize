/**
 * Keyboard shortcuts, mirroring the legacy RPC/get_hotkeys_map() table.
 *
 * Prefixes (`a`, `c`, `f`, `g`) wait for the next key, so `g a` jumps to All
 * articles while `a W` toggles widescreen.
 */

import { onMounted, onUnmounted } from 'vue';

export interface KeyboardShortcuts {
  onAction: (action: string) => void;
}

const PREFIXES = new Set(['a', 'c', 'f', 'g']);

const HOTKEYS: Record<string, string> = {
  k: 'next_feed',
  K: 'next_unread_feed',
  j: 'prev_feed',
  J: 'prev_unread_feed',
  n: 'next_article_noscroll',
  p: 'prev_article_noscroll',
  N: 'article_page_down',
  P: 'article_page_up',
  ArrowUp: 'prev_article',
  ArrowDown: 'next_article',
  Enter: 'open_article',
  '/': 'search_dialog',
  '\\': 'cancel_search',
  s: 'toggle_mark',
  S: 'toggle_publ',
  u: 'toggle_unread',
  T: 'edit_tags',
  o: 'open_in_new_window',
  'c p': 'catchup_below',
  'c n': 'catchup_above',
  'a W': 'toggle_widescreen',
  'a e': 'toggle_full_text',
  e: 'email_article',
  'a q': 'close_article',
  'a s': 'article_span_grid',
  'a a': 'select_all',
  'a u': 'select_unread',
  'a U': 'select_marked',
  'a p': 'select_published',
  'a i': 'select_invert',
  'a n': 'select_none',
  'f r': 'feed_refresh',
  'f a': 'feed_unhide_read',
  'f s': 'feed_subscribe',
  'f e': 'feed_edit',
  'f q': 'feed_catchup',
  'f x': 'feed_reverse',
  'f g': 'feed_toggle_vgroup',
  'f G': 'feed_toggle_grid',
  'f C': 'toggle_combined_mode',
  'f c': 'toggle_cdm_expanded',
  Q: 'catchup_all',
  x: 'cat_toggle_collapse',
  'g a': 'goto_all',
  'g f': 'goto_fresh',
  'g s': 'goto_marked',
  'g p': 'goto_published',
  'g r': 'goto_read',
  'g P': 'goto_prefs',
  r: 'select_article_cursor',
  'c l': 'create_label',
  'c f': 'create_filter',
  'c s': 'collapse_sidebar',
  '?': 'help_dialog',
};

export function useKeyboard(shortcuts: KeyboardShortcuts) {
  let prefix: string | null = null;
  let prefixTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPrefix = () => {
    prefix = null;
    if (prefixTimer) {
      clearTimeout(prefixTimer);
      prefixTimer = null;
    }
  };

  const keyHandler = (event: KeyboardEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        target.closest('button, a, [role="button"]')
      ) {
        return;
      }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;

    if (prefix) {
      const combo = `${prefix} ${key}`;
      const action = HOTKEYS[combo];
      clearPrefix();
      if (action) {
        event.preventDefault();
        shortcuts.onAction(action);
      }
      return;
    }

    if (PREFIXES.has(key) && !event.shiftKey) {
      prefix = key;
      prefixTimer = setTimeout(clearPrefix, 1200);
      event.preventDefault();
      return;
    }

    const action = HOTKEYS[key];
    if (!action) return;

    event.preventDefault();
    shortcuts.onAction(action);
  };

  onMounted(() => {
    document.addEventListener('keydown', keyHandler);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', keyHandler);
    clearPrefix();
  });
}

export default useKeyboard;
