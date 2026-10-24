import { APIRequestContext, expect, Page, request, test } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Checkout and order tracking against the REAL API and the REAL database scripts:
 *   browser (production build) → AquaPure.Api.exe → PGlite (database/supabase-setup.sql + seed).
 * Only Supabase sign-in is simulated: the browser gets a token signed with a test secret that this
 * API instance is told to accept. Nothing touches your Supabase project.
 *
 * Needs: the API built (dotnet build AquaPure.sln) and `npm install` in database/.
 */
const API_PORT = 5081;
const API = `http://localhost:${API_PORT}`;
const DB_PORT = 54500 + Math.floor(Math.random() * 400);
const JWT_SECRET = 'e2e-only-' + randomBytes(32).toString('hex'); // HS256 needs at least 32 bytes
const config = JSON.parse(readFileSync('public/config.json', 'utf8')) as { supabaseUrl: string; supabasePublishableKey: string };

// Test users created by database/tests/serve.mjs
const CUSTOMER = '00000000-0000-4000-8000-000000000001';
const ADMIN = '00000000-0000-4000-8000-000000000004';

const root = path.resolve('..');
const apiExe = path.join(root, 'api/AquaPure.Api/bin/Debug/net48/AquaPure.Api.exe');

let db: ChildProcess;
let api: ChildProcess;
let http: APIRequestContext;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.skip(!existsSync(apiExe), 'Build the API first: dotnet build AquaPure.sln');
  test.setTimeout(120_000);

  db = spawn(process.execPath, ['tests/serve.mjs', String(DB_PORT)], { cwd: path.join(root, 'database'), stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    db.stdout!.on('data', (d: Buffer) => d.toString().includes('READY') && resolve());
    db.on('exit', (code) => reject(new Error('test database exited with ' + code)));
  });

  api = spawn(apiExe, [], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      API_URL: `${API}/`,
      ALLOWED_ORIGINS: 'http://localhost:4300',
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_JWT_SECRET: JWT_SECRET,
      DB_CONNECTION: `Host=127.0.0.1;Port=${DB_PORT};Username=wbms_api;Database=postgres;Maximum Pool Size=1;SSL Mode=Disable;Timeout=30`,
    },
  });
  http = await request.newContext({ baseURL: API });
  await expect.poll(async () => (await http.get('/api/health').catch(() => null))?.status(), { timeout: 30_000 }).toBe(200);
});

test.afterAll(async () => {
  await http?.dispose();
  api?.kill();
  db?.stdin?.end();
  db?.kill();
});

function token(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: userId, email, aud: 'authenticated', role: 'authenticated', iss: config.supabaseUrl + '/auth/v1', iat: now, exp: now + 3600,
  })}`;
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}

/** Points the site at the test API and answers Supabase's sign-in call with a test token. */
async function useTestBackend(page: Page) {
  await page.route('**/config.json', (r) => r.fulfill({ json: { ...config, apiBaseUrl: API } }));
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/auth/v1/token?grant_type=password', (r) =>
    r.fulfill({
      json: {
        access_token: token(CUSTOMER, 'customer@example.com'), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh',
        user: { id: CUSTOMER, aud: 'authenticated', role: 'authenticated', email: 'customer@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      },
    }),
  );
  await page.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));
}

async function signIn(page: Page, returnUrl: string) {
  await page.goto('/login?returnUrl=' + encodeURIComponent(returnUrl));
  await page.getByLabel('Email').fill('customer@example.com');
  await page.getByLabel('Password').fill('test-password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function addToCart(page: Page, slug: string, quantity = 1) {
  await page.goto('/products/' + slug);
  for (let i = 1; i < quantity; i++) await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(String(quantity));
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByText('Added to your cart.')).toBeVisible();
}

test('checkout with cash on delivery, then track and cancel the order', async ({ page }) => {
  await useTestBackend(page);
  await addToCart(page, '20-litre-water-can', 2); // ₹40 sample price each
  await signIn(page, '/checkout');
  await expect(page).toHaveURL(/\/checkout$/);

  // No saved address yet: the form is open. A pincode we do not serve is refused by the server.
  await page.getByLabel('Pincode *').fill('999999');
  await page.getByLabel('House / flat, building and street *').fill('1 Far Away Street');
  await page.getByLabel('City *').fill('Chennai');
  await page.getByLabel('Contact name *').fill('Test Customer');
  await page.getByLabel('Contact phone *').fill('98765 43210');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'we do not deliver to pincode 999999' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();

  // A served pincode (sample Zone A: free delivery).
  await page.getByRole('button', { name: 'Add another address' }).click();
  await page.getByLabel('Pincode *').fill('600001');
  await page.getByLabel('House / flat, building and street *').fill('12 Lake View Road');
  await page.getByLabel('City *').fill('Chennai');
  await page.getByLabel('Contact phone *').fill('9876543210');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByRole('radio', { name: /12 Lake View Road/ })).toBeChecked();

  const summary = page.getByRole('complementary', { name: 'Order summary' });
  await expect(summary.getByText('2 × 20 L Water Can')).toBeVisible();
  await expect(summary.locator('dl')).toContainText('Free');
  await expect(summary.locator('dl')).toContainText('Total₹80');

  // Tomorrow, morning slot (the seed's morning slot runs every day).
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByRole('radio', { name: /Morning/ }).check();
  await page.getByLabel('Delivery notes (optional)').fill('Ring the bell twice');

  // Double click: still only one order (idempotency key).
  await page.getByRole('button', { name: 'Place order' }).dblclick();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
  await expect(page.getByText('Thank you! Your order has been placed.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Order AQ\d+/);
  await expect(page.getByText('Pay on delivery')).toBeVisible();
  await expect(page.getByText('Notes: Ring the bell twice')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Placed (done)' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Confirmed (not yet)' })).toBeVisible();
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1];

  // The cart was emptied.
  await expect(page.getByRole('link', { name: 'Cart, 0 items' })).toBeVisible();

  // Order history shows exactly one order.
  await page.getByRole('link', { name: '← All orders' }).click();
  await expect(page.getByRole('list', { name: 'Your orders' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Your orders' })).toContainText('₹80');

  // Staff confirm the order (through the real admin endpoint); the customer sees the progress.
  const confirm = await http.post(`/api/admin/orders/${orderId}/status`, {
    headers: { Authorization: 'Bearer ' + token(ADMIN, 'admin@example.com') },
    data: { status: 'confirmed', note: 'Confirmed by phone' },
  });
  expect(confirm.status()).toBe(200);
  await page.getByRole('link', { name: /Order AQ/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Confirmed (done)' })).toBeVisible();
  // Confirmed orders can no longer be cancelled online.
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0);
});

test('a customer can cancel a pending order and cannot see other people\'s orders', async ({ page }) => {
  await useTestBackend(page);
  await addToCart(page, 'bottle-1l-case-12');
  await signIn(page, '/checkout');
  // Both addresses from the first test are saved; the first one (pincode 999999) became the default.
  await expect(page.getByRole('radio', { name: /1 Far Away Street/ })).toBeChecked();
  await page.getByRole('radio', { name: /12 Lake View Road/ }).check();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByRole('radio', { name: /Evening|Midday|Morning/ }).first().check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancel this order' }).click();
  await expect(page.getByText('This order was cancelled')).toBeVisible();
  await expect(page.getByText('Reason: Cancelled by customer')).toBeVisible();

  // An order id that is not theirs (or does not exist) is simply "not found".
  await page.goto('/orders/11111111-1111-4111-8111-111111111111');
  await expect(page.getByRole('alert')).toContainText('not found');
});
