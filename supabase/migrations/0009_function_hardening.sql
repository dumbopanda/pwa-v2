-- Security review, 25 Sep 2026. Two issues, both surfaced by the project's own
-- Supabase security advisor (function_search_path_mutable,
-- anon_security_definer_function_executable,
-- authenticated_security_definer_function_executable), not by manual review --
-- an earlier manual pass over these same files, on the same day, wrongly
-- flagged check_transfer_group as missing its user_id scope; 0008 had
-- already fixed that. Verified live via has_function_privilege() before
-- writing anything here, rather than trusting the migration files' own
-- stated intent.

-- 1. None of these 7 functions pin search_path. For a SECURITY DEFINER
-- function this is a classic privilege-escalation vector (a role that can
-- create objects in a schema earlier in ITS OWN search_path could shadow an
-- unqualified name the function resolves at runtime); even for SECURITY
-- INVOKER functions it's cheap, correct hygiene Postgres's own docs
-- recommend unconditionally. Every function this project already
-- hand-annotated with `set search_path = ...` (delete_my_account,
-- handle_new_user, maintain_entry_count, cascade_transfer_delete) already
-- does this -- these 7 just never got the same treatment.
alter function public.stamp_timestamps()                    set search_path = public;
alter function public.check_transfer_group()                set search_path = public;
alter function public.protect_profile_columns()             set search_path = public;
alter function public.pull_entries(timestamptz, uuid, int)  set search_path = public;
alter function public.pull_accounts(timestamptz, uuid, int) set search_path = public;
alter function public.push_entries(jsonb)                   set search_path = public;
alter function public.open_y_ids()                          set search_path = public;

-- 2. `revoke all ... from public` (0007) doesn't do what it reads as: PUBLIC
-- is "every role," but Supabase's own project bootstrap grants EXECUTE to
-- `anon`/`authenticated` DIRECTLY (and via ALTER DEFAULT PRIVILEGES for
-- anything created afterward), not through the PUBLIC pseudo-role -- so
-- revoking from PUBLIC never touched those direct grants. Confirmed live:
-- every function in this project, delete_my_account included, currently
-- shows has_function_privilege('anon', ..., 'EXECUTE') = true.
--
-- The 6 pure trigger functions (return type `trigger`) are revoked from
-- BOTH roles entirely -- nothing outside the trigger mechanism itself
-- should ever call them directly, and Postgres invokes triggers without
-- checking EXECUTE on the trigger function (that's a DML-privilege check on
-- the TABLE, a separate domain), so this has zero effect on the triggers
-- that actually use them. It also isn't merely redundant with Postgres's
-- own "trigger functions can only be called as triggers" refusal on
-- RETURNS TRIGGER functions -- that refusal is enforced at call time by the
-- executor, not by the permission system, so revoking EXECUTE here is a
-- second, independent layer, not a no-op on top of it.
revoke execute on function public.stamp_timestamps()        from anon, authenticated;
revoke execute on function public.check_transfer_group()    from anon, authenticated;
revoke execute on function public.protect_profile_columns() from anon, authenticated;
revoke execute on function public.cascade_transfer_delete() from anon, authenticated;
revoke execute on function public.handle_new_user()         from anon, authenticated;
revoke execute on function public.maintain_entry_count()    from anon, authenticated;

-- Sync + deletion RPCs: real client-facing calls, but never meaningful for
-- anon (RLS/auth.uid() already made an anon call harmless -- this closes
-- the surface itself, not just its effect, matching 0007's own already-
-- stated intent for delete_my_account).
revoke execute on function public.pull_entries(timestamptz, uuid, int)  from anon;
revoke execute on function public.pull_accounts(timestamptz, uuid, int) from anon;
revoke execute on function public.push_entries(jsonb)                   from anon;
revoke execute on function public.open_y_ids()                         from anon;
revoke execute on function public.delete_my_account()                  from anon;

grant execute on function public.pull_entries(timestamptz, uuid, int)  to authenticated;
grant execute on function public.pull_accounts(timestamptz, uuid, int) to authenticated;
grant execute on function public.push_entries(jsonb)                   to authenticated;
grant execute on function public.open_y_ids()                         to authenticated;

-- 3. maintain_entry_count (0008) reads entry_count, checks it against the
-- cap, THEN writes -- three separate steps. A plain SELECT takes no row
-- lock, so two truly concurrent statements for the SAME user (nothing
-- technical stops a client firing overlapping push_entries calls) can both
-- read the same pre-update count, both pass the check, and both write,
-- overshooting max_entries_per_user by the overlap. 0008 already narrowed
-- this from per-row to per-statement, which helps, but didn't close it.
--
-- Fixed by folding the check into the UPDATE's own WHERE clause: the
-- UPDATE's row lock on `profiles` is what actually serializes concurrent
-- statements for the same user (the second one blocks until the first
-- commits, then re-evaluates the cap against the NOW-current count) --
-- the decision and the write happen in the same locked statement instead
-- of two statements with a window between them.
create or replace function public.maintain_entry_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cap int;
  rec record;
  new_count int;
begin
  select (value #>> '{}')::int into cap from public.app_config
    where key = 'max_entries_per_user';

  for rec in select user_id, count(*) as added_count from new_rows group by user_id loop
    update public.profiles
       set entry_count = entry_count + rec.added_count
     where user_id = rec.user_id
       and entry_count + rec.added_count <= cap
    returning entry_count into new_count;

    if new_count is null then
      raise exception 'entry_limit_reached' using errcode = 'P0002';
    end if;
  end loop;

  return null;
end $$;

-- No trigger (re)creation needed: `entries_count` (0008) already points at
-- this function by name, and `create or replace function` above is enough
-- for it to pick up the new body. A second `create trigger` here would just
-- fail on "trigger already exists."
