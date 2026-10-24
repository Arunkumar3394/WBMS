-- =====================================================================
-- AquaPure Water — 0009: scheduled jobs (pg_cron)
-- If "create extension" fails, enable pg_cron first:
--   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- Every 10 minutes: cancel online orders left unpaid (frees stock and the slot),
-- and tidy old rate-limit counters.
select cron.schedule(
  'aquapure-expire-unpaid-orders',
  '*/10 * * * *',
  $$ select app.expire_unpaid_orders(); $$
);
