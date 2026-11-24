-- 0024: founding-member number (first 200 free for life) and the picked avatar icon.
begin;
select plan(11);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'usera@pgtap.local', null, now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'userb@pgtap.local', null, now(), now(), now(), '{}', '{}');

select is((select member_no from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
          (select member_no + 1 from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'), 'sign-ups are numbered in order');
select is((select plan from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'), 'supporter', 'an early member is free for life');

-- Number 201 is an ordinary free account.
select setval('public.member_no_seq', 200, true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'userc@pgtap.local', null, now(), now(), now(), '{}', '{}');
select is((select member_no from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'), 201, 'the next number is 201');
select is((select plan from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'), 'free', 'member 201 is not free for life');

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';

update public.profiles set member_no = 1, plan = 'supporter' where user_id = '33333333-3333-3333-3333-333333333333';
select is((select member_no from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'), 201, 'a client cannot change its member number');
select is((select plan from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'), 'free', 'a client cannot make itself free for life');

select lives_ok($$ update public.profiles set avatar = 'fox' where user_id = auth.uid() $$, 'a built-in avatar can be picked');
select is((select avatar from public.profiles where user_id = auth.uid()), 'fox', 'the avatar is saved');
select throws_ok($$ update public.profiles set avatar = 'photo.png' where user_id = auth.uid() $$, '23514', null, 'only the 30 built-in avatars are allowed');
select lives_ok($$ update public.profiles set avatar = null where user_id = auth.uid() $$, 'the avatar can be cleared');
select throws_ok($$ select nextval('public.member_no_seq') $$, '42501', null, 'a client cannot draw member numbers');

select * from finish();
rollback;
