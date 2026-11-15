import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end tests for the Vue front-end against a real tt-rss instance.
 *
 * These need a running backend (`index.php` serving the built Vue app, talking
 * to `backend.php`) with the seeded test data. Set E2E_BASE_URL to point at it.
 * The whole file is skipped when that instance is not reachable, so it never
 * breaks a unit-test run.
 *
 * Credentials come from E2E_USER / E2E_PASSWORD (default admin / password,
 * which is the seeded tt-rss admin).
 */

const USER = process.env.E2E_USER ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'password';

async function backendReachable(page: Page): Promise<boolean> {
  try {
    const response = await page.request.get('/index.php', { timeout: 5000 });
    return response.ok();
  } catch {
    return false;
  }
}

/** Log in through the Vue login form, or adopt an existing session. */
async function login(page: Page): Promise<void> {
  await page.goto('/index.php');

  const shell = page.getByRole('button', { name: 'Preferences' });

  // In single-user mode the shell is served to an already-authenticated
  // session. Wait for it; fall back to the login form only if it never appears
  // (the form briefly renders before the session is adopted, so we must not
  // act on it while the shell is on its way).
  try {
    await expect(shell).toBeVisible({ timeout: 15000 });
    return;
  } catch {
    // No existing session: sign in.
  }

  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(shell).toBeVisible({ timeout: 15000 });
}

/** Expand a feed-tree category group so its feeds become visible. */
async function expandCategory(page: Page, title: string): Promise<void> {
  const header = page
    .locator('.feed-list .v-list-group__header')
    .filter({ hasText: title })
    .first();
  await header.click();
}

test.describe('Vue front-end', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!(await backendReachable(page)), 'no tt-rss backend reachable at baseURL');
  });

  test('logs in and shows the three-pane shell', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Tiny Tiny RSS')).toBeVisible();
    await expect(page.getByPlaceholder('Search feeds...')).toBeVisible();
    await expect(page.getByPlaceholder('Search articles...')).toBeVisible();
  });

  test('lists seeded feeds and loads headlines when a feed is selected', async ({ page }) => {
    await login(page);

    // The seeded "Hacker News" feed is nested in the "Technology" category, so
    // expand that group before clicking it.
    await expandCategory(page, 'Technology');

    const feed = page.getByText('Hacker News', { exact: true });
    await expect(feed).toBeVisible({ timeout: 15000 });
    await feed.click();

    await expect(
      page.getByText('Show HN: I built a distributed task queue in Rust')
    ).toBeVisible({ timeout: 15000 });
  });

  test('opens the preferences dialog and shows the Plugins tab', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Preferences' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('tab', { name: 'Plugins' }).click();
    await expect(page.locator('.plugin-list .v-list-item').first()).toBeVisible({ timeout: 15000 });
  });

  test('opens the keyboard-shortcuts help', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
  });

  test('renders feed icons for the seeded feeds', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Technology');
    await expect(page.getByText('Hacker News', { exact: true })).toBeVisible({ timeout: 15000 });
    const icons = page.locator('.feed-icon');
    expect(await icons.count()).toBeGreaterThan(0);
  });
});
