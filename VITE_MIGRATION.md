# Vite + Vue 3 + Vuetify Migration Guide for Tiny Tiny RSS

## Verified status (2026-10-25)

**The Vue 3 + Vuetify client is now the production entry point.** `index.php`,
`prefs.php` and the login form no longer load Dojo or dijit, and the client is
built by Vite.

What this cutover changed:

- `index.php` and `prefs.php` render a shared PHP shell
  (`include/app_shell.php`) that injects the session CSRF token, the user's
  theme, the login name and per-plugin CSS, then loads the Vite entry from
  `dist/.vite/manifest.json` (`classes/ViteAssets.php`).
- Preferences are a view of the same client (`prefs.php` opens the preferences
  dialog), rendered from JSON metadata returned by the new
  `Pref_Prefs/getprefs` handler instead of server-rendered dijit forms.
- The login form and the public utility pages (password recovery, database
  updater, feed debugger, bookmarklets, OTP prompt) use plain HTML controls;
  their Dojo includes and `dijit.byId(...)` calls are gone.
- `include/controls.php` no longer emits `dojoType` attributes.
- Feed drag-and-drop (feed onto a category) and a filter rule/action editor
  were added, completing the feature-parity checklist below.

Validation in this session: `pnpm run build`, `pnpm run type-check`,
`pnpm run lint:vue`, `pnpm run lint:js` and `pnpm run test:vue` (36 Node tests)
all pass. The PHP entry points were syntax-checked with a PHP parser; the PHP
integration suite was not run because this sandbox has no PHP runtime.

### How the client talks to the backend

The client uses the same `backend.php` dispatch the Dojo client used; it does
not target the external JSON API. Every method resolves to the `{status,
content}` envelope the Pinia stores were written against: `status === 0` means
success, and backend/transport errors come back as `status === 1` with an
`error` message.

| Module | Responsibility |
| --- | --- |
| `src/vue/api/legacy.ts` | Transport: POST-only, CSRF in the body, response parsing, typed errors |
| `src/vue/api/legacyEndpoints.ts` | Per-handler response mapping onto the shapes the stores expect |
| `src/vue/api/client.ts` | `{status, content}` facade the Pinia stores consume |

### Verified legacy contracts

- **CSRF.** `validate_csrf()` compares `$_POST['csrf_token']` against
  `$_SESSION['csrf_token']`. A GET query token is ignored and the literal
  `auto` never matches. The adapter reads the token from the shell global and
  refuses to send an empty or `auto` value.
- **Dispatch.** `backend.php` instantiates the class named by `op` and calls
  the lowercased `method`. Unknown pairs answer `{"error":{"code":"E_UNKNOWN_METHOD"}}`;
  unauthorized answers `E_UNAUTHORIZED`.
- **`Pref_Feeds/getfeedtree`** returns a nested tree (`items[].items[]`), one
  entry per category, with `bare_id` as the numeric id. Counters come from
  `RPC/getAllCounters`; the Special (`-1`) and Labels (`-2`) categories are
  rendered from dedicated sources.
- **`Feeds/view`** reads the search term from `query`, ignores `limit` (page
  size is 30), and returns `{headlines: {content: [...]}}`. `content` is an
  array when populated and an HTML string for empty/error states. Read state is
  the inverse of `unread`.
- **Search language.** An empty stemming language makes PostgreSQL reject
  `to_tsquery()`, which the backend turns into a match-nothing query. The
  client resolves the configured default via `Feeds/search` before searching.
- **Feed editing.** `Pref_Feeds/editfeed` returns the feed row plus interval and
  language lists; `Pref_Feeds/editSave` reads checkboxes as the literal string
  `on` (`checkbox_to_sql_bool()`), so unchecked boxes send an empty value.
- **Preferences.** `Pref_Prefs/getprefs` (added for this client) returns the
  section/item metadata and values; values are written one at a time through
  `RPC/setpref`. Filters are edited with `Pref_Filters/editSave`, which replaces
  `rule[]`/`action[]` JSON strings wholesale.
- **Articles.** Content arrives with the headline list; there is no endpoint to
  fetch one article. Notes are written through the `note` plugin
  (`PluginHandler`), and a disabled plugin surfaces as an error.

### Remaining limitations

- Plugin-provided Dojo JavaScript hooks (`get_js()`, `get_prefs_js()`, toolbar
  and preferences HTML hooks) are not executed. Plugin CSS is still applied.
  Plugins that inject Dojo widgets need a Vue equivalent.
- `Pref_Prefs::getprefs()` exposes the preference fields the legacy page
  rendered; plugin-specific preference sections are not included.
- The legacy Dojo sources remain on disk for archival and plugin reference but
  are not loaded by any entry point.

This document describes the migration from the legacy Dojo build system to Vite with Vue 3 and Vuetify while maintaining backward compatibility.

## Overview

The frontend build system has been enhanced with:
- **Vite**: Fast development server with HMR
- **Vue 3**: Modern reactive UI framework
- **Vuetify 4**: Material Design component library
- **TypeScript**: Type-safe JavaScript

## Quick Start

### Prerequisites

```bash
# Install pnpm (if not already installed)
corepack enable
corepack prepare pnpm@latest --activate

# Approve build scripts (if needed)
pnpm approve-builds esbuild @parcel/watcher
```

### Development Mode

```bash
# Install dependencies
pnpm install

# Start Vite dev server (Vue 3 + Vuetify)
pnpm run dev

# In another terminal, start your PHP backend
php -S localhost:8080
```

The Vite dev server will be available at `http://localhost:5173` and will proxy API requests to `localhost:8080`.

### Production Build

The PHP shell loads the built bundle, so a build is required for deployment:

```bash
pnpm install --frozen-lockfile
pnpm run build          # writes dist/ and dist/.vite/manifest.json
```

`classes/ViteAssets.php` reads the manifest and emits the entry `<script>` and
its CSS `<link>` tags. If the manifest is missing, the shell renders an alert
asking for `pnpm run build` instead of a blank page.

### Development

Run the PHP backend and Vite separately, then point the shell at the dev server:

```bash
# terminal 1
php -S 127.0.0.1:8080

# terminal 2
TT_RSS_VITE_DEV_SERVER=http://127.0.0.1:5173 pnpm run dev
```

Open `http://127.0.0.1:8080/index.php`; the PHP shell loads the Vite client and
hot module replacement from `TT_RSS_VITE_DEV_SERVER`. The Vite proxy forwards
backend, theme, image and cache requests when the client is opened directly on
port 5173.

### Type Checking

```bash
pnpm run type-check   # tsc --noEmit
pnpm run lint:vue     # eslint src/vue
pnpm run test:vue     # node --test tests/vue/*.test.mjs
```

## Architecture

### Entry points

1. **PHP shell** (`include/app_shell.php`, used by `index.php` and `prefs.php`)
   - embeds the session CSRF token, login name, requested view and theme
   - applies the user's theme, user stylesheet and per-plugin CSS
   - emits the Vite entry tags through `classes/ViteAssets.php`
2. **Vue client** (`src/vue/main.ts` → `App.vue`)
   - Pinia stores for feeds, headlines, labels and auth
   - Vuetify 4 components; no AMD loader and no Dojo globals

`prefs.php` is a view of the same client. It preserves the legacy `?tab=` links
and accepts `?feed=<id>` to open a specific feed's preferences.

### Path Aliases (TypeScript)

| Alias | Path | Description |
|-------|------|-------------|
| `@` | `src/vue` | Vue source files |
| `@/components` | `src/vue/components` | Vue components |
| `@/composables` | `src/vue/composables` | Vue composables |
| `@/types` | `src/vue/types` | TypeScript types |

Dojo/dijit aliases were removed from `vite.config.js`; nothing in the Vue graph
imports an AMD module.

### Proxy Configuration

The dev server proxies the following paths to the PHP backend:

- `/index.php` - Main shell; the client reads the session CSRF token here
- `/prefs.php` - Preferences shell (same CSRF token)
- `/backend.php` - Main API endpoint
- `/public.php` - Public API endpoint
- `/api` - API v1 endpoints
- `/cache` - Cached assets
- `/images` - Static images
- `/themes` - Theme CSS files

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `vite.config.js` | Vite configuration with Vue + Vuetify, manifest output |
| `tsconfig.json` | TypeScript configuration |
| `eslint.config.js` | ESLint configuration with Vue rules |
| `src/vue/main.ts` | Vue 3 application entry point |
| `src/vue/App.vue` | Main Vue application component |
| `src/vue/api/*` | Legacy `backend.php` transport and response adapters |
| `src/vue/stores/*` | Pinia stores (feeds, headlines, labels, auth) |
| `src/vue/components/*` | Feed tree, toolbar, headline list, article view |
| `src/vue/components/dialogs/*` | Preferences, feed manager, labels, filter editor, hotkeys |
| `include/app_shell.php` | Shared PHP shell for `index.php` and `prefs.php` |
| `classes/ViteAssets.php` | Reads the Vite manifest and emits asset tags |
| `tests/vue/*.test.mjs` | Adapter and renderer regression tests |

### Modified Files

| File | Change |
|------|--------|
| `index.php` | Now a thin shell that boots the Vite client |
| `prefs.php` | Serves the same client with the preferences view open |
| `include/login_form.php` | Plain HTML login form; no Dojo/dijit |
| `include/controls.php` | No longer emits `dojoType` attributes |
| `classes/Handler_Public.php` | Utility pages use plain HTML controls |
| `classes/Feeds.php` | Feed debugger uses plain HTML controls |
| `classes/Pref_Prefs.php` | Adds the `getprefs` JSON metadata handler |
| `plugins/auth_internal/init.php` | OTP prompt without Dojo |
| `plugins/bookmarklets/init.php` | Bookmarklet pages without Dojo |
| `pnpm-workspace.yaml` | Build approvals and overrides |

### Legacy files

`lib/dojo/`, `lib/dijit/`, the application JavaScript under `js/` and the
gulp build remain in the tree but are not loaded by any entry point. They are
kept as reference for the plugin API; new work belongs in `src/vue/`.

## Vue 3 + Vuetify Components

### Component Structure

```
src/vue/
в”њв”Ђв”Ђ main.ts              # Vue app entry point
в”њв”Ђв”Ђ App.vue              # Main app with layout
в”њв”Ђв”Ђ types/
в”‚   в””в”Ђв”Ђ index.ts         # TypeScript definitions
в””в”Ђв”Ђ components/
    в”њв”Ђв”Ђ FeedTree.vue     # Feed/category navigation
    в”њв”Ђв”Ђ Toolbar.vue      # Action toolbar
    в”њв”Ђв”Ђ HeadlinesList.vue # Article headlines
    в””в”Ђв”Ђ ArticleView.vue  # Article content display
```

### Component Mapping

The following Dojo/dijit widgets have been mapped to Vuetify components:

| Dojo Widget | Vuetify Component | Vue Component |
|-------------|------------------|---------------|
| `dijit.Tree` | `v-list` | `FeedTree.vue` |
| `dijit.Toolbar` | `v-toolbar` | `Toolbar.vue` |
| `dijit.form.*` | `v-text-field`, `v-select`, etc. | Native Vuetify |
| Article list | `v-list` | `HeadlinesList.vue` |

## TypeScript Types

Type definitions are located in `src/vue/types/index.ts`:

```typescript
import type { Feed, Category, Headline, Article } from '@/types';

// Use in components
const feed = ref<Feed>({ id: 1, title: 'My Feed', unread: 10 });
```

### Available Types

- `Feed` - RSS feed information
- `Category` - Feed category
- `Headline` - Article headline in list
- `Article` - Full article content
- `Label` - Article label
- `FeedTreeNode` - Tree node for feed navigation
- `ApiResponse<T>` - API response wrapper

## Troubleshooting

### Module Resolution Issues

If you encounter module resolution errors:

1. Ensure the path aliases are correctly configured in `vite.config.js`
2. Check that the module file exists at the expected path
3. Verify the module ID matches the file path (e.g., `dojo/parser` -> `lib/dojo/parser.js`)

### Proxy Not Working

If API calls are failing:

1. Ensure the PHP backend is running on the correct port (default: 8080)
2. Check the proxy configuration in `vite.config.js`
3. Verify the target URLs in the proxy settings match your backend setup

### Build Errors

For production build issues:

1. Run `pnpm run dev` to check if the dev server works
2. Check for syntax errors in imported modules
3. Verify all dependencies are installed with `pnpm install`

## Migration Progress

### вњ… Phase 1: Build System вњ… COMPLETE
- [x] Analysis of existing build system
- [x] Vite configuration with AMD support
- [x] Entry point and AMD shim
- [x] pnpm and TypeScript setup
- [x] Vue 3 + Vuetify components
- [x] Testing and validation
- [x] Documentation

### вњ… Phase 2: Core Vue Infrastructure вњ… COMPLETE
- [x] API Client (`src/vue/api/client.ts`, `src/vue/api/legacy.ts`,
      `src/vue/api/legacyEndpoints.ts`)
  - Legacy `backend.php` coverage (feeds, articles, labels, categories,
    search, preferences, filters)
  - POST-only transport with the session CSRF token in the body
  - Per-handler response mapping and error propagation
- [x] Pinia Stores (`src/vue/stores/`)
  - `feeds.ts` - Feed and category state management
  - `headlines.ts` - Headlines and articles state management
- [x] Composables (`src/vue/composables/`)
  - `useKeyboard.ts` - Keyboard shortcuts (j/k, o, r, s, f, u, /, ?)
  - `useInfiniteScroll.ts` - Infinite scroll for headlines
- [x] App integration with Pinia stores
- [x] CSRF token initialization on app startup

### Phase 3: Feature Parity (Complete)
- [x] All article actions (mark read/unread, star, publish, delete)
- [x] Feed management (add, delete feeds; purge is CLI-only)
- [x] Category management (create, rename, delete)
- [x] Labels management (create, remove, assign)
- [x] Search functionality (via `Feeds/view` `query` + stemming language)
- [x] Filter listing, creation, editing and deletion
- [x] User authentication/login flow
- [x] Drag and drop support (feeds onto categories)

### Phase 4: Preferences (Complete)
- [x] User preferences rendered from `Pref_Prefs/getprefs`, written via `RPC/setpref`
- [x] Feed preferences (`Pref_Feeds/editfeed` + `editSave`)
- [x] Filter rules (creation and editing)
- [x] Label management (create, delete, colours)
- [x] Plugin settings (user-enabled plugins; system plugins shown read-only)

### Phase 5: Polish (Complete)
- [x] Error handling (typed transport errors, alerts, snackbars)
- [x] Loading states
- [x] Responsive design (drawer sidebar, flexible panels)
- [x] Theme support (Vuetify light/dark toggle)
- [x] Accessibility improvements (buttons have titles; keyboard navigation)
- [x] Real-time updates (polling)
- [ ] Offline support (service worker) - still out of scope; the web manifest
      makes the app installable but does not cache responses

## Vue Source Structure

```text
src/vue/
├── api/
│   ├── client.ts          # {status, content} facade over the adapter
│   ├── legacy.ts          # backend.php transport (POST, CSRF, errors)
│   └── legacyEndpoints.ts # Per-handler response adapters
├── components/
│   ├── ArticleView.vue    # Article content, notes, original link
│   ├── FeedTree.vue       # Feed/category/label tree, drag & drop
│   ├── HeadlinesList.vue  # Headlines with actions
│   ├── LoginForm.vue      # Login gate for expired sessions
│   ├── Toolbar.vue        # Search, catch-up and view controls
│   └── dialogs/
│       ├── FilterEditorDialog.vue # Filter rules and actions
│       ├── HotkeysHelpDialog.vue  # Keyboard shortcut reference
│       ├── LabelsDialog.vue       # Article label assignment
│       ├── ManageFeedsDialog.vue  # Subscribe, remove, categories
│       └── PreferencesDialog.vue  # General/feeds/filters/labels/plugins
├── composables/
│   ├── useInfiniteScroll.ts  # Infinite scroll
│   └── useKeyboard.ts        # Keyboard shortcuts
├── stores/
│   ├── auth.ts           # Session/login state
│   ├── feeds.ts          # Feed/category state
│   ├── headlines.ts      # Headlines/articles state
│   ├── labels.ts         # Label state
│   └── index.ts          # Store exports
├── types/
│   └── index.ts           # Shared TypeScript types
├── App.vue                # Main application and keyboard wiring
├── index.html             # Vite HTML entry
├── main.ts                # Entry point with Pinia/Vuetify
└── shims.d.ts             # Shell globals and module declarations
```

## Legacy Dojo/Dijit Files (not loaded)

These remain on disk for reference and for plugins that still reference them,
but no PHP entry point loads them:

- `js/App.js`, `js/tt-rss.js`, `js/common.js`
- `js/Article.js`, `js/Headlines.js`, `js/Feeds.js`, `js/FeedTree.js`
- `js/CommonDialogs.js`, `js/CommonFilters.js`, `js/Toolbar.js`
- `js/prefs.js`, `js/Pref*.js`
- `js/form/`, `js/SingleUseDialog.js`, `js/PluginHost.js`, `js/utility.js`
- `lib/dojo/`, `lib/dijit/`

`js/common.js` and `js/utility.js` are still loaded by a few utility pages for
`Cookie`/theme handling, but those pages no longer call the Dojo-dependent
`xhr` helpers.

## Future Enhancements

1. **Plugin UI parity**: provide Vue equivalents for plugin-provided Dojo
   JavaScript hooks and preference sections.
2. **Offline support**: add a service worker if the app should work offline.
3. **Bundle optimisation**: split Vuetify and the editor/dialog chunks.
4. **Template type checking**: run `vue-tsc` in addition to `tsc --noEmit`.
5. **Remove the legacy tree**: delete `lib/dojo`, `lib/dijit` and the old `js/`
   modules once no plugin references them.

## Contributing

When making changes to the build system:

1. Run `pnpm run build`, `pnpm run type-check`, `pnpm run lint:vue` and
   `pnpm run test:vue` before sending a change.
2. Test the PHP shell (`index.php`, `prefs.php`, login) against a real backend.
3. Update this documentation with any configuration changes.
4. Test on multiple browsers (Chrome, Firefox, Safari).

## License

This migration is part of Tiny Tiny RSS and follows the same license as the main project.
