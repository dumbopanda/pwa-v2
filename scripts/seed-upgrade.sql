-- Realistic data for upgrade-test.sh: two users with every kind of row the app makes.
-- Must load on the schema prod has today; update it when a migration needs new columns.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', u::uuid, 'authenticated', 'authenticated', e, crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'
from (values ('11111111-1111-1111-1111-111111111111', 'a@seed.local'), ('22222222-2222-2222-2222-222222222222', 'b@seed.local')) v(u, e);
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
update public.profiles set onboarded_at = now() - interval '10 days';

insert into public.accounts (id, user_id, client_uid, name, sort_order)
select gen_random_uuid(), u.id, 'acc-' || n, n, i from auth.users u,
  unnest(array['UPI bank', 'Cash', 'Credit card']) with ordinality as a(n, i);
insert into public.categories (user_id, client_uid, name, sort_order)
select u.id, 'cat-' || n, n, i from auth.users u,
  unnest(array['Food & dining', 'Transport', 'Bills & utilities', 'Salary', 'Other']) with ordinality as c(n, i);

-- 40 entries per user over 20 days: opening balances, spends, income; a few soft-deleted.
insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, category_id, expense_name, txn_type, amount_minor, direction)
select a.user_id, 'ob-' || a.id, current_date - 20, 'N' || substr(md5(a.id::text), 1, 6), a.id, null, 'Opening balance', 'Opening balance', 1500000, 'credit'
from public.accounts a;
insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, category_id, expense_name, txn_type, amount_minor, direction)
select a.user_id, 'e-' || a.user_id || '-' || g, current_date - (g % 20), 'N' || substr(md5(a.user_id::text || g), 1, 6), a.id, c.id,
       'item ' || g, case when g % 10 = 0 then 'Income' else 'Expense' end, 1000 + g * 37, case when g % 10 = 0 then 'credit' else 'debit' end::public.txn_direction
from generate_series(1, 40) g
join public.accounts a on a.client_uid = 'acc-UPI bank'
join public.categories c on c.user_id = a.user_id and c.client_uid = case when g % 10 = 0 then 'cat-Salary' else 'cat-Food & dining' end;
update public.entries set deleted_at = now() where expense_name in ('item 7', 'item 13');

insert into public.budgets (user_id, month, category_id, amount_minor)
select c.user_id, date_trunc('month', current_date)::date, c.id, 500000 from public.categories c where c.client_uid = 'cat-Food & dining';
insert into public.day_status (user_id, date) select u.id, current_date - g from auth.users u, generate_series(2, 6) g;
insert into public.events (user_id, name, props) select u.id, 'entry_saved', '{"n":1}' from auth.users u, generate_series(1, 5);
