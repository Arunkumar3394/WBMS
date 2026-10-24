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
const STAFF = '00000000-0000-4000-8000-000000000003';
const ADMIN = '00000000-0000-4000-8000-000000000004';
const EMAILS: Record<string, string> = { [CUSTOMER]: 'customer@example.com', [STAFF]: 'staff@example.com', [ADMIN]: 'admin@example.com' };

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
async function useTestBackend(page: Page, user = CUSTOMER) {
  const email = EMAILS[user];
  await page.route('**/config.json', (r) => r.fulfill({ json: { ...config, apiBaseUrl: API } }));
  const now = Math.floor(Date.now() / 1000);
  await page.route('**/auth/v1/token?grant_type=password', (r) =>
    r.fulfill({
      json: {
        access_token: token(user, email), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'test-refresh',
        user: { id: user, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
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

// ---------------------------------------------------------------- Staff and admin
test('customers cannot open the admin area; staff see only their pages', async ({ page }) => {
  await useTestBackend(page, CUSTOMER);
  await signIn(page, '/admin');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('link', { name: 'Admin dashboard' })).toHaveCount(0);

  const staff = await page.context().browser()!.newPage({ baseURL: 'http://localhost:4300' });
  await useTestBackend(staff, STAFF);
  await signIn(staff, '/admin');
  await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const nav = staff.getByRole('navigation', { name: 'Admin' }).last();
  await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Products' })).toHaveCount(0);
  await staff.goto('/admin/products');
  await expect(staff).toHaveURL(/\/admin$/);
  // And the API itself refuses (not just the menu).
  const res = await http.get('/api/admin/products', { headers: { Authorization: 'Bearer ' + token(STAFF, 'staff@example.com') } });
  expect(res.status()).toBe(403);
  await staff.close();
});

test('staff deliver an order and record the cash', async ({ page }) => {
  await useTestBackend(page, STAFF);
  await signIn(page, '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Orders' }).click();
  await page.getByLabel('Status').selectOption('confirmed');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(/status=confirmed/);
  await expect(page.locator('tbody tr')).toHaveCount(1); // the order confirmed in the first test
  await page.locator('tbody tr a').first().click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Order AQ\d+/);
  await expect(page.getByText('Customer note: Ring the bell twice')).toBeVisible();
  await page.getByRole('button', { name: 'Out for delivery' }).click();
  await expect(page.getByText('Order marked as out for delivery.')).toBeVisible();
  await page.getByLabel('Empty cans collected').fill('2');
  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(page.getByText('Order marked as delivered.')).toBeVisible();
  await expect(page.getByText('Cans delivered: 2 · Empties collected: 2')).toBeVisible(); // counted from the order

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Cash \/ UPI received/ }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await expect(page.getByText('Paid on delivery')).toBeVisible();

  await page.getByLabel('Staff notes (not shown to the customer)').fill('Gate code 1234');
  await page.getByRole('button', { name: 'Save notes' }).click();
  await expect(page.getByText('Notes saved.')).toBeVisible();
});

test('admin manages products, stock, delivery zones, settings, enquiries and customers', async ({ page }) => {
  // Supabase Storage is simulated; the bucket's admin-only rule is in database/migrations/0007_storage.sql.
  await page.route('**/storage/v1/object/product-images/**', (r) => r.fulfill({ json: { Key: 'product-images/x.png', Id: 'x' } }));
  await useTestBackend(page, ADMIN);
  await signIn(page, '/admin/products');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

  // Edit a product: new price, no longer a sample price, an image.
  const row = page.locator('tbody tr', { hasText: '20 L Water Can' }).first();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Price (₹) *').fill('45');
  await page.getByLabel(/Mark the price as a sample/).uncheck();
  await page.locator('input[type=file]').setInputFiles({ name: 'can.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await expect(page.getByRole('img', { name: 'Current product image' })).toHaveAttribute('src', /product-images\/products\/20-litre-water-can-/);
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Saved 20 L Water Can.')).toBeVisible();
  const product = await (await http.get('/api/catalog/products/20-litre-water-can')).json();
  expect(Number(product.price)).toBe(45);
  expect(product.is_sample_price).toBe(false);
  expect(product.image_path).toMatch(/^products\/20-litre-water-can-.*\.png$/);

  // Stock: a restock is recorded with its history.
  await row.getByRole('button', { name: 'Stock' }).click();
  await page.getByLabel('Change (+ in, − out)').fill('10');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText(/Stock for 20 L Water Can is now \d+\./)).toBeVisible();
  await expect(page.getByRole('cell', { name: '+10' })).toBeVisible();

  // Delivery zone: bad pincodes are caught, then a new zone is saved and served.
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Delivery' }).click();
  await page.getByRole('button', { name: 'Add zone' }).click();
  await page.getByLabel('Zone name *').fill('Zone C – Test');
  await page.getByLabel('Pincodes *').fill('600050 60005');
  await page.getByRole('button', { name: 'Save zone' }).click();
  await expect(page.getByText('These are not valid 6-digit pincodes: 60005')).toBeVisible();
  await page.getByLabel('Pincodes *').fill('600050, 600051');
  await page.getByLabel('Delivery charge (₹)').fill('25');
  await page.getByRole('button', { name: 'Save zone' }).click();
  await expect(page.getByText('600050, 600051')).toBeVisible();
  expect((await (await http.get('/api/delivery/check?pincode=600051')).json()).served).toBe(true);

  // Settings: a closed day is saved.
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Settings' }).click();
  const settings = await (await http.get('/api/settings')).json();
  const closed = new Date(Date.parse(settings.today + 'T00:00:00Z') + 2 * 86400_000).toISOString().slice(0, 10);
  await page.getByLabel('Closed dates (no deliveries)').fill(closed);
  await page.getByRole('button', { name: 'Add date' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  expect((await (await http.get('/api/settings')).json()).closed_dates).toContain(closed);

  // Enquiries: one from the public form appears as new and can be moved along.
  const sent = await http.post('/api/enquiries', { data: { enquiry_type: 'monthly_supply', name: 'Priya Office', phone: '9123456780', message: 'Need 40 cans a month for our office.' } });
  expect(sent.status()).toBe(200);
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Enquiries' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Priya Office' });
  await expect(card).toContainText('Monthly supply');
  await card.getByLabel('Status').selectOption('in_progress');
  await card.getByLabel('Notes').fill('Called back, sending quote');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('button', { name: 'Saved ✓' })).toBeVisible();

  // Customers: find one, see their orders, record a can adjustment.
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Customers' }).click();
  await page.getByLabel('Search').fill('Test Customer');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: 'Test Customer' }).click();
  await expect(page.getByRole('heading', { name: /Orders \(2\)/ })).toBeVisible();
  await page.getByLabel('Entry').selectOption('adjustment');
  await page.getByLabel('Cans (+/−)').fill('2');
  await page.getByLabel('Amount (+/− ₹)').fill('300');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Deposit entry recorded.')).toBeVisible();
  await expect(page.getByText('Cans held with a deposit: 2')).toBeVisible();

  // Reports: the delivered ₹80 order counts as sales and as collected.
  await page.getByRole('navigation', { name: 'Admin' }).last().getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'By product' })).toBeVisible();
  await expect(page.locator('section', { hasText: 'By product' })).toContainText('20 L Water Can');
  await expect(page.locator('.card', { hasText: 'Collected (paid)' })).toContainText('₹80');
});

test('every admin page fits a phone screen (no sideways scrolling)', async ({ page }) => {
  await useTestBackend(page, ADMIN);
  await signIn(page, '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 740 });
  const pages = ['/admin', '/admin/orders', '/admin/customers', '/admin/enquiries', '/admin/reports', '/admin/products',
    '/admin/categories', '/admin/delivery', '/admin/settings', '/admin/reviews'];
  for (const url of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
  }
  await page.goto('/admin/orders');
  await page.locator('tbody tr a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Order AQ/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'order detail').toBe(true);
});
