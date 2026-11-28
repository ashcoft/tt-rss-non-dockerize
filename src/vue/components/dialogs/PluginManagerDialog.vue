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

    <v-expansion-panels v-if="isAdmin" variant="accordion" class="mt-4">
      <v-expansion-panel title="Install plugins" @click="loadAvailable">
        <v-expansion-panel-text>
          <v-alert v-if="!installerEnabled" type="info" variant="tonal" density="compact">
            The plugin installer is disabled in the server configuration.
          </v-alert>
          <template v-else>
            <v-list density="compact" class="available-plugins">
              <v-list-item v-for="plugin in availablePlugins" :key="plugin.name">
                <v-list-item-title>{{ plugin.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ plugin.description }}</v-list-item-subtitle>
                <template #append>
                  <v-btn size="small" variant="tonal" @click="install(plugin.name)">Install</v-btn>
                </template>
              </v-list-item>
              <v-list-item v-if="availablePlugins.length === 0">
                <v-list-item-title>No plugins available.</v-list-item-title>
              </v-list-item>
            </v-list>
          </template>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel title="Local plugin maintenance">
        <v-expansion-panel-text>
          <div class="d-flex flex-wrap ga-2 mb-3">
            <v-btn size="small" variant="tonal" :loading="busy" @click="checkUpdates">Check for updates</v-btn>
            <v-btn size="small" variant="tonal" :loading="busy" @click="updatePlugins">Update local plugins</v-btn>
          </div>
          <v-alert v-if="updateResult" type="info" variant="tonal" density="compact" class="mb-3">
            {{ updateResult }}
          </v-alert>
          <v-list density="compact">
            <v-list-item v-for="plugin in localPlugins" :key="plugin.name">
              <v-list-item-title>{{ plugin.name }}</v-list-item-title>
              <template #append>
                <v-btn size="small" variant="text" @click="clearData(plugin.name)">Clear data</v-btn>
                <v-btn size="small" variant="text" color="error" @click="uninstall(plugin.name)">Uninstall</v-btn>
              </template>
            </v-list-item>
          </v-list>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '../../api/client';
import type { PluginInfo } from '../../api/client';
import type { AvailablePlugin } from '../../api/legacyEndpoints';

const plugins = ref<PluginInfo[]>([]);
// The user-enabled set being edited; system plugins are excluded because
// setplugins only manages the per-user list.
const enabled = ref(new Set<string>());
const search = ref('');
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const isAdmin = ref(false);
const installerEnabled = ref(false);
const availablePlugins = ref<AvailablePlugin[]>([]);
const availableLoaded = ref(false);
const updateResult = ref('');

const localPlugins = computed(() => plugins.value.filter((plugin) => plugin.is_local));

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
      isAdmin.value = response.content.isAdmin;
      enabled.value = new Set(
        response.content.plugins.filter((p) => p.user_enabled).map((p) => p.name)
      );

      const params = await api.getInitParams();
      if (params.status === 0) {
        installerEnabled.value = Boolean(params.content.enable_plugin_installer);
      }
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

async function loadAvailable(): Promise<void> {
  if (availableLoaded.value || !installerEnabled.value) return;
  const response = await api.getAvailablePlugins();
  if (response.status === 0) {
    availablePlugins.value = response.content;
    availableLoaded.value = true;
  } else {
    message.value = response.error ?? 'Failed to load available plugins';
    messageType.value = 'error';
  }
}

async function install(name: string): Promise<void> {
  busy.value = true;
  try {
    const previous = new Set(plugins.value.map((plugin) => plugin.name));
    const response = await api.installPlugin(name);

    if (response.status !== 0) {
      message.value = response.error ?? `Failed to install ${name}`;
      messageType.value = 'error';
      return;
    }

    // Refresh the list first: the installer names the plugin after its PHP
    // class, which can differ from the marketplace name we passed in.
    await load();
    const installedName =
      plugins.value.find((plugin) => plugin.name === name)?.name ??
      plugins.value.find((plugin) => !previous.has(plugin.name))?.name ??
      name;

    // Newly installed plugins should be usable immediately: enable the plugin
    // for this user instead of leaving it unticked until the next save.
    const next = new Set(enabled.value);
    next.add(installedName);
    enabled.value = next;

    const enableResponse = await api.setEnabledPlugins([...next]);
    if (enableResponse.status === 0) {
      message.value = `Installed and enabled ${installedName}. Reload the page to apply.`;
      messageType.value = 'success';
      await load();
    } else {
      message.value =
        `Installed ${installedName}, but could not enable it: ` +
        (enableResponse.error ?? 'unknown error');
      messageType.value = 'error';
    }
  } catch (err) {
    console.error('Failed to install plugin:', err);
    message.value = `Failed to install ${name}`;
    messageType.value = 'error';
  } finally {
    busy.value = false;
  }
}

async function checkUpdates(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.checkForPluginUpdates();
    updateResult.value =
      response.status === 0
        ? `Checked ${response.content.length} plugin(s) for updates.`
        : response.error ?? 'Failed to check for updates';
  } finally {
    busy.value = false;
  }
}

async function updatePlugins(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.updateLocalPlugins([]);
    updateResult.value =
      response.status === 0
        ? `Updated ${response.content.length} plugin(s).`
        : response.error ?? 'Failed to update plugins';
    await load();
  } finally {
    busy.value = false;
  }
}

async function clearData(name: string): Promise<void> {
  const response = await api.clearPluginData(name);
  message.value = response.status === 0 ? `Cleared data for ${name}` : response.error ?? 'Failed to clear plugin data';
  messageType.value = response.status === 0 ? 'success' : 'error';
}

async function uninstall(name: string): Promise<void> {
  const response = await api.uninstallPlugin(name);
  message.value = response.status === 0 ? `Uninstalled ${name}` : response.error ?? `Failed to uninstall ${name}`;
  messageType.value = response.status === 0 ? 'success' : 'error';
  await load();
}
</script>

<style scoped>
.plugin-list {
  max-height: 45vh;
  overflow-y: auto;
}
</style>
