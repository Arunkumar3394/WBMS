import { defineConfig } from '@playwright/test';

/**
 * Browser tests against the production build (served on :4300) and a running API on :5080.
 * Start the API first, then:  npm run e2e   (builds the site and serves it automatically)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4300',
    channel: 'chrome', // uses the installed Google Chrome
    trace: 'retain-on-failure',
  },
  webServer: process.env['E2E_BASE_URL'] ? undefined : {
    command: 'node e2e/serve-dist.mjs 4300',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
