create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_uid  text not null check (char_length(client_uid) between 8 and 64),
  name        text not null check (char_length(trim(name)) between 1 and 40),
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id, client_uid)
);

-- Two live accounts cannot share a name, case-insensitively.
create unique index accounts_user_name_live
  on public.accounts (user_id, lower(trim(name)))
  where deleted_at is null;

create index accounts_sync on public.accounts (user_id, updated_at, id);
