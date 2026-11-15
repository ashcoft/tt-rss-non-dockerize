<template>
  <div>
    <div v-if="loading" class="text-center py-8">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <v-alert v-if="isProfile" type="info" variant="tonal" density="compact" class="mb-3">
        Some preferences are only available in the default profile.
      </v-alert>

      <PrefsAuthTab />

      <v-card v-for="section in sections" :key="section.title" variant="outlined" class="mb-4">
        <v-card-title class="text-subtitle-1">{{ section.title }}</v-card-title>
        <v-card-text>
          <template v-for="(item, index) in section.items" :key="item.name || 'sep-' + index">
            <v-divider v-if="item.kind === 'separator'" class="my-3" />

            <div v-else class="pref-row">
              <v-checkbox
                v-if="item.kind === 'bool'"
                v-model="values[item.name]"
                true-value="1"
                false-value="0"
                :label="item.label"
                hide-details
                density="compact"
                class="pref-control"
              />

              <v-select
                v-else-if="item.kind === 'select'"
                v-model="values[item.name]"
                :items="selectItems(item)"
                :label="item.label"
                density="compact"
                variant="outlined"
                hide-details
                class="pref-control"
              />

              <v-textarea
                v-else-if="item.kind === 'textarea'"
                v-model="values[item.name]"
                :label="item.label"
                rows="3"
                density="compact"
                variant="outlined"
                hide-details
                class="pref-control"
              />

              <v-text-field
                v-else
                v-model="values[item.name]"
                :label="item.label"
                :type="item.kind === 'int' ? 'number' : 'text'"
                density="compact"
                variant="outlined"
                hide-details
                class="pref-control"
              />

              <div v-if="item.help_text" class="text-caption text-grey mt-1" v-html="item.help_text" />
            </div>
          </template>
        </v-card-text>
      </v-card>

      <div class="d-flex gap-2 mb-4">
        <v-btn color="primary" :loading="saving" prepend-icon="mdi-content-save" @click="save">
          Save configuration
        </v-btn>
        <v-btn color="error" variant="text" prepend-icon="mdi-restore" @click="reset">Reset to defaults</v-btn>
      </div>

      <PluginPrefsSection tab-id="prefPrefs" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import { prefFormFields, type PrefSection, type PrefItem } from '../../api/legacyEndpoints';
import { usePrefsNotifier } from './notify';
import PluginPrefsSection from './PluginPrefsSection.vue';
import PrefsAuthTab from './PrefsAuthTab.vue';

const notify = usePrefsNotifier();
const loading = ref(true);
const saving = ref(false);
const isProfile = ref(false);
const sections = ref<PrefSection[]>([]);
/** Editable control values, keyed by preference name. */
const values = ref<Record<string, string>>({});

/** Turn a value→caption map into the shape `v-select` wants. */
const selectItems = (item: PrefItem) =>
  Object.entries(item.options ?? {}).map(([value, title]) => ({ value, title }));

async function load() {
  loading.value = true;
  const response = await api.getPrefsJson();
  loading.value = false;

  if (response.status !== 0) {
    notify(response.error ?? 'Failed to load preferences', 'error');
    return;
  }

  sections.value = response.content.sections;
  isProfile.value = response.content.isProfile;
  values.value = prefFormFields(response.content.sections).values;
}

async function save() {
  saving.value = true;
  const { booleanPrefs } = prefFormFields(sections.value);
  const response = await api.saveConfig(values.value, booleanPrefs);
  saving.value = false;

  if (response.status !== 0) {
    notify(response.error ?? 'Failed to save preferences', 'error');
    return;
  }

  if (response.content.reload) {
    window.location.reload();
    return;
  }
  notify(response.content.message || 'The configuration was saved.', 'success');
}

async function reset() {
  const response = await api.resetConfig();
  if (response.status === 0) {
    window.location.reload();
  } else {
    notify(response.error ?? 'Failed to reset preferences', 'error');
  }
}

onMounted(load);
</script>

<style scoped>
.pref-row {
  margin-bottom: 0.75rem;
}

.pref-control {
  max-width: 520px;
}
</style>
