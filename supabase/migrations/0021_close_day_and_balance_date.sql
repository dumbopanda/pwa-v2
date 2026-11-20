-- Close day + balance date. Approved by the owner 2026-11-20.
--
-- 1. A day is Open until the person closes it ("every payment for this day is
--    added"). A day_status row now means exactly that: closed, at created_at.
--    "No spend" is just a closed day with no entries, so old 'no_spend' rows
--    become 'closed'. Entries added later never reopen it; the app shows them
--    as "added after closing" (entries.created_at > day_status.created_at).
-- 2. Reopening (deleting the row) is allowed only while that day is still
--    today in the person's time zone. After midnight a closed day stays closed.
-- 3. An account's opening balance has a date ("balance as of"). No entry on
--    that account may be dated before it, or the balance would be wrong.

-- The person's time zone, so "today" means their today. Set by the app.
alter table public.profiles add column time_zone text not null default 'Asia/Kolkata';

create or replace function public.check_time_zone() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger profiles_time_zone before insert or update of time_zone on public.profiles
  for each row execute function public.check_time_zone();

-- The caller's today. ponytail: trusts the time zone the person set; moving it
-- can stretch "today" by up to a day. Fine for a self-reported ledger.
create or replace function public.my_today() returns date
language sql stable security invoker set search_path = public as $$
  select (now() at time zone coalesce(
           (select time_zone from public.profiles where user_id = (select auth.uid())), 'Asia/Kolkata'))::date
$$;
revoke execute on function public.my_today() from public, anon;
grant execute on function public.my_today() to authenticated;

-- day_status: one value, 'closed'. No closing a future day; reopen only today.
update public.day_status set status = 'closed' where status <> 'closed';
alter table public.day_status drop constraint day_status_status_check;
alter table public.day_status add constraint day_status_status_check check (status = 'closed');
alter table public.day_status alter column status set default 'closed';

drop policy day_status_insert on public.day_status;
create policy day_status_insert on public.day_status for insert to authenticated
  with check ((select auth.uid()) = user_id and date <= public.my_today());
drop policy day_status_update on public.day_status;     -- nothing to update: closed is closed
revoke update on public.day_status from authenticated;
drop policy day_status_delete on public.day_status;
create policy day_status_delete on public.day_status for delete to authenticated
  using ((select auth.uid()) = user_id and date = public.my_today());

comment on table public.day_status is
  'One row per closed day (the person said every payment is added). Reopen = delete, only on that same day.';

-- 3. Nothing before an account's balance date. Checked both ways: a payment
--    can't go before the balance, and the balance can't move after payments.
create or replace function public.check_balance_date() returns trigger
language plpgsql set search_path = public as $$
declare bal date;
begin
  if new.deleted_at is not null then return new; end if;
  if new.txn_type = 'Opening balance' then
    if exists (select 1 from public.entries
                where user_id = new.user_id and account_id = new.account_id and deleted_at is null
                  and txn_type <> 'Opening balance' and entry_date < new.entry_date) then
      raise exception 'This account has payments before that date' using errcode = 'P0005';
    end if;
  else
    select min(entry_date) into bal from public.entries
     where user_id = new.user_id and account_id = new.account_id and deleted_at is null
       and txn_type = 'Opening balance' and id <> new.id;
    if bal is not null and new.entry_date < bal then
      raise exception 'Payments on this account start on %', bal using errcode = 'P0005';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.check_balance_date() from public, anon, authenticated;
revoke execute on function public.check_time_zone() from public, anon, authenticated;

create trigger entries_balance_date before insert or update of entry_date, account_id, deleted_at, txn_type
  on public.entries for each row execute function public.check_balance_date();
