import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Playwright global setup: re-seed the tt-rss database so the E2E run starts
 * from a known state.
 *
 * The tests mutate real state (marking articles read removes them from the
 * default view), so a repeatable run needs fresh data. Seeding is best-effort:
 * if psql or the seed file is unavailable the run proceeds against whatever
 * state the instance has, rather than failing the whole suite.
 */
export default function globalSetup(): void {
  const seed = resolve(process.cwd(), 'tests_integration/seed.sql');
  if (!existsSync(seed)) {
    console.warn(`[e2e] seed file not found at ${seed}; skipping re-seed`);
    return;
  }

  const host = process.env.TTRSS_DB_HOST;
  const port = process.env.TTRSS_DB_PORT;
  const name = process.env.TTRSS_DB_NAME;
  const user = process.env.TTRSS_DB_USER;
  const pass = process.env.TTRSS_DB_PASS;

  if (!host || !name || !user) {
    // No DB connection details: assume the caller manages the data.
    return;
  }

  try {
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-v', 'ON_ERROR_STOP=1', '-f', seed],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    console.log('[e2e] re-seeded the test database');
  } catch (err) {
    console.warn('[e2e] could not re-seed the database; continuing with current state:', (err as Error).message);
    return;
  }

  // The seed does not cover ttrss_filters2; drop any filters earlier E2E runs
  // created so they do not accumulate.
  try {
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c', "DELETE FROM ttrss_filters2 WHERE title LIKE 'E2E %'"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (err) {
    console.warn('[e2e] could not clear leftover E2E filters:', (err as Error).message);
  }

  // Likewise drop any tags an E2E run added.
  try {
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c', "DELETE FROM ttrss_tags WHERE tag_name LIKE 'e2e%'"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (err) {
    console.warn('[e2e] could not clear leftover E2E tags:', (err as Error).message);
  }

  // Pin the display preferences the E2E tests depend on so a run starts from a
  // known layout. COMBINED_DISPLAY_MODE defaults to *on* in tt-rss; the tests
  // assume the three-pane layout, so set it off (and grid off) explicitly.
  try {
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c',
        "DELETE FROM ttrss_user_prefs2 WHERE pref_name IN ('CDM_ENABLE_GRID', 'COMBINED_DISPLAY_MODE')"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c',
        "INSERT INTO ttrss_user_prefs2 (owner_uid, pref_name, value, profile) VALUES (1, 'COMBINED_DISPLAY_MODE', '0', NULL)"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    // Enable the `note` plugin so the plugin article-button surface is testable.
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c',
        "DELETE FROM ttrss_user_prefs2 WHERE pref_name = '_ENABLED_PLUGINS'"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
    execFileSync(
      'psql',
      ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-c',
        "INSERT INTO ttrss_user_prefs2 (owner_uid, pref_name, value, profile) VALUES (1, '_ENABLED_PLUGINS', 'note', NULL)"],
      { env: { ...process.env, PGPASSWORD: pass ?? '' }, stdio: ['ignore', 'ignore', 'pipe'] }
    );
  } catch (err) {
    console.warn('[e2e] could not reset display preferences:', (err as Error).message);
  }
}
