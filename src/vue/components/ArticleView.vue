<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Article } from '@/types';
import DOMPurify from 'dompurify';
import { useHeadlinesStore } from '@/stores';

const props = defineProps<{
  article: Article;
}>();

const emit = defineEmits<{
  close: [];
  'mark-relative': [articleId: number, above: boolean];
}>();

const headlinesStore = useHeadlinesStore();
const noteDraft = ref(props.article.note ?? '');
const tagDraft = ref<string[]>([...(props.article.tags ?? [])]);
const tagSuggestions = ref<string[]>([]);
const saving = ref(false);

/** Attachments the backend reports for this article. */
const attachments = computed(() => props.article.enclosures ?? []);

// App.vue reuses this component when the selected article changes (no :key),
// so the drafts must follow the new article. Without this, the previous
// article's note or tags stay on screen and would be saved onto the new one.
watch(
  () => props.article.id,
  () => {
    noteDraft.value = props.article.note ?? '';
    tagDraft.value = [...(props.article.tags ?? [])];
    tagSuggestions.value = [];
  }
);

const closeArticle = () => {
  emit('close');
};

/** Persist the current tag list when the combobox changes. */
const saveTags = async (value: unknown) => {
  const tags = (Array.isArray(value) ? value : []).map((t) => String(t).trim()).filter(Boolean);
  try {
    await headlinesStore.updateTags(props.article.id, tags);
  } catch {
    // Keep the draft as typed; the store logs the failure.
  }
};

/** Fetch autocomplete suggestions as the user types. */
const onTagSearch = async (query: string) => {
  const search = query.trim();
  if (search.length < 1) {
    tagSuggestions.value = [];
    return;
  }
  tagSuggestions.value = await headlinesStore.suggestTags(search);
};

const bumpScore = async (delta: number) => {
  const next = delta === 0 ? 0 : (props.article.score ?? 0) + delta;
  await headlinesStore.setScore(props.article.id, next);
};

const saveNote = async () => {
  if (props.article.note === noteDraft.value) return;
  saving.value = true;
  try {
    await headlinesStore.updateNote(props.article.id, noteDraft.value);
  } finally {
    saving.value = false;
  }
};

// Sanitize HTML content client-side using DOMPurify to prevent XSS
// Note: Content is also sanitized server-side via Sanitizer::sanitize()
// in API.php and Feeds.php, but we add client-side sanitization as
// an additional security layer.
const sanitizedContent = computed(() => {
  if (!props.article.content) return '';
  return DOMPurify.sanitize(props.article.content, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class']
  });
});
</script>

<template>
  <div class="article-view">
    <article class="article-content">
      <header class="article-header">
        <div class="article-header-inner">
          <v-btn icon="mdi-close" variant="text" @click="closeArticle" class="mr-2" />
          <h1>{{ article.title }}</h1>
        </div>
        <div class="article-meta">
          <span class="feed">{{ article.feed_title }}</span>
          <span v-if="article.author" class="author">by {{ article.author }}</span>
          <time :datetime="article.updated">{{ article.updated }}</time>
        </div>
      </header>
      
      <!-- Content is sanitized client-side using DOMPurify for XSS prevention -->
      <div class="article-body" v-html="sanitizedContent"></div>

      <!-- Attachments (enclosures): playable audio/video inline, others linked. -->
      <div v-if="attachments.length > 0" class="article-attachments">
        <h3>Attachments</h3>
        <div v-for="(enc, index) in attachments" :key="index" class="attachment">
          <audio v-if="enc.content_type.startsWith('audio/')" :src="enc.content_url" controls />
          <video v-else-if="enc.content_type.startsWith('video/')" :src="enc.content_url" controls />
          <a v-else :href="enc.content_url" target="_blank" rel="noopener noreferrer">
            {{ enc.title || enc.content_url }}
          </a>
        </div>
      </div>
      
      <!-- Tags and score (parity with the Dojo article header) -->
      <v-divider class="my-3" />
      <div class="article-tags">
        <v-combobox
          v-model="tagDraft"
          :items="tagSuggestions"
          label="Tags"
          chips
          multiple
          closable-chips
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="saveTags"
          @update:search="onTagSearch"
        />
        <div class="score-row">
          <span class="score-label">Score: {{ article.score ?? 0 }}</span>
          <v-btn size="x-small" variant="text" @click="bumpScore(-100)">-100</v-btn>
          <v-btn size="x-small" variant="text" @click="bumpScore(0)">0</v-btn>
          <v-btn size="x-small" variant="text" @click="bumpScore(100)">+100</v-btn>
        </div>
      </div>

      <!-- Note editor (Phase 3) -->
      <v-divider class="my-3" />
      <v-textarea
        v-model="noteDraft"
        label="Note (double-click to edit)"
        density="compact"
        rows="2"
        variant="outlined"
        @blur="saveNote"
      />
      <v-btn
        color="primary"
        size="small"
        variant="flat"
        :loading="saving"
        @click="saveNote"
      >
        Save note
      </v-btn>

      <!-- Article metadata footer -->
      <footer class="article-footer">
        <a :href="article.link" target="_blank" rel="noopener noreferrer">
          View Original
        </a>
        <div class="relative-actions">
          <v-btn size="x-small" variant="text" @click="emit('mark-relative', article.id, true)">
            Mark above as read
          </v-btn>
          <v-btn size="x-small" variant="text" @click="emit('mark-relative', article.id, false)">
            Mark below as read
          </v-btn>
        </div>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.article-view {
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  height: 100%;
}

.article-header {
  padding: 1rem;
  border-bottom: 1px solid #eee;
}

.article-header h1 {
  margin: 0 0 0.5rem 0;
  font-size: 1.5rem;
}

.article-meta {
  display: flex;
  gap: 1rem;
  color: #666;
  font-size: 0.875rem;
}

.article-body {
  padding: 1rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.article-attachments {
  padding: 0 1rem;
}

.article-attachments h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
}

.attachment {
  margin-bottom: 0.5rem;
}

.attachment audio,
.attachment video {
  max-width: 100%;
}

.article-tags {
  padding: 0 1rem;
}

.score-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.25rem;
  font-size: 0.8125rem;
  color: #666;
}

.score-label {
  margin-right: 0.5rem;
}

.article-footer {
  padding: 1rem;
  border-top: 1px solid #eee;
}

.relative-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.article-footer a {
  color: #1976d2;
  text-decoration: none;
}

.article-footer a:hover {
  text-decoration: underline;
}
</style>
