// Loads the real migrations into an in-memory Postgres (PGlite) and offers helpers
// to run SQL as a visitor, a signed-in user, or the API's own database role,
// the same way the .NET API does on Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads supabase-setup.sql (built by build-setup.mjs: every migration plus the seed), the exact
 * file pasted into Supabase. pg_cron is not available in PGlite; 0009 skips it with a notice.
 */
export async function createDb() {
  const db = new PGlite();
  await db.exec(await readFile(path.join(root, 'tests', 'supabase-stub.sql'), 'utf8'));
  // One transaction, like the Supabase SQL Editor: all or nothing.
  await db.exec('begin;\n' + (await readFile(path.join(root, 'supabase-setup.sql'), 'utf8')) + '\ncommit;');
  return db;
}

/** Creates a Supabase Auth user (the trigger creates the profile). */
export async function createUser(db, { role = 'customer', name = 'Test User', email } = {}) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    email ?? `${id.slice(0, 8)}@example.com`,
    JSON.stringify({ full_name: name }),
  ]);
  if (role !== 'customer') await db.query('update app.profiles set role = $2 where id = $1', [id, role]);
  return id;
}

async function inRole(db, setup, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(setup);
    return fn(tx);
  });
}

/** Runs fn(tx) as a signed-in user: role "authenticated" with their JWT claims. */
export function asUser(db, userId, fn) {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' }).replace(/'/g, "''");
  return inRole(db, `set local role authenticated; select set_config('request.jwt.claims', '${claims}', true);`, fn);
}

export function asAnon(db, fn) {
  return inRole(db, `set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`, fn);
}

/** Runs fn(tx) as the API's own role (wbms_api), used for payments and webhooks. */
export function asApi(db, fn) {
  return inRole(db, 'set local role wbms_api;', fn);
}

export async function one(tx, sql, params) {
  const r = await tx.query(sql, params);
  return r.rows[0];
}

/** Expects the promise to fail with the given SQLSTATE (and optional message fragment). */
export async function rejects(promise, code, messagePart) {
  try {
    await promise;
  } catch (e) {
    if (code && e.code !== code) throw new Error(`Expected SQLSTATE ${code} but got ${e.code}: ${e.message}`);
    if (messagePart && !e.message.includes(messagePart))
      throw new Error(`Expected message containing "${messagePart}" but got: ${e.message}`);
    return e;
  }
  throw new Error(`Expected failure ${code ?? ''} but the statement succeeded`);
}

export async function addAddress(db, userId, pincode = '600001') {
  return asUser(db, userId, async (tx) =>
    (
      await one(
        tx,
        `insert into app.addresses (user_id, contact_name, contact_phone, line1, city, pincode)
         values ($1, 'Test', '9876543210', '12 Test Street', 'Chennai', $2) returning id`,
        [userId, pincode],
      )
    ).id,
  );
}

export async function productId(db, slug) {
  return (await one(db, 'select id from app.products where slug = $1', [slug])).id;
}

export async function slotId(db, label = 'Morning') {
  return (await one(db, 'select id from app.delivery_slots where label = $1', [label])).id;
}

/** Tomorrow in the business time zone (Morning slot is open every day). */
export async function tomorrow(db) {
  return (await one(db, `select ((now() at time zone 'Asia/Kolkata')::date + 1)::text as d`)).d;
}

export async function placeOrder(db, userId, { addressId, items, method = 'cod', date, slot, key = randomUUID() }) {
  // Look these up first: PGlite has one connection, so querying db inside the transaction would wait forever.
  const d = date ?? (await tomorrow(db));
  const s = slot ?? (await slotId(db));
  return asUser(db, userId, async (tx) =>
    (
      await one(tx, 'select app.place_order($1, $2::jsonb, $3::date, $4, $5::app.payment_method, $6, $7) as id', [
        addressId, JSON.stringify(items), d, s, method, null, key,
      ])
    ).id,
  );
}
