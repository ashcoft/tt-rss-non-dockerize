/**
 * Keyboard shortcuts, driven by the backend's `RPC/get_hotkeys_map()` table.
 *
 * The backend map is plugin-merged (e.g. hotkeys_swap_jk), so the legacy
 * sequences are parsed here instead of being hardcoded. It also carries
 * keydown notation such as `*(33)` (Shift+PageUp) and mode-specific entries
 * like `{3}(38)` (three-panel Up).
 */

import { onMounted, onUnmounted } from 'vue';

export interface KeyboardShortcuts {
  onAction: (action: string) => void;
  /** Prefixes from the backend map; falls back to the legacy set. */
  prefixes?: string[];
  /** Backend hotkey map (sequences already stripped of `|mnemonic`). */
  map?: Record<string, string>;
  /** Combined mode selects `{C}` entries instead of `{3}` ones. */
  isCombined?: () => boolean;
}

/** Fallback used before the backend map arrives, and by tests. */
const DEFAULT_PREFIXES = ['a', 'c', 'f', 'g'];

const DEFAULT_HOTKEYS: Record<string, string> = {
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
  '(38)': 'prev_article',
  '(40)': 'next_article',
  '(13)': 'open_article',
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
  'f D': 'feed_debug_update',
  'f %': 'feed_debug_viewfeed',
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

/** Keydown-only keys, in the legacy `(keyCode)` notation. */
const KEY_CODES: Record<string, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PageUp: 33,
  PageDown: 34,
  Enter: 13,
  Escape: 27,
  Insert: 45,
  Delete: 46,
  Home: 36,
  End: 35,
};

/** Legacy map spellings for keys whose DOM names differ. */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowRight: 'Right',
  ArrowDown: 'Down',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** Modifier prefix used by the legacy keydown notation. */
function modifierPrefix(event: KeyboardEvent): string {
  let prefix = '';
  if (event.metaKey) prefix += '%';
  if (event.altKey) prefix += '+';
  if (event.ctrlKey) prefix += '^';
  if (event.shiftKey) prefix += '*';
  return prefix;
}

export function useKeyboard(shortcuts: KeyboardShortcuts) {
  let prefix: string | null = null;
  let prefixTimer: ReturnType<typeof setTimeout> | null = null;

  const map = (): Record<string, string> =>
    shortcuts.map && Object.keys(shortcuts.map).length > 0 ? shortcuts.map : DEFAULT_HOTKEYS;

  const prefixes = (): Set<string> =>
    new Set(shortcuts.prefixes && shortcuts.prefixes.length > 0 ? shortcuts.prefixes : DEFAULT_PREFIXES);

  const clearPrefix = () => {
    prefix = null;
    if (prefixTimer) {
      clearTimeout(prefixTimer);
      prefixTimer = null;
    }
  };

  /** Candidate legacy sequences for this key event, most specific first. */
  const sequencesFor = (event: KeyboardEvent): string[] => {
    const sequences: string[] = [];
    const modifiers = modifierPrefix(event);
    const keyCode = KEY_CODES[event.key];

    // Named navigation keys only exist in the numeric notation. Printable
    // characters are also matched by their literal key.
    if (keyCode !== undefined) {
      sequences.push(`${modifiers}(${keyCode})`);
    } else if (event.key.length === 1) {
      // Legacy handled both keydown and keypress; the keypress form carries
      // the character only, so a shifted letter still matches `a W`.
      if (modifiers) sequences.push(`${modifiers}${event.key}`);
      sequences.push(event.key);
    }

    // The legacy map also spells a few keys by name (Shift+PgUp); accept the
    // readable form when a plugin/backend uses it.
    if (keyCode !== undefined) {
      const name = KEY_NAMES[event.key] ?? event.key;
      sequences.push(`${event.shiftKey ? 'Shift+' : ''}${name}`);
    }

    return sequences;
  };

  const lookup = (sequence: string): string | undefined => {
    const table = map();
    const mode = shortcuts.isCombined?.() ? '{C}' : '{3}';

    return table[sequence] ?? table[`${mode}${sequence}`];
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

    if (event.key === 'Escape') {
      clearPrefix();
      return;
    }

    // Prefixes are single printable characters with no modifiers.
    if (!prefix && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      if (prefixes().has(event.key)) {
        prefix = event.key;
        if (prefixTimer) clearTimeout(prefixTimer);
        prefixTimer = setTimeout(clearPrefix, 3000);
        event.preventDefault();
        return;
      }
    }

    for (const sequence of sequencesFor(event)) {
      const full = prefix ? `${prefix} ${sequence}` : sequence;
      const action = lookup(full);
      if (action) {
        clearPrefix();
        event.preventDefault();
        shortcuts.onAction(action);
        return;
      }
    }

    // Any key after a prefix completes the attempt; never leave it dangling.
    if (prefix) clearPrefix();
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
