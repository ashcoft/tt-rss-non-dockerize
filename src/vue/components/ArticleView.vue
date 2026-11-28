<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { Article } from '@/types';
import DOMPurify from 'dompurify';
import { useHeadlinesStore } from '@/stores';
import api from '@/api/client';
import { pluginIcon } from '../utils/pluginIcons';
import { HOOKS, runPluginHook } from '../utils/pluginHost';
import ShareDialog from './dialogs/ShareDialog.vue';

const props = defineProps<{
  article: Article;
  /** The current feed's site URL, for the feed pill link. */
  feedSiteUrl?: string;
  /** Base URL of public.php, which streams feed icons. */
  iconsUrl?: string;
}>();

const emit = defineEmits<{
  close: [];
  'mark-relative': [articleId: number, above: boolean];
}>();

const headlinesStore = useHeadlinesStore();
const rootEl = ref<HTMLElement | null>(null);
const iconFailed = ref(false);
const pluginDialog = ref<{ title: string; html: string } | null>(null);

/** Feed favicon streamed by public.php; empty when icons are unavailable. */
const feedIconUrl = computed(() =>
  props.iconsUrl ? `${props.iconsUrl}?op=feed_icon&id=${props.article.feed_id}` : ''
);
const showFeedIcon = computed(
  () => props.article.feed_has_icon !== false && feedIconUrl.value !== '' && !iconFailed.value
);

/** af_readability renders its own button; the app provides one consistently. */
const isReadabilityButton = (button: { plugin: string; method: string }): boolean =>
  button.plugin.toLowerCase() === 'af_readability' && button.method === 'embed';

const articlePluginButtons = computed(() =>
  (props.article.pluginButtons ?? []).filter(button => !isReadabilityButton(button))
);

const readabilityBusy = ref(false);
const toggleReadability = async () => {
  readabilityBusy.value = true;
  try {
    await headlinesStore.toggleFullText(props.article.id);
  } catch (err) {
    pluginDialog.value = {
      title: 'Readability',
      html:
        `<p>${err instanceof Error ? err.message : 'Could not fetch the full article text.'}</p>` +
        '<p>Enable the <code>af_readability</code> plugin to use this feature.</p>',
    };
  } finally {
    readabilityBusy.value = false;
  }
};

// HOOK_ARTICLE_RENDERED receives the rendered `.post` node, as in the Dojo client.
onMounted(() => runPluginHook(HOOKS.ARTICLE_RENDERED, rootEl.value));
watch(
  () => props.article?.id,
  async () => {
    await nextTick();
    runPluginHook(HOOKS.ARTICLE_RENDERED, rootEl.value);
  }
);

// Plugin article buttons run their handler through PluginHandler and render the
// returned HTML fragment in a dialog. Icons are mapped to MDI in pluginIcons.
const pluginBusy = ref(false);
const shareDialogOpen = ref(false);
const shareArticleId = ref(props.article.id);
const zoomOpen = ref(false);

/** Sanitize the plugin's dialog body before rendering it. */
const sanitizedPluginHtml = computed(() =>
  pluginDialog.value ? DOMPurify.sanitize(pluginDialog.value.html) : ''
);

async function runPluginButton(button: { plugin: string; method: string; title: string }): Promise<void> {
  // The share plugin's legacy JS owned its dialog; the Vue app does the same.
  if (button.plugin.toLowerCase() === 'share' && button.method === 'shareArticle') {
    shareArticleId.value = props.article.id;
    shareDialogOpen.value = true;
    return;
  }

  // af_readability's legacy button swapped the body in place; its embed method
  // returns JSON, not an HTML dialog fragment.
  if (button.plugin.toLowerCase() === 'af_readability' && button.method === 'embed') {
    pluginBusy.value = true;
    try {
      await headlinesStore.toggleFullText(props.article.id);
    } catch (err) {
      pluginDialog.value = {
        title: button.title,
        html: `<p>${err instanceof Error ? err.message : 'Could not fetch full text.'}</p>`,
      };
    } finally {
      pluginBusy.value = false;
    }
    return;
  }

  pluginBusy.value = true;
  try {
    const response = await api.invokePluginHandler(button.plugin, button.method, {
      id: props.article.id,
    });
    if (response.status === 0) {
      pluginDialog.value = { title: button.title, html: response.content };
    } else {
      pluginDialog.value = {
        title: button.title,
        html: `<p>${response.error ?? 'Plugin handler failed.'}</p>`,
      };
    }
  } finally {
    pluginBusy.value = false;
  }
}
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

/** Open the article on its original site. */
const openOriginal = () => {
  window.open(props.article.link, '_blank', 'noopener,noreferrer');
};

/** Print just the article body in a clean window, not the app chrome. */
const printArticle = () => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const title = props.article.title.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char] ?? char));
  const meta = [props.article.feed_title, props.article.updated_long || props.article.updated]
    .filter(Boolean)
    .join(' · ');

  printWindow.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>` +
      '<style>body{font-family:system-ui,sans-serif;line-height:1.55;margin:2rem auto;max-width:46rem;padding:0 1rem;color:#222}' +
      'img{max-width:100%;height:auto}h1{font-size:1.6rem;line-height:1.25}.meta{color:#666;font-size:.875rem;margin-bottom:1.5rem}</style>' +
      `</head><body><h1>${title}</h1><p class="meta">${meta}</p>${sanitizedContent.value}</body></html>`
  );
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

/** Clicking the body/image opens the original site, but links and text
 * selections keep their normal behaviour. */
const onBodyClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (target.closest('a')) return;
  if (window.getSelection()?.toString()) return;
  openOriginal();
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
  <div ref="rootEl" class="article-view post" :data-article-id="article.id">
    <article class="article-content content">
      <header class="article-header header">
        <div class="article-header-inner">
          <v-btn icon="mdi-close" variant="text" @click="closeArticle" class="mr-2" />
          <h1 class="title">
            <a :href="article.link" target="_blank" rel="noopener noreferrer">
              {{ article.title }}
            </a>
          </h1>
          <!-- Plugin article buttons (HOOK_ARTICLE_BUTTON), dispatched through
               the Vue plugin registry. -->
          <v-btn
            v-for="button in articlePluginButtons"
            :key="`${button.plugin}.${button.method}`"
            icon
            variant="text"
            size="small"
            :title="button.title"
            @click="runPluginButton(button)"
          >
            <v-icon>{{ pluginIcon(button.icon) }}</v-icon>
          </v-btn>
          <v-btn
            icon="mdi-text-box-outline"
            variant="text"
            size="small"
            title="Toggle full article text (readability)"
            :loading="readabilityBusy"
            @click="toggleReadability"
          />
          <v-btn icon="mdi-magnify-plus-outline" variant="text" size="small" title="Zoom article" @click="zoomOpen = true" />
          <v-btn icon="mdi-printer-outline" variant="text" size="small" title="Print article" @click="printArticle" />
        </div>
        <div class="article-meta row">
          <a
            v-if="feedSiteUrl"
            class="feed"
            :href="feedSiteUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              v-if="showFeedIcon"
              :src="feedIconUrl"
              class="feed-icon"
              width="16"
              height="16"
              alt=""
              @error="iconFailed = true"
            />
            <v-icon v-else size="14">mdi-rss</v-icon>
            <span>{{ article.feed_title }}</span>
          </a>
          <span v-else class="feed">
            <img
              v-if="showFeedIcon"
              :src="feedIconUrl"
              class="feed-icon"
              width="16"
              height="16"
              alt=""
              @error="iconFailed = true"
            />
            <v-icon v-else size="14">mdi-rss</v-icon>
            <span>{{ article.feed_title }}</span>
          </span>
          <span v-if="article.author" class="author">by {{ article.author }}</span>
          <!-- The legacy header shows the long date here, not the short one. -->
          <time :datetime="article.updated">{{ article.updated_long || article.updated }}</time>
          <!-- Comments link, mirroring the legacy article header. -->
          <a
            v-if="article.comments_count > 0 || article.comments_link"
            class="comments"
            :href="article.comments_link || article.link"
            target="_blank"
            rel="noopener noreferrer"
          >
            ({{ article.comments_count }} {{ article.comments_count === 1 ? 'comment' : 'comments' }})
          </a>
        </div>
      </header>

      <!-- Content is sanitized client-side using DOMPurify for XSS prevention -->
      <div class="article-body content" @click="onBodyClick">
        <div class="content-inner" v-html="sanitizedContent"></div>
      </div>

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

      <!-- Score, note and tags, compacted to the legacy post footer. -->
      <div class="article-tools">
        <div class="score-row">
          <span class="score-label">Score: {{ article.score ?? 0 }}</span>
          <v-btn size="x-small" variant="text" @click="bumpScore(-100)">-100</v-btn>
          <v-btn size="x-small" variant="text" @click="bumpScore(0)">0</v-btn>
          <v-btn size="x-small" variant="text" @click="bumpScore(100)">+100</v-btn>
        </div>
        <div class="note-row">
          <v-textarea
            v-model="noteDraft"
            placeholder="Note"
            density="compact"
            rows="1"
            auto-grow
            variant="plain"
            hide-details
            @blur="saveNote"
          />
          <v-btn
            size="x-small"
            variant="text"
            :loading="saving"
            @click="saveNote"
          >
            Save note
          </v-btn>
        </div>
        <div class="article-tags-row">
          <v-icon size="16">mdi-tag-outline</v-icon>
          <v-combobox
            v-model="tagDraft"
            :items="tagSuggestions"
            chips
            multiple
            closable-chips
            density="compact"
            variant="plain"
            hide-details
            class="article-tags-input"
            @update:model-value="saveTags"
            @update:search="onTagSearch"
          />
        </div>
      </div>

      <!-- Article metadata footer -->
      <footer class="article-footer row">
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

    <!-- Zoom: a readable full-screen view of the sanitized article body. -->
    <v-dialog v-model="zoomOpen" fullscreen scrollable>
      <v-card class="zoom-card">
        <v-toolbar density="compact" color="surface">
          <v-toolbar-title>{{ article.title }}</v-toolbar-title>
          <v-spacer />
          <v-btn icon="mdi-printer-outline" variant="text" title="Print article" @click="printArticle" />
          <v-btn icon="mdi-close" variant="text" title="Close" @click="zoomOpen = false" />
        </v-toolbar>
        <v-card-text class="zoom-content">
          <h1>{{ article.title }}</h1>
          <div class="zoom-meta">
            <span>{{ article.feed_title }}</span>
            <time>{{ article.updated_long || article.updated }}</time>
          </div>
          <div class="content-inner" v-html="sanitizedContent"></div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Share plugin: the legacy JS drove this dialog, so the Vue app owns it. -->
    <ShareDialog v-model="shareDialogOpen" :article-id="shareArticleId" />

    <!-- Plugin handler output (a dialog body from the backend). -->
    <v-dialog
      :model-value="pluginDialog !== null"
      max-width="640"
      @update:model-value="pluginDialog = null"
    >
      <v-card>
        <v-card-title>{{ pluginDialog?.title || 'Plugin' }}</v-card-title>
        <v-card-text>
          <div class="plugin-dialog-body" v-html="sanitizedPluginHtml"></div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="pluginDialog = null">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.article-view {
  height: 100%;
  background: rgb(var(--v-theme-surface));
}

.article-header {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: 8px 12px 10px;
  border-bottom: 1px solid rgba(var(--v-theme-on-background), 0.09);
  background: rgb(var(--v-theme-surface));
}

.article-header-inner {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.article-header h1 {
  flex: 1;
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.3;
}

.article-header h1 a {
  color: inherit;
  text-decoration: none;
}

.article-header h1 a:hover {
  text-decoration: underline;
}

.article-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
  color: rgba(var(--v-theme-on-background), 0.6);
  font-size: 0.8125rem;
}

.article-meta .feed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border: 1px solid rgba(var(--v-theme-on-background), 0.12);
  border-radius: 99px;
  color: rgb(var(--v-theme-on-background));
}

.article-meta .feed-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.article-meta .comments {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.article-meta .comments:hover {
  text-decoration: underline;
}

.article-body {
  padding: 12px 16px;
  color: rgb(var(--v-theme-on-background));
  font-size: 0.95rem;
  line-height: 1.55;
  overflow-wrap: break-word;
  cursor: pointer;
}

.article-body :deep(img) {
  cursor: pointer;
}

.article-body :deep(img) {
  max-width: 100%;
  height: auto;
}

.article-body :deep(a) {
  color: rgb(var(--v-theme-primary));
}

.article-attachments {
  padding: 0 16px;
}

.article-attachments h3 {
  margin: 0 0 6px;
  font-size: 0.95rem;
}

.attachment {
  margin-bottom: 6px;
}

.attachment audio,
.attachment video {
  max-width: 100%;
}

.article-tools {
  padding: 6px 16px 10px;
  border-top: 1px solid rgba(var(--v-theme-on-background), 0.09);
}

.article-tags-row,
.note-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.article-tags-row {
  align-items: center;
}

.article-tags-input {
  flex: 1;
  min-width: 0;
}

.article-tags-input :deep(.v-field__outline) {
  display: none;
}

.article-tags-input :deep(.v-field) {
  background: transparent;
}

.score-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
  color: rgba(var(--v-theme-on-background), 0.6);
  font-size: 0.8125rem;
}

.score-label {
  margin-right: 4px;
}

.article-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-background), 0.09);
}

.relative-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.article-footer a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.article-footer a:hover {
  text-decoration: underline;
}

.zoom-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.zoom-content {
  flex: 1;
  overflow-y: auto;
  max-width: 52rem;
  margin: 0 auto;
  padding: 24px 16px;
}

.zoom-content h1 {
  margin: 0 0 4px;
  font-size: 1.6rem;
  line-height: 1.25;
}

.zoom-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  color: rgba(var(--v-theme-on-background), 0.6);
  font-size: 0.875rem;
}

.zoom-content :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
