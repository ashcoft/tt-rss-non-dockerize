<template>
  <v-app>
    <v-app-bar density="compact" color="primary">
      <v-app-bar-title>Tiny Tiny RSS : Preferences</v-app-bar-title>
      <v-spacer />
      <v-btn href="index.php" variant="text" prepend-icon="mdi-exit-to-app">Exit preferences</v-btn>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <div v-if="!authStore.loggedIn" class="text-center py-8">
          <v-progress-circular indeterminate color="primary" />
          <p class="mt-3 text-grey">Loading preferences…</p>
        </div>

        <v-tabs v-else v-model="tab" color="primary" density="compact" show-arrows>
          <v-tab value="prefPrefs">Preferences</v-tab>
          <v-tab value="prefFeeds">Feeds</v-tab>
          <v-tab value="prefFilters">Filters</v-tab>
          <v-tab value="prefLabels">Labels</v-tab>
          <v-tab v-if="isAdmin" value="prefUsers">Users</v-tab>
          <v-tab v-if="isAdmin" value="prefSystem">System</v-tab>
        </v-tabs>

        <v-window v-if="authStore.loggedIn" v-model="tab" class="mt-3">
          <v-window-item value="prefPrefs">
            <PrefsGeneralTab />
          </v-window-item>
          <v-window-item value="prefFeeds">
            <PrefsFeedsTab />
          </v-window-item>
          <v-window-item value="prefFilters">
            <PrefsFiltersTab />
          </v-window-item>
          <v-window-item value="prefLabels">
            <PrefsLabelsTab />
          </v-window-item>
          <v-window-item v-if="isAdmin" value="prefUsers">
            <PrefsUsersTab />
          </v-window-item>
          <v-window-item v-if="isAdmin" value="prefSystem">
            <PrefsSystemTab />
          </v-window-item>
        </v-window>

        <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">
          {{ snackbarText }}
        </v-snackbar>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from './api/client';
import { useAuthStore } from './stores';
import PrefsGeneralTab from './components/prefs/PrefsGeneralTab.vue';
import PrefsFeedsTab from './components/prefs/PrefsFeedsTab.vue';
import PrefsFiltersTab from './components/prefs/PrefsFiltersTab.vue';
import PrefsLabelsTab from './components/prefs/PrefsLabelsTab.vue';
import PrefsUsersTab from './components/prefs/PrefsUsersTab.vue';
import PrefsSystemTab from './components/prefs/PrefsSystemTab.vue';
import { providePrefsNotifier } from './components/prefs/notify';

const authStore = useAuthStore();
const tab = ref('prefPrefs');
const isAdmin = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<'success' | 'error' | 'info'>('info');

providePrefsNotifier((text, color = 'info') => {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
});

onMounted(async () => {
  const authenticated = await api.checkSession();
  if (!authenticated) return;

  authStore.setLoggedIn(true);

  // The preferences shell is only served to an authenticated session; the
  // admin tabs depend on the access level, which init-params does not expose.
  const plugins = await api.getPluginsList();
  isAdmin.value = plugins.status === 0 && plugins.content.isAdmin;
});
</script>
