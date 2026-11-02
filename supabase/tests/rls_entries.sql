begin;
select plan(7);

-- Setup: two fake users + an account + a starting entry each, as postgres
-- (this transaction hasn't switched role yet, so RLS doesn't apply here).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'usera@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userb@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}');

insert into public.accounts (id, user_id, client_uid, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'pgtap-acct-a01', 'A Wallet'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'pgtap-acct-b01', 'B Wallet');

insert into public.entries (id, user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'pgtap-entry-a01', '2026-01-01', 'Naaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A expense', 'food', 1000, 'debit'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'pgtap-entry-b01', '2026-01-01', 'Nbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B expense', 'food', 2000, 'debit');

-- Everything from here runs as user A, via the real `authenticated` role.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- 1. Cross-user select isolation.
select is_empty(
  $$ select * from public.entries where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A cannot read user B entries'
);

-- 2. INSERT/UPDATE violations raise via the policy's WITH CHECK clause.
select throws_ok(
  $$ insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction)
     values ('22222222-2222-2222-2222-222222222222', 'pgtap-hack-001', '2026-01-01', 'Nhackhk', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'hack', 'food', 100, 'debit') $$,
  '42501', null,
  'user A cannot insert as user B'
);

-- 3. No DELETE policy exists anywhere. Unlike INSERT/UPDATE (WITH CHECK,
-- which raises), SELECT/DELETE use USING, which silently filters to zero
-- matching rows rather than raising an error -- confirmed by hand in A6.
delete from public.entries where id = 'e0000000-0000-0000-0000-000000000001';
select ok(
  (select count(*) from public.entries where id = 'e0000000-0000-0000-0000-000000000001') = 1,
  'no DELETE policy exists for anyone -- the row survives a client-attempted delete'
);

-- 4. Transfer cascade: deleting one leg deletes its sibling.
insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction, transfer_group)
values ('11111111-1111-1111-1111-111111111111', 'pgtap-tx-a-out', '2026-01-02', 'Ntxaout', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Transfer out', 'transfer', 5000, 'debit', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction, transfer_group)
values ('11111111-1111-1111-1111-111111111111', 'pgtap-tx-a-in', '2026-01-02', 'Ntxain2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Transfer in', 'transfer', 5000, 'credit', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

update public.entries set deleted_at = now() where client_uid = 'pgtap-tx-a-out';

select ok(
  (select deleted_at is not null from public.entries where client_uid = 'pgtap-tx-a-in'),
  'deleting one transfer leg cascades to delete the sibling'
);

-- 5. Entry cap fires. app_config has no write policy for `authenticated`,
-- so drop back to postgres just to force the cap, then return.
reset role;
update public.app_config set value = '0'::jsonb where key = 'max_entries_per_user';
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

select throws_ok(
  $$ insert into public.entries (user_id, client_uid, entry_date, txn_id, account_id, expense_name, txn_type, amount_minor, direction)
     values ('11111111-1111-1111-1111-111111111111', 'pgtap-cap-001', '2026-01-03', 'Ncapcap', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'over the cap', 'food', 100, 'debit') $$,
  'P0002', null,
  'entry cap fires once the limit is reached'
);

-- 6. Timestamp immutability: created_at cannot be overwritten on update.
update public.entries set created_at = '2000-01-01'::timestamptz
  where id = 'e0000000-0000-0000-0000-000000000001';

select ok(
  (select created_at <> '2000-01-01'::timestamptz from public.entries where id = 'e0000000-0000-0000-0000-000000000001'),
  'created_at cannot be overwritten by a client update'
);

-- 7. Tombstones are in the pull feed on purpose (no deleted_at filter).
select ok(
  exists (
    select 1 from public.pull_entries(null, null, 500)
    where client_uid = 'pgtap-tx-a-out' and deleted_at is not null
  ),
  'pull_entries includes tombstoned (deleted) rows'
);

select * from finish();
rollback;
