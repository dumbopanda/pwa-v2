-- 0027: no account may hold a password; the cap counts confirmed accounts only.
begin;
select plan(6);
select lives_ok($$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', '71111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'np1@pgtap.local', null, now(), now(), now(), '{}', '{}') $$, 'passwordless account (code or Google) is created');
select lives_ok($$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', '72222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'np2@pgtap.local', '', now(), now(), '{}', '{}') $$, 'empty password is fine');
select throws_ok($$ insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', '73333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'np3@pgtap.local', crypt('x', gen_salt('bf')), now(), now(), '{}', '{}') $$, 'P0001', 'password_sign_in_disabled', 'password sign-up refused');
select throws_ok($$ update auth.users set encrypted_password = crypt('x', gen_salt('bf')) where id = '71111111-1111-1111-1111-111111111111' $$, 'P0001', 'password_sign_in_disabled', 'adding a password later refused');
select lives_ok($$ update auth.users set email_confirmed_at = now() where id = '72222222-2222-2222-2222-222222222222' $$, 'other updates still work');
update public.app_config set value = to_jsonb((select count(*) from auth.users where email_confirmed_at is not null)::int + 1) where key = 'signup_cap';
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', '74444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'unconfirmed@pgtap.local', null, now(), now(), '{}', '{}');
select is(public.signup_blocked('new@pgtap.local'), false, 'an unconfirmed sign-up does not use up a founding place');
select * from finish();
rollback;
