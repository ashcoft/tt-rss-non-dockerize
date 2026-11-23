# Vite + Vue 3 + Vuetify Migration Guide for Tiny Tiny RSS

## Verified status (2026-11-23)

The migration is complete: `index.php` and `prefs.php` serve the Vue 3 +
Vuetify + Pinia app, the Dojo/Dijit stack and AMD modules are deleted, and
every legacy `Pref_*` screen and bundled plugin UI surface has a Vue host.

The reading flow (login, feed tree, headlines, search, view modes, sorting,
article actions, tags, scoring, feed editing, feed-icon upload,
feed/category reordering, labels and label colours), content filters
(list, create, edit, clone, reorder, test, delete), OPML import/export,
password changes, account/OTP/app-password/profile settings, users and
system administration, feed batch/sharing/maintenance tools and plugin
settings run entirely on Vue 3 + Vuetify + Pinia, talking to `backend.php`
through the legacy adapter.

The verification notes below record earlier sessions; the current test
suite has grown to 112 Node tests, and `build`, `type-check`, `test:vue`,
`lint:vue` and `lint:js` pass.

What was verified in this session (PHP 8.4 + PostgreSQL 17, a real tt-rss
instance):

- `npm run build`, `npm run type-check`, `npm run lint:vue`, `npm run lint:js`
  all pass.
- `npm run test:vue` ran 43 Node tests at that point (the suite now has 112):
  renderer/scroll regressions, adapter tests, headline-store cursor tests and
  FeedTree selection tests.
- The adapter, the Pinia stores, **and the browser UI** were exercised against
  the live backend: login, feed tree, headlines list, search, view modes,
  sort orders, read/star/publish/delete, tags with autocomplete, scoring,
  labels, and preferences.

### Resolved: the "list-item click" blocker was a false alarm

The previous session recorded that `v-list-item` `@click` handlers never
fired. Re-testing with a correctly targeted click showed they fire normally:
selecting a feed loads its headlines (3 articles, 3 unread) and search works.
The earlier observation came from the automation clicking a wrapping element
rather than the clickable item. There is no known blocker here.

### Fixed this session

- **View modes were wrong.** The toolbar sent `list`/`grid`/`expanded`, none
  of which `Feeds/view` recognises, so the control did nothing. It now offers
  the backend's real set (`adaptive`, `all_articles`, `marked`, `published`,
  `unread`, `has_note`), matching `<select name="view_mode">` in `index.php`.
- **Sort was dropped.** The sort menu emitted a `sort` action that nothing
  handled. It now sends `order_by` with the values `index.php` uses
  (`default`, `feed_dates`, `date_reverse`, `title`).
- **Keyboard shortcuts were dead code.** `useKeyboard` was fully implemented
  but never mounted. It is now wired: `j`/`k` and arrows move a headline
  cursor (highlighted in the list), `o`/Enter opens, `r` toggles read, `s`
  stars, `f` publishes, `g` then `u` refreshes.
- **Tags and scoring were missing.** Added `Article/setArticleTags`,
  `Article/completeTags` and `Article/setScore`, with a chip combobox
  (autocomplete included) and score buttons in the article panel.
- **Feed editing was missing.** Added `Pref_Feeds/editfeed` and `editSave`
  with an "Edit Feed" tab. `editSave` writes every field it manages
  unconditionally, so a partial save clears the rest; verified live that a
  title-only save wiped `feed_url` and `site_url`. `saveFeed` therefore
  re-reads the record and merges, and round-trips `auth_login`/`auth_pass`
  so per-feed HTTP auth survives.
- **Filter creation/editing was missing.** The Filters tab only listed and
  deleted. Added `Pref_Filters/edit`, `editSave` and `add` (the `FilterEditorDialog`),
  with rule/action editing, the filter-type and action vocabularies, label and
  plugin-action pickers, and the rule feed/category multi-select. Rules and
  actions are sent as repeated `rule[]`/`action[]` JSON strings; checkbox
  fields go through `checkbox_to_sql_bool()` (the literal string "on").
- **Label editing was missing.** Labels could only be created and deleted.
  Added `Pref_Labels/save` (rename, which echoes the caption actually stored),
  `colorset` and `colorreset` (foreground/background), wired into `LabelsDialog`.
- **OPML import/export was missing.** Added `Pref_Feeds/importOpml` (a
  multipart upload through the new `LegacyBackend.upload()`) and the
  `OPML/export` download URL, wired into a new OPML tab in `ManageFeedsDialog`.
  The import log is an HTML fragment and is sanitized with DOMPurify before
  rendering.
- **Feed-icon upload was missing.** Added `Pref_Feeds/uploadIcon` (multipart,
  returns `{rc, icon_url}`) and `removeIcon`, wired into the Edit Feed tab with
  a live preview from `public.php?op=feed_icon`.
- **Feed/category reordering was missing.** Added `Pref_Feeds/savefeedorder`
  (the Dojo tree payload, built by `buildFeedOrderPayload`) and up/down move
  controls on every feed and category in `FeedTree`. Moving a feed is bounded
  to its own category so a move cannot change membership by accident.
- **Password changes were missing.** Added `Pref_Prefs/changepassword` in a new
  Password tab in `PreferencesDialog`. The handler answers with an HTML
  fragment; `parsePrefsResult` treats an `alert-danger` block as failure and
  strips the wrapper for the message.
- **Four preferences rendered blank.** `purge_old_days`,
  `purge_unread_articles`, `show_content_preview` and `vfeed_group_by_feed`
  were listed in the dialog but absent from `RPC/sanityCheck` init-params,
  their only read endpoint, so the dialog always showed them empty/false.
  `RPC::_make_init_params()` now exposes them, and the dialog also surfaces
  the seven other preferences that endpoint already returned
  (`combined_display_mode`, `cdm_enable_grid`, `on_catchup_show_next_feed`,
  `hide_read_shows_special`, `fresh_article_max_age`,
  `recently_read_max_age`, `debug_headline_ids`). A Vue test asserts every
  preference the dialog lists is present in init-params.
- **Catchup time windows were missing.** The toolbar only offered "mark all as
  read". Added the legacy `#main-catchup-dropdown` options
  (`all`/`1day`/`1week`/`2week`) to `Toolbar`, threaded through the store and
  client to `RPC/catchupFeed`'s `mode`.
- **Hide-read-feeds was missing.** The feed tree always showed every feed.
  Added the legacy "toggle hide read feeds" action: the store reads
  `HIDE_READ_FEEDS`/`HIDE_READ_SHOWS_SPECIAL` from init-params and persists
  changes via `RPC/setpref`, and `FeedTree` hides feeds with no unread
  articles (keeping the active feed visible).
- **Keyboard-shortcuts help was missing.** Added `RPC/hotkeyHelp` behind a new
  `HotkeyHelpDialog`, opened from a header button, the `?` shortcut and the
  toolbar action menu. The HTML fragment is DOMPurify-sanitized before render.
- **Feed icons were missing.** The tree showed a generic RSS glyph for every
  feed. It now renders each feed's icon from `public.php?op=feed_icon` (base
  URL from `icons_url` in init-params), falling back to the glyph on error.
- **Bulk article selection was missing.** The headline list only acted on one
  article at a time. Added a Select menu (all/unread/invert/none), per-article
  checkboxes and a bar to mark read, toggle unread/starred/published or delete
  the selection, backed by `deleteArticles`, `toggleStarred`, `togglePublished`
  and `toggleUnread` store actions. A mixed selection is split so each article
  flips individually (one `RPC/markSelected` per mode).
- **Plugin management was missing.** Added `Pref_Prefs/getPluginsList` and
  `setplugins` behind a Plugins tab in `PreferencesDialog`: list, search and
  enable/disable the per-user plugins. System plugins are shown disabled
  because they are managed by global configuration.
- **Advanced per-feed options were missing.** The Edit Feed tab now exposes the
  HTTP auth, private, image-caching, mark-unread-on-update, digest and
  enclosure flags the feed record already carries.
- **Digest settings were missing.** `RPC/sanityCheck` init-params now returns
  the four digest preferences (read with their real types, since the send time
  is a string), and the dialog lists them.
- **"Mark above/below as read" was missing.** The article panel now offers both
  actions, backed by a store helper that collects the unread ids on the chosen
  side of the article.
- **Article attachments were missing.** The adapter dropped the backend's
  `enclosures` payload, so podcast audio, video and file attachments never
  appeared. They are now mapped and rendered in the reading pane (audio/video
  inline, the rest as links).
- **Bulk actions were incomplete.** Beyond mark-read/delete, the selection bar
  now offers open-original, toggle unread/starred/published and set-score, and
  per-feed row actions mark a feed read or open the edit dialog.
- **Label selection loaded the wrong feed.** Clicking a label requested the raw
  positive label id, which `Feeds/view` treats as a regular feed. It now uses
  the synthetic id `LABEL_BASE_INDEX - 1 - labelId`, matching
  `Labels::label_to_feed_id()`. Found with the E2E suite.
- **Search with nothing selected returned nothing.** The toolbar search sent
  `feed=null`; it now defaults to the All Articles feed, matching the legacy
  client. Found with the E2E suite.
- **The article comments link was missing.** The adapter mapped the comment
  count and URL but nothing rendered them; the article header now shows the
  comments link.
- **Combined display mode was not implemented.** `COMBINED_DISPLAY_MODE` was
  only a preference toggle; the app always used the three-pane layout. It now
  renders each article's body inline in the headlines list (DOMPurify-sanitized)
  and hides the reading panel, toggled from the toolbar action menu. The grid
  view (`CDM_ENABLE_GRID`) tiles the inline articles on wide screens.
- **Display preferences were ignored on an existing session.** The
  already-authenticated path (`onMounted`) loaded feeds but not the display
  preferences, so hide-read, combined mode and grid were silently dropped. It
  now loads them, matching the login path. Found with the E2E suite.
- **Feed update errors were invisible.** `Feeds/view` reports the feed's last
  update error in its toolbar payload; the adapter dropped it. It now shows an
  alert icon next to the feed title with the message as its tooltip.
- **Article image previews were missing.** The adapter dropped `image_preview`
  (the first image enclosure), so combined mode showed no thumbnail. It now
  renders above the inline content.
- **Minor header parity.** The reading pane now shows the long date
  (`updated_long`), matching the legacy header, and combined mode tints the
  feed label with the feed's `bg_color`.
- **Headline rows were missing the excerpt and score.** The legacy row shows a
  content preview and a score icon; both are now rendered in the list.

All were verified against the live backend, including that all six view
modes and all four sort orders return correctly ordered results.

### Dojo removed

The Dojo stack is **gone**: `lib/dojo`, `lib/dijit`, `lib/dojox`, `lib/dojo-src`
and the `js/*.js` AMD modules (plus `js/form/`, `lib/CheckBox*.js` and the
`src/shim/`) are deleted, and every `dojoType`/`dijit.*` reference is removed
from the PHP. `index.php` and `prefs.php` serve the Vue shell only, so a
production build (`pnpm run build`) is required.

**Plugin article buttons** (`HOOK_ARTICLE_BUTTON`) are supported: the backend's
button HTML is parsed into `{plugin, method, icon, title}`, rendered in the
reading pane, and dispatched through `PluginHandler` with the returned fragment
shown in a sanitized dialog (see `ArticleView.runPluginButton`).

The preferences dialog now renders the **full backend preference set** (an
Advanced tab covers the ones without a curated label), so the legacy
`Pref_Prefs` screen is no longer needed.

Plugin UI surfaces now have a Vue host. `RPC/getPluginButtons` returns the
HTML from `HOOK_MAIN_TOOLBAR_BUTTON` and `HOOK_TOOLBAR_BUTTON`, and
`RPC/getPluginPrefsSection` returns one `HOOK_PREFS_TAB_SECTION` fragment.
`PluginSurface.vue` renders those fragments after rewriting
`onclick="Plugins.<Class>.<method>()"` into `data-plugin`/`data-method`
attributes and stripping every other inline handler; a click is dispatched
through `PluginHandler`. The toolbar shows the main and action-menu buttons,
and the preferences Plugins tab hosts the feed/preference sections (the share
plugin's "Unshare all articles" button is the bundled example).

The host deliberately supports only no-argument handlers. Calls that needed
arguments relied on the plugin's own JS (deleted with the Dojo stack) to build
the request; their `onclick` is removed rather than executed, so such plugins
need a small Vue handler before their buttons work.

`HOOK_PREFS_TAB` is hosted too: `RPC/getPluginPrefsTabs` invokes the hook for
the legacy tab ids and returns each plugin's fragment with its title. The
Plugins tab renders them in expansion panels, and `PluginSurface` also
intercepts native form submissions: the hidden `op`/`plugin`/`method` fields
written by `Controls\pluginhandler_tags()` are turned into a `PluginHandler`
call, so plugin settings forms (for example `af_psql_trgm` and `nsfw`) work
without their deleted JS.

The bundled `share` plugin's article button is handled by a dedicated
`ShareDialog` (the legacy JS owned that dialog): it shows the unique URL,
regenerates the key and unshares the article. The plugin's `unshare()` handler
was restored server-side.

The legacy `Pref_*` screens now all have Vue hosts:

- **Account** covers personal data, OTP enable/disable, app passwords, settings
  profiles, custom CSS, digest preview and reset-to-defaults.
- **Users** (admin) lists, searches, sorts, creates, edits, removes and resets
  passwords, with a per-user details view.
- **System** (admin) shows the event log with severity/pagination and clear,
  sends test email, lists scheduled tasks and renders PHP information.
- **Manage Feeds** adds batch subscribe/edit, published/feed sharing URLs,
  inactive feeds, feeds with errors and feed/category sort resets.
- **Plugins** adds the installer, local-plugin updates, data clearing and
  uninstall controls, plus plugin-provided preference tabs.

No `dojoType`, `dijit.*`, `dojoConfig` or `<script type="dojo/method">`
references remain in the PHP or plugin markup.

### End-to-end verification

`tests/e2e/frontend.spec.ts` (Playwright) drives the built app against a real
`index.php` + `backend.php` instance, so the migration can be checked in a
browser rather than only by unit tests. It has caught real bugs that unit tests
missed: a Vuetify menu nested inside a `v-list-group` activator whose clicks
were swallowed by the row's select handler, and label clicks requesting the raw
positive label id (the backend treats that as a regular feed).

The seed was also fixed so search works: `ttrss_entries.tsvector_combined`
(the full-text vector tt-rss builds from the title and stripped content) was
left NULL, so every query matched nothing.

### How the adapter works

| Module | Responsibility |
| --- | --- |
| `src/vue/api/legacy.ts` | Transport: POST-only, CSRF in the body, response parsing, typed errors |
| `src/vue/api/legacyEndpoints.ts` | Per-handler response mapping onto the shapes the stores expect |
| `src/vue/api/client.ts` | `{status, content}` facade the Pinia stores already consumed |

### Verified legacy contracts (previously listed as blockers)

These were confirmed by calling the running backend, not by reading code:

- **CSRF.** `validate_csrf()` compares `$_POST['csrf_token']` against
  `$_SESSION['csrf_token']`. A GET query token is ignored and the literal
  `auto` never matches. The adapter reads the token from the
  `const __csrf_token = "..."` shell global (or by parsing `index.php`), sends
  it in the POST body, and refuses to send an empty or `auto` value.
- **Dispatch.** `backend.php` instantiates the class named by `op` and calls
  the lowercased `method`. Unknown pairs answer
  `{"error":{"code":"E_UNKNOWN_METHOD",...}}`; unauthorized answers
  `E_UNAUTHORIZED`. There is no `login`/`logout` operation on `backend.php`;
  authentication is the `public.php?op=login` form POST.
- **Response shape.** Most handlers print a bare JSON object; several
  mutating handlers (`Pref_Feeds/remove`, `removeCat`, `addCat`,
  `renameCat`, `Pref_Labels/add`) print nothing on success. Errors use the
  `error` object. `Pref_Prefs/getProfiles` prints a top-level array.
- **`Pref_Feeds/getfeedtree`** returns a nested tree
  (`items[].items[]`), one entry per category, with `bare_id` as the numeric
  id. Every entry reports `unread: -1`; the real counters come from
  `RPC/getAllCounters`. The Special (`-1`) and Labels (`-2`) categories are
  skipped because the UI renders those from dedicated sources.
- **`Feeds/view`** reads the search term from `query` (not `search`), ignores
  `limit` (page size is hardcoded to 30), and returns
  `{headlines: {content: [...]}}`. `content` is an **array** of article rows
  when populated and an **HTML string** for empty/error states. `updated` is a
  localized string, not an epoch, and read state is the inverse of `unread`.
- **No endpoint exists** for reading a single preference, fetching one
  article, or purging a feed. Preference values come from
  `RPC/sanityCheck` init-params; article content already ships with the
  headline list; purging is `update.php --purge-feed` (scheduled/CLI).
- **Article notes** belong to the bundled `note` plugin and are written through
  `PluginHandler` (`op=PluginHandler&plugin=note&method=setnote`). When the
  plugin is disabled the backend answers `E_UNKNOWN_PLUGIN`; the UI surfaces
  that as an error rather than silently discarding the note.

### How index.php serves Vue

`index.php` and `prefs.php` render `include/vue_shell.php`; a production build
(`dist/.vite/manifest.json`) is required, which `VueAssets::tags()` uses to emit
the hashed entry script and stylesheet. Two details are easy to get wrong:

- The shell is served with an ETag. After login the cached copy still holds the
  pre-login (empty) CSRF token, so `fetchCsrfToken()` forces revalidation;
  without that, a 304 leaves the client unauthenticated and login appears to do
  nothing.
- User-specific helpers (`print_user_stylesheet`, plugin CSS/JS) assume a
  loaded user and throw when there is none, so they are emitted only when
  authenticated.

### Migration status

The Dojo libraries, AMD modules and `dojoType` markup are gone. Every legacy
`Pref_*` screen now has a Vue host (see above), and the bundled plugin UI
surfaces render through `PluginSurface`. Do not weaken authentication or CSRF
checks to make the frontend work.

Remaining limitations are plugin-specific rather than core:

- A third-party plugin whose toolbar/prefs button needs arguments still needs a
  small Vue handler, because the plugin's own JS was removed with Dojo.
- Plugin-provided tabs are rendered as sanitized HTML with native forms; plugins
  that depend on custom JS behavior beyond form submission need a Vue adapter.


This document describes the migration from the legacy Dojo build system to Vite with Vue 3 and Vuetify while maintaining backward compatibility.

## Overview

The frontend is a single Vite build of Vue 3 + Vuetify + Pinia. PHP serves a
thin shell (`include/vue_shell.php`) and keeps `backend.php` as the API. There
is no Dojo/AMD build any more.

## Quick Start

### Prerequisites

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm approve-builds esbuild @parcel/watcher
```

### Development

```bash
pnpm install
pnpm run dev          # Vite dev server, proxies to the PHP backend
php -S localhost:8080 # in another terminal
```

### Production

A production build is required: `index.php` and `prefs.php` emit the hashed
entry from `dist/.vite/manifest.json`.

```bash
pnpm run build
```

### Checks

```bash
pnpm run type-check
pnpm run lint:vue
pnpm run lint:js
pnpm run test:vue
```

## Architecture

### Single Vite build

- `src/vue/main.ts` mounts the app; `src/vue/App.vue` owns the layout.
- `index.php` and `prefs.php` render `include/vue_shell.php`, which uses
  `VueAssets::tags()` and the production manifest.
- The dev server proxies `/index.php`, `/prefs.php`, `/backend.php`,
  `/public.php`, `/api`, `/cache`, `/images` and `/themes` to the PHP server.

### Path aliases

| Alias | Path | Description |
|-------|------|-------------|
| `@` | `src/vue` | Vue source files |
| `@/components` | `src/vue/components` | Vue components |
| `@/composables` | `src/vue/composables` | Vue composables |
| `@/types` | `src/vue/types` | TypeScript types |

## Frontend layout

```text
src/vue/
├── api/
│   ├── client.ts          # {status, content} facade
│   ├── legacy.ts          # backend.php transport (POST, CSRF, errors)
│   └── legacyEndpoints.ts # per-handler response adapters
├── components/
│   ├── ArticleView.vue
│   ├── FeedTree.vue
│   ├── HeadlinesList.vue
│   ├── Toolbar.vue
│   ├── PluginSurface.vue
│   └── dialogs/
│       ├── AccountPanel.vue
│       ├── FilterEditorDialog.vue
│       ├── LabelsDialog.vue
│       ├── ManageFeedsDialog.vue
│       ├── PluginManagerDialog.vue
│       ├── PreferencesDialog.vue
│       ├── ShareDialog.vue
│       ├── SystemPanel.vue
│       └── UsersPanel.vue
├── composables/
├── stores/
├── types/
├── App.vue
└── main.ts
```

## Migration progress

### Complete

- [x] Vite + Vue 3 + Vuetify + TypeScript build and pnpm scripts.
- [x] Legacy `backend.php` transport (POST-only, CSRF in the body, typed
      errors) and per-handler adapters.
- [x] Pinia stores, keyboard shortcuts, infinite scroll and polling.
- [x] Reading flow: login, feed tree, headlines, search, view modes, sorting,
      article actions, tags, scoring, notes, attachments, comments and bulk
      selection.
- [x] Feed management: add/edit/remove/purge, categories, icons, OPML,
      batch subscribe/edit, sharing URLs, inactive feeds, feeds with errors and
      sort resets.
- [x] Labels, filters (list/create/edit/clone/reorder/test/delete) and
      preference editing.
- [x] Account: personal data, OTP, app passwords, profiles, custom CSS, digest
      preview and reset-to-defaults.
- [x] Admin: users and system (event log, test email, scheduled tasks, PHP
      information).
- [x] Plugins: enable/disable, installer, updates, data clearing, uninstall,
      article buttons, toolbar buttons, preference sections and preference tabs.
- [x] Playwright E2E harness and unit tests.

### Remaining limitations

- Plugin-specific, not core: a third-party plugin whose button needs arguments
  still needs a small Vue handler because the plugin's own JS was removed with
  Dojo. Plugin-provided tabs render as sanitized HTML with native forms.
- The feed debugger remains a standalone plain-HTML page.

## Legacy files removed

The Dojo/Dijit libraries, the AMD modules under `js/`, `js/form/`,
`lib/CheckBox*.js` and `src/shim/` are deleted. The only remaining `js/` files
are the plain helpers `common.js` and `utility.js`, which public/plugin pages
still include.

## Future Enhancements

Potential improvements for future phases:

1. **Vue Router Integration**: Add client-side routing for preferences, etc.
2. **Bundle Optimization**: Analyze and optimize the production bundle
3. **Full TypeScript Adoption**: Convert all Vue components to TypeScript
4. **Plugin API**: Replace the legacy HTML-hook bridge with a structured Vue
   plugin API for third-party plugins that need custom behavior.

## Contributing

When making changes to the build system:

1. Test both dev mode (`pnpm run dev`) and a production build
2. Ensure the PHP backend contracts in this document stay accurate
3. Update this documentation with any configuration changes
4. Test on multiple browsers (Chrome, Firefox, Safari)

## License

This migration is part of Tiny Tiny RSS and follows the same license as the main project.
