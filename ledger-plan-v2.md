# Ledger — Android Application Specification v2

**What this is.** A native Android application, distributed on Google Play, that people download and install. Personal double-sided expense ledger with offline-first storage, a private per-user cloud database, and Google sign-in.

**What it is not.** Not a website. Not a PWA. Not a wrapped webview. The existing `index.html` is a **working prototype** that proves the interaction design and encodes five years of domain rules. It is a specification input, not shippable code, and it is not going on Play.

**Reference inputs**
- `index.html` — prototype. Every behavioural rule in §7 was extracted from it line by line.
- `branding_design_system.md` — visual tokens. Becomes `core:designsystem` in §6.3.

---

# 1. Locked decisions

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | Client | **Native Android — Kotlin + Jetpack Compose** | Rebuild the UI. Prototype supplies rules, not code. |
| D2 | Local store | **Room is the source of truth.** Network is a sync detail. | Every screen reads a `Flow` from Room. No screen ever awaits the network. |
| D3 | Backend | **Supabase Postgres, direct from client, RLS-enforced** | No API server. No service-role key on any device. |
| D4 | Server logic | **Postgres functions + 2 Edge Functions only** | Account deletion and the public deletion endpoint. Nothing else. |
| D5 | Auth | **Google only, via Credential Manager → Supabase `signInWithIdToken`** | No browser, no password, no email verification. Losing the Google account loses the ledger — mitigated by mandatory export prompt at onboarding. |
| D6 | Money | **`bigint` minor units (paise). Never float.** | One positive integer + a direction enum. Invalid states unrepresentable. |
| D7 | Deletes | **Soft delete only. No `DELETE` RLS policy exists.** | Hard delete is impossible from a client, by construction. |
| D8 | Devices | **Sync is pull-on-launch, push-on-change. One device at a time is the supported story.** | Server is authoritative; a second device is *stale*, never *wrong*. |
| D9 | Android Auto Backup | **Disabled** (`allowBackup="false"`) | A restored stale op-log would replay stale operations. Server pull + explicit export are the restore paths. |
| D10 | Analytics | **None.** Sentry (PII-scrubbed) + Play Vitals only. | Smallest possible Data Safety declaration; least DPDP exposure. |
| D11 | Billing | **Not built. Schema seam reserved.** | `profiles.plan` and `app_config` exist from migration 0001. |
| D12 | Currency | **INR only at launch.** `profiles.currency` column exists but is fixed. | Multi-currency is a migration, not a rewrite. |

---

# 2. Domain model

**Entry** — one row of the ledger. Exactly one amount, exactly one direction.

**Transfer** — money moved between the user's own accounts. **Two entries**, one debit and one credit, equal amounts, sharing a `transfer_group`. Displayed as one line. Deleting one deletes both. An entry can never be converted into a transfer or vice versa by editing — the shapes differ (1 row vs 2), so the app refuses and asks for a new entry.

**Transaction ID (`txn_id`)** — user-facing label, format `[YN][a-z0-9]{6}`.
- `N…` — one-way. New ID every time. Never reused.
- `Y…` — money expected back. The same ID is written twice: once going out, once coming back.
- **A Y-ID is "open" while it appears an odd number of times across live entries.** This is the entire "Owed to me" feature.
- `txn_id` is **not unique**. A closed Y-ID is two rows. Never put a unique constraint on it.

**Account** — user-defined bucket. Seeded as `Domestic`, `International`, `Cash` on first run; fully renameable, reorderable, archivable thereafter. The prototype hardcodes these in three places; that is a bug being fixed, not a behaviour being preserved.

**Frequency (`txn_freq`)** — `one_off` | `monthly`. Descriptive tag only. Does **not** create recurring entries. **[CHANGED, 25 Sep 2026]** No longer a form field — `ui-spec.md` dropped it from the shared front end. The column stays (the server default is `monthly`), every entry the app writes sets it to `monthly` unconditionally, and nothing asks the user. See §7.5.7.

**Operation** — a local intent to insert, update or delete, queued durably until the server confirms it.

---

# 3. System architecture

```
┌──────────────────────── Android device ────────────────────────┐
│  Compose UI                                                     │
│      ↕ StateFlow                                                │
│  ViewModels                                                     │
│      ↕ Flow / suspend                                           │
│  Repositories  ──────────────┐                                  │
│      ↕                       │                                  │
│  Room  (source of truth)     │  PendingOpDao (durable op log)   │
│   ├ entries                  │                                  │
│   ├ accounts                 └──→ SyncWorker (WorkManager)      │
│   └ pending_ops                        │                        │
│  DataStore (session, cursor, prefs)    │                        │
└────────────────────────────────────────┼────────────────────────┘
                                         │ HTTPS, user JWT
                          ┌──────────────▼──────────────┐
                          │  Supabase (ap-south-1)      │
                          │  PostgREST  ← RLS on every  │
                          │  GoTrue (Google IdP)          table │
                          │  Edge Fn: delete_account    │
                          │  Postgres: triggers, RPCs   │
                          └─────────────────────────────┘
```

**Security model in one sentence:** the device holds only a user-scoped JWT; every table has `force row level security`; every policy is `user_id = auth.uid()`; there is no code path that can read another user's row because no such code exists to have a bug in.

---

# 4. Database

All DDL lives in `supabase/migrations/*.sql`, in git, applied by the Supabase CLI. **The dashboard SQL editor is never used** — it causes environment drift you cannot audit.

## 4.1 `0001_extensions_and_profiles.sql`

```sql
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
```

`app_config` is world-readable, write-protected:

```sql
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select using (true);
-- no insert/update/delete policy: only the service role can write
```

## 4.2 `0002_accounts.sql`

```sql
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
```

## 4.3 `0003_entries.sql`

```sql
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
```

`amount_minor <= 999999999` is ₹99,99,999.99 — the prototype's 7-integer-digit ceiling, enforced in the database rather than only in the UI.

Indexes — each one exists for a named query:

```sql
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
```

## 4.4 `0004_triggers.sql`

**Timestamps are the server's, always.** A phone with a wrong clock must not be able to poison sync ordering — `updated_at` is the tiebreaker for last-write-wins, so a client that can set it can win every conflict forever.

```sql
create or replace function public.stamp_timestamps() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;   -- immutable after insert
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger entries_stamp  before insert or update on public.entries
  for each row execute function public.stamp_timestamps();
create trigger accounts_stamp before insert or update on public.accounts
  for each row execute function public.stamp_timestamps();
```

**Transfer delete cascade.** Deleting one leg deletes its sibling. In the database, because the client is the untrusted part.

```sql
create or replace function public.cascade_transfer_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and new.transfer_group is not null then
    update public.entries
       set deleted_at = new.deleted_at
     where transfer_group = new.transfer_group
       and user_id       = new.user_id
       and id           <> new.id
       and deleted_at is null;
  end if;
  return new;
end $$;

create trigger entries_cascade_transfer_delete
  after update of deleted_at on public.entries
  for each row execute function public.cascade_transfer_delete();
```

Recursion terminates after one pass: the recursive call has `old.deleted_at is not null`, so the guard fails.

**Transfer pair integrity**, checked at commit so both legs can be inserted in one transaction:

```sql
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
    and deleted_at is null;

  if legs = 0 then return null; end if;                    -- both deleted, fine
  if legs <> 2 or debits <> 1 or credits <> 1
     or amounts <> 1 or dates <> 1 then
    raise exception 'transfer_group must be exactly one debit and one credit '
                    'of equal amount and date' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger entries_transfer_integrity
  after insert or update or delete on public.entries
  deferrable initially deferred
  for each row execute function public.check_transfer_group();
```

**Row cap**, maintained as a counter rather than a `count(*)` on every insert:

```sql
create or replace function public.maintain_entry_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  if tg_op = 'INSERT' then
    select (value #>> '{}')::int into cap from public.app_config
      where key = 'max_entries_per_user';
    if (select entry_count from public.profiles where user_id = new.user_id) >= cap then
      raise exception 'entry_limit_reached' using errcode = 'P0002';
    end if;
    update public.profiles set entry_count = entry_count + 1 where user_id = new.user_id;
  end if;
  return null;
end $$;

create trigger entries_count after insert on public.entries
  for each row execute function public.maintain_entry_count();
```

Without this, one scripted account fills 500 MB and Supabase's fair-use response is a **402 on every service for every user** until the billing period rolls over or you upgrade.

**Profile bootstrap** — a row must exist before the first entry, so create it at signup:

```sql
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

## 4.5 `0005_rls.sql`

Every table. `force` so even the table owner is subject to it.

```sql
alter table public.profiles enable row level security;
alter table public.profiles force  row level security;
alter table public.accounts enable row level security;
alter table public.accounts force  row level security;
alter table public.entries  enable row level security;
alter table public.entries  force  row level security;

create policy profiles_select on public.profiles for select using (user_id = auth.uid());
create policy profiles_update on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy accounts_select on public.accounts for select using (user_id = auth.uid());
create policy accounts_insert on public.accounts for insert with check (user_id = auth.uid());
create policy accounts_update on public.accounts for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy entries_select on public.entries for select using (user_id = auth.uid());
create policy entries_insert on public.entries for insert with check (user_id = auth.uid());
create policy entries_update on public.entries for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**Note the omissions, they are deliberate:**
- No `for delete` policy on any table → hard delete is impossible from a client. D7 is enforced by the absence of code, not by the presence of it.
- No `profiles_insert` → only the signup trigger creates profiles.
- `profiles.plan` and `entry_count` are client-writable under `profiles_update`, which is wrong. Fix with a column-guard trigger:

```sql
create or replace function public.protect_profile_columns() returns trigger
language plpgsql as $$
begin
  new.plan                   := old.plan;
  new.entitlement_expires_at := old.entitlement_expires_at;
  new.entry_count            := old.entry_count;
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();
```

## 4.6 `0006_rpc.sql`

**Pull.** Keyset pagination on `(updated_at, id)`. A plain `updated_at > $since` silently drops rows that share a timestamp across a page boundary, which is unrecoverable data loss on restore.

```sql
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
```

**Tombstones are in the feed on purpose.** There is no `deleted_at is null` filter. If deletions are not pulled, a restored device resurrects every entry the user ever deleted.

The same function shape exists for `pull_accounts`.

**Push.** A single transaction so a transfer's two legs land together or not at all, and idempotent on `(user_id, client_uid)` so a retry after a lost response is free.

```sql
create or replace function public.push_entries(p_rows jsonb)
returns table (client_uid text, id uuid, updated_at timestamptz, was_insert boolean)
language plpgsql security invoker as $$
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
```

Two details that matter:

- `do update set` rather than `do nothing`. `do nothing` returns **no row** on conflict, so the client cannot tell "already had it" from "request failed" — and that ambiguity is exactly what makes a retry unsafe.
- `deleted_at = coalesce(e.deleted_at, excluded.deleted_at)` — **a delete is never undone by a push.** A stale device replaying an old insert cannot resurrect a deleted row. This is the mechanism behind "deleted entries must not resurrect"; asserting it in a plan without this line is not a mechanism.

**Open Y-IDs**, for reconciliation only — the app computes this locally (§7.9):

```sql
create or replace function public.open_y_ids()
returns table (txn_id text, leg_count bigint)
language sql stable security invoker as $$
  select txn_id, count(*) from public.entries
  where user_id = auth.uid() and deleted_at is null and txn_id like 'Y%'
  group by txn_id having count(*) % 2 = 1;
$$;
```

## 4.7 `0007_account_deletion.sql`

```sql
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  delete from auth.users where id = uid;   -- cascades to profiles, accounts, entries
end $$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
```

This is the one place a hard delete happens, and it deletes *everything* belonging to the caller. Play requires it be reachable both in-app and from a public web URL (§11.3).

## 4.8 `0008_hardening.sql` — scale/security review, applied before Sprint B

**[ADDED]** 0001–0007 are already applied and must not be edited — this is a new migration, applied against a database with one `profiles` row and zero `entries`/`accounts` rows, so it costs nothing in data migration. It closes one real gap and pre-empts three that only bite once volume shows up; do it now, before B1's op log starts writing through this schema, not after.

**1. `account_id` has no ownership check.** RLS scopes `entries` and `accounts` independently by `user_id`, but nothing today stops a client from inserting an entry whose `user_id` is its own while `account_id` points at *another user's* account row — the FK only checks the row exists, not who owns it. Close it with a composite FK:

```sql
-- accounts: composite unique needed as the FK target
alter table public.accounts
  add constraint accounts_id_user_uidx unique (id, user_id);

-- entries: drop the single-column FK, add the ownership-checked one
alter table public.entries
  drop constraint entries_account_id_fkey;

alter table public.entries
  add constraint entries_account_owner
  foreign key (account_id, user_id) references public.accounts (id, user_id);
```

**2. RLS re-evaluates `auth.uid()` per row instead of once per statement.** Free now, painful to notice later (it just looks like "queries are slow" with no obvious cause). Wrap in `select` and pin the role:

```sql
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
```

**3. `maintain_entry_count` is a per-row trigger.** `push_entries` inserts many rows in one statement (§4.6); the per-row version reads `app_config` and writes `profiles` once per row instead of once per call. Replace with a statement-level trigger that aggregates the batch:

```sql
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
```

**4. `check_transfer_group` scans the whole table, not just the user's rows.** Cheap now, becomes a real query-plan problem once the table is large:

```sql
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
```

**Not included, on purpose:** a composite `(user_id, id)` primary key for future hash-partitioning. A9's pgTAP suite, A7's RPCs, and A11/A12's `core:model`/`core:database` already assume a single-column `id`. Partitioning only matters past ~500M rows; retrofit then, if that day comes — paying that cost now for an uncertain future is worse than paying it later for a confirmed one.

**Check:** `supabase db reset` clean, `supabase test db --local` still 7/7 (rls_entries.sql exercises `auth.uid()` — should be unaffected by the `select`-wrap, but confirm), then repeat A6/A9's manual drill: insert an entry as user A with an `account_id` belonging to user B → must be rejected by the new FK, not silently accepted.

## 4.9 `0009_function_hardening.sql` / `0010_revoke_public_execute.sql` — security review, 25 Sep 2026

**[ADDED, applied 25 Sep 2026 — see BUILD-LOG's S10/S11 entries.]** Found by checking the live project's own Supabase security advisor and actual grants (`has_function_privilege(...)`), not by re-reading the migration files' stated intent alone. Two issues:

**1. Seven functions never pinned `search_path`:** `stamp_timestamps`, `check_transfer_group`, `protect_profile_columns`, `pull_entries`, `pull_accounts`, `push_entries`, `open_y_ids`. For a `SECURITY DEFINER` function this is a real privilege-escalation vector (a role that can create objects in a schema earlier in *its own* search_path could shadow an unqualified name the function resolves at runtime); for the rest it's cheap, correct hygiene every other function here already has. Fixed with `alter function ... set search_path = public` on all seven.

**2. `revoke all ... from public` (§4.7) does not do what it reads as.** `PUBLIC` is a pseudo-role meaning "every role" — but Supabase's own project bootstrap grants `EXECUTE` to `anon`/`authenticated` *directly* (and via `ALTER DEFAULT PRIVILEGES` for anything created afterward), not through `PUBLIC`. Revoking from `PUBLIC` never touched those direct grants. Confirmed live: **every function in this project, `delete_my_account` included, currently shows `has_function_privilege('anon', ..., 'EXECUTE') = true`.** Not exploitable for account takeover today — `auth.uid()` is null under `anon`, so `delete_my_account`'s own `not_authenticated` check already stops it, and RLS makes an anon `pull_entries`/`push_entries` call return/write nothing real — but it's real, undisclosed surface directly contradicting what §4.7's own comment says it accomplished.

Fix: the six pure trigger functions (`stamp_timestamps`, `check_transfer_group`, `protect_profile_columns`, `cascade_transfer_delete`, `handle_new_user`, `maintain_entry_count`) get `EXECUTE` revoked from **both** `anon` and `authenticated` — nothing outside the trigger mechanism should ever call these directly, and Postgres invokes triggers without checking `EXECUTE` on the trigger function (that's a DML-privilege check on the *table*, a separate domain), so this has zero effect on the triggers that actually use them. The four sync RPCs plus `delete_my_account` get `EXECUTE` revoked from `anon` specifically and (re-)granted to `authenticated` only.

**3. `maintain_entry_count`'s residual race, from §4.8's own fix.** §4.8 narrowed the trigger from per-row to per-statement, which helps, but the check-then-write inside it is still two separate statements with no row lock between them — two genuinely concurrent `push_entries` calls for the same user can both read the same pre-update `entry_count`, both pass the cap check, and both write, overshooting `max_entries_per_user` by the overlap. Fixed by folding the cap check into the `UPDATE`'s own `WHERE` clause (`entry_count + added_count <= cap`) so the row lock the `UPDATE` itself takes is what serializes concurrent statements for the same user — the decision and the write happen in one locked statement, not two with a window between them.

**0009 itself had the exact bug it was fixing, caught by re-verifying live state after applying it rather than trusting `success: true`.** `revoke execute ... from anon, authenticated` only removes a grant a role held *individually* — but `anon` never held its own grant on any of the ten affected functions; its access rode entirely on a separate `PUBLIC` grant (`pg_proc.proacl`'s bare `=` entry), and Postgres unions every applicable ACL entry when computing effective privilege, so revoking a role that was never the actual grant source does nothing. Confirmed live via `proacl` after 0009: all ten still carried the `=` entry. `0010_revoke_public_execute.sql` revokes from `public` specifically (not the named roles) on the same ten functions, re-verified afterward: `anon_can_execute = false` on all ten, `authenticated_can_execute = true` correctly survives on the four sync RPCs + `delete_my_account` (their own separate direct grant to `authenticated`, untouched by revoking `PUBLIC`), and the security advisor's `function_search_path_mutable`/`anon_security_definer_function_executable` findings are fully gone, with `authenticated_security_definer_function_executable` down to the one intentional case (`delete_my_account`, which is *supposed* to be authenticated-callable).

---

# 5. Sync protocol

## 5.1 The operation log

The prototype's queue only understands inserts. That is the single largest change. The queue becomes an **ordered, durable log of operations**.

```kotlin
@Entity(tableName = "pending_ops", indices = [Index("entityClientUid")])
data class PendingOpEntity(
    @PrimaryKey(autoGenerate = true) val seq: Long = 0,   // total order
    val entityType: String,        // "entry" | "account"
    val entityClientUid: String,
    val op: String,                // "insert" | "update" | "delete"
    val payloadJson: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)
```

`seq` is a monotonic autoincrement. Operations are pushed **in `seq` order** and the push **stops at the first failure**, so a later operation can never overtake the one it depends on.

## 5.2 Coalescing rules

Applied inside a single Room transaction, at the moment the operation is enqueued. These rules are what make "create → edit → delete offline" produce **no row on the server** rather than three round-trips.

| Existing pending op for this `client_uid` | New op | Result |
|---|---|---|
| *(none)* | insert | append `insert` |
| *(none)* | update | append `update` |
| *(none)* | delete | append `delete` |
| `insert` | update | **rewrite the pending insert's payload.** No new op. |
| `insert` | delete | **remove the insert.** Delete local row. Emit nothing. |
| `update` | update | **replace payload.** One op, not two. |
| `update` | delete | **drop the update, append the delete.** |
| `delete` | anything | unreachable — a deleted row cannot be reached in the UI |

**Transfers are atomic in the log too.** Both legs are enqueued in one transaction, share one `transfer_group`, and are pushed in one `push_entries` call. A delete of either leg enqueues deletes for both.

## 5.3 Push

```
1. Read pending ops ordered by seq, in pages of 100.
2. Group contiguous ops of the same entityType into one push_entries call.
3. On 2xx: delete exactly those ops (by seq), record server id + updated_at.
4. On 4xx (validation): move op to a dead-letter table, surface in Settings,
   never retry. A malformed op retried forever is a hot loop.
5. On 401: refresh token once, retry once, then enter SessionExpired.
6. On 5xx / IO: stop. Leave every remaining op. Let WorkManager back off.
```

**Nothing is ever removed from the log on a timeout.** A timeout means unknown, and unknown plus idempotent push means "send it again", which is free.

## 5.4 Pull

```
1. cursor = DataStore(lastUpdatedAt, lastId)  // null on first run
2. rows = rpc pull_entries(cursor.ts, cursor.id, page_size)
3. In ONE Room transaction:
     upsert each row (server wins on updated_at)
     apply tombstones (deleted_at != null → remove from local live set)
     advance cursor to last row's (updated_at, id)
4. Repeat while rows.size == page_size
```

The cursor advances **only after the page is committed**. A crash mid-pull re-fetches the page; upsert makes that harmless.

**Conflict rule:** server `updated_at` wins, except where a local pending op exists for that `client_uid` — a pending op is a user intention that has not been sent yet, so it survives the pull and is pushed afterwards.

## 5.5 When sync runs

| Trigger | Behaviour |
|---|---|
| App cold start, session present | Pull, then push |
| App foregrounded | Pull if last pull > 60s ago |
| Entry added / edited / deleted | Enqueue op, then schedule per §5.6 |
| Connectivity regained | `NetworkType.CONNECTED` constraint releases the worker |
| Manual "Send everything now" | Immediate, ignores settle timer |
| Session expired | Nothing. Ops accumulate. Nothing is lost. |

## 5.6 Batching (preserved from the prototype)

```kotlin
const val BATCH_FULL   = 3
val SETTLE   = 90.seconds   // restarted by each new entry — a burst goes as one call
val CEILING  = 1.hours      // from the OLDEST op, never pushed back
val RETRY    = 30.seconds   // exponential, WorkManager-managed, capped at 5 min
```

Settle restarts on every new op so a run of ten entries becomes one call. Ceiling is measured from the oldest queued op and never extends, so a lone entry waits for company but not all day.

Sync mode setting, three values, as in the prototype: `smart` (settle + ceiling, default), `instant` (push on every op), `manual` (only the button).

## 5.7 Implementation

```kotlin
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted ctx: Context, @Assisted params: WorkerParameters,
    private val syncRepository: SyncRepository,
) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = when (syncRepository.sync()) {
        SyncOutcome.Success      -> Result.success()
        SyncOutcome.Retryable    -> Result.retry()
        SyncOutcome.Unauthorized -> Result.success()   // SessionExpired owns the UI
        SyncOutcome.Fatal        -> Result.failure()
    }
}
```

Enqueued as unique work `"sync"` with `ExistingWorkPolicy.KEEP`, constraint `NetworkType.CONNECTED`, backoff `EXPONENTIAL, 30s`.

---

# 6. Application structure

## 6.1 Repository layout

```
ledger/
├─ settings.gradle.kts
├─ gradle/libs.versions.toml              # single source of dependency versions
├─ build-logic/convention/                # Gradle convention plugins
│   └─ src/main/kotlin/
│       ├─ AndroidApplicationConventionPlugin.kt
│       ├─ AndroidLibraryConventionPlugin.kt
│       ├─ AndroidComposeConventionPlugin.kt
│       ├─ AndroidHiltConventionPlugin.kt
│       └─ AndroidRoomConventionPlugin.kt
├─ app/
├─ core/
│   ├─ model/          # pure Kotlin. No Android imports.
│   ├─ common/         # Result wrappers, dispatchers, Clock
│   ├─ database/       # Room
│   ├─ datastore/      # Proto DataStore: session, cursor, prefs
│   ├─ network/        # Supabase client, DTOs
│   ├─ data/           # Repositories, sync
│   ├─ domain/         # Use cases that span repositories
│   ├─ designsystem/   # branding_design_system.md, compiled
│   ├─ ui/             # shared composables
│   ├─ navigation/     # route definitions — keeps features independent
│   └─ testing/        # fakes, rules, test data
├─ feature/
│   ├─ onboarding/  auth/  entry/  history/  accounts/  settings/
└─ supabase/
    ├─ migrations/     # §4
    ├─ functions/delete-account/
    └─ tests/          # pgTAP RLS suite
```

> **Architect's note.** The reference guidance splits every feature into `api` and `impl`. At six features and one developer that buys nothing but build files. Routes live in `core:navigation` instead, which achieves the same thing — no feature depends on another feature — with a third of the modules. Revisit if the team grows past three.

## 6.2 `core:model` — pure Kotlin

```
Entry.kt          Account.kt        TxnDirection.kt   TxnFrequency.kt
Money.kt          TxnId.kt          TransferPair.kt   SyncState.kt
UserProfile.kt    OpenYId.kt
```

```kotlin
@JvmInline value class Money(val minor: Long) {
    init { require(minor >= 0) }
    companion object { const val MAX_MINOR = 999_999_999L }
}

@JvmInline value class TxnId(val value: String) {
    init { require(REGEX.matches(value)) }
    val isY get() = value.startsWith('Y')
    companion object { val REGEX = Regex("^[YN][a-z0-9]{6}$") }
}
```

`Money` as a value class is the type-system version of D6: there is no arithmetic path that reaches a `Double`.

## 6.3 `core:designsystem` — the branding document, compiled

```
LedgerColors.kt   LedgerTypography.kt   LedgerShapes.kt   LedgerTheme.kt
component/  LedgerChip.kt  LedgerSegmentedButton.kt  LedgerPillButton.kt
            LedgerTextField.kt  LedgerBottomSheet.kt  LedgerCard.kt
            AmountField.kt  LedgerToast.kt  LedgerBanner.kt
icon/  LedgerIcons.kt
```

```kotlin
val CanvasLight = Color(0xFFF4F1EA)
val CanvasDark  = Color(0xFF121614)
val Forest      = Color(0xFF0E7955)
val Lime        = Color(0xFFCCF244)
val Mint        = Color(0xFFDDF3E4)
val Amber       = Color(0xFFFFDE73)
val Coral       = Color(0xFFC62828)   // [CHANGED] branding doc's #E04848 is 3.6:1 on
                                       // CanvasLight, fails WCAG AA. This clears 4.98:1.
val TextDark    = Color(0xFF181C1A)
val TextMuted   = Color(0xFF78756E)
val HairlineLt  = Color(0xFFE5E3DB)

val LedgerShapes = Shapes(
    extraSmall = RoundedCornerShape(14.dp),   // input
    medium     = RoundedCornerShape(22.dp),   // card
    large      = RoundedCornerShape(24.dp),   // bottom sheet
)
```

Two things the branding document does not specify and must be decided here:

1. **Dark theme.** The palette names a dark canvas but no dark surface ramp. Ship **light only** at launch with `forceDarkAllowed=false`; a half-done dark mode on a finance app reads as broken. Full dark ramp is a backlog item.
2. **Contrast.** `TextMuted #78756E` on `CanvasLight #F4F1EA` is ≈3.9:1 — **fails WCAG AA for body text**. Use it only at 14sp+ semibold or darken to `#5F5C56`. Flagged in §10.5.
3. **[ADDED] Coral also fails.** `#E04848` is ≈3.6:1 on `CanvasLight`, ≈4.05:1 on white — fails AA on both, and it's the color of every expense amount. `LedgerColors.kt` was written from an earlier version of this doc with the old value; **patch it to `#C62828`** (below) before any B-phase screen reads `Coral` — none do yet, so this is a one-line fix with zero blast radius today.

Font: **Inter**, bundled as a downloadable-font provider with a local fallback, never a network-only fetch.

## 6.4 `core:database`

```
LedgerDatabase.kt
entity/    EntryEntity.kt  AccountEntity.kt  PendingOpEntity.kt  DeadLetterEntity.kt
dao/       EntryDao.kt  AccountDao.kt  PendingOpDao.kt
converter/ InstantConverter.kt  LocalDateConverter.kt  EnumConverters.kt
migration/ (from schema version 2 onwards)
```

**The database file is named per user: `ledger-${userId}.db`.** Two accounts on one phone cannot see each other's data because they are not in the same file. The prototype's `ledger.<userId>.queue.v1` key-namespacing is the same idea, done properly.

**Implementation, added 25 Sep 2026 (C10):** this claim is proven at two layers. `LedgerDatabaseFactoryTest` (core:database) proves it at the file level — open A, write, close; open B, close; reopen A; the row is exactly as written, not just "invisible from B's connection" (a separate, already-existing case in the same file). `SessionDatabaseHolderTest` (core:data, C10's own gate: "Sign in as A, then B, then A → A's data intact") proves it through the app's ACTUAL reopen-on-user-switch seam, `SessionDatabaseHolder` — via a new `internal fun database(userId: String)` overload the test drives directly, since `SessionStore` is `EncryptedSharedPreferences` and needs a real Android Keystore that Robolectric doesn't provide. `SessionStore.prefs` became `by lazy` (was an eager property initializer) purely so a throwaway instance can satisfy `SessionDatabaseHolder`'s constructor in that test without ever touching Keystore.

```kotlin
@Dao interface EntryDao {
    @Query("""SELECT * FROM entries WHERE deletedAt IS NULL
              ORDER BY entryDate DESC, createdAt DESC LIMIT :limit OFFSET :offset""")
    fun pageByDate(limit: Int, offset: Int): Flow<List<EntryEntity>>

    @Query("""SELECT txnId FROM entries WHERE deletedAt IS NULL AND txnId LIKE 'Y%'
              GROUP BY txnId HAVING COUNT(*) % 2 = 1""")
    fun openYIds(): Flow<List<String>>

    @Query("""SELECT * FROM entries WHERE transferGroup = :group AND deletedAt IS NULL""")
    suspend fun transferLegs(group: String): List<EntryEntity>

    @Query("""SELECT SUM(CASE WHEN direction='credit' THEN amountMinor ELSE -amountMinor END)
              FROM entries WHERE deletedAt IS NULL AND transferGroup IS NULL
              AND entryDate BETWEEN :from AND :to""")
    fun netMinorBetween(from: LocalDate, to: LocalDate): Flow<Long?>
}
```

Open Y-IDs as a SQL `HAVING COUNT(*) % 2 = 1` is the prototype's odd-count rule, moved off the main thread and made reactive.

`exportSchema = true`. Schema JSON is committed and diffed in CI (§10.4) — an unversioned Room schema change is a crash on the next update for every existing user.

## 6.5 `core:data` — repositories

```
repository/  EntryRepository.kt  AccountRepository.kt  ProfileRepository.kt
             SyncRepository.kt   AuthRepository.kt     ConfigRepository.kt
sync/        OpLog.kt  OpCoalescer.kt  Pusher.kt  Puller.kt  SyncScheduler.kt
mapper/      EntryMappers.kt  AccountMappers.kt
```

Every write is one Room transaction that mutates the entity table **and** appends to `pending_ops`. There is no window where a row exists locally without a pending operation, or the reverse.

```kotlin
suspend fun addEntry(draft: EntryDraft): Result<Unit> = db.withTransaction {
    val entry = draft.toEntity(clientUid = uuid())
    entryDao.upsert(entry)
    opLog.enqueue(Op.Insert("entry", entry.clientUid, entry.toJson()))
    syncScheduler.onOpEnqueued()
}

suspend fun addTransfer(draft: TransferDraft): Result<Unit> = db.withTransaction {
    val group = uuid()
    val (out, into) = draft.toLegs(group)          // one debit, one credit
    entryDao.upsertAll(out, into)
    opLog.enqueue(Op.Insert("entry", out.clientUid,  out.toJson()))
    opLog.enqueue(Op.Insert("entry", into.clientUid, into.toJson()))
    syncScheduler.onOpEnqueued()
}
```

## 6.6 `core:domain` — use cases

Only where logic spans repositories or is genuinely reusable. Everything else lives in the ViewModel.

```
ParseDateInputUseCase.kt      FormatAmountUseCase.kt
ComputeOpenYIdsUseCase.kt     GenerateTxnIdUseCase.kt
ValidateEntryDraftUseCase.kt  BuildMonthSummaryUseCase.kt
ExportBackupUseCase.kt        ImportBackupUseCase.kt
DeleteEntryUseCase.kt         # resolves transfer siblings before deleting
```

## 6.7 `feature:*`

Each feature module, consistent shape:

```
feature/entry/
  EntryScreen.kt        # stateless Composable, takes UiState + (Action)->Unit
  EntryRoute.kt         # hoists the ViewModel, collects state
  EntryViewModel.kt
  EntryUiState.kt       # sealed interface
  EntryAction.kt        # sealed interface — every user intent
  component/ DateField.kt  AmountCard.kt  AccountChips.kt
             TxnIdField.kt TxnTypeCombo.kt SelfTransferToggle.kt
             ConfirmSheet.kt EditBanner.kt
  navigation/ EntryNavigation.kt
  di/ EntryModule.kt
```

Unidirectional: state down as one `StateFlow<UiState>`, intents up as one `onAction(Action)`.
---

# 7. Screens and behaviour

Every rule below was extracted from the prototype and is binding. Where the prototype was wrong or Excel-shaped, the change is marked **[CHANGED]**.

## 7.0 Navigation graph

```
Boot ─┬─ no session ────────→ Onboarding → SignIn ─┐
      ├─ session, empty DB ─→ Restoring ───────────┤
      └─ session, has DB ───────────────────────────┤
                                                    ▼
                                                  Home
                                    ┌───────────────┼───────────────┐
                                  Add            History         Settings
                                    │               │               │
                              ConfirmSheet    EntryDetail      Accounts
                              EditMode        DeleteDialog     BackupRestore
                                                               DeleteAccount
```

**[CHANGED, per `ui-spec.md`]** Three tabs, not two: `Add Payment` | `History` | `Stats`. The diagram above already shows History as its own top-level destination (not nested under Add) — this line was still describing the prototype's older two-tab layout and is corrected to match. Gear icon in the header opens Settings.

**Implementation, added 25 Sep 2026 (C9):** the first real `NavHost` in the repo (`LedgerNavHost`, app module), assembled the only place that can see every feature module. `core:navigation`'s `LedgerDestinations` is plain route-string constants, no `NavType` arguments — every screen still takes plain callbacks (`onFinished`, `onSignedIn`, ...), the same shape every existing `XxxRoute` composable already used, so a `NavController` never has to leak into a feature module's own API. **[SCOPE NOTE]** Home itself stayed the four tabs A13 built (Add Payment/History/Accounts/Settings) rather than this section's three-tab-plus-gear shape: Stats has no screen anywhere in this repo (unscheduled since S2), and reshaping the tab bar around a screen that doesn't exist yet would be premature. Settings is still a fourth tab, not behind a gear icon, for the same reason.

## 7.1 Boot

Single decision point, no UI beyond the system splash (`androidx.core.splashscreen`).

| Condition | Route |
|---|---|
| No stored session | Onboarding |
| Session, refresh fails, network available | SignIn with "session expired" note |
| Session, refresh fails, offline | Home — **local data is fully readable offline without a valid token** |
| Session valid, local DB empty | Restoring |
| Session valid, local DB populated | Home, pull in background |
| `app_config.min_supported_build` > this build | Forced-update screen |

The offline row is the important one. A finance app that shows a login wall on a plane is broken.

**Implementation, added 25 Sep 2026 (C9):** `decideBootRoute` (core:data, pure, `DecideBootRouteTest` covers all six rows plus the forced-update override, 9 cases) is this table as one function; `BootRepository` gathers the impure inputs (`SessionStore`, a live `AuthRepository.refreshSession()` attempt, a new `ConnectivityChecker` checking `NET_CAPABILITY_VALIDATED` rather than just "a radio is up," a new `AppConfigRepository` reading `app_config.min_supported_build`, `EntryDao.hasAnyLiveEntries()`) and calls it. The refresh attempt and the local-data check are both skipped entirely when offline rather than left to fail over the network, and `fetchMinSupportedBuild()`/the local-data check both fail closed to "don't know, proceed" on any error — a boot-time bug in one check must never lock every user out. No `androidx.core.splashscreen`: its `installSplashScreen()` failed to link under this project's Kotlin/AGP toolchain (reproduced on both 1.0.1 and 1.2.0, confirmed via `javap` that the method genuinely exists in the AAR); `MainActivity` instead holds the launch window's own plain-color background via a `ViewTreeObserver.OnPreDrawListener` gated on the boot decision, the same technique the compat library uses internally, working identically on every API level back to minSdk. **Not yet verified on a real device in real airplane mode** — the C9 gate (BUILD-LOG, Thu 25 Sep S7) is proven at the `decideBootRoute` logic level only.

## 7.2 Onboarding — three panes, then consent

1. **What it does.** One screen. Track money in and out across your accounts, offline, on your phone.
2. **The dependency you are accepting.** Plain language: sign-in is Google only; if you lose that Google account you lose the ledger; here is the export button and it takes four seconds. **The export action is offered here, not buried in settings** — this is the mitigation for D5 and burying it invalidates the mitigation.
3. **Consent notice** (DPDP §11.4). What is collected, why, where it is stored, how to delete it. Links to the privacy policy. An explicit **Agree and continue**. Writes `profiles.consent_version` and `consent_at`.

Skippable: panes 1–2 yes, pane 3 no.

**Implementation, added 25 Sep 2026 (C9):** `feature:onboarding` (previously an empty scaffold) now holds all three panes. Consent is recorded locally first — `ConsentStore` (core:datastore), a new device-scoped (not per-user) proto DataStore, since Onboarding runs before any session exists to key a per-user file on — and synced to `profiles.consent_version`/`consent_at` only once sign-in succeeds (`ProfileRepository.syncConsentToServerIfNeeded`, best-effort, retried on every later sign-in until it lands; never blocks the UI). `CURRENT_CONSENT_VERSION` is versioned exactly as this section names: a device that already agreed still sees panes 1–2 (they're informational, not gated) but pane 3 only forces a fresh "Agree and continue" when the locally-recorded version is behind the current one — **[INTERPRETIVE NOTE]** §7.1's own boot table has no "already onboarded, skip straight to Sign in" row, so Onboarding itself is still shown every time there's no stored session (including right after a sign-out); what doesn't repeat is re-reading the same legal text already agreed to. Pane 2's export button is real UI, present per this section's own "offered here, not buried in settings" requirement, but disabled with an explanatory line: exporting needs a signed-in per-user database, which structurally doesn't exist yet at this point in the flow — same "disabled, explained, not hidden" pattern C7 used for Backup before C8 existed to build it. Pane 3's privacy-policy line is plain text, not a link: no policy URL exists anywhere in this project yet (Phase 9's own gate is "both policy URLs resolve").

## 7.3 Sign in

```kotlin
val option = GetSignInWithGoogleOption.Builder(serverClientId = WEB_CLIENT_ID)
    .setNonce(nonce)          // random per attempt, hashed, verified by Supabase
    .build()
val credential = credentialManager.getCredential(context, GetCredentialRequest(listOf(option)))
val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
supabase.auth.signInWith(IDToken) { this.idToken = idToken; provider = Google; this.nonce = nonce }
```

States and what each shows:

| State | UI |
|---|---|
| Idle | "Continue with Google" pill, Forest green |
| In progress | Button disabled, inline spinner. No full-screen blocker. |
| `NoCredentialException` | "No Google account on this device" + button to open Android's add-account settings |
| `GetCredentialCancellationException` | Silent return to Idle. Cancelling is not an error. |
| Network failure | "Couldn't reach the server. Try again." Retry button. |
| Token rejected | "Sign-in failed." Log to Sentry with the error code, never the token. |
| Success | → Restoring |

The session is stored in `EncryptedSharedPreferences` (AES-256-GCM, key in the Android Keystore), never in plain DataStore.

**Implementation, added 25 Sep 2026 (C9):** `SignInScreen`/`SignInRoute` (built at A13) now carry an optional `sessionExpiredNote` (this table's own "session expired" text, shown alongside Idle/InProgress only — a real error from the current attempt takes the banner slot instead) and are wired into `LedgerNavHost` twice, from Onboarding (no note) and from a boot-time refresh failure (note shown). **Real bug caught before shipping, not after:** `SignInRoute` called `onSignedIn()` directly in the composable body on every recomposition where the state was `Success` — harmless at A13 when it only flipped a local boolean, but wiring it to `navController.navigate(...)` here would have pushed a duplicate back-stack entry on every recomposition; fixed with `LaunchedEffect(uiState)` before it ever reached the graph.

## 7.4 Restoring

Full pull for a new device or reinstall. Determinate progress from `pull_entries` page counts. No skip. On failure: retry, or "continue offline" which lands on an empty Home and keeps retrying in the background.

**Implementation, added 25 Sep 2026 (C9):** `RestoringRoute` (app module) calls a new `SyncRepository.restore(onProgress)` — pull-only, deliberately no push, since an empty local database (its own precondition for reaching this screen) has nothing pending to send yet. `Puller.pull` now threads a running row count out via an `onProgress` callback (default no-op, existing callers/tests unaffected) for this section's own "determinate progress from pull_entries page counts," extended to cover accounts pages too. Failure shows Retry or "Continue offline," which navigates to Home the same as any other offline boot row. **[SCOPE NOTE]** "Continue offline" does not itself schedule a background retry loop beyond whatever `SyncScheduler`'s existing triggers already cover — no separate retry timer was added here.

## 7.5 Add Entry — the form

**[CHANGED, 25 Sep 2026]** Field order per `ui-spec.md`, reordered so amount comes first: **Amount + direction → Account(s) [+ Self transfer toggle] → Transaction type → Transaction name → More info → Date → Will I get this back? → Save**. The old order (Date first, Frequency present) is superseded; Frequency is gone (§7.5.7).

### 7.5.1 Date field

Free text, `KeyboardType.Decimal`. **No mask, no auto-inserted characters, no caret repositioning** — that is what lets select-all-delete and mid-string editing behave like any other field.

Input filter: digits and `. - / space` only. Anything else is dropped and the caret is put back where it was, not thrown to the end.

Parsing rules, in order:

| Rule | Behaviour |
|---|---|
| Empty | Hint: "Day and month, separated — the year is worked out" |
| Non-digit part | "Numbers only" |
| One part only | "Add the month too — like 5.9" — **the separator is mandatory.** `212` is 21 Feb or 2 Dec and no ranking can know which. One keystroke removes the guess entirely. |
| More than 3 parts | "Too many parts" |
| Day or month > 2 digits | "Day and month are 1 or 2 digits" |
| Month outside 1–12 | "There is no month 14" |
| Day outside 1–31 | "There is no day 45" |
| Not a real date | "There is no 31 April" — **reported, never silently clamped** |
| Explicit year, 2 digits | Most recent year ending in those digits. Never future. `26` → 2026. |
| Explicit year, 4 digits | Taken as given |
| Explicit year, other length | "Year should be 2 or 4 digits" |
| No year | Most recent past occurrence. **Search back up to 8 years** — 29 February needs it, because the two nearest candidates can both be non-leap. |
| Resolves to the future | "That date is still in the future" |

Hint line states:
- Normal date → **empty**, and the line holds its height so nothing jumps
- Year was inferred to last year → warn: "Thu 25 Dec 2025 — last year"
- More than 90 days ago → warn: "Mon 3 Mar 2026 — 104 days ago"

Both warnings exist because backdating is legitimate *and* is exactly what a mistyped month looks like.

Quick buttons: **Today**, **Yesterday**. Selected state clears the moment the field is typed in.

On focus loss, a resolved date is rewritten in full (`DD/MM/YYYY`) so the inferred year is visible in the field. **Unparseable text is left exactly as typed** — clearing it throws away a half-finished correction.

The date resolves live on every keystroke, not on blur, so the save button's caption is never stale.

### 7.5.2 Expense name / More info

`expense_name` — required, trimmed, 1–120 chars. `more_info` — optional, ≤300.

### 7.5.3 Self transfer toggle

A pill toggle. Turning it **on**:

- Account label → "From account"; the To-account row **opens** (it is always present in the tree, never added or removed, so there is no layout jump)
- Single transaction-type field hides; split **Sent leg type** / **Received leg type** appear
- Y/N segment **locks to Y** and is disabled at 60% opacity
- Expense name auto-fills "Self Transfer"
- Frequency → Monthly
- Sent leg type → "Sent Transfer"; Received leg type → "Received Transfer"
- Both Debit **and** Credit lock on, shown as locked
- **If From and To are the same account, To silently moves to a different one** — resolved before it can become a visible conflict

Turning it **off**: Y/N unlocks and resets to N; Debit only; expense name cleared *only if it still reads "Self Transfer"*; frequency Monthly; split custom fields hide.

### 7.5.4 Account chips

Horizontally scrollable, generated from live accounts, **never disabled**.

**The swap rule:** in transfer mode, tapping a value on one side that would collide moves the *other* side to whatever this side just gave up. From=Domestic/To=International, tap International on the From side → lands on "International → Domestic" in one tap. It never blocks the tap and never asks the user to clear a conflict first.

**[CHANGED]** Accounts come from `accounts`, not a hardcoded triple. New users are seeded Domestic / International / Cash.

### 7.5.5 Will I get this back? **[CHANGED, 25 Sep 2026 — replaces the old raw transaction-ID field]**

Per `ui-spec.md`: **Yes / No** buttons, not a raw `txn_id` field. The id still exists underneath (format `[YN][a-z0-9]{6}$`, unchanged) and is shown in the confirm sheet, but it is never typed and — outside the confirm sheet — never shown as raw text either.

- **No** → nothing further. The entry is written with a fresh `N` id.
- **Yes** → a second **New / Old** control appears.
  - **New** → a fresh `Y` id is minted.
  - **Old** → lists **currently-open** items by expense name, with amount and date (not raw ids). Picking one adopts that id, which closes the pair. Only open items ever appear here — a closed pair drops out immediately, unlike the Owed to me tab (§7.8), which keeps showing it (grayed out).
- Hidden entirely while self transfer is on — a transfer's `Y` id is automatic (§7.5.3).

In edit mode the stored ID must survive loading. Switching Yes/No or New/Old regenerates, so the real stored ID is written back afterwards; if it is a Y-ID that is no longer open, it is **inserted at the top of the Old list** using the entry's own already-known name/amount/date (there's no `OwedToMeItem` to look it up in, since it isn't open) rather than lost.

Implementation: `WillGetBackField` (feature:entry), backed by `buildTxnIdChoices` (feature:entry, pure) wrapping the existing `buildYIdDropdownOptions` ordering with display data from `OwedToMeItem` (core:domain, §7.8's `GroupOwedToMeUseCase`).

### 7.5.6 Transaction type

Combo: `Payment · Refund · Cashback · Payment Split · Salary · Sent Transfer · Received Transfer · Custom…`

Choosing `Custom…` reveals a free-text field. In transfer mode there are two independent selects, each with its own custom field, shown only when that side is Custom.

Loading an entry whose stored type is not in the list opens the custom field pre-filled — a user-typed type must round-trip.

### 7.5.7 Frequency — **[REMOVED, 25 Sep 2026]**

No chips, no form field. `ui-spec.md`'s field list is Amount, Account, Category, Transaction name, Note, Date, plus the Yes/No mechanic — Frequency isn't in it. `EntryDraft` (core:domain) has no `frequency` field; every entry the app writes carries `txn_freq = monthly` unconditionally (`ApplySelfTransferToggleUseCase` used to set this explicitly on both the on- and off-transitions, which is why dropping it changed no observable behaviour — it was already always Monthly by construction). The server column and its default are untouched; this is a front-end removal only, not a migration.

### 7.5.8 Amount

The highest-risk field in the app, because ₹50,000 and ₹5,00,000 look alike.

| Rule | Value |
|---|---|
| Max integer digits | **7** — ₹99,99,999. An 8th digit is **refused at the keystroke**, not accepted and validated later. |
| Decimals | Max 2. A 3rd is refused outright, never accepted-then-rounded. |
| Leading zeros | `0` + `5` → `5`. A lone `0` before a dot survives (`0.5`). |
| Grouping | Indian (`en-IN`): `12,34,567.89` |
| Caret | **Preserved.** All editing happens in "clean" coordinates (digits and dot only) and converts to display position once, at the end. |
| Width | Measured and animated to the rendered text, so ₹ + number stays optically centred |
| Zero | "Not typed yet", not a value. The button shows no figure until there is one. |
| ≥ ₹1,00,000 | Readback note under the field: **"5 lakh"**. `5,00,000` and `50,000` differ by one glyph; "5 lakh" and "50 thousand" do not. |

Direction: **Credit** / **Debit** buttons, Debit default, both locked on in transfer mode.

In Compose, the caret rule means a `VisualTransformation` with a correct `OffsetMapping` in **both** directions. Get this wrong and the caret jumps to the end on every keystroke — it is the single most commonly broken field in Android finance apps and it needs its own unit test class (§10.1).

### 7.5.9 Save button

Label: `Add Entry` / `Save Changes`, plus the live figure and direction: `Add Entry • ₹4,500.00 Out`, or `• ₹4,500.00 Transfer`.

Caption beneath states **only what is blocking the tap**, never a summary: "Needs a date, a name and an amount". Empty and hidden when the form is valid — what the entry *is* gets read back in the confirm sheet, as a sentence.

Validation order on tap, each with its own message, its own field highlight, its own scroll-into-view and its own focus:

```
1. Edit-mode transfer-shape mismatch → refuse with an explanatory toast
2. Date missing/unparseable         → "Pick a date first"
3. Expense name empty               → "Add an expense name"
4. Amount ≤ 0                       → "Add an amount"
→ open Confirm sheet
```

The order matters and is not arbitrary: toggling the transfer switch off also clears the name field, so checking shape first is what makes the message name the *real* problem instead of reporting "add an expense name".

**[REMOVED]** The Excel month-lock ("that row is in AUG26 and has to stay there"). Rows have primary keys now. A date can move anywhere.

### 7.5.10 Confirm sheet

Every entry passes through it. Contents:

- **A sentence.** "₹4,500.00 left your Domestic account on Monday 14 Sep 2026 for Rapido." Transfer: "₹10,000.00 moved from your Domestic account to your Cash account on … Two rows, one thing that happened."
- The full property list
- The large-amount readback when it applies
- **Edit entry** (closes the sheet, form untouched — a close, not a restore) / **Add entry**

Dismissible by scrim tap, back gesture, ✕. Nothing is written until the primary button.

## 7.6 Edit mode

Reached from Entry detail. **The same form does both jobs** — one set of fields, one set of rules, no chance of an add-path and an edit-path drifting apart.

- A banner above the form: `Y3k9d2 · 14 Sep 2026 · ₹4,500.00` + **Cancel**
- Save button becomes "Save Changes"; confirm sheet title becomes "Save these changes?"
- The original rows are **frozen at the moment editing starts**. Editing twice before a sync changes what gets written, not what gets matched.
- **An entry cannot become a transfer, or a transfer an entry.** One row vs two. Refused with: "A transfer is two rows and an entry is one — cancel and add a new one instead."
- Editing a transfer edits **both legs** together.
- Cancel resets the form completely and toasts "Edit cancelled — nothing changed".

**[CHANGED]** No `findTargetRow()` content-matching heuristic. The prototype had to locate a row in Excel by matching date + id + amount + account, with a looser fallback. Rows have `id` and `client_uid` now. That entire class of "is not in AUG26 any more" failure is gone.

Implementation, added 25 Sep 2026: `EntryRepository.updateEntry`/`updateTransfer` (core:data) enqueue an `Op.Update`, never a second insert, against a row carrying the ORIGINAL `id`/`client_uid`/`created_at` -- the literal "frozen at the moment editing starts." `buildEditDraft` (feature:entry, pure, tested) turns the tapped leg (+ its resolved sibling, for a transfer) into that starting draft and an `EditingOriginal` the save path replays against. `EditRequestStore` (core:data, `@Singleton`) is the hand-off between History's entry-detail sheet and the Entry screen -- two separate Hilt ViewModels, no navigation graph yet (§7.0's real one is C9's job) to pass an argument through.

## 7.7 History — Recent

**Month summary card** at the top: Out / In / Net for the current calendar month. **Transfers are excluded** — moving your own money is not spending.

Below it, entries grouped by day, newest day first, newest entry first within a day. Each day header carries that day's net.

**Transfer folding.** Two legs render as one line. **[CHANGED]** Matched by `transfer_group`, not by the prototype's "same id + same timestamp + mirrored amounts" heuristic.

Row anatomy:
- Leading tile — account initial, or `⇄` for a transfer
- Name — expense name `· more info`; transfers read "Self transfer"
- Meta — `Account · Type`, plus status chips: **"on this device"** (not yet synced), **"edited"** (local change not yet pushed)
- Amount — `− ₹4,500.00` coral / `+ ₹4,500.00` forest; transfers are flat, unsigned, neutral

Paging: 40 rows, then "Show earlier entries". **[CHANGED]** Room `PagingSource` instead of a slice of an in-memory list.

Empty state: "Nothing here yet."

## 7.8 History — Owed to me

**[CHANGED, 24–25 Sep 2026]** One list, no second tab inside it. **Every `Y` id ever seen — open or closed — shown once**, split into two sections, each its own rounded card with a gap between them (same shape as a day card in Recent):

- **Open** card, on top. Sorted newest-opened-first. Row: name, amount, account, "Opened `<date>`".
- **Closed** card, below. Sorted newest-closed-first. Row: same fields plus "Opened `<date>` · Closed `<date>`". Grayed out (~55% opacity) so open and settled are never confused at a glance.

Count badge on the tab counts **only** the Open section.

Rows tappable, same as Recent (§7.10). An open item opens its one leg; a closed item opens the close (repayment) leg by default — the Open/Close toggle in the detail sheet reaches the other.

Empty: "Nothing outstanding — entries you mark Y show up here until the money comes back."

**[REMOVED]** All "only this device has been checked, pull earlier months" scoping copy. The full ledger is local after the initial pull, so the count is simply correct.

Implementation: `GroupOwedToMeUseCase` (core:domain) folds `HistoryRepository.owedToMeEntries()` (every live Y-prefixed `Entry`, reactive) into one `OwedToMeItem` per `txn_id` — `isOpen`, representative name/amount/account (from the more recent leg once closed), `openedDate`, `closedDate`, and both legs' entry ids (`openLegEntryId`/`closeLegEntryId`) for the detail-sheet toggle in §7.10. Same open/closed split serves §7.5.5's Old picker (open items only).

## 7.9 Open Y-ID computation

```
open = { txn_id : count(live rows with that txn_id) is odd }
```

Computed by the Room query in §6.4, reactive, offline, exact. The server function in §4.6 exists only for reconciliation.

**[REMOVED]** The prototype's separately-persisted `openYIds` list and its `applyYId()` toggle. That list existed because the app could not see its own history; with the full ledger local, a second list is a second source of truth and therefore a bug waiting to happen. Delete it.

## 7.10 Entry detail sheet

Opened by tapping a row, Recent or Owed to me.

- **✕** top-right — the only "just close this" affordance. **[CHANGED, 24 Sep 2026]** No separate bottom Close button any more.
- Title: expense name, or "Self transfer"
- The sentence, as in the confirm sheet
- Full property list: Date (with weekday), Account (or From/To), Expense name, More info, Type (or Sent leg type / Received leg type), Amount, Transaction ID, **Status**. **[REMOVED]** Frequency — dropped from the form (§7.5.7), so it's dropped from the detail sheet too.
- Status is one of: `In sync` · `On this device, waiting to be sent` · `Changed here, not sent yet`
- **Actions: Delete / Edit, one row, split 50/50.** **[CHANGED, 24 Sep 2026]** Replaces the old Close/Edit/Delete three-action row.

**Open/Close leg toggle — added 25 Sep 2026.** When the tapped entry's `Y` id has both an open and a close leg on this device (i.e. `OwedToMeItem.closeLegEntryId != null` for it), a small two-way toggle appears top-right, immediately left of the ✕, with a gap between the two and extra title padding so the name never runs under it. Labelled **Open** / **Close**. Whichever side is selected is what Edit and Delete act on, independently — deleting just the repayment leg reopens the loan; deleting just the original leaves the repayment (if any) orphaned, no automatic cascade. Defaults to whichever leg was tapped (`openLegEntryId` from Owed to me's Open card, `closeLegEntryId` from its Closed card). Not shown for a one-legged `Y` id or a non-`Y` entry. Pure UI state — which of two already-fetched rows is being edited — no backend change.

## 7.11 Delete — new, not in the prototype

Destructive, so it is confirmed, and the confirmation says what will actually happen.

| Case | Dialog |
|---|---|
| Single entry | "Delete this entry? ₹4,500.00 · Rapido · 14 Sep 2026. This cannot be undone." |
| Transfer leg | "**This is one half of a transfer. Deleting it deletes both rows.** ₹10,000.00 Domestic → Cash." |
| Open Y-ID | "This entry has an open ID (`Y3k9d2`). Deleting it removes it from Owed to me." |

With §7.10's Open/Close toggle, "this entry" in every row above means whichever leg the toggle currently selects, not always the leg that was tapped to open the sheet.

Then, locally in one transaction: soft-delete the row (and its sibling), enqueue the delete op(s), recompute open Y-IDs via the reactive query, dismiss the sheet, toast **"Entry deleted"** with an **Undo** for 5 seconds.

Undo is local-only and clears the pending delete op before it is pushed. After 5 seconds the op is live and deletion is permanent.

## 7.12 Accounts

List with drag-to-reorder. Per account: rename (inline, 1–40 chars, case-insensitively unique among live accounts), archive, unarchive. Archived accounts leave the chip rows but existing entries keep their reference and still display.

**An account with live entries cannot be deleted, only archived.** The foreign key enforces it; the UI explains it before the user hits the error.

**[GAP, noted not assumed]** No "add a new account" action is named anywhere in this section's text -- only rename/archive/unarchive of accounts that already exist. Without one, the seeded three (§2) are the ceiling forever, which contradicts §3's own "N accounts, generalized" premise and its explicit "4+ accounts" tile-collapse rule (nothing to collapse without a 4th). Built anyway (25 Sep 2026) as a plain "Add account" row on the Accounts screen, reusing the same name-validation rule as rename -- flagged here as filling an apparent spec gap, not as a deviation from stated intent.

Implementation, added 25 Sep 2026: `AccountRepository` (core:data) gained `renameAccount`/`setArchived`/`reorder`/`allAccounts`/`ensureSeeded`, each an entity write + `Op` enqueue sharing one transaction, same pattern as the entry-write paths. `validateAccountName` (core:domain, pure, tested) is the rename/add collision check, called before the repository ever runs. `ensureSeeded` -- §2's first-run seeding -- is itself the double-seed guard: it checks-and-inserts inside one transaction, called from both `AccountsViewModel` and `EntryViewModel` (Add Payment is the app's default tab; requiring a detour through Accounts first, before any account exists to pick in the entry form, would be a dead end). **[CHANGED]** "Drag-to-reorder" ships as explicit up/down buttons, not a drag gesture -- no reorderable-list dependency exists in this project yet, and a correct one is real, separable work; the persisted result (`sortOrder`) is identical either way. A real drag gesture is a documented follow-up, not a dropped requirement.

## 7.13 Settings

| Group | Contents |
|---|---|
| **Sync** | Mode: *Wait and send them together* (default) / *As soon as I add them* / *Only when I tap send*. Queue summary. **Send everything now**. Last sync time. |
| **Accounts** | → Accounts screen |
| **Backup** | Last-backup line, **Save a backup file**, **Restore from a file** |
| **Security** | Require biometric to open (default off). Hide amounts in the app switcher (default **on**). |
| **About** | Version, build, Privacy policy, Terms, Open-source licences, Support email |
| **Account** | Signed-in Google address, **Sign out**, **Delete account** (coral, last) |

**[REMOVED]** "Wait for the sheet to confirm" toggle — the idempotent push in §4.6 makes it meaningless. "Put them back in the queue" — impossible to need when pushes are idempotent. "Read the sheet again" / month import — replaced by pull sync. Every one of those controls existed to work around Make's ambiguous 200, and the ambiguity no longer exists.

**Real gap found and fixed, 25 Sep 2026 (C7):** `SyncScheduler` (§5.5/§5.6, built in Sprint B) was never actually called from anywhere. `EntryRepository`/`AccountRepository` enqueued pending ops correctly but nothing ever told WorkManager to push them — every write since C1 landed has been queuing correctly and syncing never. Every write method on both repositories now calls `SyncScheduler.onOpEnqueued` (using whatever `UserPrefsRepository.currentSyncMode` currently says) right after its transaction commits. Not wired yet, and flagged rather than silently left: `onColdStart`/`onForegrounded` (triggers 1–2, need real Activity-lifecycle hooks, which belong with C9's boot routing) and `onSessionRestored` (trigger 6, needs a session-expiry recovery flow that doesn't exist yet either). **[Updated, C9, 25 Sep 2026]** `onColdStart` is now called from `MainActivity.onCreate` (trigger 1) and `onSessionRestored` is now called after every successful sign-in, fresh or recovery (trigger 6). `onForegrounded` (trigger 2) is still **not** wired: §5.5's own text makes ">60s since last pull" the caller's job, which needs a last-pull timestamp nothing tracks yet — firing on every foreground instead would be a real regression (sync spam on every app switch), not a neutral simplification, so this stays a named, open gap.

Implementation, added 25 Sep 2026: `UserPrefsRepository` (core:data) is the one reader/writer of the `UserPrefs` proto DataStore — sync mode plus two new fields, `show_amounts_in_app_switcher` and `require_biometric_to_open` (both booleans, deliberately named so proto3's zero-value default matches THIS section's own stated defaults — "hide amounts... default on" needed the field phrased as `show_amounts...` so `false` means hidden). `SyncStatusRepository` exposes the queue/dead-letter counts and wraps `onManualSyncRequested` for "Send everything now." `AuthRepository` gained `currentEmail()` — `SessionStore` deliberately never persisted email (§7.3), so this is the only place it's available. "Hide amounts in the app switcher" is the one Security toggle actually enforced (`MainActivity` applies `FLAG_SECURE` from it, lifecycle-scoped); "Require biometric to open" persists but gates nothing — the gate belongs in §7.1's Boot routing, which is C9's job and doesn't exist yet to gate anything. **[Now built, C9, 25 Sep 2026]** `BiometricGate` (app module) wraps Restoring/Home behind a `BiometricPrompt` when this toggle is on, and fails OPEN (skips the gate) whenever `BiometricManager.canAuthenticate()` isn't `BIOMETRIC_SUCCESS` despite the toggle being on — this is an optional app lock, not the boundary that protects the user's data, and permanently stranding someone out of their own ledger over a toggle they can no longer satisfy would be a worse failure than the lock doing nothing. `MainActivity` is now a `FragmentActivity` (`BiometricPrompt` requires one) and `USE_BIOMETRIC` is in the manifest. Backup (this section's own **Save a backup file** / **Restore from a file**) is disabled with an explanatory line, correctly deferred to §7.14/C8. Delete account is disabled, deferred to §7.17/C11. "Last sync time" is not tracked (no field exists for it) and not shown — a real, small, undone piece, not folded into this pass to avoid a proto-schema afterthought.

## 7.14 Backup and restore

**Export** — `ACTION_CREATE_DOCUMENT` via the Storage Access Framework. **No storage permission is required or requested.** The user picks the destination (Drive, Files, a chat), which is the point: a backup that lands only on the device that might fail is not a backup.

```json
{ "app": "ledger", "version": 2, "exportedAt": "...", "userId": "...",
  "counts": { "entries": 1482, "accounts": 3, "pending": 0 },
  "accounts": [...], "entries": [...], "pendingOps": [...] }
```

**Import** — `ACTION_OPEN_DOCUMENT`. **Additive only, keyed on `client_uid`. It never deletes anything already present.** Imported rows go in as pending inserts, so they reach the server, and the server's `on conflict` makes a double import a no-op.

Rejects a file whose `userId` differs, with an explanation rather than a silent merge of someone else's ledger.

**Nightly nudge** — banner between 22:00 and 10:00 if there are entries and no backup since the last 22:00 cutoff. Snoozeable. Outside that window it is suppressed, because a permanent banner is the fastest way to teach someone to ignore a banner. **[CHANGED]** WorkManager can now actually fire this at 22:00, unlike a web page that could only check when open. Requires `POST_NOTIFICATIONS` (§8), asked for **in context** the first time the reminder is enabled, never at first launch.

Implementation, added 25 Sep 2026: `BackupRepository` (core:data) never touches the SAF picker or storage permissions itself -- the Settings screen (feature:settings) launches `ActivityResultContracts.CreateDocument`/`OpenDocument` and hands over only the resulting `Uri`. The merge logic (`applyImport`) and export snapshot (`buildExportData`) are top-level, testable functions against a real in-memory Room database, same split as every write path this whole sprint -- `BackupRepositoryTest` proves this gate's own two checks directly: a full export → wipe → import round trip reproduces an identical ledger, and importing the same file twice adds nothing the second time. `LedgerExport`'s JSON shape drops `pendingOps` from the plan's own example -- every imported row becomes a fresh `Insert` op regardless (this section's own words: "go in as pending inserts... the server's `on conflict` makes a double import a no-op"), so replaying the OLD op queue verbatim would be actively wrong, not just redundant (a queued delete for a row that's also present in `entries` at export time is a contradiction a fresh import can't produce).

**[SCOPE CUT, flagged not hidden]** The nightly nudge itself ships as an **in-app banner inside Settings only** -- `shouldShowNightlyNudge` (core:domain, pure, tested) correctly implements the 22:00–10:00 window, the "since the last cutoff" rule and snoozing, and `UserPrefs` persists `last_backup_at`/`nudge_snoozed_until`. What's **not** built: the actual Android system notification, `POST_NOTIFICATIONS` permission request, notification channel, and the WorkManager job that would fire it at 22:00 even with the app closed -- this section's own "WorkManager can now actually fire this at 22:00" promise is still open. The banner only appears while Settings happens to be on screen, which is a real gap against "outside the app," not a simplification of it.

## 7.15 Session expired

Refresh token rejected while the app is open.

Non-blocking banner: "Signed out. Your entries are safe on this device." → **Sign in again**.

**The local database and the pending op log are not touched.** After signing back in as the same user, the queue drains. Signing in as a *different* user opens a different DB file, and the first user's data is still there when they return.

## 7.16 Sign out

Refused while pending ops exist, with an honest dialog: "**12 entries haven't been sent yet.** Signing out now keeps them on this device but they won't reach your account until you sign back in." Actions: **Send them first** (default) · **Save a backup** · **Sign out anyway**.

Sign-out clears the session, not the database.

## 7.17 Delete account

Behind Settings → Account. Required by Play, and this is the honest version.

1. Screen listing exactly what is deleted: entries, accounts, profile, sign-in link — and that it is immediate and irreversible
2. **"Save a backup first"** — prominent, and the flow does not push past it quietly
3. Type `DELETE` to confirm
4. Re-authenticate through Credential Manager
5. Call `delete_my_account()`
6. Wipe the local DB file, DataStore and session
7. Confirmation screen → Onboarding

**Implementation, added 25 Sep 2026 (C11):** all 7 steps built, on their own screen (`DeleteAccountRoute`/`DeleteAccountViewModel`, feature:settings) rather than a Settings dialog. `delete_my_account()` (0007_account_deletion.sql) and its `delete-account` edge function already existed from an earlier session with no Android caller; `AuthRepository.deleteAccount()` now calls that RPC directly via `supabase.postgrest.rpc(...)`, matching every other write path in this codebase rather than round-tripping through the edge function's HTTP endpoint (that endpoint exists for browsers without the Supabase SDK — see the web page note below). The RPC is `SECURITY DEFINER` and trusts the caller's ambient JWT with no re-authentication check of its own, so step 4 is a client-side gate only: `decodeJwtEmail` (pure, tested) reads the returned Google ID token's own `email` claim locally — no network call, no session mutation — and compares it against `AuthRepository.currentEmail()`, deliberately NOT reusing `signInWithGoogleIdToken` (which would silently overwrite the ambient session if the person picked a different account than the one being deleted). Steps 5–6 are `AccountDeletionRepository`: call the RPC, then close `SessionDatabaseHolder`, delete the Room file, delete the two per-user DataStore files (new `LedgerDataStoreFactory.deleteUserData`), then clear `SessionStore` last and unconditionally. `consent_state.pb` (device-scoped) is deliberately NOT wiped — a later sign-in on the same device shouldn't repeat the consent pane over a different account's deletion. Step 2 reuses `SignOutGuardDialog`'s exact two-escape-path shape; step 3 is this codebase's first typed-confirmation dialog (`AlertDialog` + `OutlinedTextField`, matching every other destructive-action dialog here rather than a bottom sheet); step 7 is the screen's own `Deleted` state, read directly rather than fired as a one-shot event.

**Public web page** (§11.3) — **moved 26 Sep 2026:** now a static page in the separate public repo `dumbopanda/Ledger-Pages`, live at `https://dumbopanda.github.io/Ledger-Pages/delete-account/`. Supabase Edge Functions force `text/plain` + a script-blocking CSP on any HTML response, so they can't host a page (see `KNOWN-ISSUES.md`); the Supabase function version was removed. Same sign-in and deletion flow as described next. *Original note, now superseded:* `supabase/functions/delete-account-page`, a self-contained HTML+JS page served from the same Supabase project — a genuinely reachable public URL with no separate domain/hosting decision needed. Signs in via Google Identity Services' web SDK (the browser counterpart to Credential Manager), exchanges the credential with `supabase-js`'s `signInWithIdToken`, then POSTs to the same `delete-account` function the app calls. **Not verified against a live browser** — this session's Docker Desktop daemon wasn't running, so `supabase start`/`functions serve` wasn't attempted; the nonce scheme mirrors `SignInViewModel.signIn`'s already-proven logic exactly, which is the most confidence available without an actual round trip. Needs a real browser pass before this step of §11.3 counts as done, not just written.

---

# 8. Permissions

The whole manifest. Every entry justified; the omissions matter as much as the inclusions.

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.USE_BIOMETRIC"/>
```

| Permission | Why | Ask when |
|---|---|---|
| `INTERNET` | Sync | Install-time |
| `ACCESS_NETWORK_STATE` | WorkManager's `NetworkType.CONNECTED` constraint | Install-time |
| `POST_NOTIFICATIONS` | Nightly backup reminder only | **Runtime, in context**, the first time the user enables the reminder. Never at launch. Declining disables the reminder and nothing else. |
| `USE_BIOMETRIC` | Optional app lock | Runtime, only if the user turns the lock on |

**Deliberately not requested:**

| Not requested | Reason |
|---|---|
| `READ_SMS` / `RECEIVE_SMS` | Play **restricted permission**: requires a declaration form, annual re-review, and a demo video. SMS parsing is deferred; requesting it now risks the whole listing. |
| `READ_/WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE` | Backup uses SAF. No permission needed, and SAF is the correct API anyway. |
| `READ_CONTACTS` | No feature needs it |
| `ACCESS_FINE_/COARSE_LOCATION` | No feature needs it |
| `CAMERA` | Receipt capture is not in scope |
| `QUERY_ALL_PACKAGES` | Restricted, and pointless here |
| `SCHEDULE_EXACT_ALARM` | The backup nudge is a *nudge*. WorkManager's inexact window is correct and avoids a restricted permission. |
| `FOREGROUND_SERVICE` | Sync is seconds of work. Background WorkManager is enough. |
| `RECEIVE_BOOT_COMPLETED` | WorkManager reschedules itself across reboots |
| `GET_ACCOUNTS` | Credential Manager does not need it |

Manifest hardening:

```xml
<application
    android:allowBackup="false"
    android:dataExtractionRules="@xml/data_extraction_rules"
    android:usesCleartextTraffic="false"
    android:enableOnBackInvokedCallback="true">
    <activity android:name=".MainActivity" android:exported="true" .../>
</application>
```

`allowBackup="false"` is D9. Android Auto Backup would restore a stale Room file including a stale op log, which would then **replay stale operations against a server that has moved on**. The server pull is the restore path; the file export is the escape hatch.

Exactly one exported component: the launcher activity. No content providers, no exported services, no exported receivers.

**No certificate pinning.** Supabase rotates certificates and a pinned app that outlives a rotation is a bricked app with no remote fix. TLS + `usesCleartextTraffic="false"` is the correct level here.

**`FLAG_SECURE`:** not applied globally — it blocks screenshots, which users of a ledger legitimately want. `setRecentsScreenshotEnabled(false)` **is** applied, so amounts do not sit in the app-switcher preview. That is the setting in §7.13, default on.
---

# 9. Error handling

Every failure maps to a defined state. "Something went wrong" is not a state.

| Failure | Detection | User sees | System does |
|---|---|---|---|
| Offline | Connectivity callback | Header pill: "Offline — 3 waiting" | Ops queue. Nothing blocks. |
| Push 5xx / timeout | HTTP | Silent until 3 failures, then "Couldn't sync — retrying" | Exponential backoff to 5 min |
| Push 401 | HTTP | Nothing on first attempt | Refresh once, retry once, then SessionExpired |
| Push 4xx validation | HTTP | Settings: "1 entry couldn't be saved" + detail + Retry / Discard | Op → dead-letter. **Never auto-retried.** |
| `entry_limit_reached` (P0002) | PG error | "You've reached the entry limit. Export and contact support." | Blocks new entries; existing ones unaffected |
| `transfer_group` violation (P0001) | PG error | "That transfer looks wrong and wasn't saved." | Dead-letter + Sentry. This is a client bug. |
| Pull fails mid-page | HTTP | Nothing | Cursor not advanced; resume next run |
| Room corruption | `SQLiteDatabaseCorruptException` | "Your local copy was damaged. Restoring from your account." | Delete DB file, full re-pull, Sentry. **Surfaces pending-op loss honestly** if any existed. |
| Clock skew | Server timestamps only | Nothing | Not possible by construction (§4.4) |
| Play version too old | `min_supported_build` | Forced-update screen with a store link | Blocks use |
| Google account removed from device | `NoCredentialException` on refresh | SessionExpired + "that Google account isn't on this phone any more" | Local data intact |

**Never silently swallow a sync failure.** The prototype's original sin was treating a Make 200 as proof the row landed. Every operation in the new system has exactly one of three states — pending, confirmed, dead-lettered — and all three are visible in Settings.

---

# 10. Testing

## 10.1 Unit — `core:domain`, `core:model`

| Suite | What it must cover |
|---|---|
| `DateParserTest` | Table-driven, ≥45 cases: every error message in §7.5.1; the missing-separator refusal; 29 Feb resolving back more than one year; two-digit years never resolving to the future; future-date rejection; all four separators |
| `AmountFormatterTest` | 7-digit ceiling; 3rd decimal refused; leading-zero rules; `en-IN` grouping at 5, 6, 7 and 8 digits; **caret position preserved for insert, delete, mid-string edit, and paste** |
| `TxnIdTest` | Regex; Y/N discrimination; generation is in-format |
| `OpenYIdTest` | Odd/even; delete removes a leg and reopens an ID; both legs deleted removes it entirely |
| `OpCoalescerTest` | **Every row of the §5.2 table.** The insert+delete → nothing case is the one that matters most. |
| `ValidateEntryDraftTest` | The §7.5.9 order, including the transfer-shape-first rule |
| `TransferPairTest` | Equal amounts, opposite directions, one group, same date |

## 10.2 Room — `core:database`

In-memory database. DAO queries, the reactive open-Y-ID query, the month-summary aggregate, paging, and **every migration exercised against real data**, not just compiled.

## 10.3 Sync — property test

The highest-value test in the project.

```kotlin
@Test fun `local and server converge under arbitrary offline op sequences`() {
    checkAll(1000, opSequenceGen()) { ops ->
        val local = FakeLocalStore(); val server = FakeServer()
        ops.forEach { local.apply(it) }        // offline
        syncEngine.push(local, server)         // reconnect
        syncEngine.pull(local, server)
        assertThat(local.liveEntries()).isEqualTo(server.liveEntries())
        assertThat(local.pendingOps()).isEmpty()
    }
}
```

Generator emits random valid sequences of insert / update / delete across a small set of `client_uid`s, including transfer pairs, duplicated pushes, and interleaved connectivity drops. This is the only practical way to find the class of bug that costs a user their ledger.

## 10.4 Database — `supabase/tests/` (pgTAP)

```sql
-- rls_entries.sql
select plan(7);
set local role authenticated;
set local request.jwt.claims to '{"sub":"<user-a>"}';
select is_empty($$ select * from entries where user_id = '<user-b>' $$,
                'user A cannot read user B entries');
select throws_ok($$ insert into entries(user_id, ...) values ('<user-b>', ...) $$,
                 '42501', null, 'user A cannot insert as user B');
select throws_ok($$ delete from entries $$, '42501', null,
                 'no DELETE policy exists for anyone');
-- ... transfer cascade, entry cap, timestamp immutability, tombstone in pull
select * from finish();
```

Runs on every PR against a throwaway branch database. **A PR that weakens an RLS policy fails CI.**

Also asserted here: Room's exported schema JSON matches the migration set — a schema change without a migration is a guaranteed crash for every existing user on the next update.

## 10.5 UI and accessibility

- Compose UI tests for the entry form's validation order, the self-transfer toggle's full state change, and the delete-confirmation branches
- Screenshot tests (Roborazzi) for `core:designsystem` and every screen, light theme, at 1.0× and 2.0× font scale
- **Contrast audit**: `TextMuted #78756E` on `CanvasLight #F4F1EA` is ≈3.9:1 and fails WCAG AA for body text (§6.3). Either restrict it to 14sp+ semibold or darken to `#5F5C56`. This is a fix, not a waiver.
- TalkBack pass over the entry form. Every chip group needs a label; the amount field needs a content description that reads the grouped figure, not the raw digits.
- Touch targets ≥48dp. Several prototype chips are smaller.

## 10.6 Manual device matrix

One low-end device (≤3 GB RAM, ~₹10,000 class) is mandatory before every release. Also: a device with no Google account, a device with two Google accounts, airplane mode throughout a full create-edit-delete cycle, and a forced process death mid-form.

---

# 11. Build, release and compliance pipeline

## 11.1 CI — GitHub Actions

```
.github/workflows/
  pr.yml        # on pull_request
  db.yml        # on changes to supabase/**
  release.yml   # on tag v*
  backup.yml    # cron: nightly
  keepalive.yml # cron: every 3 days
```

**`pr.yml`** — spotless/ktlint → detekt → `testDebugUnitTest` → Room schema diff → `lintRelease` → `assembleDebug` → Roborazzi verify. Required to merge.

**`db.yml`** — `supabase db reset` on a branch database → apply every migration from scratch → run the pgTAP suite. Catches a migration that only works incrementally.

**`release.yml`** — `bundleRelease` → sign with a keystore from GitHub Secrets (base64) → upload the mapping file to Sentry → publish to the Play **internal** track via Gradle Play Publisher. Promotion between tracks is manual and deliberate.

**`backup.yml`** — nightly `pg_dump`, encrypted with `age`, uploaded to object storage with 30-day retention. **This exists from day one because the Supabase free tier has no backups at all** and the Pro tier's daily backup is still worth having a second copy of.

**`keepalive.yml`** — a REST ping every 3 days. Free projects pause after 7 days of inactivity; during development that will happen, and a paused project during a tester's 14-day window is a reset clock.

## 11.2 Signing and versioning

- Upload key generated once, **stored in a password manager and on offline media**. Losing it ends the app's life on Play.
- **Play App Signing enrolled** — it is the only recovery path from a lost upload key, and it is free.
- `versionCode` = CI run number, monotonic, never hand-edited
- `versionName` = semver
- R8 full mode on; `mapping.txt` uploaded to Sentry on every release or crash reports are unreadable

**Implementation, added 25 Sep 2026 (C12, security review S10):** `isMinifyEnabled`/`isShrinkResources` on in the app convention plugin (`build-logic`), full mode applying by default (no `gradle.properties` override turns it off). `app/proguard-rules.pro` (new) carries kotlinx.serialization's own documented keep rules (scoped to this app's package plus `io.github.jan.supabase.**`, since supabase-kt's own consumer rules aren't confirmed to cover everything) and defensive keeps for Credential Manager/Google Identity's runtime type resolution — Room and Hilt need nothing added, both ship their own consumer rules. `:app:assembleRelease` succeeds and `mapping.txt` generates at `app/build/outputs/mapping/release/`; uploading it to Sentry still needs Sentry itself set up (below), which needs the owner to create the account/DSN. `:app:assembleRelease` logs ~130 repeated "R8: An error occurred when parsing kotlin metadata" warnings — the same Kotlin-2.3.20-vs-this-AGP's-bundled-R8-version mismatch category as the core-splashscreen finding (C9's own BUILD-LOG entry): R8 falls back to conservative (not aggressive-strip) handling when it can't read Kotlin metadata, so this is very likely harmless, but **not verified on a real device.**
- Sentry: needs the owner to create the account and hand over a DSN — creating that account is theirs to do, wiring the SDK once given a DSN is not.

## 11.3 Play Console requirements

| Item | Detail |
|---|---|
| **Data Safety form** | Declare: email address (account management), **financial info — other financial info** (app functionality), user IDs. Encrypted in transit: yes. Deletion available: yes. Shared with third parties: **no**. Used for ads: **no**. The form must match app behaviour exactly; a mismatch is a suspension, not a warning. |
| **Account deletion** | In-app (§7.17) **and** a public web URL. Play requires the web route for any app with accounts. Google-only sign-in does not exempt you. |
| **Privacy policy URL** | Public, reachable without login, linked in the listing and in-app — **live 26 Sep 2026:** `https://dumbopanda.github.io/Ledger-Pages/privacy/` (Terms alongside at `.../terms/`), same public `Ledger-Pages` repo as the delete-account page. Not yet linked from in-app (Settings → About still needs the URLs wired in) or from the Play listing. |
| **Target API level** | Current Play requirement at submission |
| **Financial features declaration** | A personal expense tracker is **not** a regulated financial product — no loans, no investments, no payments. Declare accordingly and do not describe the app in terms that imply otherwise. |
| **Closed testing** | **12 testers, opted in continuously for 14 days**, with genuine usage, before you can apply for production access. Personal accounts created after 13 Nov 2023 only; organisation accounts are exempt. Google reduced this from 20 in Dec 2024. |

**Recruit 15, not 12.** A tester dropping below 12 restarts the 14-day clock. This is pure calendar time and it is the most common reason a launch slips by a month.

## 11.4 DPDP Act (India)

Final Rules notified 13 Nov 2025; core obligations bite **13 May 2027** with an 18-month transition. You are not late, and retrofitting is worse than building it in:

- **Consent notice** at onboarding — itemised, plain language, versioned (`profiles.consent_version`)
- **Purpose limitation** — the data is used to run the ledger, nothing else. D10 (no analytics) is what makes that statement true.
- **Data minimisation** — email and Google subject ID only. No phone, no name beyond what Google supplies, no device fingerprint.
- **Retention** — deletion on request, executed immediately (§7.17)
- **Breach notification** — a written procedure for notifying affected users and the Data Protection Board
- **Named grievance contact** — a real monitored address in the privacy policy

## 11.5 Observability

- **Sentry Android.** `beforeSend` strips PII. **Amounts, expense names and more-info are never attached to an event** — the class of error and the screen is enough.
- Breadcrumbs: `sign_in_success`, `sync_push_fail`, `sync_pull_fail`, `op_dead_lettered`, `db_corruption`, `entry_limit_reached`
- Play Vitals: ANR rate, crash-free sessions
- Supabase: DB size against 500 MB, MAU against 50k, egress against 5 GB — alerted before they are hit, not after
- **No third-party analytics SDK** (D10). Every SDK is a new Data Safety line and a new DPDP disclosure.

---

# 12. Phases

Numbers are evenings. A phase does not start until the one before it passes its gate.

| # | Phase | Ev. | Gate — "done when" |
|---|---|---|---|
| **0** | Foundations | 3–4 | Supabase project in **ap-south-1**; CLI migrations in git; keepalive + `pg_dump` crons green; a dump **restored into a scratch project** |
| **1** | Database & auth | 8–12 | §4 migrations applied from scratch on a clean branch DB; pgTAP suite green; a deliberately broken RLS policy **fails CI** |
| **2** | Android skeleton | 5–7 | Convention plugins, all modules, Hilt graph, Room schema v1, design system with screenshot baselines, Credential Manager sign-in reaching a real session |
| **3** | Sync engine | 8–10 | §10.3 property test green at 1,000 iterations. Airplane mode: create → edit → delete → reconnect → **no row on the server** |
| **4** | Entry form | 8–10 | Every §7.5 rule has a passing test. Date parser and amount caret suites green. |
| **5** | History, detail, edit, delete | 7–9 | Transfer fold, open-Y-ID badge, all three delete confirmations, undo window |
| **6** | Accounts, settings, backup | 5–6 | SAF export → wipe app → reinstall → import → identical ledger |
| **7** | Onboarding, auth edges, deletion | 4–5 | Every §7.1 boot row and every §7.3 sign-in state reachable; account deletion verified end-to-end including the web route |
| **8** | Hardening | 5–7 | Low-end device pass; TalkBack pass; contrast fixed; R8 release build stable; Sentry receiving mapped stack traces |
| **9** | Compliance & packaging | 3–4 | Data Safety submitted; both policy URLs resolve; signed AAB on the internal track |
| **10** | Closed testing | **14 days wall-clock** | 12+ testers continuously opted in and actually using it → production access granted |
| **11** | Launch | 3–4 | Staged 10 → 50 → 100; a database restore performed at least once |

**~60–80 evenings of work.** With phase 10 overlapping phases 8–9, roughly **16–20 weeks**.

Phase 10's clock starts the moment phase 7 produces an installable build. Starting it at the end costs a month.

---

# 13. Costs

| | |
|---|---|
| Supabase Free | ₹0 — 500 MB, 50k MAU, **no backups**, pauses after 7 idle days |
| Supabase Pro | $25/mo ≈ ₹2,200 — daily backups, no pausing. **Budget from public launch.** |
| Self-managed `pg_dump` cron | ₹0, and kept regardless of tier |
| API hosting | **₹0 — no API server exists** (D3) |
| Google sign-in | ₹0 |
| Domain | ~₹1,000/yr |
| Play Console | $25 once |
| Sentry | Free tier |

**₹0/mo pre-launch, ~₹2,200/mo from public launch** — not because of scale, but because financial data without backups is indefensible.

For scale: ~600 bytes per entry, ~2,000 entries/year for a heavy user ≈ 1.2 MB/year. 500 MB holds roughly **400 heavy users for a year**, or several thousand ordinary ones. You will hit the backup requirement long before you hit the size limit.

**Break-even framing:** ₹2,200/mo ≈ **30 supporters a year at ₹99** after Play's 15%. That is a few hundred engaged users, not ten thousand — worth knowing before you build, because it changes what "success" needs to look like.

---

# 14. Risks, in order

1. **Sync correctness.** Keyset cursor, server-set timestamps, tombstones in the pull feed, `coalesce` on delete during push, and op coalescing. Each one, omitted, is silent unrecoverable data loss. The property test in §10.3 is the mitigation and it is not optional.
2. **The 14-day tester gate.** Pure calendar time, no way to compress. Start it at phase 7.
3. **RLS.** One weakened policy exposes every user's finances. CI gate, every PR.
4. **Backups.** Free tier has none. The nightly dump exists from phase 0.
5. **Signing key.** Play App Signing enrolled + offline copy.
6. **Google-account dependency.** No password fallback, no recovery except the export. Surfaced at onboarding (§7.2 pane 2), which is the only place it is honest.
7. **Free-tier abuse.** One account can 402 the entire project for everyone. Row cap and length checks before launch.
8. **Amount field caret.** The most commonly broken component in Android finance apps, and its own test class exists for that reason.
9. **Scope.** The deferred list below stays deferred.

---

# 15. Deferred

Excel export · real multi-device concurrent sync · charts and budgets · categories · recurring entries · bank SMS parsing (a restricted permission, a declaration form and an annual review) · shared or family ledgers · multi-currency · dark theme · widgets · iOS.

**Multi-device sync is deferred but not designed out.** The keyset cursor, server timestamps and tombstones in §5 mean turning it on later is a feature, not a migration. Do not turn it on now.
