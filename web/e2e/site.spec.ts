import { expect, Page, test } from '@playwright/test';

const PAGES = ['/', '/products', '/products?category=water-bottles', '/products/20-litre-water-can', '/services', '/delivery', '/about', '/faq', '/contact', '/cart', '/no-such-page'];

/** Collects console errors and failed or broken (4xx/5xx) requests while a page loads. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()));
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('requestfailed', (r) => problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
  return problems;
}

for (const path of PAGES) {
  test(`page ${path} loads cleanly`, async ({ page }) => {
    const problems = watch(page);
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Every image actually loaded.
    const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    expect(broken, 'broken images').toEqual([]);

    // No sideways scrolling at this screen width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(0);

    expect(problems).toEqual([]);
  });
}

test('product to cart: add, change quantity, remove', async ({ page }) => {
  await page.goto('/products/20-litre-water-can');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added to your cart' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Cart, 2 items/ })).toBeVisible();

  await page.goto('/cart');
  await page.getByRole('button', { name: 'Increase 20 L Water Can' }).click();
  await expect(page.getByRole('link', { name: /Cart, 3 items/ })).toBeVisible();
  await page.reload(); // kept across reloads
  await expect(page.getByRole('link', { name: /Cart, 3 items/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
});

test('pincode check: served, not served and invalid', async ({ page }) => {
  await page.goto('/delivery');
  const pin = page.getByLabel('Your pincode');
  await pin.fill('600001');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Yes, we deliver to 600001.')).toBeVisible();
  await pin.fill('110001');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText("We don't deliver to 110001 yet.")).toBeVisible();
  await pin.fill('12');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Enter a valid 6-digit pincode.')).toBeVisible();
});

test('contact form validates and submits (request intercepted, nothing stored)', async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route('**/api/enquiries', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, id: 'test' } });
  });
  await page.goto('/contact?type=bulk_order');
  await expect(page.getByLabel('What is it about?')).toHaveValue('bulk_order');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Please enter your name.')).toBeVisible();
  await expect(page.getByText('Enter a valid 10-digit mobile number.')).toBeVisible();
  expect(sent).toBeNull();

  await page.getByLabel('Your name *').fill('Test Customer');
  await page.getByLabel('Phone *').fill('9876543210');
  await page.getByLabel('Quantity needed').fill('100 bottles');
  await page.getByLabel('Message *').fill('Water for a function next month');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Thank you, we have your message')).toBeVisible();
  expect(sent).toMatchObject({ enquiry_type: 'bulk_order', name: 'Test Customer', phone: '9876543210', quantity_note: '100 bottles', website: '' });
});

test('keyboard users can skip to content and see focus', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard test on desktop and tablet');
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible(); // wait until the site has started
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});
