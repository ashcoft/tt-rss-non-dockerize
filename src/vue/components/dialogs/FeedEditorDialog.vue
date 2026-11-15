<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Edit feed</v-card-title>
      <v-card-text>
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <template v-else-if="details">
          <v-text-field v-model="details.title" label="Title" density="compact" variant="outlined" />
          <v-text-field v-model="details.feed_url" label="Feed URL" density="compact" variant="outlined" />
          <v-text-field v-model="details.site_url" label="Site URL" density="compact" variant="outlined" />
          <v-select
            v-model="details.cat_id"
            :items="categoryOptions"
            label="Category"
            item-title="title"
            item-value="id"
            density="compact"
            variant="outlined"
            clearable
          />
          <v-select
            v-model="details.update_interval"
            :items="updateIntervals"
            label="Update interval"
            item-title="title"
            item-value="value"
            density="compact"
            variant="outlined"
          />
          <v-select
            v-model="details.purge_interval"
            :items="purgeIntervals"
            label="Purge articles"
            item-title="title"
            item-value="value"
            density="compact"
            variant="outlined"
          />
          <v-text-field v-model="details.auth_login" label="HTTP auth login" density="compact" variant="outlined" />
          <v-text-field v-model="details.auth_pass" label="HTTP auth password" type="password" density="compact" variant="outlined" />

          <v-row dense class="mt-1">
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.private" label="Private" hide-details density="compact" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.cache_images" label="Cache media" hide-details density="compact" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.hide_images" label="Do not embed media" hide-details density="compact" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.include_in_digest" label="Include in digest" hide-details density="compact" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.always_display_enclosures" label="Always display attachments" hide-details density="compact" />
            </v-col>
            <v-col cols="6" sm="4">
              <v-checkbox v-model="details.mark_unread_on_update" label="Mark updated as unread" hide-details density="compact" />
            </v-col>
          </v-row>

          <v-divider class="my-3" />

          <div class="d-flex align-center gap-3">
            <v-icon size="40">mdi-image</v-icon>
            <v-btn size="small" variant="tonal" @click="iconPicker?.click()">Upload icon</v-btn>
            <v-btn size="small" variant="text" color="error" @click="removeIcon">Remove icon</v-btn>
            <input ref="iconPicker" type="file" accept="image/*" style="display: none" @change="uploadIcon" />
          </div>

          <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
            {{ message }}
          </v-alert>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">Cancel</v-btn>
        <v-btn color="primary" :loading="busy" :disabled="!details" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { runDetached } from '../../utils/runDetached';
import api from '../../api/client';
import { useFeedsStore } from '../../stores';
import {
  FEED_PURGE_INTERVALS,
  FEED_UPDATE_INTERVALS,
  ICON_UPLOAD_SUCCESS,
  type FeedDetails,
} from '../../api/legacyEndpoints';

const props = defineProps<{
  modelValue: boolean;
  feedId: number;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}>();

const feedsStore = useFeedsStore();
const loading = ref(false);
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');
const details = ref<FeedDetails | null>(null);
const iconPicker = ref<HTMLInputElement | null>(null);
const updateIntervals = FEED_UPDATE_INTERVALS;
const purgeIntervals = FEED_PURGE_INTERVALS;

const categoryOptions = computed(() => feedsStore.categories);

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.feedId) return;
    message.value = '';
    runDetached(load(), 'load feed');
  }
);

async function load() {
  loading.value = true;
  details.value = await feedsStore.loadFeedDetails(props.feedId);
  loading.value = false;
  if (!details.value) {
    message.value = feedsStore.error ?? 'Failed to load feed';
    messageType.value = 'error';
  }
}

async function save() {
  if (!details.value) return;
  const d = details.value;
  busy.value = true;
  const ok = await feedsStore.saveFeed(d.id, {
    title: d.title,
    feed_url: d.feed_url,
    site_url: d.site_url,
    cat_id: d.cat_id,
    update_interval: d.update_interval,
    purge_interval: d.purge_interval,
    auth_login: d.auth_login,
    auth_pass: d.auth_pass,
    private: d.private,
    cache_images: d.cache_images,
    hide_images: d.hide_images,
    feed_language: d.feed_language,
    include_in_digest: d.include_in_digest,
    always_display_enclosures: d.always_display_enclosures,
    mark_unread_on_update: d.mark_unread_on_update,
  });
  busy.value = false;
  if (ok) {
    emit('saved');
    close();
  } else {
    message.value = feedsStore.error ?? 'Failed to save feed';
    messageType.value = 'error';
  }
}

async function uploadIcon(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const response = await api.uploadFeedIcon(props.feedId, file);
  input.value = '';
  if (response.status === 0 && response.content.rc === ICON_UPLOAD_SUCCESS) {
    message.value = 'Icon uploaded';
    messageType.value = 'success';
  } else {
    message.value = response.error ?? `Icon upload failed (${response.content.rc})`;
    messageType.value = 'error';
  }
}

async function removeIcon() {
  const response = await api.removeFeedIcon(props.feedId);
  if (response.status === 0) {
    message.value = 'Icon removed';
    messageType.value = 'success';
  } else {
    message.value = response.error ?? 'Failed to remove icon';
    messageType.value = 'error';
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>
