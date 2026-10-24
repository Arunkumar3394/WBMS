-- TEST ONLY. A minimal stand-in for the parts of Supabase the migrations use,
-- so the scripts can be tested in PGlite without a Supabase project.
-- Never run this on Supabase.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  phone               text,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

-- Same definition Supabase uses.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text, owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
