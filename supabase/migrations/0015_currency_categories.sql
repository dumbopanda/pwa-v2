-- Per-account currency, user-defined categories, entries.category_id.
-- Approved data-model change. No conversion anywhere: amounts in different
-- currencies are never added together.

-- 1. Account currency. Existing rows become INR.
alter table public.accounts
  add column currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$');

-- An account's currency is what every one of its amounts means. Changing it
-- while live entries exist would silently re-denominate them.
create or replace function public.guard_account_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency and exists (
       select 1 from public.entries
        where account_id = old.id and user_id = old.user_id and deleted_at is null) then
    raise exception 'account_currency_locked' using errcode = 'P0004';
  end if;
  return new;
end $$;

create trigger accounts_currency_guard before update of currency on public.accounts
  for each row execute function public.guard_account_currency();

-- 2. Categories. Same shape and sync rules as accounts: client_uid
--    idempotency, server timestamps, tombstones, keyset pull.
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_uid  text not null check (char_length(client_uid) between 8 and 64),
  name        text not null check (char_length(trim(name)) between 1 and 40),
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (user_id, client_uid),
  unique (id, user_id)
);

create unique index categories_user_name_live
  on public.categories (user_id, lower(trim(name)))
  where deleted_at is null;
create index categories_sync on public.categories (user_id, updated_at, id);

create trigger categories_stamp before insert or update on public.categories
  for each row execute function public.stamp_timestamps();

alter table public.categories enable row level security;
alter table public.categories force  row level security;
create policy categories_select on public.categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy categories_insert on public.categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy categories_update on public.categories for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.categories to authenticated;

-- 3. entries.category_id. Null for transfers and opening balances.
--    Composite FK: the category must belong to the same user.
alter table public.entries add column category_id uuid;
alter table public.entries
  add constraint entries_category_owner
  foreign key (category_id, user_id) references public.categories (id, user_id);

-- 4. Pull, same contract as pull_accounts.
create or replace function public.pull_categories(
  p_since    timestamptz default null,
  p_since_id uuid        default null,
  p_limit    int         default 500
) returns setof public.categories
language sql stable security invoker set search_path = public as $$
  select * from public.categories
  where user_id = auth.uid()
    and (updated_at, id) >
        (coalesce(p_since, '-infinity'::timestamptz),
         coalesce(p_since_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by updated_at, id
  limit least(greatest(p_limit, 1), 1000);
$$;
revoke execute on function public.pull_categories(timestamptz, uuid, int) from public, anon;
grant  execute on function public.pull_categories(timestamptz, uuid, int) to authenticated;

-- 5. push_entries carries category_id. Same body as 0006 otherwise.
--    (create or replace keeps grants but resets SET clauses, so search_path
--    is restated here.)
create or replace function public.push_entries(p_rows jsonb)
returns table (client_uid text, id uuid, updated_at timestamptz, was_insert boolean)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
begin
  return query
  insert into public.entries as e (
    user_id, client_uid, entry_date, txn_id, account_id, category_id, expense_name,
    more_info, txn_type, txn_freq, amount_minor, direction, transfer_group, deleted_at)
  select auth.uid(), r.client_uid, r.entry_date, r.txn_id, r.account_id, r.category_id,
         r.expense_name, r.more_info, r.txn_type, coalesce(r.txn_freq, 'monthly'),
         r.amount_minor, r.direction, r.transfer_group, r.deleted_at
  from jsonb_to_recordset(p_rows) as r(
    client_uid text, entry_date date, txn_id text, account_id uuid, category_id uuid,
    expense_name text, more_info text, txn_type text, txn_freq public.txn_frequency,
    amount_minor bigint, direction public.txn_direction,
    transfer_group uuid, deleted_at timestamptz)
  on conflict (user_id, client_uid) do update set
    entry_date   = excluded.entry_date,
    txn_id       = excluded.txn_id,
    account_id   = excluded.account_id,
    category_id  = excluded.category_id,
    expense_name = excluded.expense_name,
    more_info    = excluded.more_info,
    txn_type     = excluded.txn_type,
    txn_freq     = excluded.txn_freq,
    amount_minor = excluded.amount_minor,
    direction    = excluded.direction,
    deleted_at   = coalesce(e.deleted_at, excluded.deleted_at)
  returning e.client_uid, e.id, e.updated_at, (xmax = 0);
end $$;

-- 6. A self transfer moves the same amount, so both accounts must share a
--    currency. Same check as 0008 plus the currency count.
create or replace function public.check_transfer_group() returns trigger
language plpgsql set search_path = public as $$
declare
  legs int; debits int; credits int; amounts int; dates int; currencies int;
begin
  if coalesce(new.transfer_group, old.transfer_group) is null then return null; end if;

  select count(*), count(*) filter (where e.direction='debit'),
         count(*) filter (where e.direction='credit'),
         count(distinct e.amount_minor), count(distinct e.entry_date),
         count(distinct a.currency)
    into legs, debits, credits, amounts, dates, currencies
  from public.entries e
  join public.accounts a on a.id = e.account_id and a.user_id = e.user_id
  where e.transfer_group = coalesce(new.transfer_group, old.transfer_group)
    and e.user_id = coalesce(new.user_id, old.user_id)
    and e.deleted_at is null;

  if legs = 0 then return null; end if;
  if legs <> 2 or debits <> 1 or credits <> 1
     or amounts <> 1 or dates <> 1 then
    raise exception 'transfer_group must be exactly one debit and one credit '
                    'of equal amount and date' using errcode = 'P0001';
  end if;
  if currencies <> 1 then
    raise exception 'transfer_currency_mismatch' using errcode = 'P0001';
  end if;
  return null;
end $$;

revoke execute on function public.guard_account_currency() from public, anon, authenticated;
