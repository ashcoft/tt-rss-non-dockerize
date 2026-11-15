import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Playwright global setup: re-seed the tt-rss database so the E2E run starts
 * from a known state.
 *
 * The tests mutate real state (marking articles read removes them from the
 * default view), so a repeatable run needs fresh data. Seeding is best-effort:
 * if psql or the seed file is unavailable, the run proceeds against whatever
 * state the instance has (tests that depend on unread articles may then be
 * skipped or fail, which is preferable to a hard error).
 */
export default function globalSetup(): void {
  const seed = fileURLToPath(new URL('../tests_integration/seed.sql', import.meta.url));
  if (!existsSync(seed)) return;

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
    execFileSync('psql', ['-h', host, '-p', port ?? '5432', '-U', user, '-d', name, '-q', '-f', seed], {
      env: { ...process.env, PGPASSWORD: pass ?? '' },
      stdio: 'ignore',
    });
    console.log('[e2e] re-seeded the test database');
  } catch (err) {
    console.warn('[e2e] could not re-seed the database; continuing with current state', err);
  }
}
