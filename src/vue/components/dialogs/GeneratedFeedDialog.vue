<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
    @after-enter="load"
  >
    <v-card>
      <v-card-title>Show as feed</v-card-title>
      <v-card-text>
        <p v-if="title" class="mb-3">
          {{ title }} can be accessed via the following secret URL:
        </p>
        <div v-if="loading" class="text-center py-4">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <div v-else-if="link" class="generated-url">
          <a :href="link" target="_blank" rel="noopener noreferrer">{{ link }}</a>
        </div>
        <v-alert v-else-if="error" type="error" variant="tonal" density="compact">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn
          variant="text"
          href="https://tt-rss.org/docs/Generated-Feeds.html"
          target="_blank"
          rel="noopener noreferrer"
          prepend-icon="mdi-help-circle-outline"
        >
          More info...
        </v-btn>
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="regenerate">
          Generate new URL
        </v-btn>
        <v-btn variant="flat" color="primary" @click="emit('update:modelValue', false)">
          Close
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import api from '../../api/client';

const props = defineProps<{
  modelValue: boolean;
  feedId: number;
  isCat: boolean;
  /** Search query, so a search result can be syndicated as a feed. */
  search?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const title = ref('');
const link = ref('');
const error = ref('');
const loading = ref(false);

const load = async () => {
  loading.value = true;
  error.value = '';
  try {
    const response = await api.getSharedUrl(props.feedId, props.isCat, props.search ?? '');
    if (response.status === 0 && response.content) {
      title.value = response.content.title;
      link.value = response.content.link;
    } else {
      error.value = response.error ?? 'Could not build the feed URL.';
    }
  } finally {
    loading.value = false;
  }
};

const regenerate = async () => {
  loading.value = true;
  try {
    const response = await api.regenFeedKey(props.feedId, props.isCat);
    if (response.status === 0 && response.content) {
      // The backend returns the new key; splice it into the existing URL.
      link.value = link.value.replace(/&key=.*$/, `&key=${response.content}`);
    } else {
      error.value = response.error ?? 'Could not change feed URL.';
    }
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.generated-url {
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-on-background), 0.12);
  border-radius: 4px;
  overflow-wrap: anywhere;
  text-align: center;
}

.generated-url a {
  color: rgb(var(--v-theme-primary));
}
</style>
