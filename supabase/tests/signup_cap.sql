-- 0025: no new accounts past the cap; waitlist takes emails but cannot be read by the app.
begin;
select plan(12);

update public.app_config set value = '1'::jsonb where key = 'signup_cap';
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'in@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

select throws_ok($$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'late@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}') $$,
  'P0001', 'signups_closed', 'a new account is refused at the cap');
select is((select count(*)::int from auth.users), 1, 'nobody got in');
select ok(public.signup_blocked('late@pgtap.local'), 'a new address is blocked when full');
select ok(not public.signup_blocked('IN@pgtap.local'), 'a person who already has an account is not blocked');

set local role anon;
select throws_ok($$ select public.join_waitlist('x@pgtap.local', null) $$, '42501', null, 'the app cannot call join_waitlist directly');
select throws_ok($$ select * from public.waitlist $$, '42501', null, 'the app cannot read the waitlist');
reset role;
set local role service_role;
select is(public.join_waitlist('  Wait@Pgtap.Local ', '1.1.1.1') ->> 'ok', 'true', 'the server can add to the waitlist');
select is(public.join_waitlist('not an email', '1.1.1.1') ->> 'reason', 'invalid_email', 'a bad address is refused');
select is(public.join_waitlist('wait@pgtap.local', '1.1.1.1') ->> 'ok', 'true', 'joining twice is fine');
select is((select count(*)::int from (select public.join_waitlist('w' || g || '@pgtap.local', '2.2.2.2') from generate_series(1, 5) g) x), 5, 'five from one IP');
select is(public.join_waitlist('w6@pgtap.local', '2.2.2.2') ->> 'reason', 'too_many', 'the sixth from that IP in an hour is refused');
reset role;
select is((select email from public.waitlist where ip = '1.1.1.1'), 'wait@pgtap.local', 'the address is stored lowercase');

select * from finish();
rollback;
