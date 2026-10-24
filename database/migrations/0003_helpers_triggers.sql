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
