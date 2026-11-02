-- Every table: a user reaches only their own rows; anon reaches nothing.
-- Plus catalogue checks, so a future table that forgets RLS, a grant or the
-- delete cascade fails here without anyone writing a new test.
begin;
select * from no_plan();

-- Setup as postgres (RLS not applied yet).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'usera@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userb@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.accounts (id, user_id, client_uid, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'acct-a-0001', 'A Bank'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'acct-b-0001', 'B Bank');
insert into public.categories (id, user_id, client_uid, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000ca', '11111111-1111-1111-1111-111111111111', 'cat-a-0001', 'Food'),
  ('bbbbbbbb-0000-0000-0000-0000000000cb', '22222222-2222-2222-2222-222222222222', 'cat-b-0001', 'Food');
insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, category_id, expense_name, txn_type, amount_minor, direction) values
  ('11111111-1111-1111-1111-111111111111', 'entry-a-0001', '2026-11-01', 'Naaaaaa', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000000ca', 'chai', 'Payment', 2000, 'debit'),
  ('22222222-2222-2222-2222-222222222222', 'entry-b-0001', '2026-11-01', 'Nbbbbbb', 'bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-0000000000cb', 'chai', 'Payment', 2000, 'debit');
insert into public.budgets (user_id, month, category_id, amount_minor) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-01', 'aaaaaaaa-0000-0000-0000-0000000000ca', 500000),
  ('11111111-1111-1111-1111-111111111111', '2026-11-01', null, 1000000),
  ('22222222-2222-2222-2222-222222222222', '2026-11-01', 'bbbbbbbb-0000-0000-0000-0000000000cb', 500000),
  ('22222222-2222-2222-2222-222222222222', '2026-11-01', null, 1000000);
insert into public.day_status (user_id, date, status) values
  ('11111111-1111-1111-1111-111111111111', '2026-10-31', 'no_spend'),
  ('22222222-2222-2222-2222-222222222222', '2026-10-31', 'no_spend');
insert into public.events (user_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'app_open'),
  ('22222222-2222-2222-2222-222222222222', 'app_open');

-- ===== As user A =====
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- Reads: own rows visible, B's rows invisible, on every user table.
select ok((select count(*) from public.profiles   where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own profile');
select ok((select count(*) from public.accounts   where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own accounts');
select ok((select count(*) from public.categories where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own categories');
select ok((select count(*) from public.entries    where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own entries');
select ok((select count(*) from public.budgets    where user_id = '11111111-1111-1111-1111-111111111111') = 2, 'A sees own budgets');
select ok((select count(*) from public.day_status where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own day_status');
select ok((select count(*) from public.events     where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A sees own events');

select is_empty($$ select 1 from public.profiles   where user_id <> auth.uid() $$, 'A cannot read other profiles');
select is_empty($$ select 1 from public.accounts   where user_id <> auth.uid() $$, 'A cannot read other accounts');
select is_empty($$ select 1 from public.categories where user_id <> auth.uid() $$, 'A cannot read other categories');
select is_empty($$ select 1 from public.entries    where user_id <> auth.uid() $$, 'A cannot read other entries');
select is_empty($$ select 1 from public.budgets    where user_id <> auth.uid() $$, 'A cannot read other budgets');
select is_empty($$ select 1 from public.day_status where user_id <> auth.uid() $$, 'A cannot read other day_status');
select is_empty($$ select 1 from public.events     where user_id <> auth.uid() $$, 'A cannot read other events');
select is_empty($$ select 1 from public.pull_entries(null, null, 1000)    where user_id <> auth.uid() $$, 'pull_entries returns only own rows');
select is_empty($$ select 1 from public.pull_accounts(null, null, 1000)   where user_id <> auth.uid() $$, 'pull_accounts returns only own rows');
select is_empty($$ select 1 from public.pull_categories(null, null, 1000) where user_id <> auth.uid() $$, 'pull_categories returns only own rows');
select is_empty($$ select 1 from public.app_config where key like 'private.%' $$, 'A cannot read private config');

-- Inserts as B are refused by WITH CHECK.
select throws_ok($$ insert into public.accounts (user_id, client_uid, name) values ('22222222-2222-2222-2222-222222222222', 'hack-acct-1', 'x') $$, '42501', null, 'A cannot insert an account as B');
select throws_ok($$ insert into public.categories (user_id, client_uid, name) values ('22222222-2222-2222-2222-222222222222', 'hack-cat-1', 'x') $$, '42501', null, 'A cannot insert a category as B');
select throws_ok($$ insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values ('22222222-2222-2222-2222-222222222222', 'hack-entry-1', '2026-11-01', 'Nhackhk', 'bbbbbbbb-0000-0000-0000-00000000000b', 'x', 'Payment', 1, 'debit') $$, '42501', null, 'A cannot insert an entry as B');
select throws_ok($$ insert into public.budgets (user_id, month, amount_minor) values ('22222222-2222-2222-2222-222222222222', '2026-12-01', 1) $$, '42501', null, 'A cannot insert a budget as B');
select throws_ok($$ insert into public.day_status (user_id, date, status) values ('22222222-2222-2222-2222-222222222222', '2026-10-30', 'no_spend') $$, '42501', null, 'A cannot insert day_status as B');
select throws_ok($$ insert into public.events (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'app_open') $$, '42501', null, 'A cannot insert an event as B');

-- A cannot hand its own row over to B.
select throws_ok($$ update public.budgets set user_id = '22222222-2222-2222-2222-222222222222' where user_id = auth.uid() $$, '42501', null, 'A cannot move a row to B');

-- A's own entry cannot point at B's account or category.
select throws_ok($$ insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values ('hack-entry-2', '2026-11-01', 'Nhack02', 'bbbbbbbb-0000-0000-0000-00000000000b', 'x', 'Payment', 1, 'debit') $$, '23503', null, 'A cannot use B''s account');
select throws_ok($$ insert into public.entries (client_uid, entry_date, txn_id, account_id, category_id, expense_name, txn_type, amount_minor, direction) values ('hack-entry-3', '2026-11-01', 'Nhack03', 'aaaaaaaa-0000-0000-0000-00000000000a', 'bbbbbbbb-0000-0000-0000-0000000000cb', 'x', 'Payment', 1, 'debit') $$, '23503', null, 'A cannot use B''s category');

-- Updates/deletes aimed at B match nothing (checked below as postgres).
update public.profiles   set display_name = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
update public.accounts   set name = 'hacked'         where user_id = '22222222-2222-2222-2222-222222222222';
update public.categories set name = 'hacked'         where user_id = '22222222-2222-2222-2222-222222222222';
update public.entries    set expense_name = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
update public.budgets    set amount_minor = 1        where user_id = '22222222-2222-2222-2222-222222222222';
update public.day_status set status = 'open'         where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.budgets    where user_id = '22222222-2222-2222-2222-222222222222';
delete from public.day_status where user_id = '22222222-2222-2222-2222-222222222222';

-- Verbs with no grant are refused outright.
select throws_ok($$ update public.events set name = 'x' $$, '42501', null, 'events cannot be updated');
select throws_ok($$ delete from public.events $$,           '42501', null, 'events cannot be deleted');
select throws_ok($$ delete from public.accounts $$,         '42501', null, 'accounts cannot be hard-deleted');
select throws_ok($$ delete from public.categories $$,       '42501', null, 'categories cannot be hard-deleted');
select throws_ok($$ delete from public.profiles $$,         '42501', null, 'profiles cannot be deleted by a client');
select throws_ok($$ select * from public.email_otps $$,     '42501', null, 'authenticated cannot read email_otps');
select throws_ok($$ select public.admin_metrics() $$,       '42501', null, 'non-admin cannot read metrics');

reset role;
select is((select display_name from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'), null, 'B profile untouched');
select is((select name from public.accounts   where user_id = '22222222-2222-2222-2222-222222222222'), 'B Bank', 'B account untouched');
select is((select name from public.categories where user_id = '22222222-2222-2222-2222-222222222222'), 'Food',   'B category untouched');
select is((select expense_name from public.entries where user_id = '22222222-2222-2222-2222-222222222222'), 'chai', 'B entry untouched');
select is((select count(*) from public.budgets    where user_id = '22222222-2222-2222-2222-222222222222' and amount_minor > 1), 2::bigint, 'B budgets untouched');
select is((select status from public.day_status   where user_id = '22222222-2222-2222-2222-222222222222'), 'no_spend', 'B day_status untouched');

-- ===== As anon: nothing =====
set local role anon;
select throws_ok(format('select 1 from public.%I', c.relname), '42501', null, 'anon cannot read ' || c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
 order by c.relname;
select throws_ok($$ select * from public.pull_entries() $$, '42501', null, 'anon cannot call pull_entries');
select throws_ok($$ select public.ai_take_quota('parse') $$, '42501', null, 'anon cannot call ai_take_quota');
select throws_ok($$ select public.delete_my_account() $$,    '42501', null, 'anon cannot call delete_my_account');
reset role;

-- ===== Catalogue: rules every public table and function must follow =====
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has RLS enabled');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') $$,
  'anon holds no privilege on any public table or view (directly or via PUBLIC)');

select is_empty($$
  select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute no public function (directly or via PUBLIC)');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id')
     and not (c.relforcerowsecurity
              and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)) $$,
  'every user table has FORCE RLS and at least one policy');

select is_empty($$
  select p.schemaname || '.' || p.tablename || ':' || p.policyname from pg_policies p
   where p.schemaname = 'public' and not (p.roles <@ array['authenticated']::name[]) $$,
  'every policy is scoped to authenticated only');

select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id')
     and not exists (select 1 from pg_constraint k
                      where k.conrelid = c.oid and k.contype = 'f'
                        and k.confrelid = 'auth.users'::regclass and k.confdeltype = 'c') $$,
  'every user table cascades from auth.users, so account deletion reaches it');

select * from finish();
rollback;
