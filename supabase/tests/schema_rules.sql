-- Behaviour of 0015-0017: currency, categories, budgets, day_status, events,
-- AI quota, admin metrics.
begin;
select plan(23);

-- Fire the deferred transfer check at the end of each statement, so a bad
-- transfer fails inside throws_ok instead of at commit.
set constraints all immediate;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'usera@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');
update public.app_config set value = '["11111111-1111-1111-1111-111111111111"]' where key = 'private.admin_user_ids';

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- Currency
insert into public.accounts (id, client_uid, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'acct-inr-1', 'UPI bank');
insert into public.accounts (id, client_uid, name) values ('aaaaaaaa-0000-0000-0000-000000000002', 'acct-inr-2', 'Cash');
insert into public.accounts (id, client_uid, name, currency) values ('aaaaaaaa-0000-0000-0000-000000000003', 'acct-usd-1', 'US account', 'USD');

select is((select currency::text from public.accounts where client_uid = 'acct-inr-1'), 'INR', 'account currency defaults to INR');
select throws_ok($$ insert into public.accounts (client_uid, name, currency) values ('acct-bad-1', 'Bad', 'inr') $$, '23514', null, 'currency must be 3 capital letters');

select lives_ok($$
  insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction, transfer_group) values
    ('tx-ok-out', '2026-11-01', 'Ytxok01', 'aaaaaaaa-0000-0000-0000-000000000001', 'Self Transfer', 'Sent Transfer',     1000, 'debit',  'cccccccc-0000-0000-0000-000000000001'),
    ('tx-ok-in',  '2026-11-01', 'Ytxok01', 'aaaaaaaa-0000-0000-0000-000000000002', 'Self Transfer', 'Received Transfer', 1000, 'credit', 'cccccccc-0000-0000-0000-000000000001') $$,
  'same-currency transfer is accepted');
select throws_ok($$
  insert into public.entries (client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction, transfer_group) values
    ('tx-bad-out', '2026-11-01', 'Ytxbad1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Self Transfer', 'Sent Transfer',     1000, 'debit',  'cccccccc-0000-0000-0000-000000000002'),
    ('tx-bad-in',  '2026-11-01', 'Ytxbad1', 'aaaaaaaa-0000-0000-0000-000000000003', 'Self Transfer', 'Received Transfer', 1000, 'credit', 'cccccccc-0000-0000-0000-000000000002') $$,
  'P0001', 'transfer_currency_mismatch', 'INR -> USD transfer is refused');

select throws_ok($$ update public.accounts set currency = 'USD' where client_uid = 'acct-inr-1' $$, 'P0004', null, 'currency locked once the account has live entries');
select lives_ok($$ update public.accounts set currency = 'EUR' where client_uid = 'acct-usd-1' $$, 'currency can change while the account has no entries');

-- Categories
insert into public.categories (id, client_uid, name) values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'cat-food-1', 'Food');
select throws_ok($$ insert into public.categories (client_uid, name) values ('cat-food-2', ' food ') $$, '23505', null, 'live category names are unique, case-insensitive');

select public.push_entries(
  '[{"client_uid":"push-cat-1","entry_date":"2026-11-02","txn_id":"Npush01","account_id":"aaaaaaaa-0000-0000-0000-000000000001","category_id":"aaaaaaaa-0000-0000-0000-0000000000c1","expense_name":"swiggy","txn_type":"Payment","amount_minor":34000,"direction":"debit"}]'::jsonb);
select is((select category_id from public.entries where client_uid = 'push-cat-1'),
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, 'push_entries stores category_id');

update public.categories set deleted_at = now() where client_uid = 'cat-food-1';
select ok(exists (select 1 from public.pull_categories() where client_uid = 'cat-food-1' and deleted_at is not null), 'pull_categories includes tombstones');

-- Budgets
insert into public.budgets (month, amount_minor) values ('2026-11-01', 1000000);
select throws_ok($$ insert into public.budgets (month, amount_minor) values ('2026-11-01', 5) $$, '23505', null, 'one savings target per month');
select throws_ok($$ insert into public.budgets (month, amount_minor) values ('2026-11-15', 5) $$, '23514', null, 'budget month must be the 1st');
select throws_ok($$ insert into public.budgets (month, amount_minor) values ('2026-12-01', 0) $$, '23514', null, 'budget amount must be positive');

-- Day status
insert into public.day_status (date, status) values ('2026-11-01', 'no_spend');
select throws_ok($$ insert into public.day_status (date, status) values ('2026-11-01', 'no_spend') $$, '23505', null, 'one day_status per day');
select lives_ok($$ delete from public.day_status where date = '2026-11-01' $$, 'no-spend can be un-marked');

-- Events
select throws_ok($$ insert into public.events (name) values ('Bad Name') $$, '23514', null, 'event names are lowercase identifiers');
select throws_ok($$ insert into public.events (name, props) values ('x', jsonb_build_object('t', repeat('a', 1200))) $$, '23514', null, 'event props are capped at 1000 bytes');
insert into public.events (name, created_at) values ('app_open', '2000-01-01');
select is((select created_at from public.events where name = 'app_open' limit 1), now(), 'event created_at is server time');

-- AI quota: 10 a minute, 50 a day
select is((public.ai_take_quota('parse')->>'ok')::bool, true, 'first AI call allowed');
select throws_ok($$ select public.ai_take_quota('other') $$, '22023', null, 'unknown AI function refused');
insert into public.events (name) select 'ai_call' from generate_series(1, 9);
select is(public.ai_take_quota('parse')->>'reason', 'minute_cap', '11th call in a minute refused');

reset role;
update public.events set created_at = now() - interval '2 hours' where name = 'ai_call';
insert into public.events (user_id, name) select '11111111-1111-1111-1111-111111111111', 'ai_call' from generate_series(1, 40);
update public.events set created_at = now() - interval '2 hours' where name = 'ai_call';
set local role authenticated;
select is(public.ai_take_quota('review')->>'reason', 'daily_cap', '51st call in a day refused (10 + 40 used)');

-- Row cap
reset role;
insert into public.categories (user_id, client_uid, name)
  select '11111111-1111-1111-1111-111111111111', 'bulk-cat-' || n, 'Cat ' || n from generate_series(1, 199) n;  -- + cat-food-1 = 200
set local role authenticated;
select throws_ok($$ insert into public.categories (client_uid, name) values ('cat-0201x', 'One too many') $$, 'P0002', null, '201st category refused');

-- Admin metrics
select ok(public.admin_metrics() ? 'retention', 'admin can read metrics');

select * from finish();
rollback;
