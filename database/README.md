# Database (Supabase Postgres)

## Install (one file)

1. Open `supabase-setup.sql` in VS Code, press **Ctrl+A** and then **Ctrl+C**.
2. In the Supabase Dashboard open **SQL Editor → New query**, paste it, and click **Run**.
3. The result should say **AquaPure database installed**. If you see an error instead, nothing was changed; send the error message to your developer.

`supabase-setup.sql` is generated from the files below (`npm run build`), so edit those, not the combined file.

Running it again on an installed project stops with "already installed" and changes nothing.

**Updating an installed database:** when a migration file is added after you installed (for example `0010_cans_per_unit.sql`), run **only that file** in the SQL Editor. Such files say at the top that they are safe to run more than once.

If pg_cron is not enabled, the install still completes. It shows a notice and skips one job, the one that cancels unpaid online orders. To add it, enable **pg_cron** under **Database → Extensions** and then run `migrations/0009_cron.sql`.

## What's inside

| Order | File | What it does |
|---|---|---|
| 1 | `migrations/0001_schema_roles.sql` | `app` schema, types, the `wbms_api` role the .NET API logs in as |
| 2 | `migrations/0002_tables.sql` | All tables, constraints, indexes, the settings row |
| 3 | `migrations/0003_helpers_triggers.sql` | `is_admin()` / `is_staff()`, profile-on-sign-up trigger, address rules |
| 4 | `migrations/0004_rls.sql` | Grants and Row Level Security policies |
| 5 | `migrations/0005_order_functions.sql` | Slots, pricing, place / cancel order, staff and admin actions, enquiries |
| 6 | `migrations/0006_payment_functions.sql` | Razorpay checkout, capture / failure, webhooks, rate limit, expiry |
| 7 | `migrations/0007_storage.sql` | `product-images` bucket and admin-only upload policies |
| 8 | `migrations/0008_reports.sql` | Sales summary and dashboard numbers |
| 9 | `migrations/0009_cron.sql` | Expires unpaid online orders every 10 minutes (skipped with a notice if pg_cron is not enabled) |
| 10 | `migrations/0010_cans_per_unit.sql` | Cans per product unit (packs), so deposits and can counts are in cans |
| 11 | `seed.sql` | Sample categories, products (sample prices), zones, slots, sample reviews |

Each script runs once on a fresh project. To start over, run `drop schema app cascade;`. That deletes all AquaPure data, so do it only on a test project. Then run the scripts again.

## After the scripts

**Give the API its database password.** Choose a long random password and run:

```sql
alter role wbms_api with password 'paste-a-long-random-password-here';
```

Put it only in the API's connection string, as an environment variable or in `secrets.config`. Never commit it.

**Make yourself admin.** First sign up on the website, then run:

```sql
update app.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

## Tests

The tests load these exact scripts into an in-memory Postgres (PGlite) with a small stand-in for Supabase's `auth` and `storage` schemas (`tests/supabase-stub.sql`, test-only). They check:

- what visitors, customers, staff, admins and the API role can and can't do
- order pricing, stock, slots, deposits and status changes
- Razorpay edge cases: repeated callbacks, failed attempts, wrong amounts, late payments, expiry

```
cd database
npm install
npm test
```
