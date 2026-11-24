<template>
  <div class="login-wrapper">
    <v-card class="login-card" elevation="8">
      <v-card-title class="login-title">
        <v-icon icon="mdi-rss" size="32" class="mr-2" />
        Tiny Tiny RSS
      </v-card-title>
      <v-card-subtitle>Sign in to continue</v-card-subtitle>

      <v-card-text>
        <v-form @submit.prevent="authStore.otpRequired ? submitOtp() : submit()">
          <!-- Honeypot: hidden from humans, attractive to bots. -->
          <input
            v-model="website"
            class="login-honeypot"
            type="text"
            name="website"
            tabindex="-1"
            autocomplete="off"
            aria-hidden="true"
          />
          <altcha-widget
            v-if="!authStore.otpRequired && !altchaFailed"
            class="altcha-widget"
            challenge="/public.php?op=loginchallenge"
            name="altcha"
            auto="onload"
            @statechange="onAltchaStateChange"
          />
          <v-alert
            v-else-if="!authStore.otpRequired && altchaFailed"
            type="info"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            The Altcha widget could not start here (usually a Content-Security-Policy
            restriction). The built-in proof-of-work check will be used instead.
          </v-alert>
          <v-text-field
            v-if="!authStore.otpRequired"
            v-model="user"
            label="Username"
            prepend-inner-icon="mdi-account"
            autocomplete="username"
            :disabled="authStore.loggingIn"
            required
          />
          <v-text-field
            v-if="!authStore.otpRequired"
            v-model="password"
            label="Password"
            prepend-inner-icon="mdi-lock"
            type="password"
            autocomplete="current-password"
            :disabled="authStore.loggingIn"
            required
          />
          <v-text-field
            v-if="authStore.otpRequired"
            v-model="otp"
            label="Verification code (OTP)"
            prepend-inner-icon="mdi-shield-key"
            autocomplete="one-time-code"
            :disabled="authStore.loggingIn"
            required
          />
          <div v-if="!authStore.otpRequired" class="login-options">
            <v-checkbox v-model="rememberMe" label="Remember me" density="compact" hide-details />
            <v-checkbox v-model="safeMode" label="Safe mode" density="compact" hide-details />
            <v-checkbox v-model="bwLimit" label="Use less traffic" density="compact" hide-details />
          </div>
          <a
            v-if="!authStore.otpRequired"
            class="forgot-link"
            href="public.php?op=forgotpass"
          >I forgot my password</a>
          <v-alert
            v-if="authStore.error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ authStore.error }}
          </v-alert>
          <v-btn
            type="submit"
            color="primary"
            block
            :loading="authStore.loggingIn"
          >
            {{ authStore.otpRequired ? 'Continue' : 'Log in' }}
          </v-btn>
          <v-btn
            v-if="authStore.otpRequired"
            variant="text"
            block
            class="mt-1"
            @click="authStore.cancelOtp()"
          >
            Back
          </v-btn>
          <!-- HOOK_LOGINFORM_ADDITIONAL_BUTTONS (SSO providers and similar).
               Native forms/links keep working; the fragment is sanitized. -->
          <div v-if="pluginButtonsHtml" class="login-plugin-buttons" v-html="pluginButtonsHtml" />
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import 'altcha';
import DOMPurify from 'dompurify';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const emit = defineEmits<{ (e: 'logged-in'): void }>();

const user = ref('');
const password = ref('');
const rememberMe = ref(false);
const safeMode = ref(false);
const bwLimit = ref(false);
const otp = ref('');
const website = ref('');
const altchaPayload = ref('');
const altchaFailed = ref(false);
const pluginButtonsHtml = ref('');

onMounted(async () => {
  try {
    const response = await api.getLoginFormButtons();
    if (response.status === 0 && response.content.trim() !== '') {
      pluginButtonsHtml.value = DOMPurify.sanitize(response.content);
    }
  } catch (err) {
    console.warn('Could not load plugin login buttons:', err);
  }
});

const onAltchaStateChange = (event: CustomEvent<{ state?: string; payload?: string }>) => {
  const state = event.detail?.state;
  if (state === 'verified' && event.detail.payload) {
    altchaPayload.value = event.detail.payload;
    altchaFailed.value = false;
  } else if (state === 'error') {
    // The widget relies on a blob worker; strict CSPs (e.g. an embedded
    // deployment) block it. api.login() then falls back to the built-in
    // proof-of-work challenge, so hide the broken widget.
    altchaFailed.value = true;
    altchaPayload.value = '';
  } else {
    altchaPayload.value = '';
  }
};

const submit = async () => {
  if (!user.value || !password.value) return;
  const ok = await authStore.login(user.value, password.value, {
    rememberMe: rememberMe.value,
    safeMode: safeMode.value,
    bwLimit: bwLimit.value,
    honeypot: website.value,
    altcha: altchaPayload.value || undefined,
  });
  if (ok) {
    emit('logged-in');
    authStore.setLoggedIn(true);
  }
};

const submitOtp = async () => {
  if (!otp.value) return;
  const ok = await authStore.loginWithOtp(otp.value);
  if (ok) {
    emit('logged-in');
    authStore.setLoggedIn(true);
  }
};
</script>

<style scoped>
.login-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background:
    radial-gradient(circle at 18% 18%, rgba(51, 153, 204, 0.1), transparent 38%),
    radial-gradient(circle at 82% 82%, rgba(102, 187, 85, 0.1), transparent 38%),
    #f4f4f4;
}

.login-card {
  width: 380px;
  border-top: 3px solid #3399cc;
  border-radius: 8px;
  background: #fff;
}

.login-title {
  display: flex;
  align-items: center;
  color: #257aa7;
  font-weight: 600;
}

.login-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
  margin-bottom: 4px;
}

.forgot-link {
  display: inline-block;
  margin-bottom: 12px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.8125rem;
  text-decoration: none;
}

.forgot-link:hover {
  text-decoration: underline;
}

.altcha-widget {
  display: block;
  margin-bottom: 12px;
}

.login-honeypot {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.login-plugin-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.login-plugin-buttons :deep(button),
.login-plugin-buttons :deep(input[type='submit']) {
  cursor: pointer;
}
</style>
