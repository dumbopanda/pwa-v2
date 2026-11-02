-- Email sign-in by 6-digit one-time code, alongside Google (reverses D5's
-- "Google only"). Supabase Auth's own email OTP has an expiry and a per-email
-- resend interval, but no per-code wrong-guess counter -- only a per-IP
-- verify limit -- so codes are issued and checked here instead, and Auth is
-- used only to mint the session once otp_check() has said yes (email-otp
-- Edge Function). Every rule lives in these two functions rather than the
-- Edge Function, so nothing calling the database directly can skip one.
--
-- Rules:
--   * a code lives 5 minutes
--   * one new code per email per 60 seconds, max 5 per hour and 10 per day
--   * max 20 codes per hour from one IP (stops one sender spraying addresses)
--   * issuing a code kills every earlier unused code for that email
--   * 5 wrong guesses kill the code
--   * a correct guess marks it consumed at that exact instant, under a row
--     lock, so two simultaneous correct guesses can't both succeed
--
-- Only an HMAC of the code is stored (keyed with the OTP_PEPPER function
-- secret, never in the database), so a leaked table can't be brute-forced
-- back to live codes.

create table public.email_otps (
  id             bigint generated always as identity primary key,
  email          text        not null check (email = lower(email)),
  code_hash      text        not null,
  ip             text,
  created_at     timestamptz not null default clock_timestamp(),
  expires_at     timestamptz not null,
  attempts       smallint    not null default 0,
  consumed_at    timestamptz,
  invalidated_at timestamptz
);

create index email_otps_email_created on public.email_otps (email, created_at desc);
create index email_otps_ip_created    on public.email_otps (ip, created_at desc) where ip is not null;

-- No policies: anon/authenticated get nothing. Only service_role (the Edge
-- Function) touches this table, and it bypasses RLS.
alter table public.email_otps enable row level security;
revoke all on table public.email_otps from public, anon, authenticated;

create or replace function public.otp_issue(p_email text, p_code_hash text, p_ip text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_email  text := lower(trim(p_email));
  v_now    timestamptz := clock_timestamp();
  v_last   timestamptz;
  v_oldest timestamptz;
  v_count  int;
  v_id     bigint;
begin
  -- Serialize concurrent requests for the same address, so two taps can't
  -- both pass the cooldown check before either inserts.
  perform pg_advisory_xact_lock(hashtext('email_otp:' || v_email));

  select max(created_at) into v_last from email_otps where email = v_email;
  if v_last > v_now - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after_s', ceil(extract(epoch from v_last + interval '60 seconds' - v_now)));
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from email_otps where email = v_email and created_at > v_now - interval '1 hour';
  if v_count >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many',
      'retry_after_s', ceil(extract(epoch from v_oldest + interval '1 hour' - v_now)));
  end if;

  select count(*), min(created_at) into v_count, v_oldest
    from email_otps where email = v_email and created_at > v_now - interval '1 day';
  if v_count >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many',
      'retry_after_s', ceil(extract(epoch from v_oldest + interval '1 day' - v_now)));
  end if;

  if p_ip is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from email_otps where ip = p_ip and created_at > v_now - interval '1 hour';
    if v_count >= 20 then
      return jsonb_build_object('ok', false, 'reason', 'too_many',
        'retry_after_s', ceil(extract(epoch from v_oldest + interval '1 hour' - v_now)));
    end if;
  end if;

  update email_otps set invalidated_at = v_now
   where email = v_email and consumed_at is null and invalidated_at is null;

  insert into email_otps (email, code_hash, ip, created_at, expires_at)
  values (v_email, p_code_hash, p_ip, v_now, v_now + interval '5 minutes')
  returning id into v_id;

  -- Housekeeping: nothing older than the 1-day window is ever read again.
  delete from email_otps where created_at < v_now - interval '2 days';

  return jsonb_build_object('ok', true, 'id', v_id, 'expires_in_s', 300, 'resend_in_s', 60);
end $$;

-- The email failed to send: drop the row so it doesn't burn the person's
-- cooldown or hourly quota for a code they never received.
create or replace function public.otp_discard(p_id bigint)
returns void language sql set search_path = public as $$
  delete from email_otps where id = p_id and consumed_at is null;
$$;

create or replace function public.otp_check(p_email text, p_code_hash text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_now   timestamptz;
  v_row   email_otps%rowtype;
begin
  -- FOR UPDATE: a second guess arriving mid-check waits here, then re-reads
  -- the row -- and finds it already consumed/invalidated.
  select * into v_row from email_otps
   where email = v_email and consumed_at is null and invalidated_at is null
   order by created_at desc limit 1
   for update;

  v_now := clock_timestamp();

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;

  if v_row.expires_at <= v_now then
    update email_otps set invalidated_at = v_now where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_row.code_hash = p_code_hash then
    update email_otps set consumed_at = v_now where id = v_row.id;
    return jsonb_build_object('ok', true);
  end if;

  if v_row.attempts + 1 >= 5 then
    update email_otps set attempts = attempts + 1, invalidated_at = v_now where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  update email_otps set attempts = attempts + 1 where id = v_row.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong_code', 'attempts_left', 4 - v_row.attempts);
end $$;

-- Same lesson as 0010: revoke from PUBLIC, not just the named roles.
revoke execute on function public.otp_issue(text, text, text) from public, anon, authenticated;
revoke execute on function public.otp_discard(bigint)         from public, anon, authenticated;
revoke execute on function public.otp_check(text, text)       from public, anon, authenticated;
grant  execute on function public.otp_issue(text, text, text) to service_role;
grant  execute on function public.otp_discard(bigint)         to service_role;
grant  execute on function public.otp_check(text, text)       to service_role;
