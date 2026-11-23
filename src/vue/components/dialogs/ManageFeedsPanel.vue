<template>

        <v-tabs v-model="tab" color="primary">
          <v-tab value="add">Add Feed</v-tab>
          <v-tab value="edit">Edit Feed</v-tab>
          <v-tab value="batch">Batch</v-tab>
          <v-tab value="remove">Remove / Purge</v-tab>
          <v-tab value="categories">Categories</v-tab>
          <v-tab value="opml">OPML</v-tab>
          <v-tab value="sharing">Sharing</v-tab>
          <v-tab value="maintenance">Maintenance</v-tab>
        </v-tabs>

        <v-window v-model="tab" class="mt-4">
          <!-- Add feed -->
          <v-window-item value="add">
            <v-text-field
              v-model="newFeedUrl"
              label="Feed URL"
              placeholder="https://example.com/feed.xml"
              prepend-inner-icon="mdi-rss"
            />
            <v-text-field
              v-model="newFeedTitle"
              label="Custom title (optional)"
            />
            <v-select
              v-model="newFeedCategory"
              :items="categoryOptions"
              label="Category"
              item-title="title"
              item-value="id"
              clearable
            />
            <v-btn
              color="primary"
              :loading="busy"
              :disabled="!newFeedUrl"
              @click="addFeed"
            >
              Subscribe
            </v-btn>
          </v-window-item>

          <!-- Edit feed -->
          <v-window-item value="edit">
            <v-select
              v-model="editFeedId"
              :items="feedStore.feeds"
              label="Feed"
              item-title="title"
              item-value="id"
              @update:model-value="loadFeedDetails"
            />
            <template v-if="editDetails">
              <v-text-field v-model="editDetails.title" label="Title" />
              <v-text-field v-model="editDetails.feed_url" label="Feed URL" />
              <v-text-field v-model="editDetails.site_url" label="Site URL" />
              <div class="d-flex align-center ga-3 mb-3">
                <v-avatar size="40" rounded>
                  <v-img v-if="iconPreviewUrl" :src="iconPreviewUrl" alt="Feed icon" />
                  <v-icon v-else icon="mdi-rss" />
                </v-avatar>
                <v-file-input
                  v-model="iconFile"
                  label="Custom icon"
                  accept="image/*"
                  density="compact"
                  hide-details
                  style="max-width: 280px"
                />
                <v-btn
                  size="small"
                  variant="tonal"
                  :disabled="!iconFile"
                  :loading="busy"
                  @click="runDetached(uploadIcon(), 'upload icon')"
                >
                  Upload
                </v-btn>
                <v-btn
                  size="small"
                  variant="text"
                  :loading="busy"
                  @click="runDetached(resetIcon(), 'reset icon')"
                >
                  Reset
                </v-btn>
              </div>
              <v-select
                v-model="editDetails.cat_id"
                :items="categoryOptions"
                label="Category"
                item-title="title"
                item-value="id"
                clearable
              />
              <v-select
                v-model="editDetails.update_interval"
                :items="updateIntervals"
                label="Update interval"
                item-title="title"
                item-value="value"
              />
              <v-select
                v-model="editDetails.purge_interval"
                :items="purgeIntervals"
                label="Purge articles"
                item-title="title"
                item-value="value"
              />

              <v-expansion-panels variant="accordion" class="mb-3">
                <v-expansion-panel title="Advanced">
                  <v-expansion-panel-text>
                    <v-text-field v-model="editDetails.auth_login" label="HTTP username" density="compact" />
                    <v-text-field v-model="editDetails.auth_pass" label="HTTP password" type="password" density="compact" />
                    <v-checkbox v-model="editDetails.private" label="Private" hide-details density="compact" />
                    <v-checkbox v-model="editDetails.cache_images" label="Cache images" hide-details density="compact" />
                    <v-checkbox v-model="editDetails.hide_images" label="Hide images" hide-details density="compact" />
                    <v-checkbox v-model="editDetails.mark_unread_on_update" label="Mark unread on update" hide-details density="compact" />
                    <v-checkbox v-model="editDetails.include_in_digest" label="Include in digest" hide-details density="compact" />
                    <v-checkbox v-model="editDetails.always_display_enclosures" label="Always display enclosures" hide-details density="compact" />
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>

              <v-btn color="primary" :loading="busy" @click="saveFeedChanges">Save</v-btn>
            </template>
            <p v-else class="text-caption text-grey mt-2">Select a feed to edit.</p>
          </v-window-item>

          <!-- Remove / purge feed -->
          <v-window-item value="remove">
            <v-select
              v-model="selectedFeedId"
              :items="feedStore.feeds"
              label="Feed"
              item-title="title"
              item-value="id"
            />
            <div class="d-flex gap-2 mt-2">
              <v-btn color="warning" :disabled="!selectedFeedId" :loading="busy" @click="purge">
                Purge articles
              </v-btn>
              <v-btn color="error" :disabled="!selectedFeedId" :loading="busy" @click="remove">
                Unsubscribe & delete
              </v-btn>
            </div>
          </v-window-item>

          <!-- Categories -->
          <v-window-item value="categories">
            <v-text-field v-model="newCategoryTitle" label="New category name" prepend-inner-icon="mdi-folder-plus" />
            <v-btn
              color="primary"
              class="mb-4"
              :disabled="!newCategoryTitle"
              :loading="busy"
              @click="createCategory"
            >
              Create category
            </v-btn>

            <v-list density="compact">
              <v-list-item v-for="cat in feedStore.categories" :key="cat.id">
                <template #prepend>
                  <v-icon>mdi-folder</v-icon>
                </template>
                <v-text-field
                  v-model="cat.title"
                  density="compact"
                  hide-details
                  variant="plain"
                  @change="renameCategory(cat)"
                />
                <template #append>
                  <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="deleteCategory(cat)" />
                </template>
              </v-list-item>
            </v-list>
          </v-window-item>

          <!-- OPML import / export -->
          <v-window-item value="opml">
            <p class="text-subtitle-2 mb-2">Import</p>
            <v-file-input
              v-model="opmlFile"
              label="OPML file"
              accept=".opml,.xml,text/xml,application/xml"
              density="compact"
              hide-details
              class="mb-2"
            />
            <v-btn
              color="primary"
              :disabled="!opmlFile"
              :loading="busy"
              @click="runDetached(importOpmlFile(), 'import OPML')"
            >
              Import OPML
            </v-btn>
            <v-card v-if="opmlResult" variant="outlined" class="pa-3 mt-3">
              <div class="opml-result" v-html="sanitizedOpmlResult" />
            </v-card>

            <v-divider class="my-4" />

            <p class="text-subtitle-2 mb-2">Export</p>
            <v-checkbox v-model="opmlIncludeSettings" label="Include tt-rss settings" hide-details density="compact" />
            <v-btn class="mt-2" prepend-icon="mdi-download" @click="exportOpml">Export OPML</v-btn>
          </v-window-item>

          <!-- Batch subscribe / edit -->
          <v-window-item value="batch">
            <p class="text-subtitle-2 mb-2">Batch subscribe</p>
            <v-textarea
              v-model="batchFeeds"
              label="One feed URL per line"
              rows="4"
              density="compact"
            />
            <v-select
              v-model="batchCategory"
              :items="categoryOptions"
              item-title="title"
              item-value="id"
              label="Category"
              density="compact"
              clearable
            />
            <v-text-field v-model="batchLogin" label="HTTP username" density="compact" />
            <v-text-field v-model="batchPass" label="HTTP password" type="password" density="compact" />
            <v-btn color="primary" :disabled="!batchFeeds" :loading="busy" @click="submitBatchSubscribe">
              Subscribe
            </v-btn>

            <v-divider class="my-4" />

            <p class="text-subtitle-2 mb-2">Batch edit</p>
            <v-select
              v-model="batchIds"
              :items="feedStore.feeds"
              item-title="title"
              item-value="id"
              label="Feeds"
              multiple
              chips
              density="compact"
            />

            <div class="d-flex align-center ga-2">
              <v-checkbox v-model="batchApply.cat_id" label="Category" hide-details density="compact" />
              <v-select
                v-model="batchCat"
                :items="categoryOptions"
                item-title="title"
                item-value="id"
                density="compact"
                hide-details
                clearable
                :disabled="!batchApply.cat_id"
              />
            </div>
            <div class="d-flex align-center ga-2">
              <v-checkbox v-model="batchApply.update_interval" label="Update interval" hide-details density="compact" />
              <v-select
                v-model="batchUpdateInterval"
                :items="updateIntervals"
                item-title="title"
                item-value="value"
                density="compact"
                hide-details
                :disabled="!batchApply.update_interval"
              />
            </div>
            <div class="d-flex align-center ga-2">
              <v-checkbox v-model="batchApply.purge_interval" label="Purge interval" hide-details density="compact" />
              <v-select
                v-model="batchPurgeInterval"
                :items="purgeIntervals"
                item-title="title"
                item-value="value"
                density="compact"
                hide-details
                :disabled="!batchApply.purge_interval"
              />
            </div>
            <div class="d-flex align-center ga-2">
              <v-checkbox v-model="batchApply.auth_login" label="HTTP username" hide-details density="compact" />
              <v-text-field v-model="batchAuthLogin" density="compact" hide-details :disabled="!batchApply.auth_login" />
            </div>
            <div class="d-flex align-center ga-2">
              <v-checkbox v-model="batchApply.auth_pass" label="HTTP password" hide-details density="compact" />
              <v-text-field
                v-model="batchAuthPass"
                type="password"
                density="compact"
                hide-details
                :disabled="!batchApply.auth_pass"
              />
            </div>
            <v-checkbox v-model="batchFlags.include_in_digest" label="Include in digest" hide-details density="compact" />
            <v-checkbox v-model="batchApply.include_in_digest" label="Apply include-in-digest" hide-details density="compact" />
            <v-checkbox v-model="batchFlags.always_display_enclosures" label="Always display enclosures" hide-details density="compact" />
            <v-checkbox v-model="batchApply.always_display_enclosures" label="Apply enclosure setting" hide-details density="compact" />
            <v-checkbox v-model="batchFlags.hide_images" label="Do not embed media" hide-details density="compact" />
            <v-checkbox v-model="batchApply.hide_images" label="Apply media setting" hide-details density="compact" />
            <v-checkbox v-model="batchFlags.cache_images" label="Cache media" hide-details density="compact" />
            <v-checkbox v-model="batchApply.cache_images" label="Apply caching setting" hide-details density="compact" />
            <v-checkbox v-model="batchFlags.mark_unread_on_update" label="Mark updated articles as unread" hide-details density="compact" />
            <v-checkbox v-model="batchApply.mark_unread_on_update" label="Apply unread-on-update setting" hide-details density="compact" />
            <v-btn color="primary" :disabled="batchIds.length === 0" :loading="busy" @click="submitBatchEdit">
              Apply
            </v-btn>
          </v-window-item>

          <!-- Sharing -->
          <v-window-item value="sharing">
            <p class="text-subtitle-2 mb-2">Published articles feed</p>
            <div class="d-flex ga-2 mb-3">
              <v-btn size="small" variant="tonal" @click="loadPublishedUrl">Display URL</v-btn>
              <v-btn size="small" variant="tonal" @click="regenPublishedKey">Regenerate key</v-btn>
              <v-btn size="small" color="error" variant="tonal" @click="clearKeys">Clear all generated URLs</v-btn>
            </div>
            <v-text-field
              v-if="publishedUrl"
              :model-value="publishedUrl.link"
              label="Published feed URL"
              readonly
              density="compact"
            />
            <p v-if="publishedUrl" class="text-caption text-grey">{{ publishedUrl.title }}</p>

            <v-divider class="my-4" />

            <p class="text-subtitle-2 mb-2">Per-feed sharing</p>
            <v-select
              v-model="shareFeedId"
              :items="feedStore.feeds"
              item-title="title"
              item-value="id"
              label="Feed"
              density="compact"
            />
            <div class="d-flex ga-2 mb-3">
              <v-btn size="small" variant="tonal" :disabled="!shareFeedId" @click="loadFeedUrl">Display URL</v-btn>
              <v-btn size="small" variant="tonal" :disabled="!shareFeedId" @click="regenFeedKey">Regenerate key</v-btn>
            </div>
            <v-text-field
              v-if="feedUrl"
              :model-value="feedUrl.link"
              label="Feed URL"
              readonly
              density="compact"
            />
          </v-window-item>

          <!-- Maintenance -->
          <v-window-item value="maintenance">
            <div class="d-flex flex-wrap ga-2 mb-3">
              <v-btn size="small" variant="tonal" @click="loadInactive">Inactive feeds</v-btn>
              <v-btn size="small" variant="tonal" @click="loadErrors">Feeds with errors</v-btn>
              <v-btn size="small" variant="tonal" @click="resetFeedSort">Reset feed order</v-btn>
              <v-btn size="small" variant="tonal" @click="resetCatSort">Reset category order</v-btn>
            </div>

            <v-list v-if="inactiveFeeds.length" density="compact">
              <v-list-item v-for="feed in inactiveFeeds" :key="feed.id">
                <v-list-item-title>{{ feed.title }}</v-list-item-title>
                <v-list-item-subtitle>
                  last article {{ feed.last_article }} · {{ feed.feed_url }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>

            <v-list v-if="feedsWithErrors.length" density="compact">
              <v-list-item v-for="feed in feedsWithErrors" :key="feed.id">
                <v-list-item-title>{{ feed.title }}</v-list-item-title>
                <v-list-item-subtitle>{{ feed.last_error }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-window-item>
        </v-window>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
          {{ message }}
        </v-alert>
      </template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import DOMPurify from 'dompurify';
import { useFeedsStore, type Category } from '../../stores';
import { runDetached } from '../../utils/runDetached';
import api from '../../api/client';
import {
  FEED_PUBLISHED,
  FEED_PURGE_INTERVALS,
  FEED_UPDATE_INTERVALS,
  ICON_FILE_TOO_LARGE,
  ICON_UPLOAD_SUCCESS,
  type FeedDetails,
  type FeedWithError,
  type InactiveFeed,
} from '../../api/legacyEndpoints';

const feedStore = useFeedsStore();
const tab = ref('add');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const newFeedUrl = ref('');
const newFeedTitle = ref('');
const newFeedCategory = ref<number | null>(null);
const selectedFeedId = ref<number | null>(null);
const newCategoryTitle = ref('');

// Feed editing
const editFeedId = ref<number | null>(null);
const editDetails = ref<FeedDetails | null>(null);
const updateIntervals = FEED_UPDATE_INTERVALS;
const purgeIntervals = FEED_PURGE_INTERVALS;

// OPML import / export
const opmlFile = ref<File | File[] | null>(null);
const opmlResult = ref('');
const opmlIncludeSettings = ref(true);

// Feed icon upload
const iconFile = ref<File | File[] | null>(null);
const iconPreviewUrl = ref('');

// Batch subscribe / edit
const batchFeeds = ref('');
const batchCategory = ref<number | null>(null);
const batchLogin = ref('');
const batchPass = ref('');
const batchIds = ref<number[]>([]);
const batchCat = ref<number | null>(null);
const batchUpdateInterval = ref(0);
const batchPurgeInterval = ref(0);
const batchAuthLogin = ref('');
const batchAuthPass = ref('');
const batchFlags = ref({
  include_in_digest: false,
  always_display_enclosures: false,
  hide_images: false,
  cache_images: false,
  mark_unread_on_update: false,
});
const batchApply = ref({
  cat_id: false,
  update_interval: false,
  purge_interval: false,
  auth_login: false,
  auth_pass: false,
  include_in_digest: false,
  always_display_enclosures: false,
  hide_images: false,
  cache_images: false,
  mark_unread_on_update: false,
});

// Sharing
const publishedUrl = ref<{ title: string; link: string } | null>(null);
const feedUrl = ref<{ title: string; link: string } | null>(null);
const shareFeedId = ref<number | null>(null);

// Maintenance
const inactiveFeeds = ref<InactiveFeed[]>([]);
const feedsWithErrors = ref<FeedWithError[]>([]);

/** The import log is an HTML fragment; sanitize it before rendering. */
const sanitizedOpmlResult = computed(() => DOMPurify.sanitize(opmlResult.value));

const categoryOptions = computed(() => feedStore.categories);

const notify = (text: string, type: 'success' | 'error' = 'success') => {
  message.value = text;
  messageType.value = type;
};

const addFeed = async () => {
  busy.value = true;
  const ok = await feedStore.addFeed(newFeedUrl.value, newFeedCategory.value ?? 0);
  busy.value = false;
  if (ok) {
    notify('Feed added');
    newFeedUrl.value = '';
    newFeedTitle.value = '';
  } else {
    notify(feedStore.error ?? 'Failed to add feed', 'error');
  }
};

const purge = async () => {
  if (!selectedFeedId.value) return;
  busy.value = true;
  const ok = await feedStore.purgeFeed();
  busy.value = false;
  notify(
    ok ? 'Feed purged' : feedStore.error ?? 'Failed to purge feed',
    ok ? 'success' : 'error'
  );
};

const remove = async () => {
  if (!selectedFeedId.value) return;
  busy.value = true;
  const ok = await feedStore.removeFeed(selectedFeedId.value);
  busy.value = false;
  if (ok) {
    notify('Feed removed');
    selectedFeedId.value = null;
  } else {
    notify(feedStore.error ?? 'Failed to remove feed', 'error');
  }
};

const createCategory = async () => {
  busy.value = true;
  const ok = await feedStore.createCategory(newCategoryTitle.value);
  busy.value = false;
  if (ok) {
    notify('Category created');
    newCategoryTitle.value = '';
  } else {
    notify(feedStore.error ?? 'Failed to create category', 'error');
  }
};

const loadFeedDetails = async (feedId: number | null) => {
  editDetails.value = null;
  iconPreviewUrl.value = '';
  iconFile.value = null;
  if (feedId === null) return;
  busy.value = true;
  editDetails.value = await feedStore.loadFeedDetails(feedId);
  busy.value = false;
  if (!editDetails.value) {
    notify(feedStore.error ?? 'Failed to load feed', 'error');
  } else {
    // public.php?op=feed_icon streams the stored icon; a timestamp makes the
    // browser re-fetch it after an upload or reset.
    iconPreviewUrl.value = `/public.php?op=feed_icon&id=${feedId}&ts=${Date.now()}`;
  }
};

const uploadIcon = async () => {
  if (!editDetails.value) return;
  const file = Array.isArray(iconFile.value) ? iconFile.value[0] : iconFile.value;
  if (!file) return;
  busy.value = true;
  try {
    const response = await api.uploadFeedIcon(editDetails.value.id, file);
    const result = response.status === 0 ? response.content : null;
    if (result?.rc === ICON_UPLOAD_SUCCESS) {
      iconPreviewUrl.value = result.iconUrl;
      iconFile.value = null;
      notify('Icon updated');
    } else if (result?.rc === ICON_FILE_TOO_LARGE) {
      notify('Icon file is too large', 'error');
    } else {
      notify(response.error ?? 'Failed to upload icon', 'error');
    }
  } finally {
    busy.value = false;
  }
};

const resetIcon = async () => {
  if (!editDetails.value) return;
  busy.value = true;
  try {
    const response = await api.removeFeedIcon(editDetails.value.id);
    if (response.status === 0) {
      iconPreviewUrl.value = `/public.php?op=feed_icon&id=${editDetails.value.id}&ts=${Date.now()}`;
      notify('Icon reset');
    } else {
      notify(response.error ?? 'Failed to reset icon', 'error');
    }
  } finally {
    busy.value = false;
  }
};

const saveFeedChanges = async () => {
  if (!editDetails.value) return;
  const details = editDetails.value;
  busy.value = true;
  // saveFeed re-reads the record and merges, so passing only the edited fields
  // (including the advanced ones) preserves everything else.
  const ok = await feedStore.saveFeed(details.id, {
    title: details.title,
    feed_url: details.feed_url,
    site_url: details.site_url,
    cat_id: details.cat_id,
    update_interval: details.update_interval,
    purge_interval: details.purge_interval,
    auth_login: details.auth_login,
    auth_pass: details.auth_pass,
    private: details.private,
    cache_images: details.cache_images,
    hide_images: details.hide_images,
    mark_unread_on_update: details.mark_unread_on_update,
    include_in_digest: details.include_in_digest,
    always_display_enclosures: details.always_display_enclosures,
  });
  busy.value = false;
  notify(ok ? 'Feed saved' : feedStore.error ?? 'Failed to save feed', ok ? 'success' : 'error');
};

const renameCategory = async (cat: Category) => {
  await feedStore.renameCategory(cat.id, cat.title);
};

const deleteCategory = async (cat: Category) => {
  busy.value = true;
  const ok = await feedStore.deleteCategory(cat.id);
  busy.value = false;
  if (!ok) notify(feedStore.error ?? 'Failed to delete category', 'error');
};

const importOpmlFile = async () => {
  // v-file-input yields an array when `multiple` is set; this one is single.
  const file = Array.isArray(opmlFile.value) ? opmlFile.value[0] : opmlFile.value;
  if (!file) return;
  busy.value = true;
  try {
    const response = await api.importOpml(file);
    if (response.status === 0) {
      opmlResult.value = response.content;
      notify('OPML imported');
      await feedStore.loadFeeds();
    } else {
      notify(response.error ?? 'Failed to import OPML', 'error');
    }
  } finally {
    busy.value = false;
  }
};

const exportOpml = () => {
  // The export is a GET that sets Content-Disposition; navigate so the browser
  // handles the download instead of fetch returning the XML as text.
  window.open(api.opmlExportUrl(opmlIncludeSettings.value), '_blank', 'noreferrer');
};

const submitBatchSubscribe = async () => {
  busy.value = true;
  try {
    const response = await api.batchAddFeeds(
      batchFeeds.value,
      batchCategory.value ?? 0,
      batchLogin.value,
      batchPass.value
    );
    if (response.status === 0) {
      batchFeeds.value = '';
      notify('Feeds subscribed');
      await feedStore.loadFeeds();
    } else {
      notify(response.error ?? 'Failed to subscribe feeds', 'error');
    }
  } finally {
    busy.value = false;
  }
};

const submitBatchEdit = async () => {
  const fields: Record<string, string> = {};

  if (batchApply.value.cat_id) fields.cat_id = String(batchCat.value ?? 0);
  if (batchApply.value.update_interval) fields.update_interval = String(batchUpdateInterval.value);
  if (batchApply.value.purge_interval) fields.purge_interval = String(batchPurgeInterval.value);
  if (batchApply.value.auth_login) fields.auth_login = batchAuthLogin.value;
  if (batchApply.value.auth_pass) fields.auth_pass = batchAuthPass.value;

  for (const [name, checked] of Object.entries(batchFlags.value)) {
    if (batchApply.value[name as keyof typeof batchApply.value]) {
      fields[name] = checked ? 'on' : '';
    }
  }

  if (Object.keys(fields).length === 0) {
    notify('Select at least one field to apply', 'error');
    return;
  }

  busy.value = true;
  try {
    const response = await api.batchEditFeeds(batchIds.value, fields);
    if (response.status === 0) {
      notify('Feeds updated');
      await feedStore.loadFeeds();
    } else {
      notify(response.error ?? 'Failed to update feeds', 'error');
    }
  } finally {
    busy.value = false;
  }
};

const loadPublishedUrl = async () => {
  const response = await api.getSharedUrl(FEED_PUBLISHED, false);
  if (response.status === 0) publishedUrl.value = response.content;
  else notify(response.error ?? 'Failed to load the published feed URL', 'error');
};

const regenPublishedKey = async () => {
  const response = await api.regenFeedKey(FEED_PUBLISHED, false);
  if (response.status === 0) await loadPublishedUrl();
  else notify(response.error ?? 'Failed to regenerate the key', 'error');
};

const loadFeedUrl = async () => {
  if (shareFeedId.value === null) return;
  const response = await api.getSharedUrl(shareFeedId.value, false);
  if (response.status === 0) feedUrl.value = response.content;
  else notify(response.error ?? 'Failed to load the feed URL', 'error');
};

const regenFeedKey = async () => {
  if (shareFeedId.value === null) return;
  const response = await api.regenFeedKey(shareFeedId.value, false);
  if (response.status === 0) await loadFeedUrl();
  else notify(response.error ?? 'Failed to regenerate the key', 'error');
};

const clearKeys = async () => {
  const response = await api.clearFeedKeys();
  if (response.status === 0) {
    publishedUrl.value = null;
    feedUrl.value = null;
    notify('Generated URLs cleared');
  } else {
    notify(response.error ?? 'Failed to clear generated URLs', 'error');
  }
};

const loadInactive = async () => {
  const response = await api.getInactiveFeeds();
  if (response.status === 0) inactiveFeeds.value = response.content;
  else notify(response.error ?? 'Failed to load inactive feeds', 'error');
};

const loadErrors = async () => {
  const response = await api.getFeedsWithErrors();
  if (response.status === 0) feedsWithErrors.value = response.content;
  else notify(response.error ?? 'Failed to load feeds with errors', 'error');
};

const resetFeedSort = async () => {
  const response = await api.resetFeedOrder();
  if (response.status === 0) {
    notify('Feed order reset');
    await feedStore.loadFeeds();
  } else {
    notify(response.error ?? 'Failed to reset feed order', 'error');
  }
};

const resetCatSort = async () => {
  const response = await api.resetCategoryOrder();
  if (response.status === 0) {
    notify('Category order reset');
    await feedStore.loadFeeds();
  } else {
    notify(response.error ?? 'Failed to reset category order', 'error');
  }
};
</script>
