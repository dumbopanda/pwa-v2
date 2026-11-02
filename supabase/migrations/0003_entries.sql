create type public.txn_direction as enum ('debit','credit');
create type public.txn_frequency as enum ('one_off','monthly');

create table public.entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_uid     text not null check (char_length(client_uid) between 8 and 64),

  entry_date     date not null check (entry_date >= date '2000-01-01'),
  txn_id         text not null check (txn_id ~ '^[YN][a-z0-9]{6}$'),
  account_id     uuid not null references public.accounts(id),

  expense_name   text not null check (char_length(trim(expense_name)) between 1 and 120),
  more_info      text check (char_length(more_info) <= 300),
  txn_type       text not null check (char_length(trim(txn_type)) between 1 and 60),
  txn_freq       public.txn_frequency not null default 'monthly',

  amount_minor   bigint not null check (amount_minor > 0 and amount_minor <= 999999999),
  direction      public.txn_direction not null,

  transfer_group uuid,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  unique (user_id, client_uid)
);

-- amount_minor <= 999999999 is ₹99,99,999.99 — the prototype's 7-integer-digit
-- ceiling, enforced in the database rather than only in the UI.

-- Indexes — each one exists for a named query:

-- the sync cursor (§5.2). Keyset order, not a plain timestamp index.
create index entries_sync on public.entries (user_id, updated_at, id);

-- history list, newest first
create index entries_by_date on public.entries (user_id, entry_date desc, created_at desc)
  where deleted_at is null;

-- open Y-ID counting
create index entries_txn_id on public.entries (user_id, txn_id)
  where deleted_at is null and txn_id like 'Y%';

-- transfer sibling lookup
create index entries_transfer_group on public.entries (transfer_group)
  where transfer_group is not null and deleted_at is null;
