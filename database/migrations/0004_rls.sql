-- =====================================================================
-- AquaPure Water — 0004: privileges and Row Level Security
--
-- Two layers:
--   1. GRANTs decide which tables/columns a role may touch at all.
--      Customers get NO insert/update on orders, order_items, payments or
--      prices; those only change through the functions in 0005/0006.
--   2. RLS policies decide which rows.
-- Roles: anon = visitor, authenticated = signed-in user (customer, staff or admin;
-- staff/admin are recognised by app.is_staff() / app.is_admin()).
-- =====================================================================

-- ---------- Turn RLS on everywhere ----------
alter table app.profiles               enable row level security;
alter table app.addresses              enable row level security;
alter table app.product_categories     enable row level security;
alter table app.products               enable row level security;
alter table app.delivery_zones         enable row level security;
alter table app.delivery_slots         enable row level security;
alter table app.business_settings      enable row level security;
alter table app.orders                 enable row level security;
alter table app.order_items            enable row level security;
alter table app.order_status_history   enable row level security;
alter table app.payments               enable row level security;
alter table app.payment_webhook_events enable row level security;   -- no policies: functions only
alter table app.can_deposit_ledger     enable row level security;
alter table app.inventory_transactions enable row level security;
alter table app.enquiries              enable row level security;
alter table app.testimonials           enable row level security;
alter table app.rate_limits            enable row level security;   -- no policies: functions only

-- Start from nothing, then grant exactly what is needed.
revoke all on all tables    in schema app from public, anon, authenticated, wbms_api;
revoke all on all sequences in schema app from public, anon, authenticated, wbms_api;
revoke all on all functions in schema app from public, anon, authenticated, wbms_api;

-- ---------- Public catalog ----------
grant select on app.product_categories, app.products, app.delivery_zones,
                app.delivery_slots, app.business_settings, app.testimonials
  to anon, authenticated;

create policy categories_read on app.product_categories for select to anon, authenticated
  using (is_active or app.is_staff());
create policy products_read on app.products for select to anon, authenticated
  using (is_active or app.is_staff());
create policy zones_read on app.delivery_zones for select to anon, authenticated
  using (is_active or app.is_staff());
create policy slots_read on app.delivery_slots for select to anon, authenticated
  using (is_active or app.is_staff());
create policy settings_read on app.business_settings for select to anon, authenticated
  using (true);
create policy testimonials_read on app.testimonials for select to anon, authenticated
  using (is_published or app.is_staff());

-- Admin edits catalog, delivery setup, settings and testimonials.
grant insert, update, delete on app.product_categories, app.products, app.delivery_zones,
                                app.delivery_slots, app.testimonials
  to authenticated;
grant update on app.business_settings to authenticated;

create policy categories_admin on app.product_categories for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy products_admin on app.products for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy zones_admin on app.delivery_zones for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy slots_admin on app.delivery_slots for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy settings_admin on app.business_settings for update to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy testimonials_admin on app.testimonials for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------- Profiles ----------
-- Customers may change only their name, phone and customer type: never role or is_active.
grant select on app.profiles to authenticated;
grant update (full_name, phone, customer_type) on app.profiles to authenticated;

create policy profiles_read on app.profiles for select to authenticated
  using (id = auth.uid() or app.is_staff());
create policy profiles_update_own on app.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Addresses ----------
grant select, insert, update, delete on app.addresses to authenticated;

create policy addresses_own on app.addresses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_staff_read on app.addresses for select to authenticated
  using (app.is_staff());

-- ---------- Orders (read-only for everyone; changes go through functions) ----------
grant select on app.orders, app.order_items, app.order_status_history, app.payments,
                app.can_deposit_ledger
  to authenticated;

create policy orders_read on app.orders for select to authenticated
  using (user_id = auth.uid() or app.is_staff());
create policy order_items_read on app.order_items for select to authenticated
  using (app.is_staff() or exists (select 1 from app.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy order_history_read on app.order_status_history for select to authenticated
  using (app.is_staff() or exists (select 1 from app.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy payments_read on app.payments for select to authenticated
  using (app.is_staff() or exists (select 1 from app.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy deposit_ledger_read on app.can_deposit_ledger for select to authenticated
  using (user_id = auth.uid() or app.is_staff());

-- ---------- Staff-only tables ----------
grant select on app.inventory_transactions to authenticated;
create policy inventory_staff_read on app.inventory_transactions for select to authenticated
  using (app.is_staff());

grant select on app.enquiries to authenticated;
grant update (status, admin_notes) on app.enquiries to authenticated;
create policy enquiries_staff_read on app.enquiries for select to authenticated
  using (app.is_staff());
create policy enquiries_staff_update on app.enquiries for update to authenticated
  using (app.is_staff()) with check (app.is_staff());
-- Inserting an enquiry goes through app.submit_enquiry() (0005).

-- ---------- Helper functions callable by signed-in users ----------
grant execute on function app.is_admin(), app.is_staff() to anon, authenticated;

-- Postgres lets everyone (PUBLIC) execute a new function by default, and schema-level
-- default privileges cannot remove that. So every script that creates functions ends
-- with  revoke execute on all functions in schema app from public;  and grants each
-- function to the exact roles that need it. (Grants to named roles are unaffected.)
