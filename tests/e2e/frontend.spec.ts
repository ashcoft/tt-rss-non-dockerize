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
  // The Special group starts expanded; clicking it would collapse it.
  const isOpen = await header.evaluate((el) =>
    el.parentElement?.classList.contains('v-list-group--open')
  );

  if (isOpen !== true) {
    await header.click();
  }
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
    // Search covers the selected view, so search All articles.
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();
    // Search finds the article regardless of read state, unlike the default
    // (adaptive) list which hides articles earlier tests marked read.
    const searchBox = page.getByPlaceholder('Search articles...');
    await searchBox.fill('PostgreSQL');
    await searchBox.press('Enter');

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
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'All' }).first().click();

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
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

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
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'All' }).first().click();
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
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    const row = page.locator('.headlines-list-content .v-list-item').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const title = (await row.locator('.headline-title').innerText()).trim();

    // Star it, then confirm the Starred feed now contains it.
    await row.getByRole('button', { name: 'Star' }).click();
    await page.locator('.feed-list').getByText('Starred articles', { exact: true }).click();
    const starred = page.locator('.headlines-list-content .v-list-item').filter({ hasText: title });
    await expect(starred).toHaveCount(1, { timeout: 15000 });

    // Unstar it again; the button flips back and the article leaves the feed on
    // the next load (the list is not re-fetched in place).
    await starred.first().getByRole('button', { name: 'Unstar' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Preferences' }).waitFor({ timeout: 15000 });
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('Starred articles', { exact: true }).click();
    await expect(
      page.locator('.headlines-list-content .v-list-item').filter({ hasText: title })
    ).toHaveCount(0, { timeout: 15000 });
  });

  test('selecting a category shows its feeds\' articles', async ({ page }) => {
    await login(page);
    // The "Technology" category holds Hacker News, The Register and Ars Technica.
    const header = page.locator('.feed-list .v-list-group__header').filter({ hasText: 'Technology' }).first();
    await header.waitFor({ state: 'visible', timeout: 15000 });

    // Selecting the category must request the category itself (cat=1), not
    // one of its member feeds.
    const categoryView = page.waitForResponse((response) => {
      const body = response.request().postData() ?? '';
      return body.includes('op=Feeds') && body.includes('method=view') && body.includes('cat=1');
    });
    await header.click();
    await categoryView;

    // The category's list is populated (the request above proves it asked for
    // the category rather than a single feed; the rows depend on read state).
    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles.first()).toBeVisible({ timeout: 15000 });
  });

  test('the Starred feed lists exactly the starred articles', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('Starred articles', { exact: true }).click();

    // The seed stars articles 3, 8 and 11; the feed must show exactly those
    // and nothing else (verifies the special-feed id maps to the right view).
    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles).toHaveCount(3, { timeout: 15000 });
    await expect(titles).toContainText(['The rise of WebAssembly in server-side applications']);
  });

  test('the label feed lists the labelled articles', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Labels');
    // Selecting the label must request the synthetic label feed id
    // (LABEL_BASE_INDEX - 1 - labelId), not the raw id (which the backend would
    // treat as a regular feed). Wait for that request before touching the
    // toolbar: its re-render would otherwise close the view-mode menu.
    const labelView = page.waitForResponse((response) => {
      const body = response.request().postData() ?? '';
      if (!body.includes('op=Feeds') || !body.includes('method=view')) return false;
      return Number(new URLSearchParams(body).get('feed')) < -1024;
    });
    await page.locator('.feed-list').getByText('test-label-1', { exact: true }).click();
    const request = await labelView;

    // The backend treats ids below LABEL_BASE_INDEX (-1024) as labels; the raw
    // positive label id would be requested as a regular feed.
    const feedParam = new URLSearchParams(request.request().postData() ?? '').get('feed');
    expect(Number(feedParam)).toBeLessThan(-1024);

    // The adapter/backend mapping is what this test guards; the exact number
    // of rows also depends on read state left by earlier tests, so assert that
    // every listed article is one of the labelled ones.
    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles.first()).toBeVisible({ timeout: 15000 });

    const labelled = [
      'Show HN: I built a distributed task queue in Rust',
      'New battery technology could double electric vehicle range',
    ];
    for (const text of await titles.allInnerTexts()) {
      expect(labelled.some((title) => text.trim().startsWith(title))).toBe(true);
    }
  });

  test('shows a feed update error in the toolbar', async ({ page }) => {
    await login(page);
    // The seed marks Hacker News (feed 1) with a last_error; opening it shows
    // the error icon next to the feed title.
    await expandCategory(page, 'Technology');
    await page.getByText('Hacker News', { exact: true }).click();

    const errorIcon = page.locator('.toolbar-center .v-icon.mdi-alert-circle');
    await expect(errorIcon).toBeVisible({ timeout: 15000 });
    await expect(errorIcon).toHaveAttribute('title', /error|not found/i);
  });

  test('toggles combined display mode', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();
    await expect(page.locator('.headlines-list-content .v-list-item').first()).toBeVisible({
      timeout: 15000,
    });

    // No inline content in the default (three-pane) layout.
    await expect(page.locator('.headline-content')).toHaveCount(0);

    // Toggle combined mode from the toolbar's action menu.
    await page.locator('.toolbar-right button').last().click();
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'Toggle combined mode' }).first().click();

    // Every loaded headline now renders its body inline, with its feed label.
    await expect(page.locator('.headline-content').first()).toBeVisible({ timeout: 10000 });
    const count = await page.locator('.headlines-list-content .v-list-item').count();
    await expect(page.locator('.headline-content')).toHaveCount(count);
    await expect(page.locator('.headline-feed-label').first()).toBeVisible();

    // Turn it back off: it is a persisted preference, so leaving it on would
    // change the layout for later tests.
    await page.locator('.toolbar-right button').last().click();
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'Toggle combined mode' }).first().click();
    await expect(page.locator('.headline-content')).toHaveCount(0, { timeout: 10000 });
  });

  test('shows the article image preview in combined mode', async ({ page }) => {
    await login(page);
    // Search covers the selected view, so search All articles.
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    // Search finds the seeded article with an image enclosure regardless of
    // read state.
    const searchBox = page.getByPlaceholder('Search articles...');
    await searchBox.fill('distributed task queue');
    await searchBox.press('Enter');
    await expect(page.locator('.headlines-list-content .v-list-item').first()).toBeVisible({
      timeout: 15000,
    });

    await page.locator('.toolbar-right button').last().click();
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'Toggle combined mode' }).first().click();

    const preview = page.locator('.headline-image-preview');
    await expect(preview.first()).toBeVisible({ timeout: 10000 });
    await expect(preview.first()).toHaveAttribute('src', /hqdefault\.jpg/);

    // Reset the preference.
    await page.locator('.toolbar-right button').last().click();
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'Toggle combined mode' }).first().click();
    await expect(page.locator('.headline-content')).toHaveCount(0, { timeout: 10000 });
  });

  test('marks the articles below one as read', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    // Open the first article and mark everything below it read. The exact count
    // depends on what earlier tests read, so assert the action reports a result
    // rather than a fixed number.
    const rows = page.locator('.headlines-list-content .v-list-item');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await rows.first().locator('.headline-title').click();

    await page.getByRole('button', { name: 'Mark below as read' }).click();
    await expect(page.locator('.v-snackbar')).toContainText(/as read|No unread/i, {
      timeout: 10000,
    });
  });

  test('shows the comments link for an article with comments', async ({ page }) => {
    await login(page);
    // Search covers the selected view, so search All articles.
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();
    // Search finds the article regardless of read state, unlike the default
    // (adaptive) list which hides articles earlier tests marked read.
    const searchBox = page.getByPlaceholder('Search articles...');
    await searchBox.fill('PostgreSQL');
    await searchBox.press('Enter');

    const row = page
      .locator('.headlines-list-content .v-list-item')
      .filter({ hasText: 'PostgreSQL 18' })
      .first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.locator('.headline-title').click();

    // The seed gives "PostgreSQL 18" a two-comment thread.
    await expect(page.locator('.article-meta .comments')).toContainText('2 comments', {
      timeout: 15000,
    });
  });

  test('adds a tag to an article', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    await page.locator('.headlines-list-content .v-list-item-title').first().click();

    // Type a tag into the combobox and commit it with Enter; the store saves
    // the whole tag list via Article/setArticleTags. Vuetify renders a hidden
    // input before the real one, so target the last.
    const input = page.locator('.article-view .v-combobox input').last();
    await input.fill('e2etag');
    await input.press('Enter');

    // The chip is rendered once the list round-trips.
    await expect(page.locator('.article-view .v-chip').filter({ hasText: 'e2etag' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('shows the headline excerpt in the list', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    // Each row renders its content preview, with the HTML entity decoded.
    const preview = page.locator('.headline-preview').first();
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview).toContainText('—');
  });

  test('searches articles by term', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    const searchBox = page.getByPlaceholder('Search articles...');
    await searchBox.fill('kubernetes');
    await searchBox.press('Enter');

    // The seeded "Kubernetes" article is the only match.
    const titles = page.locator('.headlines-list-content .v-list-item-title');
    await expect(titles).toHaveCount(1, { timeout: 15000 });
    await expect(titles).toContainText(['How Kubernetes evolved']);
  });

  test('toggles the light/dark theme', async ({ page }) => {
    await login(page);
    const app = page.locator('.v-application');
    await expect(app).toHaveClass(/v-theme--light/);

    await page.getByRole('button', { name: 'Toggle light/dark theme' }).click();
    await expect(app).toHaveClass(/v-theme--dark/);
  });

  test('applies the grid view in combined mode', async ({ page }) => {
    await login(page);

    // Enable combined mode and the grid preference via the preferences dialog,
    // then reload: display preferences are read from init-params on load.
    await page.getByRole('button', { name: 'Preferences' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Combined mode/).first().check();
    await dialog.getByLabel(/Grid view/).first().check();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Preferences' })).toBeVisible({ timeout: 15000 });
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();

    // The list is now a CSS grid with inline article content.
    const list = page.locator('.headlines-list-content');
    await expect(list).toHaveClass(/headlines-grid/, { timeout: 15000 });
    expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
    await expect(page.locator('.headline-content').first()).toBeVisible();

    // Reset both preferences so later tests see the default layout.
    await page.getByRole('button', { name: 'Preferences' }).click();
    await dialog.getByLabel(/Combined mode/).first().uncheck();
    await dialog.getByLabel(/Grid view/).first().uncheck();
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('lists plugins and saves the enabled set', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    await page.getByRole('tab', { name: 'Plugins' }).click();

    // The bundled plugins are listed (auth_internal is system-enabled).
    const rows = page.locator('.plugin-list .v-list-item');
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    expect(await rows.count()).toBeGreaterThan(0);

    // Saving the current selection round-trips to the backend.
    await page.getByRole('button', { name: 'Enable selected' }).click();
    await expect(page.getByRole('dialog').locator('.v-alert')).toContainText(/plugins updated/i, {
      timeout: 10000,
    });
  });

  test('prefs.php serves the Vue app with the preferences dialog open', async ({ page }) => {
    await page.goto('/prefs.php');
    await expect(page.getByRole('button', { name: 'Preferences' })).toBeVisible({ timeout: 15000 });

    // The legacy Dojo preferences page is gone; the dialog opens on mount.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Plugins' })).toBeVisible();
  });

  test('runs a plugin article button and shows its dialog', async ({ page }) => {
    await login(page);
    await expandCategory(page, 'Special');
    await page.locator('.feed-list').getByText('All articles', { exact: true }).click();
    await expect(page.locator('.headlines-list-content .v-list-item-title').first()).toBeVisible({
      timeout: 15000,
    });

    await page.locator('.headlines-list-content .v-list-item-title').first().click();

    // The `note` plugin's HOOK_ARTICLE_BUTTON renders an "Edit article note"
    // button; clicking it invokes PluginHandler and shows the returned form.
    const noteButton = page.getByRole('button', { name: 'Edit article note' });
    await expect(noteButton).toBeVisible({ timeout: 15000 });
    await noteButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.plugin-dialog-body textarea')).toBeVisible();
  });

  test('the preferences dialog surfaces the full backend preference set', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Preferences' }).click();
    const dialog = page.getByRole('dialog');

    // The General tab lists the curated preferences.
    await expect(dialog.locator('.v-window-item').nth(0).locator('.v-list-item').first()).toBeVisible({
      timeout: 15000,
    });

    // The Advanced tab lists the rest of the backend's preferences.
    await dialog.getByRole('tab', { name: 'Advanced' }).click();
    const advanced = dialog.locator('.v-window-item').nth(1);
    await expect(advanced.locator('.v-list-item').first()).toBeVisible();
    expect(await advanced.locator('.v-list-item').count()).toBeGreaterThan(0);
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
