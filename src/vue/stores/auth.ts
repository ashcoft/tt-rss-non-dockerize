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
   * Attempt to sign in. TT-RSS reports status != 0 for bad credentials.
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
      error.value = 'Invalid username or password';
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

  function reset(): void {
    loggedIn.value = false;
    username.value = '';
    error.value = null;
    loggingIn.value = false;
  }

  return { loggedIn, username, loggingIn, error, login, logout, reset };
});
