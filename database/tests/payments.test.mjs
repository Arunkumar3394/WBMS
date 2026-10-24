// Razorpay handling: reuse of Razorpay orders, captures, failures, duplicates, late payments, webhooks, expiry.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDb, createUser, asUser, asApi, one, rejects, addAddress, productId, placeOrder,
} from './helpers.mjs';

let db, cust, other, staff, addr, can, orderId;

beforeEach(async () => {
  db = await createDb();
  cust = await createUser(db);
  other = await createUser(db);
  staff = await createUser(db, { role: 'staff' });
  addr = await addAddress(db, cust);
  can = await productId(db, '20-litre-water-can');
  orderId = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 2 }], method: 'razorpay' }); // ₹80
});

const api = (sql, params) => asApi(db, async (tx) => (await tx.query(sql, params)).rows[0]);
const begin = (userId = cust) => api('select app.begin_razorpay_checkout($1, $2) as c', [orderId, userId]).then((r) => r.c);
const record = (rzp, paise = 8000) => api('select app.record_razorpay_order($1, $2, $3)', [orderId, rzp, paise]);
const capture = (rzp, pay, paise = 8000) =>
  api("select app.mark_payment_captured($1, $2, $3, 'upi') as r", [rzp, pay, paise]).then((r) => r.r);
const order = () => one(db, 'select * from app.orders where id = $1', [orderId]);

test('checkout returns the server amount and refuses other users\' orders', async () => {
  const c = await begin();
  assert.equal(Number(c.amount_paise), 8000);
  assert.equal(c.razorpay_order_id, null);
  await rejects(begin(other), 'P0002');
});

test('retries reuse the same Razorpay order', async () => {
  await begin();
  await record('order_A');
  const again = await begin();
  assert.equal(again.razorpay_order_id, 'order_A');
  await record('order_A'); // repeat insert is ignored
  assert.equal((await one(db, 'select count(*)::int n from app.payments')).n, 1);
});

test('amount sent to record_razorpay_order must equal the order total', async () => {
  await rejects(record('order_X', 100), 'P0001', 'does not match');
});

test('a capture marks the order paid exactly once', async () => {
  await record('order_A');
  assert.equal(await capture('order_A', 'pay_1'), 'applied');
  assert.equal(await capture('order_A', 'pay_1'), 'already_recorded');   // webhook after callback
  const o = await order();
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.needs_refund, false);
  const p = await one(db, 'select * from app.payments where razorpay_order_id = $1', ['order_A']);
  assert.equal(p.status, 'captured');
  assert.equal(p.razorpay_payment_id, 'pay_1');
  await rejects(begin(), 'P0001', 'already paid');
});

test('a wrong amount is not accepted and is flagged for review', async () => {
  await record('order_A');
  assert.equal(await capture('order_A', 'pay_1', 100), 'amount_mismatch');
  const o = await order();
  assert.equal(o.payment_status, 'pending');
  assert.equal(o.needs_refund, true);
});

test('captures for unknown Razorpay orders are ignored', async () => {
  assert.equal(await capture('order_not_ours', 'pay_9'), 'unknown_order');
});

test('a second payment for an already-paid order is flagged for refund', async () => {
  await record('order_A');
  // Simulate a second Razorpay order existing for the same order (e.g. created before a price change was reverted).
  await db.query("insert into app.payments (order_id, provider, razorpay_order_id, amount_paise, status) values ($1, 'razorpay', 'order_B', 8000, 'created')", [orderId]);
  assert.equal(await capture('order_A', 'pay_1'), 'applied');
  assert.equal(await capture('order_B', 'pay_2'), 'duplicate');
  const o = await order();
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.needs_refund, true);
  assert.match(o.admin_notes, /pay_2/);
});

test('failed attempts can be retried, and a late failure does not undo a capture', async () => {
  await record('order_A');
  assert.equal((await api("select app.mark_payment_failed('order_A', 'pay_f', 'BAD_REQUEST_ERROR', 'Card declined') as r")).r, 'recorded');
  assert.equal((await order()).payment_status, 'failed');
  const c = await begin();                         // customer tries again
  assert.equal(c.razorpay_order_id, 'order_A');
  assert.equal((await order()).payment_status, 'pending');
  assert.equal(await capture('order_A', 'pay_2'), 'applied');
  assert.equal((await api("select app.mark_payment_failed('order_A', 'pay_f2', 'X', 'late') as r")).r, 'ignored');
  assert.equal((await order()).payment_status, 'paid');
});

test('a payment arriving after cancellation is kept and flagged for refund', async () => {
  await record('order_A');
  await asUser(db, cust, (tx) => tx.query('select app.cancel_my_order($1, null)', [orderId]));
  assert.equal(await capture('order_A', 'pay_1'), 'paid_but_cancelled');
  const o = await order();
  assert.equal(o.status, 'cancelled');
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.needs_refund, true);
});

test('paid orders cannot be cancelled by the customer; admin marks refunds', async () => {
  await record('order_A');
  await capture('order_A', 'pay_1');
  await rejects(asUser(db, cust, (tx) => tx.query('select app.cancel_my_order($1, null)', [orderId])), 'P0001', 'already paid');
  await asUser(db, staff, (tx) => tx.query("select app.admin_set_order_status($1, 'cancelled', 'Customer asked')", [orderId]));
  assert.equal((await order()).needs_refund, true);
  const admin = await createUser(db, { role: 'admin' });
  await asUser(db, admin, (tx) => tx.query("select app.admin_mark_refunded($1, 'Refund rfnd_1 in Razorpay')", [orderId]));
  const o = await order();
  assert.equal(o.payment_status, 'refunded');
  assert.equal(o.needs_refund, false);
});

test('webhook events are processed once', async () => {
  const first = await api("select app.record_webhook_event('evt_1', 'payment.captured', '{}') as r");
  const second = await api("select app.record_webhook_event('evt_1', 'payment.captured', '{}') as r");
  assert.equal(first.r, true);
  assert.equal(second.r, false);
});

test('unpaid online orders expire and free their stock, but not during a recent attempt', async () => {
  assert.equal((await one(db, 'select stock_qty from app.products where id = $1', [can])).stock_qty, 198);
  await db.query("update app.orders set created_at = now() - interval '2 hours' where id = $1", [orderId]);
  await record('order_A'); // attempt just now
  assert.equal((await api('select app.expire_unpaid_orders() as n')).n, 0);
  // Backdate the attempt (bypassing the updated_at trigger, which would reset it to now).
  await db.transaction(async (tx) => {
    await tx.exec("set local session_replication_role = replica; update app.payments set updated_at = now() - interval '2 hours';");
  });
  assert.equal((await api('select app.expire_unpaid_orders() as n')).n, 1);
  const o = await order();
  assert.equal(o.status, 'cancelled');
  assert.equal((await one(db, 'select stock_qty from app.products where id = $1', [can])).stock_qty, 200);
  // Cash orders never expire.
  const cod = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }] });
  await db.query("update app.orders set created_at = now() - interval '2 days' where id = $1", [cod]);
  assert.equal((await api('select app.expire_unpaid_orders() as n')).n, 0);
});

test('rate limit allows up to the maximum in a window', async () => {
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await api("select app.check_rate_limit('ip:1.2.3.4:enquiry', 3, 60) as ok")).ok);
  assert.deepEqual(results, [true, true, true, false]);
});
