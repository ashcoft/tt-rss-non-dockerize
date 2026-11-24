/**
 * Phone-list gestures: pull-to-refresh and swipe-to-read.
 *
 * Both mirror the legacy App.initPullToRefresh()/initSwipeToRead() behaviour
 * and only run on the narrow layout. The caller renders a badge for the pull
 * state and receives a callback when a swipe commits.
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue';

const PULL_THRESHOLD = 64;
const PULL_MAX = 96;
const SWIPE_LOCK = 10;
const SWIPE_THRESHOLD = 80;

export interface PullAndSwipeOptions {
  onRefresh: () => void;
  onSwipeRead: (articleId: number) => void;
}

export function usePullAndSwipe(
  container: Ref<HTMLElement | null>,
  options: PullAndSwipeOptions
) {
  const pullDistance = ref(0);
  const refreshing = ref(false);

  let startY = 0;
  let startX = 0;
  let pulling = false;
  let row: HTMLElement | null = null;
  let action: HTMLElement | null = null;
  let axis: '' | 'h' | 'v' = '';
  let dx = 0;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

  const damp = (distance: number) =>
    distance < PULL_THRESHOLD
      ? distance
      : Math.min(PULL_MAX, PULL_THRESHOLD + (distance - PULL_THRESHOLD) * 0.4);

  const stopRefreshing = () => {
    if (!refreshing.value) return;
    refreshing.value = false;
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = null;
    pullDistance.value = 0;
  };

  const cleanupSwipe = () => {
    if (row) {
      row.classList.remove('swiping');
      row.style.transform = '';
      row.style.background = '';
    }
    action?.remove();
    row = null;
    action = null;
    axis = '';
    dx = 0;
  };

  const dismissRow = () => {
    const target = row;
    const id = target ? Number(target.dataset.headlineId) : Number.NaN;
    if (!target || !Number.isFinite(id)) {
      cleanupSwipe();
      return;
    }

    const width = target.offsetWidth;
    const direction = dx > 0 ? 1 : -1;
    target.style.height = `${target.offsetHeight}px`;
    void target.offsetHeight;
    target.classList.add('swipe-anim');
    target.style.transform = `translateX(${direction * width}px)`;
    target.style.height = '0px';
    target.style.opacity = '0';
    target.style.margin = '0';
    target.style.padding = '0';
    target.style.borderWidth = '0px';
    action?.remove();
    action = null;
    row = null;
    axis = '';
    dx = 0;

    window.setTimeout(() => options.onSwipeRead(id), 220);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!isNarrow() || event.touches.length !== 1) return;
    const element = container.value;
    if (!element) return;

    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    pulling = element.scrollTop <= 0;
    axis = '';

    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-headline-id]');
    row =
      target &&
      !target.classList.contains('active') &&
      !target.classList.contains('swipe-anim')
        ? target
        : null;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!isNarrow() || event.touches.length !== 1) return;
    const element = container.value;
    if (!element) return;

    const deltaY = event.touches[0].clientY - startY;
    const deltaX = event.touches[0].clientX - startX;

    if (pulling) {
      if (deltaY <= 0 || element.scrollTop > 0 || Math.abs(deltaX) > deltaY) {
        pulling = false;
        pullDistance.value = 0;
      } else {
        event.preventDefault();
        pullDistance.value = damp(deltaY);
        return;
      }
    }

    if (!row || axis === 'v') return;
    dx = deltaX;

    if (axis === '') {
      if (Math.abs(dx) < SWIPE_LOCK && Math.abs(deltaY) < SWIPE_LOCK) return;
      if (Math.abs(dx) <= Math.abs(deltaY)) {
        row = null;
        axis = 'v';
        return;
      }
      axis = 'h';
      row.classList.add('swiping');
      row.style.background = 'transparent';
      action = document.createElement('div');
      action.className = 'hl-swipe-action';
      action.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;padding:0 24px;' +
        'background:rgb(var(--v-theme-primary));color:#fff;font-size:20px;';
      action.innerHTML = '<span class="mdi mdi-check-all"></span>';
      row.insertBefore(action, row.firstChild);
    }

    event.preventDefault();
    row.style.transform = `translateX(${dx}px)`;
  };

  const onTouchEnd = () => {
    if (pulling) {
      pulling = false;
      if (pullDistance.value >= PULL_THRESHOLD) {
        refreshing.value = true;
        pullDistance.value = PULL_THRESHOLD;
        safetyTimer = setTimeout(stopRefreshing, 15_000);
        options.onRefresh();
      } else {
        pullDistance.value = 0;
      }
    }

    if (!row || axis !== 'h') {
      if (axis !== 'h') cleanupSwipe();
      return;
    }

    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      dismissRow();
      return;
    }

    const target = row;
    const affordance = action;
    row = null;
    action = null;
    axis = '';
    dx = 0;
    target.classList.add('swipe-anim');
    target.style.transform = '';
    window.setTimeout(() => {
      target.classList.remove('swiping', 'swipe-anim');
      target.style.background = '';
      affordance?.remove();
    }, 220);
  };

  const onTouchCancel = () => {
    pulling = false;
    pullDistance.value = 0;
    cleanupSwipe();
  };

  onMounted(() => {
    const element = container.value;
    if (!element) return;
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchCancel, { passive: true });
  });

  onUnmounted(() => {
    const element = container.value;
    if (element) {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
    }
    if (safetyTimer) clearTimeout(safetyTimer);
    cleanupSwipe();
  });

  return { pullDistance, refreshing, stopRefreshing };
}
