<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="closeDialog"
  >
    <v-card>
      <v-card-title>Manage Feeds</v-card-title>
      <v-card-text>
        <v-tabs v-model="tab" color="primary">
          <v-tab value="add">Add Feed</v-tab>
          <v-tab value="remove">Remove / Purge</v-tab>
          <v-tab value="categories">Categories</v-tab>
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
        </v-window>

        <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-4">
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
import { ref, computed } from 'vue';
import { useFeedsStore, type Category } from '../../stores';

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

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

const categoryOptions = computed(() => feedStore.categories);

const notify = (text: string, type: 'success' | 'error' = 'success') => {
  message.value = text;
  messageType.value = type;
};

const addFeed = async () => {
  busy.value = true;
  const ok = await feedStore.addFeed(newFeedUrl.value, newFeedCategory.value ?? 0, newFeedTitle.value || undefined);
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
  const ok = await feedStore.purgeFeed(selectedFeedId.value);
  busy.value = false;
  notify(ok ? 'Feed purged' : 'Failed to purge feed', ok ? 'success' : 'error');
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

const renameCategory = async (cat: Category) => {
  await feedStore.renameCategory(cat.id, cat.title);
};

const deleteCategory = async (cat: Category) => {
  busy.value = true;
  const ok = await feedStore.deleteCategory(cat.id);
  busy.value = false;
  if (!ok) notify(feedStore.error ?? 'Failed to delete category', 'error');
};

// Use emit instead of $emit for v-model binding
function closeDialog() {
  emit('update:modelValue', false);
}
</script>

