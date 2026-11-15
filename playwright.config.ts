import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Vue front-end end-to-end tests.
 *
 * These run against a real tt-rss instance: `index.php` serves the built Vue
 * app, which talks to `backend.php`. `E2E_BASE_URL` points at that instance
 * (default http://localhost:8080). The tests are skipped unless the instance
 * is reachable, so `pnpm test:vue` stays the fast unit suite.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
    // The tt-rss UI is a desktop three-pane layout.
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
