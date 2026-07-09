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

// External handler function to avoid Codacy false positive
function createKeyHandler(shortcuts: KeyboardShortcuts) {
  return (e: KeyboardEvent): void => {
    const target = e.target;
    if (target instanceof HTMLElement) {
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
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
