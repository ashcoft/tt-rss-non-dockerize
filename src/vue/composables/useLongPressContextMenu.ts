/**
 * Long-press → contextmenu for the phone layout.
 *
 * iOS Safari does not fire `contextmenu` on a long press, and the Vue rows
 * only listen for that event. Timing the press here and dispatching a
 * synthetic event keeps the existing row menus reachable on touch devices.
 */

import { onMounted, onUnmounted, type Ref } from 'vue';

const LONG_PRESS_MS = 600;
const MOVE_SLOP_PX = 10;

export function useLongPressContextMenu(container: Ref<HTMLElement | null>): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { id: number; x: number; y: number; target: HTMLElement } | null = null;
  let swallowUntil = 0;

  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isNarrow() || event.pointerType !== 'touch' || !event.isPrimary) return;
    cancel();
    pending = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.target as HTMLElement,
    };
    timer = setTimeout(() => {
      const press = pending;
      cancel();
      if (!press) return;
      // Swallow the compatibility click that follows the finger lift.
      swallowUntil = Date.now() + 700;
      press.target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: press.x,
          clientY: press.y,
          view: window,
        })
      );
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pending || event.pointerId !== pending.id) return;
    if (
      Math.abs(event.clientX - pending.x) > MOVE_SLOP_PX ||
      Math.abs(event.clientY - pending.y) > MOVE_SLOP_PX
    ) {
      cancel();
    }
  };

  const onClickCapture = (event: MouseEvent) => {
    if (Date.now() >= swallowUntil) return;
    swallowUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  onMounted(() => {
    const element = container.value;
    if (!element) return;
    element.addEventListener('pointerdown', onPointerDown, { passive: true });
    element.addEventListener('pointermove', onPointerMove, { passive: true });
    element.addEventListener('pointerup', cancel, { passive: true });
    element.addEventListener('pointercancel', cancel, { passive: true });
    document.addEventListener('click', onClickCapture, true);
  });

  onUnmounted(() => {
    const element = container.value;
    if (element) {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', cancel);
      element.removeEventListener('pointercancel', cancel);
    }
    document.removeEventListener('click', onClickCapture, true);
    cancel();
  });
}
