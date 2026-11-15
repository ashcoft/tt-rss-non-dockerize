<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Keyboard shortcuts</v-card-title>
      <v-card-text>
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <!-- The backend prints an HTML fragment; it is sanitized before render. -->
        <div v-else class="hotkeys-help" v-html="sanitizedHelp" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="closeDialog">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import api from '../../api/client';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const help = ref('');
const loading = ref(false);
const error = ref('');

const sanitizedHelp = computed(() =>
  DOMPurify.sanitize(help.value, {
    ALLOWED_TAGS: ['ul', 'ol', 'li', 'div', 'span', 'code', 'h3', 'footer'],
    ALLOWED_ATTR: ['class'],
  })
);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    error.value = '';
    // Fetch once per open; the hotkey map only changes with the backend.
    void load();
  }
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.getHotkeyHelp();
    if (response.status === 0) {
      help.value = response.content;
    } else {
      error.value = response.error ?? 'Failed to load keyboard shortcuts';
    }
  } catch (err) {
    console.error('Failed to load keyboard shortcuts:', err);
    error.value = 'Failed to load keyboard shortcuts';
  } finally {
    loading.value = false;
  }
}

function closeDialog(): void {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.hotkeys-help :deep(ul) {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 60vh;
  overflow-y: auto;
}

.hotkeys-help :deep(li) {
  display: flex;
  gap: 1rem;
  padding: 0.15rem 0;
}

.hotkeys-help :deep(.hk) {
  min-width: 8rem;
}
</style>
