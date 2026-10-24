-- =====================================================================
-- AquaPure Water — 0009: scheduled jobs (pg_cron)
-- If pg_cron is not available this step is skipped with a notice and
-- everything else still installs. To add it later: Supabase Dashboard →
-- Database → Extensions → enable "pg_cron", then run this file again.
-- =====================================================================

do $outer$
begin
  create extension if not exists pg_cron with schema pg_catalog;

  -- Every 10 minutes: cancel online orders left unpaid (frees stock and the slot),
  -- and tidy old rate-limit counters. Re-running replaces the job.
  perform cron.schedule(
    'aquapure-expire-unpaid-orders',
    '*/10 * * * *',
    'select app.expire_unpaid_orders();'
  );
exception when others then
  raise notice 'pg_cron is not available (%). Skipped the job that expires unpaid online orders: enable pg_cron and run 0009_cron.sql again.', sqlerrm;
end
$outer$;
