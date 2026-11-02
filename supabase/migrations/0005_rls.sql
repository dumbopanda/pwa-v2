-- Every table. force so even the table owner is subject to it.
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

-- Note the omissions, they are deliberate:
--  - No `for delete` policy on any table -> hard delete is impossible from a
--    client. D7 is enforced by the absence of code, not by the presence of it.
--  - No `profiles_insert` -> only the signup trigger creates profiles.

-- profiles.plan and entry_count are client-writable under profiles_update,
-- which is wrong. Fix with a column-guard trigger.
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
