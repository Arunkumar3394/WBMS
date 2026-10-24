// Permission tests: what visitors, customers, staff, admins and the API role may and may not do.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDb, createUser, asUser, asAnon, asApi, one, rejects, addAddress, productId, placeOrder,
} from './helpers.mjs';

let db, alice, bob, staff, admin, aliceAddr, bobAddr, aliceOrder, canId;

before(async () => {
  db = await createDb();
  alice = await createUser(db, { name: 'Alice' });
  bob = await createUser(db, { name: 'Bob' });
  staff = await createUser(db, { role: 'staff', name: 'Staff' });
  admin = await createUser(db, { role: 'admin', name: 'Admin' });
  aliceAddr = await addAddress(db, alice);
  bobAddr = await addAddress(db, bob);
  canId = await productId(db, '20-litre-water-can');
  aliceOrder = await placeOrder(db, alice, { addressId: aliceAddr, items: [{ product_id: canId, quantity: 2 }] });
});

test('sign-up trigger creates a customer profile', async () => {
  const p = await one(db, 'select role, full_name from app.profiles where id = $1', [alice]);
  assert.equal(p.role, 'customer');
  assert.equal(p.full_name, 'Alice');
});

test('visitors can read active products but not inactive ones', async () => {
  await db.query("update app.products set is_active = false where slug = 'event-pack-250ml-48'");
  const rows = await asAnon(db, async (tx) => (await tx.query('select slug from app.products')).rows);
  assert.equal(rows.length, 5);
  assert.ok(!rows.some((r) => r.slug === 'event-pack-250ml-48'));
  const adminRows = await asUser(db, admin, async (tx) => (await tx.query('select slug from app.products')).rows);
  assert.equal(adminRows.length, 6);
  await db.query("update app.products set is_active = true where slug = 'event-pack-250ml-48'");
});

test('visitors cannot read orders, profiles, addresses or enquiries', async () => {
  for (const table of ['orders', 'profiles', 'addresses', 'enquiries', 'payments']) {
    await rejects(asAnon(db, (tx) => tx.query(`select * from app.${table}`)), '42501');
  }
});

test('customers see only their own orders, items, addresses and payments', async () => {
  await asUser(db, bob, async (tx) => {
    assert.equal((await tx.query('select * from app.orders')).rows.length, 0);
    assert.equal((await tx.query('select * from app.order_items')).rows.length, 0);
    assert.equal((await tx.query('select * from app.addresses')).rows.length, 1);
    assert.equal((await tx.query('select * from app.profiles')).rows.length, 1);
  });
  await asUser(db, alice, async (tx) => {
    assert.equal((await tx.query('select * from app.orders')).rows.length, 1);
    assert.equal((await tx.query('select * from app.order_items')).rows.length, 1);
  });
});

test('customers cannot change their role or active flag', async () => {
  await rejects(asUser(db, alice, (tx) => tx.query("update app.profiles set role = 'admin' where id = $1", [alice])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('update app.profiles set is_active = true where id = $1', [alice])), '42501');
  // Allowed columns work, but only on their own row.
  await asUser(db, alice, (tx) => tx.query("update app.profiles set full_name = 'Alice A' where id = $1", [alice]));
  const r = await asUser(db, alice, (tx) => tx.query("update app.profiles set full_name = 'Hacked' where id = $1", [bob]));
  assert.equal(r.affectedRows, 0);
  assert.equal((await one(db, 'select full_name from app.profiles where id = $1', [bob])).full_name, 'Bob');
});

test('customers cannot insert or change orders, totals, payment status or prices directly', async () => {
  await rejects(asUser(db, alice, (tx) => tx.query('update app.orders set total = 1 where id = $1', [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query("update app.orders set payment_status = 'paid' where id = $1", [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('delete from app.orders where id = $1', [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('update app.order_items set unit_price = 0')), '42501');
  await rejects(asUser(db, alice, (tx) =>
    tx.query(`insert into app.orders (user_id, delivery_address, delivery_date, slot_label, payment_method, payment_status,
              subtotal, delivery_charge, total, idempotency_key)
              values ($1, '{}', current_date, 'x', 'cod', 'paid', 1, 0, 1, gen_random_uuid())`, [alice])), '42501');
  await rejects(asUser(db, alice, (tx) =>
    tx.query("insert into app.payments (order_id, provider, amount_paise, status) values ($1, 'cash', 100, 'captured')", [aliceOrder])), '42501');
  // Products: the grant exists for admins, but RLS stops customers (no rows match).
  const r = await asUser(db, alice, (tx) => tx.query('update app.products set price = 1'));
  assert.equal(r.affectedRows, 0);
  await rejects(asUser(db, alice, (tx) =>
    tx.query("insert into app.product_categories (slug, name) values ('free', 'Free stuff')")), '42501');
});

test('customers cannot use another customer\'s address or insert addresses for others', async () => {
  await rejects(
    placeOrder(db, alice, { addressId: bobAddr, items: [{ product_id: canId, quantity: 1 }] }),
    'P0001', 'saved delivery addresses');
  await rejects(asUser(db, alice, (tx) =>
    tx.query(`insert into app.addresses (user_id, contact_name, contact_phone, line1, city, pincode)
              values ($1, 'X', '9876543210', 'Somewhere', 'Chennai', '600001')`, [bob])), '42501');
});

test('customers cannot call staff, admin or payment functions', async () => {
  await rejects(asUser(db, alice, (tx) => tx.query("select app.admin_set_order_status($1, 'confirmed')", [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('select app.admin_mark_cod_paid($1)', [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query("select app.admin_set_user_role($1, 'admin', true)", [alice])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query("select app.admin_sales_summary(current_date - 7, current_date)")), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query("select app.admin_adjust_stock($1, 100, 'restock', null)", [canId])), '42501');
  // Payment functions are not granted to customers at all.
  await rejects(asUser(db, alice, (tx) => tx.query("select app.mark_payment_captured('x', 'y', 100, 'upi')")), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('select app.begin_razorpay_checkout($1, $2)', [aliceOrder, alice])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query('select app.expire_unpaid_orders()')), '42501');
  // Internal helpers are not callable either.
  await rejects(asUser(db, alice, (tx) => tx.query("select app.cancel_order_internal($1, null, 'x')", [aliceOrder])), '42501');
  await rejects(asUser(db, alice, (tx) => tx.query("select app.price_order($1, $2, '[]')", [alice, aliceAddr])), '42501');
});

test('staff can manage orders but not prices, settings or roles', async () => {
  await asUser(db, staff, async (tx) => {
    assert.ok((await tx.query('select * from app.orders')).rows.length >= 1);
    await tx.query("select app.admin_set_order_status($1, 'confirmed', 'ok')", [aliceOrder]);
    assert.equal((await tx.query('update app.products set price = 1')).affectedRows, 0);
    assert.equal((await tx.query('update app.business_settings set cod_enabled = false')).affectedRows, 0);
  });
  await rejects(asUser(db, staff, (tx) => tx.query("select app.admin_set_user_role($1, 'admin', true)", [staff])), '42501');
});

test('admins can change prices and settings', async () => {
  await asUser(db, admin, async (tx) => {
    assert.equal((await tx.query("update app.products set price = 45 where slug = '20-litre-water-can'")).affectedRows, 1);
    assert.equal((await tx.query('update app.business_settings set max_advance_days = 10')).affectedRows, 1);
  });
});

test('the last active admin cannot be removed', async () => {
  await rejects(asUser(db, admin, (tx) => tx.query("select app.admin_set_user_role($1, 'customer', true)", [admin])), 'P0001', 'at least one active admin');
  await asUser(db, admin, (tx) => tx.query("select app.admin_set_user_role($1, 'staff', true)", [bob]));
  assert.equal((await one(db, 'select role from app.profiles where id = $1', [bob])).role, 'staff');
  await asUser(db, admin, (tx) => tx.query("select app.admin_set_user_role($1, 'customer', true)", [bob]));
});

test('a deactivated admin loses admin rights immediately', async () => {
  const admin2 = await createUser(db, { role: 'admin' });
  await asUser(db, admin, (tx) => tx.query("select app.admin_set_user_role($1, 'admin', false)", [admin2]));
  const r = await asUser(db, admin2, (tx) => tx.query('update app.products set price = 1'));
  assert.equal(r.affectedRows, 0);
});

test('the API role has no table access of its own', async () => {
  for (const table of ['orders', 'products', 'profiles', 'payments']) {
    await rejects(asApi(db, (tx) => tx.query(`select * from app.${table}`)), '42501');
  }
  await rejects(asApi(db, (tx) => tx.query("select app.admin_set_order_status($1, 'cancelled')", [aliceOrder])), '42501');
});

test('enquiries: anyone can submit, only staff can read', async () => {
  await asAnon(db, (tx) =>
    tx.query("select app.submit_enquiry('bulk_order', 'Ravi', '98765 43210', 'ravi@example.com', 'Ravi Events', '200 cases', null, 'Need water for a wedding')"));
  const seenByCustomer = await asUser(db, alice, async (tx) => (await tx.query('select * from app.enquiries')).rows);
  assert.equal(seenByCustomer.length, 0);
  const rows = await asUser(db, staff, async (tx) => (await tx.query('select phone, status from app.enquiries')).rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, '9876543210');
  assert.equal(rows[0].status, 'new');
  await rejects(asAnon(db, (tx) =>
    tx.query("select app.submit_enquiry('general', 'X', 'not-a-phone', null, null, null, null, 'hello there')")), '23514');
});

test('product image uploads: admins only', async () => {
  await asUser(db, admin, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('product-images', 'can.webp')"));
  await rejects(asUser(db, alice, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('product-images', 'x.webp')")), '42501');
  await rejects(asAnon(db, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('product-images', 'y.webp')")), '42501');
  const r = await asUser(db, alice, (tx) => tx.query("delete from storage.objects where bucket_id = 'product-images'"));
  assert.equal(r.affectedRows, 0);
});
