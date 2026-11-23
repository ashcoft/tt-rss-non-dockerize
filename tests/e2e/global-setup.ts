import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Fixed, non-writable directories a psql binary is installed into. */
const PSQL_SEARCH_PATHS = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/local/bin',
];

/**
 * Resolve a command to an absolute path before running it.
 *
 * Only fixed, non-writable directories are searched so the helper cannot be
 * steered to an unintended binary by a writable PATH entry (and `execFileSync`
 * never performs its own PATH lookup). `TTRSS_PSQL_BIN` overrides the search
 * for non-standard installs.
 */
function resolveExecutable(name: string, override?: string): string | null {
  if (override) {
    if (!isAbsolute(override)) return null;
    return existsSync(override) ? override : null;
  }
  for (const dir of PSQL_SEARCH_PATHS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Connection details for the tt-rss test database. */
interface DbConfig {
  host: string;
  port: string;
  name: string;
  user: string;
  pass: string;
}

/** Run a SQL statement with psql, inheriting PGPASSWORD via the environment. */
function runSql(psql: string, db: DbConfig, args: string[]): void {
  execFileSync(
    psql,
    ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.name, '-q', ...args],
    { env: { ...process.env, PGPASSWORD: db.pass }, stdio: ['ignore', 'ignore', 'pipe'] }
  );
}

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

  const psql = resolveExecutable('psql', process.env.TTRSS_PSQL_BIN);
  if (!psql) {
    console.warn('[e2e] psql not found; skipping re-seed and preference reset');
    return;
  }

  const db: DbConfig = { host, port: port ?? '5432', name, user, pass: pass ?? '' };

  try {
    runSql(psql, db, ['-v', 'ON_ERROR_STOP=1', '-f', seed]);
    console.log('[e2e] re-seeded the test database');
  } catch (err) {
    console.warn('[e2e] could not re-seed the database; continuing with current state:', (err as Error).message);
    return;
  }

  // Drop state earlier E2E runs left behind that the seed does not cover, so it
  // does not accumulate across runs.
  try {
    runSql(psql, db, ['-c', "DELETE FROM ttrss_filters2 WHERE title LIKE 'E2E %'"]);
  } catch (err) {
    console.warn('[e2e] could not clear leftover E2E filters:', (err as Error).message);
  }

  try {
    runSql(psql, db, ['-c', "DELETE FROM ttrss_tags WHERE tag_name LIKE 'e2e%'"]);
  } catch (err) {
    console.warn('[e2e] could not clear leftover E2E tags:', (err as Error).message);
  }

  // Pin every display preference the tests depend on so a run starts from a
  // known layout. COMBINED_DISPLAY_MODE defaults to *on* in tt-rss; the tests
  // assume the three-pane layout, so set it off (and grid off) explicitly. The
  // `note` plugin is enabled so the plugin article-button surface is testable.
  const pinnedPrefs: Array<[string, string]> = [
    ['COMBINED_DISPLAY_MODE', '0'],
    ['CDM_ENABLE_GRID', '0'],
    ['SHOW_CONTENT_PREVIEW', '1'],
    ['STRIP_IMAGES', '0'],
    ['REVERSE_HEADLINES', '0'],
    ['HEADLINES_NO_DISTINCT', '0'],
    ['HIDE_READ_FEEDS', '0'],
    ['FEEDS_SORT_BY_UNREAD', '0'],
    ['CDM_AUTO_CATCHUP', '0'],
    ['HIDE_READ_SHOWS_SPECIAL', '1'],
    ['CONFIRM_FEED_CATCHUP', '1'],
    ['ENABLE_FEED_CATS', '1'],
    ['USER_CSS_THEME', 'feedly/dist/feedly.css'],
    ['DEFAULT_SEARCH_LANGUAGE', 'english'],
    ['CDM_EXPANDED', '1'],
    ['WIDESCREEN_MODE', '0'],
    ['VFEED_GROUP_BY_FEED', '0'],
    ['DEBUG_HEADLINE_IDS', '0'],
    ['_ENABLED_PLUGINS', 'auth_internal,note'],
  ];
  const names = pinnedPrefs.map(([name]) => `'${name}'`).join(', ');
  const values = pinnedPrefs
    .map(([name, value]) => `(1, '${name}', '${value}', NULL)`)
    .join(', ');

  try {
    runSql(psql, db, ['-c', `DELETE FROM ttrss_user_prefs2 WHERE pref_name IN (${names})`]);
    runSql(psql, db, ['-c',
      `INSERT INTO ttrss_user_prefs2 (owner_uid, pref_name, value, profile) VALUES ${values}`]);
  } catch (err) {
    console.warn('[e2e] could not reset display preferences:', (err as Error).message);
  }
}
