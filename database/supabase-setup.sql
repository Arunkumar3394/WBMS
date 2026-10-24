-- =====================================================================
-- AquaPure Water — complete database setup for Supabase
-- GENERATED from database/migrations/*.sql and seed.sql by build-setup.mjs: do not edit by hand.
--
-- Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Then follow "After the scripts" in database/README.md.
-- =====================================================================

-- >>>>> migrations/0001_schema_roles.sql
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

-- >>>>> migrations/0002_tables.sql
-- =====================================================================
-- AquaPure Water — 0002: tables, constraints and indexes
-- =====================================================================

-- ---------- People ----------
create table app.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  full_name      text check (char_length(full_name) <= 100),
  phone          text check (phone ~ '^\+?[0-9]{10,15}$'),
  email          text check (char_length(email) <= 254),
  role           app.user_role     not null default 'customer',
  customer_type  app.customer_type not null default 'home',
  is_active      boolean           not null default true,
  created_at     timestamptz       not null default now(),
  updated_at     timestamptz       not null default now()
);
create index profiles_role_idx on app.profiles (role) where role <> 'customer';

create table app.addresses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app.profiles (id) on delete cascade,
  label          text not null default 'Home' check (char_length(label) between 1 and 30),
  contact_name   text not null check (char_length(contact_name) between 1 and 100),
  contact_phone  text not null check (contact_phone ~ '^\+?[0-9]{10,15}$'),
  line1          text not null check (char_length(line1) between 3 and 200),
  line2          text check (char_length(line2) <= 200),
  landmark       text check (char_length(landmark) <= 100),
  city           text not null check (char_length(city) between 2 and 60),
  pincode        text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index addresses_user_idx on app.addresses (user_id);
create unique index addresses_one_default_idx on app.addresses (user_id) where is_default;

-- ---------- Catalog ----------
create table app.product_categories (
  id           int generated always as identity primary key,
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null check (char_length(name) between 2 and 60),
  description  text check (char_length(description) <= 500),
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table app.products (
  id                 int generated always as identity primary key,
  category_id        int  not null references app.product_categories (id) on delete restrict,
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text not null check (char_length(name) between 2 and 100),
  short_description  text check (char_length(short_description) <= 200),
  description        text check (char_length(description) <= 2000),
  unit_label         text not null check (char_length(unit_label) between 1 and 60),   -- e.g. "20 L can", "Case of 24 × 500 ml"
  price              numeric(10,2) not null check (price >= 0),
  is_sample_price    boolean not null default true,     -- shows a "Sample price" badge until you set real prices
  is_returnable_can  boolean not null default false,    -- 20 L cans that are exchanged / carry a deposit
  deposit_amount     numeric(10,2) not null default 0 check (deposit_amount >= 0),
  track_stock        boolean not null default true,
  stock_qty          int not null default 0 check (stock_qty >= 0),
  min_order_qty      int not null default 1 check (min_order_qty >= 1),
  max_order_qty      int not null default 50,
  image_path         text check (char_length(image_path) <= 300),
  sort_order         int  not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint products_qty_range check (max_order_qty >= min_order_qty)
);
create index products_category_idx on app.products (category_id);

-- ---------- Delivery ----------
create table app.delivery_zones (
  id                 int generated always as identity primary key,
  name               text not null check (char_length(name) between 2 and 60),
  pincodes           text[] not null default '{}',
  delivery_charge    numeric(10,2) not null default 0 check (delivery_charge >= 0),
  free_delivery_min  numeric(10,2) check (free_delivery_min >= 0),   -- null = never free
  min_order_amount   numeric(10,2) not null default 0 check (min_order_amount >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index delivery_zones_pincodes_idx on app.delivery_zones using gin (pincodes);

create table app.delivery_slots (
  id              int generated always as identity primary key,
  label           text not null check (char_length(label) between 2 and 40),
  start_time      time not null,
  end_time        time not null,
  capacity        int  not null check (capacity > 0),          -- orders per slot per day
  cutoff_minutes  int  not null default 120 check (cutoff_minutes >= 0),  -- order at least this long before the slot starts
  days_of_week    smallint[] not null default '{1,2,3,4,5,6,7}',          -- ISO: 1 = Monday … 7 = Sunday
  sort_order      int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint delivery_slots_times check (end_time > start_time),
  constraint delivery_slots_days check (days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[])
);

-- Exactly one row of business rules, edited from the admin Settings page.
create table app.business_settings (
  id                           smallint primary key default 1 check (id = 1),
  deposit_enabled              boolean not null default false,
  cod_enabled                  boolean not null default true,
  online_payment_enabled       boolean not null default true,
  max_advance_days             int not null default 7  check (max_advance_days between 0 and 60),
  closed_dates                 date[] not null default '{}',
  unpaid_order_expiry_minutes  int not null default 30 check (unpaid_order_expiry_minutes between 5 and 1440),
  timezone                     text not null default 'Asia/Kolkata',
  updated_at                   timestamptz not null default now()
);

-- ---------- Orders ----------
create table app.orders (
  id                uuid primary key default gen_random_uuid(),
  order_no          text not null unique default ('AQ' || nextval('app.order_no_seq')::text),
  user_id           uuid not null references app.profiles (id) on delete restrict,
  address_id        uuid references app.addresses (id) on delete set null,
  delivery_address  jsonb not null,                 -- copy taken when the order is placed
  zone_id           int  references app.delivery_zones (id) on delete set null,
  delivery_date     date not null,
  slot_id           int  references app.delivery_slots (id) on delete set null,
  slot_label        text not null,
  status            app.order_status   not null default 'pending',
  payment_method    app.payment_method not null,
  payment_status    app.payment_status not null,
  subtotal          numeric(10,2) not null check (subtotal >= 0),
  delivery_charge   numeric(10,2) not null check (delivery_charge >= 0),
  deposit_total     numeric(10,2) not null default 0 check (deposit_total >= 0),
  total             numeric(10,2) not null check (total > 0),
  customer_notes    text check (char_length(customer_notes) <= 500),
  admin_notes       text check (char_length(admin_notes) <= 1000),
  needs_refund      boolean not null default false,   -- paid but cancelled, or paid twice: refund from the Razorpay dashboard
  idempotency_key   uuid not null,                    -- stops a double-click creating two orders
  cans_delivered    int check (cans_delivered >= 0),
  empties_collected int check (empties_collected >= 0),
  cancel_reason     text check (char_length(cancel_reason) <= 300),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  constraint orders_total_adds_up check (total = subtotal + delivery_charge + deposit_total),
  constraint orders_idempotency unique (user_id, idempotency_key)
);
create index orders_user_idx      on app.orders (user_id, created_at desc);
create index orders_status_idx    on app.orders (status, delivery_date);
create index orders_slot_idx      on app.orders (delivery_date, slot_id) where status <> 'cancelled';
create index orders_created_idx   on app.orders (created_at);

create table app.order_items (
  id                bigint generated always as identity primary key,
  order_id          uuid not null references app.orders (id) on delete cascade,
  product_id        int  not null references app.products (id) on delete restrict,
  product_name      text not null,
  unit_label        text not null,
  unit_price        numeric(10,2) not null check (unit_price >= 0),
  quantity          int not null check (quantity > 0),
  line_total        numeric(10,2) not null check (line_total >= 0),
  deposit_per_unit  numeric(10,2) not null default 0 check (deposit_per_unit >= 0),
  deposit_qty       int not null default 0 check (deposit_qty >= 0 and deposit_qty <= quantity),
  deposit_total     numeric(10,2) not null default 0 check (deposit_total >= 0)
);
create index order_items_order_idx   on app.order_items (order_id);
create index order_items_product_idx on app.order_items (product_id);

create table app.order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references app.orders (id) on delete cascade,
  from_status  app.order_status,
  to_status    app.order_status not null,
  note         text check (char_length(note) <= 500),
  changed_by   uuid references app.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index order_status_history_order_idx on app.order_status_history (order_id, created_at);

-- ---------- Payments ----------
create table app.payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references app.orders (id) on delete restrict,
  provider             text not null check (provider in ('razorpay', 'cash')),
  razorpay_order_id    text unique,
  razorpay_payment_id  text unique,
  amount_paise         bigint not null check (amount_paise > 0),
  currency             text not null default 'INR',
  status               text not null check (status in ('created', 'captured', 'failed', 'refunded')),
  method               text,                -- upi / card / netbanking … as reported by Razorpay
  error_code           text,
  error_description    text,
  recorded_by          uuid references app.profiles (id) on delete set null,   -- staff member for cash
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  captured_at          timestamptz,
  constraint payments_razorpay_has_order check (provider <> 'razorpay' or razorpay_order_id is not null)
);
create index payments_order_idx on app.payments (order_id);

-- Every Razorpay webhook event id we have processed (stops replays and duplicates).
create table app.payment_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now()
);

-- ---------- Can deposits ----------
-- cans_delta > 0: deposit collected for that many cans; < 0: cans returned and deposit refunded.
-- SUM(cans_delta) per customer = cans they hold with a deposit paid.
create table app.can_deposit_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references app.profiles (id) on delete cascade,
  order_id    uuid references app.orders (id) on delete set null,
  entry_type  app.deposit_entry not null,
  cans_delta  int not null,
  amount      numeric(10,2) not null,
  note        text check (char_length(note) <= 300),
  created_by  uuid references app.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index can_deposit_ledger_user_idx on app.can_deposit_ledger (user_id);

-- ---------- Stock ----------
create table app.inventory_transactions (
  id          bigint generated always as identity primary key,
  product_id  int not null references app.products (id) on delete cascade,
  qty_delta   int not null check (qty_delta <> 0),
  reason      app.inventory_reason not null,
  order_id    uuid references app.orders (id) on delete set null,
  note        text check (char_length(note) <= 300),
  created_by  uuid references app.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index inventory_transactions_product_idx on app.inventory_transactions (product_id, created_at desc);

-- ---------- Enquiries, testimonials ----------
create table app.enquiries (
  id              uuid primary key default gen_random_uuid(),
  enquiry_type    app.enquiry_type   not null default 'general',
  status          app.enquiry_status not null default 'new',
  name            text not null check (char_length(name) between 2 and 100),
  phone           text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  company         text check (char_length(company) <= 100),
  quantity_note   text check (char_length(quantity_note) <= 200),
  preferred_date  date,
  message         text not null check (char_length(message) between 5 and 2000),
  admin_notes     text check (char_length(admin_notes) <= 1000),
  user_id         uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index enquiries_status_idx on app.enquiries (status, created_at desc);

create table app.testimonials (
  id               int generated always as identity primary key,
  author_name      text not null check (char_length(author_name) between 2 and 60),
  author_location  text check (char_length(author_location) <= 60),
  content          text not null check (char_length(content) between 10 and 600),
  rating           smallint check (rating between 1 and 5),
  is_sample        boolean not null default true,   -- shown with a "Sample review" label
  is_published     boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now()
);

-- ---------- Rate limiting (used by the API) ----------
create table app.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          int not null default 0,
  primary key (key, window_start)
);

-- The single settings row (defaults: COD and online payment on, deposits off).
insert into app.business_settings (id) values (1) on conflict (id) do nothing;

-- >>>>> migrations/0003_helpers_triggers.sql
-- =====================================================================
-- AquaPure Water — 0003: helper functions and triggers
-- SECURITY DEFINER functions use an empty search_path and fully qualified
-- names, so nobody can hijack them by creating look-alike objects.
-- =====================================================================

-- ---------- Who is calling? ----------
-- Roles are read from app.profiles on every call, never from the JWT, so a
-- forged or stale token cannot grant admin rights and demotions apply at once.
create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function app.is_staff()   -- staff or admin
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.profiles
    where id = auth.uid() and role in ('staff', 'admin') and is_active
  );
$$;

-- Raises the standard "not allowed" error used by the API (mapped to HTTP 403).
create or replace function app.require_staff()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
end $$;

create or replace function app.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
end $$;

-- Today's date in the business time zone (orders and slots use local dates).
create or replace function app.local_now()
returns timestamp
language sql stable security definer set search_path = ''
as $$
  select now() at time zone coalesce((select timezone from app.business_settings where id = 1), 'Asia/Kolkata');
$$;

-- ---------- updated_at ----------
create or replace function app.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','addresses','product_categories','products','delivery_zones',
                           'delivery_slots','business_settings','orders','payments','enquiries']
  loop
    execute format('create trigger %I before update on app.%I for each row execute function app.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ---------- Profile for every new Supabase Auth user ----------
-- Works for both email + password and phone + SMS code sign-ups.
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into app.profiles (id, full_name, phone, email)
  values (
    new.id,
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 100),
    case when coalesce(new.phone, '') ~ '^\+?[0-9]{10,15}$' then new.phone end,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Keep email in step when the user changes it in Supabase Auth.
create or replace function app.handle_user_email_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update app.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app.handle_user_email_change();

-- ---------- One default address per customer ----------
create or replace function app.addresses_default()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- The first address is always the default.
  if not exists (select 1 from app.addresses where user_id = new.user_id and id <> new.id) then
    new.is_default := true;
  end if;
  if new.is_default then
    update app.addresses set is_default = false
    where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end $$;

create trigger addresses_default
  before insert or update of is_default on app.addresses
  for each row execute function app.addresses_default();

-- A customer may hold at most 10 addresses.
create or replace function app.addresses_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from app.addresses where user_id = new.user_id) >= 10 then
    raise exception 'You can save up to 10 addresses.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger addresses_limit
  before insert on app.addresses
  for each row execute function app.addresses_limit();

-- >>>>> migrations/0004_rls.sql
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

-- >>>>> migrations/0005_order_functions.sql
-- =====================================================================
-- AquaPure Water — 0005: pricing, delivery slots, orders, enquiries
--
-- Error codes the API understands:
--   P0001  business rule broken  → HTTP 400 with this message shown to the user
--   P0002  not found             → HTTP 404
--   42501  not allowed           → HTTP 403
--
-- price_order and admin_set_order_status are replaced in 0010_cans_per_unit.sql
-- (deposits and can counts in cans rather than product units).
-- =====================================================================

-- ---------- Delivery slots for a date ----------
create or replace function app.available_slots(p_date date)
returns table (slot_id int, label text, start_time time, end_time time,
               remaining int, is_available boolean, reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings app.business_settings;
  v_now      timestamp := app.local_now();
  v_today    date := (app.local_now())::date;
  v_date_reason text;
begin
  select * into v_settings from app.business_settings where id = 1;

  v_date_reason := case
    when p_date is null then 'Choose a date'
    when p_date < v_today then 'Date has passed'
    when p_date > v_today + v_settings.max_advance_days then 'Too far ahead'
    when p_date = any (v_settings.closed_dates) then 'Closed on this day'
  end;

  return query
  select s.id, s.label, s.start_time, s.end_time,
         greatest(s.capacity - coalesce(b.booked, 0), 0)::int,
         r.reason is null,
         r.reason
  from app.delivery_slots s
  left join lateral (
    select count(*)::int as booked from app.orders o
    where o.delivery_date = p_date and o.slot_id = s.id and o.status <> 'cancelled'
  ) b on true
  cross join lateral (
    select coalesce(v_date_reason, case
      when not (extract(isodow from p_date)::smallint = any (s.days_of_week)) then 'Not available on this day'
      when p_date + s.start_time - make_interval(mins => s.cutoff_minutes) <= v_now then 'Booking closed'
      when coalesce(b.booked, 0) >= s.capacity then 'Full'
    end) as reason
  ) r
  where s.is_active
  order by s.sort_order, s.start_time;
end $$;

-- ---------- Pricing (internal) ----------
-- Every amount comes from the database; nothing the browser sends is trusted
-- except product ids and quantities, which are validated here.
-- p_items: [{"product_id": 1, "quantity": 2}, ...]
create or replace function app.price_order(p_user_id uuid, p_address_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_addr      app.addresses;
  v_zone      app.delivery_zones;
  v_settings  app.business_settings;
  v_lines     jsonb := '[]'::jsonb;
  v_subtotal  numeric(10,2) := 0;
  v_deposit   numeric(10,2) := 0;
  v_delivery  numeric(10,2);
  v_covered   int := 0;
  v_count     int;
  v_distinct  int;
  r           record;
  v_dep_qty   int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'Too many different products in one order (maximum 20).' using errcode = 'P0001';
  end if;

  select count(*), count(distinct (e ->> 'product_id'))
    into v_count, v_distinct
  from jsonb_array_elements(p_items) e;
  if v_count <> v_distinct then
    raise exception 'The same product appears twice in the cart.' using errcode = 'P0001';
  end if;

  select * into v_addr from app.addresses where id = p_address_id and user_id = p_user_id;
  if not found then
    raise exception 'Please choose one of your saved delivery addresses.' using errcode = 'P0001';
  end if;

  select * into v_zone from app.delivery_zones
  where is_active and v_addr.pincode = any (pincodes)
  order by id limit 1;
  if not found then
    raise exception 'Sorry, we do not deliver to pincode % yet. Please contact us.', v_addr.pincode using errcode = 'P0001';
  end if;

  select * into v_settings from app.business_settings where id = 1;

  -- Cans the customer already holds with a deposit, plus cans with a deposit on open orders.
  if v_settings.deposit_enabled then
    select coalesce(sum(cans_delta), 0) into v_covered from app.can_deposit_ledger where user_id = p_user_id;
    v_covered := v_covered + coalesce((
      select sum(oi.deposit_qty) from app.order_items oi join app.orders o on o.id = oi.order_id
      where o.user_id = p_user_id and o.status in ('pending', 'confirmed', 'out_for_delivery')), 0);
  end if;

  for r in
    select p.*, (e ->> 'quantity')::int as qty
    from jsonb_array_elements(p_items) e
    left join app.products p on p.id = (e ->> 'product_id')::int and p.is_active
    order by p.id
  loop
    if r.id is null then
      raise exception 'A product in your cart is no longer available. Please refresh your cart.' using errcode = 'P0001';
    end if;
    if r.qty is null or r.qty < r.min_order_qty or r.qty > r.max_order_qty then
      raise exception 'Quantity for % must be between % and %.', r.name, r.min_order_qty, r.max_order_qty using errcode = 'P0001';
    end if;

    v_dep_qty := 0;
    if v_settings.deposit_enabled and r.is_returnable_can and r.deposit_amount > 0 then
      v_dep_qty := greatest(r.qty - v_covered, 0);
      v_covered := greatest(v_covered - r.qty, 0);
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', r.id, 'product_name', r.name, 'unit_label', r.unit_label,
      'unit_price', r.price, 'quantity', r.qty, 'line_total', r.price * r.qty,
      'track_stock', r.track_stock, 'stock_qty', r.stock_qty,
      'deposit_per_unit', case when v_dep_qty > 0 then r.deposit_amount else 0 end,
      'deposit_qty', v_dep_qty, 'deposit_total', v_dep_qty * r.deposit_amount);
    v_subtotal := v_subtotal + r.price * r.qty;
    v_deposit  := v_deposit + v_dep_qty * r.deposit_amount;
  end loop;

  v_delivery := case when v_zone.free_delivery_min is not null and v_subtotal >= v_zone.free_delivery_min
                     then 0 else v_zone.delivery_charge end;

  return jsonb_build_object(
    'address', jsonb_build_object(
        'label', v_addr.label, 'contact_name', v_addr.contact_name, 'contact_phone', v_addr.contact_phone,
        'line1', v_addr.line1, 'line2', v_addr.line2, 'landmark', v_addr.landmark,
        'city', v_addr.city, 'pincode', v_addr.pincode),
    'zone_id', v_zone.id, 'zone_name', v_zone.name,
    'min_order_amount', v_zone.min_order_amount,
    'free_delivery_min', v_zone.free_delivery_min,
    'lines', v_lines,
    'subtotal', v_subtotal, 'delivery_charge', v_delivery, 'deposit_total', v_deposit,
    'total', v_subtotal + v_delivery + v_deposit);
end $$;

-- Totals for the checkout page (same calculation as place_order).
create or replace function app.quote_order(p_address_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  return app.price_order(v_uid, p_address_id, p_items) - 'address';
end $$;

-- ---------- Place an order ----------
create or replace function app.place_order(
  p_address_id      uuid,
  p_items           jsonb,
  p_delivery_date   date,
  p_slot_id         int,
  p_payment_method  app.payment_method,
  p_notes           text,
  p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_order_id  uuid;
  v_settings  app.business_settings;
  v_slot      record;
  v_price     jsonb;
  v_line      jsonb;
  v_stock     int;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'Missing request key.' using errcode = 'P0001'; end if;

  -- Same request sent twice (double-click, network retry): return the first order.
  select id into v_order_id from app.orders where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then return v_order_id; end if;

  if not exists (select 1 from app.profiles where id = v_uid and is_active) then
    raise exception 'Your account is not active. Please contact us.' using errcode = '42501';
  end if;

  select * into v_settings from app.business_settings where id = 1;
  if p_payment_method = 'cod' and not v_settings.cod_enabled then
    raise exception 'Cash on delivery is not available right now.' using errcode = 'P0001';
  end if;
  if p_payment_method = 'razorpay' and not v_settings.online_payment_enabled then
    raise exception 'Online payment is not available right now.' using errcode = 'P0001';
  end if;

  -- Lock the slot so two customers cannot both take its last place.
  perform 1 from app.delivery_slots where id = p_slot_id for update;
  select * into v_slot from app.available_slots(p_delivery_date) s where s.slot_id = p_slot_id;
  if not found then
    raise exception 'Please choose a delivery slot.' using errcode = 'P0001';
  end if;
  if not v_slot.is_available then
    raise exception 'The % slot on % is not available (%). Please choose another.',
      v_slot.label, to_char(p_delivery_date, 'DD Mon'), lower(v_slot.reason) using errcode = 'P0001';
  end if;

  -- Lock the products (in id order, to avoid deadlocks) before checking stock.
  perform 1 from app.products
  where id in (select (e ->> 'product_id')::int from jsonb_array_elements(p_items) e)
  order by id for update;

  v_price := app.price_order(v_uid, p_address_id, p_items);

  if (v_price ->> 'subtotal')::numeric < (v_price ->> 'min_order_amount')::numeric then
    raise exception 'The minimum order for your area is ₹%.', v_price ->> 'min_order_amount' using errcode = 'P0001';
  end if;

  begin
    insert into app.orders (user_id, address_id, delivery_address, zone_id, delivery_date, slot_id, slot_label,
                            payment_method, payment_status, subtotal, delivery_charge, deposit_total, total,
                            customer_notes, idempotency_key)
    values (v_uid, p_address_id, v_price -> 'address', (v_price ->> 'zone_id')::int, p_delivery_date, p_slot_id,
            v_slot.label || ' (' || to_char(v_slot.start_time, 'HH12:MI AM') || ' – ' || to_char(v_slot.end_time, 'HH12:MI AM') || ')',
            p_payment_method,
            case when p_payment_method = 'cod' then 'unpaid'::app.payment_status else 'pending'::app.payment_status end,
            (v_price ->> 'subtotal')::numeric, (v_price ->> 'delivery_charge')::numeric,
            (v_price ->> 'deposit_total')::numeric, (v_price ->> 'total')::numeric,
            nullif(left(trim(p_notes), 500), ''), p_idempotency_key)
    returning id into v_order_id;
  exception when unique_violation then
    -- A parallel request with the same key won the race.
    select id into v_order_id from app.orders where user_id = v_uid and idempotency_key = p_idempotency_key;
    if v_order_id is null then raise; end if;
    return v_order_id;
  end;

  for v_line in select * from jsonb_array_elements(v_price -> 'lines') loop
    insert into app.order_items (order_id, product_id, product_name, unit_label, unit_price, quantity, line_total,
                                 deposit_per_unit, deposit_qty, deposit_total)
    values (v_order_id, (v_line ->> 'product_id')::int, v_line ->> 'product_name', v_line ->> 'unit_label',
            (v_line ->> 'unit_price')::numeric, (v_line ->> 'quantity')::int, (v_line ->> 'line_total')::numeric,
            (v_line ->> 'deposit_per_unit')::numeric, (v_line ->> 'deposit_qty')::int, (v_line ->> 'deposit_total')::numeric);

    if (v_line ->> 'track_stock')::boolean then
      update app.products set stock_qty = stock_qty - (v_line ->> 'quantity')::int
      where id = (v_line ->> 'product_id')::int and stock_qty >= (v_line ->> 'quantity')::int
      returning stock_qty into v_stock;
      if not found then
        raise exception 'Sorry, only % left of %.', v_line ->> 'stock_qty', v_line ->> 'product_name' using errcode = 'P0001';
      end if;
      insert into app.inventory_transactions (product_id, qty_delta, reason, order_id, created_by)
      values ((v_line ->> 'product_id')::int, -(v_line ->> 'quantity')::int, 'order_reserved', v_order_id, v_uid);
    end if;
  end loop;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (v_order_id, null, 'pending', 'Order placed', v_uid);

  return v_order_id;
end $$;

-- ---------- Cancelling (internal; puts stock back) ----------
create or replace function app.cancel_order_internal(p_order_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order app.orders;
  r record;
begin
  select * into v_order from app.orders where id = p_order_id for update;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'This order is already %.', v_order.status using errcode = 'P0001';
  end if;

  update app.orders
  set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(left(trim(p_reason), 300), ''),
      needs_refund = needs_refund or payment_status = 'paid'
  where id = p_order_id;

  for r in
    select oi.product_id, oi.quantity from app.order_items oi
    join app.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.track_stock
    order by oi.product_id
  loop
    update app.products set stock_qty = stock_qty + r.quantity where id = r.product_id;
    insert into app.inventory_transactions (product_id, qty_delta, reason, order_id, created_by)
    values (r.product_id, r.quantity, 'order_released', p_order_id, p_actor);
  end loop;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, 'cancelled', coalesce(nullif(left(trim(p_reason), 300), ''), 'Cancelled'), p_actor);
end $$;

-- Customers may cancel their own order while it is still pending and not paid.
create or replace function app.cancel_my_order(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  if auth.uid() is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  select * into v_order from app.orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.status <> 'pending' then
    raise exception 'This order is already % and can no longer be cancelled online. Please call us.',
      replace(v_order.status::text, '_', ' ') using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order is already paid. Please contact us to cancel it and arrange a refund.' using errcode = 'P0001';
  end if;
  perform app.cancel_order_internal(p_order_id, auth.uid(), coalesce(nullif(trim(p_reason), ''), 'Cancelled by customer'));
end $$;

-- ---------- Staff: move an order along ----------
-- pending → confirmed | cancelled
-- confirmed → out_for_delivery | cancelled
-- out_for_delivery → delivered | confirmed (delivery attempt failed) | cancelled
create or replace function app.admin_set_order_status(
  p_order_id uuid, p_status app.order_status, p_note text default null,
  p_cans_delivered int default null, p_empties_collected int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order app.orders;
  v_dep_qty int;
begin
  perform app.require_staff();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;

  if not ((v_order.status = 'pending'          and p_status in ('confirmed', 'cancelled'))
       or (v_order.status = 'confirmed'        and p_status in ('out_for_delivery', 'cancelled'))
       or (v_order.status = 'out_for_delivery' and p_status in ('delivered', 'confirmed', 'cancelled'))) then
    raise exception 'An order that is % cannot be changed to %.',
      replace(v_order.status::text, '_', ' '), replace(p_status::text, '_', ' ') using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' then
    perform app.cancel_order_internal(p_order_id, auth.uid(), coalesce(p_note, 'Cancelled by AquaPure'));
    return;
  end if;

  if p_status = 'confirmed' and v_order.status = 'pending'
     and v_order.payment_method = 'razorpay' and v_order.payment_status <> 'paid' then
    raise exception 'Online payment has not been received for this order yet.' using errcode = 'P0001';
  end if;

  if p_status = 'delivered' then
    if p_cans_delivered < 0 or p_empties_collected < 0 then
      raise exception 'Can counts cannot be negative.' using errcode = 'P0001';
    end if;
    update app.orders
    set delivered_at = now(),
        cans_delivered = coalesce(p_cans_delivered, (
          select coalesce(sum(oi.quantity), 0) from app.order_items oi join app.products p on p.id = oi.product_id
          where oi.order_id = p_order_id and p.is_returnable_can)),
        empties_collected = p_empties_collected
    where id = p_order_id;

    select coalesce(sum(deposit_qty), 0) into v_dep_qty from app.order_items where order_id = p_order_id;
    if v_dep_qty > 0 then
      insert into app.can_deposit_ledger (user_id, order_id, entry_type, cans_delta, amount, note, created_by)
      values (v_order.user_id, p_order_id, 'collected', v_dep_qty, v_order.deposit_total,
              'Deposit with order ' || v_order.order_no, auth.uid());
    end if;
  end if;

  update app.orders
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' and confirmed_at is null then now() else confirmed_at end
  where id = p_order_id;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, p_status, nullif(left(trim(p_note), 500), ''), auth.uid());
end $$;

-- Staff: cash collected for a cash-on-delivery order.
create or replace function app.admin_mark_cod_paid(p_order_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  perform app.require_staff();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'cod' or v_order.payment_status <> 'unpaid' or v_order.status = 'cancelled' then
    raise exception 'Only unpaid cash-on-delivery orders can be marked as paid.' using errcode = 'P0001';
  end if;
  insert into app.payments (order_id, provider, amount_paise, status, recorded_by, captured_at)
  values (p_order_id, 'cash', (v_order.total * 100)::bigint, 'captured', auth.uid(), now());
  update app.orders set payment_status = 'paid' where id = p_order_id;
end $$;

-- Admin: a refund was made in the Razorpay dashboard (or in cash).
create or replace function app.admin_mark_refunded(p_order_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order app.orders;
begin
  perform app.require_admin();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'Only paid orders can be marked as refunded.' using errcode = 'P0001';
  end if;
  update app.orders
  set payment_status = 'refunded', needs_refund = false,
      admin_notes = left(concat_ws(E'\n', admin_notes, 'Refunded: ' || coalesce(nullif(trim(p_note), ''), 'no note')), 1000)
  where id = p_order_id;
  update app.payments set status = 'refunded' where order_id = p_order_id and status = 'captured';
end $$;

create or replace function app.admin_set_order_notes(p_order_id uuid, p_notes text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_staff();
  update app.orders set admin_notes = nullif(left(trim(p_notes), 1000), '') where id = p_order_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
end $$;

-- ---------- Admin: stock, deposits, roles ----------
create or replace function app.admin_adjust_stock(p_product_id int, p_delta int, p_reason app.inventory_reason, p_note text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_new int;
begin
  perform app.require_admin();
  if p_reason not in ('restock', 'adjustment', 'damaged') then
    raise exception 'Reason must be restock, adjustment or damaged.' using errcode = 'P0001';
  end if;
  if p_delta = 0 then raise exception 'Change cannot be zero.' using errcode = 'P0001'; end if;
  update app.products set stock_qty = stock_qty + p_delta
  where id = p_product_id and stock_qty + p_delta >= 0
  returning stock_qty into v_new;
  if not found then
    raise exception 'Product not found, or stock would go below zero.' using errcode = 'P0001';
  end if;
  insert into app.inventory_transactions (product_id, qty_delta, reason, note, created_by)
  values (p_product_id, p_delta, p_reason, nullif(left(trim(p_note), 300), ''), auth.uid());
  return v_new;
end $$;

-- Cans returned and deposit paid back (or a manual correction).
create or replace function app.admin_record_deposit(p_user_id uuid, p_entry app.deposit_entry, p_cans int, p_amount numeric, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_held int;
begin
  perform app.require_admin();
  if p_entry = 'collected' then
    raise exception 'Deposits are collected through orders. Use refunded or adjustment here.' using errcode = 'P0001';
  end if;
  select coalesce(sum(cans_delta), 0) into v_held from app.can_deposit_ledger where user_id = p_user_id;
  if p_entry = 'refunded' then
    if p_cans <= 0 or p_amount < 0 then
      raise exception 'Enter the number of cans returned and the amount refunded.' using errcode = 'P0001';
    end if;
    if p_cans > v_held then
      raise exception 'This customer holds only % can(s) with a deposit.', v_held using errcode = 'P0001';
    end if;
    insert into app.can_deposit_ledger (user_id, entry_type, cans_delta, amount, note, created_by)
    values (p_user_id, 'refunded', -p_cans, -p_amount, nullif(left(trim(p_note), 300), ''), auth.uid());
  else
    if v_held + p_cans < 0 then
      raise exception 'Can balance cannot go below zero.' using errcode = 'P0001';
    end if;
    insert into app.can_deposit_ledger (user_id, entry_type, cans_delta, amount, note, created_by)
    values (p_user_id, 'adjustment', p_cans, p_amount, nullif(left(trim(p_note), 300), ''), auth.uid());
  end if;
end $$;

create or replace function app.admin_set_user_role(p_user_id uuid, p_role app.user_role, p_is_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.require_admin();
  -- Serialise role changes so two admins cannot demote each other at the same moment.
  perform 1 from app.profiles where role = 'admin' for update;
  update app.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then raise exception 'User not found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from app.profiles where role = 'admin' and is_active) then
    raise exception 'There must be at least one active admin.' using errcode = 'P0001';
  end if;
end $$;

-- ---------- Enquiries (contact, bulk order, monthly supply) ----------
create or replace function app.submit_enquiry(
  p_type app.enquiry_type, p_name text, p_phone text, p_email text, p_company text,
  p_quantity_note text, p_preferred_date date, p_message text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_preferred_date is not null and (p_preferred_date < current_date or p_preferred_date > current_date + 365) then
    raise exception 'Please choose a date within the next year.' using errcode = 'P0001';
  end if;
  insert into app.enquiries (enquiry_type, name, phone, email, company, quantity_note, preferred_date, message, user_id)
  values (coalesce(p_type, 'general'), trim(p_name), regexp_replace(p_phone, '[\s-]', '', 'g'),
          nullif(trim(p_email), ''), nullif(trim(p_company), ''), nullif(trim(p_quantity_note), ''),
          p_preferred_date, trim(p_message), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Who may call what ----------
grant execute on function app.available_slots(date)                      to anon, authenticated;
grant execute on function app.submit_enquiry(app.enquiry_type, text, text, text, text, text, date, text) to anon, authenticated;
grant execute on function app.quote_order(uuid, jsonb)                   to authenticated;
grant execute on function app.place_order(uuid, jsonb, date, int, app.payment_method, text, uuid) to authenticated;
grant execute on function app.cancel_my_order(uuid, text)                to authenticated;
grant execute on function app.admin_set_order_status(uuid, app.order_status, text, int, int) to authenticated;
grant execute on function app.admin_mark_cod_paid(uuid)                  to authenticated;
grant execute on function app.admin_mark_refunded(uuid, text)            to authenticated;
grant execute on function app.admin_set_order_notes(uuid, text)          to authenticated;
grant execute on function app.admin_adjust_stock(int, int, app.inventory_reason, text) to authenticated;
grant execute on function app.admin_record_deposit(uuid, app.deposit_entry, int, numeric, text) to authenticated;
grant execute on function app.admin_set_user_role(uuid, app.user_role, boolean) to authenticated;
-- price_order and cancel_order_internal are internal: no grants.
-- expire_unpaid_orders is defined in 0006.

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;

-- >>>>> migrations/0006_payment_functions.sql
-- =====================================================================
-- AquaPure Water — 0006: Razorpay payments, webhooks, rate limiting
--
-- Only the "wbms_api" role may call these, and only as itself (never while
-- acting as a customer). The API calls them after it has verified the Razorpay
-- signature and, for captures, re-fetched the payment from Razorpay.
-- Every function is safe to call more than once with the same input.
-- =====================================================================

-- Step 1 of checkout: check the order can be paid online and return what the
-- API needs to create (or reuse) a Razorpay order. p_user_id is the signed-in
-- user the API verified from the JWT.
create or replace function app.begin_razorpay_checkout(p_order_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order   app.orders;
  v_profile app.profiles;
  v_rzp     text;
begin
  select * into v_order from app.orders where id = p_order_id and user_id = p_user_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'razorpay' then
    raise exception 'This order is not set up for online payment.' using errcode = 'P0001';
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'This order is already paid.' using errcode = 'P0001';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status not in ('pending', 'failed') then
    raise exception 'This order can no longer be paid online.' using errcode = 'P0001';
  end if;

  -- Reuse the open Razorpay order for the same amount (Razorpay allows several
  -- attempts on one order), so retries never create a second payable order.
  update app.payments set updated_at = now()
  where order_id = p_order_id and provider = 'razorpay' and status = 'created'
    and amount_paise = (v_order.total * 100)::bigint
  returning razorpay_order_id into v_rzp;

  update app.orders set payment_status = 'pending' where id = p_order_id and payment_status = 'failed';

  select * into v_profile from app.profiles where id = p_user_id;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'amount_paise', (v_order.total * 100)::bigint, 'currency', 'INR',
    'razorpay_order_id', v_rzp,
    'customer_name', v_profile.full_name, 'customer_email', v_profile.email,
    'customer_phone', coalesce(v_profile.phone, v_order.delivery_address ->> 'contact_phone'));
end $$;

-- Step 2: remember the Razorpay order the API just created.
create or replace function app.record_razorpay_order(p_order_id uuid, p_razorpay_order_id text, p_amount_paise bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_total bigint;
begin
  select (total * 100)::bigint into v_total from app.orders where id = p_order_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_total <> p_amount_paise then
    raise exception 'Amount does not match the order total.' using errcode = 'P0001';
  end if;
  insert into app.payments (order_id, provider, razorpay_order_id, amount_paise, status)
  values (p_order_id, 'razorpay', p_razorpay_order_id, p_amount_paise, 'created')
  on conflict (razorpay_order_id) do nothing;
end $$;

-- A payment was captured (from the checkout callback or the webhook).
-- Returns: applied | already_recorded | unknown_order | amount_mismatch | duplicate | paid_but_cancelled
create or replace function app.mark_payment_captured(
  p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_paise bigint, p_method text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_pay   app.payments;
  v_order app.orders;
  v_note  text;
begin
  select * into v_pay from app.payments where razorpay_order_id = p_razorpay_order_id for update;
  if not found then return 'unknown_order'; end if;            -- not created by this site
  select * into v_order from app.orders where id = v_pay.order_id for update;

  if v_pay.razorpay_payment_id = p_razorpay_payment_id and v_pay.status in ('captured', 'refunded') then
    return 'already_recorded';                                  -- callback + webhook, or a retry
  end if;

  if p_amount_paise <> v_pay.amount_paise or p_amount_paise <> (v_order.total * 100)::bigint then
    update app.payments
    set error_code = 'amount_mismatch',
        error_description = format('Captured %s paise, expected %s', p_amount_paise, v_pay.amount_paise)
    where id = v_pay.id;
    update app.orders set needs_refund = true,
      admin_notes = left(concat_ws(E'\n', admin_notes, format('Payment %s amount did not match the order. Check Razorpay.', p_razorpay_payment_id)), 1000)
    where id = v_order.id;
    return 'amount_mismatch';
  end if;

  if v_pay.status = 'captured' or v_order.payment_status in ('paid', 'refunded') then
    -- The order was already paid through another payment: keep a record and flag a refund.
    v_note := format('Second payment %s received for this order. Refund it from the Razorpay dashboard.', p_razorpay_payment_id);
    if v_pay.status <> 'captured' then
      update app.payments set status = 'captured', razorpay_payment_id = p_razorpay_payment_id,
                              method = p_method, captured_at = now()
      where id = v_pay.id;
    end if;
    update app.orders set needs_refund = true, admin_notes = left(concat_ws(E'\n', admin_notes, v_note), 1000)
    where id = v_order.id;
    return 'duplicate';
  end if;

  update app.payments
  set status = 'captured', razorpay_payment_id = p_razorpay_payment_id, method = p_method,
      captured_at = now(), error_code = null, error_description = null
  where id = v_pay.id;

  update app.orders
  set payment_status = 'paid', needs_refund = (status = 'cancelled')
  where id = v_order.id;

  if v_order.status = 'cancelled' then
    update app.orders set admin_notes = left(concat_ws(E'\n', admin_notes,
      'Payment arrived after the order was cancelled. Refund it, or contact the customer.'), 1000)
    where id = v_order.id;
    return 'paid_but_cancelled';
  end if;
  return 'applied';
end $$;

-- A payment attempt failed. The customer can try again on the same Razorpay order.
create or replace function app.mark_payment_failed(
  p_razorpay_order_id text, p_razorpay_payment_id text, p_error_code text, p_error_description text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_pay app.payments;
begin
  select * into v_pay from app.payments where razorpay_order_id = p_razorpay_order_id for update;
  if not found then return 'unknown_order'; end if;
  if v_pay.status <> 'created' then return 'ignored'; end if;   -- already captured: a late failure event
  update app.payments
  set error_code = left(p_error_code, 100), error_description = left(p_error_description, 500)
  where id = v_pay.id;
  update app.orders set payment_status = 'failed'
  where id = v_pay.order_id and payment_status = 'pending';
  return 'recorded';
end $$;

-- Returns true the first time an event id is seen. The API calls this in the same
-- transaction as the mark_* function, so a failure rolls both back and Razorpay retries.
create or replace function app.record_webhook_event(p_event_id text, p_event_type text, p_payload jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into app.payment_webhook_events (event_id, event_type, payload)
  values (p_event_id, p_event_type, p_payload)
  on conflict (event_id) do nothing;
  return found;
end $$;

-- Fixed-window rate limit shared by every API server. Returns false when over the limit.
create or replace function app.check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limits (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Unpaid online orders: don't expire one while a payment attempt is recent.
create or replace function app.expire_unpaid_orders()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_minutes int;
  v_id uuid;
  v_count int := 0;
begin
  select unpaid_order_expiry_minutes into v_minutes from app.business_settings where id = 1;
  for v_id in
    select o.id from app.orders o
    where o.status = 'pending' and o.payment_method = 'razorpay' and o.payment_status in ('pending', 'failed')
      and o.created_at < now() - make_interval(mins => v_minutes)
      and not exists (select 1 from app.payments p
                      where p.order_id = o.id and p.updated_at > now() - make_interval(mins => v_minutes))
    order by o.created_at
    for update of o skip locked
  loop
    perform app.cancel_order_internal(v_id, null, 'Online payment was not completed in time.');
    v_count := v_count + 1;
  end loop;
  delete from app.rate_limits where window_start < now() - interval '1 day';
  return v_count;
end $$;

grant execute on function app.begin_razorpay_checkout(uuid, uuid)            to wbms_api;
grant execute on function app.record_razorpay_order(uuid, text, bigint)      to wbms_api;
grant execute on function app.mark_payment_captured(text, text, bigint, text) to wbms_api;
grant execute on function app.mark_payment_failed(text, text, text, text)    to wbms_api;
grant execute on function app.record_webhook_event(text, text, jsonb)        to wbms_api;
grant execute on function app.check_rate_limit(text, int, int)               to wbms_api;
grant execute on function app.expire_unpaid_orders()                         to wbms_api;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;

-- >>>>> migrations/0007_storage.sql
-- =====================================================================
-- AquaPure Water — 0007: product image storage
-- Public bucket: anyone can view images by URL. Only admins can upload,
-- replace or delete (checked against app.profiles, not the browser).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and app.is_admin());

create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and app.is_admin())
  with check (bucket_id = 'product-images' and app.is_admin());

create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and app.is_admin());

-- Lets the admin page list existing images to pick from.
create policy product_images_admin_list on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and app.is_admin());

-- >>>>> migrations/0008_reports.sql
-- =====================================================================
-- AquaPure Water — 0008: reports for the admin dashboard
-- "Sales" counts orders that were not cancelled. "Collected" counts money
-- actually received (orders whose payment status is paid).
-- Deposits are shown separately: they are refundable, not revenue.
-- =====================================================================

create or replace function app.admin_sales_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_tz text := coalesce((select timezone from app.business_settings where id = 1), 'Asia/Kolkata');
begin
  perform app.require_staff();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a date range of up to one year.' using errcode = 'P0001';
  end if;

  with o as (
    select * from app.orders
    where (created_at at time zone v_tz)::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select jsonb_build_object(
        'orders',          count(*),
        'delivered',       count(*) filter (where status = 'delivered'),
        'cancelled',       count(*) filter (where status = 'cancelled'),
        'open',            count(*) filter (where status in ('pending', 'confirmed', 'out_for_delivery')),
        'sales',           coalesce(sum(subtotal + delivery_charge) filter (where status <> 'cancelled'), 0),
        'collected',       coalesce(sum(subtotal + delivery_charge) filter (where payment_status = 'paid'), 0),
        'deposits',        coalesce(sum(deposit_total) filter (where status <> 'cancelled'), 0),
        'cod_outstanding', coalesce(sum(total) filter (where payment_method = 'cod' and payment_status = 'unpaid' and status <> 'cancelled'), 0),
        'needs_refund',    count(*) filter (where needs_refund))
      from o),
    'by_day', coalesce((select jsonb_agg(d order by d ->> 'day') from (
        select jsonb_build_object(
          'day', (created_at at time zone v_tz)::date,
          'orders', count(*),
          'sales', coalesce(sum(subtotal + delivery_charge) filter (where status <> 'cancelled'), 0)) d
        from o group by (created_at at time zone v_tz)::date) x), '[]'::jsonb),
    'by_product', coalesce((select jsonb_agg(p order by (p ->> 'sales')::numeric desc) from (
        select jsonb_build_object(
          'product_id', oi.product_id, 'name', max(oi.product_name),
          'quantity', sum(oi.quantity), 'sales', sum(oi.line_total)) p
        from app.order_items oi join o on o.id = oi.order_id
        where o.status <> 'cancelled'
        group by oi.product_id) x), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from o group by status) x), '{}'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- Numbers for the admin home page.
create or replace function app.admin_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (app.local_now())::date;
  v_tz text := coalesce((select timezone from app.business_settings where id = 1), 'Asia/Kolkata');
begin
  perform app.require_staff();
  return jsonb_build_object(
    'pending_orders',      (select count(*) from app.orders where status = 'pending'),
    'today_deliveries',    (select count(*) from app.orders where delivery_date = v_today and status in ('confirmed', 'out_for_delivery')),
    'out_for_delivery',    (select count(*) from app.orders where status = 'out_for_delivery'),
    'needs_refund',        (select count(*) from app.orders where needs_refund),
    'new_enquiries',       (select count(*) from app.enquiries where status = 'new'),
    'low_stock',           (select count(*) from app.products where is_active and track_stock and stock_qty < 10),
    'today_sales',         (select coalesce(sum(subtotal + delivery_charge), 0) from app.orders
                            where (created_at at time zone v_tz)::date = v_today and status <> 'cancelled'));
end $$;

grant execute on function app.admin_sales_summary(date, date) to authenticated;
grant execute on function app.admin_dashboard()               to authenticated;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;

-- >>>>> migrations/0009_cron.sql
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

-- >>>>> migrations/0010_cans_per_unit.sql
-- =====================================================================
-- AquaPure Water — 0010: cans per unit
--
-- A product can hold several returnable cans (e.g. an office pack of five 20 L cans).
-- Deposits and the default "cans delivered" count are now worked out in CANS, not in
-- product units. products.deposit_amount is the deposit for ONE can.
-- order_items.deposit_qty / deposit_per_unit are a number of cans / the deposit per can.
--
-- Replaces app.price_order and app.admin_set_order_status from 0005.
-- Already installed AquaPure before this file existed? Run just this file in the SQL Editor.
-- It is safe to run more than once.
-- =====================================================================

alter table app.products
  add column if not exists cans_per_unit int not null default 1 check (cans_per_unit between 1 and 100);

-- order_items.deposit_qty is now a number of cans, so it can be more than the quantity of packs.
-- The old rule (deposit_qty <= quantity) had a generated name, so find it by its definition.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'app.order_items'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%deposit_qty <= quantity%'
  loop
    execute format('alter table app.order_items drop constraint %I', c.conname);
  end loop;
end $$;
alter table app.order_items drop constraint if exists order_items_deposit_qty_check;
alter table app.order_items add constraint order_items_deposit_qty_check check (deposit_qty >= 0);

comment on column app.products.cans_per_unit is 'Returnable cans in one unit of this product (1 for a single can, 5 for a pack of five).';
comment on column app.products.deposit_amount is 'Refundable deposit for one returnable can.';

create or replace function app.price_order(p_user_id uuid, p_address_id uuid, p_items jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_addr      app.addresses;
  v_zone      app.delivery_zones;
  v_settings  app.business_settings;
  v_lines     jsonb := '[]'::jsonb;
  v_subtotal  numeric(10,2) := 0;
  v_deposit   numeric(10,2) := 0;
  v_delivery  numeric(10,2);
  v_covered   int := 0;
  v_count     int;
  v_distinct  int;
  r           record;
  v_dep_qty   int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'Too many different products in one order (maximum 20).' using errcode = 'P0001';
  end if;

  select count(*), count(distinct (e ->> 'product_id'))
    into v_count, v_distinct
  from jsonb_array_elements(p_items) e;
  if v_count <> v_distinct then
    raise exception 'The same product appears twice in the cart.' using errcode = 'P0001';
  end if;

  select * into v_addr from app.addresses where id = p_address_id and user_id = p_user_id;
  if not found then
    raise exception 'Please choose one of your saved delivery addresses.' using errcode = 'P0001';
  end if;

  select * into v_zone from app.delivery_zones
  where is_active and v_addr.pincode = any (pincodes)
  order by id limit 1;
  if not found then
    raise exception 'Sorry, we do not deliver to pincode % yet. Please contact us.', v_addr.pincode using errcode = 'P0001';
  end if;

  select * into v_settings from app.business_settings where id = 1;

  -- Cans the customer already holds with a deposit, plus cans with a deposit on open orders.
  if v_settings.deposit_enabled then
    select coalesce(sum(cans_delta), 0) into v_covered from app.can_deposit_ledger where user_id = p_user_id;
    v_covered := v_covered + coalesce((
      select sum(oi.deposit_qty) from app.order_items oi join app.orders o on o.id = oi.order_id
      where o.user_id = p_user_id and o.status in ('pending', 'confirmed', 'out_for_delivery')), 0);
  end if;

  for r in
    select p.*, (e ->> 'quantity')::int as qty
    from jsonb_array_elements(p_items) e
    left join app.products p on p.id = (e ->> 'product_id')::int and p.is_active
    order by p.id
  loop
    if r.id is null then
      raise exception 'A product in your cart is no longer available. Please refresh your cart.' using errcode = 'P0001';
    end if;
    if r.qty is null or r.qty < r.min_order_qty or r.qty > r.max_order_qty then
      raise exception 'Quantity for % must be between % and %.', r.name, r.min_order_qty, r.max_order_qty using errcode = 'P0001';
    end if;

    v_dep_qty := 0;
    if v_settings.deposit_enabled and r.is_returnable_can and r.deposit_amount > 0 then
      v_dep_qty := greatest(r.qty * r.cans_per_unit - v_covered, 0);   -- in cans, not packs
      v_covered := greatest(v_covered - r.qty * r.cans_per_unit, 0);
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', r.id, 'product_name', r.name, 'unit_label', r.unit_label,
      'unit_price', r.price, 'quantity', r.qty, 'line_total', r.price * r.qty,
      'track_stock', r.track_stock, 'stock_qty', r.stock_qty,
      'deposit_per_unit', case when v_dep_qty > 0 then r.deposit_amount else 0 end,
      'deposit_qty', v_dep_qty, 'deposit_total', v_dep_qty * r.deposit_amount);
    v_subtotal := v_subtotal + r.price * r.qty;
    v_deposit  := v_deposit + v_dep_qty * r.deposit_amount;
  end loop;

  v_delivery := case when v_zone.free_delivery_min is not null and v_subtotal >= v_zone.free_delivery_min
                     then 0 else v_zone.delivery_charge end;

  return jsonb_build_object(
    'address', jsonb_build_object(
        'label', v_addr.label, 'contact_name', v_addr.contact_name, 'contact_phone', v_addr.contact_phone,
        'line1', v_addr.line1, 'line2', v_addr.line2, 'landmark', v_addr.landmark,
        'city', v_addr.city, 'pincode', v_addr.pincode),
    'zone_id', v_zone.id, 'zone_name', v_zone.name,
    'min_order_amount', v_zone.min_order_amount,
    'free_delivery_min', v_zone.free_delivery_min,
    'lines', v_lines,
    'subtotal', v_subtotal, 'delivery_charge', v_delivery, 'deposit_total', v_deposit,
    'total', v_subtotal + v_delivery + v_deposit);
end $$;

create or replace function app.admin_set_order_status(
  p_order_id uuid, p_status app.order_status, p_note text default null,
  p_cans_delivered int default null, p_empties_collected int default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order app.orders;
  v_dep_qty int;
begin
  perform app.require_staff();
  select * into v_order from app.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;

  if not ((v_order.status = 'pending'          and p_status in ('confirmed', 'cancelled'))
       or (v_order.status = 'confirmed'        and p_status in ('out_for_delivery', 'cancelled'))
       or (v_order.status = 'out_for_delivery' and p_status in ('delivered', 'confirmed', 'cancelled'))) then
    raise exception 'An order that is % cannot be changed to %.',
      replace(v_order.status::text, '_', ' '), replace(p_status::text, '_', ' ') using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' then
    perform app.cancel_order_internal(p_order_id, auth.uid(), coalesce(p_note, 'Cancelled by AquaPure'));
    return;
  end if;

  if p_status = 'confirmed' and v_order.status = 'pending'
     and v_order.payment_method = 'razorpay' and v_order.payment_status <> 'paid' then
    raise exception 'Online payment has not been received for this order yet.' using errcode = 'P0001';
  end if;

  if p_status = 'delivered' then
    if p_cans_delivered < 0 or p_empties_collected < 0 then
      raise exception 'Can counts cannot be negative.' using errcode = 'P0001';
    end if;
    update app.orders
    set delivered_at = now(),
        cans_delivered = coalesce(p_cans_delivered, (
          select coalesce(sum(oi.quantity * p.cans_per_unit), 0) from app.order_items oi join app.products p on p.id = oi.product_id
          where oi.order_id = p_order_id and p.is_returnable_can)),
        empties_collected = p_empties_collected
    where id = p_order_id;

    select coalesce(sum(deposit_qty), 0) into v_dep_qty from app.order_items where order_id = p_order_id;
    if v_dep_qty > 0 then
      insert into app.can_deposit_ledger (user_id, order_id, entry_type, cans_delta, amount, note, created_by)
      values (v_order.user_id, p_order_id, 'collected', v_dep_qty, v_order.deposit_total,
              'Deposit with order ' || v_order.order_no, auth.uid());
    end if;
  end if;

  update app.orders
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' and confirmed_at is null then now() else confirmed_at end
  where id = p_order_id;

  insert into app.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (p_order_id, v_order.status, p_status, nullif(left(trim(p_note), 500), ''), auth.uid());
end $$;

-- The sample office pack holds five cans (no-op if you renamed or changed it).
update app.products set cans_per_unit = 5
where slug = '20-litre-water-can-office-pack' and cans_per_unit = 1;

-- Nobody else may call anything in app (see note in 0004).
revoke execute on all functions in schema app from public;

-- >>>>> seed.sql
-- =====================================================================
-- AquaPure Water — sample data
-- Run once after migrations 0001–0009. Everything here is SAMPLE content:
-- prices are flagged is_sample_price = true (shown with a "Sample price" badge)
-- and testimonials are flagged is_sample = true (shown as "Sample review").
-- Change them from the admin dashboard; the badges disappear when you save
-- a product with "sample price" unticked.
-- =====================================================================

insert into app.business_settings (id) values (1) on conflict (id) do nothing;

insert into app.product_categories (slug, name, description, sort_order) values
  ('water-cans',    '20-Litre Water Cans',             'Returnable 20-litre cans for homes and offices, delivered to your door.', 1),
  ('water-bottles', 'Packaged Drinking Water Bottles', 'Sealed bottles in small, medium and large sizes, sold by the case.',       2)
on conflict (slug) do nothing;

insert into app.products (category_id, slug, name, short_description, description, unit_label, price,
                          is_returnable_can, deposit_amount, track_stock, stock_qty, min_order_qty, max_order_qty,
                          image_path, sort_order)
select c.id, v.slug, v.name, v.short_description, v.description, v.unit_label, v.price,
       v.is_returnable_can, v.deposit_amount, v.track_stock, v.stock_qty, v.min_qty, v.max_qty, v.image_path, v.sort_order
from (values
  ('water-cans', '20-litre-water-can', '20 L Water Can',
   'RO purified drinking water in a returnable 20-litre can.',
   'Our standard 20-litre can for homes and offices. Hand over your empty can when we deliver a full one. If you are new to AquaPure, a refundable can deposit may apply to your first cans.',
   '20 L can', 40.00, true, 150.00, true, 200, 1, 30, null, 1),
  ('water-cans', '20-litre-water-can-office-pack', '20 L Water Can – Office Pack of 5',
   'Five 20-litre cans in one delivery for offices and shops.',
   'Five returnable 20-litre cans delivered together. Suits offices, shops and clinics with a water dispenser.',
   'Pack of 5 × 20 L cans', 190.00, true, 150.00, true, 40, 1, 10, null, 2),
  ('water-bottles', 'bottle-500ml-case-24', '500 ml Bottles – Case of 24',
   'Small sealed bottles, ideal for meetings, travel and events.',
   'A case of 24 sealed 500 ml packaged drinking water bottles.',
   'Case of 24 × 500 ml', 180.00, false, 0, true, 100, 1, 50, null, 3),
  ('water-bottles', 'bottle-1l-case-12', '1 L Bottles – Case of 12',
   'Medium bottles for everyday use at home or work.',
   'A case of 12 sealed 1-litre packaged drinking water bottles.',
   'Case of 12 × 1 L', 160.00, false, 0, true, 100, 1, 50, null, 4),
  ('water-bottles', 'bottle-2l-case-9', '2 L Bottles – Case of 9',
   'Large bottles for families, shops and functions.',
   'A case of 9 sealed 2-litre packaged drinking water bottles.',
   'Case of 9 × 2 L', 170.00, false, 0, true, 60, 1, 50, null, 5),
  ('water-bottles', 'event-pack-250ml-48', 'Event Pack – 250 ml × 48',
   'Small bottles for functions, events and catering.',
   'Forty-eight 250 ml bottles for functions and events. For larger quantities, send us a bulk-order enquiry.',
   'Pack of 48 × 250 ml', 260.00, false, 0, true, 40, 1, 20, null, 6)
) as v(category, slug, name, short_description, description, unit_label, price,
       is_returnable_can, deposit_amount, track_stock, stock_qty, min_qty, max_qty, image_path, sort_order)
join app.product_categories c on c.slug = v.category
on conflict (slug) do nothing;
update app.products set cans_per_unit = 5 where slug = '20-litre-water-can-office-pack'; -- five cans per pack (deposits count cans)

-- SAMPLE delivery zones: replace the pincodes with the areas you actually serve.
insert into app.delivery_zones (name, pincodes, delivery_charge, free_delivery_min, min_order_amount) values
  ('Zone A – Nearby (sample)', array['600001','600002','600003','600004','600005'], 0.00,  null,   40.00),
  ('Zone B – Extended (sample)', array['600010','600011','600012','600017','600018'], 30.00, 300.00, 80.00);

insert into app.delivery_slots (label, start_time, end_time, capacity, cutoff_minutes, days_of_week, sort_order) values
  ('Morning',   '07:00', '10:00', 25, 120, '{1,2,3,4,5,6,7}', 1),
  ('Midday',    '11:00', '14:00', 25, 120, '{1,2,3,4,5,6}',   2),
  ('Evening',   '16:00', '19:00', 25, 120, '{1,2,3,4,5,6}',   3);

insert into app.testimonials (author_name, author_location, content, rating, is_sample, sort_order) values
  ('Sample Customer', 'Home customer',
   'Placeholder review. Replace this with a genuine review from one of your customers from the admin dashboard.', 5, true, 1),
  ('Sample Office Manager', 'Office customer',
   'Placeholder review describing regular office water deliveries. Replace or remove it before going live.', 5, true, 2),
  ('Sample Event Organiser', 'Event order',
   'Placeholder review for a bulk bottle order for a function. Replace or remove it before going live.', 4, true, 3);

select 'AquaPure database installed' as result;
