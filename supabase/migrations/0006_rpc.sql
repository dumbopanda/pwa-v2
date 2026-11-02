-- Pull. Keyset pagination on (updated_at, id). A plain `updated_at > $since`
-- silently drops rows that share a timestamp across a page boundary, which
-- is unrecoverable data loss on restore.
create or replace function public.pull_entries(
  p_since    timestamptz default null,
  p_since_id uuid        default null,
  p_limit    int         default 500
) returns setof public.entries
language sql stable security invoker as $$
  select * from public.entries
  where user_id = auth.uid()
    and (updated_at, id) >
        (coalesce(p_since, '-infinity'::timestamptz),
         coalesce(p_since_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by updated_at, id
  limit least(greatest(p_limit, 1), 1000);
$$;

-- Tombstones are in the feed on purpose. There is no `deleted_at is null`
-- filter. If deletions are not pulled, a restored device resurrects every
-- entry the user ever deleted.

-- Same shape for accounts.
create or replace function public.pull_accounts(
  p_since    timestamptz default null,
  p_since_id uuid        default null,
  p_limit    int         default 500
) returns setof public.accounts
language sql stable security invoker as $$
  select * from public.accounts
  where user_id = auth.uid()
    and (updated_at, id) >
        (coalesce(p_since, '-infinity'::timestamptz),
         coalesce(p_since_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by updated_at, id
  limit least(greatest(p_limit, 1), 1000);
$$;

-- Push. A single transaction so a transfer's two legs land together or not
-- at all, and idempotent on (user_id, client_uid) so a retry after a lost
-- response is free.
create or replace function public.push_entries(p_rows jsonb)
returns table (client_uid text, id uuid, updated_at timestamptz, was_insert boolean)
language plpgsql security invoker as $$
-- RETURNS TABLE(client_uid, ...) makes `client_uid` an OUT-parameter
-- variable in scope for this whole body, which collides with the
-- `client_uid` column in `on conflict (user_id, client_uid)` below.
-- Without this pragma that line fails with "ambiguous column reference".
#variable_conflict use_column
begin
  return query
  insert into public.entries as e (
    user_id, client_uid, entry_date, txn_id, account_id, expense_name,
    more_info, txn_type, txn_freq, amount_minor, direction, transfer_group, deleted_at)
  select auth.uid(), r.client_uid, r.entry_date, r.txn_id, r.account_id, r.expense_name,
         r.more_info, r.txn_type, r.txn_freq, r.amount_minor, r.direction,
         r.transfer_group, r.deleted_at
  from jsonb_to_recordset(p_rows) as r(
    client_uid text, entry_date date, txn_id text, account_id uuid,
    expense_name text, more_info text, txn_type text, txn_freq public.txn_frequency,
    amount_minor bigint, direction public.txn_direction,
    transfer_group uuid, deleted_at timestamptz)
  on conflict (user_id, client_uid) do update set
    entry_date   = excluded.entry_date,
    txn_id       = excluded.txn_id,
    account_id   = excluded.account_id,
    expense_name = excluded.expense_name,
    more_info    = excluded.more_info,
    txn_type     = excluded.txn_type,
    txn_freq     = excluded.txn_freq,
    amount_minor = excluded.amount_minor,
    direction    = excluded.direction,
    deleted_at   = coalesce(e.deleted_at, excluded.deleted_at)
  returning e.client_uid, e.id, e.updated_at, (xmax = 0);
end $$;

-- Two details that matter:
--  - `do update set` rather than `do nothing`. `do nothing` returns no row
--    on conflict, so the client cannot tell "already had it" from "request
--    failed" — and that ambiguity is exactly what makes a retry unsafe.
--  - `deleted_at = coalesce(e.deleted_at, excluded.deleted_at)` — a delete
--    is never undone by a push. A stale device replaying an old insert
--    cannot resurrect a deleted row.

-- Open Y-IDs, for reconciliation only — the app computes this locally (§7.9).
create or replace function public.open_y_ids()
returns table (txn_id text, leg_count bigint)
language sql stable security invoker as $$
  select txn_id, count(*) from public.entries
  where user_id = auth.uid() and deleted_at is null and txn_id like 'Y%'
  group by txn_id having count(*) % 2 = 1;
$$;
