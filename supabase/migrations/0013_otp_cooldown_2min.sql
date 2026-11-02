-- Owner: 60s is too tight for someone who just opened the app for the first time and doesn't
-- know a code is coming -- give them room to notice the email before "Resend" unlocks. Only the
-- cooldown between codes changes (60s -> 2 min); expiry (5 min), the hourly/daily/IP caps, and
-- the 5-wrong-guess lockout are untouched. A create-or-replace correction, same pattern as
-- 0009/0010, rather than editing 0011 in place.

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
  perform pg_advisory_xact_lock(hashtext('email_otp:' || v_email));

  select max(created_at) into v_last from email_otps where email = v_email;
  if v_last > v_now - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retry_after_s', ceil(extract(epoch from v_last + interval '2 minutes' - v_now)));
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

  delete from email_otps where created_at < v_now - interval '2 days';

  return jsonb_build_object('ok', true, 'id', v_id, 'expires_in_s', 300, 'resend_in_s', 120);
end $$;
