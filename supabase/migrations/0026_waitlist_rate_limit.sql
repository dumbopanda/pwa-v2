-- Stress test found: one machine could add 200 waitlist emails in 6 seconds, and once the table
-- held 20,000 rows new emails were dropped while the person was told "you're on the list".
-- Now: at most 5 new emails per IP per hour, and a full list says so instead of dropping silently.

alter table public.waitlist add column ip text;
create index waitlist_ip_time on public.waitlist (ip, created_at);

drop function public.join_waitlist(text);   -- data-safe: replaced just below by the two-argument version; no table data involved

create function public.join_waitlist(p_email text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$   -- data-safe: only adds a row to the waitlist table
declare v text := lower(trim(p_email));
begin
  if v is null or length(v) > 254 or v !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;
  if exists (select 1 from public.waitlist where email = v) then
    return jsonb_build_object('ok', true);
  end if;
  if p_ip is not null and (select count(*) from public.waitlist where ip = p_ip and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if (select count(*) from public.waitlist) >= 20000 then
    return jsonb_build_object('ok', false, 'reason', 'waitlist_full');
  end if;
  insert into public.waitlist (email, ip) values (v, p_ip) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.join_waitlist(text, text) from public, anon, authenticated;
grant  execute on function public.join_waitlist(text, text) to service_role;
