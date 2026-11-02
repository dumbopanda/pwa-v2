begin;
select plan(16);

-- 1-2. Clients can't reach the table or the functions at all.
set local role anon;
select throws_ok($$ select * from public.email_otps $$, '42501', null, 'anon cannot read email_otps');
select throws_ok($$ select public.otp_check('a@x.io', 'h') $$, '42501', null, 'anon cannot call otp_check');
reset role;

-- 3-4. Issue, then the cooldown blocks a second code.
select is((public.otp_issue('A@x.io', 'h1', '1.1.1.1')->>'ok')::bool, true, 'first code issued (email lowercased)');
select is(public.otp_issue('a@x.io', 'h2', '1.1.1.1')->>'reason', 'cooldown', 'second code within the cooldown refused');

-- 5-8. Wrong guesses count down, the 5th locks the code.
select is((public.otp_check('a@x.io', 'bad')->>'attempts_left')::int, 4, '1st wrong guess: 4 left');
select public.otp_check('a@x.io', 'bad'), public.otp_check('a@x.io', 'bad'), public.otp_check('a@x.io', 'bad');
select is(public.otp_check('a@x.io', 'bad')->>'reason', 'locked', '5th wrong guess locks the code');
select is(public.otp_check('a@x.io', 'h1')->>'reason', 'no_code', 'right code after lock is refused');
select ok((select invalidated_at is not null from public.email_otps where code_hash = 'h1'), 'locked row is invalidated');

-- 9-11. Correct guess succeeds once, and only once.
update public.email_otps set created_at = created_at - interval '2 minutes 1 second';
select is((public.otp_issue('a@x.io', 'h3', null)->>'ok')::bool, true, 'new code after cooldown');
select is((public.otp_check('a@x.io', 'h3')->>'ok')::bool, true, 'correct code accepted');
select is(public.otp_check('a@x.io', 'h3')->>'reason', 'no_code', 'same code refused the second time');

-- 12. Expiry.
update public.email_otps set created_at = created_at - interval '2 minutes 1 second';
select public.otp_issue('a@x.io', 'h4', null);
update public.email_otps set expires_at = clock_timestamp() - interval '1 second' where code_hash = 'h4';
select is(public.otp_check('a@x.io', 'h4')->>'reason', 'expired', 'expired code refused');

-- 13. A new code kills the previous unused one.
update public.email_otps set created_at = created_at - interval '2 minutes 1 second';
select public.otp_issue('b@x.io', 'b1', null);
update public.email_otps set created_at = created_at - interval '2 minutes 1 second' where email = 'b@x.io';
select public.otp_issue('b@x.io', 'b2', null);
select is(public.otp_check('b@x.io', 'b1')->>'reason', 'wrong_code', 'old code no longer valid after a new one');

-- 14. Hourly cap: 5 codes per email per hour.
insert into public.email_otps (email, code_hash, created_at, expires_at)
select 'c@x.io', 'c', clock_timestamp() - (n * interval '2 minutes'), clock_timestamp() from generate_series(2, 6) n;
select is(public.otp_issue('c@x.io', 'c7', null)->>'reason', 'too_many', '6th code in an hour refused');

-- 15. Daily cap: 10 codes per email per day.
insert into public.email_otps (email, code_hash, created_at, expires_at)
select 'd@x.io', 'd', clock_timestamp() - (n * interval '2 hours'), clock_timestamp() from generate_series(1, 10) n;
select is(public.otp_issue('d@x.io', 'd11', null)->>'reason', 'too_many', '11th code in a day refused');

-- 16. Per-IP cap: 20 codes per hour across any addresses.
insert into public.email_otps (email, code_hash, ip, created_at, expires_at)
select 'ip' || n || '@x.io', 'i', '9.9.9.9', clock_timestamp() - interval '5 minutes', clock_timestamp() from generate_series(1, 20) n;
select is(public.otp_issue('fresh@x.io', 'f', '9.9.9.9')->>'reason', 'too_many', '21st code from one IP in an hour refused');

select * from finish();
rollback;
