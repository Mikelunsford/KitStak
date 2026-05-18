import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config. Chromium only for the smoke and rls probes. The smoke
 * spec stays skipped until staging Supabase secrets are wired (Phase 5).
 * The `test:rls` and `test:e2e` scripts in package.json target this config.
 *
 * webServer only runs locally; in CI we assume an external preview deploy
 * already exists at PLAYWRIGHT_BASE_URL.
 */
export default defineConfig({
  testDir: './playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
