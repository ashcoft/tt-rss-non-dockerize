# Vite + Vue 3 + Vuetify Migration Guide for Tiny Tiny RSS

## Verified status (2026-11-15)

**The Dojo/dijit stack is gone.** Both `index.php` and `prefs.php` now serve
Vue 3 + Vuetify + Pinia applications, and `lib/dojo`, `lib/dijit`, the
`js/*.js` AMD modules, the `js/form/*` widgets, the AMD shim and the Dojo
sources have all been deleted. Nothing loads `dojo`, `dijit` or the AMD loader
any more, and there is no `VUE_LEGACY_SHELL` fallback: a missing build is
reported as an error rather than served as a broken page.

What runs on Vue:

- **Reader** (`index.php`): login, feed tree, headlines, search, view modes,
  sorting, keyboard shortcuts, article actions, tags, scoring, notes, labels,
  feed/category management, and plugin article buttons.
- **Preferences** (`prefs.php`): the Preferences tab (Personal data /
  Authentication plus every user preference), Feeds (subscribe, edit,
  reorder, icons, OPML), Filters (create, edit, clone, combine, remove,
  reorder, test), Labels (create, remove, colours), Users and System
  (administration), and plugin-provided preference tabs.
- **Login / public pages**: `include/login_form.php`, the password-recovery
  and database-updater pages in `Handler_Public.php`, the OTP prompt in
  `auth_internal`, and the bookmarklet popups are plain HTML forms.

### What was verified this session

PHP 8.4 + PostgreSQL 17 against a real tt-rss instance:

- `pnpm run build`, `pnpm run type-check`, `pnpm run lint:vue`,
  `pnpm run lint:js` all pass.
- `pnpm run test:vue` runs 68 Node tests (adapter contracts, renderer/scroll
  regressions, headline-store cursor, FeedTree selection, dialog prop
  handling, runDetached).
- The browser UI was exercised against the live backend: login, feed tree,
  headlines, the preferences tabs, saving a preference
  (`Pref_Prefs/saveconfig` round-trip), reordering feeds
  (`Pref_Feeds/savefeedorder` moved the rows in the database), and reading the
  event log and user list through the new JSON endpoints.

### How the app is served

`index.php` and `prefs.php` render `include/vue_shell.php`, which `VueAssets`
feeds the hashed entry tags for (`dist/.vite/manifest.json`).
`VueAssets::is_built()` / `is_prefs_built()` gate the two entries; a missing
build prints an error. Two details are easy to get wrong and are handled:

- The shell is served with an ETag. After login the cached copy still holds the
  pre-login (empty) CSRF token, so `fetchCsrfToken()` forces revalidation;
  without that, a 304 leaves the client unauthenticated and login appears to do
  nothing.
- User-specific helpers (`print_user_stylesheet`, plugin CSS/JS) assume a
  loaded user and throw when there is none, so they are emitted only when
  authenticated.

### How the adapter works

| Module | Responsibility |
| --- | --- |
| `src/vue/api/legacy.ts` | Transport: POST-only, CSRF in the body, response parsing, typed errors |
| `src/vue/api/legacyEndpoints.ts` | Per-handler response mapping onto the shapes the stores expect |
| `src/vue/api/client.ts` | `{status, content}` facade the Pinia stores consume |

### New JSON endpoints added for the preferences port

The Dojo preferences screens were generated server-side. Rather than re-render
that markup, five handlers now emit data:

| Handler | Replaces |
| --- | --- |
| `Pref_Prefs/getprefsjson` | `index_prefs_list()` (the user-preference form) |
| `Pref_Prefs/getauthjson` | `index_auth_*()` (personal data, password, app passwords, OTP) |
| `Pref_Prefs/getprefstabs` | `HOOK_PREFS_TAB` output, captured per tab |
| `Pref_Users/getusersjson` | the `Pref_Users/index` user table |
| `Pref_System/getlogjson` | `_log_viewer()` (the event log) |

The matching mutating methods (`saveconfig`, `add`/`editSave`/`clone`/`join`
for filters, `savefeedorder`, `uploadIcon`, `generateAppPassword`, `setOtp`,
...) are called directly through the adapter.

### Plugin compatibility

Plugins still ship scripts written against the legacy client (`PluginHost`,
`App.getPhArgs`, `xhr`, `Notify`, `fox.SingleUseDialog`). The shell stashes
those scripts in `window.__plugin_scripts`; `src/vue/legacy/pluginCompat.ts`
installs minimal versions of those globals and then runs them, and the Vue
components fire `HOOK_ARTICLE_RENDERED` / `HOOK_ARTICLE_RENDERED_CDM` after an
article renders. This is a deliberately small shim covering only what the
bundled plugins use, not a reimplementation of the old client.

### Verified legacy contracts

Confirmed by calling the running backend, not by reading code:

- **CSRF.** `validate_csrf()` compares `$_POST['csrf_token']` against
  `$_SESSION['csrf_token']`. A GET query token is ignored and the literal
  `auto` never matches. The adapter reads the token from the
  `const __csrf_token = "..."` shell global (or by parsing the page), sends it
  in the POST body, and refuses to send an empty or `auto` value.
- **Dispatch.** `backend.php` instantiates the class named by `op` and calls
  the lowercased `method`. Unknown pairs answer
  `{"error":{"code":"E_UNKNOWN_METHOD",...}}`; unauthorized answers
  `E_UNAUTHORIZED`. Authentication is the `public.php?op=login` form POST.
- **Response shape.** Most handlers print a bare JSON object; several mutating
  handlers print nothing on success. Errors use the `error` object.
  `Pref_Prefs/getProfiles` prints a top-level array.
- **Checkboxes.** `checkbox_to_sql_bool()` recognises only the literal string
  `on`, so the adapter sends `on`/`""` rather than `1`/`0` for filter and feed
  flags.
- **`Pref_Feeds/getfeedtree`** returns a nested tree with `bare_id` as the
  numeric id and `unread: -1` for every entry; the real counters come from
  `RPC/getAllCounters`.
- **`Feeds/view`** reads the search term from `query` (not `search`), ignores
  `limit` (page size is hardcoded to 30), and returns
  `{headlines: {content: [...]}}`. `content` is an **array** of article rows
  when populated and an **HTML string** for empty/error states.
- **`Pref_Feeds/editSave`** writes every field it manages unconditionally, so a
  partial save clears the rest; the adapter re-reads and merges.
- **Article notes** belong to the bundled `note` plugin and are written through
  `PluginHandler`; a disabled plugin answers `E_UNKNOWN_PLUGIN`, surfaced as an
  error rather than silently discarded.

## Overview

The frontend is a Vite-built Vue 3 + Vuetify + Pinia application:

- **Vite**: build tool and dev server with HMR
- **Vue 3**: reactive UI framework
- **Vuetify**: Material Design component library
- **TypeScript**: type-checked source under `src/vue`

There is a single build system now; the Dojo build and its libraries are gone.

## Quick Start

### Prerequisites

```bash
# Install pnpm (if not already installed)
corepack enable
corepack prepare pnpm@latest --activate
```

### Development Mode

```bash
# Install dependencies
pnpm install

# Start the Vite dev server
pnpm run dev

# In another terminal, start the PHP backend
php -S localhost:8080
```

The dev server runs on `http://localhost:5173` and proxies API requests to
`localhost:8080`.

### Production Build

`index.php` and `prefs.php` serve the built app, so a build must exist:

```bash
pnpm run build   # writes dist/ and dist/.vite/manifest.json
```

### Type Checking and Linting

```bash
pnpm run type-check   # tsc --noEmit
pnpm run lint:vue     # eslint src/vue
pnpm run lint:js      # eslint js src plugins
pnpm run test:vue     # node --test tests/vue/*.test.mjs
```

## Architecture

### Entries

Two HTML entries are built from `src/vue`:

- `src/vue/index.html` -> `src/vue/main.ts` (the reader)
- `src/vue/prefs.html` -> `src/vue/prefs-main.ts` (the preferences app)

`include/vue_assets.php` resolves the hashed file names from the Vite manifest,
so the PHP shells never hardcode them.

### Path Aliases (TypeScript)

| Alias | Path |
|-------|------|
| `@` | `src/vue` |
| `@/components` | `src/vue/components` |
| `@/composables` | `src/vue/composables` |
| `@/types` | `src/vue/types` |

### Proxy Configuration

The dev server proxies these paths to the PHP backend: `/index.php` (the CSRF
token source), `/prefs.php`, `/backend.php`, `/public.php`, `/api`, `/cache`,
`/images`, `/themes`.

## Component Mapping

The Dojo widgets the old client used now map onto Vuetify components:

| Dojo Widget | Vuetify Component | Vue Component |
|-------------|------------------|---------------|
| `dijit.Tree` | `v-list` | `FeedTree.vue` |
| `dijit.Toolbar` | `v-toolbar` / `v-btn` | `Toolbar.vue` |
| `dijit.form.*` | `v-text-field`, `v-select`, ... | inline |
| `dijit.layout.TabContainer` | `v-tabs` / `v-window` | `PrefsApp.vue` |
| `fox.SingleUseDialog` | `v-dialog` | `dialogs/*.vue` |
| Article list | `v-list` | `HeadlinesList.vue` |

## TypeScript Types

Shared types live in `src/vue/types/index.ts`; the adapter exports its own
mapped shapes from `src/vue/api/legacyEndpoints.ts`:

```typescript
import type { Feed, Category, Headline, Article } from '@/types';
```

## Migration Progress

All phases are complete:

- [x] Build system (Vite + Vue 3 + Vuetify + TypeScript)
- [x] Core Vue infrastructure (adapter, Pinia stores, composables)
- [x] Feature parity (article actions, tags, scoring, view modes, sort,
      keyboard shortcuts, feed/category/label management, search, filters,
      feed editing, OPML, icons, reordering)
- [x] Preferences (user preferences, personal data/auth, feed preferences,
      filters, labels, users, system, plugin tabs)
- [x] Dojo/dijit removal (libraries, AMD modules, legacy shells)

## Vue Source Structure

```text
src/vue/
├── api/            # legacy transport, endpoint adapters, client facade
├── components/     # reader components and dialogs
│   ├── prefs/      # preference tab components
│   └── dialogs/    # filter/feed editor dialogs
├── composables/    # useKeyboard, useInfiniteScroll
├── legacy/         # plugin compatibility shim
├── stores/         # Pinia stores (feeds, headlines, labels, filters, auth)
├── types/          # shared TypeScript types
├── utils/          # runDetached
├── App.vue         # reader app
├── PrefsApp.vue    # preferences app
├── main.ts         # reader entry point
└── prefs-main.ts   # preferences entry point
```

## Contributing

When making changes:

1. Test the dev server (`pnpm run dev`) against the PHP backend.
2. Keep the adapter faithful to the real `backend.php` contracts.
3. Update this document with any configuration changes.
4. Do not weaken the CSRF or authentication checks to make the frontend work.

## License

This migration is part of Tiny Tiny RSS and follows the same license as the
main project.
