<template>
  <div>
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">Labels</v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 mb-3 align-center flex-wrap">
          <v-text-field
            v-model="newCaption"
            label="New label caption"
            density="compact"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-label"
            class="new-label-input"
          />
          <v-btn color="primary" :disabled="!newCaption" @click="createLabel">Create label</v-btn>
        </div>

        <v-list density="compact">
          <v-list-item v-for="label in labelsStore.labels" :key="label.id">
            <template #prepend>
              <v-chip
                size="small"
                :style="{ backgroundColor: label.bg_color || undefined, color: label.fg_color || undefined }"
              >
                {{ label.caption }}
              </v-chip>
            </template>

            <div class="d-flex gap-2 align-center">
              <input
                type="color"
                :value="normalizeColor(label.fg_color)"
                title="Foreground colour"
                @change="setColor(label.id, 'fg', ($event.target as HTMLInputElement).value)"
              />
              <input
                type="color"
                :value="normalizeColor(label.bg_color)"
                title="Background colour"
                @change="setColor(label.id, 'bg', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <template #append>
              <v-btn icon="mdi-close-circle" size="small" variant="text" @click="resetColors(label.id)" title="Clear colours" />
              <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeLabel(label.id)" />
            </template>
          </v-list-item>

          <v-list-item v-if="labelsStore.labels.length === 0">
            <v-list-item-title class="text-grey">No labels defined.</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <PluginPrefsSection tab-id="prefLabels" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import { runDetached } from '../../utils/runDetached';
import { useLabelsStore } from '../../stores';
import { usePrefsNotifier } from './notify';
import PluginPrefsSection from './PluginPrefsSection.vue';

const notify = usePrefsNotifier();
const labelsStore = useLabelsStore();
const newCaption = ref('');

/**
 * The backend stores colours as hex strings, but the legacy UI could also leave
 * them empty. `<input type="color">` requires a valid value, so an empty one
 * falls back to a neutral default.
 */
const normalizeColor = (color: string) => (/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000');

async function createLabel() {
  const response = await api.createLabel(newCaption.value);
  if (response.status === 0) {
    newCaption.value = '';
    await labelsStore.loadLabels();
    notify('Label created', 'success');
  } else {
    notify(response.error ?? 'Failed to create label', 'error');
  }
}

async function removeLabel(labelId: number) {
  const response = await api.removeLabel(labelId);
  if (response.status === 0) {
    await labelsStore.loadLabels();
    notify('Label removed', 'success');
  } else {
    notify(response.error ?? 'Failed to remove label', 'error');
  }
}

async function setColor(labelId: number, kind: 'fg' | 'bg', color: string) {
  const response = await api.setLabelColor(labelId, kind, color);
  if (response.status === 0) {
    await labelsStore.loadLabels();
  } else {
    notify(response.error ?? 'Failed to set colour', 'error');
  }
}

async function resetColors(labelId: number) {
  const response = await api.resetLabelColors([labelId]);
  if (response.status === 0) {
    await labelsStore.loadLabels();
  } else {
    notify(response.error ?? 'Failed to clear colours', 'error');
  }
}

onMounted(() => {
  runDetached(labelsStore.loadLabels(), 'load labels');
});
</script>

<style scoped>
.new-label-input {
  max-width: 320px;
}
</style>
