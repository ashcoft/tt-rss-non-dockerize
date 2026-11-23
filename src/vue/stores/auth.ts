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
  const otpRequired = ref(false);
  const pendingCredentials = ref<{
    user: string;
    password: string;
    options: { rememberMe?: boolean; safeMode?: boolean; bwLimit?: boolean; honeypot?: string; altcha?: string };
  } | null>(null);

  /**
   * Attempt to sign in. The legacy handler answers with a redirect and the
   * client then re-reads the session CSRF token, so `status !== 0` means the
   * credentials were rejected or the session could not be established.
   */
  async function login(
    user: string,
    password: string,
    options: { rememberMe?: boolean; safeMode?: boolean; bwLimit?: boolean; honeypot?: string; altcha?: string } = {}
  ): Promise<boolean> {
    loggingIn.value = true;
    error.value = null;
    otpRequired.value = false;
    try {
      const response = await api.login(user, password, options);
      if (response.otpRequired) {
        otpRequired.value = true;
        pendingCredentials.value = { user, password, options };
        return false;
      }
      if (response.status === 0) {
        username.value = user;
        pendingCredentials.value = null;
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

  /** Finish a login that stopped at the auth_internal OTP step. */
  async function loginWithOtp(otp: string): Promise<boolean> {
    const pending = pendingCredentials.value;
    if (!pending) {
      error.value = 'Login session expired; enter your password again.';
      otpRequired.value = false;
      return false;
    }

    loggingIn.value = true;
    error.value = null;
    try {
      const response = await api.login(pending.user, pending.password, {
        ...pending.options,
        otp,
      });
      if (response.status === 0) {
        username.value = pending.user;
        otpRequired.value = false;
        pendingCredentials.value = null;
        return true;
      }
      error.value = response.error ?? 'Invalid verification code';
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Login failed';
      return false;
    } finally {
      loggingIn.value = false;
    }
  }

  /** Leave the OTP step and return to the credential form. */
  function cancelOtp(): void {
    otpRequired.value = false;
    pendingCredentials.value = null;
    error.value = null;
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
    otpRequired.value = false;
    pendingCredentials.value = null;
  }

  return {
    loggedIn,
    username,
    loggingIn,
    error,
    otpRequired,
    login,
    loginWithOtp,
    cancelOtp,
    logout,
    setLoggedIn,
    reset,
  };
});
