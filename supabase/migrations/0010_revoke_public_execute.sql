-- Correction to 0009, same day. 0009 revoked EXECUTE from the named roles
-- `anon`/`authenticated` on ten functions -- but verifying live via
-- pg_proc.proacl afterward showed every one of them still carrying a bare
-- `=X/postgres` ACL entry. `=` (no role name before it) is the PUBLIC
-- pseudo-role; `anon` never held its own individual grant on these
-- functions at all -- its access rode entirely on that PUBLIC entry, the
-- same entry `authenticated` also rode on for the six pure trigger
-- functions below. Revoking from a NAMED role that only ever had access
-- via a SEPARATE public grant changes nothing: Postgres unions every
-- applicable ACL entry (direct role grant, role-membership grant, and the
-- PUBLIC grant) when computing effective privilege, so the PUBLIC entry
-- alone was still enough to keep both roles in. This is the exact bug
-- 0009 itself was trying to fix (0007's `revoke all ... from public` on
-- `delete_my_account` -- which, unlike these ten, is confirmed live to
-- have actually removed its PUBLIC entry, so that one function was
-- already correct going into 0009). Caught by re-querying `proacl` after
-- applying 0009 rather than trusting `has_function_privilege()` calls made
-- only before the fix.
revoke execute on function public.stamp_timestamps()                    from public;
revoke execute on function public.check_transfer_group()                from public;
revoke execute on function public.protect_profile_columns()             from public;
revoke execute on function public.cascade_transfer_delete()             from public;
revoke execute on function public.handle_new_user()                     from public;
revoke execute on function public.maintain_entry_count()                from public;
revoke execute on function public.pull_entries(timestamptz, uuid, int)  from public;
revoke execute on function public.pull_accounts(timestamptz, uuid, int) from public;
revoke execute on function public.push_entries(jsonb)                   from public;
revoke execute on function public.open_y_ids()                          from public;

-- The four sync functions each already carry their own DIRECT grant to
-- `authenticated` (confirmed live, separate from the PUBLIC entry just
-- revoked above), so no re-grant is needed here for them to keep working
-- for signed-in users. The six pure trigger functions have no such direct
-- grant to anyone -- correct, since nothing outside the trigger mechanism
-- itself should ever call them, and trigger invocation doesn't check
-- EXECUTE on the trigger function (a DML-privilege check on the table is
-- the separate domain that actually gates it).
