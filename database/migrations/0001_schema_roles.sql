-- =====================================================================
-- AquaPure Water — 0001: schema, types and the API database role
-- Run in the Supabase SQL Editor (as the default "postgres" user).
-- Safe to run once on a fresh project. Scripts 0001–0009 must run in order.
-- =====================================================================

-- All business tables live in schema "app". Supabase's auto-generated REST API
-- only exposes "public" (and "graphql_public"), so these tables are not reachable
-- with the public publishable/anon key. The .NET API is the only way in, and RLS
-- still applies as a second line of defence.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'app') then
    raise exception 'AquaPure is already installed (schema "app" exists). To reinstall on a TEST project, first run: drop schema app cascade;';
  end if;
end $$;

create schema app;
revoke all on schema app from public;

-- ---------- Types ----------
create type app.user_role        as enum ('customer', 'staff', 'admin');
create type app.customer_type    as enum ('home', 'office', 'shop', 'hotel', 'other');
create type app.order_status     as enum ('pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled');
create type app.payment_method   as enum ('cod', 'razorpay');
-- unpaid  = cash on delivery not yet collected
-- pending = waiting for an online payment
create type app.payment_status   as enum ('unpaid', 'pending', 'paid', 'failed', 'refunded');
create type app.enquiry_type     as enum ('general', 'bulk_order', 'monthly_supply', 'office_supply', 'event');
create type app.enquiry_status   as enum ('new', 'in_progress', 'closed');
create type app.deposit_entry    as enum ('collected', 'refunded', 'adjustment');
create type app.inventory_reason as enum ('restock', 'order_reserved', 'order_released', 'adjustment', 'damaged');

create sequence app.order_no_seq start 1001;

-- ---------- API role ----------
-- The .NET API connects as "wbms_api". It has almost no privileges of its own:
--   * for a signed-in customer it runs  SET LOCAL ROLE authenticated  + the user's JWT
--     claims, so auth.uid() and every RLS policy apply exactly as for that user;
--   * for anonymous visitors it runs  SET LOCAL ROLE anon;
--   * as itself it may only call the payment / webhook / rate-limit functions (0006).
-- NOINHERIT means it does not get "authenticated" rights unless it switches role.
-- Set its password separately (see SETUP.md):  alter role wbms_api with password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wbms_api') then
    create role wbms_api login noinherit;
  end if;
end $$;

do $$
begin
  grant anon, authenticated to wbms_api;
exception when insufficient_privilege then
  raise exception 'Supabase did not allow "grant anon, authenticated to wbms_api" (%). Send this message to your developer.', sqlerrm;
end $$;
grant usage on schema app to wbms_api, anon, authenticated;
