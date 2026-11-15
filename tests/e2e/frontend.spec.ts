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
  // The tree loads its feeds just after login, so wait for the group first.
  await header.waitFor({ state: 'visible', timeout: 15000 });
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
    // The dialog title and the help content both mention "Keyboard shortcuts".
    await expect(page.getByRole('dialog').getByText('Keyboard shortcuts').first()).toBeVisible();
  });

  test('renders an icon (or RSS fallback) for each seeded feed', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Technology');
    await expect(page.getByText('Hacker News', { exact: true })).toBeVisible({ timeout: 15000 });

    // Each feed row shows either its real icon or the RSS glyph fallback once
    // the icon request settles (the seed data has no cached icons, so the
    // glyph is the expected steady state here).
    const rows = page.locator('.feed-list .v-list-item').filter({ hasText: /Hacker News|Ars Technica/ });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await expect(row.locator('.feed-icon, .mdi-rss').first()).toBeVisible();
    }
  });

  test('opens an article in the reading pane', async ({ page }) => {
    await login(page);
    // "All Articles" includes read items, so this test does not depend on
    // running before the ones that mark articles read.
    await expandCategory(page, 'Special');
    await page.getByText('All Articles', { exact: true }).click();

    const headline = page.getByText('PostgreSQL 18 released with major performance improvements');
    await expect(headline).toBeVisible({ timeout: 15000 });
    await headline.click();

    // The reading pane (ArticleView) shows the article body and its actions.
    await expect(page.getByText('View Original')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Mark above as read' })).toBeVisible();
  });

  test('bulk-selects headlines and marks them read', async ({ page }) => {
    await login(page);
    // Use Ars Technica: no other test reads its articles, and marking read
    // removes them from the default (unread) view.
    await expandCategory(page, 'Technology');
    await page.getByText('Ars Technica', { exact: true }).click();
    await expect(
      page.getByText('Apple announces new M5 chip with 40% faster neural engine')
    ).toBeVisible({ timeout: 15000 });

    // The Select menu offers All/Unread/Invert/None; pick "All".
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('listitem').filter({ hasText: 'All' }).first().click();

    await expect(page.getByText(/selected/)).toBeVisible();
    await page.getByRole('button', { name: 'Mark read' }).click();
    // The action reports success through the app snackbar.
    await expect(page.locator('.v-snackbar')).toContainText(/marked as read/i, { timeout: 10000 });
  });

  test('marks a feed as read from its row action', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Technology');

    // The per-feed action buttons sit in the row; "Mark feed as read" calls the
    // backend catchup and reports through the snackbar.
    const row = page.locator('.feed-list .v-list-item').filter({ hasText: 'The Register' }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: 'Mark feed as read' }).click();

    await expect(page.locator('.v-snackbar')).toContainText(/marked as read/i, { timeout: 10000 });
  });

  test('renders article attachments (enclosures)', async ({ page }) => {
    await login(page);

    // Use the "All Articles" special feed: it includes read articles, so this
    // test does not depend on running before the one that opens an article.
    await expandCategory(page, 'Special');
    await page.getByText('All Articles', { exact: true }).click();

    const headline = page.getByText('Show HN: I built a distributed task queue in Rust');
    await expect(headline).toBeVisible({ timeout: 15000 });
    await headline.click();

    // The seeded article has an mp4 enclosure (played inline) and an image
    // enclosure (shown as a link).
    const attachments = page.locator('.article-attachments');
    await expect(attachments).toBeVisible({ timeout: 15000 });
    await expect(attachments.locator('video')).toHaveCount(1);
    await expect(attachments.locator('a')).toContainText('Thumbnail');
  });

  test('bulk-sets a score on the selected headlines', async ({ page }) => {
    await login(page);
    // Ars Technica's articles are not read by other tests.
    await expandCategory(page, 'Technology');
    await page.getByText('Ars Technica', { exact: true }).click();
    await expect(
      page.getByText('Apple announces new M5 chip with 40% faster neural engine')
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('listitem').filter({ hasText: 'All' }).first().click();
    await expect(page.getByText(/selected/)).toBeVisible();

    // The score prompt is a native dialog; answer it, then expect success.
    page.once('dialog', (dialog) => dialog.accept('5'));
    await page.getByRole('button', { name: 'Set score' }).click();
    await expect(page.locator('.v-snackbar')).toContainText(/score set/i, { timeout: 10000 });
  });

  test('stars a headline and it appears in the Starred feed', async ({ page }) => {
    await login(page);
    // Use "All Articles" so the row is present regardless of read state.
    await expandCategory(page, 'Special');
    await page.getByText('All Articles', { exact: true }).click();

    const row = page.locator('.headlines-list-content .v-list-item').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const title = (await row.locator('.headline-title').innerText()).trim();

    // Star it, then confirm the Starred feed now contains it.
    await row.getByRole('button', { name: 'Star' }).click();
    await page.getByText('Starred', { exact: true }).click();
    const starred = page.locator('.headlines-list-content .v-list-item').filter({ hasText: title });
    await expect(starred).toHaveCount(1, { timeout: 15000 });

    // Unstar it again; the button flips back and the article leaves the feed on
    // the next load (the list is not re-fetched in place).
    await starred.first().getByRole('button', { name: 'Unstar' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Preferences' }).waitFor({ timeout: 15000 });
    await expandCategory(page, 'Special');
    await page.getByText('Starred', { exact: true }).click();
    await expect(
      page.locator('.headlines-list-content .v-list-item').filter({ hasText: title })
    ).toHaveCount(0, { timeout: 15000 });
  });

  test('the Starred feed lists exactly the starred articles', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.getByText('Starred', { exact: true }).click();

    // The seed stars articles 3, 8 and 11; the feed must show exactly those
    // and nothing else (verifies the special-feed id maps to the right view).
    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles).toHaveCount(3, { timeout: 15000 });
    await expect(titles).toContainText(['The rise of WebAssembly in server-side applications']);
  });

  test('the label feed lists the labelled articles', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Labels');
    await page.getByText('test-label-1', { exact: true }).click();

    // Selecting the label must request the synthetic label feed id
    // (LABEL_BASE_INDEX - 1 - labelId), not the raw id (which the backend would
    // treat as a regular feed). Switch to "All Articles" so the assertion does
    // not depend on which labelled articles earlier tests happened to read.
    const show = page.getByRole('combobox', { name: 'Show' });
    await show.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('option', { name: 'All Articles' }).click();

    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles).toHaveCount(2, { timeout: 15000 });
    await expect(titles).toContainText(['Show HN: I built a distributed task queue in Rust']);
  });

  test('toggles the light/dark theme', async ({ page }) => {
    await login(page);
    const app = page.locator('.v-application');
    await expect(app).toHaveClass(/v-theme--light/);

    await page.getByRole('button', { name: 'Toggle light/dark theme' }).click();
    await expect(app).toHaveClass(/v-theme--dark/);
  });

  test('creates a content filter from the preferences dialog', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('tab', { name: 'Filters' }).click();
    await page.getByRole('button', { name: 'New filter' }).click();

    const editor = page.getByRole('dialog').last();
    await editor.getByLabel('Title').fill('E2E Filter');
    await editor.getByRole('button', { name: 'Add rule' }).click();
    await editor.getByLabel('Regular expression').first().fill('test');
    await editor.getByRole('button', { name: 'Save' }).click();

    // The editor reports success; the filter is now in the list.
    await expect(editor.locator('.v-alert')).toContainText(/filter saved/i, { timeout: 10000 });
    await expect(page.getByText('E2E Filter')).toBeVisible({ timeout: 10000 });
  });

  test('toggles a boolean preference and persists it', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The first preference is "Combined mode"; toggling it saves immediately and
    // the dialog reports the result in its own alert (not the app snackbar).
    const checkbox = page.getByLabel(/Combined mode/).first();
    const before = await checkbox.isChecked();
    await checkbox.click();
    await expect(page.getByRole('dialog').locator('.v-alert')).toContainText(/saved/i, {
      timeout: 10000,
    });

    // Reloading keeps the new value (it round-tripped through the backend).
    await page.reload();
    await page.getByRole('button', { name: 'Preferences' }).click();
    const after = page.getByLabel(/Combined mode/).first();
    await expect(after).toBeChecked({ checked: !before });
  });
});
