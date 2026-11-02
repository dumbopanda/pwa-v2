-- Scale/security review, applied before Sprint B (plan §4.8). 0001-0007 are
-- already applied against a database with one profiles row and zero
-- entries/accounts rows, so this costs nothing in data migration.

-- 1. account_id has no ownership check. RLS scopes entries and accounts
-- independently by user_id, but nothing stops a client inserting an entry
-- whose user_id is its own while account_id points at another user's
-- account row -- the FK only checks the row exists, not who owns it.
alter table public.accounts
  add constraint accounts_id_user_uidx unique (id, user_id);

alter table public.entries
  drop constraint entries_account_id_fkey;

alter table public.entries
  add constraint entries_account_owner
  foreign key (account_id, user_id) references public.accounts (id, user_id);

-- 2. RLS re-evaluates auth.uid() per row instead of once per statement.
-- Free now, painful to notice later. Wrap in select and pin the role.
drop policy profiles_select on public.profiles;
drop policy profiles_update on public.profiles;
drop policy accounts_select on public.accounts;
drop policy accounts_insert on public.accounts;
drop policy accounts_update on public.accounts;
drop policy entries_select  on public.entries;
drop policy entries_insert  on public.entries;
drop policy entries_update  on public.entries;

create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy accounts_select on public.accounts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy accounts_update on public.accounts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy entries_select on public.entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy entries_insert on public.entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy entries_update on public.entries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 3. maintain_entry_count is a per-row trigger. push_entries inserts many
-- rows in one statement (§4.6); the per-row version reads app_config and
-- writes profiles once per row instead of once per call. Replace with a
-- statement-level trigger that aggregates the batch.
drop trigger entries_count on public.entries;
drop function public.maintain_entry_count();

create or replace function public.maintain_entry_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  select (value #>> '{}')::int into cap from public.app_config
    where key = 'max_entries_per_user';

  if exists (
    select 1
    from (select user_id, count(*) as added from new_rows group by user_id) added
    join public.profiles p on p.user_id = added.user_id
    where p.entry_count + added.added > cap
  ) then
    raise exception 'entry_limit_reached' using errcode = 'P0002';
  end if;

  update public.profiles p
     set entry_count = p.entry_count + added.added
    from (select user_id, count(*) as added from new_rows group by user_id) added
   where p.user_id = added.user_id;

  return null;
end $$;

create trigger entries_count after insert on public.entries
  referencing new table as new_rows
  for each statement execute function public.maintain_entry_count();

-- 4. check_transfer_group scans the whole table, not just the user's rows.
-- Cheap now, becomes a real query-plan problem once the table is large.
create or replace function public.check_transfer_group() returns trigger
language plpgsql as $$
declare
  legs int; debits int; credits int; amounts int; dates int;
begin
  if coalesce(new.transfer_group, old.transfer_group) is null then return null; end if;

  select count(*), count(*) filter (where direction='debit'),
         count(*) filter (where direction='credit'),
         count(distinct amount_minor), count(distinct entry_date)
    into legs, debits, credits, amounts, dates
  from public.entries
  where transfer_group = coalesce(new.transfer_group, old.transfer_group)
    and user_id = coalesce(new.user_id, old.user_id)
    and deleted_at is null;

  if legs = 0 then return null; end if;
  if legs <> 2 or debits <> 1 or credits <> 1
     or amounts <> 1 or dates <> 1 then
    raise exception 'transfer_group must be exactly one debit and one credit '
                    'of equal amount and date' using errcode = 'P0001';
  end if;
  return null;
end $$;

-- Not included, on purpose: a composite (user_id, id) primary key for
-- future hash-partitioning. A9's pgTAP suite, A7's RPCs, and A11/A12's
-- core:model/core:database already assume a single-column id. Partitioning
-- only matters past ~500M rows; retrofit then, if that day comes.
