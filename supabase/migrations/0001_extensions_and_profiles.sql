create extension if not exists pgcrypto;

create table public.profiles (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  display_name           text check (char_length(display_name) <= 80),
  plan                   text not null default 'free' check (plan in ('free','supporter')),
  entitlement_expires_at timestamptz,
  country                char(2),
  currency               char(3) not null default 'INR',
  entry_count            int  not null default 0,
  onboarded_at           timestamptz,
  consent_version        int,
  consent_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Server-side config the app reads at launch. Lets limits change without a
-- Play release, which is the only lever you have during a 3-day review.
create table public.app_config (
  key   text primary key,
  value jsonb not null
);
insert into public.app_config values
  ('max_entries_per_user', '100000'::jsonb),
  ('sync_page_size',       '500'::jsonb),
  ('min_supported_build',  '1'::jsonb);

alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select using (true);
-- no insert/update/delete policy: only the service role can write
