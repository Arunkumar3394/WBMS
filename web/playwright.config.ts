import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Browser tests against the production build (served on :4300) and a running API on :5080.
 * Start the API first, then:  npm run e2e   (builds the site and serves it automatically)
 */

/**
 * Some Indian ISPs answer DNS lookups for *.supabase.co with 127.0.0.1. Windows can be set to
 * encrypted DNS, but Chrome does its own lookups. So we ask Node (which uses the Windows resolver)
 * for the project's real address and tell the test browser to use it. On a normal network this
 * changes nothing; if the lookup fails we simply skip it.
 */
function supabaseHostRule(): string[] {
  try {
    const { supabaseUrl } = JSON.parse(readFileSync('public/config.json', 'utf8'));
    const host = new URL(supabaseUrl).hostname;
    const ip = execFileSync(process.execPath, ['-e', `require('dns').lookup(${JSON.stringify(host)}, 4, (e, a) => process.stdout.write(e ? '' : a))`], {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.') ? [`--host-resolver-rules=MAP ${host} ${ip}`] : [];
  } catch {
    return [];
  }
}

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
    screenshot: 'only-on-failure',
    launchOptions: { args: supabaseHostRule() },
  },
  webServer: process.env['E2E_BASE_URL'] ? undefined : {
    command: 'node e2e/serve-dist.mjs 4300',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'phone', testIgnore: /fullstack/, use: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', testIgnore: /fullstack/, use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop', testIgnore: /fullstack/, use: { viewport: { width: 1280, height: 800 } } },
    // Real API + real database scripts (in memory); starts its own API on :5081. See e2e/fullstack.spec.ts.
    { name: 'fullstack', testMatch: /fullstack/, use: { viewport: { width: 1280, height: 800 } } },
  ],
});
