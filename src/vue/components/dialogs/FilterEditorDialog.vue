<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isNew ? 'Create new filter' : 'Edit filter' }}</v-card-title>
      <v-card-text>
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <template v-else-if="details">
          <v-text-field
            v-model="details.title"
            label="Title"
            density="compact"
            class="mb-2"
          />

          <div class="d-flex flex-wrap ga-4 mb-2">
            <v-checkbox v-model="details.enabled" label="Enabled" hide-details density="compact" />
            <v-checkbox v-model="details.match_any_rule" label="Match any rule" hide-details density="compact" />
            <v-checkbox v-model="details.inverse" label="Inverse matching" hide-details density="compact" />
          </div>

          <v-tabs v-model="tab" color="primary">
            <v-tab value="rules">Match ({{ details.rules.length }})</v-tab>
            <v-tab value="actions">Apply actions ({{ details.actions.length }})</v-tab>
          </v-tabs>

          <v-window v-model="tab" class="mt-3">
            <v-window-item value="rules">
              <div class="d-flex justify-end mb-2">
                <v-btn size="small" prepend-icon="mdi-plus" variant="tonal" @click="addRule">Add rule</v-btn>
              </div>
              <v-card
                v-for="(rule, index) in details.rules"
                :key="`rule-${index}`"
                variant="outlined"
                class="pa-3 mb-2"
              >
                <div class="d-flex justify-end">
                  <v-btn
                    icon="mdi-delete"
                    size="x-small"
                    variant="text"
                    color="error"
                    title="Remove rule"
                    @click="details.rules.splice(index, 1)"
                  />
                </div>
                <v-textarea
                  v-model="rule.reg_exp"
                  label="Regular expression"
                  rows="2"
                  density="compact"
                  hide-details
                  class="mb-2"
                />
                <v-checkbox v-model="rule.inverse" label="Inverse matching" hide-details density="compact" class="mb-2" />
                <div class="d-flex flex-wrap ga-2">
                  <v-select
                    v-model="rule.filter_type"
                    :items="filterTypeOptions"
                    label="Match on"
                    item-title="title"
                    item-value="value"
                    density="compact"
                    hide-details
                    style="max-width: 200px"
                  />
                  <v-select
                    v-model="rule.feed_id"
                    :items="feedOptions"
                    label="In"
                    item-title="title"
                    item-value="value"
                    multiple
                    chips
                    density="compact"
                    hide-details
                    style="min-width: 260px"
                  />
                </div>
              </v-card>
              <p v-if="details.rules.length === 0" class="text-caption text-grey">No rules yet.</p>
            </v-window-item>

            <v-window-item value="actions">
              <div class="d-flex justify-end mb-2">
                <v-btn size="small" prepend-icon="mdi-plus" variant="tonal" @click="addAction">Add action</v-btn>
              </div>
              <v-card
                v-for="(action, index) in details.actions"
                :key="`action-${index}`"
                variant="outlined"
                class="pa-3 mb-2"
              >
                <div class="d-flex justify-end">
                  <v-btn
                    icon="mdi-delete"
                    size="x-small"
                    variant="text"
                    color="error"
                    title="Remove action"
                    @click="details.actions.splice(index, 1)"
                  />
                </div>
                <v-select
                  :model-value="action.action_id"
                  :items="actionOptions"
                  label="Action"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  hide-details
                  class="mb-2"
                  @update:model-value="(value: number) => changeAction(action, value)"
                />

                <v-select
                  v-if="action.action_id === ACTION_LABEL"
                  v-model="action.action_param_label"
                  :items="labelOptions"
                  label="Label"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  hide-details
                  @update:model-value="(value: string) => (action.action_param = value)"
                />
                <v-select
                  v-else-if="action.action_id === ACTION_PLUGIN"
                  v-model="action.action_param"
                  :items="pluginOptions"
                  label="Plugin action"
                  item-title="title"
                  item-value="value"
                  density="compact"
                  hide-details
                />
                <v-text-field
                  v-else-if="PARAM_ACTIONS.includes(action.action_id)"
                  v-model="action.action_param"
                  :label="paramLabel(action.action_id)"
                  density="compact"
                  hide-details
                />
              </v-card>
              <p v-if="details.actions.length === 0" class="text-caption text-grey">No actions yet.</p>
            </v-window-item>
          </v-window>
        </template>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
          {{ message }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="tonal" :loading="testLoading" :disabled="!details" @click="runTest">
          Test
        </v-btn>
        <v-spacer />
        <v-btn @click="closeDialog">Cancel</v-btn>
        <v-btn color="primary" :loading="busy" :disabled="!canSave" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="testOpen" max-width="760">
    <v-card>
      <v-card-title>Test filter</v-card-title>
      <v-card-text>
        <p class="text-caption text-grey">
          Scanned {{ testResult.pre_filtering_count }} recent article(s) and found
          {{ testResult.items.length }} match(es).
        </p>
        <v-list density="compact" class="filter-test-results">
          <v-list-item v-for="(item, index) in testResult.items" :key="index">
            <v-list-item-title>
              <span v-html="sanitizeHtml(item.title)" />
            </v-list-item-title>
            <v-list-item-subtitle>{{ item.feed_title }} · {{ item.date }}</v-list-item-subtitle>
            <div class="text-caption" v-html="sanitizeHtml(item.content_preview)" />
            <div v-if="item.rules.length" class="text-caption text-grey">
              {{ item.rules.join('; ') }}
            </div>
          </v-list-item>
          <v-list-item v-if="testResult.items.length === 0">
            <v-list-item-title>No recent articles match this filter.</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="testOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import api from '../../api/client';
import type { FilterAction, FilterDetails, FilterRule } from '../../api/client';
import type { FilterTestResult } from '../../api/legacyEndpoints';
import { useFeedsStore } from '../../stores';
import { runDetached } from '../../utils/runDetached';

// Action ids mirror the constants in classes/Pref_Filters.php.
const ACTION_TAG = 4;
const ACTION_SCORE = 6;
const ACTION_LABEL = 7;
const ACTION_PLUGIN = 9;
const ACTION_REMOVE_TAG = 10;
const PARAM_ACTIONS = [ACTION_TAG, ACTION_SCORE, ACTION_LABEL, ACTION_PLUGIN, ACTION_REMOVE_TAG];

const props = defineProps<{ modelValue: boolean; filterId: number | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}>();

const feedStore = useFeedsStore();
const tab = ref('rules');
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const details = ref<FilterDetails | null>(null);

const testOpen = ref(false);
const testLoading = ref(false);
const testResult = ref<FilterTestResult>({ pre_filtering_count: 0, items: [] });

const isNew = computed(() => !props.filterId);
const canSave = computed(() => (details.value?.title.trim().length ?? 0) > 0);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    message.value = '';
    tab.value = 'rules';
    // load() reports failures through `message`; runDetached keeps a rejected
    // promise from escaping the watcher callback.
    runDetached(load(), 'load filter');
  }
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.getFilterDetails(props.filterId ?? 0);
    if (response.status === 0 && response.content) {
      details.value = response.content;
    } else {
      details.value = null;
      notify(response.error ?? 'Failed to load filter', 'error');
    }
  } catch (err) {
    console.error('Failed to load filter:', err);
    notify('Failed to load filter', 'error');
  } finally {
    loading.value = false;
  }
}

const filterTypeOptions = computed(() =>
  Object.entries(details.value?.filterTypes ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

/** Rule targets: All feeds, each category (CAT:<id>) and each feed. */
const feedOptions = computed(() => {
  const options = [{ value: '0', title: 'All feeds' }];
  for (const category of feedStore.categories) {
    options.push({ value: `CAT:${category.id}`, title: category.title });
  }
  for (const feed of feedStore.feeds) {
    options.push({ value: String(feed.id), title: feed.title });
  }
  return options;
});

const actionOptions = computed(() =>
  Object.entries(details.value?.actionTypes ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

const labelOptions = computed(() =>
  (details.value?.labels ?? []).map((label) => ({ value: label.caption, title: label.caption }))
);

const pluginOptions = computed(() =>
  Object.entries(details.value?.pluginActions ?? {}).map(([value, title]) => ({ value, title }))
);

function paramLabel(actionId: number): string {
  if (actionId === ACTION_TAG || actionId === ACTION_REMOVE_TAG) return 'Tags (comma separated)';
  if (actionId === ACTION_SCORE) return 'Score adjustment';
  return 'Parameter';
}

function addRule(): void {
  details.value?.rules.push({
    reg_exp: '',
    filter_type: 1,
    feed_id: ['0'],
    inverse: false,
  } satisfies FilterRule);
}

function addAction(): void {
  details.value?.actions.push({
    action_id: 2,
    action_param: '',
    action_param_label: '',
  } satisfies FilterAction);
}

/** Reset the parameter fields when the action type changes. */
function changeAction(action: FilterAction, actionId: number): void {
  action.action_id = actionId;
  action.action_param = '';
  action.action_param_label = '';
}

function sanitizeHtml(value: string): string {
  return DOMPurify.sanitize(value);
}

async function runTest(): Promise<void> {
  if (!details.value) return;
  testLoading.value = true;
  try {
    const response = await api.testFilter(
      details.value.rules as unknown as Array<Record<string, unknown>>,
      details.value.match_any_rule,
      details.value.inverse
    );
    if (response.status === 0) {
      testResult.value = response.content;
      testOpen.value = true;
    } else {
      notify(response.error ?? 'Failed to test the filter', 'error');
    }
  } finally {
    testLoading.value = false;
  }
}

async function save(): Promise<void> {
  if (!details.value) return;
  busy.value = true;
  try {
    // The label action stores its value in action_param_label; every other
    // parameterised action stores it in action_param.
    const payload: FilterDetails = {
      ...details.value,
      actions: details.value.actions.map((action) => ({
        action_id: action.action_id,
        action_param: action.action_id === ACTION_LABEL ? action.action_param_label : action.action_param,
        action_param_label: action.action_param_label,
      })),
    };

    const response = await api.saveFilter(payload);
    if (response.status === 0) {
      emit('saved');
      emit('update:modelValue', false);
    } else {
      notify(response.error ?? 'Failed to save filter', 'error');
    }
  } catch (err) {
    console.error('Failed to save filter:', err);
    notify('Failed to save filter', 'error');
  } finally {
    busy.value = false;
  }
}

function notify(text: string, type: 'success' | 'error' = 'success'): void {
  message.value = text;
  messageType.value = type;
}

function closeDialog(): void {
  emit('update:modelValue', false);
}
</script>
