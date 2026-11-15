# AGENTS.md

## Project

Tiny Tiny RSS (tt-rss), a self-hosted web feed reader. PHP backend
(`backend.php` dispatches `op`/`method` to `classes/*.php` handlers) with a
frontend that is mid-migration from Dojo 1.x to Vue 3 + Vuetify + Pinia.

## Frontend build and checks

Dependencies are managed with pnpm (see `pnpm-lock.yaml`). Enable it with
`corepack pnpm` if `pnpm` is not on PATH.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build        # vite build
corepack pnpm run type-check   # tsc --noEmit
corepack pnpm run test:vue     # node --test tests/vue/*.test.mjs
corepack pnpm run lint:vue     # eslint src/vue
corepack pnpm run lint:js      # eslint js src plugins
```

Run all five before finishing a frontend change; CI runs them on every PR.

## Frontend architecture

- `src/vue/` is the Vue app. `index.php` serves it via `include/vue_shell.php`
  when `dist/.vite/manifest.json` exists; set `VUE_LEGACY_SHELL=1` for the Dojo
  shell.
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

## Migration status

`VITE_MIGRATION.md` is the source of truth for what has moved to Vue and what
is still on Dojo. Update its "Still on Dojo" list when you complete an item.
The Dojo libraries (`lib/dojo`, `lib/dijit`, `js/*.js`) must stay until every
item on that list is ported.
