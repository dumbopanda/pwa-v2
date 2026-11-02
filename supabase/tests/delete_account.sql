-- Delete account removes every row the user owns, and nothing of anyone else's.
begin;
select plan(10);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'usera@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userb@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

-- Give both users one row in every table, including a transfer pair.
do $$
declare u uuid; acct uuid; acct2 uuid; cat uuid; tg uuid;
begin
  foreach u in array array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[] loop
    insert into public.accounts (user_id, client_uid, name) values (u, 'acct-' || u, 'Bank') returning id into acct;
    insert into public.accounts (user_id, client_uid, name) values (u, 'acct2-' || u, 'Cash') returning id into acct2;
    insert into public.categories (user_id, client_uid, name) values (u, 'cat-' || u, 'Food') returning id into cat;
    insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, category_id, expense_name, txn_type, amount_minor, direction)
      values (u, 'e1-' || u, '2026-11-01', 'Naaaaaa', acct, cat, 'chai', 'Payment', 2000, 'debit');
    tg := gen_random_uuid();
    insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction, transfer_group) values
      (u, 'e2-' || u, '2026-11-01', 'Ytrans1', acct,  'Self Transfer', 'Sent Transfer',     5000, 'debit',  tg),
      (u, 'e3-' || u, '2026-11-01', 'Ytrans1', acct2, 'Self Transfer', 'Received Transfer', 5000, 'credit', tg);
    insert into public.budgets (user_id, month, category_id, amount_minor) values (u, '2026-11-01', cat, 100), (u, '2026-11-01', null, 100);
    insert into public.day_status (user_id, date, status) values (u, '2026-10-31', 'no_spend');
    insert into public.events (user_id, name) values (u, 'app_open');
  end loop;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
select lives_ok($$ select public.delete_my_account() $$, 'A deletes own account');
reset role;

select is((select count(*) from auth.users        where id      = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'auth user gone');
select is((select count(*) from public.profiles   where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'profile gone');
select is((select count(*) from public.accounts   where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'accounts gone');
select is((select count(*) from public.categories where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'categories gone');
select is((select count(*) from public.entries    where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'entries gone (tombstones too)');
select is((select count(*) from public.budgets    where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'budgets gone');
select is((select count(*) from public.day_status where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'day_status gone');
select is((select count(*) from public.events     where user_id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'events gone');

select is(
  (select count(*) from public.entries where user_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.budgets where user_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.events  where user_id = '22222222-2222-2222-2222-222222222222'),
  6::bigint, 'B keeps every row');

select * from finish();
rollback;
