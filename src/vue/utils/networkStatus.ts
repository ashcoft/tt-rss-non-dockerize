/** Global transport health, surfaced by the toolbar's network-alert icon. */
import { ref } from 'vue';

/** True after a backend request failed to reach the server. */
export const networkDown = ref(false);

export function markNetworkFailure(): void {
  networkDown.value = true;
}

export function markNetworkSuccess(): void {
  networkDown.value = false;
}
