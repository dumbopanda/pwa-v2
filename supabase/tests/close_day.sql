-- 0021: close day (reopen only on the same day) and the balance date rule.
begin;
select plan(13);
set constraints all immediate;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'cd@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');
insert into public.profiles (user_id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- Time zone
select throws_ok($$ update public.profiles set time_zone = 'Mars/Base' $$, '22023', null, 'unknown time zone refused');
select lives_ok($$ update public.profiles set time_zone = 'Asia/Kolkata' $$, 'real time zone accepted');
select is(public.my_today(), (now() at time zone 'Asia/Kolkata')::date, 'my_today is today in my time zone');

-- Close day
select lives_ok($$ insert into public.day_status (date) values (public.my_today()) $$, 'close today');
select is((select status from public.day_status where date = public.my_today()), 'closed', 'stored as closed');
select lives_ok($$ delete from public.day_status where date = public.my_today() $$, 'reopen today');
select is((select count(*) from public.day_status where date = public.my_today()), 0::bigint, 'today reopened');
insert into public.day_status (date) values (public.my_today() - 3);
delete from public.day_status where date = public.my_today() - 3;
select is((select count(*) from public.day_status where date = public.my_today() - 3), 1::bigint, 'a past closed day cannot reopen');
select throws_ok($$ insert into public.day_status (date) values (public.my_today() + 1) $$, '42501', null, 'cannot close a future day');

-- Balance date
insert into public.accounts (id, client_uid, name) values ('aaaaaaaa-0000-0000-0000-0000000000b1', 'acct-bal', 'HDFC');
insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values
  ('cdtest-ob-0001', '2026-11-15', 'Nob0001', 'aaaaaaaa-0000-0000-0000-0000000000b1', 'Opening balance', 'Opening balance', 1500000, 'credit');
select throws_ok($$ insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values
  ('cdtest-early-01', '2026-11-14', 'Nearly1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 'chai', 'Payment', 2000, 'debit') $$, 'P0005', null, 'no payment before the balance date');
select lives_ok($$ insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values
  ('cdtest-ontime-1', '2026-11-15', 'Nontim1', 'aaaaaaaa-0000-0000-0000-0000000000b1', 'chai', 'Payment', 2000, 'debit') $$, 'payment on the balance date is fine');
select throws_ok($$ update public.entries set entry_date = '2026-11-16' where client_uid = 'cdtest-ob-0001' $$, 'P0005', null, 'balance cannot move after existing payments');
select lives_ok($$ update public.entries set deleted_at = now() where client_uid = 'cdtest-ontime-1' $$, 'deleting still works');

select * from finish();
rollback;
