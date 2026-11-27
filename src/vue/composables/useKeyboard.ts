/**
 * Keyboard Shortcuts Composable
 * Handles keyboard navigation and shortcuts for TT-RSS
 */

import { onMounted, onUnmounted } from 'vue';

export interface KeyboardShortcuts {
  onNext?: () => void;
  onPrevious?: () => void;
  onSelect?: () => void;
  onOpenArticle?: () => void;
  onToggleRead?: () => void;
  onToggleStar?: () => void;
  onTogglePublish?: () => void;
  onRefresh?: () => void;
  onSearch?: () => void;
  onCatchup?: () => void;
  onHelp?: () => void;
}

/**
 * Controls that activate themselves. Enter and Space must reach them, or a
 * focused button (the mobile drawer's backdrop, a header action) would be
 * cancelled and turned into "open the cursor headline" instead of clicking.
 */
const INTERACTIVE_SELECTOR =
  'button, a[href], select, summary, [role="button"], [role="link"], [contenteditable="true"]';

/** Keys a focused control owns; every other key still runs the shortcuts. */
const NATIVE_ACTIVATION_KEYS = new Set(['Enter', ' ']);

/**
 * External handler function to avoid Codacy false positive.
 * Exported for the regression test in `tests/vue/keyboard-shortcuts.test.mjs`.
 */
export function createKeyHandler(shortcuts: KeyboardShortcuts) {
  return (e: KeyboardEvent): void => {
    if (e.defaultPrevented) {
      return;
    }

    const target = e.target as HTMLElement | null;

    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
      return;
    }

    // Only the keys the control activates are skipped: clicking a toolbar or
    // headline button leaves focus on it, and the reading shortcuts must keep
    // working. A select also owns the arrow keys that move its selection.
    const control = typeof target?.closest === 'function' ? target.closest(INTERACTIVE_SELECTOR) : null;

    if (control && (control.tagName === 'SELECT' || NATIVE_ACTIVATION_KEYS.has(e.key))) {
      return;
    }

    // Return early when modifier keys are pressed to avoid overriding browser shortcuts
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    switch (e.key.toLowerCase()) {
      // Navigation
      case 'j':
      case 'arrowdown':
        e.preventDefault();
        shortcuts.onNext?.();
        break;
      case 'k':
      case 'arrowup':
        e.preventDefault();
        shortcuts.onPrevious?.();
        break;
      case 'enter':
        e.preventDefault();
        shortcuts.onSelect?.();
        break;
      
      // Article actions
      case 'o':
      case 'l':
        e.preventDefault();
        shortcuts.onOpenArticle?.();
        break;
      case 'r':
        e.preventDefault();
        shortcuts.onToggleRead?.();
        break;
      case 's':
        e.preventDefault();
        shortcuts.onToggleStar?.();
        break;
      case 'f':
        e.preventDefault();
        shortcuts.onTogglePublish?.();
        break;
      
      // Other actions (Shift is allowed, but Ctrl/Meta/Alt are already filtered)
      case 'g':
        if (e.shiftKey) {
          e.preventDefault();
          shortcuts.onCatchup?.();
        }
        break;
      case '/':
        e.preventDefault();
        shortcuts.onSearch?.();
        break;
      case '?':
        e.preventDefault();
        shortcuts.onHelp?.();
        break;
      case 'u':
        e.preventDefault();
        shortcuts.onRefresh?.();
        break;
    }
  };
}

export function useKeyboard(shortcuts: KeyboardShortcuts) {
  const keyHandler = createKeyHandler(shortcuts);

  onMounted(() => {
    document.addEventListener('keydown', keyHandler);
  });

  onUnmounted(() => {
    document.removeEventListener('keydown', keyHandler);
  });
}

export default useKeyboard;
