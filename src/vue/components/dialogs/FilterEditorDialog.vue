<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isNew ? 'Create new filter' : 'Edit filter' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="draft.title"
          label="Title"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3"
        />

        <v-row dense>
          <v-col cols="12" sm="4">
            <v-checkbox v-model="draft.enabled" label="Enabled" hide-details density="compact" />
          </v-col>
          <v-col cols="12" sm="4">
            <v-checkbox v-model="draft.match_any_rule" label="Match any rule" hide-details density="compact" />
          </v-col>
          <v-col cols="12" sm="4">
            <v-checkbox v-model="draft.inverse" label="Inverse matching" hide-details density="compact" />
          </v-col>
        </v-row>

        <v-tabs v-model="tab" color="primary" density="compact">
          <v-tab value="match">Match ({{ draft.rules.length }})</v-tab>
          <v-tab value="actions">Apply actions ({{ draft.actions.length }})</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-2">
          <v-window-item value="match">
            <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addRule">
              Add rule
            </v-btn>
            <v-list density="compact" class="mt-2">
              <v-list-item v-for="(rule, index) in draft.rules" :key="'rule-' + index">
                <v-list-item-title>{{ ruleLabel(rule) }}</v-list-item-title>
                <template #append>
                  <v-btn icon="mdi-pencil" size="small" variant="text" @click="editRule(index)" />
                  <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="draft.rules.splice(index, 1)" />
                </template>
              </v-list-item>
              <v-list-item v-if="draft.rules.length === 0">
                <v-list-item-title class="text-grey">No rules; add one to match articles.</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-window-item>

          <v-window-item value="actions">
            <v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addAction">
              Add action
            </v-btn>
            <v-list density="compact" class="mt-2">
              <v-list-item v-for="(action, index) in draft.actions" :key="'action-' + index">
                <v-list-item-title>{{ actionLabel(action) }}</v-list-item-title>
                <template #append>
                  <v-btn icon="mdi-pencil" size="small" variant="text" @click="editAction(index)" />
                  <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="draft.actions.splice(index, 1)" />
                </template>
              </v-list-item>
              <v-list-item v-if="draft.actions.length === 0">
                <v-list-item-title class="text-grey">No actions; add one to do something.</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-window-item>
        </v-window>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
          {{ message }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-btn v-if="!isNew" color="error" variant="text" @click="removeFilter">Remove</v-btn>
        <v-btn color="info" variant="text" @click="openTest">Test</v-btn>
        <v-spacer />
        <v-btn @click="close">Cancel</v-btn>
        <v-btn color="primary" :loading="busy" @click="save">{{ isNew ? 'Create' : 'Save' }}</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Rule editor -->
    <v-dialog v-model="ruleDialog" max-width="620">
      <v-card>
        <v-card-title>{{ ruleEditIndex === null ? 'Add rule' : 'Edit rule' }}</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="ruleDraft.reg_exp"
            label="Regular expression"
            rows="3"
            density="compact"
            variant="outlined"
          />
          <v-checkbox v-model="ruleDraft.inverse" label="Inverse regular expression matching" hide-details density="compact" />
          <v-select
            v-model="ruleDraft.filter_type"
            :items="filterTypeOptions"
            label="On"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
          <v-select
            v-model="ruleDraft.feed_id"
            :items="feedOptions"
            label="In"
            multiple
            chips
            density="compact"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="ruleDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="commitRule">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Action editor -->
    <v-dialog v-model="actionDialog" max-width="620">
      <v-card>
        <v-card-title>{{ actionEditIndex === null ? 'Add action' : 'Edit action' }}</v-card-title>
        <v-card-text>
          <v-select
            v-model="actionDraft.action_id"
            :items="actionTypeOptions"
            label="Action"
            density="compact"
            variant="outlined"
          />
          <v-text-field
            v-if="actionNeedsParam"
            v-model="actionDraft.action_param"
            :label="actionParamLabel"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
          <v-select
            v-if="actionDraft.action_id === ACTION_LABEL"
            v-model="actionDraft.action_param_label"
            :items="labelOptions"
            label="Label"
            density="compact"
            variant="outlined"
            class="mt-2"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="actionDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="commitAction">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Test results -->
    <v-dialog v-model="testDialog" max-width="620">
      <v-card>
        <v-card-title>Test filter</v-card-title>
        <v-card-text>
          <p class="text-caption text-grey">
            Found at least {{ testResultCount }} articles matching this filter.
          </p>
          <v-list density="compact" max-height="320" class="overflow-y-auto">
            <v-list-item v-for="(item, index) in testItems" :key="'test-' + index">
              <v-list-item-title>{{ item.title }}</v-list-item-title>
              <v-list-item-subtitle>{{ item.feed_title }} — {{ item.date }}</v-list-item-subtitle>
            </v-list-item>
            <v-list-item v-if="testItems.length === 0">
              <v-list-item-title class="text-grey">
                No recent articles matching this filter have been found.
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="testDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { runDetached } from '../../utils/runDetached';
import { useFiltersStore } from '../../stores/filters';
import api from '../../api/client';
import type { FilterDetails, FilterRule, FilterAction } from '../../api/legacyEndpoints';

const props = defineProps<{
  modelValue: boolean;
  /** Filter id to edit; 0 (or omitted) starts a new filter. */
  filterId?: number;
  /** Feed and category options for the rule's "in" selector. */
  feedOptions?: Array<{ title: string; value: number | string }>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}>();

// Action ids from Pref_Filters; only some take a parameter.
const ACTION_TAG = 4;
const ACTION_SCORE = 6;
const ACTION_LABEL = 7;
const ACTION_PLUGIN = 9;
const ACTION_REMOVE_TAG = 10;

const filtersStore = useFiltersStore();
const tab = ref('match');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const details = ref<FilterDetails | null>(null);
const draft = ref<{
  title: string;
  enabled: boolean;
  match_any_rule: boolean;
  inverse: boolean;
  rules: FilterRule[];
  actions: FilterAction[];
}>({
  title: '',
  enabled: true,
  match_any_rule: false,
  inverse: false,
  rules: [],
  actions: [],
});

const isNew = computed(() => !props.filterId);

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    message.value = '';
    tab.value = 'match';
    runDetached(load(), 'load filter');
  }
);

async function load() {
  const loaded = await filtersStore.loadDetails(props.filterId ?? 0);
  if (!loaded) {
    message.value = filtersStore.error ?? 'Failed to load filter';
    messageType.value = 'error';
    return;
  }
  details.value = loaded;
  draft.value = {
    title: loaded.title,
    enabled: loaded.enabled,
    match_any_rule: loaded.match_any_rule,
    inverse: loaded.inverse,
    rules: loaded.rules.map(rule => ({ ...rule })),
    actions: loaded.actions.map(action => ({ ...action })),
  };
}

// Rule editor ------------------------------------------------------------
const ruleDialog = ref(false);
const ruleEditIndex = ref<number | null>(null);
const ruleDraft = ref<FilterRule>({ reg_exp: '', filter_type: 1, feed_id: ['0'], inverse: false });

const filterTypeOptions = computed(() =>
  Object.entries(details.value?.filter_types ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

const feedOptions = computed(() =>
  props.feedOptions && props.feedOptions.length > 0
    ? props.feedOptions
    : [{ title: 'All feeds', value: '0' }]
);

function addRule() {
  ruleEditIndex.value = null;
  ruleDraft.value = { reg_exp: '', filter_type: 1, feed_id: ['0'], inverse: false };
  ruleDialog.value = true;
}

function editRule(index: number) {
  ruleEditIndex.value = index;
  ruleDraft.value = { ...draft.value.rules[index], feed_id: [...draft.value.rules[index].feed_id] };
  ruleDialog.value = true;
}

function commitRule() {
  if (!ruleDraft.value.reg_exp.trim()) {
    message.value = 'A rule needs a regular expression';
    messageType.value = 'error';
    return;
  }
  const rule = { ...ruleDraft.value, feed_id: [...ruleDraft.value.feed_id] };
  if (ruleEditIndex.value === null) {
    draft.value.rules.push(rule);
  } else {
    draft.value.rules.splice(ruleEditIndex.value, 1, rule);
  }
  ruleDialog.value = false;
}

/** A readable summary for a rule that has not been through the backend yet. */
function ruleLabel(rule: FilterRule): string {
  if (rule.name) return stripTags(rule.name);
  const type = details.value?.filter_types[String(rule.filter_type)] ?? 'unknown';
  const scope = rule.feed_id.length > 1 ? `${rule.feed_id.length} feeds` : 'all feeds';
  return `${rule.reg_exp} on ${type} in ${scope}${rule.inverse ? ' (inverse)' : ''}`;
}

// Action editor ----------------------------------------------------------
const actionDialog = ref(false);
const actionEditIndex = ref<number | null>(null);
const actionDraft = ref<FilterAction>({ action_id: 2, action_param: '' });

const actionTypeOptions = computed(() =>
  Object.entries(details.value?.action_types ?? {}).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

const labelOptions = computed(() =>
  (details.value?.labels ?? []).map(label => ({ value: label.caption, title: label.caption }))
);

const PARAM_ACTIONS = [ACTION_TAG, ACTION_SCORE, ACTION_LABEL, ACTION_PLUGIN, ACTION_REMOVE_TAG];

const actionNeedsParam = computed(() => PARAM_ACTIONS.includes(actionDraft.value.action_id));

const actionParamLabel = computed(() => {
  switch (actionDraft.value.action_id) {
    case ACTION_TAG:
      return 'Tags';
    case ACTION_SCORE:
      return 'Score';
    case ACTION_PLUGIN:
      return 'Plugin';
    case ACTION_REMOVE_TAG:
      return 'Tags to ignore';
    default:
      return 'Parameter';
  }
});

function addAction() {
  actionEditIndex.value = null;
  actionDraft.value = { action_id: 2, action_param: '' };
  actionDialog.value = true;
}

function editAction(index: number) {
  actionEditIndex.value = index;
  actionDraft.value = { ...draft.value.actions[index] };
  actionDialog.value = true;
}

function commitAction() {
  const action = { ...actionDraft.value };
  if (action.action_id === ACTION_LABEL && action.action_param_label) {
    action.action_param = action.action_param_label;
  }
  if (actionEditIndex.value === null) {
    draft.value.actions.push(action);
  } else {
    draft.value.actions.splice(actionEditIndex.value, 1, action);
  }
  actionDialog.value = false;
}

function actionLabel(action: FilterAction): string {
  if (action.name) return stripTags(action.name);
  const type = details.value?.action_types[String(action.action_id)] ?? `Action ${action.action_id}`;
  return action.action_param ? `${type}: ${action.action_param}` : type;
}

function stripTags(html: string): string {
  return html.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Test -------------------------------------------------------------------
const testDialog = ref(false);
const testItems = ref<Array<Record<string, unknown>>>([]);
const testResultCount = ref(0);

async function openTest() {
  const response = await api.testFilter({
    match_any_rule: draft.value.match_any_rule,
    inverse: draft.value.inverse,
    rules: draft.value.rules,
    offset: 0,
    limit: 30,
  });
  if (response.status === 0) {
    testItems.value = response.content.items;
    testResultCount.value = response.content.items.length;
  } else {
    message.value = response.error ?? 'Filter test failed';
    messageType.value = 'error';
    return;
  }
  testDialog.value = true;
}

// Save / remove ----------------------------------------------------------
async function save() {
  busy.value = true;
  const ok = await filtersStore.saveFilter(props.filterId ?? 0, draft.value);
  busy.value = false;
  if (ok) {
    emit('saved');
    close();
  } else {
    message.value = filtersStore.error ?? 'Failed to save filter';
    messageType.value = 'error';
  }
}

async function removeFilter() {
  if (!props.filterId) return;
  busy.value = true;
  const ok = await filtersStore.removeFilters([props.filterId]);
  busy.value = false;
  if (ok) {
    emit('saved');
    close();
  } else {
    message.value = filtersStore.error ?? 'Failed to remove filter';
    messageType.value = 'error';
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
