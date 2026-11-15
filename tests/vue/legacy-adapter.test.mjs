/**
 * Regression tests for the legacy backend adapter.
 *
 * These exercise the real adapter code (`src/vue/api/legacy.ts` and
 * `legacyEndpoints.ts`) against captured `backend.php` payloads. `fetch` is
 * stubbed because there is no browser or PHP backend inside the Node test
 * runner; everything else is the shipping implementation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/**
 * Resolve the modules the compiled sources import. A switch (rather than a
 * keyed lookup) keeps every require() argument a literal.
 */
function requireModule(id) {
  switch (id) {
    case 'typescript':
      return require('typescript');
    case 'vue':
      return require('vue');
    case 'pinia':
      return require('pinia');
    default:
      throw new Error(`Refusing to require unexpected module: ${id}`);
  }
}
const SRC_VUE = fileURLToPath(new URL('../../src/vue/', import.meta.url));

/** Load a TypeScript module as CommonJS, resolving relative `.ts` imports. */
function loadTsModule(specifier, cache = new Map()) {
  // Bare specifiers are resolved against src/vue; absolute paths are used as-is.
  const base = specifier.startsWith('/') ? `file://${specifier}` : new URL(specifier, `file://${SRC_VUE}`).href;
  const resolved = base.endsWith('.ts') ? fileURLToPath(base) : fileURLToPath(`${base}.ts`);
  if (cache.has(resolved)) return cache.get(resolved);

  const source = readFileSync(resolved, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const module = { exports: {} };
  cache.set(resolved, module.exports);

  const localRequire = (id) => {
    if (id.startsWith('.')) {
      const target = fileURLToPath(new URL(id, new URL(`file://${resolved}`)));
      return loadTsModule(target, cache);
    }
    return requireModule(id);
  };

  // Executes the compiled local module, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}

const MODULE_CACHE = new Map();
const { LegacyBackend, LegacyApiError, LegacyProtocolError, fetchCsrfToken } = loadTsModule(
  'api/legacy.ts',
  MODULE_CACHE
);
const endpoints = loadTsModule('api/legacyEndpoints.ts', MODULE_CACHE);

/**
 * Minimal DOM surface the adapter touches. Pass `csrf: null` to simulate a
 * shell whose `__csrf_token` global is absent.
 */
function installGlobals({ csrf = 'session-token' } = {}) {
  globalThis.window = {
    __csrf_token: csrf === null ? undefined : csrf,
    location: { href: 'http://localhost/index.php' },
  };
  globalThis.document = { createElement: () => ({ sandbox: true }) };
}

/** Record every request and answer with the queued payloads. */
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body ?? '' });
    const next = responses.shift();
    if (next === undefined) throw new Error(`Unexpected fetch to ${url}`);
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      text: async () => next.text,
    };
  };
  return calls;
}

test('backend call posts the CSRF token in the body, never the query string', async () => {
  installGlobals({ csrf: 'real-token' });
  const calls = stubFetch([{ text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('real-token');

  await backend.call('RPC', 'getAllCounters');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].body.includes('csrf_token=real-token'));
  assert.equal(calls[0].url, '/backend.php');
});

test('the literal "auto" placeholder is never sent as a CSRF token', async () => {
  installGlobals({ csrf: 'auto' });
  stubFetch([{ text: '<html>login form</html>' }]);
  const backend = new LegacyBackend();

  await assert.rejects(() => backend.call('RPC', 'getAllCounters'), LegacyProtocolError);
});

test('fetchCsrfToken rejects a shell without a session token', async () => {
  installGlobals({ csrf: null });
  stubFetch([{ text: '<html><body>login</body></html>' }]);

  await assert.rejects(() => fetchCsrfToken(), LegacyProtocolError);
});

test('fetchCsrfToken parses the token embedded by index.php', async () => {
  installGlobals({ csrf: null });
  stubFetch([{ text: 'const __csrf_token = "abc123";\nconst x = 1;' }]);

  assert.equal(await fetchCsrfToken(), 'abc123');
});

test('fetchCsrfToken reads the token from a realistic shell document', async () => {
  installGlobals({ csrf: null });
  // The token declaration sits among other scripts; the parser must find the
  // quoted value rather than assume it is the first quoted string on the page.
  const html = [
    '<!DOCTYPE html><html><head>',
    '<meta name="viewport" content="initial-scale=1,width=device-width" />',
    '<script type="text/javascript">',
    '  const __csrf_token = "deadbeef";',
    '  const __default_light_theme = "themes/light.css";',
    '</script></head><body></body></html>',
  ].join('\n');
  stubFetch([{ text: html }]);

  assert.equal(await fetchCsrfToken(), 'deadbeef');
});

test('fetchCsrfToken returns empty when the declaration is absent', async () => {
  installGlobals({ csrf: null });
  stubFetch([{ text: '<html><body>no token here</body></html>' }]);

  await assert.rejects(() => fetchCsrfToken(), LegacyProtocolError);
});

test('a structured error body becomes a LegacyApiError', async () => {
  installGlobals();
  stubFetch([
    { text: JSON.stringify({ error: { code: 'E_UNAUTHORIZED', params: [] } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await assert.rejects(
    () => backend.call('RPC', 'getAllCounters'),
    (error) => error instanceof LegacyApiError && error.code === 'E_UNAUTHORIZED'
  );
});

test('getFeedTree flattens nested items and merges authoritative counters', async () => {
  installGlobals();
  // Pref_Feeds/getfeedtree reports unread:-1 everywhere; the real counts come
  // from RPC/getAllCounters.
  const tree = {
    identifier: 'id',
    label: 'name',
    items: [
      {
        id: 'CAT:-1',
        name: 'Special',
        type: 'category',
        bare_id: -1,
        items: [{ id: 'FEED:-4', name: 'All articles', type: 'feed', bare_id: -4, unread: -1 }],
      },
      {
        id: 'CAT:1',
        name: 'News',
        type: 'category',
        bare_id: 1,
        items: [
          { id: 'FEED:7', name: 'Example Feed', type: 'feed', bare_id: 7, unread: -1 },
        ],
      },
      {
        id: 'CAT:0',
        name: 'Uncategorized',
        type: 'category',
        bare_id: 0,
        items: [{ id: 'FEED:9', name: 'Loose Feed', type: 'feed', bare_id: 9, unread: -1 }],
      },
    ],
  };
  const counters = {
    counters: [
      { id: 'global-unread', counter: 5 },
      { id: 7, title: 'Example Feed', counter: 3 },
      { id: 9, title: 'Loose Feed', counter: 2 },
      { id: 1, kind: 'cat', counter: 3 },
      { id: 0, kind: 'cat', counter: 2 },
    ],
    seq: 0,
  };
  stubFetch([
    { text: JSON.stringify(tree) },
    { text: JSON.stringify(counters) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const { feeds, categories } = await endpoints.getFeedTree(backend);

  assert.deepEqual(
    feeds.map((f) => [f.id, f.title, f.unread, f.cat_id]),
    [
      [7, 'Example Feed', 3, 1],
      [9, 'Loose Feed', 2, null],
    ]
  );
  assert.deepEqual(
    categories.map((c) => [c.id, c.title, c.unread]),
    [[1, 'News', 3]]
  );
});

test('getFeedTree keeps feeds that appear at the root when categories are off', async () => {
  installGlobals();
  // With ENABLE_FEED_CATS off, getfeedtree returns feeds directly under the
  // root instead of nesting them in category nodes; those feeds must survive.
  const tree = {
    items: [
      { id: 'FEED:7', name: 'Root Feed', type: 'feed', bare_id: 7, unread: -1 },
      { id: 'FEED:8', name: 'Other Feed', type: 'feed', bare_id: 8, unread: -1 },
    ],
  };
  stubFetch([{ text: JSON.stringify(tree) }, { text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const { feeds, categories } = await endpoints.getFeedTree(backend);

  assert.deepEqual(
    feeds.map((f) => [f.id, f.title, f.cat_id]),
    [[7, 'Root Feed', null], [8, 'Other Feed', null]]
  );
  assert.deepEqual(categories, []);
});

test('getFeedTree treats a type-less nested feed node as a feed', async () => {
  installGlobals();
  // Verified against the live backend: feeds nested inside a user category are
  // built by get_category_items() and carry no `type` field at all, unlike the
  // Special/Labels feeds. Classifying on `type` alone turned them into
  // categories and lost the feed.
  const tree = {
    items: [
      {
        id: 'CAT:2',
        name: 'Child Cat',
        type: 'category',
        bare_id: 2,
        items: [
          { id: 'FEED:1', bare_id: 1, name: 'Alpha Renamed', unread: -1 },
        ],
      },
    ],
  };
  stubFetch([{ text: JSON.stringify(tree) }, { text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const { feeds, categories } = await endpoints.getFeedTree(backend);

  assert.deepEqual(feeds.map((f) => [f.id, f.title, f.cat_id]), [[1, 'Alpha Renamed', 2]]);
  assert.deepEqual(categories.map((c) => [c.id, c.title]), [[2, 'Child Cat']]);
});

test('getFeedTree walks nested sub-categories', async () => {
  installGlobals();
  const tree = {
    items: [
      {
        id: 'CAT:1',
        name: 'Parent',
        type: 'category',
        bare_id: 1,
        items: [
          {
            id: 'CAT:2',
            name: 'Child',
            type: 'category',
            bare_id: 2,
            parent_id: 1,
            items: [{ id: 'FEED:9', name: 'Deep Feed', type: 'feed', bare_id: 9 }],
          },
        ],
      },
    ],
  };
  stubFetch([{ text: JSON.stringify(tree) }, { text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const { feeds, categories } = await endpoints.getFeedTree(backend);

  assert.deepEqual(feeds.map((f) => [f.id, f.cat_id]), [[9, 2]]);
  assert.deepEqual(categories.map((c) => [c.id, c.title, c.parent_id]), [
    [1, 'Parent', null],
    [2, 'Child', 1],
  ]);
});

test('getFeedTree does not duplicate the Special or Labels categories', async () => {
  installGlobals();
  const tree = {
    items: [
      {
        id: 'CAT:-1',
        name: 'Special',
        bare_id: -1,
        items: [{ id: 'FEED:-1', name: 'Starred', type: 'feed', bare_id: -1 }],
      },
      {
        id: 'CAT:-2',
        name: 'Labels',
        bare_id: -2,
        items: [{ id: 'FEED:-1026', name: 'MyLabel', type: 'feed', bare_id: -1026 }],
      },
    ],
  };
  stubFetch([{ text: JSON.stringify(tree) }, { text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const { feeds, categories } = await endpoints.getFeedTree(backend);

  assert.deepEqual(feeds, []);
  assert.deepEqual(categories, []);
});

test('getHeadlines maps legacy rows and derives read state from `unread`', async () => {
  installGlobals();
  const payload = {
    headlines: {
      first_id: 42,
      content: [
        {
          id: 42,
          title: 'Test Article',
          link: 'http://example.com/42',
          content: '<p>Hello</p>',
          content_preview: '&mdash; Hello',
          updated: '14:05',
          updated_long: 'Mar 03, 14:05',
          unread: true,
          marked: false,
          published: true,
          feed_id: 7,
          feed_title: 'Example Feed',
          num_comments: 2,
          comments: 'http://example.com/42#comments',
          author: 'A. Writer',
          score: 0,
          note: 'a note',
          tags: ['news'],
          labels: [],
        },
      ],
    },
    'headlines-info': { count: 1 },
  };
  stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const page = await endpoints.getHeadlines(backend, 7);

  assert.equal(page.count, 1);
  assert.equal(page.first_id, 42);
  assert.equal(page.message, null);
  const [headline] = page.headlines;
  assert.equal(headline.title, 'Test Article');
  assert.equal(headline.is_read, false, 'unread:true must map to is_read:false');
  assert.equal(headline.is_published, true);
  assert.equal(headline.updated, '14:05', 'localised date string is passed through');
  assert.equal(headline.comments_count, 2);
  assert.deepEqual(headline.tags, ['news']);
});

test('getHeadlines searches via `query`, not `search`', async () => {
  installGlobals();
  const calls = stubFetch([
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.getHeadlines(backend, 7, { search: 'hello world', searchLanguage: 'english' });

  assert.ok(calls[0].body.includes('query=hello+world'));
  assert.ok(!calls[0].body.includes('search='));
});

test('a search without a language resolves the configured default first', async () => {
  installGlobals();
  // Regression: an empty search_language makes PostgreSQL raise
  // "invalid name syntax", which the backend turns into a match-nothing
  // query. The adapter must look the default up instead of sending "".
  const calls = stubFetch([
    { text: JSON.stringify({ show_language: true, all_languages: ['english', 'simple'], default_language: 'simple' }) },
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.getHeadlines(backend, 7, { search: 'widgets' });

  assert.ok(calls[0].body.includes('method=search'), 'should ask Feeds/search for options');
  assert.ok(calls[1].body.includes('search_language=simple'));
});

test('an explicit search language is used as-is without an options lookup', async () => {
  installGlobals();
  const calls = stubFetch([
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.getHeadlines(backend, 7, { search: 'widgets', searchLanguage: 'french' });

  assert.equal(calls.length, 1, 'should not fetch options when a language is given');
  assert.ok(calls[0].body.includes('search_language=french'));
});

test('a non-search request never resolves a search language', async () => {
  installGlobals();
  const calls = stubFetch([
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.getHeadlines(backend, -4);

  assert.equal(calls.length, 1, 'should not fetch search options when not searching');
  // An empty language is only harmful alongside a non-empty query.
  assert.ok(calls[0].body.includes('query='), 'sends an empty query');
  assert.ok(calls[0].body.includes('search_language='));
});

test('getHeadlines forwards the view mode and sort order verbatim', async () => {
  installGlobals();
  // Regression: the toolbar previously sent list/grid/expanded, none of which
  // the backend recognises, and dropped the sort order entirely.
  const calls = stubFetch([
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
    { text: JSON.stringify({ headlines: { content: [] }, 'headlines-info': { count: 0 } }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.getHeadlines(backend, -4, { viewMode: 'marked' });
  assert.ok(calls[0].body.includes('view_mode=marked'));

  await endpoints.getHeadlines(backend, -4, { viewMode: 'all_articles', orderBy: 'date_reverse' });
  assert.ok(calls[1].body.includes('view_mode=all_articles'));
  assert.ok(calls[1].body.includes('order_by=date_reverse'));
});

test('setArticleTags sends a comma-separated tags_str and returns the saved list', async () => {
  installGlobals();
  const calls = stubFetch([{ text: JSON.stringify({ id: 7, tags: ['one', 'two'] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const saved = await endpoints.setArticleTags(backend, 7, ['one', 'two']);

  assert.ok(calls[0].body.includes('method=setArticleTags'));
  assert.ok(calls[0].body.includes('tags_str=one%2Ctwo'));
  assert.deepEqual(saved, ['one', 'two']);
});

test('completeTags unwraps the top-level array body', async () => {
  installGlobals();
  stubFetch([{ text: JSON.stringify(['alpha', 'alphabet']) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.deepEqual(await endpoints.completeTags(backend, 'al'), ['alpha', 'alphabet']);
});

test('setArticleScore sends a comma-delimited ids list and the score', async () => {
  installGlobals();
  const calls = stubFetch([{ text: JSON.stringify({ id: [1, 2], score: 300 }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.setArticleScore(backend, [1, 2], 300);

  assert.ok(calls[0].body.includes('method=setScore'));
  assert.ok(calls[0].body.includes('ids=1%2C2'));
  assert.ok(calls[0].body.includes('score=300'));
});

test('getFeedDetails maps the editfeed payload', async () => {
  installGlobals();
  stubFetch([
    {
      text: JSON.stringify({
        feed: {
          id: 4,
          title: 'Alpha',
          feed_url: 'http://example.com/a.xml',
          site_url: 'http://example.com',
          cat_id: null,
          update_interval: 60,
          purge_interval: 30,
          auth_login: 'user',
          auth_pass: 'secret',
        },
      }),
    },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.deepEqual(await endpoints.getFeedDetails(backend, 4), {
    id: 4,
    title: 'Alpha',
    feed_url: 'http://example.com/a.xml',
    site_url: 'http://example.com',
    cat_id: null,
    update_interval: 60,
    purge_interval: 30,
    auth_login: 'user',
    auth_pass: 'secret',
    private: false,
    cache_images: false,
    hide_images: false,
    feed_language: '',
    include_in_digest: false,
    always_display_enclosures: false,
    mark_unread_on_update: false,
  });
});

/** Every field editSave writes, so a partial save must round-trip all of them. */
const FEED_FIXTURE = {
  id: 4,
  title: 'Alpha',
  feed_url: 'http://example.com/a.xml',
  site_url: 'http://example.com',
  cat_id: 2,
  update_interval: 60,
  purge_interval: 30,
  auth_login: 'user',
  auth_pass: 'secret',
  private: true,
  cache_images: true,
  hide_images: true,
  feed_language: 'de',
  include_in_digest: true,
  always_display_enclosures: true,
  mark_unread_on_update: true,
};

test('saveFeed merges over a fresh snapshot so omitted fields are preserved', async () => {
  installGlobals();
  // Regression: editSave writes every field it manages unconditionally, so
  // sending only the changed field cleared feed_url/site_url/auth in the DB.
  const calls = stubFetch([
    { text: JSON.stringify({ feed: FEED_FIXTURE }) },
    { text: '' },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.saveFeed(backend, 4, { update_interval: 720 });

  // First call reads the current record.
  assert.ok(calls[0].body.includes('method=editfeed'));

  // The save must carry the unchanged fields back verbatim.
  const save = calls[1].body;
  assert.ok(save.includes('method=editSave'));
  assert.ok(save.includes('update_interval=720'), 'applies the change');
  assert.ok(save.includes('feed_url=http%3A%2F%2Fexample.com%2Fa.xml'), 'preserves feed_url');
  assert.ok(save.includes('site_url=http%3A%2F%2Fexample.com'), 'preserves site_url');
  assert.ok(save.includes('title=Alpha'), 'preserves title');
  assert.ok(save.includes('auth_login=user'), 'preserves auth_login');
  assert.ok(save.includes('auth_pass=secret'), 'preserves auth_pass');
  assert.ok(save.includes('cat_id=2'), 'preserves the category');
  assert.ok(save.includes('feed_language=de'), 'preserves feed_language');
});

test('saveFeed encodes checkbox fields as "on", not 1/0', async () => {
  installGlobals();
  // Regression: the checkbox fields go through checkbox_to_sql_bool(), which
  // returns 1 only for the literal string "on". Sending 1 (or true) disabled
  // every flag on save, verified against the live backend.
  const calls = stubFetch([
    { text: JSON.stringify({ feed: FEED_FIXTURE }) },
    { text: '' },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.saveFeed(backend, 4, { title: 'Renamed' });

  const save = calls[1].body;
  for (const field of [
    'private',
    'cache_images',
    'hide_images',
    'include_in_digest',
    'always_display_enclosures',
    'mark_unread_on_update',
  ]) {
    assert.ok(save.includes(`${field}=on`), `${field} must be sent as "on"`);
    assert.ok(!save.includes(`${field}=1`), `${field} must not be sent as 1`);
  }
});

test('getFeedDetails defaults the checkbox fields to false when absent', async () => {
  installGlobals();
  stubFetch([{ text: JSON.stringify({ feed: { id: 4, title: 'Bare' } }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const details = await endpoints.getFeedDetails(backend, 4);

  assert.equal(details.private, false);
  assert.equal(details.cache_images, false);
  assert.equal(details.mark_unread_on_update, false);
  assert.equal(details.feed_language, '');
});

test('getSearchOptions never returns an empty language', async () => {
  installGlobals();
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  stubFetch([
    { text: JSON.stringify({ show_language: true, all_languages: ['english', 'french'], default_language: '' }) },
  ]);
  const options = await endpoints.getSearchOptions(backend);
  assert.equal(options.defaultLanguage, 'english', 'falls back to the first available language');

  stubFetch([{ text: JSON.stringify({ show_language: true, all_languages: [], default_language: '' }) }]);
  const empty = await endpoints.getSearchOptions(backend);
  assert.equal(empty.defaultLanguage, 'english', 'has a last-resort default');
});

test('getHeadlines reports a string content body as a message, not as headlines', async () => {
  installGlobals();
  const payload = {
    headlines: {
      first_id: 0,
      content: '<div class="whiteBox">No articles found to display.</div>',
    },
    'headlines-info': { count: 0 },
  };
  stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const page = await endpoints.getHeadlines(backend, -4);

  assert.deepEqual(page.headlines, []);
  assert.equal(page.message, 'No articles found to display.');
});

test('getLabels reads the nested label tree', async () => {
  installGlobals();
  const payload = {
    identifier: 'id',
    label: 'name',
    items: [
      {
        id: 'root',
        items: [
          {
            type: 'label',
            id: 'LABEL:1',
            bare_id: 1,
            name: 'MyLabel',
            fg_color: '#000',
            bg_color: '#fff',
          },
        ],
      },
    ],
  };
  stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.deepEqual(await endpoints.getLabels(backend), [
    { id: 1, caption: 'MyLabel', fg_color: '#000', bg_color: '#fff', unread: 0 },
  ]);
});

test('renameLabel returns the caption the backend actually stored', async () => {
  installGlobals();
  // Pref_Labels/save prints the stored caption as plain text, not JSON.
  const calls = stubFetch([{ text: 'New Name' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const stored = await endpoints.renameLabel(backend, 1, 'New Name');

  assert.ok(calls[0].body.includes('method=save'));
  assert.ok(calls[0].body.includes('id=1'));
  assert.ok(calls[0].body.includes('caption=New+Name'));
  assert.equal(stored, 'New Name');
});

test('renameLabel reports the unchanged caption when the backend rejects it', async () => {
  installGlobals();
  // A duplicate or empty caption makes the backend echo the old caption.
  stubFetch([{ text: 'Old Name' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.equal(await endpoints.renameLabel(backend, 1, 'Old Name'), 'Old Name');
});

test('setLabelColors sends fg and bg in one colorset call', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.setLabelColors(backend, 7, '#ff0000', '#00ff00');

  const body = calls[0].body;
  assert.ok(body.includes('method=colorset'));
  assert.ok(body.includes('ids=7'));
  assert.ok(body.includes('fg=%23ff0000'));
  assert.ok(body.includes('bg=%2300ff00'));
});

test('resetLabelColors calls colorreset for the label', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.resetLabelColors(backend, 7);

  assert.ok(calls[0].body.includes('method=colorreset'));
  assert.ok(calls[0].body.includes('ids=7'));
});

test('getFilters reads the nested filter tree', async () => {
  installGlobals();
  const payload = {
    items: [
      {
        id: 'root',
        items: [
          { id: 'FILTER:3', bare_id: 3, bare_name: 'My Filter', name: 'My Filter', enabled: true },
        ],
      },
    ],
  };
  stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.deepEqual(await endpoints.getFilters(backend), [
    { id: 3, title: 'My Filter', enabled: true },
  ]);
});

test('getFilterDetails maps the edit payload onto the editor shape', async () => {
  installGlobals();
  // Captured shape of Pref_Filters/edit: the rule keeps feed_id as an array of
  // strings ("0" means all feeds, "CAT:<id>" a category) and every action
  // carries both action_param and action_param_label.
  const payload = {
    id: 3,
    enabled: true,
    match_any_rule: false,
    inverse: false,
    title: 'My Filter',
    rules: [
      { reg_exp: 'foo', filter_type: 1, feed_id: ['0'], name: 'Title matches foo' },
      { reg_exp: 'bar', filter_type: 3, feed_id: ['CAT:2'], inverse: true },
    ],
    actions: [
      { action_id: 2, action_param: '', action_param_label: '' },
      { action_id: 7, action_param: 'Important', action_param_label: 'Important' },
    ],
    filter_types: { 1: 'Title', 3: 'Title or Content' },
    action_types: { 2: 'Mark as read', 7: 'Assign label' },
    plugin_actions: { 'note:setnote': 'note: set note' },
    labels: [{ id: 5, caption: 'Important' }],
  };
  const calls = stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const details = await endpoints.getFilterDetails(backend, 3);

  assert.ok(calls[0].body.includes('method=edit'));
  assert.ok(calls[0].body.includes('id=3'));
  assert.equal(details.title, 'My Filter');
  assert.deepEqual(details.rules, [
    { reg_exp: 'foo', filter_type: 1, feed_id: ['0'], inverse: false },
    { reg_exp: 'bar', filter_type: 3, feed_id: ['CAT:2'], inverse: true },
  ]);
  assert.deepEqual(details.actions, [
    { action_id: 2, action_param: '', action_param_label: '' },
    { action_id: 7, action_param: 'Important', action_param_label: 'Important' },
  ]);
  assert.deepEqual(details.filterTypes, { 1: 'Title', 3: 'Title or Content' });
  assert.deepEqual(details.actionTypes, { 2: 'Mark as read', 7: 'Assign label' });
  assert.deepEqual(details.pluginActions, { 'note:setnote': 'note: set note' });
  assert.deepEqual(details.labels, [{ id: 5, caption: 'Important' }]);
});

test('getFilterDetails defaults an empty template (id 0) to safe values', async () => {
  installGlobals();
  // Pref_Filters/edit with id 0 returns the rule/action vocabularies and labels
  // but no rules or actions, so the editor must default them to empty arrays.
  const payload = {
    id: 0,
    enabled: true,
    match_any_rule: false,
    inverse: false,
    title: '',
    rules: [],
    actions: [],
    filter_types: { 1: 'Title' },
    action_types: { 2: 'Mark as read' },
    plugin_actions: {},
    labels: [],
  };
  stubFetch([{ text: JSON.stringify(payload) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const details = await endpoints.getFilterDetails(backend, 0);

  assert.equal(details.id, 0);
  assert.deepEqual(details.rules, []);
  assert.deepEqual(details.actions, []);
  assert.equal(details.enabled, true);
});

test('saveFilter sends editSave with JSON-encoded rules and actions', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.saveFilter(backend, {
    id: 3,
    enabled: true,
    match_any_rule: false,
    inverse: false,
    title: 'My Filter',
    rules: [{ reg_exp: 'foo', filter_type: 1, feed_id: ['0'], inverse: false }],
    actions: [{ action_id: 7, action_param: 'Important', action_param_label: 'Important' }],
    filterTypes: {},
    actionTypes: {},
    pluginActions: {},
    labels: [],
  });

  const body = calls[0].body;
  assert.ok(body.includes('method=editSave'));
  assert.ok(body.includes('id=3'));
  // Checkbox fields must be the literal "on" that checkbox_to_sql_bool() accepts.
  assert.ok(body.includes('enabled=on'));
  assert.ok(!body.includes('match_any_rule=on'));
  const rule = JSON.parse(decodeURIComponent(/rule%5B%5D=([^&]*)/.exec(body)[1]));
  assert.deepEqual(rule, { reg_exp: 'foo', filter_type: 1, feed_id: ['0'], inverse: false });
  const action = JSON.parse(decodeURIComponent(/action%5B%5D=([^&]*)/.exec(body)[1]));
  assert.deepEqual(action, { action_id: 7, action_param: 'Important', action_param_label: 'Important' });
});

test('saveFilter uses add (not editSave) for a new filter', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.saveFilter(backend, {
    id: 0,
    enabled: true,
    match_any_rule: false,
    inverse: false,
    title: 'Brand New',
    rules: [],
    actions: [],
    filterTypes: {},
    actionTypes: {},
    pluginActions: {},
    labels: [],
  });

  assert.ok(calls[0].body.includes('method=add'));
  assert.ok(!calls[0].body.includes('method=editSave'));
  // A new filter has no id to send.
  assert.ok(!calls[0].body.includes('id='));
});

test('getProfiles unwraps the top-level array body', async () => {
  installGlobals();
  stubFetch([{ text: JSON.stringify([{ title: 'Default profile', id: 0, active: true }]) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  assert.deepEqual(await endpoints.getProfiles(backend), [
    { id: 0, title: 'Default profile', active: true },
  ]);
});

test('addFeed accepts the "already subscribed" and "added" result codes only', async () => {
  installGlobals();
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  stubFetch([{ text: JSON.stringify({ result: { code: 0, feed_id: 7 } }) }]);
  assert.equal((await endpoints.addFeed(backend, 'http://example.com/rss')).code, 0);

  stubFetch([{ text: JSON.stringify({ result: { code: 1, feed_id: 8 } }) }]);
  assert.equal((await endpoints.addFeed(backend, 'http://example.com/rss2')).code, 1);

  stubFetch([
    { text: JSON.stringify({ result: { code: 2, message: 'Invalid URL' } }) },
  ]);
  await assert.rejects(
    () => endpoints.addFeed(backend, 'not-a-url'),
    (error) => error instanceof LegacyApiError && error.code === 'E_FEED_SUBSCRIBE_FAILED'
  );
});

test('a handler that prints nothing on success still resolves', async () => {
  installGlobals();
  stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const response = await backend.call('Pref_Feeds', 'removeCat', { ids: 1 });

  assert.equal(response.body, null);
});

test('mutating calls send the CSRF token and expected parameters', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }, { text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.markArticles(backend, [1, 2, 3], 2);
  assert.ok(calls[0].body.includes('method=markSelected'));
  assert.ok(calls[0].body.includes('cmode=2'));
  // RPC expects a comma-delimited `ids` string, not repeated `ids[]`.
  assert.ok(calls[0].body.includes('ids=1%2C2%2C3'));

  await endpoints.setArticleLabel(backend, 5, [9], 1);
  assert.ok(calls[1].body.includes('method=assignToLabel'));
  assert.ok(calls[1].body.includes('lid=5'));
});

test('read-only tree handlers skip CSRF so they work before login', async () => {
  installGlobals({ csrf: null });
  const calls = stubFetch([{ text: JSON.stringify({ items: [] }) }]);
  const backend = new LegacyBackend();

  await backend.call('Pref_Feeds', 'getfeedtree', { mode: 2 });

  assert.ok(!calls[0].body.includes('csrf_token'));
});

test('operations without a legacy endpoint fail loudly', () => {
  assert.throws(() => endpoints.purgeFeed(), /purge/i);
  assert.throws(() => endpoints.getPref(), /preference/i);
  assert.throws(() => endpoints.getArticle(), /article/i);
});

test('opmlExportUrl builds the export URL and honours include_settings', () => {
  assert.equal(endpoints.opmlExportUrl(false), '/backend.php?op=OPML&method=export');
  assert.equal(
    endpoints.opmlExportUrl(true),
    '/backend.php?op=OPML&method=export&include_settings=1'
  );
});

test('importOpml uploads the file as multipart with the CSRF token', async () => {
  installGlobals();
  const calls = stubFetch([{ text: 'Imported 2 feeds.<br/>' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const log = await endpoints.importOpml(backend, new Blob(['<opml/>']));

  const body = calls[0].body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('op'), 'Pref_Feeds');
  assert.equal(body.get('method'), 'importOpml');
  assert.equal(body.get('csrf_token'), 't');
  assert.ok(body.get('opml_file') instanceof Blob);
  assert.equal(log, 'Imported 2 feeds.<br/>');
});

test('uploadFeedIcon posts the icon as multipart and reads the result code', async () => {
  installGlobals();
  const calls = stubFetch([
    { text: JSON.stringify({ rc: 'E_ICON_UPLOAD_SUCCESS', icon_url: '/public.php?op=feed_icon&id=7&ts=1' }) },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const result = await endpoints.uploadFeedIcon(backend, 7, new Blob(['png']));

  const body = calls[0].body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('method'), 'uploadIcon');
  assert.equal(body.get('feed_id'), '7');
  assert.equal(body.get('csrf_token'), 't');
  assert.ok(body.get('icon_file') instanceof Blob);
  assert.equal(result.rc, endpoints.ICON_UPLOAD_SUCCESS);
  assert.equal(result.iconUrl, '/public.php?op=feed_icon&id=7&ts=1');
});

test('uploadFeedIcon surfaces a too-large result code', async () => {
  installGlobals();
  stubFetch([{ text: JSON.stringify({ rc: 'E_ICON_FILE_TOO_LARGE', icon_url: '' }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const result = await endpoints.uploadFeedIcon(backend, 7, new Blob(['png']));

  assert.equal(result.rc, endpoints.ICON_FILE_TOO_LARGE);
});

test('removeFeedIcon calls removeIcon for the feed', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.removeFeedIcon(backend, 7);

  assert.ok(calls[0].body.includes('method=removeIcon'));
  assert.ok(calls[0].body.includes('feed_id=7'));
});

test('buildFeedOrderPayload groups feeds under their categories', () => {
  const payload = endpoints.buildFeedOrderPayload(
    [{ id: 3 }, { id: 4 }],
    [
      { id: 7, cat_id: null },
      { id: 9, cat_id: 3 },
      { id: 10, cat_id: 4 },
      { id: 11, cat_id: null },
    ]
  );

  assert.deepEqual(payload, {
    items: [
      {
        id: 'root',
        items: [
          { _reference: 'FEED:7' },
          { _reference: 'FEED:11' },
          { id: 'CAT:3', _reference: 'CAT:3', items: [{ _reference: 'FEED:9' }] },
          { id: 'CAT:4', _reference: 'CAT:4', items: [{ _reference: 'FEED:10' }] },
        ],
      },
    ],
  });
});

test('buildFeedOrderPayload keeps empty categories and drops unknown cat_ids', () => {
  const payload = endpoints.buildFeedOrderPayload(
    [{ id: 3 }],
    [{ id: 9, cat_id: 99 }]
  );

  assert.deepEqual(payload.items[0].items, [
    { _reference: 'FEED:9' },
    { id: 'CAT:3', _reference: 'CAT:3', items: [] },
  ]);
});

test('saveFeedOrder posts the JSON payload to savefeedorder', async () => {
  installGlobals();
  const calls = stubFetch([{ text: '' }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.saveFeedOrder(backend, [{ id: 3 }], [{ id: 9, cat_id: 3 }]);

  const body = calls[0].body;
  assert.ok(body.includes('method=savefeedorder'));
  const payload = JSON.parse(decodeURIComponent(/payload=([^&]*)/.exec(body)[1]));
  assert.deepEqual(payload.items[0].items, [
    { id: 'CAT:3', _reference: 'CAT:3', items: [{ _reference: 'FEED:9' }] },
  ]);
});

test('changePassword posts the three fields and reads a notice as success', async () => {
  installGlobals();
  const calls = stubFetch([
    { text: '<div class="alert alert-info" id="">Password changed.</div>' },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const result = await endpoints.changePassword(backend, 'old', 'new', 'new');

  const body = calls[0].body;
  assert.ok(body.includes('method=changepassword'));
  assert.ok(body.includes('old_password=old'));
  assert.ok(body.includes('new_password=new'));
  assert.ok(body.includes('confirm_password=new'));
  assert.deepEqual(result, { ok: true, message: 'Password changed.' });
});

test('changePassword reads an alert-danger block as a failure', async () => {
  installGlobals();
  stubFetch([
    { text: '<div class="alert alert-danger" id="">Entered passwords do not match.</div>' },
  ]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  const result = await endpoints.changePassword(backend, 'old', 'new', 'other');

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Entered passwords do not match.');
});

test('catchupFeed sends the feed, is_cat flag and time window', async () => {
  installGlobals();
  const calls = stubFetch([{ text: JSON.stringify({ counters: [] }) }, { text: JSON.stringify({ counters: [] }) }]);
  const backend = new LegacyBackend();
  backend.setCsrfToken('t');

  await endpoints.catchupFeed(backend, 7, false, '2week');
  await endpoints.catchupFeed(backend, 3, true);

  assert.ok(calls[0].body.includes('method=catchupFeed'));
  assert.ok(calls[0].body.includes('feed_id=7'));
  assert.ok(calls[0].body.includes('is_cat=0'));
  assert.ok(calls[0].body.includes('mode=2week'));
  // Default mode is "all".
  assert.ok(calls[1].body.includes('is_cat=1'));
  assert.ok(calls[1].body.includes('mode=all'));
});
