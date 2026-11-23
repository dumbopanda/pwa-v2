-- DEV ONLY. Resets the test account by phase so a change can be tried again from that point.
-- Every block refuses to run unless app_config.env = 'dev' (set once per database; prod is 'prod').
-- Test account: testing@spendroll.com. Run one block at a time.

-- Phase 1: sign-in. Deletes the test user; the next login is a brand-new signup.
do $$ begin
  if (select value #>> '{}' from public.app_config where key = 'env') is distinct from 'dev' then raise exception 'not the dev database'; end if;
  delete from auth.users where email = 'testing@spendroll.com';
end $$;

-- Phase 2: email code. Clears the test account's codes so a new one can be asked for at once.
do $$ begin
  if (select value #>> '{}' from public.app_config where key = 'env') is distinct from 'dev' then raise exception 'not the dev database'; end if;
  delete from public.email_otps where email = 'testing@spendroll.com';
end $$;

-- Phase 3: onboarding. Keeps the login; removes accounts, categories, entries, budgets, closed days.
do $$
declare u uuid := (select id from auth.users where email = 'testing@spendroll.com');
begin
  if (select value #>> '{}' from public.app_config where key = 'env') is distinct from 'dev' then raise exception 'not the dev database'; end if;
  if u is null then raise exception 'test user not found'; end if;
  delete from public.entries    where user_id = u;
  delete from public.day_status where user_id = u;
  delete from public.budgets    where user_id = u;
  delete from public.categories where user_id = u;
  delete from public.accounts   where user_id = u;
  update public.profiles set onboarded_at = null where user_id = u;
end $$;
