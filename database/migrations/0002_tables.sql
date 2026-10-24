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
