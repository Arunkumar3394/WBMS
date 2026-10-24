# Database (Supabase Postgres)

## Run the scripts

In the Supabase Dashboard open **SQL Editor → New query**, paste each file, and click **Run**, in this order:

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
| 9 | `migrations/0009_cron.sql` | Expires unpaid online orders every 10 minutes (enable **pg_cron** first if it asks) |
| 10 | `seed.sql` | Sample categories, products (sample prices), zones, slots, sample reviews |

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
