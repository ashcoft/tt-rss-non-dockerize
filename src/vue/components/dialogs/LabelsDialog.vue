<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="640"
  >
    <v-card>
      <v-card-title>Labels</v-card-title>
      <v-card-text>
        <!-- Assign labels to an article -->
        <template v-if="articleId">
          <p class="text-subtitle-2 mb-2">
            Assign labels to article #{{ articleId }}:
          </p>
          <v-list density="compact">
            <v-list-item v-for="label in labels" :key="label.id">
              <template #prepend>
                <v-checkbox
                  hide-details
                  density="compact"
                  :model-value="assignedLabelIds.has(label.id)"
                  @update:model-value="(checked: boolean) => toggleAssignment(label.id, checked)"
                />
              </template>
              <v-chip
                :style="{ backgroundColor: label.bg_color, color: label.fg_color }"
                size="small"
              >
                {{ label.caption }}
              </v-chip>
            </v-list-item>
          </v-list>
        </template>

        <!-- Create / manage labels -->
        <v-divider v-if="articleId" class="my-4" />

        <p class="text-subtitle-2 mb-2">Create new label:</p>
        <div class="d-flex align-center gap-2">
          <v-text-field v-model="newCaption" label="Caption" density="compact" hide-details />
          <v-btn color="primary" :disabled="!newCaption" :loading="busy" @click="create">
            Create
          </v-btn>
        </div>

        <v-divider class="my-4" />

        <v-list density="compact">
          <v-list-item v-for="label in labels" :key="'mgmt-' + label.id">
            <v-icon
              start
              :style="{ color: label.bg_color }"
              icon="mdi-label"
            />
            {{ label.caption }}
            <template #append>
              <v-btn
                icon="mdi-delete"
                size="small"
                variant="text"
                color="error"
                @click="removeLabel(label)"
              />
            </template>
          </v-list-item>
        </v-list>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-2">
          {{ message }}
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
import { ref, watch, computed } from 'vue';
import api from '../../api/client';

interface LabelInfo {
  id: number;
  caption: string;
  fg_color: string;
  bg_color: string;
}

const props = defineProps<{
  modelValue: boolean;
  /** Optional article id to assign labels to */
  articleId?: number | null;
  /** Label ids currently assigned to that article */
  assignedLabels?: number[];
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const labels = ref<LabelInfo[]>([]);
const newCaption = ref('');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const assignedLabelIds = computed(() => new Set(props.assignedLabels ?? []));

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      message.value = '';
      await loadLabels();
    }
  }
);

async function loadLabels() {
  try {
    const response = await api.getLabels();
    if (response.status === 0) {
      labels.value = response.content as unknown as LabelInfo[];
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
      notify('Failed to create label', 'error');
    }
  } catch {
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
      notify('Failed to remove label', 'error');
    }
  } catch {
    notify('Failed to remove label', 'error');
  }
}

async function toggleAssignment(labelId: number, checked: boolean) {
  if (!props.articleId) return;
  try {
    await api.setLabelForArticles(labelId, [props.articleId], checked ? 1 : 0);
    notify(checked ? 'Label assigned' : 'Label unassigned');
  } catch {
    notify('Failed to update assignment', 'error');
  }
}

// Close dialog using emit
function closeDialog() {
  emit('update:modelValue', false);
}
</script>

