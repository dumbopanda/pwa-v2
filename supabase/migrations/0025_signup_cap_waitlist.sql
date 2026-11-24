-- Invite-only for now: no new account once auth.users holds `signup_cap` people (200).
-- Existing people sign in as always. Others leave an email on a waitlist instead.
-- Raise the cap later by updating app_config 'signup_cap' in a new migration.

insert into public.app_config values ('signup_cap', '200'::jsonb);

create table public.waitlist (
  email      text primary key check (email = lower(email) and length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
revoke all on table public.waitlist from public, anon, authenticated;

-- The hard stop, whatever the sign-in route (Google, email code). The lock keeps two
-- sign-ups at 199 from both getting in.
create function public.enforce_signup_cap() returns trigger
language plpgsql security definer set search_path = public, auth as $$   -- data-safe: reads a count and may refuse a new sign-up; changes no rows
declare cap int;
begin
  select (value #>> '{}')::int into cap from public.app_config where key = 'signup_cap';
  perform pg_advisory_xact_lock(hashtext('signup_cap'));
  if cap is not null and (select count(*) from auth.users) >= cap then
    raise exception 'signups_closed' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger auth_users_signup_cap before insert on auth.users
  for each row execute function public.enforce_signup_cap();

-- email-otp asks this before sending a code: closed AND this address has no account.
create function public.signup_blocked(p_email text) returns boolean
language sql stable security definer set search_path = public, auth as $$   -- data-safe: read-only check
  select (select count(*) from auth.users) >= coalesce((select (value #>> '{}')::int from public.app_config where key = 'signup_cap'), 2147483647)
     and not exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;

-- The waitlist form posts to the email-otp function, which calls this. The app itself cannot call or read it.
create function public.join_waitlist(p_email text) returns void
language plpgsql security definer set search_path = public as $$   -- data-safe: only adds a row to the new waitlist table
declare v text := lower(trim(p_email));
begin
  if v is null or length(v) > 254 or v !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if (select count(*) from public.waitlist) >= 20000 then return; end if;   -- keeps a flood from filling the table
  insert into public.waitlist (email) values (v) on conflict do nothing;
end $$;

revoke execute on function public.enforce_signup_cap()    from public, anon, authenticated;
revoke execute on function public.signup_blocked(text)    from public, anon, authenticated;
revoke execute on function public.join_waitlist(text)     from public, anon, authenticated;
grant  execute on function public.signup_blocked(text)    to service_role;
grant  execute on function public.join_waitlist(text)     to service_role;
