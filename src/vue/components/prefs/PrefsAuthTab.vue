<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-title class="text-subtitle-1">Personal data / Authentication</v-card-title>
    <v-card-text>
      <div v-if="loading" class="text-center py-6">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else-if="info">
        <!-- Personal data -->
        <h3 class="text-subtitle-2">Personal data</h3>
        <v-text-field v-model="fullName" label="Full name" density="compact" variant="outlined" />
        <v-text-field v-model="email" label="Email" density="compact" variant="outlined" />
        <v-btn color="primary" :loading="busy" prepend-icon="mdi-content-save" @click="savePersonal">Save</v-btn>

        <!-- Password -->
        <template v-if="info.can_change_password">
          <v-divider class="my-4" />
          <h3 class="text-subtitle-2">Change password</h3>
          <v-text-field v-model="oldPassword" label="Old password" type="password" density="compact" variant="outlined" />
          <v-text-field v-model="newPassword" label="New password" type="password" density="compact" variant="outlined" />
          <v-text-field v-model="confirmPassword" label="Confirm password" type="password" density="compact" variant="outlined" />
          <v-btn color="primary" :loading="busy" prepend-icon="mdi-security" @click="changePassword">Change password</v-btn>
        </template>
        <v-alert v-else type="info" variant="tonal" density="compact" class="mt-3">
          The authentication module in use does not provide password changes.
        </v-alert>

        <!-- App passwords -->
        <v-divider class="my-4" />
        <h3 class="text-subtitle-2">App passwords</h3>
        <p class="text-caption text-grey">Separate passwords used for API clients. Required if you enable OTP.</p>
        <div class="d-flex gap-2 align-center mb-3 flex-wrap">
          <v-text-field v-model="newAppPasswordTitle" label="Description" density="compact" variant="outlined" hide-details class="app-pw-input" />
          <v-btn color="primary" :disabled="!newAppPasswordTitle" @click="generateAppPassword">Generate password</v-btn>
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th />
              <th>Description</th>
              <th>Created</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="pass in info.app_passwords" :key="pass.id">
              <td>
                <v-checkbox
                  :model-value="selectedAppPasswords.includes(pass.id)"
                  hide-details
                  density="compact"
                  @update:model-value="(checked: boolean) => toggleAppPassword(pass.id, checked)"
                />
              </td>
              <td>{{ pass.title }}</td>
              <td class="text-grey">{{ pass.created }}</td>
              <td class="text-grey">{{ pass.last_used }}</td>
            </tr>
            <tr v-if="info.app_passwords.length === 0">
              <td colspan="4" class="text-grey text-center">No app passwords.</td>
            </tr>
          </tbody>
        </v-table>
        <v-btn class="mt-2" color="error" variant="tonal" :disabled="selectedAppPasswords.length === 0" @click="deleteSelectedAppPasswords">
          Remove selected
        </v-btn>

        <!-- OTP -->
        <template v-if="info.otp_available">
          <v-divider class="my-4" />
          <h3 class="text-subtitle-2">Two-factor authentication (OTP)</h3>

          <template v-if="info.otp_enabled">
            <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
              One time passwords are currently enabled. Enter your current password to disable.
            </v-alert>
            <v-text-field v-model="otpPassword" label="Your password" type="password" density="compact" variant="outlined" />
            <v-btn color="error" variant="tonal" :loading="busy" @click="disableOtp">Disable OTP</v-btn>
          </template>

          <template v-else>
            <div class="d-flex align-center gap-3 flex-wrap">
              <img v-if="info.otp_qrcode" :src="info.otp_qrcode" alt="OTP QR code" class="otp-qrcode" />
              <div>
                <p class="text-caption text-grey">Scan the code or enter the secret in your authenticator app.</p>
                <code>{{ info.otp_secret }}</code>
              </div>
            </div>
            <v-text-field v-model="otpPassword" label="Your password" type="password" density="compact" variant="outlined" class="mt-3" />
            <v-text-field v-model="otpCode" label="Verification code" density="compact" variant="outlined" autocomplete="off" />
            <v-btn color="primary" :loading="busy" @click="enableOtp">Enable OTP</v-btn>
          </template>
        </template>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
          {{ message }}
        </v-alert>
      </template>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import type { AuthInfo } from '../../api/legacyEndpoints';
import { usePrefsNotifier } from './notify';

const notify = usePrefsNotifier();
const loading = ref(true);
const busy = ref(false);
const info = ref<AuthInfo | null>(null);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('info');

const fullName = ref('');
const email = ref('');
const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');

const newAppPasswordTitle = ref('');
const selectedAppPasswords = ref<number[]>([]);

const otpPassword = ref('');
const otpCode = ref('');

async function load() {
  loading.value = true;
  const response = await api.getAuthInfo();
  loading.value = false;
  if (response.status !== 0) {
    notify(response.error ?? 'Failed to load authentication settings', 'error');
    return;
  }
  info.value = response.content;
  fullName.value = response.content.full_name;
  email.value = response.content.email;
}

function report(text: string, ok: boolean) {
  // The password/OTP handlers answer "OK" or an "ERROR:..." string.
  const isError = !ok || text.startsWith('ERROR');
  message.value = text.replace(/^ERROR:\s*/, '');
  messageType.value = isError ? 'error' : 'success';
}

async function savePersonal() {
  busy.value = true;
  const response = await api.changePersonalData(fullName.value, email.value);
  busy.value = false;
  if (response.status === 0) report(response.content, true);
  else report(response.error ?? 'Failed to save', false);
}

async function changePassword() {
  busy.value = true;
  const response = await api.changePassword(oldPassword.value, newPassword.value, confirmPassword.value);
  busy.value = false;
  if (response.status === 0) {
    report(response.content, true);
    oldPassword.value = newPassword.value = confirmPassword.value = '';
  } else {
    report(response.error ?? 'Failed to change password', false);
  }
}

function toggleAppPassword(id: number, checked: boolean) {
  selectedAppPasswords.value = checked
    ? [...selectedAppPasswords.value, id]
    : selectedAppPasswords.value.filter(entry => entry !== id);
}

async function generateAppPassword() {
  busy.value = true;
  const response = await api.generateAppPassword(newAppPasswordTitle.value);
  busy.value = false;
  if (response.status === 0) {
    notify(response.content, 'success');
    newAppPasswordTitle.value = '';
    await load();
  } else {
    notify(response.error ?? 'Failed to generate password', 'error');
  }
}

async function deleteSelectedAppPasswords() {
  const response = await api.deleteAppPasswords(selectedAppPasswords.value);
  if (response.status === 0) {
    selectedAppPasswords.value = [];
    await load();
  } else {
    notify(response.error ?? 'Failed to remove passwords', 'error');
  }
}

async function enableOtp() {
  busy.value = true;
  const response = await api.setOtp(true, { password: otpPassword.value, otp: otpCode.value });
  busy.value = false;
  if (response.status !== 0) {
    report(response.error ?? 'Failed to enable OTP', false);
    return;
  }
  if (response.content === 'OK') window.location.reload();
  else report(response.content, false);
}

async function disableOtp() {
  busy.value = true;
  const response = await api.setOtp(false, { password: otpPassword.value });
  busy.value = false;
  if (response.status !== 0) {
    report(response.error ?? 'Failed to disable OTP', false);
    return;
  }
  if (response.content === 'OK') window.location.reload();
  else report(response.content, false);
}

onMounted(load);
</script>

<style scoped>
.app-pw-input {
  max-width: 320px;
}

.otp-qrcode {
  width: 25%;
  max-width: 200px;
}
</style>
