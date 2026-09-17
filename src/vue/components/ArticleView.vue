<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Article } from '@/types';
import DOMPurify from 'dompurify';
import { useHeadlinesStore } from '@/stores';

const props = defineProps<{
  article: Article;
}>();

const emit = defineEmits<{
  close: [];
}>();

const headlinesStore = useHeadlinesStore();
const noteDraft = ref(props.article.note ?? '');
const saving = ref(false);

const closeArticle = () => {
  emit('close');
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
          <span class="feed">{{ article.feed_title || article.feed }}</span>
          <span v-if="article.author" class="author">by {{ article.author }}</span>
          <time :datetime="article.updated">{{ article.updated }}</time>
        </div>
      </header>
      
      <!-- Content is sanitized client-side using DOMPurify for XSS prevention -->
      <div class="article-body" v-html="sanitizedContent"></div>
      
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

.article-footer {
  padding: 1rem;
  border-top: 1px solid #eee;
}

.article-footer a {
  color: #1976d2;
  text-decoration: none;
}

.article-footer a:hover {
  text-decoration: underline;
}
</style>
