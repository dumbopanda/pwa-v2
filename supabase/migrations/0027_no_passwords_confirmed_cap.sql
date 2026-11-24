-- Owner 2026-11-24, security review before sharing with users.
-- The app signs people in only with Google or an emailed code; it never uses passwords.
-- Supabase's own password sign-up was still open, so someone could register another
-- person's email with a password and, once that person signed in by code (which confirms
-- the email), log in to their account with the password.
-- 1. No account may hold a password: refused when created and when changed.
-- 2. The founding-member cap counts confirmed accounts only, so unconfirmed sign-ups made
--    through Supabase's own endpoints can't use up the places.

create function public.refuse_password() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(new.encrypted_password, '') = '' then return new; end if;
  if tg_op = 'UPDATE' and new.encrypted_password = coalesce(old.encrypted_password, '') then return new; end if;
  raise exception 'password_sign_in_disabled' using errcode = 'P0001';
end $$;
revoke execute on function public.refuse_password() from public, anon, authenticated;
create trigger auth_users_no_password before insert or update of encrypted_password on auth.users
  for each row execute function public.refuse_password();

create or replace function public.enforce_signup_cap() returns trigger
language plpgsql security definer set search_path = public, auth as $$   -- data-safe: reads a count and may refuse a new sign-up; changes no rows
declare cap int;
begin
  select (value #>> '{}')::int into cap from public.app_config where key = 'signup_cap';
  perform pg_advisory_xact_lock(hashtext('signup_cap'));
  if cap is not null and (select count(*) from auth.users where email_confirmed_at is not null) >= cap then
    raise exception 'signups_closed' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.signup_blocked(p_email text) returns boolean
language sql stable security definer set search_path = public, auth as $$   -- data-safe: read-only check
  select (select count(*) from auth.users where email_confirmed_at is not null)
           >= coalesce((select (value #>> '{}')::int from public.app_config where key = 'signup_cap'), 2147483647)
     and not exists (select 1 from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null);
$$;
