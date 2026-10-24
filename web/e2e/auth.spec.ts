import { expect, Page, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 } });

// ---------------------------------------------------------------- Against the real Supabase project
test('wrong password shows a clear message (live Supabase Auth, no email sent)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody-' + Date.now() + '@example.com');
  await page.getByLabel('Password').fill('not-the-right-password1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
});

test('signed-out visitors are sent to sign in and back afterwards', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Faccount/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('sign-up form checks the password rules before calling Supabase', async ({ page }) => {
  let called = false;
  await page.route('**/auth/v1/signup*', (r) => { called = true; return r.abort(); });
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Asha');
  await page.getByLabel('Email').fill('asha@example.com');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#password-hint')).toHaveClass(/text-red-600/);
  expect(called).toBe(false);
});

// ---------------------------------------------------------------- Signed-in screens (Supabase and API simulated)
const USER_ID = '6f0b1c2a-8c1d-4c55-9d58-111111111111';

async function fakeSignIn(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: USER_ID, exp: now + 3600, aud: 'authenticated', role: 'authenticated', email: 'asha@example.com' })).toString('base64url');
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: 'fake-refresh', user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'asha@example.com', app_metadata: {}, user_metadata: { full_name: 'Asha' }, created_at: new Date().toISOString() },
  };
  await page.route('**/auth/v1/token?grant_type=password', (r) => r.fulfill({ json: session }));
  await page.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204 }));
}

/** A tiny in-memory stand-in for the API's /me endpoints, recording what the site sends. */
async function fakeAccountApi(page: Page) {
  const state = {
    profile: { id: USER_ID, full_name: 'Asha', phone: null as string | null, email: 'asha@example.com', role: 'customer', customer_type: 'home', cans_with_deposit: 2, deposit_balance: 300 },
    addresses: [] as Record<string, unknown>[],
    authHeaders: [] as string[],
  };
  await page.route('**/api/me**', async (route) => {
    const req = route.request();
    state.authHeaders.push(req.headers()['authorization'] ?? '');
    const url = new URL(req.url());
    const parts = url.pathname.split('/').filter(Boolean); // api, me, addresses?, id?, default?
    if (parts.length === 2) {
      if (req.method() === 'PUT') Object.assign(state.profile, req.postDataJSON());
      return route.fulfill({ json: state.profile });
    }
    if (parts.length === 3 && req.method() === 'GET') return route.fulfill({ json: state.addresses });
    if (parts.length === 3 && req.method() === 'POST') {
      const a = { id: 'a' + (state.addresses.length + 1), ...req.postDataJSON() };
      if (state.addresses.length === 0) a.is_default = true;
      state.addresses.push(a);
      return route.fulfill({ json: a });
    }
    const id = parts[3];
    if (req.method() === 'DELETE') {
      state.addresses = state.addresses.filter((a) => a['id'] !== id);
      return route.fulfill({ json: { ok: true } });
    }
    if (req.method() === 'PUT') {
      const a = state.addresses.find((x) => x['id'] === id)!;
      Object.assign(a, req.postDataJSON());
      return route.fulfill({ json: a });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return state;
}

test('sign in, edit profile, manage addresses, sign out', async ({ page }) => {
  await fakeSignIn(page);
  const api = await fakeAccountApi(page);

  await page.goto('/login?returnUrl=%2Faccount');
  await page.getByLabel('Email').fill('asha@example.com');
  await page.getByLabel('Password').fill('correct-horse1');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My account' })).toBeVisible();
  await expect(page.getByText('Cans with you: 2')).toBeVisible();
  expect(api.authHeaders[0]).toMatch(/^Bearer eyJ/); // the token goes to the API

  // Profile
  await page.getByLabel('Mobile number').fill('98765 43210');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(api.profile.phone).toBe('9876543210');

  // Add an address (validation first)
  await page.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByLabel('Contact name *')).toHaveValue('Asha');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('Enter a valid 6-digit pincode.')).toBeVisible();
  await page.getByLabel('Pincode *').fill('600001');
  await page.getByLabel('House / flat, building and street *').fill('12 Lake View Road');
  await page.getByLabel('City *').fill('Chennai');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('12 Lake View Road')).toBeVisible();
  await expect(page.getByText('Default', { exact: true })).toBeVisible();

  // Edit it
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Landmark').fill('Near the temple');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('Near Near the temple')).toBeVisible();

  // Delete it
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No saved addresses yet.')).toBeVisible();

  // Sign out
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('return links cannot send people to another website', async ({ page }) => {
  await fakeSignIn(page);
  await fakeAccountApi(page);
  await page.goto('/login?returnUrl=%2F%2Fevil.example.com');
  await page.getByLabel('Email').fill('asha@example.com');
  await page.getByLabel('Password').fill('correct-horse1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('http://localhost:4300/account');
});
