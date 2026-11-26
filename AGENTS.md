# AGENTS.md

## Project

Tiny Tiny RSS (tt-rss), a self-hosted web feed reader. PHP backend
(`backend.php` dispatches `op`/`method` to `classes/*.php` handlers) with a
Vue 3 + Vuetify + Pinia frontend; the Dojo 1.x client has been removed.

## Frontend build and checks

Dependencies are managed with pnpm (see `pnpm-lock.yaml`). Enable it with
`corepack pnpm` if `pnpm` is not on PATH.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build        # vite build
corepack pnpm run type-check   # tsc --noEmit
corepack pnpm run test:vue     # node --test tests/vue/*.test.mjs
corepack pnpm run test:e2e     # Playwright against a running instance
corepack pnpm run lint:vue     # eslint src/vue
corepack pnpm run lint:js      # eslint js src plugins
```

Run the first six before finishing a frontend change; CI runs them on every PR.

### End-to-end tests

`pnpm run test:e2e` drives the built app in a real browser (Playwright +
Chromium). It needs a running tt-rss instance whose `index.php` serves the
Vue bundle (`pnpm run build` first). Point it at the instance with
`E2E_BASE_URL`; the tests skip themselves when it is unreachable, so they never
break a unit run. Set `TTRSS_DB_*` and the global setup re-seeds the database
from `tests_integration/seed.sql` before the run (the tests mutate state).

```bash
# One way to stand up an instance for E2E (see also tests_integration/run.sh):
TTRSS_DB_HOST=localhost TTRSS_DB_PORT=55432 TTRSS_DB_NAME=ttrss_test \
TTRSS_DB_USER=ttrss_test TTRSS_DB_PASS=ttrss_test TTRSS_SINGLE_USER_MODE=1 \
  php ./update.php --update-schema=force-yes
E2E_BASE_URL=http://127.0.0.1:8080 corepack pnpm run test:e2e
```

Note: `TTRSS_SINGLE_USER_MODE=1` serves the app to an already-authenticated
session, so the login form is bypassed; the spec handles both cases.

### Bun (optional)

The scripts also run under [Bun](https://bun.sh) for faster local iteration
(`bun run build`, `bun run test:vue`, `bun run test:e2e`; `bun test tests/vue`
runs the same `node:test` files). **pnpm stays canonical**: CI, Dependabot and
the release workflows all use pnpm, and `pnpm install` enforces a supply-chain
policy the lockfile depends on. `bun install` is not a drop-in here — it warns
about the `"@semantic-release/npm>npm": "-"` override and blocks a postinstall
— so use `pnpm install` and, if you prefer Bun, only as the script runner.

## Frontend architecture

- `src/vue/` is the Vue app. `index.php` and `prefs.php` serve it via
  `include/vue_shell.php`; a production build (`dist/.vite/manifest.json`) is
  required.
- `src/vue/api/legacy.ts` is the transport (POST-only, CSRF in the body).
  `legacyEndpoints.ts` maps each legacy handler's response onto the shapes the
  Pinia stores expect. `client.ts` wraps both in a `{status, content}` envelope
  (`status === 0` means success).
- Do not invent data in adapters: derive it from a real field or throw a
  `LegacyProtocolError` so failures are loud.

## Backend contracts that are easy to get wrong

- Checkbox fields go through `checkbox_to_sql_bool()`, which returns 1 only for
  the literal string `"on"`; send `"on"`/`""`, never `1`/`0`.
- Handlers that mutate (`remove`, `removeCat`, `addCat`, `Pref_Filters/editSave`)
  often print nothing on success; `parseBody()` treats non-JSON as an opaque
  success. Handlers like `Pref_Labels/save` print plain text.
- `Pref_Filters/editSave` and `Pref_Feeds/editSave` rewrite every field they
  manage, so a partial request clears the rest. Re-read the record and merge
  before saving (see `saveFeed`, `saveFilter`).
- File uploads (`Pref_Feeds/importOpml`) need a multipart body via
  `LegacyBackend.upload()`; the CSRF token goes in as a form field.
- `OPML/export` is a GET that sets `Content-Disposition: attachment` and is in
  `csrf_ignore()`; navigate to it rather than fetching it.

## OpenRouter integration

`src/openrouter/` is server-side/CLI-only TypeScript that calls the OpenRouter
API through the official `@openrouter/sdk` package. It must never be imported
from `src/vue/`, which would ship `OPENROUTER_API_KEY` to the browser.

```bash
corepack pnpm run ask "What is tt-rss?"      # reads .env if present
corepack pnpm run ask "hi" --model nvidia/nemotron-3-ultra-550b-a55b:free --json
```

Configuration comes from the environment: `OPENROUTER_API_KEY` (required),
`OPENROUTER_MODEL` (defaults to the free Nemotron slug in `client.ts`) and
`OPENROUTER_BASE_URL` (defaults to `https://openrouter.ai/api/v1`; set it to
`https://eu.openrouter.ai/api/v1` for EU in-region routing). `.env` is
gitignored — keep the key there, never in `config.php` or a committed file.

Two behaviours of the SDK are easy to get wrong:

- It retries connection errors by default for up to an hour. `client.ts` passes
  its own bounded `DEFAULT_RETRY`; keep it bounded so callers fail fast.
- Node runs these files directly, so relative imports need the explicit `.ts`
  extension (`allowImportingTsExtensions` is on for that reason).

## Migration status

`VITE_MIGRATION.md` is the source of truth for the migration. The Dojo
libraries (`lib/dojo`, `lib/dijit`, `lib/dojox`, `js/*.js` AMD modules) have
been **deleted**: `index.php` and `prefs.php` serve the Vue shell only, and a
production build (`pnpm run build`) is required.

All legacy `Pref_*` screens have Vue hosts (account, users, system, feed
batch/sharing/maintenance and plugin settings), and the plugin toolbar/prefs
surfaces render through `PluginSurface`. See `VITE_MIGRATION.md` for the
remaining plugin-specific limitations.

## Distribution surfaces

- `.github/workflows/docker-publish.yml` builds the `Dockerfile` on every push
  to `main` and pushes a multi-arch image to
  `ghcr.io/ashcoft/tt-rss-non-dockerize`. The image bundles nginx, PHP-FPM and
  the built Vue bundle, listens on 8080, and is configured only through
  `TTRSS_*` environment variables (`config.php` is optional; see
  `include/functions.php`). `TTRSS_UPDATE_SCHEMA=1` runs `update.php
  --update-schema` before the server starts.
- `docker/php-fpm.conf` sets `clear_env = no`; without it the pool strips the
  `TTRSS_*` variables and the app falls back to defaults.
- `docs/` is the GitHub Pages site (`pages.yml` publishes it to
  https://ashcoft.github.io/tt-rss-non-dockerize/). Keep it in sync with the
  Dockerfile, the compose file and the config defaults when either changes.
- `docker-compose.yml` is the reference deployment: PostgreSQL plus the app and
  an `updater` service running `update_daemon2.php`.
