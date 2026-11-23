-- DEV ONLY (project pwa-v2-dev). Never run on prod.
-- Resets the test account by phase so a change can be tried again from that point.
-- Test account: testing@spendroll.com. Run one phase block at a time.

-- Phase 1: sign-in. The next login is a brand-new signup (consent box shows again).
-- delete from auth.users where email = 'testing@spendroll.com';   -- cascades to everything

-- Phase 2: email code. Clear its codes so a new one can be requested at once.
-- delete from public.email_otps where email = 'testing@spendroll.com';

-- Phase 3: onboarding. Keeps the login; removes accounts, categories, entries, budgets, closed days.
do $$
declare u uuid := (select id from auth.users where email = 'testing@spendroll.com');
begin
  if u is null then raise exception 'test user not found'; end if;
  delete from public.entries    where user_id = u;
  delete from public.day_status where user_id = u;
  delete from public.budgets    where user_id = u;
  delete from public.categories where user_id = u;
  delete from public.accounts   where user_id = u;
  update public.profiles set onboarded_at = null where user_id = u;
end $$;
