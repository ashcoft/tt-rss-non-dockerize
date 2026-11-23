<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Share article by URL</v-card-title>
      <v-card-text>
        <p class="text-caption text-grey">
          Anyone with this unique URL can read the article without logging in.
        </p>
        <v-text-field
          :model-value="url"
          label="Share URL"
          readonly
          density="compact"
          append-inner-icon="mdi-content-copy"
          @click:append-inner="copyUrl"
        />
        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
          {{ message }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="tonal" :loading="busy" @click="regenerate">Generate new URL</v-btn>
        <v-btn color="error" variant="tonal" :loading="busy" @click="unshare">Unshare</v-btn>
        <v-spacer />
        <v-btn @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import api from '../../api/client';

const props = defineProps<{ modelValue: boolean; articleId: number }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const url = ref('');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadUrl();
  }
);

async function loadUrl(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.invokePluginHandler('share', 'shareDialog', {
      id: props.articleId,
    });
    if (response.status === 0) {
      const match = /href="([^"]+)"/i.exec(response.content);
      url.value = match ? match[1] : '';
      if (!url.value) {
        message.value = 'The share handler did not return a URL.';
        messageType.value = 'error';
      }
    } else {
      message.value = response.error ?? 'Failed to load the share URL';
      messageType.value = 'error';
    }
  } finally {
    busy.value = false;
  }
}

async function regenerate(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.invokePluginHandler('share', 'newkey', { id: props.articleId });
    if (response.status === 0) {
      message.value = 'A new share URL was generated.';
      messageType.value = 'success';
      await loadUrl();
    } else {
      message.value = response.error ?? 'Failed to generate a new URL';
      messageType.value = 'error';
    }
  } finally {
    busy.value = false;
  }
}

async function unshare(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.invokePluginHandler('share', 'unshare', { id: props.articleId });
    if (response.status === 0) {
      message.value = response.content || 'Article unshared';
      messageType.value = 'success';
      url.value = '';
    } else {
      message.value = response.error ?? 'Failed to unshare the article';
      messageType.value = 'error';
    }
  } finally {
    busy.value = false;
  }
}

async function copyUrl(): Promise<void> {
  if (!url.value) return;
  await navigator.clipboard.writeText(url.value);
  message.value = 'Copied to the clipboard.';
  messageType.value = 'success';
}

function close(): void {
  emit('update:modelValue', false);
}
</script>
