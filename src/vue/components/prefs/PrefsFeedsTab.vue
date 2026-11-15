<template>
  <div>
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">Feed list</v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 mb-3 flex-wrap">
          <v-text-field
            v-model="newFeedUrl"
            label="Subscribe to feed (URL)"
            density="compact"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-rss"
            class="flex-grow-1"
          />
          <v-btn color="primary" :loading="busy" :disabled="!newFeedUrl" @click="subscribe">Subscribe</v-btn>
          <v-btn variant="text" prepend-icon="mdi-folder-plus" @click="addCategory">Add category</v-btn>
        </div>

        <!-- Draggable tree: reorders feeds within a category and moves feeds
             between categories. Order is persisted with savefeedorder. -->
        <v-list density="compact">
          <template v-for="cat in tree" :key="cat.id">
            <v-list-item v-if="cat.type === 'category'">
              <template #prepend>
                <v-icon>mdi-folder</v-icon>
              </template>
              <v-text-field
                v-model="cat.name"
                density="compact"
                variant="plain"
                hide-details
                @change="renameCategory(cat)"
              />
              <template #append>
                <v-btn
                  icon="mdi-arrow-up"
                  size="small"
                  variant="text"
                  :disabled="isFirstCategory(cat)"
                  @click="moveCategory(cat, -1)"
                />
                <v-btn
                  icon="mdi-arrow-down"
                  size="small"
                  variant="text"
                  :disabled="isLastCategory(cat)"
                  @click="moveCategory(cat, 1)"
                />
                <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeCategory(cat)" />
              </template>
            </v-list-item>

            <v-list-item
              v-for="feed in cat.children"
              :key="feed.id"
              class="feed-row"
            >
              <template #prepend>
                <v-icon size="small">mdi-rss</v-icon>
              </template>
              <v-list-item-title>{{ feed.name }}</v-list-item-title>
              <template #append>
                <v-btn
                  icon="mdi-arrow-up"
                  size="small"
                  variant="text"
                  :disabled="isFirstFeed(cat, feed)"
                  @click="moveFeed(cat, feed, -1)"
                />
                <v-btn
                  icon="mdi-arrow-down"
                  size="small"
                  variant="text"
                  :disabled="isLastFeed(cat, feed)"
                  @click="moveFeed(cat, feed, 1)"
                />
                <v-btn icon="mdi-pencil" size="small" variant="text" @click="editFeed(feed)" />
                <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="removeFeed(feed)" />
              </template>
            </v-list-item>
          </template>

          <v-list-item v-if="tree.length === 0">
            <v-list-item-title class="text-grey">No feeds yet.</v-list-item-title>
          </v-list-item>
        </v-list>

        <v-btn size="small" variant="text" prepend-icon="mdi-sort" @click="resetSortOrder">
          Reset sort order
        </v-btn>
      </v-card-text>
    </v-card>

    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">OPML</v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 align-center flex-wrap">
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-download" @click="exportOpml">
            Export OPML
          </v-btn>
          <v-file-input
            v-model="opmlFile"
            label="OPML file"
            density="compact"
            variant="outlined"
            hide-details
            accept=".opml,.xml"
            class="opml-input"
          />
          <v-btn :loading="busy" :disabled="!opmlFile" @click="importOpmlFile">Import OPML</v-btn>
        </div>
        <v-alert v-if="opmlResult" type="info" variant="tonal" density="compact" class="mt-3">
          <div v-html="opmlResult" />
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- Feed editor dialog -->
    <FeedEditorDialog v-model="feedDialog" :feed-id="editingFeedId" />

    <PluginPrefsSection tab-id="prefFeeds" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import { runDetached } from '../../utils/runDetached';
import { opmlExportUrl, CATEGORY_SPECIAL, CATEGORY_LABELS, type RawTreeNode } from '../../api/legacyEndpoints';
import { usePrefsNotifier } from './notify';
import PluginPrefsSection from './PluginPrefsSection.vue';
import FeedEditorDialog from '../dialogs/FeedEditorDialog.vue';

const notify = usePrefsNotifier();
const busy = ref(false);
const tree = ref<RawTreeNode[]>([]);
const newFeedUrl = ref('');
const opmlFile = ref<File | null>(null);
const opmlResult = ref('');
const feedDialog = ref(false);
const editingFeedId = ref<number>(0);

async function load() {
  const response = await api.getRawFeedTree();
  if (response.status === 0) {
    // Only user categories are reorderable; the Special (-1) and Labels (-2)
    // roots are rendered elsewhere and hold no user-ordered feeds.
    tree.value = response.content.filter(
      node => node.type === 'category' && node.bare_id !== CATEGORY_SPECIAL && node.bare_id !== CATEGORY_LABELS
    );
  } else {
    notify(response.error ?? 'Failed to load feeds', 'error');
  }
}

async function subscribe() {
  busy.value = true;
  const response = await api.addFeed(newFeedUrl.value);
  busy.value = false;
  if (response.status === 0) {
    notify('Feed subscribed', 'success');
    newFeedUrl.value = '';
    await load();
  } else {
    notify(response.error ?? 'Failed to subscribe', 'error');
  }
}

async function addCategory() {
  const title = window.prompt('Category name');
  if (!title) return;
  const response = await api.createCategory(title);
  if (response.status === 0) {
    notify('Category created', 'success');
    await load();
  } else {
    notify(response.error ?? 'Failed to create category', 'error');
  }
}

async function renameCategory(cat: RawTreeNode) {
  const response = await api.renameCategory(cat.bare_id, cat.name);
  if (response.status !== 0) notify(response.error ?? 'Failed to rename category', 'error');
}

async function removeCategory(cat: RawTreeNode) {
  const response = await api.deleteCategory(cat.bare_id);
  if (response.status === 0) {
    notify('Category removed', 'success');
    await load();
  } else {
    notify(response.error ?? 'Failed to remove category', 'error');
  }
}

async function removeFeed(feed: RawTreeNode) {
  const response = await api.deleteFeed(feed.bare_id);
  if (response.status === 0) {
    notify('Feed removed', 'success');
    await load();
  } else {
    notify(response.error ?? 'Failed to remove feed', 'error');
  }
}

function editFeed(feed: RawTreeNode) {
  editingFeedId.value = feed.bare_id;
  feedDialog.value = true;
}

const isFirstCategory = (cat: RawTreeNode) => tree.value.indexOf(cat) === 0;
const isLastCategory = (cat: RawTreeNode) => tree.value.indexOf(cat) === tree.value.length - 1;
const isFirstFeed = (cat: RawTreeNode, feed: RawTreeNode) => cat.children.indexOf(feed) === 0;
const isLastFeed = (cat: RawTreeNode, feed: RawTreeNode) => cat.children.indexOf(feed) === cat.children.length - 1;

/** Swap a category with its neighbour and persist the new order. */
function moveCategory(cat: RawTreeNode, delta: number) {
  const index = tree.value.indexOf(cat);
  const target = index + delta;
  if (target < 0 || target >= tree.value.length) return;
  const [moved] = tree.value.splice(index, 1);
  tree.value.splice(target, 0, moved);
  runDetached(persistOrder(), 'save feed order');
}

/** Swap a feed with its neighbour within its category and persist. */
function moveFeed(cat: RawTreeNode, feed: RawTreeNode, delta: number) {
  const index = cat.children.indexOf(feed);
  const target = index + delta;
  if (target < 0 || target >= cat.children.length) return;
  const [moved] = cat.children.splice(index, 1);
  cat.children.splice(target, 0, moved);
  runDetached(persistOrder(), 'save feed order');
}

async function persistOrder() {
  const response = await api.saveFeedOrder(tree.value);
  if (response.status !== 0) notify(response.error ?? 'Failed to save order', 'error');
}

async function resetSortOrder() {
  const [feeds, cats] = await Promise.all([api.resetFeedSortOrder(), api.resetCatSortOrder()]);
  if (feeds.status === 0 && cats.status === 0) {
    notify('Sort order reset', 'success');
    await load();
  } else {
    notify('Failed to reset sort order', 'error');
  }
}

function exportOpml() {
  window.open(opmlExportUrl({ hidePrivate: true }), '_blank');
}

async function importOpmlFile() {
  if (!opmlFile.value) return;
  busy.value = true;
  const response = await api.importOpml(opmlFile.value);
  busy.value = false;
  if (response.status === 0) {
    opmlResult.value = response.content;
    await load();
  } else {
    notify(response.error ?? 'OPML import failed', 'error');
  }
}

onMounted(load);
</script>

<style scoped>
.feed-row {
  padding-left: 2rem;
}

.opml-input {
  max-width: 320px;
}
</style>
