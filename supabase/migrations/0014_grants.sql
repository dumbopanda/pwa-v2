-- This project has "Automatically expose new tables" OFF, so 0001-0013 left
-- every table with no privileges for the API roles. Grant exactly what the
-- RLS policies already allow, to `authenticated` only. `anon` gets nothing.

-- 1. anon: nothing, on anything that exists now.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 2. authenticated: only the verbs each table's policies cover.
--    No DELETE on profiles/accounts/entries: deletes are tombstones (D7).
grant select, update         on public.profiles   to authenticated;
grant select                 on public.app_config to authenticated;
grant select, insert, update on public.accounts   to authenticated;
grant select, insert, update on public.entries    to authenticated;

-- 3. email_otps is touched only by the email-otp Edge Function as
--    service_role (otp_issue/otp_check/otp_discard are security invoker).
grant select, insert, update, delete on public.email_otps to service_role;
grant usage on all sequences in schema public to service_role;

-- 4. Anything created later in public by this role starts closed:
--    no EXECUTE for PUBLIC, nothing for anon. Each migration grants explicitly.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
