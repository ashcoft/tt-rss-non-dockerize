<template>
  <div class="login-wrapper">
    <v-card class="login-card" elevation="8">
      <v-card-title class="login-title">
        <v-icon icon="mdi-rss" size="32" class="mr-2" />
        Tiny Tiny RSS
      </v-card-title>
      <v-card-subtitle>Sign in to continue</v-card-subtitle>

      <v-card-text>
        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="user"
            label="Username"
            prepend-inner-icon="mdi-account"
            autocomplete="username"
            :disabled="authStore.loggingIn"
            required
          />
          <v-text-field
            v-model="password"
            label="Password"
            prepend-inner-icon="mdi-lock"
            type="password"
            autocomplete="current-password"
            :disabled="authStore.loggingIn"
            required
          />
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
            Log in
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const emit = defineEmits<{ (e: 'loggedIn'): void }>();

const user = ref('');
const password = ref('');

const submit = async () => {
  if (!user.value || !password.value) return;
  const ok = await authStore.login(user.value, password.value);
  if (ok) {
    emit('loggedIn');
  }
};
</script>

<style scoped>
.login-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--v-theme-background, #f5f5f5);
}

.login-card {
  width: 360px;
}

.login-title {
  display: flex;
  align-items: center;
}
</style>
