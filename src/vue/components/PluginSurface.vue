<template>
  <div v-if="sanitizedHtml" class="plugin-surface" @click="onClick" v-html="sanitizedHtml" />

  <v-dialog v-model="dialogOpen" max-width="560">
    <v-card>
      <v-card-title>{{ dialogTitle }}</v-card-title>
      <v-card-text>
        <div v-if="dialogIsHtml" class="plugin-dialog-body" v-html="dialogHtml" />
        <p v-else>{{ dialogText }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="dialogOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar v-model="snackbar" :timeout="4000">{{ snackbarText }}</v-snackbar>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import api from '../api/client';
import { preparePluginSurfaceHtml } from '../api/legacyEndpoints';

const props = defineProps<{
  /** Raw HTML supplied by the caller. */
  html?: string;
  /** Preferences section id to fetch through `HOOK_PREFS_TAB_SECTION`. */
  section?: string;
}>();

const rawHtml = ref(props.html ?? '');
const dialogOpen = ref(false);
const dialogTitle = ref('');
const dialogHtml = ref('');
const dialogText = ref('');
const dialogIsHtml = ref(false);
const snackbar = ref(false);
const snackbarText = ref('');

// Handlers are rewritten before sanitizing so the container can dispatch them
// without any inline script surviving in the fragment.
const preparedHtml = computed(() => preparePluginSurfaceHtml(rawHtml.value));
const sanitizedHtml = computed(() =>
  preparedHtml.value ? DOMPurify.sanitize(preparedHtml.value) : ''
);

watch(
  () => props.html,
  (value) => {
    rawHtml.value = value ?? '';
  }
);

watch(
  () => props.section,
  async (section) => {
    if (!section) return;

    const response = await api.getPluginPrefsSection(section);
    if (response.status === 0) {
      rawHtml.value = response.content;
    } else {
      snackbarText.value = response.error ?? 'Failed to load plugin settings';
      snackbar.value = true;
    }
  },
  { immediate: true }
);

/** Show a handler's answer in a dialog (HTML fragment or plain text). */
function showResult(title: string, content: string): void {
  dialogTitle.value = title;
  dialogIsHtml.value = /<\/?[a-z][\s\S]*>/i.test(content);
  dialogHtml.value = dialogIsHtml.value ? DOMPurify.sanitize(content) : '';
  dialogText.value = dialogIsHtml.value ? '' : content || 'Done';
  dialogOpen.value = true;
}

async function onClick(event: MouseEvent): Promise<void> {
  const target = (event.target as HTMLElement | null)?.closest('[data-plugin]');
  if (!target) return;

  event.preventDefault();

  const plugin = target.getAttribute('data-plugin');
  const method = target.getAttribute('data-method');
  if (!plugin || !method) return;

  const response = await api.invokePluginHandler(plugin, method);
  if (response.status === 0) {
    showResult(method, response.content);
  } else {
    showResult('Plugin action failed', response.error ?? 'Plugin action failed');
  }
}
</script>

<style scoped>
.plugin-surface {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.plugin-surface :deep(button) {
  cursor: pointer;
}

.plugin-dialog-body :deep(img) {
  max-width: 100%;
}
</style>
