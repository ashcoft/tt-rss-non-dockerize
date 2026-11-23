<template>
  <div>
    <v-expansion-panels variant="accordion">
      <v-expansion-panel title="Personal data">
        <v-expansion-panel-text>
          <v-text-field v-model="email" label="Email" type="email" density="compact" />
          <v-text-field v-model="fullName" label="Full name" density="compact" />
          <v-btn color="primary" :loading="busy" @click="savePersonalData">Save</v-btn>
          <v-alert v-if="personalMessage" type="success" variant="tonal" density="compact" class="mt-3">
            {{ personalMessage }}
          </v-alert>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Two-factor authentication">
        <v-expansion-panel-text>
          <p>
            Status:
            <strong>{{ otpEnabled ? 'Enabled' : 'Disabled' }}</strong>
          </p>

          <template v-if="otpEnabled">
            <v-text-field
              v-model="otpPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              density="compact"
            />
            <v-btn color="error" variant="tonal" :loading="busy" @click="disableOtp">
              Disable two-factor authentication
            </v-btn>
          </template>

          <template v-else>
            <p class="text-caption text-grey">
              Scan the QR code with an authenticator app, then enter the current code.
            </p>
            <v-img v-if="otpQrcode" :src="otpQrcode" max-width="220" class="my-3" alt="OTP QR code" />
            <v-text-field
              v-model="otpPassword"
              label="Current password"
              type="password"
              autocomplete="current-password"
              density="compact"
            />
            <v-text-field v-model="otpCode" label="Authenticator code" density="compact" />
            <v-btn color="primary" :loading="busy" @click="enableOtp">Enable</v-btn>
          </template>

          <v-alert v-if="otpMessage" :type="otpError ? 'error' : 'success'" variant="tonal" density="compact" class="mt-3">
            {{ otpMessage }}
          </v-alert>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="App passwords">
        <v-expansion-panel-text>
          <div class="d-flex align-center ga-2 mb-3">
            <v-text-field v-model="newAppPasswordTitle" label="Description" density="compact" hide-details />
            <v-btn color="primary" :loading="busy" :disabled="!newAppPasswordTitle" @click="createAppPassword">
              Generate
            </v-btn>
          </div>
          <v-alert v-if="generatedPassword" type="warning" variant="tonal" density="compact" class="mb-3">
            New password: <code>{{ generatedPassword }}</code> — copy it now, it is not shown again.
          </v-alert>
          <v-list density="compact" class="app-passwords">
            <v-list-item v-for="pass in appPasswords" :key="pass.id">
              <template #prepend>
                <v-checkbox
                  :model-value="selectedAppPasswords.includes(pass.id)"
                  hide-details
                  density="compact"
                  @update:model-value="(checked: boolean) => toggleAppPassword(pass.id, checked)"
                />
              </template>
              <v-list-item-title>{{ pass.title }}</v-list-item-title>
              <v-list-item-subtitle>created {{ pass.created }} · last used {{ pass.last_used }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <v-btn
            size="small"
            color="error"
            variant="tonal"
            :disabled="selectedAppPasswords.length === 0"
            @click="deleteAppPasswords"
          >
            Delete selected
          </v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Profiles">
        <v-expansion-panel-text>
          <v-list density="compact" class="profiles">
            <v-list-item v-for="profile in profiles" :key="profile.id">
              <v-list-item-title>
                {{ profile.title }}
                <span v-if="profile.active" class="text-caption text-grey">(active)</span>
              </v-list-item-title>
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="profile.active"
                  @click="activateProfile(profile.id)"
                >
                  Activate
                </v-btn>
                <v-btn
                  v-if="profile.id !== 0"
                  size="small"
                  variant="text"
                  @click="renameProfile(profile.id, profile.title)"
                >
                  Rename
                </v-btn>
                <v-btn
                  v-if="profile.id !== 0"
                  size="small"
                  variant="text"
                  color="error"
                  @click="removeProfile(profile.id)"
                >
                  Delete
                </v-btn>
              </template>
            </v-list-item>
          </v-list>

          <div class="d-flex align-center ga-2 mt-3">
            <v-text-field v-model="newProfileTitle" label="New profile" density="compact" hide-details />
            <v-btn size="small" color="primary" :disabled="!newProfileTitle" @click="addProfile">
              Add
            </v-btn>
          </div>
          <div class="d-flex align-center ga-2 mt-2">
            <v-text-field v-model="cloneProfileTitle" label="Clone as" density="compact" hide-details />
            <v-btn size="small" variant="tonal" :disabled="!cloneProfileTitle" @click="cloneProfile">
              Clone active profile
            </v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Custom stylesheet" @click="loadCustomCss">
        <v-expansion-panel-text>
          <v-textarea
            v-model="customCss"
            label="CSS"
            rows="8"
            density="compact"
            class="custom-css"
          />
          <v-btn color="primary" :loading="busy" @click="saveCustomCss">Save</v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Email digest preview">
        <v-expansion-panel-text>
          <v-btn size="small" variant="tonal" :loading="busy" @click="loadDigest">Load preview</v-btn>
          <div v-if="digestHtml" class="digest-preview mt-3" v-html="sanitizedDigest" />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Reset configuration">
        <v-expansion-panel-text>
          <p class="text-caption text-grey">Reset every preference in the active profile to its default.</p>
          <v-btn color="error" variant="tonal" @click="resetDialog = true">Reset to defaults</v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
      {{ message }}
    </v-alert>

    <v-dialog v-model="resetDialog" max-width="420">
      <v-card>
        <v-card-title>Reset configuration?</v-card-title>
        <v-card-text>This resets every preference in the active profile.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="resetDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="busy" @click="resetConfig">Reset</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import api from '../../api/client';
import type { AppPassword } from '../../api/legacyEndpoints';

const email = ref('');
const fullName = ref('');
const personalMessage = ref('');
const otpEnabled = ref(false);
const otpQrcode = ref<string | null>(null);
const otpPassword = ref('');
const otpCode = ref('');
const otpMessage = ref('');
const otpError = ref(false);
const appPasswords = ref<AppPassword[]>([]);
const selectedAppPasswords = ref<number[]>([]);
const newAppPasswordTitle = ref('');
const generatedPassword = ref('');
const profiles = ref<Array<{ id: number; title: string; active: boolean }>>([]);
const newProfileTitle = ref('');
const cloneProfileTitle = ref('');
const customCss = ref('');
const digestHtml = ref('');
const resetDialog = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const sanitizedDigest = computed(() => (digestHtml.value ? DOMPurify.sanitize(digestHtml.value) : ''));

onMounted(async () => {
  await Promise.all([loadPersonalData(), loadAppPasswords(), loadProfiles()]);
});

function showMessage(text: string, type: 'success' | 'error' = 'success'): void {
  message.value = text;
  messageType.value = type;
}

async function loadPersonalData(): Promise<void> {
  const response = await api.getPersonalData();
  if (response.status === 0 && response.content) {
    email.value = response.content.email;
    fullName.value = response.content.full_name;
    otpEnabled.value = response.content.otp_enabled;
    otpQrcode.value = response.content.otp_qrcode;
  }
}

async function savePersonalData(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.changePersonalData(email.value, fullName.value);
    personalMessage.value = response.content || response.error || '';
  } finally {
    busy.value = false;
  }
}

async function enableOtp(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.enableOtp(otpPassword.value, otpCode.value);
    otpError.value = response.content.startsWith('ERROR');
    otpMessage.value = response.content.replace(/^ERROR:?/, '').trim() || response.error || '';
    if (!otpError.value) await loadPersonalData();
  } finally {
    busy.value = false;
  }
}

async function disableOtp(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.disableOtp(otpPassword.value);
    otpError.value = response.content.startsWith('ERROR');
    otpMessage.value = response.content.replace(/^ERROR:?/, '').trim() || response.error || '';
    if (!otpError.value) await loadPersonalData();
  } finally {
    busy.value = false;
  }
}

async function loadAppPasswords(): Promise<void> {
  const response = await api.getAppPasswords();
  if (response.status === 0) appPasswords.value = response.content;
}

async function createAppPassword(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.createAppPassword(newAppPasswordTitle.value);
    if (response.status === 0 && !response.content.error) {
      generatedPassword.value = response.content.password;
      newAppPasswordTitle.value = '';
      await loadAppPasswords();
    } else {
      showMessage(response.content.error ?? response.error ?? 'Failed to create the app password', 'error');
    }
  } finally {
    busy.value = false;
  }
}

function toggleAppPassword(id: number, checked: boolean): void {
  const next = new Set(selectedAppPasswords.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedAppPasswords.value = [...next];
}

async function deleteAppPasswords(): Promise<void> {
  const response = await api.deleteAppPasswords(selectedAppPasswords.value);
  if (response.status === 0) {
    selectedAppPasswords.value = [];
    await loadAppPasswords();
  } else {
    showMessage(response.error ?? 'Failed to delete app passwords', 'error');
  }
}

async function loadProfiles(): Promise<void> {
  const response = await api.getProfiles();
  if (response.status === 0) profiles.value = response.content;
}

async function activateProfile(id: number): Promise<void> {
  const response = await api.activateProfile(id);
  if (response.status === 0) {
    await loadProfiles();
    showMessage('Profile activated');
  } else {
    showMessage(response.error ?? 'Failed to activate the profile', 'error');
  }
}

async function addProfile(): Promise<void> {
  const response = await api.addProfile(newProfileTitle.value);
  if (response.status === 0) {
    newProfileTitle.value = '';
    await loadProfiles();
  } else {
    showMessage(response.error ?? 'Failed to add the profile', 'error');
  }
}

async function cloneProfile(): Promise<void> {
  const active = profiles.value.find((profile) => profile.active)?.id ?? 0;
  const response = await api.cloneProfile(active, cloneProfileTitle.value);
  if (response.status === 0) {
    cloneProfileTitle.value = '';
    await loadProfiles();
  } else {
    showMessage(response.error ?? 'Failed to clone the profile', 'error');
  }
}

async function renameProfile(id: number, current: string): Promise<void> {
  const title = window.prompt('Profile name', current);
  if (!title) return;
  const response = await api.saveProfile(id, title);
  if (response.status === 0) await loadProfiles();
  else showMessage(response.error ?? 'Failed to rename the profile', 'error');
}

async function removeProfile(id: number): Promise<void> {
  const response = await api.removeProfiles([id]);
  if (response.status === 0) await loadProfiles();
  else showMessage(response.error ?? 'Failed to remove the profile', 'error');
}

async function loadCustomCss(): Promise<void> {
  if (customCss.value) return;
  const response = await api.customizeCss();
  if (response.status === 0) customCss.value = response.content;
}

async function saveCustomCss(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.setPref('USER_STYLESHEET', customCss.value);
    showMessage(response.status === 0 ? 'Stylesheet saved' : response.error ?? 'Failed to save the stylesheet', response.status === 0 ? 'success' : 'error');
  } finally {
    busy.value = false;
  }
}

async function loadDigest(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.previewDigest();
    if (response.status === 0) digestHtml.value = response.content;
    else showMessage(response.error ?? 'Failed to build the digest preview', 'error');
  } finally {
    busy.value = false;
  }
}

async function resetConfig(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.resetConfig();
    resetDialog.value = false;
    showMessage(response.status === 0 ? 'Configuration reset. Reload to apply.' : response.error ?? 'Failed to reset the configuration', response.status === 0 ? 'success' : 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.app-passwords,
.profiles,
.custom-css,
.digest-preview {
  max-height: 45vh;
  overflow-y: auto;
}

.digest-preview :deep(img) {
  max-width: 100%;
}
</style>
