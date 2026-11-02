-- budgets, day_status, events. Additive. All cascade from auth.users, so
-- delete_my_account() removes them with everything else.
--
-- These three are small and re-fetched whole, so they use plain rows with a
-- natural key, not tombstones. budgets and day_status allow DELETE (removing
-- a budget, un-marking "no spend"); events is append-only.

-- 1. budgets. month = first day of the month. category_id null = the
--    month's savings target. Amounts are in the profile currency (INR).
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month        date not null check (extract(day from month) = 1
                                    and month >= date '2000-01-01' and month < date '2100-01-01'),
  category_id  uuid,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 999999999),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  -- one budget per category per month, and one savings target (null) per month
  constraint budgets_one_per_slot unique nulls not distinct (user_id, month, category_id)
);

-- 2. day_status. The app stores only 'no_spend'; "logged" is worked out from
--    live entries, so deleting a day's only entry can't leave it "logged".
--    Un-marking deletes the row. The check keeps the three agreed values.
create table public.day_status (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null check (date >= date '2000-01-01' and date < date '2100-01-01'),
  status     text not null check (status in ('open','logged','no_spend')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create trigger budgets_stamp    before insert or update on public.budgets
  for each row execute function public.stamp_timestamps();
create trigger day_status_stamp before insert or update on public.day_status
  for each row execute function public.stamp_timestamps();

-- 3. events. Usage metrics only. props must never hold amounts, names or
--    entry text -- counts, durations and outcomes only (enforced in the app).
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (name ~ '^[a-z][a-z0-9_]{0,39}$'),
  props      jsonb not null default '{}'::jsonb
             check (jsonb_typeof(props) = 'object' and octet_length(props::text) <= 1000),
  created_at timestamptz not null default now()
);
create index events_user_name_time on public.events (user_id, name, created_at);
create index events_name_time      on public.events (name, created_at);

-- Server time only: a client can't backdate or forward-date a metric.
create or replace function public.stamp_event() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  return new;
end $$;
create trigger events_stamp before insert on public.events
  for each row execute function public.stamp_event();

-- 4. Row caps. One signed-in account must not be able to fill the free
--    plan's 500 MB. entries already has its own cap (0008/0009).
-- ponytail: count-then-insert, so concurrent inserts can overshoot by a few
-- rows; a counter column like entries.entry_count if that ever matters.
create or replace function public.enforce_row_cap() returns trigger
language plpgsql set search_path = public as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into n using new.user_id;
  if n >= tg_argv[0]::bigint then
    raise exception '%_limit_reached', tg_table_name using errcode = 'P0002';
  end if;
  return new;
end $$;

create trigger accounts_cap   before insert on public.accounts
  for each row execute function public.enforce_row_cap('50');
create trigger categories_cap before insert on public.categories
  for each row execute function public.enforce_row_cap('200');
create trigger budgets_cap    before insert on public.budgets
  for each row execute function public.enforce_row_cap('5000');
create trigger day_status_cap before insert on public.day_status
  for each row execute function public.enforce_row_cap('20000');
create trigger events_cap     before insert on public.events
  for each row execute function public.enforce_row_cap('50000');

revoke execute on function public.stamp_event()     from public, anon, authenticated;
revoke execute on function public.enforce_row_cap() from public, anon, authenticated;

-- 5. RLS and grants.
alter table public.budgets    enable row level security;
alter table public.budgets    force  row level security;
alter table public.day_status enable row level security;
alter table public.day_status force  row level security;
alter table public.events     enable row level security;
alter table public.events     force  row level security;

create policy budgets_select on public.budgets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy budgets_insert on public.budgets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy budgets_update on public.budgets for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy budgets_delete on public.budgets for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy day_status_select on public.day_status for select to authenticated
  using ((select auth.uid()) = user_id);
create policy day_status_insert on public.day_status for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy day_status_update on public.day_status for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy day_status_delete on public.day_status for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy events_select on public.events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy events_insert on public.events for insert to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.budgets    to authenticated;
grant select, insert, update, delete on public.day_status to authenticated;
grant select, insert                 on public.events     to authenticated;
