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
                  @update:model-value="(checked: boolean) => runDetached(toggleAssignment(label.id, checked), 'toggle label')"
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
          <v-alert
            v-if="assignMessage"
            :type="assignType"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ assignMessage }}
          </v-alert>
          <v-divider class="my-4" />
        </template>

        <LabelsPanel />
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
import { runDetached } from '../../utils/runDetached';
import api from '../../api/client';
import LabelsPanel from './LabelsPanel.vue';

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
const assignMessage = ref('');
const assignType = ref<'success' | 'error'>('success');

const assignedLabelIds = computed(() => new Set(props.assignedLabels ?? []));

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    assignMessage.value = '';
    runDetached(loadLabels(), 'load labels');
  }
);

async function loadLabels() {
  try {
    const response = await api.getLabels();
    if (response.status === 0) {
      labels.value = response.content;
    } else {
      assignMessage.value = response.error ?? 'Failed to load labels';
      assignType.value = 'error';
    }
  } catch (err) {
    console.error('Failed to load labels:', err);
    assignMessage.value = 'Failed to load labels';
    assignType.value = 'error';
  }
}

async function toggleAssignment(labelId: number, checked: boolean) {
  if (!props.articleId) return;
  try {
    await api.setLabelForArticles(labelId, [props.articleId], checked ? 1 : 0);
    assignMessage.value = checked ? 'Label assigned' : 'Label unassigned';
    assignType.value = 'success';
  } catch (err) {
    console.error('Failed to update assignment:', err);
    assignMessage.value = 'Failed to update assignment';
    assignType.value = 'error';
  }
}

function closeDialog() {
  emit('update:modelValue', false);
}
</script>
