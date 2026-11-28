<template>
  <div class="updates-panel">
    <div class="d-flex align-center flex-wrap gap-2 mb-4">
      <div>
        <div>
          Current version:
          <strong>{{ info?.current_version || 'unknown' }}</strong>
        </div>
        <div v-if="info?.latest_release" class="text-caption text-medium-emphasis">
          Latest release:
          <a :href="info.latest_release.html_url" target="_blank" rel="noopener noreferrer">
            {{ info.latest_release.tag_name }}
          </a>
          <span v-if="publishedLabel"> · {{ publishedLabel }}</span>
        </div>
      </div>
      <v-spacer />
      <v-btn size="small" variant="tonal" :loading="checking" @click="check(true)">
        Check again
      </v-btn>
    </div>

    <v-alert v-if="checking" type="info" variant="tonal" density="compact">
      Checking for updates...
    </v-alert>

    <v-alert v-else-if="info?.changeset" type="info" variant="tonal" density="compact" class="mb-3">
      A newer release <strong>{{ info.changeset.id }}</strong> is available.
      <a :href="info.changeset.compare_url" target="_blank" rel="noopener noreferrer">
        View release
      </a>
    </v-alert>

    <v-alert
      v-else-if="checked && info?.latest_release"
      type="success"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      You are running the latest release.
    </v-alert>

    <v-alert
      v-else-if="checked && !info?.latest_release"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      Update checks are disabled, or the release feed is currently unavailable.
    </v-alert>

    <v-alert v-if="pluginNames.length > 0" type="warning" variant="tonal" density="compact" class="mb-3">
      <div class="font-weight-medium mb-1">Local plugin updates available</div>
      <ul class="plugin-list">
        <li v-for="name in pluginNames" :key="name">{{ name }}</li>
      </ul>
      <v-btn size="small" color="warning" variant="flat" :loading="updating" class="mt-2" @click="updatePlugins">
        Update local plugins
      </v-btn>
    </v-alert>

    <v-alert v-if="message" :type="messageType" variant="tonal" density="compact">
      {{ message }}
    </v-alert>

    <p class="text-caption text-medium-emphasis mt-4">
      Core releases are installed from the command line or your deployment
      pipeline. This panel reports availability and can update local plugins.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '../../api/client';
import type { UpdateInfo } from '../../api/legacyEndpoints';

const info = ref<UpdateInfo | null>(null);
const checking = ref(false);
const updating = ref(false);
const checked = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error' | 'info'>('success');

const pluginNames = computed(() => info.value?.plugins ?? []);

const publishedLabel = computed(() => {
  const raw = info.value?.latest_release?.published_at;
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
});

const check = async (force = false) => {
  checking.value = true;
  message.value = '';
  try {
    const response = await api.checkForUpdates(force);
    if (response.status === 0) {
      info.value = response.content;
    } else {
      message.value = response.error ?? 'Could not check for updates.';
      messageType.value = 'error';
    }
  } finally {
    checking.value = false;
    checked.value = true;
  }
};

const updatePlugins = async () => {
  updating.value = true;
  message.value = '';
  try {
    const response = await api.updateLocalPlugins([]);
    if (response.status === 0) {
      message.value = 'Local plugin updates applied.';
      messageType.value = 'success';
      await check(true);
    } else {
      message.value = response.error ?? 'Could not update local plugins.';
      messageType.value = 'error';
    }
  } finally {
    updating.value = false;
  }
};

onMounted(check);
</script>

<style scoped>
.plugin-list {
  margin: 0;
  padding-left: 18px;
}

.gap-2 {
  gap: 8px;
}
</style>
