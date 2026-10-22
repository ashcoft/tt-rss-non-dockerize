/**
 * Auth Store - Pinia store for session/authentication management
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../api/client';

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false);
  const username = ref('');
  const loggingIn = ref(false);
  const error = ref<string | null>(null);

  /**
   * Attempt to sign in. The legacy handler answers with a redirect and the
   * client then re-reads the session CSRF token, so `status !== 0` means the
   * credentials were rejected or the session could not be established.
   */
  async function login(user: string, password: string): Promise<boolean> {
    loggingIn.value = true;
    error.value = null;
    try {
      const response = await api.login(user, password);
      if (response.status === 0) {
        loggedIn.value = true;
        username.value = user;
        return true;
      }
      error.value = response.error ?? 'Invalid username or password';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Login failed';
      return false;
    } finally {
      loggingIn.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.logout();
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    loggedIn.value = false;
    username.value = '';
  }

  /**
   * Adopt an already-authenticated session. The legacy shell only renders the
   * application page to a logged-in session, so the presence of a CSRF token
   * is proof of authentication without a separate round trip.
   */
  function setLoggedIn(value: boolean, user = ''): void {
    loggedIn.value = value;
    if (user) username.value = user;
    if (value) error.value = null;
  }

  function reset(): void {
    loggedIn.value = false;
    username.value = '';
    error.value = null;
    loggingIn.value = false;
  }

  return { loggedIn, username, loggingIn, error, login, logout, setLoggedIn, reset };
});
