<template>
  <div v-if="html">
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">
        <v-icon start>mdi-puzzle</v-icon> Plugin settings
      </v-card-title>
      <v-card-text>
        <!-- Plugin-provided preferences. The markup is emitted by the plugin's
             HOOK_PREFS_TAB handler and posted to PluginHandler itself, so it is
             rendered as-is rather than reimplemented. -->
        <div class="plugin-prefs" v-html="html" />
      </v-card-text>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';

const props = defineProps<{ tabId: string }>();

const html = ref('');

onMounted(async () => {
  const response = await api.getPluginPrefsTabs();
  if (response.status === 0) {
    html.value = response.content[props.tabId] ?? '';
  }
});
</script>

<style scoped>
.plugin-prefs :deep(fieldset) {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
}

.plugin-prefs :deep(header) {
  font-weight: 600;
  margin: 0.5rem 0;
}
</style>
