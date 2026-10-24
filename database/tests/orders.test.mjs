// Order rules: server-side pricing, idempotency, stock, slots, zones, deposits, status changes.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createDb, createUser, asUser, one, rejects, addAddress, productId, slotId, tomorrow, placeOrder,
} from './helpers.mjs';

let db, cust, staff, admin, addr, can, bottles;

beforeEach(async () => {
  db = await createDb();
  cust = await createUser(db);
  staff = await createUser(db, { role: 'staff' });
  admin = await createUser(db, { role: 'admin' });
  addr = await addAddress(db, cust, '600001');      // Zone A: free delivery, min order ₹40
  can = await productId(db, '20-litre-water-can');  // sample ₹40, deposit ₹150, stock 200
  bottles = await productId(db, 'bottle-1l-case-12'); // sample ₹160, stock 100
});

const order = (id) => one(db, 'select * from app.orders where id = $1', [id]);
const stock = async (id) => (await one(db, 'select stock_qty from app.products where id = $1', [id])).stock_qty;
const setStatus = (who, id, status, note = null, cans = null, empties = null) =>
  asUser(db, who, (tx) => tx.query('select app.admin_set_order_status($1, $2, $3, $4, $5)', [id, status, note, cans, empties]));

test('totals come from database prices and zone charges', async () => {
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 3 }, { product_id: bottles, quantity: 1 }] });
  const o = await order(id);
  assert.equal(o.subtotal, '280.00');           // 3 × 40 + 160
  assert.equal(o.delivery_charge, '0.00');
  assert.equal(o.deposit_total, '0.00');        // deposits are off by default
  assert.equal(o.total, '280.00');
  assert.equal(o.status, 'pending');
  assert.equal(o.payment_status, 'unpaid');     // cash on delivery
  assert.match(o.order_no, /^AQ\d+$/);
  assert.equal(o.delivery_address.pincode, '600001');
  const items = (await db.query('select * from app.order_items where order_id = $1 order by product_id', [id])).rows;
  assert.equal(items.length, 2);
  assert.equal(items[0].unit_price, '40.00');
});

test('quote_order matches what place_order charges', async () => {
  const items = [{ product_id: can, quantity: 2 }];
  const q = await asUser(db, cust, async (tx) => (await one(tx, 'select app.quote_order($1, $2::jsonb) as q', [addr, JSON.stringify(items)])).q);
  const id = await placeOrder(db, cust, { addressId: addr, items });
  assert.equal(Number(q.total), Number((await order(id)).total));
  assert.equal(q.address, undefined);
});

test('delivery charge applies below the free-delivery amount in Zone B', async () => {
  const addrB = await addAddress(db, cust, '600010'); // ₹30 charge, free from ₹300, min ₹80
  const o1 = await order(await placeOrder(db, cust, { addressId: addrB, items: [{ product_id: bottles, quantity: 1 }] }));
  assert.equal(o1.delivery_charge, '30.00');
  assert.equal(o1.total, '190.00');
  const o2 = await order(await placeOrder(db, cust, { addressId: addrB, items: [{ product_id: bottles, quantity: 2 }] }));
  assert.equal(o2.delivery_charge, '0.00');
  await rejects(placeOrder(db, cust, { addressId: addrB, items: [{ product_id: can, quantity: 1 }] }), 'P0001', 'minimum order');
});

test('the same request key never creates a second order', async () => {
  const key = randomUUID();
  const items = [{ product_id: can, quantity: 2 }];
  const a = await placeOrder(db, cust, { addressId: addr, items, key });
  const b = await placeOrder(db, cust, { addressId: addr, items, key });
  assert.equal(a, b);
  assert.equal((await one(db, 'select count(*)::int n from app.orders')).n, 1);
  assert.equal(await stock(can), 198);
});

test('stock is reserved on order and released on cancel', async () => {
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 5 }] });
  assert.equal(await stock(can), 195);
  await asUser(db, cust, (tx) => tx.query('select app.cancel_my_order($1, $2)', [id, 'Changed my mind']));
  assert.equal(await stock(can), 200);
  const o = await order(id);
  assert.equal(o.status, 'cancelled');
  assert.equal(o.cancel_reason, 'Changed my mind');
  const reasons = (await db.query('select reason from app.inventory_transactions where order_id = $1 order by id', [id])).rows.map((r) => r.reason);
  assert.deepEqual(reasons, ['order_reserved', 'order_released']);
});

test('cannot order more than is in stock', async () => {
  await db.query('update app.products set stock_qty = 2 where id = $1', [can]);
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 3 }] }), 'P0001', 'only 2 left');
  assert.equal(await stock(can), 2);
});

test('rejects bad carts: empty, duplicates, inactive products, quantities out of range', async () => {
  await rejects(placeOrder(db, cust, { addressId: addr, items: [] }), 'P0001', 'cart is empty');
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }, { product_id: can, quantity: 1 }] }), 'P0001', 'twice');
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 31 }] }), 'P0001', 'between 1 and 30');
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 0 }] }), 'P0001', 'between');
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: 99999, quantity: 1 }] }), 'P0001', 'no longer available');
  await db.query('update app.products set is_active = false where id = $1', [bottles]);
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: bottles, quantity: 1 }] }), 'P0001', 'no longer available');
});

test('pincodes outside every zone are refused', async () => {
  const far = await addAddress(db, cust, '110001');
  await rejects(placeOrder(db, cust, { addressId: far, items: [{ product_id: can, quantity: 1 }] }), 'P0001', 'do not deliver to pincode 110001');
});

test('slots: capacity, closed dates, booking window', async () => {
  const slot = await slotId(db, 'Morning');
  await db.query('update app.delivery_slots set capacity = 1 where id = $1', [slot]);
  const other = await createUser(db);
  const otherAddr = await addAddress(db, other);
  await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }] });
  await rejects(placeOrder(db, other, { addressId: otherAddr, items: [{ product_id: can, quantity: 1 }] }), 'P0001', '(full)');

  const d = await tomorrow(db);
  await db.query('update app.business_settings set closed_dates = array[$1::date]', [d]);
  const slots = (await db.query('select * from app.available_slots($1::date)', [d])).rows;
  assert.ok(slots.every((s) => !s.is_available && s.reason === 'Closed on this day'));

  const past = (await db.query("select * from app.available_slots(current_date - 1)")).rows;
  assert.ok(past.every((s) => !s.is_available));
  const far = (await db.query("select * from app.available_slots(current_date + 30)")).rows;
  assert.ok(far.every((s) => s.reason === 'Too far ahead'));
});

test('payment methods can be switched off in settings', async () => {
  await db.query('update app.business_settings set cod_enabled = false');
  await rejects(placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }] }), 'P0001', 'Cash on delivery is not available');
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }], method: 'razorpay' });
  assert.equal((await order(id)).payment_status, 'pending');
});

test('deposits: charged only for cans beyond those the customer already has', async () => {
  await db.query('update app.business_settings set deposit_enabled = true');
  const first = await order(await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 2 }] }));
  assert.equal(first.deposit_total, '300.00');   // 2 new cans × ₹150
  assert.equal(first.total, '380.00');

  // While the first order is open, a second order for 2 cans is an exchange: no new deposit.
  const second = await order(await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 2 }] }));
  assert.equal(second.deposit_total, '0.00');

  // A third order for 3 cans needs a deposit for one more can.
  const third = await order(await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 3 }] }));
  assert.equal(third.deposit_total, '150.00');

  // Delivery records the deposit in the ledger.
  await setStatus(staff, first.id, 'confirmed');
  await setStatus(staff, first.id, 'out_for_delivery');
  await setStatus(staff, first.id, 'delivered', 'Delivered', 2, 0);
  const ledger = (await db.query('select * from app.can_deposit_ledger where user_id = $1', [cust])).rows;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].cans_delta, 2);
  assert.equal(ledger[0].amount, '300.00');

  // Refunding returned cans.
  await asUser(db, admin, (tx) => tx.query("select app.admin_record_deposit($1, 'refunded', 1, 150, 'Returned one can')", [cust]));
  await rejects(asUser(db, admin, (tx) => tx.query("select app.admin_record_deposit($1, 'refunded', 5, 750, null)", [cust])), 'P0001', 'holds only 1');
});

test('status changes follow the allowed path and are recorded', async () => {
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 2 }] });
  await rejects(setStatus(staff, id, 'delivered'), 'P0001', 'cannot be changed');
  await setStatus(staff, id, 'confirmed', 'Confirmed by phone');
  await rejects(asUser(db, cust, (tx) => tx.query('select app.cancel_my_order($1, null)', [id])), 'P0001', 'can no longer be cancelled');
  await setStatus(staff, id, 'out_for_delivery');
  await setStatus(staff, id, 'confirmed', 'Customer not home');      // failed attempt goes back
  await setStatus(staff, id, 'out_for_delivery');
  await setStatus(staff, id, 'delivered', null, 2, 2);
  await rejects(setStatus(staff, id, 'cancelled'), 'P0001', 'cannot be changed');
  const o = await order(id);
  assert.equal(o.status, 'delivered');
  assert.equal(o.cans_delivered, 2);
  assert.equal(o.empties_collected, 2);
  assert.ok(o.confirmed_at && o.delivered_at);
  const history = (await db.query('select to_status from app.order_status_history where order_id = $1 order by id', [id])).rows.map((r) => r.to_status);
  assert.deepEqual(history, ['pending', 'confirmed', 'out_for_delivery', 'confirmed', 'out_for_delivery', 'delivered']);

  await asUser(db, staff, (tx) => tx.query('select app.admin_mark_cod_paid($1)', [id]));
  assert.equal((await order(id)).payment_status, 'paid');
  await rejects(asUser(db, staff, (tx) => tx.query('select app.admin_mark_cod_paid($1)', [id])), 'P0001');
});

test('unpaid online orders cannot be confirmed', async () => {
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 1 }], method: 'razorpay' });
  await rejects(setStatus(staff, id, 'confirmed'), 'P0001', 'payment has not been received');
});

test('cancelling restores stock when staff cancel too', async () => {
  const id = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: bottles, quantity: 4 }] });
  await setStatus(staff, id, 'confirmed');
  await setStatus(staff, id, 'cancelled', 'Out of area today');
  assert.equal(await stock(bottles), 100);
});

test('admin stock adjustments cannot go below zero', async () => {
  const n = await asUser(db, admin, async (tx) => (await one(tx, "select app.admin_adjust_stock($1, 50, 'restock', 'New batch') as n", [can])).n);
  assert.equal(n, 250);
  await rejects(asUser(db, admin, (tx) => tx.query("select app.admin_adjust_stock($1, -300, 'damaged', null)", [can])), 'P0001', 'below zero');
});

test('reports and dashboard add up', async () => {
  const a = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: can, quantity: 2 }] });   // 80
  const b = await placeOrder(db, cust, { addressId: addr, items: [{ product_id: bottles, quantity: 1 }] }); // 160
  await setStatus(staff, b, 'cancelled', 'test');
  const r = await asUser(db, admin, async (tx) =>
    (await one(tx, "select app.admin_sales_summary((now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as r")).r);
  assert.equal(r.totals.orders, 2);
  assert.equal(r.totals.cancelled, 1);
  assert.equal(Number(r.totals.sales), 80);
  assert.equal(Number(r.totals.cod_outstanding), 80);
  assert.equal(r.by_product.length, 1);
  const d = await asUser(db, staff, async (tx) => (await one(tx, 'select app.admin_dashboard() as d')).d);
  assert.equal(d.pending_orders, 1);
  assert.ok(a);
});
