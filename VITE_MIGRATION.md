# Vite + Vue 3 + Vuetify Migration Guide for Tiny Tiny RSS

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

The existing Dojo AMD modules are pre-bundled using Vite's `optimizeDeps` feature. This converts AMD-style modules to ESM for Vite's dependency pre-bundling while maintaining the original module structure.

### Proxy Configuration

The dev server proxies the following paths to the PHP backend:

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
- [x] API Client (`src/vue/api/client.ts`)
  - Full TT-RSS API coverage (auth, feeds, articles, labels, categories, search)
  - CSRF token handling
  - Proper array parameter serialization
- [x] Pinia Stores (`src/vue/stores/`)
  - `feeds.ts` - Feed and category state management
  - `headlines.ts` - Headlines and articles state management
- [x] Composables (`src/vue/composables/`)
  - `useKeyboard.ts` - Keyboard shortcuts (j/k, o, r, s, f, u, /, ?)
  - `useInfiniteScroll.ts` - Infinite scroll for headlines
- [x] App integration with Pinia stores
- [x] CSRF token initialization on app startup

### рџљ§ Phase 3: Feature Parity (In Progress)
- [ ] All article actions (mark read/unread, star, publish, delete)
- [ ] Feed management (add, edit, delete feeds)
- [ ] Category management
- [ ] Labels management
- [ ] Search functionality
- [ ] Filter functionality
- [ ] User authentication/login flow
- [ ] Drag and drop support

### вќЊ Phase 4: Preferences (Not Started)
- [ ] User preferences
- [ ] Feed preferences
- [ ] Filter rules
- [ ] Label management
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
в”‚   в””в”€в”€ client.ts          # TT-RSS API client (full API coverage)
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
