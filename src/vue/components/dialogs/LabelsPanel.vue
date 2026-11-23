<template>
        <p class="text-subtitle-2 mb-2">Create new label:</p>
        <div class="d-flex align-center gap-2">
          <v-text-field v-model="newCaption" label="Caption" density="compact" hide-details />
          <v-btn color="primary" :disabled="!newCaption" :loading="busy" @click="runDetached(create(), 'create label')">
            Create
          </v-btn>
        </div>

        <v-divider class="my-4" />

        <v-list density="compact">
          <v-list-item v-for="label in labels" :key="'mgmt-' + label.id">
            <v-icon
              start
              :style="{ color: label.bg_color || 'inherit' }"
              icon="mdi-label"
            />
            <v-text-field
              :model-value="label.caption"
              density="compact"
              hide-details
              variant="plain"
              @change="(value: string) => renameExisting(label, value)"
            />
            <template #append>
              <v-btn
                icon="mdi-palette"
                size="small"
                variant="text"
                title="Edit colours"
                @click="toggleColors(label.id)"
              />
              <v-btn
                icon="mdi-delete"
                size="small"
                variant="text"
                color="error"
                @click="runDetached(removeLabel(label), 'remove label')"
              />
            </template>
          </v-list-item>
        </v-list>

        <v-card v-if="editingColors !== null" variant="outlined" class="pa-3 mt-2">
          <div class="d-flex flex-wrap ga-4 align-center">
            <v-text-field
              v-model="colorFg"
              label="Foreground"
              density="compact"
              hide-details
              style="max-width: 160px"
            />
            <v-text-field
              v-model="colorBg"
              label="Background"
              density="compact"
              hide-details
              style="max-width: 160px"
            />
            <v-btn color="primary" :loading="busy" @click="runDetached(saveColors(), 'save colours')">
              Apply
            </v-btn>
            <v-btn variant="text" :loading="busy" @click="runDetached(resetColors(), 'reset colours')">
              Reset
            </v-btn>
            <v-btn variant="text" @click="editingColors = null">Cancel</v-btn>
          </div>
          <p class="text-caption text-grey mt-2">
            Accepts any CSS colour, e.g. <code>#ff0000</code> or <code>red</code>.
          </p>
        </v-card>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-2">
          {{ message }}
        </v-alert>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { runDetached } from '../../utils/runDetached';
import api from '../../api/client';

interface LabelInfo {
  id: number;
  caption: string;
  fg_color: string;
  bg_color: string;
}

const labels = ref<LabelInfo[]>([]);
const newCaption = ref('');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

// Colour editing state: the label being edited, plus the pending fg/bg values.
const editingColors = ref<number | null>(null);
const colorFg = ref('');
const colorBg = ref('');

onMounted(() => {
  runDetached(loadLabels(), 'load labels');
});

async function loadLabels() {
  try {
    const response = await api.getLabels();
    if (response.status === 0) {
      labels.value = response.content;
    } else {
      notify(response.error ?? 'Failed to load labels', 'error');
    }
  } catch (err) {
    console.error('Failed to load labels:', err);
    notify('Failed to load labels', 'error');
  }
}

function notify(text: string, type: 'success' | 'error' = 'success') {
  message.value = text;
  messageType.value = type;
}

async function create() {
  busy.value = true;
  try {
    const response = await api.createLabel(newCaption.value);
    if (response.status === 0) {
      notify('Label created');
      newCaption.value = '';
      await loadLabels();
    } else {
      notify(response.error ?? 'Failed to create label', 'error');
    }
  } catch (err) {
    console.error('Failed to create label:', err);
    notify('Failed to create label', 'error');
  } finally {
    busy.value = false;
  }
}

async function removeLabel(label: LabelInfo) {
  try {
    const response = await api.removeLabel(label.id);
    if (response.status === 0) {
      await loadLabels();
      notify('Label removed');
    } else {
      notify(response.error ?? 'Failed to remove label', 'error');
    }
  } catch (err) {
    console.error('Failed to remove label:', err);
    notify('Failed to remove label', 'error');
  }
}

/**
 * Rename a label. `Pref_Labels/save` echoes the caption it stored, so when the
 * backend keeps the old caption (empty or duplicate name) the list is reloaded
 * to show the truth rather than the optimistic edit.
 */
async function renameExisting(label: LabelInfo, caption: string) {
  const trimmed = caption.trim();
  if (trimmed === '' || trimmed === label.caption) {
    await loadLabels();
    return;
  }
  try {
    const response = await api.renameLabel(label.id, trimmed);
    if (response.status === 0) {
      notify('Label renamed');
      await loadLabels();
    } else {
      notify(response.error ?? 'Failed to rename label', 'error');
    }
  } catch (err) {
    console.error('Failed to rename label:', err);
    notify('Failed to rename label', 'error');
  }
}

/** Open the colour editor for a label, seeded with its current colours. */
function toggleColors(labelId: number) {
  if (editingColors.value === labelId) {
    editingColors.value = null;
    return;
  }
  const label = labels.value.find(l => l.id === labelId);
  colorFg.value = label?.fg_color ?? '';
  colorBg.value = label?.bg_color ?? '';
  editingColors.value = labelId;
}

async function saveColors() {
  if (editingColors.value === null) return;
  busy.value = true;
  try {
    const response = await api.setLabelColors(editingColors.value, colorFg.value, colorBg.value);
    if (response.status === 0) {
      notify('Label colours saved');
      await loadLabels();
    } else {
      notify(response.error ?? 'Failed to save colours', 'error');
    }
  } catch (err) {
    console.error('Failed to save colours:', err);
    notify('Failed to save colours', 'error');
  } finally {
    busy.value = false;
  }
}

async function resetColors() {
  if (editingColors.value === null) return;
  busy.value = true;
  try {
    const response = await api.resetLabelColors(editingColors.value);
    if (response.status === 0) {
      notify('Label colours reset');
      await loadLabels();
    } else {
      notify(response.error ?? 'Failed to reset colours', 'error');
    }
  } catch (err) {
    console.error('Failed to reset colours:', err);
    notify('Failed to reset colours', 'error');
  } finally {
    busy.value = false;
  }
}

</script>
