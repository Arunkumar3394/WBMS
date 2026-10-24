import { expect, Page, test } from '@playwright/test';

/**
 * Online payment screens. Razorpay's checkout.js and the API are simulated here; the API's own
 * payment checks (signature, asking Razorpay, recording once) are covered by the API tests.
 */
test.describe.configure({ mode: 'serial' });

const USER_ID = '6f0b1c2a-8c1d-4c55-9d58-222222222222';
const ORDER_ID = '9a0b1c2a-8c1d-4c55-9d58-333333333333';

/** A stand-in for checkout.js. window.__rzpMode chooses what the "customer" does. */
const FAKE_CHECKOUT_JS = `
  window.Razorpay = function (o) { this.o = o; this.h = {}; };
  Razorpay.prototype.on = function (e, cb) { this.h[e] = cb; };
  Razorpay.prototype.open = function () {
    const o = this.o, h = this.h;
    window.__rzpOpened = { key: o.key, order_id: o.order_id, amount: o.amount, currency: o.currency, name: o.prefill && o.prefill.name };
    setTimeout(function () {
      if (window.__rzpMode === 'success') {
        o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: 'pay_ok_1', razorpay_signature: 'sig_ok' });
      } else {
        h['payment.failed'] && h['payment.failed']({ error: { code: 'BAD_REQUEST_ERROR', description: 'Card declined by bank',
          metadata: { order_id: o.order_id, payment_id: 'pay_fail_1' } } });
        o.modal.ondismiss();
      }
    }, 50);
  };`;

async function setup(page: Page, mode: 'success' | 'fail') {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: USER_ID, exp: now + 3600, aud: 'authenticated', role: 'authenticated' })).toString('base64url');
  await page.route('**/auth/v1/token?grant_type=password', (r) =>
    r.fulfill({
      json: {
        access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r',
        user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'ravi@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      },
    }),
  );
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_CHECKOUT_JS }));
  await page.addInitScript((m) => ((window as unknown as { __rzpMode: string }).__rzpMode = m), mode);

  const order = {
    id: ORDER_ID, order_no: 'AQ1042', status: 'pending', payment_method: 'razorpay', payment_status: 'pending',
    subtotal: 80, delivery_charge: 0, deposit_total: 0, total: 80, delivery_date: '2026-10-25', slot_label: 'Morning (07:00 AM – 10:00 AM)',
    created_at: new Date().toISOString(), customer_notes: null, cancel_reason: null, cans_delivered: null, empties_collected: null,
    confirmed_at: null, delivered_at: null, cancelled_at: null, zone_id: 1, slot_id: 1,
    delivery_address: { label: 'Home', contact_name: 'Ravi', contact_phone: '9876543210', line1: '5 Main Road', line2: null, landmark: null, city: 'Chennai', pincode: '600001' },
    items: [{ product_id: 1, product_name: '20 L Water Can', unit_label: '20 L can', unit_price: 40, quantity: 2, line_total: 80, deposit_qty: 0, deposit_total: 0 }],
    history: [{ from_status: null, to_status: 'pending', note: 'Order placed', created_at: new Date().toISOString() }],
    payments: [] as unknown[],
  };
  const calls: { path: string; body: unknown }[] = [];
  const product = { id: 1, slug: '20-litre-water-can', name: '20 L Water Can', short_description: null, unit_label: '20 L can', price: 40, is_sample_price: true,
    is_returnable_can: true, deposit_amount: 150, min_order_qty: 1, max_order_qty: 30, image_path: null, image_url: null, in_stock: true, category_id: 1, category_slug: 'water-cans' };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const body = req.postDataJSON?.() ?? null;
    calls.push({ path: req.method() + ' ' + path, body });
    const json = (j: unknown) => route.fulfill({ json: j });
    if (path === '/settings') return json({ deposit_enabled: false, cod_enabled: false, online_payment_enabled: true, max_advance_days: 3, closed_dates: [], timezone: 'Asia/Kolkata', today: '2026-10-24', razorpay_key_id: 'rzp_test_abc' });
    if (path === '/catalog') return json({ categories: [{ id: 1, slug: 'water-cans', name: 'Cans', description: null, sort_order: 1 }], products: [product] });
    if (path === '/catalog/products/20-litre-water-can') return json(product);
    if (path === '/me') return json({ id: USER_ID, full_name: 'Ravi', phone: '9876543210', email: 'ravi@example.com', role: 'customer', customer_type: 'home', cans_with_deposit: 0, deposit_balance: 0 });
    if (path === '/me/addresses') return json([{ id: 'a1', ...order.delivery_address, is_default: true }]);
    if (path === '/delivery/slots') return json([{ slot_id: 1, label: 'Morning', start_time: '07:00', end_time: '10:00', remaining: 10, is_available: true, reason: null }]);
    if (path === '/orders/quote') return json({ zone_name: 'Zone A', min_order_amount: 40, free_delivery_min: null, lines: order.items, subtotal: 80, delivery_charge: 0, deposit_total: 0, total: 80 });
    if (path === '/orders' && req.method() === 'POST') return json(order);
    if (path === `/orders/${ORDER_ID}`) return json(order);
    if (path === '/payments/razorpay/order') {
      return json({ key_id: 'rzp_test_abc', razorpay_order_id: 'order_rzp_1', amount_paise: 8000, currency: 'INR', order_id: ORDER_ID, order_no: 'AQ1042',
        prefill: { name: 'Ravi', email: 'ravi@example.com', contact: '9876543210' } });
    }
    if (path === '/payments/razorpay/verify') {
      order.payment_status = 'paid';
      return json({ result: 'applied', order_id: ORDER_ID });
    }
    if (path === '/payments/razorpay/failed') {
      order.payment_status = 'failed';
      return json({ order_id: ORDER_ID });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
  return { calls, order };
}

async function checkoutAndPay(page: Page) {
  await page.goto('/products/20-litre-water-can');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/login?returnUrl=%2Fcheckout');
  await page.getByLabel('Email').fill('ravi@example.com');
  await page.getByLabel('Password').fill('secret-pass1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('radio', { name: /Pay online now/ })).toBeChecked(); // cash on delivery is off
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByRole('radio', { name: /Morning/ })).toBeChecked(); // the only open slot is picked for them
  // Nothing sticks out sideways on small phones (the date list scrolls inside its own box).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Place order and pay' }).click();
}

test('online payment: success is confirmed by the server', async ({ page }) => {
  const { calls } = await setup(page, 'success');
  await checkoutAndPay(page);

  await expect(page).toHaveURL(new RegExp(`/orders/${ORDER_ID}\\?placed=1&payment=paid$`));
  await expect(page.getByText('Thank you! Your payment was received.')).toBeVisible();
  await expect(page.getByText('Paid online')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay now' })).toHaveCount(0);

  // The browser sent only ids and quantities; the amount and key in the payment window came from the server.
  const placed = calls.find((c) => c.path === 'POST /orders')!.body as Record<string, unknown>;
  expect(placed['items']).toEqual([{ product_id: 1, quantity: 2 }]);
  expect(JSON.stringify(placed)).not.toMatch(/price|total|amount/);
  expect(await page.evaluate(() => (window as unknown as { __rzpOpened: unknown }).__rzpOpened)).toEqual(
    { key: 'rzp_test_abc', order_id: 'order_rzp_1', amount: 8000, currency: 'INR', name: 'Ravi' });
  expect(calls.find((c) => c.path === 'POST /payments/razorpay/verify')!.body).toEqual(
    { razorpay_order_id: 'order_rzp_1', razorpay_payment_id: 'pay_ok_1', razorpay_signature: 'sig_ok' });
});

test('online payment: a failed attempt is recorded and the customer can pay later', async ({ page }) => {
  const { calls } = await setup(page, 'fail');
  await checkoutAndPay(page);

  await expect(page).toHaveURL(new RegExp(`/orders/${ORDER_ID}\\?placed=1&payment=closed$`));
  await expect(page.getByText('Your order is saved, but not paid yet.')).toBeVisible();
  await expect(page.getByText('Payment failed')).toBeVisible();
  expect(calls.find((c) => c.path === 'POST /payments/razorpay/failed')!.body).toMatchObject(
    { razorpay_order_id: 'order_rzp_1', razorpay_payment_id: 'pay_fail_1', description: 'Card declined by bank' });

  // Second try succeeds.
  await page.evaluate(() => ((window as unknown as { __rzpMode: string }).__rzpMode = 'success'));
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByText('Thank you! Your payment was received.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay now' })).toHaveCount(0);
});
