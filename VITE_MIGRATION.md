# Vite + Vue 3 + Vuetify Migration Guide for Tiny Tiny RSS

## Verified status (2026-10-25)

**`index.php` now serves the Vue app; the Dojo client is no longer the main
entry point.** The reading flow (login, feed tree, headlines, search, view
modes, sorting, article actions, tags, scoring, feed editing, labels) runs
entirely on Vue 3 + Vuetify + Pinia, talking to `backend.php` through the
legacy adapter.

The Dojo stack is **not yet deleted**. What remains:

- `prefs.php` still renders Dojo markup. The preference screens are generated
  server-side by `Pref_*.php` (~4,700 lines emitting 225 `dojoType` widgets)
  and driven by ~2,000 lines of Dojo JS, so porting them is its own workstream.
- `lib/dojo`, `lib/dijit` (~12.7 MB) and the `js/*.js` AMD modules are still
  shipped; the legacy shell is reachable with `VUE_LEGACY_SHELL=1` for
  comparison.
- Plugin UI hooks (`HOOK_*`) still emit Dojo markup into the old shell.

What was verified in this session (PHP 8.4 + PostgreSQL 17, a real tt-rss
instance):

- `npm run build`, `npm run type-check`, `npm run lint:vue`, `npm run lint:js`
  all pass.
- `npm run test:vue` runs 43 Node tests: renderer/scroll regressions, adapter
  tests, headline-store cursor tests, and FeedTree selection tests.
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

All four were verified against the live backend, including that all six view
modes and all four sort orders return correctly ordered results.

### Still on Dojo

- **Preferences screens.** `prefs.php` renders Dojo tabs; the Vue dialog
  covers only a handful of user preferences, not feed preferences, filter
  rule creation/editing, label colours, or plugin settings.
- **Filter management.** Listing and deleting exist; creating and editing
  rules do not.
- **Drag and drop** reordering of feeds and categories.
- **OPML import/export** and feed-icon upload.
- **Plugin UI surfaces** (the `HOOK_*` render hooks).
- **Combined-display / grid modes** and the article toolbar's plugin buttons.
- **Deleting the Dojo libraries themselves** (blocked on the above).

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

`index.php` renders `include/vue_shell.php` whenever a production build exists
(`dist/.vite/manifest.json`), which `VueAssets::tags()` uses to emit the hashed
entry script and stylesheet. Set `VUE_LEGACY_SHELL=1` to fall back to the Dojo
shell. Two details are easy to get wrong:

- The shell is served with an ETag. After login the cached copy still holds the
  pre-login (empty) CSRF token, so `fetchCsrfToken()` forces revalidation;
  without that, a 304 leaves the client unauthenticated and login appears to do
  nothing.
- User-specific helpers (`print_user_stylesheet`, plugin CSS/JS) assume a
  loaded user and throw when there is none, so they are emitted only when
  authenticated.

### Next production gate

Removing the Dojo libraries requires the items under "Still on Dojo", in this
order: filter creation/editing, the preference screens, then drag-and-drop and
OPML. Do not weaken authentication or CSRF checks to make the frontend work.


This document describes the migration from the legacy Dojo build system to Vite with Vue 3 and Vuetify while maintaining backward compatibility.

## Overview

The frontend build system has been enhanced with:
- **Vite**: Fast development server with HMR
- **Vue 3**: Modern reactive UI framework
- **Vuetify 3**: Material Design component library
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

For production, continue using the existing PHP-served pages. The Vite build is primarily for development:

```bash
# Build for production (optional)
pnpm run build
```

### Type Checking

```bash
# Run TypeScript type checking
pnpm run type-check

# Run Vue-specific linting
pnpm run lint:vue
```

## Architecture

### Dual Build System

This implementation maintains two build systems:

1. **Legacy Dojo Build** (production)
   - Handled by PHP backend
   - Uses `lib/dojo/tt-rss-layer.js` (pre-built)
   - Serves original `index.php`

2. **Vite Build** (development)
   - Uses `src/vue/index.html` as entry point
   - Provides HMR and fast refresh
   - Proxies to PHP backend for API calls

### Module Aliases

The following aliases are configured in `vite.config.js`:

| Alias | Path | Description |
|-------|------|-------------|
| `dojo` | `lib/dojo` | Core Dojo 1.x modules |
| `dijit` | `lib/dijit` | Dojo Dijit UI widgets |
| `fox` | `js` | Tiny Tiny RSS custom modules |
| `lib` | `lib` | General lib directory |

### Path Aliases (TypeScript)

| Alias | Path | Description |
|-------|------|-------------|
| `@` | `src/vue` | Vue source files |
| `@/components` | `src/vue/components` | Vue components |
| `@/composables` | `src/vue/composables` | Vue composables |
| `@/types` | `src/vue/types` | TypeScript types |

### AMD Compatibility

Vite optimizes only the Vue/Pinia/Vuetify module graph with an ES2022 target.
It does not convert Dojo AMD modules to ESM. The legacy PHP pages continue to
load Dojo through the existing AMD loader.

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
| `vite.config.js` | Vite configuration with Vue + Vuetify + AMD support |
| `tsconfig.json` | TypeScript configuration |
| `eslint.config.js` | ESLint configuration with Vue rules |
| `package.json` | Added Vue 3, Vuetify, TypeScript, pnpm scripts |
| `src/vue/main.ts` | Vue 3 application entry point |
| `src/vue/App.vue` | Main Vue application component |
| `src/vue/types/index.ts` | TypeScript type definitions |
| `src/vue/api/legacy.ts` | Legacy `backend.php` transport (POST, CSRF, errors) |
| `src/vue/api/legacyEndpoints.ts` | Per-handler legacy response adapters |
| `src/vue/components/FeedTree.vue` | Feed tree component (Vuetify v-list) |
| `src/vue/components/Toolbar.vue` | Toolbar component (Vuetify buttons) |
| `src/vue/components/HeadlinesList.vue` | Headlines list (Vuetify v-list) |
| `src/vue/components/ArticleView.vue` | Article view component |
| `src/vue/index.html` | Vue app HTML entry point |
| `src/shim/amd-shim.js` | AMD compatibility shim for Dojo |

### Modified Files

| File | Change |
|------|--------|
| `js/index.html` | Added Vue mount point and script |
| `pnpm-workspace.yaml` | Build approvals and overrides |

### Unchanged Files

All other files remain unchanged:
- PHP backend files
- Dojo library files (`lib/dojo/`, `lib/dijit/`)
- Application JavaScript files (`js/`)
- Theme files (`themes/`)
- Gulp build scripts

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

### рџљ§ Phase 3: Feature Parity (In Progress)
- [x] All article actions (mark read/unread, star, publish, delete)
- [x] Article tags (with autocomplete) and scoring
- [x] View modes (adaptive/all/marked/published/unread/with note)
- [x] Sort orders (default/newest first/oldest first/title)
- [x] Keyboard shortcuts (j/k, arrows, o, r, s, f, g then u)
- [x] Feed management (add, delete feeds; purge is CLI-only)
- [x] Category management (create, rename, delete)
- [x] Labels management (create, remove, assign)
- [x] Search functionality (via `Feeds/view` `query` + stemming language)
- [x] Filter listing and deletion
- [x] User authentication/login flow
- [x] Feed editing (title, URLs, category, intervals)
- [ ] Filter creation and editing
- [ ] Drag and drop support
- [ ] OPML import/export

### вќЊ Phase 4: Preferences (Not Started)
- [x] User preferences (read via init-params, written via `RPC/setpref`)
- [ ] Feed preferences
- [ ] Filter rules (creation and editing)
- [ ] Label management (colors)
- [ ] Plugin settings

### вќЊ Phase 5: Polish (Not Started)
- [ ] Error handling
- [ ] Loading states
- [ ] Responsive design
- [ ] Theme support (light/dark)
- [ ] Accessibility improvements
- [ ] Real-time updates (polling)
- [ ] Offline support (service worker)

## Vue Source Structure

```text
src/vue/
в”œв”€в”€ api/
в”‚   в””в”€в”€ client.ts          # {status, content} facade over the adapter
в”‚   в”њв”Ђв”Ђ legacy.ts          # backend.php transport (POST, CSRF, errors)
в”‚   в””в”Ђв”Ђ legacyEndpoints.ts # Per-handler response adapters
в”њв”Ђв”Ђ components/
в”‚   в”њв”Ђв”Ђ ArticleView.vue    # Article content display
в”‚   в”њв”Ђв”Ђ FeedTree.vue       # Feed/category navigation
в”‚   в”њв”Ђв”Ђ HeadlinesList.vue  # Headlines with actions
в”‚   в””в”Ђв”Ђ Toolbar.vue        # Action toolbar
в”њв”Ђв”Ђ composables/
в”‚   в”њв”Ђв”Ђ useInfiniteScroll.ts  # Infinite scroll
в”‚   в””в”Ђв”Ђ useKeyboard.ts        # Keyboard shortcuts
в”њв”Ђв”Ђ stores/
в”‚   в”њв”Ђв”Ђ feeds.ts           # Feed/category state
в”‚   в”њв”Ђв”Ђ headlines.ts       # Headlines/articles state
в”‚   в””в”Ђв”Ђ index.ts          # Store exports
в”њв”Ђв”Ђ types/
в”‚   в””в”Ђв”Ђ index.ts           # TypeScript types
в”њв”Ђв”Ђ App.vue                # Main application
в””в”Ђв”Ђ main.ts               # Entry point with Pinia/Vuetify
```

## Dojo/Dijit Files Still Used

### Core Application
- `js/App.js` - Main application controller
- `js/tt-rss.js` - Core TT-RSS functionality
- `js/common.js` - Common utilities

### Article & Headlines
- `js/Article.js` - Article operations
- `js/Headlines.js` - Headlines view with actions
- `js/Feeds.js` - Feed operations

### Common Components
- `js/CommonDialogs.js` - Dialog components
- `js/CommonFilters.js` - Filter components
- `js/Toolbar.js` - Toolbar (more features)

### Feed Tree
- `js/FeedTree.js` - Feed tree with categories, drag-drop

### Preferences
- `js/prefs.js`, `js/Pref*.js` - All preferences modules

### Form & Other
- `js/form/` - Form widgets
- `js/SingleUseDialog.js`, `js/PluginHost.js`, etc.

## Future Enhancements

Potential improvements for future phases:

1. **Complete Component Migration**: Migrate remaining Dojo components to Vue
2. **Vue Router Integration**: Add client-side routing for preferences, etc.
3. **Bundle Optimization**: Analyze and optimize the production bundle
4. **Full TypeScript Adoption**: Convert all Vue components to TypeScript
5. **Full ESM Migration**: Gradually convert Dojo modules to ESM

## Contributing

When making changes to the build system:

1. Test both dev mode (`pnpm run dev`) and the legacy PHP backend
2. Ensure backward compatibility is maintained
3. Update this documentation with any configuration changes
4. Test on multiple browsers (Chrome, Firefox, Safari)

## License

This migration is part of Tiny Tiny RSS and follows the same license as the main project.
