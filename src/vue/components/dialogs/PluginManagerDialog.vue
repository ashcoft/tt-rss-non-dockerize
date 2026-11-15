<template>
  <div>
    <v-text-field
      v-model="search"
      label="Search"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      hide-details
      class="mb-3"
    />

    <div v-if="loading" class="text-center py-6">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <v-list v-else density="compact" class="plugin-list">
      <v-list-item v-for="plugin in filteredPlugins" :key="plugin.name">
        <template #prepend>
          <v-checkbox
            :model-value="enabled.has(plugin.name)"
            :disabled="plugin.is_system"
            hide-details
            density="compact"
            :title="plugin.is_system ? 'System plugins are enabled via global configuration.' : ''"
            @update:model-value="(checked: boolean) => toggle(plugin, checked)"
          />
        </template>
        <v-list-item-title>
          {{ plugin.name }}
          <span class="text-caption text-grey">v{{ plugin.version }}</span>
        </v-list-item-title>
        <v-list-item-subtitle>{{ plugin.description }}</v-list-item-subtitle>
        <template v-if="plugin.more_info" #append>
          <v-btn
            icon="mdi-help-circle-outline"
            size="small"
            variant="text"
            title="More info"
            :href="plugin.more_info"
            target="_blank"
            rel="noopener noreferrer"
          />
        </template>
      </v-list-item>
      <v-list-item v-if="filteredPlugins.length === 0">
        <v-list-item-title>No plugins match.</v-list-item-title>
      </v-list-item>
    </v-list>

    <div class="d-flex align-center mt-3">
      <v-btn color="primary" size="small" :loading="busy" @click="save">Enable selected</v-btn>
      <v-spacer />
      <v-alert
        v-if="message"
        :type="messageType"
        variant="tonal"
        density="compact"
        class="mb-0"
      >
        {{ message }}
      </v-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '../../api/client';
import type { PluginInfo } from '../../api/client';

const plugins = ref<PluginInfo[]>([]);
// The user-enabled set being edited; system plugins are excluded because
// setplugins only manages the per-user list.
const enabled = ref(new Set<string>());
const search = ref('');
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const filteredPlugins = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return plugins.value;
  return plugins.value.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query)
  );
});

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.getPluginsList();
    if (response.status === 0) {
      plugins.value = response.content.plugins;
      enabled.value = new Set(
        response.content.plugins.filter((p) => p.user_enabled).map((p) => p.name)
      );
    } else {
      message.value = response.error ?? 'Failed to load plugins';
      messageType.value = 'error';
    }
  } catch (err) {
    console.error('Failed to load plugins:', err);
    message.value = 'Failed to load plugins';
    messageType.value = 'error';
  } finally {
    loading.value = false;
  }
}

function toggle(plugin: PluginInfo, checked: boolean): void {
  if (plugin.is_system) return;
  const next = new Set(enabled.value);
  if (checked) {
    next.add(plugin.name);
  } else {
    next.delete(plugin.name);
  }
  enabled.value = next;
}

async function save(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.setEnabledPlugins([...enabled.value]);
    if (response.status === 0) {
      message.value = 'Plugins updated. Reload the page to apply.';
      messageType.value = 'success';
    } else {
      message.value = response.error ?? 'Failed to save plugins';
      messageType.value = 'error';
    }
  } catch (err) {
    console.error('Failed to save plugins:', err);
    message.value = 'Failed to save plugins';
    messageType.value = 'error';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.plugin-list {
  max-height: 45vh;
  overflow-y: auto;
}
</style>
