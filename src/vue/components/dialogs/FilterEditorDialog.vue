<template>
  <v-dialog
    :model-value="modelValue"
    max-width="820"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isNew ? 'New filter' : 'Edit filter' }}</v-card-title>
      <v-card-text>
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <template v-else-if="details && draft">
          <v-text-field v-model="draft.title" label="Title" density="compact" variant="outlined" />

          <div class="d-flex flex-wrap gap-4">
            <v-switch v-model="draft.enabled" label="Enabled" color="primary" density="compact" hide-details />
            <v-switch
              v-model="draft.match_any_rule"
              label="Match any rule"
              color="primary"
              density="compact"
              hide-details
            />
            <v-switch v-model="draft.inverse" label="Inverse" color="primary" density="compact" hide-details />
          </div>

          <h3 class="text-subtitle-1 mt-4">Rules</h3>
          <v-alert v-if="draft.rules.length === 0" type="info" variant="tonal" density="compact" class="mb-2">
            A filter without rules does nothing.
          </v-alert>
          <div v-for="(rule, index) in draft.rules" :key="'rule-' + index" class="filter-row">
            <v-text-field
              v-model="rule.reg_exp"
              label="Regular expression"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-regex"
            />
            <v-select
              v-model="rule.filter_type"
              :items="typeOptions"
              item-title="title"
              item-value="value"
              label="Match in"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-type"
            />
            <v-select
              v-model="rule.scope"
              :items="feedScopes"
              item-title="title"
              item-value="value"
              label="Feeds"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-scope"
            />
            <v-checkbox v-model="rule.inverse" label="Inverse" density="compact" hide-details />
            <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeRule(index)" />
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" @click="addRule">Add rule</v-btn>

          <h3 class="text-subtitle-1 mt-4">Actions</h3>
          <v-alert v-if="draft.actions.length === 0" type="info" variant="tonal" density="compact" class="mb-2">
            A filter without actions does nothing.
          </v-alert>
          <div v-for="(action, index) in draft.actions" :key="'action-' + index" class="filter-row">
            <v-select
              v-model="action.action_id"
              :items="actionOptions"
              item-title="title"
              item-value="value"
              label="Action"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-action"
              @update:model-value="resetActionParam(action)"
            />
            <v-select
              v-if="action.action_id === 7"
              v-model="action.action_param_label"
              :items="labelOptions"
              item-title="title"
              item-value="value"
              label="Label"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-param"
              @update:model-value="action.action_param = action.action_param_label"
            />
            <v-text-field
              v-else
              v-model="action.action_param"
              label="Parameter"
              density="compact"
              variant="outlined"
              hide-details
              class="filter-param"
              :disabled="parameterNotRequired(action.action_id)"
            />
            <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeAction(index)" />
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" @click="addAction">Add action</v-btn>

          <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
            {{ message }}
          </v-alert>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="!draft || !draft.title" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import api from '../../api/client';
import { useFeedsStore, useLabelsStore } from '../../stores/index';
import type { FilterDetails, FilterPayload } from '../../api/legacyEndpoints';

interface EditableRule {
  reg_exp: string;
  filter_type: number;
  scope: string;
  inverse: boolean;
}

interface EditableAction {
  action_id: number;
  action_param: string;
  action_param_label: string;
}

interface Draft {
  title: string;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  rules: EditableRule[];
  actions: EditableAction[];
}

const props = defineProps<{ modelValue: boolean; filterId: number | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}>();

const feedStore = useFeedsStore();
const labelsStore = useLabelsStore();

const isNew = computed(() => props.filterId === null);
const loading = ref(false);
const saving = ref(false);
const details = ref<FilterDetails | null>(null);
const draft = ref<Draft | null>(null);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const typeOptions = computed(() =>
  Object.entries(details.value?.filter_types ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

const actionOptions = computed(() =>
  Object.entries(details.value?.action_types ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

const labelOptions = computed(() =>
  labelsStore.labels.map((label) => ({ value: label.caption, title: label.caption }))
);

const feedScopes = computed(() => [
  { value: '0', title: 'All feeds' },
  ...feedStore.categories.map((category) => ({
    value: `CAT:${category.id}`,
    title: `Category: ${category.title}`,
  })),
  ...feedStore.feeds.map((feed) => ({ value: String(feed.id), title: feed.title })),
]);

function notify(text: string, type: 'success' | 'error' = 'success') {
  message.value = text;
  messageType.value = type;
}

async function load() {
  loading.value = true;
  message.value = '';
  try {
    const response = await api.getFilterDetails(props.filterId ?? 0);
    if (response.status !== 0) {
      notify(response.error ?? 'Failed to load filter', 'error');
      return;
    }
    details.value = response.content;
    draft.value = {
      title: response.content.title,
      enabled: response.content.enabled,
      match_any_rule: response.content.match_any_rule,
      inverse: response.content.inverse,
      rules: response.content.rules.map((rule) => ({
        reg_exp: rule.reg_exp,
        filter_type: rule.filter_type,
        scope: rule.feed_id[0] ?? '0',
        inverse: rule.inverse,
      })),
      actions: response.content.actions.map((action) => ({
        action_id: action.action_id,
        action_param: action.action_param,
        action_param_label: action.action_param_label || action.action_param,
      })),
    };
  } catch {
    notify('Failed to load filter', 'error');
  } finally {
    loading.value = false;
  }
}

function addRule() {
  draft.value?.rules.push({ reg_exp: '', filter_type: 1, scope: '0', inverse: false });
}

function removeRule(index: number) {
  draft.value?.rules.splice(index, 1);
}

function addAction() {
  draft.value?.actions.push({ action_id: 8, action_param: '', action_param_label: '' });
}

function removeAction(index: number) {
  draft.value?.actions.splice(index, 1);
}

/** Actions 2, 3, 5 and 8 take no parameter. */
function parameterNotRequired(actionId: number): boolean {
  return [2, 3, 5, 8].includes(actionId);
}

function resetActionParam(action: EditableAction) {
  action.action_param = '';
  action.action_param_label = '';
}

async function save() {
  const current = draft.value;
  if (!current) return;
  const payload: FilterPayload = {
    title: current.title,
    enabled: current.enabled,
    match_any_rule: current.match_any_rule,
    inverse: current.inverse,
    rules: current.rules.map((rule) => ({
      reg_exp: rule.reg_exp,
      filter_type: rule.filter_type,
      feed_id: [rule.scope],
      inverse: rule.inverse,
    })),
    actions: current.actions.map((action) => ({
      action_id: action.action_id,
      action_param: action.action_id === 7 ? action.action_param_label : action.action_param,
      action_param_label: action.action_param_label,
    })),
  };

  saving.value = true;
  try {
    const response = props.filterId === null
      ? await api.createFilter(payload)
      : await api.saveFilter(props.filterId, payload);
    if (response.status === 0) {
      emit('saved');
      emit('update:modelValue', false);
    } else {
      notify(response.error ?? 'Failed to save filter', 'error');
    }
  } catch {
    notify('Failed to save filter', 'error');
  } finally {
    saving.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void load();
      void labelsStore.loadLabels();
    }
  }
);
</script>

<style scoped>
.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.filter-regex {
  flex: 2;
}

.filter-type,
.filter-scope {
  flex: 0 0 170px;
}

.filter-action {
  flex: 0 0 200px;
}

.filter-param {
  flex: 1;
}
</style>
